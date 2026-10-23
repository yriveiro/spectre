# Playbook opening a PR

Turn finished work into pull requests a reviewer can land. Every other playbook
ends here, and this one does not go on to babysit or ship.

## Start

Open a `todolist` with one entry per phase before the first push.

1. Worktree
2. Commits
3. Split
4. Parallel preparation
5. Title and body
6. Stack
7. Open
8. Handover

## Phase A: Worktree

Never edit the main checkout, and never cut a branch to get there. The branch
comes with the worktree:

```ts
await tools.spectre.worktrees({ action: "start", name: "fix-login" })
```

That is the only way to open one. `git worktree add` is not the fallback for a
refusal, and the reason is what it leaves behind: it creates the directory and
**leaves this session standing in main**, so the work goes on where you were and
the new directory sits beside it unused. A refused call has cost you nothing, so
read it and call again.

The call moves this session, so it refuses rather than guess. `problems` names
the rule and the answer:

| `problems` says | Do this |
| --------------- | ------- |
| this session is not in the main worktree | Move this session to the `main` worktree it names, and call again. One worktree per session: a session already in one works where it is. |
| this call has no session | The call has nothing to move. Open a session in the main worktree and call again. |
| the branch already exists | If a worktree holds it, work in that directory. If none does, pass it as `branch`: the worktree is cut from that branch and this session moves in. |
| the name is taken | A worktree by that name exists and the host would silently create `<name>-2`. Pick another name. |
| no base ref resolved | `git fetch`, or pass `base` explicitly. A `branch` that already exists does not need one. |

Only `status: "opened"` means a worktree is ready, and it means this session is
in it. `unverified` left the directory on disk and did **not** move you: read
`problems`, remove that directory, and call again.

Subagents inherit the worktree, so brief them with the path. Several runs on the
same branch each get their own worktree, or you reset between them:

```sh
git fetch && git reset --hard origin/<branch>
```

A branch carrying unrelated work: patch it out, take a fresh worktree, apply the
patch. A worktree too snarled to reason about: reset from main and redo the
smallest version. Do not untangle it in place.

## Phase B: Commits

Commit as you go, then rebase into small ordered commits before opening
anything. Each commit is a future pull request, landable on its own and ordered
so the series tells the story.

Amend when a fix belongs in a commit you just made. Make a new commit when the
change is separable. A series that only reads correctly in the order you happened
to write it is a series nobody can review.

Each commit message uses this shape:

```text
<type>[optional scope][!]: <concise imperative subject>

# Description
<one sentence, 8 to 25 words: the primary staged change>

# Changes
- <concrete staged change>
- <concrete staged change>

[# Breaking Changes
- <incompatibility and required migration>]
```

The type, scope, and subject come from Phase E. `# Description` and
`# Changes` are required; `# Breaking Changes` only when the staged change breaks
something. The `!` before the colon marks it.

Write one to four bullets, each naming a change visible in the diff. Use `add`,
`remove`, `update`, `replace`, `rename`, `refactor`, `correct`. Do not claim
behavior is preserved, compatible, safe, or unaffected. Do not list files, line
numbers, or implementation trivia unless that is the material change. Do not
infer motivation or runtime effects the diff does not show.

## Phase C: Split

Read the subjects as though each were the title of its own pull request.

```sh
git log --oneline <trunk>...HEAD
```

Two subjects wanting different scopes, or two justifications that do not overlap,
are two pull requests. Five subjects across five scopes is five pull requests.

No line count decides this. Google says outright that there are no hard rules
about how large is too large, and the 200 to 400 line figure the literature
quotes comes from one Cisco team, dated 2005 by SmartBear.

Two cases split even when the reasons overlap. A refactor belongs in its own
commit, never beside a behavior change, because a reviewer approves one and is
never asked about the other. A commit that needs another to be correct is not a
pull request, so merge those two and split somewhere the change does stand alone.

