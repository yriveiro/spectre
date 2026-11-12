# Ripwire as the code-search default

Status: designed. Slice 1 is not built.

## The problem

An agent searches code with `grep` because `grep` is the tool it sees. The
ripwire skills wait for the model to load one, and the map has no row for the
search moment. The ripwire MCP server is a user config entry, not a plugin
surface. The Code Mode catalog renders it as `- ripwire (33 tools, none shown)`
inside its 2,000-token budget, so no verb name reaches the model. In the same
request, `grep` arrives with a full description. The model picks the visible
tool.

## What this feature must do

1. A code search lands on ripwire without the model reading a long skill.
2. `grep` keeps plain text, logs, docs prose, fixtures, lock files, and files
   ripwire does not index.
3. The answer says which instrument answered, what it ran, and what it did not
   look at.
4. When ripwire is absent, stale, or the tree holds no code, the behavior is
   today's behavior.

## The boundary

| The search is | The instrument |
| ------------- | -------------- |
| a task, "where is the retry decided" | `spectre_search` → `ripwire --for` |
| a symbol, a literal, or a regex in code | `spectre_search` → `ripwire --grep` or `--regex` |
| a call-graph question | `spectre_search`, then `--callers`, `--impact`, `--uses`, `--path` |
| plain text, logs, docs prose, fixtures, lock files | `grep` |
| a file outside the index, or a tree with no code | `grep` |

Rule 0 makes `literal: true` an unconditional escape. Rule 4 allows a second
grep for the same pattern, so a wrong reroute costs one call and not a session.

## Usage first

A code question:

```js
spectre_search({ query: "where is the ripwire binary resolved" })
```

A literal that is already in hand:

```js
spectre_search({ pattern: "OPENCODE_CONFIG_DIR" })
```

A plain-text search that stays on grep:

```js
grep({ pattern: "Unverified:", path: "docs" })
```

The model sees three surfaces before it chooses:

```text
# Code search
A search for code is `spectre_search`, not `grep`. It answers a question or a
literal with the enclosing symbol, and it ranks what to read first. `grep` is
for plain text: logs, docs prose, fixture data, lock files. A code-shaped `grep`
is answered by `spectre_search` once, and the answer says so.
```

The tool description carries the same rule, and `grep` carries its half:

```text
Search PLAIN TEXT — logs, docs prose, fixture data, lock files, and any file the
code index does not hold. For a symbol, a definition, a call site, or "where is
this implemented", call `spectre_search` first.
```

## One contract, four surfaces

One module owns the strings. Four surfaces render from it.

| Surface | What it carries | When it is written |
| ------- | --------------- | ------------------ |
| The request system part | the code-search rule | `session.context`, every request |
| `spectre_search`'s description | the tool, its examples, its status values | tool registration |
| `grep`'s description | the plain-text half and the pointer | `session.context`, every request |
| The reroute sentinel | which instrument answered, what it ran, what it skipped | the tool result |

The `session.context` hook rewrites the request, not the registry. `system` is
rebuilt from the agent prompt on every request, so an append cannot accumulate.
`tools` is a deep copy, so a description rewrite cannot leak into another
session. The host keeps the real tool name behind a renamed key, so execution
still resolves.

## The policy

`judge` is pure. Rule order is the contract.

| # | Condition | Verdict |
| - | --------- | ------- |
| 0 | `literal === true` | allow, `plain-text` |
| 1 | ripwire absent, stale, or the index holds no code | allow, `no-instrument` |
| 2 | the pattern is shorter than three characters | allow, `too-broad` |
| 3 | `path` or `include` names a plain extension | allow, `plain-text` |
| 4 | this pattern was already rerouted in this session | allow, `already-asked` |
| 5 | the pattern has whitespace and a code token (`function`, `class`, `def`, `import`, `const`, `return`, `=>`, `::`, `->`, `(`) | route, `task` |
| 6 | the pattern has no regex metacharacter but `.` and `/`, and the path is code | route, `literal` |
| 7 | the pattern has a regex metacharacter and no whitespace | route, `regex` |
| 8 | otherwise | allow, `plain-text` |

The plain extensions are `.log .md .mdx .txt .csv .tsv .jsonl .lock .env .sql
.snap`. Rule 5 is the phrase case: `grep({ pattern: "function rescue" })` goes to
`--for`, because the model wrote a code question in the words it knows. A prose
phrase with no code token stays in grep.

`route` returns argv, never a shell string. A value that begins with `-` rides
inside `--grep=<value>`, so it cannot become a flag. The tool refuses a root that
escapes the project before the spawn. `fresh: true` maps to `--no-cache`.

## Types

