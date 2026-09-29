# Automate me

Turn the reader's working conventions into one personal skill an agent follows
without being asked. The output is a single skill in their name.

The version this came from mined the transcripts of past sessions for what the
reader kept asking for. Nothing here exposes transcripts, so that pass is gone.
What replaces it is weaker, and saying so is part of the job: the commit history,
the skills already installed, and the reader's own answers. A rule the evidence
does not carry does not go in.

## Start

1. Look
2. Mine
3. Ask
4. Cluster
5. Draft
6. Cut
7. Land

## Phase A: Look

Find a skill for this reader before writing one. One folder per skill, each
holding a `SKILL.md`:

```sh
ls ~/.config/opencode/skills ~/.claude/skills ~/.agents/skills 2>/dev/null
ls .opencode/skills .claude/skills .agents/skills 2>/dev/null
```

If one exists, ask which they want: update it, which is the default, or start
fresh, which is rare and needs a reason first.

An update changes the rest of the flow. Mine only the history since the skill was
last touched:

```sh
git log -1 --format=%cI -- <path-to-SKILL.md>
```

Ask what changed rather than what to capture, and edit the file in place. Keep
every section they have not contradicted, revise the ones with new evidence, and
add a section only for a rule that is genuinely new.

## Phase B: Mine

The transcripts are not available here, so mine what is:

- `git log -format='%s%n%b' -n 200` for the subjects and bodies, which is where
  their idea of a good commit message lives.
- The shape of the history itself: rebase or merge, one branch or worktrees, a
  changelog kept or not, a review tool or not.
- The skills they have installed and the tooling the project wires up, which is
  where their formatting and verification posture shows.
- The project's own `AGENTS.md`, `README.md`, and `CLAUDE.md`: rules they already
  wrote down, and none of them need rediscovering.

Fan this out when the history is long. Call `tools.spectre.routing({})`, take one
model per slice from the profiles, and spawn the readers with `subagent` and
`background: true`. Each reader takes a slice and returns the patterns it saw
with the commit that shows each one. Never write a model id by hand.

Cross-check before believing anything. A pattern in two or more slices is real.
A pattern in one slice is noise, and the usual fate of noise is to be dropped.

## Phase C: Ask

Mining cannot see intent that has not come up yet, and it cannot see what they
want to stop doing. Ask with `question`: one or two questions, four to six
options each, `multiple: true` for anything about categories. Start broad, then
follow up on what they picked, then one free-form question for what the options
missed.

Do not send a list of twenty. The options are a way to make them answer, not the
questionnaire.

## Phase D: Cluster

Group the findings into sections, and ship only the ones with something in them:

- **Response style**: length, tone, format.
- **Autonomy**: how much to do without asking, and which tools to reach for.
- **Understand first**: what to read before scoping a change.
- **Subagents**: when to delegate, how to split the work, what to hand off.
- **Code and prose discipline**: the rules they cite, the linter, the formatter.
- **Verify**: what "done" means to them, and what counts as proof.
- **Process**: worktrees, commits, PRs, the review tool.
- **Skills**: when they fix a skill instead of working around it.

A section with nothing specific in it does not ship. "Communicate clearly" is
not a section. "Bullets only when the items are genuinely parallel" is.

## Phase E: Draft

Name the folder for them: `.opencode/skills/<name>-mode/SKILL.md` in the
project, or `~/.config/opencode/skills/<name>-mode/SKILL.md` to follow them
everywhere. OpenCode also reads `~/.claude/skills/` and `~/.agents/skills/`, so
a skill they already keep in one of those is the same kind of artefact.

Frontmatter is required or the skill never loads:

```yaml
---
name: <name>-mode
description: Use for "<name>-mode" or when work should follow this person's conventions.
metadata:
  opencode/autoinvoke: "false"
---
```

The description triggers on their name and on the mode, not on "write code" or
"review a PR", which every other skill already claims. `opencode/autoinvoke:
"false"` keeps the model from loading it uninvited; drop it only when they ask
for it on every turn.

Write "the user" or "the reader" in the imperatives, not their first name, so
the file reads as a rule rather than a letter.

If the skill belongs in this plugin rather than in a config directory, it is a
`skills/definitions/<id>/` folder with an `index.ts` beside the body, and it has
to be added to the list in `skills/definitions/index.ts` or `load()` dies on the
folder it cannot find.

## Phase F: Cut

Run `unslop` and `i-have-adhd` over every line. Neither is restated here.

Show the draft and take the feedback. Expect two or three rounds. A personal
skill is not a manual: every line that does not change a decision goes, and a
convention they have never said out loud does not go in on your own authority.

## Phase G: Land

Open a worktree off the default branch, commit, and open a PR. Do not push to
the branch they are on.

## Outputs

One skill folder, one PR, and a short list of the rules you cut and the evidence
you dropped.
