Re-align `skills/definitions/effect-best-practices/SKILL.md` with the installed Effect.

Run the steps in order. Do not skip to editing the body, because the failure this repairs is
almost always a symbol that moved and not a sentence that reads wrong.

## 1. Establish what changed

Read the pin and the installed build, then read the stamp:

```sh
grep '"effect"' package.json
grep '"version"' node_modules/effect/package.json
cat skills/definitions/effect-best-practices/verified.ts
```

A pin that moved with a stamp that did not is the case this command exists for. A pin that
matches its stamp means nothing to do: say so and stop.

## 2. Let the compiler find the moved symbols

`probe.ts` uses every Effect symbol the body names, so the compiler names whatever the new
version broke:

```sh
bun run typecheck
```

Work from its errors rather than from memory of the old API. For each one, open the installed
declaration and read it, because the declaration carries its own worked example and that
example is the spelling to copy:

```sh
grep -n '<symbol>' node_modules/effect/dist/<Module>.d.ts
```

A signature that moved, a curried call whose arity changed, and an export the new version
renamed are the three failures worth expecting. A declaration that no longer exists means the
symbol went away, and the body has to teach its replacement rather than keep the old name.

## 3. Fix the body, then the probe, in that order

The body is what a reader reaches for. `probe.ts` exists to check the body, so it follows it
and never leads it. When a symbol has a new spelling, both move together.

Keep the body's shape. It is `Start`, eight phases, `Outputs`, and each phase is a decision
with the code that shows it. Teach the version you have in front of you and nothing else: the
body does not carry a history of what the API used to be called, and a near-miss the reader
will meet is worth a `principle-evidence` lookup rather than a paragraph here.

## 4. Move the stamp last

Only after the body and the probe compile against the new build:

```sh
# in skills/definitions/effect-best-practices/verified.ts
export const VERIFIED = { opencode: "<the version OpenCode now ships>", effect: "<the pin>" };
```

`opencode` follows what OpenCode ships, so read the tag rather than assuming it tracks the
release. `test/skills/effect-version.test.ts` compares both fields, and the body must contain
the effect version as a literal for the third check to pass.

## 5. Prove it

```sh
bun run typecheck
bun test test/skills/effect-version.test.ts
bun test
```

A green suite that was never red proves nothing here, so break the stamp on purpose once, watch
the version tests fail, and put it back. Then report what moved and what the body now says.