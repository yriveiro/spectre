# Sources, provenance and maintenance

## Verification record

| Field | Value |
| --- | --- |
| Checked on | **2026-10-25** |
| Stable Solid | `solid-js@1.9.17` (2026-10-07) |
| Solid release candidate | `solid-js@2.0.0-rc.18` (2026-10-23) |
| Solid 1.x beta | `1.10.0-beta.0` (2026-01-26), not the supported line |
| Web runtime | `@solidjs/web@2.0.0-rc.18` |
| SolidStart 1 | `@solidjs/start@1.4.0` (2026-10-15) |
| SolidStart 2 | `@solidjs/start@2.1.0` (2026-10-22) |
| Solid Router | `1.0.0` (2026-07-28), next `2.0.0-next.42` (2026-10-22) |
| Solid Meta | `0.29.4`, next `1.0.0-next.2` |
| Vite plugin, Solid 1 | `vite-plugin-solid@2.11.14` |
| Vite plugin, Solid 2 | `@solidjs/vite-plugin@3.0.0-next.51` |
| Testing library | `0.8.10`, next `1.0.0-rc.2` |

The machine-readable copy of this table is `verified.ts`. If the two disagree, `verified.ts` is stale and the table in this file is what a reader last checked.

## Stable and experimental

| Surface | Status | What that means |
| --- | --- | --- |
| `solid-js@1.9.x` | **stable** | the default for production work |
| `solid-js@2.0.0-rc.x` | **release candidate** | usable, but the API can move before 2.0.0 |
| `solid-js@1.10.0-beta.x` | **beta** | not a migration target. Do not select it |
| `@solidjs/start@2.x` | **stable** | runs Solid 1.9 only, does not support Solid 2 |
| `@solidjs/start@1.x` | **legacy** | Vinxi and Nitro 2. Maintain, do not start |
| `@solidjs/vite-plugin` 3 start mode | **experimental** | the Solid 2 fullstack path, not SolidStart |
| `@solidjs/router@2.0.0-next.x` | **pre-release** | required by Solid 2. Not compatible with Solid 1 |
| `@solidjs/meta@1.0.0-next.x` | **pre-release** | required by Solid 2. Not compatible with Solid 1 |
| `@solidjs/testing-library@1.0.0-rc.x` | **release candidate** | required by Solid 2 |
| `@solidjs/web@latest` | **stale** | points at `2.0.0-rc.0`. Use `next` or the exact RC |

A version label in this skill always names one of these rows. "Solid 2" without a qualifier means the release candidate, never the stable line.

## Sources

### Registry and package contents

| Source | Used for |
| --- | --- |
| `https://registry.npmjs.org/solid-js` | dist-tags, publish dates, the exact stable and RC versions |
| `https://registry.npmjs.org/@solidjs%2Fweb` | the stale `latest` tag and the `next` RC |
| `https://registry.npmjs.org/@solidjs%2Fstart` | Start 1, Start 2, and the peer ranges |
| `https://registry.npmjs.org/@solidjs%2Frouter` | router lines and their Solid peers |
| `https://registry.npmjs.org/@solidjs%2Fmeta` | meta lines and their Solid peers |
| `https://registry.npmjs.org/@solidjs%2Fvite-plugin` | the Solid 2 build plugin |
| `https://registry.npmjs.org/vite-plugin-solid` | the Solid 1 build plugin |
| `https://registry.npmjs.org/@solidjs%2Ftesting-library` | the test library lines |

This review unpacked and read the tarballs, not only the registry metadata. The files that carry API claims are:

- `solid-js@2.0.0-rc.18`: `CHEATSHEET.md`, `skills/solid-2.0/SKILL.md`, `types/`
- `solid-js@1.9.17`: `types/`
- `@solidjs/web@2.0.0-rc.18`: `types/`, `package.json` exports
- `@solidjs/start@1.4.0` and `@solidjs/start@2.1.0`: `package.json` peer dependencies
- `@solidjs/router@1.0.0` and `2.0.0-next.42`: `package.json` peer dependencies

### Official documentation

