Open a pull request for the work on this branch, through `tools.spectre.pr`.

The tool composes the title and the body, refuses a body that breaks the rules, pushes
the branch, and opens or updates the pull request. Never write the title or the body
yourself and never call `gh pr create` yourself: the tool is the only path, because a
pull request whose text you composed is the failure this exists to prevent.

## Read before you write

1. `git log --oneline <trunk>...HEAD` and `git diff <trunk>...HEAD --stat`. The trunk is
   what `tools.spectre.worktrees` used, or the default branch the tool reports.
2. `tools.spectre.canvas({ action: "diff", base, head, slug })` when the diff is large
   enough that reading it twice would cost more than it tells you. Read the evidence
   files it writes rather than asking a subagent to carry a diff back.
3. Read the code around every hunk you are about to describe. A field that names a
   symbol you have not opened is a guess.

## Fill every field

Derive all of them from the diff. Nothing here is a formality, and each one has a rule
behind it that will refuse the call.

- `type` and `scope`. One type, one scope. A change touching two areas is two pull
  requests, so split the branch before filling this rather than widening the scope.
- `subject`. What the change does, imperative, under the whole 72 characters, one
  clause. Two clauses joined by `and`, `;` or `,` is a split that failed.
- `summary`. One paragraph on why the change exists. What was wrong, or missing, and
  what this does about it. No commit SHA, no numbered list of commits.
- `review`. The one piece of feedback you want, in one line. The kind that best
  predicts acceptance is the kind a reviewer gives a decision on rather than an opinion
  on, so ask for a decision rather than an impression.
- `scopeItems`. The real symbols and paths, grouped by what belongs together. Every
  entry is a thing a reviewer will open.
- `validation`. One entry per command that actually ran, and what it returned. Run the
  checks first: `bun run typecheck` and `bun test` in this repository, plus whatever the
  change itself needs. An entry whose result you did not read is a fabricated result.
- `risk`. What it touches, how to revert it, and what stays broken on trunk if it does
  not land.
- `tradeoffs`. Include it only when a reviewer would ask about an alternative, and say
  why this one won. Omit it rather than writing `None.`
- `breaking`. Include it only when something no longer works, and say what the
  migration is. It puts `!` in the title.
- `base`. Name a parent branch only for a stack, and only after the parent pull request
  exists.

Write `summary`, `review` and the bullets under `technical-writing`, then pass them
through `grammar`.

## Then

Call the tool once. Read the status it returns:

- `created`. The URL is in `url`. That is the only status that means a pull request
  exists.
- `updated`. One already existed on this branch and now carries this title and body.
  `changed: false` means it already did.
- `lint-failed`. Nothing was pushed and nothing was opened. `problems` names each rule,
  so fix the fields and call it again. Do not work around the rule by rewriting the
  text to slip past it.
- `failed`. `problems` says which step and why. Read it before retrying, because the
  call converges rather than duplicating.

Finish the phase or the whole stack before running `playbook-babysit`. Opening a pull
request does not start a babysit. Post the URL and keep building.

## And the one rule with no override

A force-push to a shared branch, a deploy, a deletion, and anything a customer reads
are the human's call, every time. Say what you would do and wait for the answer. The
tool never force-pushes and never commits, so this is about the work around it.