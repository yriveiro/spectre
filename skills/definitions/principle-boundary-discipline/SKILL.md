# Principle: Boundary Discipline

Validation belongs where data enters the system and nowhere else. Inside, types are the proof and code trusts them. Scattered null checks, repeated config parses, and defensive `unknown` guards cost readers more than the logic they protect.

Two questions settle most cases. Does this data cross a system boundary right now? Can a pure function handle the logic? System boundaries are CLI arguments, config files, environment variables, request bodies and headers, file and socket reads, database rows, queue messages, and external API responses. A boundary is where trust does not come from your own types, whereas a pass-through layer belongs to `principle-laziness-protocol`.

## The moves

**Parse once at the entry point and pass the domain type inward.** One boundary function turns raw bytes, CLI arguments, or JSON into a domain type. Returning `unknown` or `Record<string, unknown>` carries raw wire state instead of parsing it.

**Trace where the value entered and delete redundant interior guards.** State a value's origin in one sentence. When its caller sits inside this repository, the signature is the contract. Count a guard's callers, hoist external checks to the single entry point, and delete unreachable interior copies (`principle-evidence`).

**Extract pure logic out of route handlers, CLI entries, and framework hooks.** Name the pure function before writing the wiring. The handler reads input, calls one pure function with no framework imports, and formats the result. Test that pure function directly with no framework harness.

**Narrow `unknown` at the edge, never mid-chain.** An `unknown` parameter is a promise to validate. Narrow before the boundary body starts, or accept the narrowed type instead of placing type guards halfway down a call chain.

**Keep transport, storage, and framework types off the public surface.** Request objects, raw database rows, and third-party library shapes belong inside the adapter. Exporting them turns every caller into a second adapter and makes wire changes breaking changes.

**Convert external throws into domain errors once at the boundary.** Catch and translate library errors at the entry point instead of scattering `try/catch` blocks inside handlers and callers.

## What this principle is not

- **Not an argument for validating less.** Every external input is untrusted, including checked-in fixtures and your own config files.
- **Not deleting external checks by reflex.** Move an unparsed external value's check to the edge first, then delete downstream copies.
- **Not a licence to strip decision-hiding boundaries.** A boundary that hides a real decision reduces load, and `principle-laziness-protocol` owns pass-through layers.
- **Not a question settled by guessing.** `ripwire --uses`, `--callers`, `--impact=TYPE`, and `--grep` (`reads=`, `vals=`) show where shapes enter and which guards sit below them.
