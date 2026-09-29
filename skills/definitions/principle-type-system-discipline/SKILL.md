Use the type checker as a proof assistant. Make illegal states unrepresentable, brand your primitives, parse at the boundary, match exhaustively.

Without this every invalid state is a runtime surprise. A string that is sometimes an id and sometimes a name. A config object whose fields agree only by convention. A switch that silently ignores the variant added last month. Each one compiles, ships, and fails where the user can see it, because the checker was never told what valid means.

The tests are three questions you can quote. Can you write one sentence explaining when this combination of fields is valid. If not, the type admits states nobody can defend, so split it until each variant explains itself. Can a UserId be passed where an OrderId belongs. If yes, the primitives are bare strings wearing names, so give them brands. Does adding a variant break the build. If the new case compiles without touching every match, the matches are not exhaustive, and the next variant will slip through the same hole.

The moment is the boundary. Data enters from outside, untyped or loosely typed, and you parse it once into the narrow type the inside uses. Never validate at use. Parse at the edge, then let the checker carry the proof inward, so every function past the boundary takes valid data by construction instead of by hope.

principle-make-states-unrepresentable owns the language-agnostic claim; this skill owns the concrete forms: brands, boundary parsing, exhaustive matches.
