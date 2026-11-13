# Ripwire first

Status: tasks E1 to E15 built. E16 is open.

Ripwire is the first instrument of a session. A code search reaches it before a
file read, the first code read of a session waits for it once, and a landing
carries its two measurements. The plugin teaches the map, reroutes the search,
and records what each session did. It never blocks a second time.

## The decision

One pure function decides. `decide(ask, memory, env)` in
`tools/definitions/search/policy.ts` reads one surface of the host, and returns a
verdict with the next `Memory`. Every hook is a reader plus an applier, so the
policy has one home and no hook holds a rule of its own.

Three parts of the design follow from that shape:

- **Discovery is a prompt attachment.** `session.prompt` attaches the compact
  `ripwire-first` map to the first user prompt of every session, once. The full
  `ripwire` skill stays visible through `autoinvoke: true`, and the short rule
  rides in `session.context` for every request after a compaction.
- **The search surface moves the call.** The plugin renames a code-shaped `grep`
  or a bare shell `rg` to `spectre_search` and rewrites its input, so the model
  gets the answer in the same turn. The plugin teaches the 531 shell calls of the
  finding and never gates them, because most of them are git archaeology.
- **The end of work carries two measurements.** The landing gate refuses the
  first commit, push or PR of a session that holds an unmeasured code edit. It
  asks for `ripwire . --quality-delta` and `ripwire . --affected=`, both after
  the last code edit, and then it steps aside.

Two candidates lost. A rename of `spectre_search` to `spectre_ripgrep` claims
ownership of a host built-in and changes its permission action. A shell deny
costs a turn and answers nothing, because the reroute answers in the same call.

## The surfaces

| Surface | What it reads | What it does |
| ------- | ------------- | ------------ |
| `session.prompt` | whether this session attached the map | attaches `ripwire-first` once |
| `session.context` | the request tools, the code edits, the measurements | writes the rule, and the end-of-work nudge |
| `session.context` | the tool list | narrows `read` and `glob`, and renders `spectre_search` for the probe's health |
| `tool.execute.before` | `grep`, `ripgrep`, shell, `read`, `edit`, `write`, `subagent` | reroutes a search, and refuses a gate once |
| `tool.execute.after` | a completed call | writes the durable usage record |
| `spectre_ripwire_report` | the usage record | names the session and the missing verb |

`spectre_search` stays `codemode: false`. A Code Mode tool is reachable only
through `execute`, and that catalog is the surface that hid the verb names. The
host renders a direct tool in full, beside `ripgrep`, where the choice happens.

## The six flows

### 1. A fresh primary session

```text
session.prompt    attach "ripwire-first" once
session.context   the rule, with search set from the request tools
grep "retry"      reroute -> spectre_search({ pattern: "retry" })
read pkg/retry.ts pass, already-used
edit pkg/retry.ts pass, editedCode 1
git commit        refuse land once
ripwire . --quality-delta         delta 1
ripwire . --affected=pkg/retry.ts affected 1
git commit        pass, measured
```

Prompt delivery gave discovery, the context rule gave the policy, and the tool
gave the answer. The two measurements cleared the landing gate in one round.

### 2. A first read before any search

```text
read src/retry.ts refuse read once
read src/retry.ts pass, gate-spent
```

A refusal never costs more than the search that would have answered it, so the
gate spends once. The second call is native and carries no error.

### 3. A shell search

```text
rg -n resolveTool src          reroute, origin shell
rg -n resolveTool src | head   pass, unmappable
grep { pattern: "resolveTool" } pass, already-asked
```

A pipe, a redirect, a second path or a flag the reader does not know leaves the
command alone. A bare search with one pattern and at most one path moves.

### 4. A session with no ripwire on PATH

```text
probe                absent, with the install line and --doctor
session.prompt       attach (the map teaches the native fallback)
session.context      the rule, plus the native note
grep, read, commit   pass, no-instrument
```

Row 3 of the rule table sits above every gate, so nothing that depends on
ripwire fires when the binary is missing or stale.

### 5. A child session

```text
subagent spawn        pass, subagents 1
child's first prompt  attach once
```

A child is a new context, so it pays for the map once. Two prompts in that child
attach one body.

### 6. A session that changed no code file

```text
edit README.md  pass, editedCode 0
git commit      pass, nothing-edited
```

A doc edit is not a code edit. It never asks for a measurement and it never
blocks a landing.

## The rule table

First match wins, in `decide`. Rows 0 to 3 sit above every other row.