```ts
type Ask =
  | { kind: "task"; task: string; root: string; budget: number }
  | { kind: "literal"; text: string; root: string }
  | { kind: "regex"; pattern: string; root: string };

type GrepAsk = {
  pattern: string;
  path?: string;
  include?: string;
  literal?: boolean;
};

type Health =
  | { kind: "ready"; binary: string; version: string }
  | { kind: "absent"; why: string }
  | { kind: "stale"; binary: string; version: string };

type Verdict =
  | { kind: "allow"; why: "plain-text" | "too-broad" | "already-asked" | "no-instrument" }
  | { kind: "route"; why: "task" | "literal" | "regex"; ask: Ask };

type SearchInput = {
  query?: string;
  pattern?: string;
  kind?: "task" | "literal" | "regex";
  path?: string;
  budget?: number;
  fresh?: boolean;
  include?: string;
  literal?: boolean;
  caseSensitive?: boolean;
  limit?: number;
};

type SearchOutput = {
  tool: "spectre_search";
  verb: "for" | "grep" | "regex";
  status: "answered" | "empty" | "partial" | "absent" | "refused";
  command: string;
  answer: string;
  rerouted?: boolean;
  reason: string;
  note?: string;
};
```

`pattern` is grep's own field name. A rerouted call keeps its input, so a host
that ignores the rename runs grep on the same payload. The schema accepts
`include`, `literal`, `caseSensitive` and `limit` so that payload decodes.
`include`, `caseSensitive` and `limit` are declared and ignored, and the result
`note` says which ones were. `literal: true` stays on grep by rule 0.

## Modules

| File | The one thing it owns |
| ---- | --------------------- |
| `tools/definitions/search/index.ts` | The declaration and `attach(ctx)`: the tool, the two hooks, the namespace line |
| `tools/definitions/search/contract.ts` | `RULE`, `SEARCH_TOOL`, `GREP`, `SENTINEL` |
| `tools/definitions/search/policy.ts` | `route` and `judge`. Pure, no Effect, no I/O |
| `tools/definitions/search/run.ts` | Spawn, argument safety, path containment, status, truncation |
| `tools/definitions/search/context.ts` | `shape(draft, contract)` for `session.context` |
| `tools/definitions/search/guard.ts` | `execute.before`: permission assert, `judge`, rename, `seen` |
| `tools/definitions/search/probe.ts` | Which binary, which version, one cached fact |
| `mcp/index.ts` | The optional MCP registration, its version gate and its conflict rule. Slice 3 |
| `tools/index.ts` | One `editor.add`, one `editor.namespace`, two `attach` calls |
| `test/search/policy.test.ts` | The rule table, with a code phrase and a text phrase |
| `test/search/context.test.ts` | Append once, rewrite grep, leave a `.log` path alone |
| `test/search/run.test.ts` | A fake binary: answered, empty, absent, refused, escape |
| `eval/search/` | The scripted-model gate and the four arms |

`spectre_search` is `codemode: false`. A Code Mode tool is reachable only
through `execute`, and the catalog that lists it is the surface that hides the
verb names. The host renders a direct tool in full, beside `grep`, where the
choice happens. The cost is one schema in every request, an estimated 350
tokens.

## Platform facts

| Fact | Source |
| ---- | ------ |
| The `session.context` hook exposes mutable `system` and `tools`, rebuilt per request | `node_modules/@opencode/plugin/dist/effect/session.d.ts:33-41`; `v2.2.7:packages/core/src/session/model-request.ts:279-310` |
| `execute.before` may rename the tool and rewrite the input, and the model path uses the event | `v2.2.7:packages/core/src/tool.ts:311-319`; `node_modules/@opencode/plugin/dist/effect/tool.d.ts:20-28` |
| The grep registry id is `grep`; `opencode.tool.grep` is the plugin id, and an update with a missing id is a no-op | `v2.2.7:packages/core/src/tool/plugin/grep.ts:66,79-84`; `tool.ts:216-222`; `tool/runtime.ts:288-293` |
| The built-in grep description invites code use | `v2.2.7:packages/core/src/tool/plugin/grep.ts:79-80` |
| The Code Mode catalog truncates and budgets, and a namespace can render as "none shown" | `v2.2.7:packages/core/src/codemode/catalog.ts:50-52,82-113` |
| Only `tool.execute.before` may fail, and session hooks are total | `v2.2.7:packages/core/src/plugin/hooks.ts:17-26` |
| The existing rejection shape and `catchDefect` discipline | `tools/definitions/worktrees/return/index.ts:51-73` |
| The existing `session.context` use | `skills/definitions/effect-best-practices/watch.ts:115-134` |
| A local MCP server is `{ type: "local", command, cwd?, environment?, codemode? }` | `node_modules/@opencode/schema/dist/mcp.d.ts` |
| `--mcp-tools=core` is eight tools, and `--mcp` takes the root as a positional argument | `ripwire --help` at 0.6.10; `src/mcp.h:163` in the ripwire repository |
| The map is bound to the installed binary's `--help` | `test/skills/ripwire-map.test.ts:103-124` |
| `test/tools/reachable.test.ts` asserts every spectre tool is `codemode: true` | `test/tools/reachable.test.ts:60` |

