import { describe, expect, test } from "bun:test";
import { listingOf } from "../../tools/definitions/stack/read";

/**
 * A `gh pr list` that fails and a `gh pr list` that returns nothing are two
 * different answers, and this file is what keeps them apart. It used to be one
 * answer: a non-zero exit returned `[]`, the tool read that as an empty stack,
 * and reported `stack: "clear"` with no `problems` line, which is the opposite
 * of what its own description promises.
 */

describe("a listing that failed is not an empty listing", () => {
  test("a non-zero exit is a problem, carrying gh's own first line", () => {
    expect(listingOf({ out: "", err: "gh: could not authenticate\nstack trace", code: 1 })).toEqual(
      {
        problem: "gh: could not authenticate",
      },
    );
  });

  test("an empty output is an empty listing", () => {
    expect(listingOf({ out: "", err: "", code: 0 })).toEqual({ numbers: [] });
  });

  test("an empty JSON array is an empty listing", () => {
    expect(listingOf({ out: "[]", err: "", code: 0 })).toEqual({ numbers: [] });
  });

  test("numbers come back lowest first, because a stack lands bottom-up", () => {
    expect(
      listingOf({ out: '[{"number":31},{"number":4},{"number":12}]', err: "", code: 0 }),
    ).toEqual({
      numbers: [4, 12, 31],
    });
  });

  test("output that is not a list is a problem rather than a silent zero", () => {
    expect(listingOf({ out: '{"number":7}', err: "", code: 0 })).toEqual({
      problem: "gh pr list did not return a list of numbers",
    });
  });
});

/** The directory holding the committed failing `gh`, and the only PATH entry it needs. */
const SHIM = `${import.meta.dir}/fixtures`;

/**
 * `Bun.which` answers from a cache, so putting the failing `gh` first on PATH
 * inside this process changes nothing at all. The proof therefore runs in a
 * fresh bun whose PATH is the fixture directory alone, which is the one way to
 * hand the tool a `gh` that actually fails.
 */
