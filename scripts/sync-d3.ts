import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot } from "../tools/definitions/canvas/store";

/**
 * Put the pinned d3 UMD bundle on disk so a canvas page can draw with it.
 *
 * Three browser facts force this shape, and all three are measured rather than
 * assumed. A `file://` page cannot `fetch` the bundle, because a fetch is always
 * CORS-mode. It cannot `import` one either, because a module fetch is CORS-mode
 * too. What a `file://` page can load is a **classic** relative `<script src>`,
 * which is why the UMD build is pinned here and not the ESM entry. And the
 * bundle is 279,706 bytes, which no session writes through `write`, so the bytes
 * have to arrive by download.
 *
 * The filename carries the version, so a page names the exact bundle it was built
 * against and two versions can sit in one directory without shadowing each other.
 *
 * Two digests are pinned, because they answer different questions. The tarball
 * digest is what came off the registry, and it is checked before a single member
 * is extracted. The bundle digest is what lands on disk, and it is what a second
 * run compares against, so "already vendored" is decidable with no network.
 *
 *   bun run scripts/sync-d3.ts <canvas-directory>   vendor into <directory>/vendor/
 *   bun run scripts/sync-d3.ts                      vendor into the machine cache
 */

const PIN = {
  name: "d3",
  version: "7.9.0",
  tarballIntegrity:
    "sha512-e1U46jVP+w7Iut8Jt8ri1YsPOvFpg46k+K8TpCb0P+zjCkjkPnV7WzfDJzMHy1LnA+wj5pLT1wjO901gLXeEhA==",
  bundleSha256: "f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539",
  member: "package/dist/d3.min.js",
} as const;

export type Vendored =
  | { readonly status: "vendored"; readonly path: string }
  | { readonly status: "present"; readonly path: string }
  | { readonly status: "refused"; readonly why: string };

/**
 * The filename a page's `<script src>` names. Exported because the skill quotes
 * it and the test asserts against it, so the two cannot drift apart.
 */
export const bundleName = (): string => `${PIN.name}-${PIN.version}.min.js`;

const machineCache = (): string => join(dataRoot, "vendor");

/**
 * Where the bytes go. With a canvas directory they land in `vendor/` beside
 * `canvas.html`, so a relative `src` resolves and copying the folder carries the
 * library with it. Without one they land in the machine cache, which is one copy
 * for every project rather than one per canvas.
 */
export const destinationOf = (directory: string | undefined): string =>
  directory === undefined
    ? join(machineCache(), bundleName())
    : join(directory, "vendor", bundleName());

const sha256 = async (bytes: ArrayBuffer): Promise<string> =>
  new Bun.CryptoHasher("sha256").update(new Uint8Array(bytes)).digest("hex");

const sha512Base64 = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-512", bytes);
  return `sha512-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
};

const tarballUrl = (): string =>
  `https://registry.npmjs.org/${PIN.name}/-/${PIN.name}-${PIN.version}.tgz`;

/**
 * `tar` rather than a hand-rolled archive reader. The repository already spawns
 * `git`, `gh` and `open` the same way, and `Bun.gunzipSync` decompresses a gzip
 * stream without knowing a tar header is inside it.
 */
const extract = async (archive: string, into: string): Promise<string | undefined> => {
  const proc = Bun.spawn(["tar", "-xzf", archive, "-C", into, PIN.member], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code === 0) return undefined;
  return `tar exited ${code}: ${(await Bun.readableStreamToText(proc.stderr)).trim()}`;
};

const fetchArchive = async (
  into: string,
): Promise<{ readonly ok: true; readonly path: string } | { readonly ok: false; readonly why: string }> => {
  const url = tarballUrl();
  const response = await fetch(url).catch((cause: unknown) => cause as Error);
  if (response instanceof Error) return { ok: false, why: `${url} did not answer: ${response.message}` };

  const bytes = await response.arrayBuffer();
  if (response.status !== 200) return { ok: false, why: `${url} answered ${response.status}` };

  const integrity = await sha512Base64(bytes);
  if (integrity !== PIN.tarballIntegrity)
    return {
      ok: false,
      why: `${url} served bytes whose sha512 is ${integrity}, and the pin is ${PIN.tarballIntegrity}`,
    };

  await mkdir(into, { recursive: true });
  const archive = join(into, `${PIN.name}-${PIN.version}.tgz`);
  await Bun.write(archive, bytes);

  const failed = await extract(archive, into);
  if (failed !== undefined) return { ok: false, why: failed };

  await rm(archive, { force: true });
  return { ok: true, path: join(into, PIN.member) };
};

/**
 * Idempotent by content. A destination already holding the pinned bundle is
 * reported `present` without a request; a destination holding anything else is a
 * refusal, because overwriting it would trade one unexplained file for another.
 */
export const vendor = async (directory: string | undefined): Promise<Vendored> => {
  const path = destinationOf(directory);

  if (await Bun.file(path).exists()) {
    const digest = await sha256(await Bun.file(path).arrayBuffer());
    return digest === PIN.bundleSha256
      ? { status: "present", path }
      : {
          status: "refused",
          why: `${path} holds sha256 ${digest}, and the pin is ${PIN.bundleSha256}; delete it or move the canvas to a new directory rather than have this overwrite it`,
        };
  }

  const scratch = join(dirname(path), `.${PIN.name}-vendor`);
  await rm(scratch, { recursive: true, force: true });

  const fetched = await fetchArchive(scratch);
  if (!fetched.ok) return { status: "refused", why: `${tarballUrl()}: ${fetched.why}` };

  const digest = await sha256(await Bun.file(fetched.path).arrayBuffer());
  if (digest !== PIN.bundleSha256) {
    await rm(scratch, { recursive: true, force: true });
    return {
      status: "refused",
      why: `${PIN.member} hashed to sha256 ${digest}, and the pin is ${PIN.bundleSha256}`,
    };
  }

  await mkdir(dirname(path), { recursive: true });
  await rename(fetched.path, path);
  await rm(scratch, { recursive: true, force: true });

  return { status: "vendored", path };
};

if (import.meta.main) {
  const result = await vendor(Bun.argv[2]);
  if (result.status === "refused") {
    console.error(result.why);
    process.exitCode = 1;
  } else {
    console.log(`${result.status} ${result.path}`);
  }
}
