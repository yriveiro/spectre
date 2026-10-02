# Playbook opening a PR

Turn finished work into pull requests a reviewer can land. Every other playbook
ends here, and this one does not go on to babysit or ship.

## Start

Open a `todolist` with one entry per phase before the first push.

1. Worktree
2. Commits
3. Prose
4. Title and body
5. Stack
6. Open
7. Hand off

## Phase A: Worktree

Never edit the main checkout. `tools.spectre.worktrees({ action: "start", name })`
opens one, branches it off trunk, reads the result back, and moves this session
into it. One call does it, and only `status: "opened"` means it happened.

The call moves a session, so it refuses when no session is open in a worktree.
This repository's trunk is a bare clone, so a session started at its root gets
`status: "rejected"` and nothing on disk. Add the worktree by hand, then move the
session into the new directory:

```
git worktree add -b <name> <path> <trunk>
```

Subagents inherit the worktree, so brief them with the path. Several runs on the
same branch each get their own worktree, or you reset between them:

```
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
<one concise sentence about the primary staged change>

# Changes
- <concrete staged change>
- <concrete staged change>

[# Breaking Changes
- <incompatibility and required migration>]
```

`# Description` and `# Changes` are required. Omit `# Breaking Changes`
unless the staged change creates an actual incompatibility. Add `!` before
the colon when that section is present.

Write one direct description sentence, normally 8 to 25 words. It states
the primary change, not a generic rationale. Write one to four change
bullets. Each bullet describes a concrete change visible in the diff.
Use direct change verbs such as `add`, `remove`, `update`, `replace`,
`rename`, `refactor`, or `correct`. Do not claim behavior is preserved,
unchanged, compatible, safe, or unaffected. Do not list files, line edits,
or implementation trivia unless that is the material change. Do not infer
motivation or runtime effects the diff does not show.

### Split on cohesion, not on size

No number decides this. A line count cannot tell a reviewer whether two changes
belong together, and cutting one coherent change in half leaves two pull requests
that are each harder to review than the one was.

The thresholds usually quoted here do not answer that question. Google's own page
says there are no hard and fast rules about how large is too large and that the
size is the reviewer's call, and Chromium's 500 line tip opens by saying none of
its tips are formal policy. The 200 to 400 line figure the rest of the literature
quotes comes from a study of one Cisco team that SmartBear dates to 2005.

So ask the question directly. Does each commit carry a reason the others do not?

```sh
git log --oneline <trunk>...HEAD
```

Read those subjects as though each were the title of its own pull request. Two
subjects wanting different scopes, or two justifications that do not overlap, are
two pull requests. Five subjects across five scopes is five pull requests, and no
line count makes it fewer. This is the claim the phase already makes about
commits, so a series that fails it was not a set of pull requests to begin with.

Two cases split even when the reasons overlap. A refactor belongs in its own
commit, never beside a behavior change, because a reviewer approves one and is
never asked about the other. And a commit that needs another commit to be correct
is not a pull request, so merge those two and split somewhere the change does
stand alone.

A large change that passes is not a problem to solve by cutting. Size predicts how
much a reviewer holds at once, and writing the change faster does not widen that.
Put the order of the parts in `## Scope` so nobody needs the whole diff in view.

## Phase C: Prose

Run `interrogate` and `unslop` over the diff before you commit, and `no-comments`
before review.

Write every pull request title, every body, and every commit message under
`technical-writing`, then pass the result through `unslop`. Apply every
technical-writing layer except Diátaxis. One word for each action, keep the
articles, and avoid an `-ing` form where a plain verb does the work.

## Phase D: Title and body

Titles are Conventional Commits, `type(scope): subject`. The type is one of
`feat`, `fix`, `refactor`, `docs`, `style`, `test`, `build`, `ci`, `chore`,
`perf`, or `revert`. The scope is a lowercase noun naming the changed area,
written as the repository writes it. Keep the subject short and imperative,
at most 72 characters, with no final period. Name a real symbol when one
carries the change. Add `!` before the colon for a breaking change.
`fix(spectre): report reading a PR gh could not` is the shape.

