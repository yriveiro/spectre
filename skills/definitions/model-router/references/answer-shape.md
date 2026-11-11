# The routing answer

This page lists every field a routing answer can carry. Read it when the skill body does not name the field you need. Read it also when you must read a `problems` answer while a profile is wrong.

## `resolved`

`status` is `"resolved"`. The answer carries these fields:

| Field | What it is |
| --- | --- |
| `profiles` | One row per profile. A named call filters this array to that profile. |
| `models` | The spendable allowlist, in `priority` order. |
| `crosscheck` | The models that may serve a second opinion, in fallback order. |
| `sources` | The config files the tool read, lowest precedence first. |
| `asked` | The profile names the call asked for. Empty on a whole-table call. |
| `judge` | The profile choice, or the reason the tool did not ask. |

The `models` and `crosscheck` arrays share one row shape:

| Field | What it is |
| --- | --- |
| `name` | The alias from `models`. |
| `model` | The ref from `models`, including a variant the allowlist pinned. |
| `priority` | The one-based place in the allowlist `priority`. |
| `family` | The catalogue family, when the catalogue states one. |
| `rungs` | Every effort rung the model declares, in catalogue order. |
| `cost` | The `input` and `output` cost per million tokens. |

The `models` array is in allowlist `priority` order. The `crosscheck` array is in fallback order. The `priority` on a `crosscheck` row is still the model's place in the allowlist, so the two orders never share one number.

A named call puts the name in `asked`. A call that names a profile the config does not have returns an empty `profiles` array, and `asked` still carries the name.

## A profile row

| Field | What it is |
| --- | --- |
| `name` | The profile name. |
| `match` | The routing surface, when the profile states one. |
| `effort` | The requirement the config states, when it states one. |
| `agent` | The spectre agent the profile names, or `spectre` when it names none. |
| `model` | The model the resolver will spend. |
| `crosscheck` | The second opinion, when the profile asks for one and the resolver found one. |
| `crosscheckProblem` | Why a declared second opinion found no model. |
| `excluded` | The models that did not qualify, in allowlist order. |

### The spent model

`model` and `crosscheck` share this shape:

| Field | What it is |
| --- | --- |
| `ref` | The string to pass to `subagent`. It includes the variant, when the model has one. |
| `rung` | The effort rung the resolver asked for, when it asked for one. |
| `pinned` | True when the profile named this model with a `model` pin. |
| `steppedUp` | True when the ladder had no rung at the requirement and the resolver took a higher one. |
| `below` | The highest rung under the one used, when the ladder holds one. |
| `family` | The catalogue family, when the catalogue states one. |
| `rungs` | Every effort rung the model declares, in catalogue order. |
| `cost` | The `input` and `output` cost per million tokens. |

A ref that carries a variant from `models` keeps that variant. A model with no thinking control reports no rung. A stepped-up model reports `steppedUp: true` and names the rung it used.

### `crosscheckProblem`

The field appears when the profile asks for a second opinion and the resolver finds none. Its text is one of two:

- `the crosscheck list is empty, so no second opinion can be asked.`
- `the crosscheck at "<effort>" found no model in the crosscheck list from another family.`

The second text also appears when the catalogue states no family for the primary or for every candidate, because the resolver cannot prove a difference. An absent top-level `crosscheck` list makes every allowed model a candidate. An empty list makes none.

### `excluded`

Each row names a model that did not qualify:

| Field | What it is |
| --- | --- |
| `name` | The alias. |
| `ref` | The ref from the allowlist. |
| `reason` | Why it did not qualify. |
| `rungs` | Every rung the model declares. |
| `reaches` | The highest rung the model reaches, when the catalogue places one. |

A model that the resolver spent never appears in `excluded`.

## `judge`

`judge` is a union of two shapes.

`used`:

| Field | What it is |
| --- | --- |
| `profile` | The profile the judge chose. |
| `confidence` | The probability the judge reported, when its arm reports one. |
| `escalated` | True when the resolver asked for one effort step more. |
| `effort` | The effort the escalated row used. |
| `alternatives` | The judge's other readings, best first, without the chosen profile. |

`skipped`:

| Field | What it is |
| --- | --- |
| `reason` | Why the judge gave no profile. |

A judge that is absent, that gets no task, that gets a named profile, or that fails all produce `skipped`. The table is complete in every one of those cases.

## `problems`

`status` is `"problems"`. `problems` is one string, with one mistake per line, and each line names the key.

The answer carries `models` when the allowlist holds at least one spendable model, the priority order is valid, and every model can run. It carries `crosscheck` too when the crosscheck list is valid. Both arrays have the same shape as on a `resolved` answer. A problem in the allowlist, the priority order, or the crosscheck list withholds the array that depends on it.

## `setup`

`status` is `"setup"`. The answer carries `provider` when the starter file states one, the starter `models` in priority order, the starter `profiles` as `name` and `effort`, and `source`, the path the tool would write.

## `declined`

`status` is `"declined"`. `source` is the config file that holds the `setup` marker.
