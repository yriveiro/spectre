# Effect best practices

The Effect this repo ships is `effect` pinned to exactly `4.0.1` in `package.json`, and that
pin is the target every spelling below holds to.

This body replaces the `effectts-skills` repo for this codebase.

`principle-evidence` owns checking a claim at source. This records what that check returned,
so a near-miss is not rediscovered every session.

## Start

1. Read the installed Effect
2. Model the data
3. Brand the primitives
4. Give the failure its own type
5. Build the service, compose the layer
6. Compose the effect
7. Scope the work that outlives the call
8. Keep the edge outside

## Phase A: Read the installed Effect

`AGENTS.md` holds the version rule: read OpenCode at its tag, read Effect at the pin. For
Effect the pin is the source, because `node_modules/effect` holds the build that runs and
there is no checkout to read instead.

An export name is a claim, and the installed declaration settles it. Open
`node_modules/effect/dist/<Module>.d.ts` and read the declaration before writing the call. The
declaration carries its own worked example, and that example is the spelling to copy.

Two files hold this body to the pin. `verified.ts` beside it records the version the body was
checked against, and `probe.ts` beside it exercises every symbol used here. `bun run
typecheck` compiles the probe, so an export that moves or changes shape in a new Effect
version breaks the build at the symbol rather than in a reader's afternoon. When the pin
moves, `test/skills/effect-version.test.ts` fails until the body and the stamp move
together, and `/effect-align` is the routine that does it.

## Phase B: Model the data

Default to `Schema.Struct`. Reach for `Schema.Class` only when the value carries behavior the
shape cannot express, which means methods, `Equal`, `Hash`, or a primary key. Reach for
`Schema.TaggedClass` when the value is one arm of a union, because `_tag` is what
`Match.valueTags` matches on.

```ts
import { Schema } from "effect"

class Circle extends Schema.TaggedClass<Circle>()("Circle", { radius: Schema.Number }) {}
class Square extends Schema.TaggedClass<Square>()("Square", { side: Schema.Number }) {}

const Shape = Schema.Union([Circle, Square])
type Shape = typeof Shape.Type
```

One module holds the whole domain vocabulary: `Schema.Struct`, `Schema.Union`, `Schema.Array`,
`Schema.Literals`, and `Schema.Class` all live in `Schema`.

Delete the separate `interface` next to a schema. The schema is the single source, and the
interface is a second copy that drifts the first time the schema changes.

## Phase C: Brand the primitives

Brand a primitive when two values of the same underlying type mean different things and a
wrong mix is a bug the compiler would otherwise allow. A `UserId` and an `OrderId` are both
strings, and the argument order is what a swap defeats.

```ts
const UserId = Schema.String.pipe(Schema.brand("UserId"))
type UserId = typeof UserId.Type
```

`Schema.brand` narrows the TypeScript output type only. Read its own note before trusting it:
it does not change the schema's runtime AST and it adds no runtime check, so a value that
arrived from `JSON.parse` is still a plain string at runtime. Where the value comes from
outside the program, decode it through a schema that carries the validation, and let
`Schema.fromBrand` pair a constructor's checks with the brand.

Brand every entity id, not only the obvious one, and brand the second value in a pair even
when the first is already branded, because an unbranded second argument is exactly the swap
the brand exists to catch.

Brand a constrained base rather than a bare `Schema.String`, so the schema and the nominal
type agree:

```ts
const NonEmptyName = Schema.NonEmptyString.pipe(Schema.brand("NonEmptyName"))
```

## Phase D: Give the failure its own type

A tagged error class is a schema, so it validates on the way in and carries `_tag` for
matching on the way out. It is yieldable, so a failure needs no `Effect.fail` wrapper.

```ts
import { Effect, Schema } from "effect"

class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  userId: UserId,
}) {}

const getUser = Effect.fn("getUser")(function* (id: UserId) {
  const user = yield* findUser(id)
  if (!user) yield* new UserNotFound({ userId: id })
  return user
})
```

One type per distinct failure reason, each carrying the fields a reader needs to act. A single
generic error forces every handler to re-derive which failure it was holding.

Recover with the tag, so the error channel stays typed. `Effect.catchTag` handles one tag and
`Effect.catchTags` handles a set. `Effect.catchAll` erases the channel you just built, so it
is the wrong tool inside a service.

```ts
const program = getUser(id).pipe(
  Effect.catchTag("UserNotFound", (e) => Effect.succeed(`missing ${e.userId}`)),
)
```

A defect is a bug, and `Effect.orDie` at the entry point is where it becomes a crash. Handle
defects once at that boundary and nowhere below it. Inside a service, raise a typed error and
nothing else.

## Phase E: Build the service, compose the layer

A service is a `Context.Service`. The class form takes the shape as a type parameter and the
key in the second call, and the key is what the layer and the `yield*` agree on.

