# OpenCode platform

## What this is

The host contract that Spectre code targets, at OpenCode 2.2.7. Read it before you write a plugin `effect`. Read it before any `ctx.*` call, hook, tool, command, agent, skill, MCP transform, session prompt, or RPC method. Every fact below comes from the tag `v2.2.7` of `anomalyco/opencode`, not from the `dev` checkout. A doc path is relative to `services/site/src/docs/content/build/`. A source path keeps its `packages/` prefix. Where a doc page and the tag disagree, this skill follows the tag and names the stale page.

## The plugin shape

`Plugin.define({ id, effect })` takes a `Plugin`: `{ readonly id: string; readonly effect: (context: Context) => Effect.Effect<void, never, R> }`, and `R` defaults to `Scope.Scope` (`packages/plugin/src/effect/plugin.ts`). The `effect` runs when the plugin loads. Its scope closes when the plugin reloads or unloads. That release takes the registrations, the scoped fibers, and the finalizers together (`plugins/effect.mdx`, Lifecycle). Send background work through `Effect.forkScoped`. A plain fork escapes that cleanup.

```ts
import { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";

export default Plugin.define({
  id: "spectre",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("loaded", { version: ctx.app.version });
    }),
});
```

`effect` is a peer dependency plus a dev pin. `@opencode/plugin` is a runtime dependency (`plugins/effect.mdx`, Publish). OpenCode redirects `effect`, every public `effect/*` subpath, and `@opencode/plugin` plus every public `@opencode/plugin/*` subpath to the host's runtime instances. The redirect covers imports from the plugin's own `node_modules` too, so fibers, loggers, and `Schema` parsers share one copy (`plugins/effect.mdx`, Publish). The doc page prints `effect@4.0.1`. The tag's catalog pins `4.1.0`, and that is the build the host ships (`package.json` at `v2.2.7` → `workspaces.catalog.effect`).

Resolution has two paths. `.opencode/plugins/<name>/` loads automatically (`plugins/index.mdx`, Load). A configured local path must name a directory. OpenCode skips a configured `./plugin/local.ts` file with a warning (`plugins/migrate-v1.mdx`). A local directory with `package.json` `name` and `exports` resolves through them. Without them it uses file names at its root: `server` (else `index`), `tui`, and `rpc`. Each carries a `.ts`, `.tsx`, or `.js` extension (`plugins/index.mdx`, Load). The exports map at the tag is `.`, `./effect`, `./host`, `./runtime`, `./tui`, and the `./gui` entrypoints. It carries no explicit `./rpc` entry, so that name resolves only through the `./*` fallback to `src/*.ts` (`packages/plugin/package.json`). A local directory without `name` and `exports` probes `server` else `index`, then `tui`, then `rpc`. It also probes `gui-experimental.cjs` or `.js` for the GUI part (`packages/plugin/src/host.ts`). A plugin's GUI part is `./gui-experimental` in its own package: one prebuilt CommonJS file (`plugins/gui/index.mdx`, Package). Local discovery is `.opencode/plugins/` (plural). A TUI-only package belongs in `cli.json`, and the desktop app loads GUI parts from the global config (`plugins/index.mdx`, Load).

### The Promise API

The root import is the Promise form. `Plugin.define({ id, setup })` takes a `setup(ctx)` that returns `void` or a cleanup.

- `transform`, `hook`, `reload`, and `list` return Promises.
- `transform` returns `Promise<Registration>`, and `dispose()` returns `Promise<void>` (`packages/plugin/src/promise/{plugin,registration}.ts`).
- A tool's `execute` returns `Promise<Result>`. Its context adds `signal: AbortSignal` (`packages/plugin/src/promise/tool.ts`).
- `ctx.event.subscribe` returns an `AsyncIterable`, not a `Stream` (`packages/plugin/src/promise/adapter.ts`). The Effect form is `@opencode/plugin/effect`.

## The context, by domain

One row per domain of the `Context` interface. An **editor** registers a synchronous `transform` and a `reload`. **Read** is a plain query, **hook** registers a callback, and **stream** hands back an Effect `Stream` (`packages/plugin/src/effect/plugin.ts`).