| Source | Used for |
| --- | --- |
| `https://docs.solidjs.com` | Solid 1.9 concepts, reference, lifecycle, stores, control flow |
| `https://docs.solidjs.com/solid-start` | SolidStart 1 |
| `https://docs.solidjs.com/solid-start/v2` | SolidStart 2, including routing, data, mutation, serialization, middleware, sessions, security |
| `https://docs.solidjs.com/solid-router` | router queries, actions, preload, response helpers |
| `https://v2.solidjs.com` | Solid 2.0 concepts, reference, guides, migration |
| `https://v2.solidjs.com/llms.txt` and `/llms-full.txt` | the machine-readable docs index |
| `https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md` | the authoritative 1.9 to 2.0 API map |
| `https://github.com/solidjs/solid-vite-plugin` | `@solidjs/vite-plugin` start mode |
| `https://github.com/solidjs/templates` | the `solid-v2` and `solid-start-v1` project shapes |

### Version compatibility

This review read peer dependencies from the published manifests. The load-bearing rows:

| Package | Peer |
| --- | --- |
| `@solidjs/start@2.1.0` | `solid-js ^1.9.15`, `@solidjs/router >=0.16 <2.0.0-0`, Vite `^8 \|\| ^9`, Node `>=24` |
| `@solidjs/start@1.4.0` | `vinxi ^0.5.7` |
| `@solidjs/router@1.0.0` | `solid-js ^1.8.6` |
| `@solidjs/router@2.0.0-next.42` | `solid-js ^2.0.0-rc.17`, `@solidjs/web ^2.0.0-rc.17` |
| `@solidjs/meta@0.29.4` | `solid-js >=1.8.4` |
| `@solidjs/meta@1.0.0-next.2` | `solid-js ^2.0.0-rc.0`, `@solidjs/web ^2.0.0-rc.0` |
| `vite-plugin-solid@2.11.14` | `solid-js ^1.7.2`, Vite `^3` to `^9` |
| `@solidjs/vite-plugin@3.0.0-next.51` | `solid-js ^2.0.0-rc.16`, `@solidjs/web ^2.0.0-rc.16` |
| `@solidjs/testing-library@0.8.10` | `solid-js >=1.0` |
| `@solidjs/testing-library@1.0.0-rc.2` | `solid-js >=2.0.0-0`, `@solidjs/web >=2.0.0-0` |

A peer range is the first check. It is not proof that two packages work together. The second check is a compile of the example against the exact versions, and the third is a runtime test.

## How each claim class was checked

| Claim | Check |
| --- | --- |
| a version exists | registry dist-tags and publish dates |
| two packages are compatible | peer dependencies from the published manifest |
| an export exists | the package's `types/` directory and, for behavior, a compiled probe |
| an API was removed or renamed | `MIGRATION.md` plus the v2 reference page for the replacement |
| a SolidStart option exists | the v2 config reference page and the published type |
| a hydration warning exists | the v2 SSR guide, which names each message |
| a compiler rejects a form | `MIGRATION.md` and the v2 JSX reference |
| an example compiles | `scripts/typecheck-examples.ts` against the pinned versions |

