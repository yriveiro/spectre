import { afterAll } from "bun:test";

/**
 * A temp directory that the suite cleans up.
 *
 * Four suites each rolled this, and the copies drifted: one carried a label into the path, one
 * did not, one cleaned up and one did not. `ripwire --quality-delta` grouped them as a clone of
 * a reused helper, which is the cost of the fourth copy.
 *
 * The prefix names the suite so a directory left behind by a killed run is attributable. The
 * `process.pid` and the counter keep two suites and two tests inside one run from colliding.
 *
 * `afterAll` rather than `afterEach` on purpose: a suite that builds one directory in
 * `beforeAll` would otherwise delete it between its own tests.
 *
 * The trailing slashes come off `TMPDIR` because it carries them on macOS, and a path with
 * `T//spectre` in it is a different string from the one a test asserts on. `test/brain/ledger.test.ts`
 * was the suite that noticed, by comparing a minted note's path against the root it was given.
 */
const TMP = (Bun.env.TMPDIR ?? "/tmp").replace(/\/+$/, "");
let seq = 0;

export const useTempDirs = (prefix: string) => {
  const roots: Array<string> = [];

  const dir = (label?: string): string => {
    const named = label === undefined ? "" : `-${label}`;
    const root = `${TMP}/spectre-${prefix}${named}-${process.pid}-${seq++}`;
    roots.push(root);
    return root;
  };

  afterAll(async () => {
    for (const root of roots) await Bun.$`rm -rf ${root}`.quiet();
  });

  return dir;
};