| Domain | The operation that matters | Kind | Source |
| --- | --- | --- | --- |
| `app` | `ctx.app.version`, `.name`, `.channel` | read | `packages/plugin/src/app.ts` |
| `location` | `ctx.location.directory`, `.project.id`, `.project.canonical` | read | `packages/schema/src/location.ts` |
| `options` | the `options` object from `opencode.json(c)`, with untyped values | read | `packages/plugin/src/options.ts` |
| `agent` | `list`, `get`, `transform`, `reload` | editor | `packages/plugin/src/effect/agent.ts` |
| `aisdk` | `hook("sdk")` and `hook("language")` to swap the AI SDK model | hook | `packages/plugin/src/effect/aisdk.ts` |
| `command` | `list`, add-only `transform`, `reload` | editor | `packages/plugin/src/effect/command.ts` |
| `credential` | `activate` | write | `packages/plugin/src/effect/plugin.ts` |
| `event` | `subscribe({ types })`, which returns a `Stream` | stream | `packages/plugin/src/effect/event.ts` |
| `experimental` | `terminal.read`, `generate`, `artifact.transform` | mixed | `packages/plugin/src/effect/{plugin,artifact}.ts` |
| `generate` (deprecated) | `text` only; use `experimental.generate.text` | read | `packages/plugin/src/effect/plugin.ts` |
| `integration` | the API minus deprecated `wellknown`, `transform`, `reload`, and `connection.active`/`resolve`/`status` | editor | `packages/plugin/src/effect/integration.ts` |
| `mcp` | `list`, `transform`, `reload` | editor | `packages/plugin/src/effect/mcp.ts` |
| `model` | `list`, `default`, `transform`, `reload` | editor | `packages/plugin/src/effect/model.ts` |
| `permission` | `list`, `get`, `reply`, `hook("evaluate")`, `assert` | editor | `packages/plugin/src/effect/permission.ts` |
| `plugin` | `list` only | read | `packages/plugin/src/effect/plugin.ts` |
| `provider` | `list`, `get`, `transform`, `reload` | editor | `packages/plugin/src/effect/provider.ts` |
| `reference` | `list`, `transform`, `reload` (`get` is editor-only) | editor | `packages/plugin/src/effect/reference.ts` |
| `rpc` | `register(definition, handlers)`, then `ctx.rpc(Definition)` | write | `packages/plugin/src/effect/rpc.ts` |
| `session` | the operations in "Sessions and prompts", plus `hook` | mixed | `packages/plugin/src/effect/session.ts` |
| `shell` | `hook("create.before")`, and no client method at this tag | hook | `packages/plugin/src/effect/shell.ts` |
| `skill` | `list`, `transform`, `reload` | editor | `packages/plugin/src/effect/skill.ts` |
| `storage` | `get`, `set`, `remove`, `scan`, keyed to the plugin id | read/write | `packages/plugin/src/effect/storage.ts` |
| `tool` | `list`, `transform`, `reload`, `hook` | editor | `packages/plugin/src/effect/tool.ts` |
| `vcs` | the API minus `init`, plus `transform` and `reload` | editor | `packages/plugin/src/effect/vcs.ts` |
| `websearch` | `providers`, `query`, `transform`, `reload` | editor | `packages/plugin/src/effect/websearch.ts` |
| `worktree` | the API, `transform`, `reload` | editor | `packages/plugin/src/effect/worktree.ts` |

The context carries no OpenCode Core service (`plugins/effect.mdx`, Context). Two corrections against that page: its `Context` listing omits `credential` and `experimental.artifact`. The tag declares both (`packages/plugin/src/effect/plugin.ts`).

## Hooks

`hook(name, callback)` returns `Effect<Registration, never, Scope>`, so a registration lives as long as the plugin scope. Several plugins may register one hook. OpenCode runs them in plugin order, and later hooks see earlier changes (`plugins/effect.mdx`, Hooks). The callback takes one mutable event and returns `Effect<void>` (`packages/plugin/src/effect/registration.ts`). The failure channel is `never` unless the hook declares otherwise. Only `tool.execute.before` does (`packages/plugin/src/effect/tool.ts`).

OpenCode accepts the optional third argument `{ providerID }` wherever the event carries a `model` field. The session hooks are `context`, `compaction`, `generate`, `title`, `experimental.model.resolve`, `model.request`, `http.request`, `http.response`, `experimental.ws.*`, and `retry`. The `aisdk` `sdk` and `language` hooks accept it too (`packages/plugin/src/effect/registration.ts`, `ModelHooks`).

