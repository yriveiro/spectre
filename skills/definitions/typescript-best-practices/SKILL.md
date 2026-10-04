# TypeScript best practices

The syntax for the type discipline: what each form looks like in TypeScript, when
to reach for it, and the code that shows it working.

`principle-type-system-discipline` is the one to load when you are deciding
whether a type should be strengthened, and when it should be left alone. This is
the one to read while you are typing it.

## Start

1. State
2. Brand
3. Parse
4. Narrow
5. Match
6. Keep
7. Derive
8. Call

## Phase A: State

A variant is a union of object literals with one literal discriminant field.
Every variant carries the field, and each value appears once.

```ts
type DiffState =
  | { kind: "loading" }
  | { kind: "ready"; diff: GitDiff }
  | { kind: "error"; error: string };
```

The shape this replaces is a boolean with optionals, where `loading: true` with
both a `diff` and an `error` set is a value TypeScript is glad to accept. Pick
one discriminant name and keep it.

Where a fact is a range, the type is the parts rather than a comment:

```ts
type NonEmpty<T> = [T, ...T[]];
type Pairs<T> = [T, T][];
type TimeRange = { start: Date; durationMs: number };
```

A non-empty array, an even-length array, and a time range are three values that
cannot be written wrongly, so no function downstream re-checks them. Keep
`durationMs` a plain number and brand it only when a raw number would really be
passed where a duration belongs. Derive the reading you need on top, such as
`rangeEnd()`, rather than storing a second field that can disagree.

## Phase B: Brand

A brand is an intersection with a field nothing else produces, made only by the
function that validated the value:

```ts
type AgentId = string & { readonly __brand: "AgentId" };

const parseAgentId = (input: string): AgentId =>
  isUUID(input) ? (input as AgentId) : fail(`Invalid agent id: ${input}`);
```

A `UserId` where an `OrderId` belongs is now a build failure. Keep the
`readonly __brand: "X"` spelling so the next reader recognises it, and keep the
constructor the only way one is made, because a brand with a public cast is a
suggestion. Grep for the cast that bypasses it when you find one.

## Phase C: Parse

Outside data is `unknown`, never `any`. The sources are RPC payloads,
`JSON.parse`, `postMessage`, IPC, file contents, the environment, and query
results.

```ts
const handle = (input: unknown) => {
  if (typeof input !== "object" || input === null || !("foo" in input)) return;
  // narrowed, and the compiler checks the access
};
```

For a shape with fields, prefer the repository's own schema library over a
hand-written guard. Let one schema own the validation and derive the type from
it, so there is no second copy to drift:

```ts
const User = z.object({ id: z.string().uuid(), role: z.enum(["admin", "member"]) });
type User = z.infer<typeof User>;
const parseUser = (input: unknown): User => User.parse(input);
```

`safeParse` where failure is a branch you handle. The library the codebase
already trusts, not a new dependency for one guard.
`principle-boundary-discipline` owns where the parse lives and what stops at it.

An `as` is a runtime crash waiting for the input that contradicts it, and a cast
is earned only after the type system verified the claim. Every `as` in a
function you are refactoring names one of four causes, and three are fixable: a
missing discriminant, a source type too wide such as `Record<string, unknown>`, or
an untyped boundary that wants a parse function. The fourth, a fact TypeScript
genuinely cannot express, is where a brand or a `satisfies` belongs. Name which
one you are looking at before you remove it.

## Phase D: Narrow

Work down this order and stop at the first one that does it:

1. a `switch` on the discriminant
2. `"key" in obj`, which narrows to the variants carrying the key
3. `typeof` or `instanceof`, for primitives and class instances
4. a user-defined guard
5. `as`, and only after validation

```ts
const area = (s: Shape): number =>
  "radius" in s ? Math.PI * s.radius ** 2 : s.width * s.height;
```

A guard must verify what it claims, and it is named `isX` or `hasX`. A guard
that lies is worse than a cast, because the bug hides behind a name that says it
is safe. Narrow on the discriminant rather than on truthiness: a field that is
legitimately absent in another variant is not a check.

## Phase E: Match

The default arm assigns the discriminant to a `never`, so a variant added next
month is a build error naming the case you forgot.

```ts
function area(s: Shape): number {
  switch (s.kind) {
    case "circle":
      return Math.PI * s.radius ** 2;
    case "rect":
      return s.width * s.height;
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}
```

In a `void` switch, `void _exhaustive;` where the return is. The instant a
default returns a fallback, the exhaustiveness is gone and the new variant takes
that path silently, which is the exact failure the check was for.

## Phase F: Keep

`satisfies` checks a value against a shape and leaves its literal types alone.
`as` does the second half only.

```ts
// as Config checks the shape, and widens theme to string.
const config = { theme: "dark", cols: 3 } as Config;

// satisfies Config checks the shape, and theme is still "dark".
const config = { theme: "dark", cols: 3 } satisfies Config;
```

A literal array is not a union until `as const` is on it. Without it,
`const variants = [{ kind: "open" }]` infers `{ kind: string }[]`, every
`kind === "done"` comparison compiles against a `string`, and the exhaustive
match in Phase E has nothing to match. Write `as const satisfies
readonly Variant[]`.

Leave a type alone when every operation on it is total:

```ts
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
```

`[]` sums to zero, so nothing forces a lie. Strengthen the type where the loose
one does force one, and the tells are `!`, `arr[0] as T`, and a throw that says
"should never happen". A branded number and a union with a single construction
path are both cost with no return.

## Phase G: Derive

When a proto, an OpenAPI document, a GraphQL schema, or a migration already
defines a shape, take the type from the generated one:

```ts
import type { ChecksMessage } from "./generated";
const renderChecks = (s: Pick<ChecksMessage, "totalCount" | "checks">) => {};
```

`Pick`, `Omit`, `Parameters`, `ReturnType`, `Awaited`, and `typeof` come before a
new interface. A hand-written copy of a generated shape is a bug that lands the
day the schema changes.

## Phase H: Call

Pass one object rather than four positional arguments, so the order is readable
at the call site and a swap does not compile. Skip it on a hot path: per-frame
rendering, a tokenizer, a parser, anything in a tight loop where the allocation
is the cost.

```ts
openFile({ uri, selection: { startLineNumber: 10, startColumn: 1 } });
```

Run the real thing in a test. Mock only what cannot run locally, and verify a UI
in a running build rather than a render of the component. Ship a structured
logger call carrying enough context to debug from an id. `console.log` in
shipped code is a line somebody has to delete later.

## Outputs

Types that fail the build when a fact stops being true, with one parse at each
edge and no cast that was not earned.
