# Playbook Investigation

Answer a question about the repository without changing it. Read the code, read
git, read the pull request bodies if they are reachable, and come back with
either an explanation someone can act on or a recommendation with the tradeoffs
written down. The answer is the deliverable, so a commit, a branch and a pull
request are all out of scope here.

`how` is a walkthrough: it explains one subsystem to a reader who has never
opened it. This is the whole read-only engagement around it, from framing the
question through to writing down what the answer changes, and it is the thing to
load when the question itself is still being chosen.

## Start

Open a `todolist` with one entry per phase before reading anything. Read-only
work still wants a ledger, because the phases are what stop a broad question
turning into a broad read.

1. Frame
2. Ground
3. Answer
4. Weigh
5. Hand over

## Phase A: Frame

Write the question as a sentence that has an ending. "How does session refresh
work" does not end. "which of these two shapes keeps a revoked token from
re-entering the pool" does. Say what an answer would change, because a question
whose answer changes nothing is a question to decline.

Name the surface the answer has to cover. A subsystem, a commit range, a
decision recorded somewhere outside the tree. A vague surface is how an
investigation turns into reading a repository.

Push back on a wrong premise before investigating it. `principle-attack-the-premise`
owns the move. What it hands you is a better question, not a rejected request.

If the answer turns out to require a code change, stop here and hand back. Say
which playbook takes it next, `playbook-bug-fix` or `playbook-feature`, and why
that is the one. Do not drift into the change.

## Phase B: Ground

`ripwire.explore` is the orientation call and it is one call: a ranked map of
the subsystem, its 1-hop callers and the tests that cover it. A map is not an
explanation, so when the answer is a walkthrough, load `how` and follow its
output shape. When the question is why the code is shaped this way rather than
what it does, that is `why`, with `tools.spectre.history` for the line and the
date.

Pull request bodies are not in a local clone. `gh pr view` and `gh search prs`
reach them when the CLI is authenticated, and they are the closest thing here to
the design discussion behind a decision. When they are not reachable, say that
in the answer rather than quietly answering from the diff alone.

There is no issue tracker, no chat archive, no error service and no metrics
service in this setup. A question that needs production telemetry — how often
this path runs in production, what the p99 is for real users — cannot be answered
here at all. Name it as the gap and say who would hold the answer.

## Phase C: Answer

Two shapes, and which one you owe depends on the question.

- **An explanation.** Load `how` and take its structure. The reader has a
  question afterwards and your answer is what they will answer it from.
- **A recommendation.** Only when the question is a choice between alternatives
  that exist. Then give a table: the options, what each costs, what each rules
  out, and the one you would take. A recommendation with no table is an opinion
  wearing a conclusion.

For "are we sure" questions, give the real judgment with the reasons attached,
including the cases where you are not sure and what would settle it. An
investigation that ends in "it depends" and names the dependency did the
job.

## Phase D: Weigh the evidence

Sort every claim you are about to make, the way `why` sorts commit messages:

- **Direct.** The code says it, or a pull request body says it.
- **Circumstantial.** A name, a date, a file that changed alongside. It
  suggests.
- **Not evidence.** The code's own naming. `refreshIfNearExpiry` is a label
  somebody wrote earlier and has no more authority than the code.

State which kind each load-bearing claim is. A conclusion built on circumstantial
evidence is fine, as long as the reader knows that is what it rests on.

## Phase E: Hand over

Close with the part that saves the reader the work: what this answer changes.
Leave it alone, run a phase in another playbook, delete something, or decide
something. One line.

Then run the reply past `grammar` and cut what would survive unchanged in another
project's documentation.

## Outputs

A read, not a transcript. In order: the answer, the evidence it rests on and
what kind that evidence is, the gap where the repository is silent, and one line
on what the answer changes.
