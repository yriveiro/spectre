# `eval/resume/`

The resume contract under a live server: the session corrects a delegated result
in the child that produced it, and a new unit of work starts a new one. The
harness boots the provided Docker image, loads the plugin's publish set, and
drives a scripted model through the two turns. No credential enters the
container.

## Fixture or golden

Both, for different jobs.

- **The fixture** is `scenarios/<id>.json`. It holds the prompts, the scripted
  model, and the expectations. It is hand-written and stable. The `mock` array
  is the model: each step names the side (`parent` or `child`), a substring of
  the last user message, and the tool call or text to answer with. The
  `$firstChild` placeholder is replaced with the id from the first `subagent`
  tool result.
- **The golden** is `golden/<id>.json`. It holds the normalized observation from
  one passing run: the call count, whether each call carried a `sessionID`,
  whether call 2 continued call 1, the child count, and the final files. It
  holds no session ids and no prose, so a re-run is stable. A change to the
  shape fails the run and shows both objects.
- **The raw artifacts** are `.runs/<stamp>/<mode>/<id>/`: the parent transcript,
  each child transcript, the normalized observation, and the server log. Git
  ignores them, and they exist for debugging. A live run can put prompts and
  tool output in them. Delete the run directory when it may hold a secret.

The fixture is the source of truth for what should happen. The golden is the
receipt that it did. A model change does not move the golden, because the
scripted model is the fixture and the golden records the tool path.

## Scenarios

| id | what it proves |
| -- | -------------- |
| `correction` | Turn 2 continues the first child. The remembered word lives only in the first child prompt, so a new child cannot produce the final file from the second prompt. |
| `new-unit` | The negative control. Turn 2 is a new unit, so it starts a new child. A rule that always resumed would fail it. |

## Running it

```sh
bun install
bun run eval:resume -- --record   # record the golden from a passing run
bun run eval:resume               # compare the current run with the golden
bun run eval:resume -- --scenario=correction
bun run eval:resume -- --build    # rebuild the image first
bun run eval:resume -- --keep     # keep the container for a look
```

The first run builds `spectre-eval:2.2.7` from `docker/Dockerfile` with the
`docker/` directory as the build context. The image installs OpenCode 2.2.7 and
Bun 1.4.4. The harness mounts three things into it:

| Host | Container | Why |
| ---- | --------- | --- |
| `.runs/<stamp>/<mode>/<id>/plugin` | `/plugin` | the publish set from `package.json`, copied with hardlinks, read-only |
| `.runs/<stamp>/<mode>/<id>/workspace` | `/workspace` | the fixture workspace and the files the child writes |
| `.runs/<stamp>/<mode>/<id>/config/opencode.json` | `/root/.config/opencode/opencode.json` | replaces the image's published-plugin config with this checkout's publish set and the mock provider |

The plugin root is the `files` list from `package.json` plus `package.json` and
`node_modules`, not the whole checkout. The copy keeps `.git`, `.env`, `eval/`
and everything outside the publish set out of the plugin directory the container
can read. The container also starts with project config discovery disabled, so a
fixture cannot add a plugin or MCP server through a file in `/workspace`.

The mock server runs on the host and the container reaches it through
`host.docker.internal`. The provider is `@ai-sdk/openai-compatible` with
`baseURL` pointing at the mock. Every request carries a per-run token in the
path, so another process on the network cannot use the scripted model. The
harness generates the server password per run and passes it through a temporary
env file. That is why the container needs no model credential.

## Why a mock, and what it does not prove

The Console-managed providers (`opencode`, `opencode-go`) do not cross the
container boundary. Measured: `opencode-go` answers 401 *Invalid credential*,
`opencode` answers *Reconnect OpenCode Console*, and the Copilot models are
listed but unroutable. The host CLI works because it uses the app's Console
service, which the container does not have. A test environment that needs that
service is not a test environment.

The mock proves the tool path: the host's `subagent` tool creates the child, the
second call carries the same id, the child's context is the one that produced
the file, and the parent transcript carries the output id. It does not prove
that a real model follows the skill. That is a live run's question.

## A live run

The container cannot use the Console-managed providers. A live run starts a host
server instead, with `OPENCODE_CONFIG_DIR` pointing at a temporary config that
names the plugin's publish set. The auth stays in the host's data directory,
which is what makes `opencode-go` reachable. The prompts are the same fixtures,
with the container's `/workspace` replaced by the host workspace.

```sh
bun run eval:resume -- --live --scenario=correction --record
bun run eval:resume -- --live --scenario=correction
```

The server's working directory is the run directory, not the workspace. The
fixture writes into `workspace/`, a child, and project config discovery is off,
so a fixture-supplied `opencode.json` or `.opencode/` is data the model may read.
The server binds an ephemeral port and prints the port it chose. The harness
generates the password per run.

The live golden lives in `golden/live/`, so a model run never overwrites the
deterministic baseline. A live run is an evaluation, not a gate: it costs model
calls and a model can answer differently without the tool path changing. The
assertions are the same ones the mock path uses, so a live failure names the
call or the file that broke the contract.

## Trust boundary

A fixture is input to a test, not a document. The harness contains every path a
fixture names to the run's workspace, and it refuses a path that is absolute,
climbs out, or resolves outside through a symlink. A scenario id is a slug, so it
cannot move the run directory or the golden. Both runtimes disable OpenCode's
project config discovery, so a file a fixture writes cannot add a plugin or MCP
server.

Docker mode still runs the plugin under test. The container is the sandbox, and
the plugin is code. Run it on a host without secrets you would not expose to that
code, and keep network egress closed in CI. The fixture can also script tool
calls, so the container can run commands by design.

Live mode runs the real model on the host, with the host's auth. It is not a
sandbox. Run `--live` only on fixtures from a commit you trust. The harness keeps
fixture files out of the project config the server loads, but the model still
has the host tools and the host environment.