| Hook | When it runs | What it may change |
| --- | --- | --- |
| `prompt` | on admission of a user prompt, before attachment and skill resolution | `text`, `files`, `agents`, `skills`, `metadata`, `delivery` |
| `context` | the agent loop, including tool-driven continuations | `system`, `messages`, `tools` |
| `compaction` | checkpoint summaries | `messages`, and `result` to skip the model call |
| `generate` | transient `ctx.session.generate` calls | the same request fields as `context` |
| `title` | title generation | `result: string`, which skips the model call |
| `experimental.model.resolve` | as a session resolves a model, before anything is built | `model`, within the same provider |
| `model.request` | once per model request | `baseURL`, `headers` |
| `http.request`, `http.response` | every native provider request | the `Request` and the `Response` |
| `experimental.ws.handshake`, `send`, `receive` | once per model call, then per outbound and inbound `frame` | `url`, `headers`, `frame` |
| `retry` | after OpenCode classifies a failure, before it schedules a retry | `decision` |
| `experimental.idle` | when model work ends and no input is pending | nothing. It reads `background` |

Three of those rows need more than a cell. `prompt` does not run for synthetic, shell, compaction, or move items. Its edits become the persisted input (`packages/plugin/src/effect/session.ts`, `plugins/server.mdx`, Prompt admission). Native bodies are one-shot streams, so clone a body before you read it (`packages/plugin/src/effect/session.ts`). `decision` is `{ retry: false }` or `{ retry: true, delay }`. Attempt `1` is the first request. A delay of `NaN`, infinity, or a negative number falls back to the computed one (`packages/plugin/src/effect/session.ts`).

The context event carries these fields (`packages/plugin/src/effect/session.ts`):

```ts
interface SessionContext {
  readonly sessionID: Session.ID;
  readonly model: Model.Ref;
  system: Array<SystemPart>;
  messages: Array<Message>;
  options: Types.DeepMutable<GenerationOptionsFields> & Record<string, unknown>;
  readonly agent: Agent.ID;
  tools: Record<string, { description: string; input: JsonSchema.JsonSchema }>;
}
```

The Effect page lists eleven session hooks. It omits `prompt`, `experimental.model.resolve`, and `experimental.idle`, which the tag defines (`plugins/effect.mdx`, `packages/plugin/src/effect/session.ts`). The Promise page documents `prompt` and `experimental.model.resolve` under the same names (`plugins/server.mdx`).

`ctx.shell` has one hook, `"create.before"`. Its event is `{ command, cwd, timeout, shell, env }`, and all five fields are mutable (`packages/plugin/src/effect/shell.ts`).

The tool hooks are `execute.before` and `execute.after` (`packages/plugin/src/effect/tool.ts`). The first may replace `input` or fail with `Tool.Error`. The second may not fail at all:

```ts
interface ToolBefore {
  tool: string;
  readonly sessionID: Session.ID;
  readonly agent: Agent.ID;
  readonly messageID: SessionMessage.ID;
  readonly id: Tool.CallID;
  input: unknown;
}

type ToolAfter = {
  readonly tool: string;
  readonly sessionID: Session.ID;
  readonly agent: Agent.ID;
  readonly messageID: SessionMessage.ID;
  readonly id: Tool.CallID;
  readonly input: unknown;
} & ({ readonly status: "completed"; result: Tool.Result } | { readonly status: "error"; error: Tool.Error });
```

## Tools

`ctx.tool.transform((editor) => { ... })` registers tools. The callback is synchronous. It returns nothing, not an `Effect` or a `Promise`, so load external data before you register or reload (`plugins/effect.mdx`, Tools). The editor offers `add`, `update`, `remove`, `namespace`, `list`, and `get` (`packages/plugin/src/effect/tool.ts`). `add` needs `name`, `description`, and `execute`, plus `input` for a typed tool. Core defaults a missing `input` to `{}` for a JS plugin (`packages/core/src/tool.ts`). `update` and `remove` take an effective name and ignore a missing one (`packages/plugin/src/effect/tool.ts`, `packages/core/src/tool.ts`).

`execute(input, context)` returns `Effect<Result<Output>, Tool.Error>`. `Result` is `{ output?, content?, metadata? }`, and the context is `{ sessionID, agent, messageID, id, progress }` (`packages/schema/src/tool.ts`). `input` and `output` are a `Tool.ValueSchema`: an Effect `Schema.Codec`, a Standard Schema, or a JSON Schema. The decoded value and the declared type then come from one place (`packages/schema/src/tool.ts`). A tool that declares `output` must return it. A tool that returns an undeclared `output` dies (`packages/core/src/tool/runtime.ts`).

`options.codemode` defaults to true. Only `codemode: false` keeps a tool on the provider's native tool list. Every other tool is reachable solely through the `execute` tool (`packages/core/src/tool.ts`, `packages/schema/src/tool.ts`). When a permission disables the `execute` tool, OpenCode exposes the code-mode tools as direct tools instead. The default is therefore not a silent hiding (`packages/core/src/tool.ts`). `pinned: true` keeps a tool in a partial catalog. The type allows it only while `codemode` is not `false` (`packages/schema/src/tool.ts`, `packages/core/src/codemode/catalog.ts`).

