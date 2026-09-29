Remove complexity first, then build on the simpler base. New code on top of dead code inherits the dead code's weight.

Without this every addition costs more than it should. You read around dead branches to find the live path. You extend an abstraction that nothing needs. You wire a feature into plumbing that exists only because nobody deleted it. The change works, and the codebase gets heavier by both the old weight and the new. Do this for a year and the simple change becomes the one nobody volunteers for.

The original states no falsifiable test, so say that plainly. No single question proves you subtracted enough. Name the moment instead. Before you add anything, read the area for what can go first: dead code, unused flags, wrappers that forward once, options nobody passes. Delete those, run the checks, and only then build. The simpler base is the evidence, not a score.

Resist the urge to build first and clean later. Later never has the checks in hand and the context in mind the way now does. Subtraction done after the addition is a separate change with its own risk. Subtraction done first is the ground the addition stands on.

principle-laziness-protocol already owns deletion-first, and this leaf does not repeat it. That skill owns the reader-load question: what work does this code impose on whoever reads it next. This one owns the builder's sequence: subtract as the first step of an addition, so the new work lands on ground you already cleared. One guards the reader. The other orders the change.