The [Limitations](#limitations) section lists claims that this review did **not** verify at runtime.

## Refresh runbook

Run this when a dist-tag moves, not on a schedule.

### 1. Read the tags

```sh
for p in solid-js @solidjs/web @solidjs/start @solidjs/router @solidjs/meta @solidjs/testing-library @solidjs/vite-plugin vite-plugin-solid; do
  echo "== $p"
  curl -s "https://registry.npmjs.org/$(echo "$p" | sed 's|/|%2F|')" \
    | bun -e 'const j = await Bun.stdin.json(); const t = j["dist-tags"] ?? {}; for (const k of ["latest","next","beta"]) if (t[k]) console.log(k, t[k]);'
done
```

### 2. Read the peers of every package you might recommend

```sh
curl -s "https://registry.npmjs.org/@solidjs%2Fstart" \
  | bun -e 'const j = await Bun.stdin.json(); const v = j["dist-tags"].latest; console.log(v, j.versions[v].peerDependencies);'
```

Do this for `solid-js`, `@solidjs/web`, `@solidjs/router`, `@solidjs/meta`, `@solidjs/start`, and the two Vite plugins.

### 3. Read the changelog or migration note

- Solid core: `https://github.com/solidjs/solid/releases`
- Solid 2: `MIGRATION.md` at the `next` branch
- SolidStart: `https://github.com/solidjs/solid-start/releases`
- Router: `https://github.com/solidjs/solid-router/releases`

### 4. Diff the docs

Fetch `https://v2.solidjs.com/llms-full.txt` into the scratch directory and compare it with the previous copy. The diff is the list of pages that changed. Read only those pages. For SolidStart, compare the v2 reference pages in the same way.

### 5. Compile the examples

```sh
bun skills/definitions/solidjs-best-practices/scripts/typecheck-examples.ts
```

A compiler error names the symbol that moved. Fix the example, then the reference that quotes it.

### 6. Move the stamp last

Update `verified.ts` and the table at the top of this file in the same commit. Then update:

- the Provenance paragraph in `SKILL.md`
- the version table in `references/version-gate.md`
- any line in `references/solid-v1.md` or `references/solid-v2.md` that names a version
- `test/skills/solidjs-best-practices.test.ts`, which asserts the stamp

### 7. Run the checks

```sh
bun run typecheck
bun test test/tools/solidjs.test.ts
bun test test/skills/solidjs-best-practices.test.ts
bun skills/definitions/solidjs-best-practices/scripts/typecheck-examples.ts
```

The tool tests carry the fixture matrix, so a version refresh re-runs the detector and audit against every shape the skill supports. A green typecheck with a stale stamp is the failure mode this runbook exists to prevent. Do not move the number without reading the source.

## How this skill treats a version it cannot determine

`tools.spectre.solidjs({ action: "detect" })` reports one of `solid-1`, `solid-2`, `mixed`, `unknown`.

| Mode | Action |
| --- | --- |
| `solid-1` | use `references/solid-v1.md` |
| `solid-2` | use `references/solid-v2.md` |
| `mixed` | stop. Report the conflicting dependencies and ask which line is the target. Do not write code until the matrix is coherent |
| `unknown` | ask for `package.json` or the lockfile. Do not guess, and do not write code that compiles on both lines by avoiding the API surface, because that produces a lowest-common-denominator component |

The detector reports `mixed` and `unknown` as stop states. That is deliberate: a detector that guesses is worse than one that stops.

## Candidate review

This review covered two public skills before it designed this one.

### `khmm12/solidjs-v2-skills`

- Three skills and nine references, plus an evaluation harness.
- Pinned to `solid-js@2.0.0-rc.8`. That is ten release candidates behind `rc.18`, and several APIs changed in between.
- The evaluation results are self-reported and were not reproducible from the repository alone.
- **No LICENSE file.** The repository therefore grants no reuse rights.

### `doeixd/solid-skill`

- Four skills.
- Describes Solid 2 as "beta". It is a release candidate, and the stable line is 1.9.
- **No LICENSE file.**
- Concrete errors found:
  - `<For keyed={false}>` example calls `i()` although `i` is a plain number.
  - `setOptimisticTodos((list) => list.push(...))` returns a number and can replace the store root.
  - A `createSelector` migration example hand-rolls `draft._prev`.
  - The SolidStart v2 skill does not clearly state that Start v2 runs Solid 1.

### What was reused

The design reused only ideas and independently verified facts. Three examples are the folder layout of "one entry skill plus references", the value of a version gate, and the need for an anti-pattern catalogue. It copied no prose, code, or test. Every claim in this skill came from the sources above.

### What was rejected

- A separate SolidStart skill. It would duplicate the version gate and invite the reader to load the framework skill before the core skill. One entry point plus `references/ssr-and-solidstart.md` is smaller and harder to misuse.
- A pin to a candidate's RC version. The skill names the current RC and dates the claim.
- Copying candidate examples. Several are wrong, and none carry a license.

## Limitations

| Limitation | Consequence |
| --- | --- |
| Solid 2 is an RC | its API can change before 2.0.0. The skill is a snapshot, not a guarantee |
| No runtime test of every example | `typecheck-examples.ts` proves types, not behavior. The anti-patterns that depend on runtime behavior cite the official guide or diagnostic that defines it |
| Hydration warnings were not reproduced in a browser for every message | the messages and their meanings come from the official SSR guide |
| SolidStart deployment was not exercised against a host | deployment guidance names the mechanism and the official page, not a tested configuration |
| Candidate repositories have no license | no text or code was reused. The findings above are statements of fact about public code |
| `@solidjs/web@latest` is stale | an install without an explicit tag can resolve to `rc.0`. The version gate checks the resolved version, not the tag |
| Separate framework layers move independently | a router or meta release can raise its Solid peer without a core release. Re-read the peers on every refresh |

When a claim cannot be checked, the reference says so and names the source that would settle it. Do not upgrade an uncertainty into an assertion because a sentence reads better.