| # | Surface and condition | Verdict |
| - | --------------------- | ------- |
| 0 | prompt · not attached, and the skill is present / attached / skill absent | attach / pass `already-attached` / pass `no-skill` |
| 1 | context · a code edit with no fresh measurement | prose `end-of-work`, then the rule |
| 2 | context · otherwise | the rule alone, and `search` from the request tools |
| 3 | any other surface · ripwire absent or stale | pass, `no-instrument` |
| 4 | text · `literal: true` | pass, `plain-text` |
| 5 | text · pattern under 3 characters | pass, `too-broad` |
| 6 | text · a plain extension in the path or the include | pass, `plain-text` |
| 7 | text · a newline in the pattern | pass, `plain-text` |
| 8 | text · this pattern was asked before | pass, `already-asked` |
| 9 | text · a phrase with a code token / with a metacharacter / with neither | reroute task / reroute regex / pass `plain-text` |
| 10 | text · no metacharacter / a metacharacter | reroute literal / reroute regex |
| 11 | text · the request holds no `spectre_search` | pass, `search-unavailable` |
| 12 | shell · a command this reader does not know | pass, `not-a-search` |
| 13 | shell · a pipe, a redirect, `;`, `&&`, `$(`, a backtick, `-e`, `-f`, an unknown flag, or more than one path | pass, `unmappable` |
| 14 | shell · pattern under 3 characters | pass, `too-broad` |
| 15 | shell · a plain extension in the path, the include or the pattern | pass, `plain-text` |
| 16 | shell · this pattern was asked before | pass, `already-asked` |
| 17 | shell · the request holds no `spectre_search` | pass, `search-unavailable` |
| 18 | shell · one pattern and at most one path | reroute, origin `shell` |
| 19 | shell · a `ripwire` lookup | pass, `not-a-search`, and the two measurement flags count |
| 20 | shell · a landing command with no code edit / a spent gate / a fresh measurement | pass `nothing-edited` / pass `gate-spent` / pass `measured` |
| 21 | shell · `git commit`, `git push`, `gh pr create`, `git merge`, `git rebase --continue` | refuse `land` once |
| 22 | read · not code, outside the root, after a lookup, after a pass, after an edit, or the gate spent | pass with that reason |
| 23 | read · the first code read of a session, with no lookup | refuse `read` once |
| 24 | edit, write, subagent, a completed search | pass, observe only |

`Memory` holds the session state: the attach bit, the search bit, the lookups,
the asked patterns with their outcome, the reads, the edited paths, the code
edit count, the two measurements, the gates already spent, and the subagent
count. `remember` is the only writer.

A measurement records the code-edit count it ran at, so `fresh` is a comparison
of two integers and not a timestamp. A delta older than the last code edit does
not count, and a doc edit does not invalidate it.

## The enforcement table

| Surface | Verdicts | Fallback | Test row |
| ------- | -------- | -------- | -------- |
| `session.prompt` | attach, pass | a missing skill id gives `no-skill`; a second prompt attaches nothing | `test/search/attach.test.ts` "two prompts, one body; a child attaches once" |
| `session.context` | prose, pass | a defect is logged and the request stays unchanged | `test/search/catalogue.test.ts` "the rule once, and the shape of the tools" |
| `grep`, `ripgrep` | reroute, pass | every pass leaves the native call unchanged | `test/search/guard.test.ts` "both ids, plain text, too broad, already-asked, absent" |
| shell `rg`, `git grep`, `grep` | reroute, pass | a pipe, a metacharacter or a second path passes | `test/search/shell.test.ts` "bare `rg` reroutes; `rg | head` passes" |
| shell landing | refuse once, pass | no code edit, gate spent, measurement fresh | `test/search/land-gate.test.ts` "doc only passes; delta only refuses; both fresh passes" |
| `read` | refuse once, pass | not code, outside root, lookup, pass, edit, gate spent | `test/search/read-gate.test.ts` "a README passes; the first code read refuses; the second passes" |
| shell `ripwire` | pass, observe | `--help` and `--version` count nothing | `test/search/land-gate.test.ts` "the two flags record the code-edit count" |
| `edit`, `write` | pass, observe | no gate; the record is the only output | `test/search/measure.test.ts` "mutation counts and the record holds the path" |
| `subagent` | pass, observe | no gate; the count feeds the report | `test/search/measure.test.ts` "a child is counted; a follow-up is not a new child" |
| `spectre_pr` | no row | `execute.before` sees `execute`, not `spectre_pr` | `test/pr/compose.test.ts` "each measurement gets its own validation row" |

The shell row is a tool rename on `tool.execute.before`, not a rewrite in
`shell.create.before`, because that hook cannot fail. The rename asserts the
`shell` action and the `read` action, since the renamed tool will run a read.

## The capability table