The effective name is `namespace.replaceAll(".", "_") + "_" + name.replace(/[^a-zA-Z0-9_-]/g, "_")`. `get`, `update`, and `remove` all take it, as in `acme_greeting` rather than `greeting` (`packages/core/src/tool/runtime.ts`). An update preserves the name and the namespace. OpenCode logs an invalid update and leaves the previous definition in place (`packages/core/src/tool.ts`).

Every model request captures a snapshot of the advertised definitions and their executors. `reload` and `dispose` affect later snapshots only. A captured executor still sees mutable state that it closes over. Capture a value inside the transform when it must stay tied to that definition (`plugins/effect.mdx`, Tools).

Freeform input is not a plugin surface at this tag. The `Tool.Info` declaration has no `freeform` field, and no plugin doc at `v2.2.7` offers one (`packages/schema/src/tool.ts`). The option exists only in the AI SDK layer (`packages/ai/src/tool.ts`). Nothing in `packages/core` sets it, so a plugin cannot reach it. Do not write `freeform` in a plugin against 2.2.7.

## Commands, agents, skills, MCP

The command transform is add-only. Its executor receives `{ sessionID, prompt, delivery }` and returns `Effect<void, unknown>`. That is enough to forward the invocation into `ctx.session.prompt` (`packages/plugin/src/effect/command.ts`). `session.command({ sessionID, name, ...PromptInput.Prompt, delivery? })` runs a command callback immediately (`packages/protocol/src/groups/session.ts`).

The agent transform edits a mutable draft. It can set the default with `editor.default(id)`, and `undefined` clears it (`packages/plugin/src/effect/agent.ts`). A skill transform adds a full `Skill.Info`: `{ id, name, description?, autoinvoke?, path, content }`. It updates a draft of the same shape, and `reload` replays the transforms (`packages/schema/src/skill.ts`, `packages/plugin/src/effect/skill.ts`).

The MCP editor uses `set` to add or replace a server, `update` to edit one, and `remove` to drop one. Setting `disabled: true` disables it and disconnects it. Setting `disabled: false` enables it and lets OpenCode connect. A call to `reload()` reapplies the transforms and reconciles the servers (`plugins/effect.mdx`, MCP). The editor itself is in `packages/plugin/src/effect/mcp.ts`.

## Sessions and prompts

`SessionDomain` holds `list`, `create`, `get`, `remove`, `switchAgent`, `switchModel`, `prompt`, `generate`, `command`, `compact`, `synthetic`, `interrupt`, `update`, `move`, and `context`, plus the experimental `wait` and `instructions` (`packages/plugin/src/effect/session.ts`).

- `prompt({ sessionID, text, delivery?, resume? })` durably admits one input and schedules the loop unless `resume` is false. `delivery` is `"steer" | "queue"`, and steer is the default (`packages/protocol/src/groups/session.ts`, `packages/schema/src/session-inbox.ts`).
- `generate({ sessionID, prompt })` returns `{ text, tokens, cost }` from the current context and mutates no history (`packages/protocol/src/groups/session.ts`).
- `synthetic({ sessionID, text, resume? })` admits text that no user sent (`packages/protocol/src/groups/session.ts`).
- `compact({ sessionID, delivery? })` returns the admitted inbox item, not a finished summary. Compaction steers by default, so it runs at the next step boundary and does not wait behind queued prompts (`packages/protocol/src/groups/session.ts`).
- `wait({ sessionID })` waits for the loop to become idle. `context({ sessionID })` returns the messages after the last compaction. `interrupt({ sessionID })` returns `{ interrupted }`, and its `resume` query resumes pending steering and control items. `move({ directory, delivery? })` moves the session at a delivery boundary (`packages/protocol/src/groups/session.ts`).
- `instructions.entry.put({ sessionID, key, value })`, `.list`, and `.remove` write durable instruction entries. They render as `<context key="...">` blocks and announce at the next step boundary without queueing a turn (`plugins/effect.mdx`, Sessions, and `packages/protocol/src/groups/session.ts`).

## The API and SDK

The HTTP surface is one group file per family under `packages/protocol/src/groups/`. The reference is 170 operations over 139 paths and 497 schemas at `v2.2.7`.

Server is `/api/info` and `/api/pair`, plus `GET /auth/connect/:code` for pairing. Location, agent, plugin, session, model, provider, integration, and credential own a first path segment. So do project, permission, command, skill, rpc, event, pty, shell, worktree, vcs, reference, form, and config.