## Failure and fallback

| Situation | What the model sees |
| --------- | ------------------- |
| ripwire is not installed | `status: "absent"` with the install line. The guard never reroutes. `grep` behaves as today. |
| ripwire is older than 0.6.10 | `status: "absent"` with both versions and `ripwire --doctor`. No reroute. |
| The MCP server is absent | The plugin registers `core` when the probe is ready. The search path still works without it. |
| The MCP server is user-configured | The plugin leaves it untouched. It registers `core` only when no `ripwire` entry exists. |
| The file is not indexed | `status: "empty"` with "No hits in the indexed tree. That is not proof of absence. Re-issue grep with path or include for raw text." |
| The tree holds no code | The first empty answer sets the guard quiet for the session. `grep` is untouched. |
| `path` escapes the project | `status: "refused"` and the path. No spawn. |
| The regex is invalid | `status: "refused"` with ripwire's message. The second grep is allowed. |
| The host ignores the tool rename | The search input is grep's own shape, so grep runs. Today's behavior, no error. |
| `SPECTRE_SEARCH=off` | The contract is omitted, the guard allows, the tool still answers when called. |

## Build order and evidence

**Slice 1. The tool, the contract and the request-time rewrite.**
`contract.ts`, `policy.ts`, `run.ts`, `context.ts`, `probe.ts`, the declaration
and the wiring. No reroute, no MCP. Tests: `policy`, `context`, `run`. Eval arms:
`off`, `desc`, `tool`.

If `desc` moves the code-search share above 0.5 on its own, stop. The sentence is
the lever and the reroute is unnecessary.

**Slice 2. The reroute.** `guard.ts`, the `execute.before` hook, the `all` arm.
Build it only when `G` stays above 0.5. Its gate is `T` and `C`: plain-text
precision does not fall, and median tool calls per code row do not rise.

**Slice 3. MCP ownership.** `mcp/index.ts`. Read `editor.get("ripwire")` first.
If the entry exists, leave it untouched. If it does not, register `core` only
when the probe is ready. Never overwrite a user config. This slice is about the
other verbs and the catalog cost, not about search.

The eval corpus is three slices: twelve code rows, ten text rows, eight negative
rows. A code row may be a phrase, not only an identifier. The metrics:

| Name | What it is | Today | Gate |
| ---- | ---------- | ----- | ---- |
| R | share of code rows answered by ripwire | 0.0 | above 0.5 for `all` |
| G | share of code rows answered by grep | 1.0 | below 0.5 for `all` |
| T | share of text rows answered by grep | about 1.0 | within 0.1 of `off` |
| C | median tool calls per code row | baseline | does not rise |
| N | reroutes per session, by reason | 0 | `already-asked` never repeats a pattern |

The scripted-model gate uses a fake binary, so it needs no install and no spend.
The live arms use `opencode serve` and the same transcript mechanics as
`eval/resume/`. No per-row number becomes a `bun test` gate, because a number
that moves with any wording turns the suite red for a reason nobody can act on.

## Alternatives

| Alternative | Why it lost |
| ----------- | ----------- |
| Add a search row to `ripwire/SKILL.md` | A skill is loaded on a model decision, and the eval shows the model does not load one. A non-leaf row also fails the map test. |
| Delete `grep` | It loses the plain-text half and the only tool that reads an unindexed file. A wrong decision becomes unrecoverable. |
| Block every code grep with `Tool.Error` | It costs a turn and answers nothing. The model repeats the same intent. The reroute answers in the same call. |
| Rewrite shell `grep` and `rg` commands | A shell command is the caller's. Rewriting it changes semantics the model may depend on. Count shell searches in the eval instead. |
| Register the MCP server only | The verb names stay behind the catalog budget and `execute`. The model still greps. |
| Rewrite every agent prompt | It mutates agents the user configured, and it needs an idempotent append. The per-request `session.context` hook is smaller and cannot accumulate. |

## Open questions

- Does the description alone move `R`? The `desc` arm answers before slice 2 is
  built.
- Does rule 5 over-fire on a log line that contains the word `function`? The `T`
  metric answers.
- Is the `execute.before` rename stable across providers and Code Mode settings?
  The type and the model path say yes. The scripted-model test proves it on this
  host.
- Is `core` the right follow-up set? The `C` and `N` numbers answer after slice
  3.

## The one risk

Rule 5 catches a phrase only when it carries a code token. A model that writes
`"where retry is decided"` and never adopts the tool still lands in grep. The
front door is the tool description and the system rule, so the reroute is a
backstop and not the whole design. Run the `desc` arm first, and keep a code row
whose text is a phrase with no code token. If `R` stays near zero there, the
sentence is the problem, not the hook.
