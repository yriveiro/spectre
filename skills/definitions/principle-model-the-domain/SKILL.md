Encode the domain in a structure instead of scattering it across conditionals.

Every conditional repeats a fact about the world. A state machine, a map, or a discriminated union states it once. When the fact lives in one place, a new case means adding one entry, and the compiler tells you every site that must handle it. When the fact lives in five if/else chains, a new case means finding all five, and the one you miss ships.

Without it the code keeps working right up until it does not. Each branch reads fine on its own. Nobody notices the same decision made six times in six files until the seventh case arrives and three of the six get updated. The bug that follows is not a logic error. Nobody reasoned wrongly. The shape of the thing was never written down, so there was nothing to be wrong against. An invalid state stays buildable, and sooner or later someone builds it.

The test is simple: a new feature grows an if/else chain by one branch. That is the sign you skipped it. Ask what the branches are all deciding, give that decision a name and a type, and make the impossible value unconstructible. A match on a union is a decision made once. A chain of string comparisons is a decision remade at every site.

Reach for this the moment a second branch appears beside the first and a third is already imaginable. Do not reach for it for a single flag with one reader. One check is a check, not a model, and wrapping it in machinery is the clutter that principle-laziness-protocol exists to refuse. The line between them: if removing a branch would delete the abstraction too, you built the abstraction too early.

This owns the shape of what the code is about. Whether any claim about that shape has actually been checked is principle-verification.
Adapted from pstack (MIT, Lauren Tan).