`message` nests under `/api/session/:sessionID/message`. `debug` owns `/api/debug/*`. Config owns `/api/config`, `/api/config/shell`, and `/api/experimental/config`.

Filesystem lives at `/api/fs/*` plus `/api/experimental/fs/*`. Generation lives at `/api/experimental/generate` plus `/text`, `/image`, and `/decisions`. MCP lives at `/api/mcp`, `/api/mcp/resource`, `/api/experimental/mcp/:server/*`, and `/api/experimental/client-mcp/*`.

Artifact, job, media, migration, persistent-pty, schedule, usage, and voice live under `/api/experimental/`. Project, config, fs, pty, shell (beyond the hook), voice, usage, debug, and migration are reachable only through the raw client. So are job, schedule, media, message, and form. No `ctx` domain covers them. The OpenAPI document is `packages/protocol/openapi.json`.

A plugin uses `ctx`. That context is the Effect client for the connected server, plus the plugin-only transforms and hooks (`plugins/effect.mdx`, Context). A separate application uses `@opencode/client`. Its Promise client is `OpenCode.make({ baseUrl })` over the network (`client/index.mdx`). The Effect client is `@opencode/client/effect`, the same surface as Effects and Streams, and it needs an `HttpClient` (`client/effect.mdx`). An application that hosts OpenCode in process uses `@opencode/sdk`. The `OpenCode.create()` call assembles the server and routes calls through its router in memory. It opens no listener (`sdk/index.mdx`). The Layer form is `@opencode/sdk/effect` (`sdk/effect.mdx`). The client exports at the tag are `.`, `./promise`, `./promise/api`, `./effect`, and `./effect/api`. They also include `./effect/service`, `./solid`, `./service`, and `./mcp`. The SDK exports are `.`, `./effect`, `./workerd`, and `./workerd/effect` (`packages/client/package.json`, `packages/sdk/package.json`).

## The rules that bite

- **The redirect is not optional.** `effect` and `@opencode/plugin` always resolve to the host's copy, including from the plugin's `node_modules`. A plugin built against another Effect major receives the host's copy and is unsupported. A private `effect/internal` import fails to load with an error that names the path (`plugins/effect.mdx`, Publish).
- **Never bundle `effect`.** Mark `effect` and `effect/*` external when you build (`plugins/effect.mdx`, Publish).
- **The transform callback is synchronous.** A returned Effect or Promise is the mistake the type prevents (`plugins/effect.mdx`, Tools).
- **The tool snapshot is per model request.** `reload` and `dispose` do not reach a request already in flight (`plugins/effect.mdx`, Tools).
- **`reload` replays transforms. It does not rerun the effect.** Registration order keeps its place, and data the callback captured does not refresh (`plugins/effect.mdx`, Tools).
- **The context has no Core services.** Anything that needs one goes through a domain operation or the server API (`plugins/effect.mdx`, Context).
- **Code mode is the default.** A tool with no `codemode` option never reaches the native tool list. Set `codemode: false` to be called directly (`packages/core/src/tool.ts`).
- **`ctx.location` is where the plugin loaded.** It is not where every session or event lives, so read the session data when that distinction matters (`plugins/migrate-v1.mdx`).

## Lookup table

| Question | File at the tag | What to read |
| --- | --- | --- |
| What can the context do? | `packages/plugin/src/effect/plugin.ts` | the `Context` interface, then the domain file |
| When does this hook run, and what may it change? | `packages/plugin/src/effect/session.ts` | the `SessionHooks` map and the event interface |
| How does a tool get called, named, and snapshotted? | `packages/schema/src/tool.ts`, `packages/core/src/tool.ts` | `Options`, `Info`, `Context`, then the snapshot code |
| Which route and payload? | `packages/protocol/src/groups/<family>.ts` | the endpoint's `payload`, `success`, and description |
| How does OpenCode find and load a plugin? | `plugins/index.mdx` | Load, and the exports map in `packages/plugin/package.json` |
| How do I publish without breaking the runtime? | `plugins/effect.mdx` | Publish |
| How do I expose an RPC method? | `plugins/effect/rpc.mdx`, `packages/plugin/src/effect/rpc.ts` | Define, Implement, then `RpcDomain` |
| Client or SDK? | `client/index.mdx`, `sdk/index.mdx` | the first paragraph of each |
| How do the command, agent, skill, and MCP editors differ? | `packages/plugin/src/effect/{command,agent,skill,mcp}.ts` | the editor interface |
| What changed from V1? | `plugins/migrate-v1.mdx` | the context and hook tables |