```ts
import { Context, Effect, Layer } from "effect"

class Users extends Context.Service<Users, {
  readonly findById: (id: UserId) => Effect.Effect<User, UserNotFound>
}>()("Users") {
  static readonly layer = Layer.effect(
    Users,
    Effect.gen(function* () {
      const findById = Effect.fn("Users.findById")(function* (uid: UserId) {
        return yield* lookup(uid)
      })
      return { findById }
    }),
  )
}
```

Give each service its own `static readonly layer`. Effect memoizes a layer by reference, so a
parameterized constructor builds a fresh layer on every call and throws the sharing away.
Store it in a module constant and provide the constant.

Provide once, at the entry point, and let the requirement in the type carry the wiring down.
Scattered `Effect.provide` calls make the same layer look free when each call builds another
one.

Three verbs, and the difference is what survives:

```ts
// provide: the dependency stays private to the consumer
Effect.provide(program, DatabaseLayer)

// provideMerge: both the service and the thing that built it stay available
appLayer.pipe(Layer.provideMerge(DatabaseLayer))

// mergeAll: resolves nothing, so it fixes an Effect<A, E, Svc> that is not
// assignable to never
Layer.mergeAll(A, B, C)
```

`Layer.provideMerge` keeps the provider's own requirements available to the consumer, which is
the whole difference from `provide`. The package's own note says to prefer `provide` when the
dependency should stay private.

## Phase F: Compose the effect

`Effect.gen` for sequential composition, because it reads like the async code it replaces.
`Effect.fn` when you want a name in the trace, which is every service method, because a
generator that yields a call it cannot name is a span with nothing in it.

```ts
const program = Effect.gen(function* () {
  const users = yield* Users
  const found = yield* users.findById(id)
  return found.name
})
```

`Effect.fn(name, spanOptions?)` returns the builder and the builder takes the body. The built
value is a plain function rather than an `Effect`, so it carries no `.pipe` of its own. Pipe
the call result, or do the piping inside the body:

```ts
const buildUser = Effect.fn("buildUser")(function* () {
  return yield* program
})

const timed = Effect.timeout("5 seconds")(buildUser())
```

## Phase G: Scope the work that outlives the call

The forks are `Effect.forkScoped`, `Effect.forkChild`, `Effect.forkDetach`, and `Effect.forkIn`,
and they differ in what they promise, which is the thing to check. `forkScoped` ties the fiber
to the enclosing scope, so it is the default. `forkDetach` outlives the parent, which is
exactly why it needs a finalizer you write yourself:

```ts
const fiber = yield* Effect.forkDetach(work)
yield* Effect.addFinalizer(() => Fiber.interrupt(fiber))
```

A detached fiber whose scope closes before it finishes is the leak that finalizer prevents.
Never wrap a long-running child process in `Effect.scoped` and then fork the result, because
the scope closes on the way out and the process becomes unreachable. Make the scope with
`Scope.make`, hand it to `Scope.provide` or `Scope.use`, and fork only the collection of what
it produced.

A child process is `ChildProcess.make`, a tagged template, composed with `ChildProcess.pipeTo`
and run through a `ChildProcessSpawner` made by `ChildProcessSpawner.make`. `Command` in
`effect/cli` builds a program rather than a process. This repo runs on Bun, so `Bun.spawn` is
the other route and it is the one `AGENTS.md` asks for by default.

## Phase H: Keep the edge outside

The edges this plugin has are the OpenCode plugin context, the filesystem, the network, and the
environment. Each one is `unknown` until something decodes it, and the decoding belongs in a
schema rather than in a hand-written guard. `principle-boundary-discipline` owns where that
parse lives.

The environment is `Bun.env` and the filesystem is `Bun.file` and `Bun.write`.
`AGENTS.md` holds the full table and names the two approved `node:*` exceptions.

For configuration, `Config` is schema-driven and every primitive takes a capital letter:

```ts
import { Config, ConfigProvider } from "effect"

const Port = Config.Number("PORT").pipe(Config.withDefault(3000))
const Secret = Config.Redacted("API_KEY")

const provider = ConfigProvider.fromEnv()
```

`Config.schema(codec, path)` builds one from a schema, which is the route to take when the
value needs validation rather than only a type. `Config.unwrap` turns a `Config<Redacted<A>>`
into an `Effect<Redacted<A>>`, and `Redacted.value` is the one place the secret comes out. A
secret in a log line is the failure this prevents.

For HTTP, build the client once inside the service's layer and decode every response through a
schema. `HttpClientResponse.schemaBodyJson(Schema)` against a hand-written `JSON.parse` and a
cast is the difference between a checked boundary and an unverified one.

## Outputs

Effect code that compiles against the pin, with each failure reason a named type, each
dependency provided once, and each edge decoded by a schema. A snippet you could not have
compiled here does not go in.