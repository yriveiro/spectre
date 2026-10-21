import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { bundleName, destinationOf, vendor } from "../../scripts/sync-d3";
import { dataRoot } from "../../tools/definitions/canvas/store";

/**
 * The vendor step is the one part of a diagram canvas that cannot be written by
 * hand, so what is under test is where the bytes land and what happens when the
 * bytes are not the pinned ones. Nothing here touches the network: the happy path
 * needs a 279,706-byte download, and every assertion that matters is decidable
 * from the filesystem alone.
 */

const ROOT = join(dataRoot, `d3-test-${process.pid}`);

beforeEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(ROOT, { recursive: true, force: true });
});

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(ROOT, { recursive: true, force: true });
});

describe("where the bundle lands", () => {
  test("a canvas directory gets a vendor folder beside its page", () => {
    // The page is opened from `file://` and a relative classic `src` is the only
    // script load that works there, so the bundle has to sit next to the page
    // rather than at a machine-wide path the page would have to name absolutely.
    expect(destinationOf(ROOT)).toBe(join(ROOT, "vendor", bundleName()));
  });

  test("the filename carries a version, so a page names the bundle it was built against", () => {
    expect(bundleName()).toMatch(/^d3-\d+\.\d+\.\d+\.min\.js$/);
  });

  test("no directory falls back to one machine-wide cache", () => {
    expect(destinationOf(undefined)).toBe(join(dataRoot, "vendor", bundleName()));
  });
});

describe("a destination holding something else", () => {
  test("is refused rather than overwritten", async () => {
    const path = destinationOf(ROOT);
    await Bun.write(path, "not the pinned bundle");

    const result = await vendor(ROOT);

    expect(result.status).toBe("refused");
    expect(await Bun.file(path).text()).toBe("not the pinned bundle");
  });

  test("names the digest it found beside the digest it wanted", async () => {
    await Bun.write(destinationOf(ROOT), "not the pinned bundle");

    const result = await vendor(ROOT);

    expect(result.status === "refused" && result.why).toContain("sha256");
  });
});
