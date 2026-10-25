/**
 * The versions `solidjs-best-practices/SKILL.md` and its references were checked
 * against, and the date the check ran.
 *
 * Solid has two live lines: stable `solid-js` 1.9 and the 2.0 release candidate.
 * They do not share an API, a JSX import source, or a DOM package. SolidStart is a
 * third axis: `@solidjs/start` 2.x is stable and still runs Solid 1.x. A claim in
 * this skill is therefore a claim about one cell of that matrix, and this module is
 * where each cell is written down.
 *
 * A refresh moves these strings, re-reads the sources named in
 * `references/sources-and-maintenance.md`, and re-runs
 * `scripts/typecheck-examples.ts` against the same versions. Do not move a string
 * without doing both: a stale stamp is how a body starts describing an API nobody
 * installs.
 */
export const VERIFIED = {
  checked: "2026-10-25",
  solid: {
    stable: "1.9.17",
    next: "2.0.0-rc.18",
    v1Beta: "1.10.0-beta.0",
  },
  web: {
    next: "2.0.0-rc.18",
  },
  router: {
    stable: "1.0.0",
    next: "2.0.0-next.42",
  },
  meta: {
    stable: "0.29.4",
    next: "1.0.0-next.2",
  },
  start: {
    v1: "1.4.0",
    v2: "2.1.0",
  },
  vitePluginSolid: {
    stable: "2.11.14",
    next: "3.0.0-next.27",
  },
  solidVitePlugin: {
    next: "3.0.0-next.51",
  },
  testingLibrary: {
    stable: "0.8.10",
    next: "1.0.0-rc.2",
  },
} as const;

export type Verified = typeof VERIFIED;
