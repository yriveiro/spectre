# Playbook authoring a skill

Write or cut down a SKILL.md. This playbook is about the voice and the length,
not about what the skill should say: that call is yours, made before you open
the file. A skill is a decision somebody does not have to make again.

## Start

1. Fix the shape
2. Cut
3. Place the reason
4. Point at structure
5. Check
6. Hand the leaf over

## Phase A: Fix the shape

Every leaf here is a folder with two files: `index.ts` and `SKILL.md`. Nothing
else belongs inside it, and a definition that is one file still gets a folder
with one file in it.

`index.ts` is the declaration, the thing the parent imports. It carries the id,
the name, the description, and the anchor. Nothing above the definitions
directory reaches for its internals, so a second file there is a signal that the
boundary is wrong rather than permission to add one.

`SKILL.md` is either a **principle** or a **procedure**, and picking the wrong
one is the mistake that costs the most. A principle states a test and a moment
you load it on. A procedure is a sequence of phases. A procedure wearing a
principle's template has a `The moves` list that is really a step list, and a
principle wearing a procedure's phases has phases that are really claims.

Read `skills/FOR_AGENTS.md` before writing either. It holds the template and the measurements behind it, and it is the only place that knows which leaf already owns a claim.

## Phase B: Cut

**When in doubt, delete.** The test for every paragraph: does it change a
decision? A rule that is explained but not obeyed is a rule, and a paragraph
that only says why the rule is reasonable is a comment about the rule.

Tell the reader to do the thing and skip the reason. Keep the reason only where
the rule is confusing without it — the counter-intuitive claim, the one a
competent reader would get wrong.

Do not restate a claim another leaf owns. Name the owner in a clause and move
on. A claim written twice is a claim that will be updated once.

Match tone to scope. A leaf about a comment's punctuation is written differently from one about a call graph.

## Phase C: Place the reason

The description is the routing surface, so it is the most important sentence in
the folder and the one most often written wrong. It names the **moment**, not
the subject: a real prompt's words, not the principle's vocabulary. "Hard to
follow", "just forwards", "one caller" route; "reader load" does not.

Then check it by asking whether a real prompt's words appear in it. If they do
not, the description is about the wrong thing.

One word for each action, keep the articles, and avoid an `-ing` form where a
plain verb does the work. `grammar` is the pass for all of this and it is not
optional on a leaf.

## Phase D: Point at structure

Send the reader to the structural source rather than transcribing it: a type, a
config key, a README, the neighbouring file. A leaf that restates a signature
goes stale at the next refactor and lies quietly until somebody trusts it.

Delegate by path. Name the skill that owns a topic and let that leaf carry the
claim.

A workflow you have run three times and cannot find written down is the input
to a new leaf. Say so to the user rather than quietly adding one: a leaf nobody
asked for is a leaf nobody will read.

## Phase E: Check

Structural checks, and they are cheap:

- The folder holds `index.ts` and `SKILL.md`, and nothing else.
- `index.ts` imports `anchor` from `../definition` and points it at
  `import.meta.dir`.
- Every path the body names exists. `tools.spectre.comments` takes those paths
  and returns the comments and suppressions in each, so a wrong path comes back
  empty rather than being asserted — an unexpected empty is a wrong path.
- The body is registered in `skills/definitions/index.ts`. The loader dies when
  a folder holds a body it does not list, so a new leaf that is not registered
  takes the whole set down at startup.
- The description names a moment, and a reader can tell from it when *not* to
  load the leaf.

Write test cases when the skill is structural, and skip them when the claim is
subjective. A procedure with phases has a first phase you can check is the right
first phase; a principle about prose does not.

Do not run the typecheck or the tests as part of authoring. They are the change
that opened the pull request's job, not this one's.

## Phase F: Hand the leaf over

Open the pull request through `playbook-opening-a-pr`: small commits, a
Conventional Commit title, a body that says what the leaf now claims and what it
no longer says. Write the diff note for a reviewer who is deciding whether the
leaf still earns its place.

## Outputs

What the skill is for, the design decisions that were not obvious, what was cut
and why, and the result of the Phase E checks.
