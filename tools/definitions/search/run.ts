import { isAbsolute, relative, resolve } from "node:path";

/**
 * The process runner behind `spectre_search`. It spawns the ripwire binary
 * the probe resolved, never a shell, and reads the answer back as data.
 */

export type RunStatus = "answered" | "empty" | "partial" | "absent" | "refused";

export interface RunResult {
  status: RunStatus;
  command: string;
  answer: string;
  note?: string;
}

const EMPTY_NOTE =
  "No hits in the indexed tree. That is not proof of absence. Re-issue the text search with a path or include for raw text.";

const TRUNCATE_BYTES = 32_000;
const HEADER_AT = 8_192;

const binaryOf = (): string | null => {
  const env = Bun.env.SPECTRE_RIPWIRE;
  if (env !== undefined && env !== "") return env;
  return Bun.which("ripwire");
};

/**
 * Resolve `path` against `root` for the spawn. `undefined` means the whole
 * tree, which needs no scope. Anything that lands outside the root is
 * `undefined`, and the caller refuses it without spawning.
 */
export const scope = (root: string, path?: string): string | undefined => {
  if (path === undefined) return undefined;
  const base = resolve(root);
  const resolved = isAbsolute(path) ? resolve(path) : resolve(base, path);
  const rel = relative(base, resolved);
  if (rel === "" || (rel !== ".." && !rel.startsWith("../"))) return resolved;
  return undefined;
};

/**
 * Run the argv the policy built, with the binary prepended and `--no-cache`
 * appended when `fresh` is true. `command` is the full argv joined, which is
 * what the answer says ran.
 *
 * A binary that is not there is `absent`. A non-zero exit is `refused` with
 * the stderr in `note`. Empty stdout is `empty`: the tree was read and held
 * nothing, which is not proof of absence. Output past 32,000 characters is
 * truncated with a note. A non-zero `graph_unresolved=` or `unresolved=` in
 * the header is `partial`: the graph left entries unplaced.
 */
export const run = (
  root: string,
  argv: readonly string[],
  options?: { fresh?: boolean; timeoutMs?: number },
): Promise<RunResult> => {
  const binary = binaryOf();
  const args = [...argv, ...(options?.fresh === true ? ["--no-cache"] : [])];
  const command = (binary === null ? [...argv] : [binary, ...args]).join(" ");
  if (binary === null)
    return Promise.resolve({
      status: "absent",
      command,
      answer: "",
      note: "ripwire is not installed: SPECTRE_RIPWIRE is unset and no ripwire is on PATH, so no code index was read.",
    });

  const runSpawn = async (): Promise<RunResult> => {
    let out: string;
    let err: string;
    let code: number;
    try {
      const proc = Bun.spawn([binary, ...args], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        signal: AbortSignal.timeout(options?.timeoutMs ?? 20_000),
      });
      [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError")
        return {
          status: "refused",
          command,
          answer: "",
          note: `ripwire did not answer within ${options?.timeoutMs ?? 20_000}ms.`,
        };
      return {
        status: "absent",
        command,
        answer: "",
        note: `${binary} could not be started, so no code index was read.`,
      };
    }

    if (code !== 0)
      return {
        status: "refused",
        command,
        answer: out.trim(),
        note: err.trim() === "" ? `ripwire exited ${code}.` : err.trim(),
      };

    if (out.trim() === "") return { status: "empty", command, answer: "", note: EMPTY_NOTE };

    let answer = out;
    let note: string | undefined;
    const encoded = new TextEncoder().encode(answer);
    if (encoded.length > TRUNCATE_BYTES) {
      // Back off over a cut multi-byte sequence so the slice stays valid
      // UTF-8. Only the last character can be cut: the encoder never emits
      // anything else incomplete.
      let end = TRUNCATE_BYTES;
      while (end > 0) {
        let start = end - 1;
        while (start > 0 && (encoded[start]! & 0xc0) === 0x80) start--;
        const lead = encoded[start]!;
        const width = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4;
        if (start + width <= end) break;
        end = start;
      }
      answer = new TextDecoder().decode(encoded.slice(0, end));
      note = `Output exceeded ${TRUNCATE_BYTES} bytes and was truncated.`;
    }

    const unresolved = /(?:graph_unresolved|unresolved)\s*=\s*"?(0|[1-9][0-9]*)"?/.exec(
      answer.slice(0, HEADER_AT),
    );
    if (unresolved !== null && unresolved[1] !== "0") {
      const partial = "The call graph left entries unresolved.";
      return { status: "partial", command, answer, note: note === undefined ? partial : `${note} ${partial}` };
    }

    return note === undefined ? { status: "answered", command, answer } : { status: "answered", command, answer, note };
  };

  return runSpawn();
};
