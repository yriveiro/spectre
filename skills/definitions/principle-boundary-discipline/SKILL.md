# Principle: Boundary Discipline

## What this principle is

Validation belongs where data enters the system, and nowhere else. Inside, the
types are the proof and the code trusts them. The wiring around the logic is thin
and mechanical.

The failure this names is scattered validation. A null check in a helper that no
caller can reach with null. A second parse of a value the config loader already
parsed. A guard that exists because one function takes `unknown` and the next one
does not. Each guard is cheap on its own. Together they cost a reader more than
the code they protect, and they buy a safety the edge already provided.

Two questions settle most cases. Is this data crossing a system boundary right
now? If yes, validate it. If no, the check is redundant. Can this be a pure
function that the shell calls? If yes, extract it.

The boundaries are CLI arguments, config files, environment variables, request
bodies and headers, file and socket reads, database rows, queue messages, and
every value from an external API. Once a value crosses one, it is a domain value,
and the rest of the system treats it as trustworthy.

A boundary is a place where trust does not come from a type you wrote. That is not
the same as a layer. A layer that only forwards is not a boundary, so it needs no
validation, and that is `principle-laziness-protocol`.

## Core values

**Validate once, at the edge.** A check at the boundary has one site and one name,
and a failure there points straight at the input. The same check four frames
deeper is a riddle: the reader has to work out which caller broke the contract.

**The type is the invariant.** A parse that returns a domain type moves the
guarantee into the signature, and every consumer inherits it. A parse that returns
`unknown` and prints a warning moves nothing, and the next caller starts the
argument again.

**Trust is a property of position, not of caution.** Code inside the system does
not re-check what the edge proved. The alternative is a codebase where every
function defends against a bug that was already ruled out, and where a real bug
disappears into the noise.

**A guard no input can reach is a check that cannot fail.** This is
`principle-evidence` pointed at a runtime check instead of a test. A branch that
never fires proves nothing, and it costs a line on every read of the function.

**The public surface speaks the domain, not the wire.** A transport type, a
storage row, and a framework request object are the boundary's private
representation. Exporting one of them through your own API turns every consumer
into a second adapter and makes the next change to the wire format a breaking
change.

## Strategies

**Parse at the entry point and pass the parsed value inward.** One function turns
raw bytes, or an argument list, into typed state. Everything downstream takes the
typed value. This is the shape that makes "can this be null" a question with no
answer inside the system.

**Move the logic out of the wiring.** A route handler, a CLI entry, a framework
hook: it reads the input, calls one pure function, and formats the result. The
function it calls carries no framework in its signature, so the test needs no
framework either. That is the practical test of whether the extraction happened.

**Delete the check the edge already made.** Find the second call site of a guard
that only makes sense for the first. Count the callers before deciding, because a
guard called from four places on genuinely external input is doing its job.

**Narrow once, at the type.** A type guard in the middle of a call chain is a
boundary in disguise. Either the value arrives already narrowed, or that function
is the edge and should do the narrowing before its body starts.

**Keep the domain type free of the wire.** A value typed `Record<string, unknown>`
because that is what the JSON parser returns has not been parsed. It has been
carried.

**Convert errors once, at the edge.** Turn an external failure into your own error
type where it enters, and use that type everywhere inside. A caller that has to
know which library threw is holding a value the boundary should have replaced.

## Tactics

**Ask where the value entered.** Pick a value in the code you are writing and
answer in one sentence. If the answer names a caller in the same repository, the
type is the contract and every check below it is redundant.

**Count the callers of a guard.** The same null check in three places for one
entry point is a boundary nobody has named yet. Move it up to the single place the
value enters, then delete the copies.

**Name the pure function before writing the wiring.** "What function does this
handler call" is a design question. "What does this handler do" is a description.

**Read the public type as a caller sees it.** If a consumer can build the type
from a framework object or a raw row, the wire type is in the surface and the
extraction did not finish.

**Hunt for an `unknown` nobody narrows.** An `unknown` in a signature is a promise
to validate. A promise nobody keeps is the same failure as a check that cannot
fail, wearing a type instead of an assertion.

**Move the test off the framework.** Logic with no framework import can be tested
with no harness, and the friction of writing that test is what tells you whether
the split is real.

## What this principle is not

- **Not an argument for validating less.** Everything crossing in from outside is
  untrusted, including the config file you wrote last week and the fixture checked
  into the repository. This principle is about where the check goes, not about
  how many there are.
- **Not "delete the defensive check" as a reflex.** A value that came from
  outside and has not been through an edge is not covered by this principle. Move
  it to the edge first, then delete the copy downstream.
- **Not a licence to remove layers.** A boundary that hides a decision is load
  reduction and stays. A layer that only forwards is `principle-laziness-protocol`,
  which is a different question with a different answer.
- **Not a schema instead of a type.** A validator at the edge that returns
  `unknown` has done half the job. The point of the edge is the typed value on
  the far side of it.
- **Not a question you answer by reading.** `ripwire --uses` on the value and
  `--callers` on the check say which guards sit below the point it entered, and
  a guard with no caller is one the edge already made.
- **Not a question you answer by reading.** `ripwire --uses` on the value and
  `--callers` on the check say which guards sit below the point it entered, and
  a guard with no caller is one the edge already made.