| Verb | Enforced or taught | Entry point |
| ---- | ------------------ | ----------- |
| `--for` | enforced, on the search surface | `spectre_search({ query })`, and the phrase reroute from `grep` or a shell |
| `--grep` | enforced, on the search surface | `spectre_search({ pattern })`, and the literal reroute |
| `--regex` | enforced, on the search surface | `spectre_search({ pattern, kind: "regex" })` |
| `--quality-delta` | enforced, the act | the landing gate asks for it after the last code edit |
| `--affected` | enforced, the act | the landing gate asks for it after the last code edit, and prints the paths it watched |
| `--impact` | taught | the `ripwire-first` map row; no hook can name the symbol a change is about |
| `--callers` | taught | the same row; the answer points back at `spectre_search` |
| `--edit-check` | taught | the map row and the landing message, because the hook cannot name the symbol |
| `--exemplar` | taught | the map row before a new symbol; the report records whether it ran |
| `--stray-content` | taught | the branch-cleanup row |
| `--whereis` | taught | the branch-cleanup row, beside `--stray-content` |
| `--doctor` | taught, and surfaced by the probe | the `absent` and `stale` notes, and the map row |
| `--pack-task --partition` | taught | the fan-out row; the report measures it against the subagent count |
| `--recall` | taught | the session-memory row; the plugin cannot form the task query |

No row claims that a hook enforces a verb it cannot see. The landing gate
enforces that the two commands ran after the last change. It does not claim the
report was correct. `--edit-check` is the one verb a reviewer will ask about, and
the answer is prose: the hook sees an edit to a path, not the symbol whose
contract changed.

## What the gates do not do

Both gates refuse one time. After that refusal they are advisory by design,
because a blocked model must be able to continue and land. This is the F5
finding from the slice 3 crosscheck, and it stays a decision rather than a
defect: the plugin has no measurement of a report's quality, so a second refusal
would block on something it cannot check.

The gate checks the act, not the answer. A model can run
`ripwire . --quality-delta` and ignore the output, and the gate passes. The
usage record and the report name that case for a human instead.

`--affected` carries a value the model chooses. The gate does not compare that
value to the code-edit set. A later version can, because the record already holds
both.

## The task list

| # | The state it reached | Where it lives |
| - | -------------------- | -------------- |
| E1 | one pure `decide` over `Ask`, `Memory` and `Env` | `policy.ts`, `test/search/policy.test.ts` |
| E2 | one `Memory`, one `remember`, one reroute map, caps kept | `state.ts`, `test/search/state.test.ts` |
| E3 | pure readers for prompt, context, text, shell, read, mutate, subagent, completion | `signals.ts`, `test/search/signals.test.ts` |
| E4 | one applier per verdict; `context.ts` and `guard.ts` gone | `apply.ts`, `catalogue.ts`, `test/search/apply.test.ts` |
| E5 | the map attached once per session, child included | `apply.ts`, `test/search/attach.test.ts` |
| E6 | the compact map skill, registered and not a leaf | `skills/definitions/ripwire-first/`, `test/skills/ripwire-first.test.ts` |
| E7 | the full `ripwire` skill visible in every request | `skills/definitions/ripwire/index.ts`, `test/skills/ripwire-map.test.ts` |
| E8 | both text ids reroute, a bare shell search reroutes, the rest passes | `apply.ts`, `policy.ts`, `signals.ts`, `test/search/guard.test.ts`, `test/search/shell.test.ts` |
| E9 | the first code read without a lookup refuses once | `apply.ts`, `policy.ts`, `test/search/read-gate.test.ts` |
| E10 | the landing gate: one refusal, then the two measurements | `apply.ts`, `policy.ts`, `signals.ts`, `test/search/land-gate.test.ts` |
| E11 | the `execute.after` usage record, durable and bounded | `measure.ts`, `test/search/measure.test.ts` |
| E12 | `spectre_ripwire_report` names the session and the missing verb | `report.ts`, `test/search/report.test.ts` |
| E13 | the goal contract, the two playbooks and the PR template name both measurements | `goal/contract.ts`, `playbook-autonomous-run`, `playbook-opening-a-pr`, `pr/fields.ts`, `test/goal/contract.test.ts`, `test/pr/compose.test.ts` |
| E14 | one decision in the docs, and the old feature note points here | this file, `ripwire-search.md`, `features/README.md` |
| E15 | one integration test over every decision row, with the absent-binary fallback | `test/ripwire-first.test.ts` |
| E16 | the change lands as one reviewable PR with both measurements in the body | not built |

## Open questions

- Does the map alone move the first-touch rate, or is the read gate the only
  lever? The four eval arms answer it.
- Does the shell parser survive aliases and shell functions? It cannot see them.
  The question is whether it misses a search that matters.
- Does the `grep` request rename land in every provider and Code Mode setting?
  The host code says yes. No scripted model proves it yet.
- Should `--pack-task --partition` become a hard gate at the third subagent
  call? The false-positive cost is a fan-out of two.
