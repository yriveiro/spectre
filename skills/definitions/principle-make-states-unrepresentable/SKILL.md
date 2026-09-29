# Principle: Make States Unrepresentable

A shape that cannot hold the wrong value beats a shape plus a check. The
compiler is a proof assistant you already paid for, and the whole discipline is
spending it on the states you would otherwise guard at runtime, one `if` at a
time, forever.

The test is a comment. If you can write one sentence explaining when this
combination of fields is valid, the type is too loose, and the fix is a different
shape rather than a narrower check. `{ completed: boolean; completedAt?: Date }`
admits `completed: true, completedAt: undefined`, which means nothing, and it
admits it silently: nothing fails, nothing warns, and the bug is a runtime
question somebody has to remember to ask. `{ kind: "open" } | { kind: "done"; at:
Date }` cannot be built wrong, and a new state added next month breaks the build
instead of waiting for a call site to handle it.

That is why this is one principle and not two. "Make illegal states
unrepresentable" and "model the domain in a structure" are the same claim at two
resolutions: a bag of optional fields and an `if/else` chain are both a domain
rule written in a language the compiler cannot check. Every structure worth
reaching for here, a sum type, a state machine, a lookup table, a branded id, a
module organized around the domain rather than around load-validate-save, is a way
of moving one rule out of prose and into a shape.

The two neighbouring disciplines own their halves. Where a value enters and gets
parsed is `principle-boundary-discipline`. Whether the extra structure earns the
indirection it adds is `principle-laziness-protocol`, and this leaf is the half
where the answer is yes.

## The moves

**Ask whether you can write the comment.** Can I write a sentence explaining
when this combination of fields is valid? If yes, the type is too loose. This is
the one question that decides most cases, it takes ten seconds, and it has a
mechanical answer.

**Split the bag into a sum type.** A boolean plus an optional field that depends
on it is a union wearing a disguise. Name the variants, and let the compiler
require that every site handle all of them. An unannotated `match` in Rust, a
`never`-typed binding in TypeScript, sealed-class exhaustiveness in Kotlin: the
idiom differs, the job is the same, and the job is to make the compiler fail when
a variant appears that nobody handled.

**Brand primitives that mean different things.** `UserId` and `OrderId` are both
strings and must not be interchangeable, because a caller who passes the wrong one
gets no complaint from the compiler and a very clear complaint from production.
Validate once at creation and trust the type downstream, which is the boundary
half of the same idea.

**Build the type up from what you want, not down from what you have.** A non-empty
list is a head plus a rest, not a list with a length check. A valid time range is a
start plus a duration, not two timestamps you must remember to keep ordered. Most
invariants that seem to need a runtime check are one construction away.

**Push a partiality check up into the type, then stop.** A null check, a runtime
assertion, or a "this should never happen" throw marks the exact place a type is
too weak. Move the fact into the shape and the throw becomes unreachable. Then
stop: the type system's job is to track the cases each use site must handle, not to
describe the data as precisely as possible. If nothing would otherwise panic, keep
the plain type.

**Do not lie to the compiler.** Every `any`, every `as`, every `assertNotNull` is a
place the proof stopped and a latent crash took its place. Either the fact is
provable and belongs in the model, or it is not provable and the cast is a hazard
you have chosen to carry. `ripwire --seams` and the typecheck find these
mechanically; read where each one came from rather than silencing it.

**Derive the second value, do not synchronize it.** Two booleans that must agree
are one fact stored twice, and the rule keeping them equal is invisible at both
sites. Compute the second from the first, and the class of bug goes away rather
than being tested for.

**Reach for the structure, then check it removes something.** A state machine
instead of scattered lifecycle flags. A lookup table or registry instead of a
branch chain spread across files. A module organized around one body of domain
knowledge instead of one named for its steps, because execution order is not
ownership. Each is worth it only if it deletes branches, duplicated rules, invalid
states, or lifecycle risk. An abstraction that adds indirection and removes none
of those is a layer, and that is `principle-laziness-protocol`.

**Watch the two tells.** A new feature that grows an existing `if/else` by one
more branch, and a second boolean that has to stay in sync with the first. Both
mean a rule is being repeated in a language nothing checks. Phase-named modules
are the third tell: `load`, `validate`, `transform`, `save` describes a sequence,
and the same domain rule gets restated in each step.

**Derive from the authoritative schema.** When a protocol buffer, an OpenAPI
document, a GraphQL schema, or a migration defines the shape, generate the type
rather than hand-rolling a parallel one that will drift. A second hand-written
copy of a shape another file owns is `principle-hygiene`'s "one decision, one
source", reached from the type side.

## What this principle is not

Each line here names something a reader would otherwise do, which the moves above
do not stop.

- **Not a licence to model the future.** A state machine for a lifecycle with two
  states today is a third thing to keep in step with the second. Model the states
  that exist, and split the union when a fourth arrives.
- **Not a demand for precision everywhere.** Strengthening a type nobody can get
  wrong is a cost with no return, and the check for it is whether anything would
  otherwise panic. "Nothing would" is the answer that stops the work.
- **Not a number of types.** There is no threshold for how many cases a sum should
  have. A boolean that means two different things is wrong at two, and a union of
  nine variants is not wrong for being nine.