A large change that passes is not a problem to solve by cutting. Size predicts how
much a reviewer holds at once, and writing the change faster does not widen that.
Put the order of the parts in `## Scope` so nobody needs the whole diff in view.

## Phase D: Parallel preparation

Before you fill the PR fields, list the independent checks and reviews. Run command
checks in parallel when their inputs and outputs do not conflict. Give read-only
review lanes disjoint diff areas. Do not parallelize dependent work or branch writes.
Keep one owner for the final split, the PR fields, and the `tools.spectre.pr` call.
If no useful task can run in parallel, mark this phase `n/a` and state why.

For each useful subagent lane, load `model-router` and call
`tools.spectre.routing({ task: "<one lane>" })`. A grep, read, run, or report task
usually fits the `mechanical` profile or its equivalent. Use a profile with more
effort for semantic review, scope analysis, or risk analysis. Follow the judge's
choice when it is used. When it skips, match the task to the profile's `match` line.
If you are unsure between profiles, follow `model-router` and choose more effort.
Follow `model-router` for `setup`, `declined`, or `problems`. Never choose a profile
by array position or guess a model. Pass the selected profile's `agent` and exact
`model.ref`.

Launch all independent subagents together with `background: true`. Give each a
bounded, read-only task and ask for evidence. No subagent edits or commits on the
branch, or calls `tools.spectre.pr`. Wait for each result, verify its evidence, and
resolve dependent fixes before you write the fields.

## Phase E: Title and body

Do not compose either one. `tools.spectre.pr` writes both from structured fields and
refuses a body that breaks the rules below, so a pull request opened through it cannot
have the shape of whatever the run happened to produce.

```js
const pr = await tools.spectre.pr({
  type: "fix",                                  // one of the eleven below
  scope: "spectre",                             // lowercase noun naming the changed area
  subject: "report reading a PR gh could not",  // imperative, no period, one clause
  summary: "A row gh could not read looked like a clean row, so a stack read as clear.",
  review: "Is unknown distinguishable from good news here, or does it still read as clear?",
  scopeItems: ["tools/definitions/stack/read.ts"],
  validation: [{ check: "bun test test/stack", result: "17 pass, 0 fail" }],
  risk: "Changes the `threads` default. Reverting the file restores 0.",
  tradeoffs: "A sentinel number over a fourth state, because the state is read in three places.",
  breaking: "The `threads` field becomes a string.",
  base: "<parent-branch>",
})
```

It pushes the branch, opens or updates the pull request, and returns the URL. A
`lint-failed` status means nothing was pushed and nothing was opened, and `problems`
names each rule that broke, so fix the fields and call it again.

`tradeoffs`, `breaking` and `base` are the three optional fields. The rest are
required, which is the point: an empty `validation` list is a claim of evidence that
does not exist, and the tool refuses it.

### The title

One scope per title, in this pattern:

```text
<type>(<scope>)!: <imperative subject, at most 72 characters, no final period>
```

`<type>` is one of `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `build`,
`ci`, `chore`, `perf`, `revert`. `<scope>` is a lowercase noun naming the changed
area, written the way the repository writes it. Name a real symbol when one carries
the change. A `breaking` field puts `!` before the colon.

```text
fix(spectre): report reading a PR gh could not
```

Two changes is two pull requests, so two clauses is two titles. A subject joined by
`and`, `;` or `,` is refused, because that is the split failing in the one place a
reviewer reads first.

### The body

The fields become this shape, and the tool writes every heading, so you cannot omit
one or leave a section filled with `None.`:

```markdown
<One paragraph. Why the change exists, in plain words. No heading above it.>

## Review
<The one feedback you want, in one line.>

## Scope
- <Real symbols and paths, grouped by what belongs together.>

## Tradeoffs
<The alternative a reviewer would otherwise ask about, and why this one won.>

## Validation
- <command or check> → <what it returned>

