# Data root

Where a skill writes when its output has to outlive the session it was made in.

```
~/.local/share/spectre/<worktree-name>/<collection>/<slug>/<the writer's choice>
```

| Level | What it is |
| ----- | ---------- |
| `<worktree-name>` | which tree the run belongs to, so two worktrees of one repo do not share a store |
| `<collection>` | a plural naming the kind of run: `arenas`, `swarms`, `evals`, `prototypes`, `orchestrates`. The plural of the skill that writes there, except `figure-it-out`, which has none worth spelling and writes `decisions/` |
| `<slug>` | one run, named for what it was about |
| last level | the skill writer's, and it names the thing that writes — `seat-<n>`, `worker-<n>` — never the experiment |

## The two tests

A path qualifies only if it clears both, and `arena` states them where the fan-out
happens because that is where the choice gets made.

1. **Outside the project tree.** Inside it, an artifact is either committed by
   accident or left as untracked dirt.
2. **Outliving the session.** `/tmp` promises nothing about surviving, so a path
   that a later run has to read cannot be one.

## Permission

`agents/index.ts` grants `external_directory`, `read` and `edit` on
`${dataRoot}/*` to every registered agent, and to subagents, which never inherit
the parent's rules. The rule is a prefix match, so the nesting above needs no
change here when a skill adds a level. `test/agents/permissions.test.ts` holds the
grant and the prefix assertion.

## Who writes there

| Skill | Path |
| ----- | ---- |
| `arena` | `arenas/<slug>/seat-<n>/` |
| `swarm` | `swarms/<slug>/worker-<n>/` |
| `interrogate` | none yet: it fans out and names no path |
| `playbook-eval` | `evals/<slug>/seat-<n>/` |
| `playbook-prototype` | `prototypes/<slug>/` |
| `playbook-orchestrate` | `orchestrates/<project-slug>/` |
| `figure-it-out` | `decisions/<slug>/worker-<n>/` |
| `canvas` | `cache/diff/<project-digest>/<token>/` — in-flight evidence, pruned at 7 days, never the delivered page |

`canvas` is the one row that is a cache rather than a run. It holds no page and no
identity, it is keyed by a content digest, and it exists only between `diff` and
a PR publish. The delivered page lives in the artifact, not here.

Each skill spells its own path inline rather than pointing here. A subagent
carries its own agent's rules and never its parent's, which `agents/index.ts`
says in the reason the grant lives there, and an output path is the one thing a
fan-out worker cannot be asked to go and look up. This file is for whoever
changes the repository.

## Open

`<worktree-name>` is undefined repo-wide. No file says how to derive it, and the
rows above that carry it all hold the placeholder.

Defining the placeholder properly is this file's job, not one tool's. The options
are the basename, the repository slug, or the basename under a repository-named
parent directory. The second and third cost one more level and stop the collision.
Whichever is chosen, every row above moves in the same change.

`playbook-eval` has a contradiction this convention does not settle. Its blinding
rule forbids `eval` appearing in any directory the candidate can see, and the
seat path it hands the candidate contains `evals/`. Two ways out, both a decision
rather than a cleanup: a collection name that does not carry the word, which
departs from the naming above, or a path handed to the candidate that does not
spell the collection.