const withAFailingGh = async () => {
  const tool = `${import.meta.dir}/../../tools/definitions/stack/index.ts`;
  const script = `
    const { Effect } = await import("effect");
    const { stack } = await import(${JSON.stringify(tool)});
    try {
      const done = await Effect.runPromise(
        stack(process.cwd()).execute({ allowDraft: false }, {
          sessionID: "ses", agent: "build", messageID: "m", id: "c", progress: () => Effect.void,
        }),
      );
      console.log("RESOLVED " + JSON.stringify(done.output ?? null));
    } catch (cause) {
      console.log("FAILED " + (cause instanceof Error ? cause.message : String(cause)));
    }
  `;

  const proc = Bun.spawn([process.execPath, "-e", script], {
    cwd: import.meta.dir,
    env: { ...process.env, PATH: SHIM },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return out.trim();
};

describe("the tool refuses rather than reporting a clear stack", () => {
  test("with gh failing on PATH, the call fails instead of resolving to clear", async () => {
    const said = await withAFailingGh();

    expect(said.startsWith("FAILED ")).toBe(true);
    expect(said).not.toContain("RESOLVED");
  });

  test("the caller is told which failure it was, not just that one happened", async () => {
    expect(await withAFailingGh()).toContain("could not authenticate");
  });

  test("and it says the stack decides nothing, rather than reading as clear", async () => {
    expect(await withAFailingGh()).toContain("so this stack decides nothing");
  });
});

/**
 * A `gh` that succeeds and logs every invocation, written to a temp directory
 * OUTSIDE the repository at test time. `Bun.which` answers from a cache, so the
 * only way to hand `readPr` a counting `gh` is a fresh `bun` subprocess whose
 * PATH starts with the shim directory — the same trick `withAFailingGh` uses.
 */
const withACountingGh = async (repoViewFails: boolean): Promise<string> => {
  const dir = Bun.spawnSync(["mktemp", "-d"]).stdout.toString().trim();
  const log = `${dir}/count.log`;
  await Bun.write(
    `${dir}/gh`,
    `#!/bin/sh
echo "$@" >> "${log}"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  n="$3"
  printf '{"number":%s,"state":"OPEN","isDraft":false,"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","reviewDecision":null,"statusCheckRollup":[],"mergedAt":null}' "$n"
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  ${repoViewFails ? 'echo "gh: could not resolve" >&2\nexit 1' : 'echo "acme/repo"\nexit 0'}
fi
if [ "$1" = "api" ]; then
  echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}'
  exit 0
fi
echo "unexpected: $@" >&2
exit 1
`,
  );
  Bun.spawnSync(["chmod", "+x", `${dir}/gh`]);

  const tool = `${import.meta.dir}/../../tools/definitions/stack/index.ts`;
  const script = `
    const { Effect } = await import("effect");
    const { stack } = await import(${JSON.stringify(tool)});
    const done = await Effect.runPromise(
      stack(process.cwd()).execute({ prs: [11, 22, 33] }, {
        sessionID: "ses", agent: "build", messageID: "m", id: "c", progress: () => Effect.void,
      }),
    );
    const log = await Bun.file(${JSON.stringify(log)}).text();
    const lines = log.trim().split("\\n");
    console.log("REPO_VIEW=" + lines.filter((l) => l.startsWith("repo view")).length);
    console.log("TOTAL=" + lines.length);
    console.log("THREADS=" + JSON.stringify(done.output.rows.map((r) => r.threads)));
    console.log("PROBLEMS=" + (done.output.problems ?? ""));
  `;

  const proc = Bun.spawn([process.execPath, "-e", script], {
    cwd: import.meta.dir,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_LOG: log },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return out.trim();
};

describe("the repository slug resolves once per listing, not once per PR", () => {
  test("three rows in one listing cost one `repo view` and seven processes", async () => {
    const said = await withACountingGh(false);

    expect(said).toContain("REPO_VIEW=1");
    expect(said).toContain("TOTAL=7");
    expect(said).toContain("THREADS=[0,0,0]");
  }, 30_000);

  test("a failing `repo view` still leaves threads unread with the same problems line", async () => {
    const said = await withACountingGh(true);

    expect(said).toContain("REPO_VIEW=1");
    expect(said).toContain("could not resolve the repository, so review threads were not read");
    expect(said).toContain("THREADS=[-1,-1,-1]");
  }, 30_000);
});

/**
 * A `repo view` that fails ONCE and then answers, so the second row in the same
 * process can only succeed if a failed resolution is not remembered. Sharing the
 * slug while it is in flight is the point; caching the failure is the hazard the
 * sharing opens, because the plugin is one long-lived process and an auth lapse
 * would otherwise outlive itself.
 */
const withARecoveringGh = async (): Promise<string> => {
  const dir = Bun.spawnSync(["mktemp", "-d"]).stdout.toString().trim();
  const log = `${dir}/count.log`;
  await Bun.write(
    `${dir}/gh`,
    `#!/bin/sh
echo "$@" >> "${log}"
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  n="$3"
  printf '{"number":%s,"state":"OPEN","isDraft":false,"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","reviewDecision":null,"statusCheckRollup":[],"mergedAt":null}' "$n"
  exit 0
fi
if [ "$1" = "repo" ] && [ "$2" = "view" ]; then
  if [ ! -f "${dir}/failed" ]; then
    : > "${dir}/failed"
    echo "gh: could not resolve the repository" >&2
    exit 1
  fi
  echo "acme/repo"
  exit 0
fi
if [ "$1" = "api" ]; then
  echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[]}}}}}'
  exit 0
fi
echo "unexpected: $@" >&2
exit 1
`,
  );
  Bun.spawnSync(["chmod", "+x", `${dir}/gh`]);

  const tool = `${import.meta.dir}/../../tools/definitions/stack/index.ts`;
  const script = `
    const { Effect } = await import("effect");
    const { stack } = await import(${JSON.stringify(tool)});
    const context = { sessionID: "ses", agent: "build", messageID: "m", id: "c", progress: () => Effect.void };
    const run = async (prs) => {
      const done = await Effect.runPromise(stack(process.cwd()).execute({ prs }, context));
      return done.output;
    };
    const first = await run([10]);
    const second = await run([21]);
    console.log("FIRST=" + first.rows[0].threads + " " + JSON.stringify(first.problems ?? []));
    console.log("SECOND=" + second.rows[0].threads + " " + JSON.stringify(second.problems ?? []));
  `;

  const proc = Bun.spawn([process.execPath, "-e", script], {
    cwd: import.meta.dir,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return out.trim();
};

describe("a failed slug resolution is not remembered", () => {
  test("the row that hit the failure reads -1, the next one recovers", async () => {
    const said = await withARecoveringGh();

    expect(said).toContain("FIRST=-1 ");
    expect(said).toContain("could not resolve the repository, so review threads were not read");
    expect(said).toContain("SECOND=0 []");
  }, 30_000);
});