The body is a briefing, not the lab notebook. A reviewer who already has the diff
should learn why the change exists, how to review it, and how you proved it
works. Keep it under forty lines, because a repository configured to squash a
title and a description into one commit puts this text into `git log` verbatim.

Open with a paragraph, not a heading, and write it to stand on its own. That
paragraph is the whole commit message in the configuration above, and a heading
carries nothing into `git log`. Then these sections, in this order:

- `## Review`. One line naming the feedback you want. Of eight elements derived
  from published guidelines and scored across 80,000 pull requests in 156
  projects, the desired feedback type is the one that best predicts acceptance
  (arXiv 2602.14611).
- `## Scope`. Bullets naming real symbols and paths, grouped by what belongs
  together for a reader rather than one bullet per file. Name both sides of a
  rename or a retarget. No SHA list, no rebase genealogy, no "based on main"
  preamble.
- `## Tradeoffs`. Only the alternatives a reviewer would otherwise ask about. Omit
  the section when there was no real choice.
- `## Validation`. Each run you actually did and what it returned. List commands,
  tests, or manual checks with results. Link GitHub Actions runs when available.
  For a performance change, one number with its unit in `before → after` form.
  Link the artifact holding the rest.
- `## Risk and Rollback`. What the change touches, how to revert it, and what
  stays broken on the trunk if it does not land.
- `## Breaking Changes`. What no longer works and the required migration. Omit the
  section when nothing breaks.
- `## Merge Gate`. Leave each box unchecked until verified:
  - [ ] Explicit direct user approval is recorded.
  - [ ] All required GitHub Actions checks are green.
  - [ ] If checks are not green, the direct user override names the failed
    checks and reason.

No section is ever filled with `None.`. A section with nothing to say is a
section nobody writes, and a heading holding `None.` is a line a reviewer spends
reading nothing.

Write no section for the work you found and did not do. A defect turned up while
fixing this one becomes an issue, linked from a clause under `## Scope` and only
where a reviewer would otherwise ask why you left it. GitHub's guidance on review
threads is to track out-of-scope feedback in an issue rather than widen the pull
request. A list of findings in the body reads as a list of pull requests nobody
opened, and it is the shape a branch takes when the Phase B split check is
skipped.

Attach a screenshot or a video when it proves a claim a sentence cannot. Do not
paste full SHAs, per-lane recitals, file-by-file checklists, or a verdict word
on its own; those belong in a linked artifact. No `## Summary` heading, because
the opening paragraph is it. No `## Test plan`, because `## Validation` is it. A
commit body does not restate its subject.

## Phase E: Stack

A branch that tripped the Phase B split check becomes a stack. A stack is a chain
of base branches: the root targets the trunk, and each child rebases onto its
parent's exact tip with its pull request targeting the parent branch.

```
gh pr create --base <parent-branch>
gh pr edit <pr> --base <parent-branch>
```

Branch from the trunk only for work that is genuinely independent. Rebase on the
trunk before substantial stack work, not after it.

The forge is `gh`. Check that it is authenticated before the first pull request
operation and use it for create, edit, view and merge alike.

## Phase F: Open

Open every pull request ready, never as a draft. `gh pr create` without
`--draft` does it. If one still lands as a draft, run `gh pr ready <number>`.
Read `gh pr view <number>` before you say anything about its status.

**Always pause and ask.** A force-push to a shared branch, a deploy, a deletion,
and anything a customer reads are the human's call, every time, whatever the
brief says. Say what you would do and wait for the answer. This is the one rule
in the playbook with no override.

## Phase G: Hand off

Opening a pull request does not start a babysit. Post the URL and keep building.
Finish the phase or the whole stack first, then run `playbook-babysit` when the
user asks for it. A babysit per new pull request stalls the build and spends
checks on commits the next wave will restart anyway.

A subagent that opens a pull request runs `interrogate`, `unslop` and
`no-comments`, posts the URL, and returns to its parent. It does not babysit.

## Outputs

The URL, the branch and its base, the commits in order, and anything you paused
on.
