# Principle: Type System Discipline

Use the type checker as a proof assistant. Parse at the boundary, brand the
primitives, model the invariant as a union, and match exhaustively, so that the
next thing to arrive is a build failure rather than a runtime surprise. Without
it every invalid state is discovered by somebody else: a string that is sometimes
an id and sometimes a name, a config object whose fields agree only by
convention, a switch that silently ignores the variant added last month. Each
compiles, ships, and fails where the user can see it, because the checker was
never told what valid means.

The language-agnostic version of this is `principle-make-states-unrepresentable`,
and this leaf does not restate it. The proof-assistant framing, the branded
primitive, the parse at the edge, the exhaustive match, and the bag-of-optionals
example are that leaf's claim, once, in the form that survives a change of
language. What follows is the TypeScript spelling of those, plus the four things
that leaf does not hold: the compiler flags that make the discipline mechanical
rather than a habit, the literal-narrowing choices that silently undo it, the
`never` idiom that turns exhaustiveness into an error, and the point at which a
type should be left alone. Where a move below is the same claim, it is marked as
one and stated once.

The tests are three questions you can quote. Can you write one sentence
explaining when this combination of fields is valid. If you cannot, the type
admits states nobody can defend, so split it until each variant explains itself.
Can a `UserId` be passed where an `OrderId` belongs. If it can, the primitives
are bare strings wearing names, so brand them. Does adding a variant break the
build. If a new case compiles without touching every match, the matches are not
exhaustive, and the next variant will slip through the same hole.

## The moves

**Turn on the flags that make the discipline mechanical.**
`noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`,
`noPropertyAccessFromIndexSignature`, `noUncheckedSideEffectImports`. Each turns a
runtime surprise into a build failure, and a compiler flag is the only version of
this discipline that costs nothing at a call site. This is the move the
language-agnostic leaf cannot make, because it is not a claim, it is a setting,
and it is the highest-yield change on this list.

**Use `unknown` at the edge, and `any` nowhere you did not mean to lose the
checking.** `any` switches off checking for everything downstream, including the
values you were not thinking about when you wrote it. `unknown` is a value the
compiler will not let you touch until you narrow it, which is the whole reason to
put it there.

**Write `as const satisfies T`, not `as T`.** `as const` keeps each literal's own
members, so the caller gets `"retries"` rather than `string`. `satisfies` checks
the object against the shape without widening what it is. `as T` does the second
half only, and the widening it introduces is the mistake the type existed to
prevent. This is a spelling choice with a specific failure mode, so it has no
language-agnostic counterpart.

**Know that a literal array is not a union until `as const` is on it.** `const
variants = [{ kind: "open" }, { kind: "done" }]` infers `{ kind: string }[]`, so
there is nothing to match exhaustively on and every `kind === "done"` comparison
compiles against a `string`. With `as const` the array is a union of object
literals with a literal discriminant. The exhaustive match is that leaf's claim;
the reason it silently fails in TypeScript is this one.

**Keep the one `default` you keep, and end it in `never`.** A `default: return
assertUnreachable(x)` with `const assertUnreachable = (x: never): never => { throw
new Error(...) }` makes a new variant a compile error naming the case you forgot.
The moment a `default` starts returning a fallback value, the exhaustiveness is
gone and the new variant takes that path silently, which is the exact failure the
check was for.

**Brand primitives with a unique symbol, and export the constructor rather than
the brand.** `type UserId = string & { readonly __brand: unique symbol }`,
produced only by the parse that made it, so a swap is an error at the call site
that makes it. The brand is that leaf's claim. The TypeScript part is that the
constructor has to be the only way one is made, which means grepping for the cast
that bypasses it, because a brand with a public cast is a suggestion.

**Narrow on the discriminant, not on truthiness.** `if (x.kind === "done") x.at`
narrows because the discriminant is a total function of the variant. `if (x.at)`
narrows a field that is legitimately absent in another variant, and the first
variant with an optional field reopens the hole the union was built to close.

**Put the invariant in a union of objects, and let the compiler require each
site.** Same claim, stated once and in its TypeScript form: a union of object
literals with a literal `kind`, a `switch` on it with no `default`, and the
`never` idiom above. A variant added next month becomes a list of compile errors
naming every site rather than a runtime question somebody has to remember to ask.

**Export the guard, and let the signature be the guarantee.** A hand-written
`isConfig(value: unknown): value is Config`, or a schema whose output type is the
domain type. Every function past the parse takes `Config`, and a caller holding
raw JSON cannot call it at all. Where the parse lives is
`principle-boundary-discipline`'s; what it returns is this leaf's.

**Treat an `unknown` nobody narrows as a promise nobody kept.** A signature taking
`Record<string, unknown>` because that is what the parser returned has carried the
value rather than parsed it, and the function body is now the boundary, spread
across whatever it happens to touch. A parameter typed `unknown` is a contract to
narrow before use, and the honest version returns a guard or throws.

**Let the build be the oracle for a signature change.** After narrowing a type or
adding a variant, `bun run typecheck` names every site that now passes the wrong
thing. That is the "does adding a variant break the build" question run as a
command rather than reasoned about, and it is the answer this leaf can give that
the language-agnostic one cannot.

**Make the cast findable.** `@ts-expect-error` fails the build when the
underlying problem is fixed, which `as` never does. `@ts-ignore` is `any` with a
comment on it. Prefer fixing the type, and where the type genuinely cannot express
the fact, `expectTypeOf` in a `*.test-d.ts` file keeps the property you are asking
the compiler to check.

**Write the type-level test, because it is a test.**
`expectTypeOf(parseConfig).toEqualTypeOf<Config>()` fails the build when the
return type drifts, which no runtime test catches. This is where the checker and
the suite meet, and it is how "the compiler still proves it" gets answered after
a refactor that moved a signature three files away.

**Stop strengthening where nothing can go wrong.** Same claim, stated once, in its
TypeScript form: a number. Branding a value that nothing can confuse, or a union
over a value with one construction path, is cost with no return, and the check is
whether anything would otherwise panic. "Nothing would" is the answer that stops
the work.

## What this principle is not

- **Not a replacement for `principle-make-states-unrepresentable`.** That leaf
  owns the claim and this one is its TypeScript spelling plus the compiler flags.
  Reading one is not choosing between two disciplines. It is the same discipline
  at two resolutions, and the flags are the half with no language-agnostic form.
- **Not a licence to enable every flag in a change you are only passing through.**
  `noUncheckedIndexedAccess` on a tree with four hundred hits is its own change
  with its own risk, and folding it into a feature is how the feature gets
  reverted. Name it, land it on its own, then keep using it.
- **Not a runtime validator written in the type system.** A type says what the
  compiler can prove about a value. It says nothing about the value that arrived,
  the parse is code, it runs, and it needs its own tests.
