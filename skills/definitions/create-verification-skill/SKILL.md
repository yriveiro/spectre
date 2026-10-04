# Create a verification skill

Give the project a scripted way to drive its own app and prove what it does:
start it, use a feature the way a user would, capture the evidence, tear down
what it started. This procedure builds that as a skill, written for the next
agent rather than for a person, because it is read cold and mid-task by an agent
that has never seen the app.

## Start

1. Interview
2. Repair
3. Write
4. Map
5. Prove

## Phase A: Interview

Answer these from the checkout. Ask the reader only what you cannot observe.

- **Surface.** What does a user actually touch: a web UI, a CLI or TUI, a
  desktop app, a service, a library? A repo can have several. Pick the primary
  one and say what else exists.
- **Run.** How it starts locally. Prefer the project's own documented command,
  so the skill does not carry a second way to launch. Note the ports, the
  environment variables, the seed data, the auth.
- **Drive.** How an agent can touch it programmatically. Look for what is
  already there first: browser specs, expect scripts, a PTY helper, a debug port.
  Only then take a generic recipe, which is a browser over CDP for web and
  desktop, a PTY or tmux session for a CLI, and plain HTTP for a service.
- **Observe.** What a run can capture: a screenshot, a terminal transcript, a
  response body, a log line, an exit code, a row in the database.
- **Isolate.** Whether two instances can run side by side on separate ports,
  data directories, and profiles. If they cannot, write that into the skill.
  Refusing to drive beats corrupting the session somebody is using.

## Phase B: Repair

If the checkout does not build or start as it stands, fix that or report it
precisely before writing anything. A skill written against a base that does not
run teaches wrong steps, and the next agent cannot tell which half is wrong.

An asset that blocks startup and is not the thing under test, a static
directory the service never serves, a sample config, can be created as
verification scaffolding. Mark it as such and remove it in cleanup.

## Phase C: Write

Write `.opencode/skills/verify-<app>/SKILL.md` in the project. OpenCode loads a
directory skill only with its frontmatter, so the file starts with:

```yaml
---
name: verify-<app>
description: Drive the <app> <surface> and capture evidence. Use when a claim about <app> behaviour needs a run behind it.
metadata:
  opencode/autoinvoke: "false"
---
```

No placeholder survives this phase. Every command, selector, and path came out
of Phase A, and anything you could not find is a question, not a `<todo>`.

**Launch.** The exact command that starts the app for verification, and how you
know it is ready: a log line, a port that answers, a prompt on screen. Teardown
belongs here too. A short-lived CLI has no server to keep alive, so launch means
building the binary once and starting each drive in its own PTY or tmux session.

**Doctor.** One read-only check that answers whether this instance is worth
driving: the process is up, it is the right build, the port is ours, the auth is
valid. Run it first whenever anything looks off.

**Drive.** The recipe with this repository's own selectors and commands. Prefer
a stable handle, an ARIA label, a data attribute, a prompt string, a route path,
over a coordinate or a tab index.

**Evidence.** What to capture for a proof and where it goes. The standards:
drive the real user path rather than an internal setter or a test-only endpoint.
Capture the action and the state it produced, not the last screen alone. Check
the side effects, the files written, the rows inserted, the message sent. Mock
only where a production boundary already isolates the external system. Where a
dry run is the safe path, watch what it skips rather than trusting the name,
because a dry run that opens a browser still runs.

**Cleanup.** How to tear down what the run started. Never kill by process name;
kill what you started. Cleanup removes the instances and the scratch state, never
the evidence. Name the path the proof survives at.

**Helpers.** Any script the skill ships is executable, and its invocation appears
in the body. A helper the reader has to reverse-engineer is not a helper.

## Phase D: Map

Write `.opencode/skills/verify-<app>/features/README.md` plus one file per
user-facing feature, three to five to begin, taken from the routes, the
commands, the menus, or the docs. The four sections in each are the same:

```markdown
# <feature>

## Sub-features
## How to get to it, from the user's side
## Driving it with <harness>
## Gotchas
```

The map is the project's maintained record of what has to be driven, so a proof
that takes one convenient path through the app is incomplete when the map lists
four others.

## Phase E: Prove

Run the skill you just wrote, end to end, once: launch, doctor, drive one mapped
feature, capture the evidence, clean up. One feature is enough, because the map
is what covers the rest later.

After the cleanup, confirm the evidence is still at the path the skill named. A
cleanup that eats the proof has failed the step. Fix what failed, and run the
cleanup again after every failed attempt, so a broken run does not leave a
process holding a port.

A generated skill that has never been executed is a draft, not a deliverable.

## Outputs

A skill folder, a feature map, and one captured proof with its artifacts on
disk. Then point at `maintain-verification-skill` for the pass that keeps the
map true.
