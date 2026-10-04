# Playbook opening a PR

Turn finished work into pull requests a reviewer can land. Every other playbook
ends here, and this one does not go on to babysit or ship.

## Start

Open a `todolist` with one entry per phase before the first push.

1. Worktree
2. Commits
3. Split
4. Title
5. Body
6. Stack
7. Open
8. Hand off

## Phase A: Worktree

Never edit the main checkout. `tools.spectre.worktrees({ action: "start", name })`
opens one, branches it off trunk, reads the result back, and moves this session
into it. One call does it, and only `status: "opened"` means it happened.

The call moves a session, so it refuses when no session is open in a worktree.
This repository's trunk is a bare clone, so a session started at its root gets
`status: "rejected"` and nothing on disk. Add the worktree by hand, then move the
session into the new directory:

```sh
git worktree add -b <name> <path> <trunk>
```

It also refuses a branch that already exists. To pick one up, add it by hand and
move the session yourself:

```sh
git worktree add <path> <branch>
```

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

The types, the scope and the subject come from Phase D. `# Description` and
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

## Phase D: Title

One scope per title, in this pattern:

```text
<type>(<scope>): <imperative subject, at most 72 characters, no final period>
```

`<type>` is one of `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `build`,
`ci`, `chore`, `perf`, `revert`. `<scope>` is a lowercase noun naming the changed
area, written the way the repository writes it. Name a real symbol when one
carries the change. Add `!` before the colon for a breaking change.

```text
fix(spectre): report reading a PR gh could not
```

Two changes is two pull requests, so two clauses is two titles. A title joined by
`and`, `;` or `,` is the split failing in the one place a reviewer reads first.

The pattern is one command, so a title that misses it is a title you can see miss
rather than one nobody noticed:

```sh
gh pr view <number> --json title -q .title \
  | grep -qE '^(feat|fix|refactor|docs|style|test|build|ci|chore|perf|revert)(\([^)]+\))?!?: [^ ].*'
```

## Phase E: Body

Write the title, the body and every commit message under `technical-writing`, then
pass the result through `grammar`. Apply every technical-writing layer except
Diátaxis. One word for each action, keep the articles, and avoid an `-ing` form
where a plain verb does the work. Run `interrogate` over the diff before you
commit, and `code-hygiene` before review.

A reviewer reads the body before the diff. Fill this in and delete what does not
apply:

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
<What it touches, how to revert it, what stays broken on trunk if it does not land.>

## Breaking Changes
<What no longer works and the migration it needs.>

## Merge Gate
- [ ] Explicit direct user approval is recorded.
- [ ] All required GitHub Actions checks are green.
- [ ] If checks are not green, the direct user override names the failed checks and reason.
```

Keep it under forty lines. A repository configured to squash a title and a body
into one commit puts this text into `git log` verbatim, so the paragraph has to
survive there.

`## Review`, `## Scope`, `## Validation`, `## Risk and Rollback` and
`## Merge Gate` are always present. Drop `## Tradeoffs` and
`## Breaking Changes` when there is nothing to say, and never write a section
filled with `None.`. A heading holding `None.` is a line a reviewer spends
reading nothing. Desired feedback is the type that best predicts acceptance
(arXiv 2602.14611, 80,000 pull requests across 156 projects).

**The body describes the change, not the commits.** No commit SHA, no
`1.` / `2.` / `3.` counter, no "rebased onto main" line, and no section per
commit. Three commit summaries under numbered headings is a changelog wearing a
pull request's clothes, and `git log` already holds that text. Name the symbols
and paths instead. A reviewer needs the shape of the change, not its packaging.

Cut anything a reviewer would not ask about. A branch-protection `GET` returning
403, a safety argument citing another commit's SHA, and a list of defects found
and not fixed are all answers to questions nobody asked. A defect you turned up
becomes an issue, linked from a clause under `## Scope` and only where a reviewer
would ask why you left it.

Attach a screenshot or a video when it proves a claim a sentence cannot. Link
full SHAs, per-lane recitals and file-by-file checklists as an artifact rather than
pasting them. No `## Summary` heading, because the opening paragraph is it. No
`## Test plan`, because `## Validation` is it.

## Phase F: Stack

A branch that tripped Phase C becomes a stack. A stack is a chain of base
branches: the root targets the trunk, and each child rebases onto its parent's
exact tip with its pull request targeting the parent branch.

```sh
gh pr create --base <parent-branch>
gh pr edit <pr> --base <parent-branch>
```

Branch from the trunk only for work that is genuinely independent. Rebase on the
trunk before substantial stack work, not after it.

The forge is `gh`. Check that it is authenticated before the first pull request
operation and use it for create, edit, view and merge alike.

## Phase G: Open

Open every pull request ready, never as a draft. `gh pr create` without
`--draft` does it. If one still lands as a draft, run `gh pr ready <number>`.
Read `gh pr view <number>` before you say anything about its status.

**Always pause and ask.** A force-push to a shared branch, a deploy, a deletion,
and anything a customer reads are the human's call, every time, whatever the
brief says. Say what you would do and wait for the answer. This is the one rule
in the playbook with no override.

## Phase H: Hand off

Opening a pull request does not start a babysit. Post the URL and keep building.
Finish the phase or the whole stack first, then run `playbook-babysit` when the
user asks for it. A babysit per new pull request stalls the build and spends
checks on commits the next wave will restart anyway.

A subagent that opens a pull request runs `interrogate`, `grammar` and
`code-hygiene`, posts the URL, and returns to its parent. It does not babysit.

## Outputs

The URL, the branch and its base, the commits in order, and anything you paused
on.