## Risk and Rollback
<What it touches, how to revert it, and what stays broken on trunk if it does not land.>

## Breaking Changes
<What no longer works and the migration it needs.>

## Merge Gate
- [ ] Explicit direct user approval is recorded.
- [ ] All required GitHub Actions checks are green.
- [ ] If checks are not green, the direct user override names the failed checks and reason.
```

`## Review`, `## Scope`, `## Validation`, `## Risk and Rollback` and `## Merge Gate`
are always present. Drop `tradeoffs` and `breaking` when there is nothing to say. A
heading holding `None.` is a line a reviewer spends reading nothing, and it is
refused. Desired feedback is the type that best predicts acceptance (arXiv
2602.14611, 80,000 pull requests across 156 projects).

**The body describes the change, not the commits.** A commit SHA or a numbered list
in any field is a refusal: `git log` already holds that text, and three commit
summaries under numbered headings is a changelog wearing a pull request's clothes.
Name the symbols and paths instead. A reviewer needs the shape of the change, not
its packaging. The tool refuses a body over forty lines, because a repository
configured to squash a title and a body into one commit puts this text into `git log`
verbatim.

Write the summary, the review line and each bullet under `technical-writing`, then
pass the result through `grammar`. Apply every technical-writing layer except
Diátaxis. One word for each action, keep the articles, and avoid an `-ing` form
where a plain verb does the work. Run `interrogate` over the diff before you commit,
and `code-hygiene` before review.

Cut anything a reviewer would not ask about. A branch-protection `GET` returning
403, a safety argument citing another commit's SHA, and a list of defects found and
not fixed are all answers to questions nobody asked. A defect you turned up becomes
an issue, linked from a clause under `scopeItems` and only where a reviewer would ask
why you left it.

Attach a screenshot or a video when it proves a claim a sentence cannot. Link full
SHAs, per-lane recitals and file-by-file checklists as an artifact rather than
pasting them. There is no `## Summary` heading, because the summary field is it, and
no `## Test plan`, because `## Validation` is it.

## Phase F: Stack

A branch that tripped Phase C becomes a stack. A stack is a chain of base branches:
the root targets the trunk, and each child rebases onto its parent's exact tip. Name
that parent as `base` and the pull request targets it:

```js
await tools.spectre.pr({ /* … */ base: "<parent-branch>" })
```

Branch from the trunk only for work that is genuinely independent. Rebase on the
trunk before substantial stack work, not after it.

The forge is `gh`, and the tool drives it. Check that it is authenticated before the
first call, with `gh auth status`. `tools.spectre.stack` reports an unauthenticated
`gh` in `problems` rather than as a clear stack, so read `problems` before trusting a
`clear`.

## Phase G: Open

One call opens every pull request ready, never as a draft, and there is no input that
expresses one. `status: "created"` is the only status that says a pull request
exists. `status: "updated"` with `changed: false` means the branch already had one
carrying this exact title and body.

The call converges, so it is safe to repeat after a crash: it finds the open pull
request on the branch and rewrites it rather than opening a second. It never
force-pushes and never commits.

**Always pause and ask.** A force-push to a shared branch, a deploy, a deletion,
and anything a customer reads are the human's call, every time, whatever the brief
says. Say what you would do and wait for the answer. This is the one rule in the
playbook with no override. `## Merge Gate` stays unticked by the tool for the same
reason: it cannot observe a human, so it will not record an approval nobody gave.

## Phase H: Hand off

Opening a pull request does not start a babysit. Post the URL and keep building.
Finish the phase or the whole stack first, then run `playbook-babysit` when the
user asks for it. A babysit per new pull request stalls the build and spends
checks on commits the next wave will restart anyway.

A subagent that opens a pull request runs `interrogate`, `grammar` and
`code-hygiene`, calls the tool once, posts the URL, and returns to its parent. It
does not babysit.

## Outputs

The URL, the branch and its base, the commits in order, and anything you paused
on.
