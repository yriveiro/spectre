import { version } from "../tools/definitions/canvas/d3";

/**
 * A maintenance check, not a build gate. Compares the installed d3 against the
 * registry's latest and says whether `bun update d3` is due. A fetch failure
 * is a clear error and an exit of 1, because a check that cannot check must
 * not report success.
 */

const installed = await version();
if (installed === undefined) {
  console.error("d3 is not installed; run `bun install`.");
  process.exitCode = 1;
} else {
  let latest: string;
  try {
    const response = await fetch("https://registry.npmjs.org/d3/latest");
    if (!response.ok) throw new Error(`the registry responded with status ${response.status}`);
    const body = (await response.json()) as { readonly version?: unknown };
    if (typeof body.version !== "string" || body.version.length === 0)
      throw new Error("the registry response has no version");
    latest = body.version;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`could not check the latest d3 version: ${detail}.`);
    process.exitCode = 1;
    latest = "";
  }
  if (latest !== "") {
    if (Bun.semver.order(latest, installed) > 0) {
      console.log(`d3 ${installed} is behind ${latest}; run bun update d3`);
      process.exitCode = 1;
    } else {
      console.log(`d3 ${installed} is current`);
    }
  }
}
