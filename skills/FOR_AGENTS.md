# Working on `skills/`

Read this before adding or changing a skill definition.

## Skill tiers and counts

`skills/definitions/index.ts` exports 85 skill definitions partitioned by `catalog: SkillCatalog` (`skills/definitions/definition.ts`):

- **Push leaves (32):** 28 `principle-*` skills plus `code-hygiene`, `grammar`, `model-router`, and `look-first`. Each declares `tier: "push"`, `group: "leaf"`, and a single-line `trigger`.
- **Push communication (1):** `communication` (`tier: "push"`, `group: "communication"`).
- **Hubs (3):** `spectre-mode`, `playbook`, and `ripwire` (`tier: "hub"`).
- **Pull skills (49):** 25 `playbook-*`, 6 `design`, 6 `writing`, 5 `stack`, 4 `verification`, and 3 `visual` (`tier: "pull"`).

`skills/definitions/index.ts` derives `notALeaf` automatically from `!(tier === "push" && group === "leaf")` (53 ids). `skills/catalog.ts` embeds the 33 push triggers into `agents/definitions/spectre.ts` within a `1,500`-token budget, and `tools.spectre.skills` indexes all 85 skills for BM25 lookup. Do not maintain duplicate skill index tables in Markdown.

`load()` scans `skills/definitions/*/SKILL.md` at startup and throws if any folder is missing from `skills/definitions/index.ts`. Only `ripwire` declares `autoinvoke: true` (`skills/index.ts` switches it to `false` when no `ripwire` binary exists). The other 84 definitions declare `autoinvoke: false`.

## Three body shapes

Pick the shape that matches the skill's job:

- **Principle leaf:** states a test and a moment to load it. Use the template below.
- **Procedure or playbook:** runs ordered steps or phases (`Start` / `Phase A` ... `Outputs`, or a single `Steps` section). A `The moves` list that reads like sequential steps belongs in a procedure.
- **Compact leaf:** one heading with no `##` sections when the body is short (for example, `principle-guard-the-context-window`).

### Principle body template

```markdown
# Principle: <Name>

<Three to five sentences: what the principle is, why it exists, and what it sits beside.>

## The moves

**A move, stated once.** Concrete enough to act on. Place commands and literal file names here.

## What this principle is not

- **Not <the over-application>.** <Why it is wrong.>
```

- Keep `## The moves` flat. Do not split one claim across altitude headings (`Core values`, `Strategies`, `Tactics`).
- Omit `## What this principle is not` unless a bullet blocks a real mistake that the positive text does not prevent.
- Name the owner in one clause when another leaf owns a claim instead of restating it.

## Description and routing rules

`description` in `index.ts` is the routing surface. Follow three rules:

1. **Name the moment, not the doctrine.** Open with what the prompt looks like ("a boolean and a flag that must stay in sync", "one caller", "flatten it"), not abstract principle vocabulary.
2. **Keep literal nouns and artefacts.** Prompts name concrete files and objects (`README`, `package.json`, `tsconfig.json`). Replacing them with generic phrases drops recall.
3. **Never borrow a neighbour's vocabulary.** A handoff clause using another leaf's keywords steals its prompts. Keep each leaf sharp because near-synonymous leaves degrade routing across the whole set.

## Checklist for a new or edited leaf

- **Register it** in `skills/definitions/index.ts` with a valid `catalog` entry (`test/skills/catalog.test.ts` checks the partition, trigger lengths, token cap, and blind-slice four-word bar).
- **Add its row in `skills/definitions/ripwire/SKILL.md`** naming the ripwire verb or `none.` plus the floor. Update the spelled-out `none` word count in `skills/definitions/spectre-mode/SKILL.md` (`names the ... leaves with no instrument`) when the `none.` count changes. `test/skills/ripwire-map.test.ts` checks both and validates every `--flag` against `ripwire --help` (lines containing `deprecat` are exempt).
- **Check `description` and eval rows.** `test/skills/routing.test.ts` rejects blank descriptions and checks BM25 AUC floors. Add judged and `neg` rows in `eval/fixture.ts` (`eval/tests/fixture.test.ts` rejects blind rows that quote the leaf's own description).

## Porting a skill from elsewhere

1. **Claim only unowned ground.** Keep only what existing leaves do not cover, and cite owners for the rest.
2. **Meet the leaf checklist** if you add a leaf (`ripwire/SKILL.md` row, `catalog` entry, `eval/fixture.ts`).
3. **Do not import a mode or workflow as a principle leaf.** Register procedures under `tier: "pull"` instead so they do not bloat the push trigger surface. `features/arena.md` reserves the `arena` name for an unbuilt feature. If that feature ships, the `arena` skill gives way.
4. **Measure on the blind slice and per-skill table.** Run `eval/` (see `eval/README.md`). Never quote single-session numbers without naming the corpus and slice, and watch per-skill regressions rather than the whole-set average.

`ripwire --eval-skills` reads YAML frontmatter from `SKILL.md`, while OpenCode reads `description` from `index.ts`. `eval/mirror.ts` generates a temporary mirror from the live definitions so both stay in sync.
