Make code cheap to read, measured on two axes.

Every future reader pays twice: once in hops, tracing a value through layers to find where it comes from, and once in state, holding in their head everything that can change it. These are independent. A flat file with global mutable state has no hops and bottomless state. A pure pipeline ten layers deep has no state and exhausting hops. Cutting one while growing the other is not an improvement. It is a transfer.

Without this, reading becomes archaeology. A value arrives from three layers up, changed by callbacks registered somewhere else, guarded by flags set in a fourth place, and the reader must hold the whole machine to understand one line. Each hop and each piece of state is a small tax, and comprehension is what those taxes add up to. Code that cannot be traced cannot be changed safely, so it gets wrapped instead, and the wrapping adds the next layer of hops.

The test is a timed question: hand the code to someone new and ask where X comes from and what can change X. If both answers take under thirty seconds, the load is low. Hops are counted in jumps between definitions; state is counted in live facts the reader must hold at once. Narrow the state to a local, derive the value rather than synchronizing it, and collapse the layer that hides nothing.

The moment is any code that is hard to follow: a value you cannot trace, a change you cannot scope, a helper with one caller that only forwards. Reach for this when reading hurts. Laziness is about the work, this is about the reading: `principle-laziness-protocol` owns refusing the addition before it exists, and this owns the two axes once code is on the page. A boundary that hides a real decision stays, because that boundary cuts hops instead of adding them.
