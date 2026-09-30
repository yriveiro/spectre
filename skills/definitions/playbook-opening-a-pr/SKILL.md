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
into it — one call, and only `status: "opened"` means it happened. Subagents
inherit the worktree, so brief them with the path. Several
runs on the same branch each get their own worktree, or you reset between them:

```
git fetch && git reset --hard origin/<branch>
```

A branch carrying unrelated work: patch it out, take a fresh worktree, apply the
patch. A worktree too snarled to reason about: reset from main and redo the
smallest version. Do not untangle it in place.

## Phase B: Commits

Commit as you go, then rebase into small ordered commits before opening
anything. Each commit is a future pull request: landable on its own, and ordered
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
should learn why the change exists, what is out of scope, and how you proved it
works. The squash commit body is the pull request body, so if the body would
push the squash commit past about forty lines, cut the body.

Use these sections in order. Fill every section. State `None.` where a section
has no content, except `## Tradeoffs` which is omitted when there was no real
choice:

- `## Why`. The intent and the approach, in one or two short paragraphs. No SHA
  list, no rebase genealogy, no "based on main" preamble. This is the Summary.
- `## Scope`. Bullets naming real symbols and paths. Name both sides of a
  rename or a retarget. State the boundary only where it matters; it is not a
  file-by-file essay. This is the Changes list.
- `## Tradeoffs`. Only the alternatives a reviewer would otherwise ask about. Omit
  the section when there was no real choice.
- `## Validation`. Each run you actually did and what it returned. List commands,
  tests, or manual checks with results. Link GitHub Actions runs when available.
  For a performance change, one number with its unit in `before → after` form.
  Link the artifact holding the rest.
- `## Risk and Rollback`. Who or what the change touches, why it is safe or
  risky, and how to revert or recover. Include what stays broken on main if this
  is not merged.
- `## Breaking Changes`. State what no longer works and the required migration.
  State `None.` when no incompatibility exists.
- `## Merge Gate`. Leave each box unchecked until verified:
  - [ ] Explicit direct user approval is recorded.
  - [ ] All required GitHub Actions checks are green.
  - [ ] If checks are not green, the direct user override names the failed
    checks and reason.

Attach a screenshot or a video when it proves a claim a sentence cannot. Do not
paste full SHAs, per-lane recitals, file-by-file checklists, or a verdict word
on its own; those belong in a linked artifact. No `## Summary`, no `## Test plan`
as separate headings. A commit body does not restate its subject.

## Phase E: Stack

Prefer five narrow pull requests to one large one. A stack is a chain of base
branches: the root targets the trunk, and each child rebases onto its parent's
exact tip with its pull request targeting the parent branch.

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
