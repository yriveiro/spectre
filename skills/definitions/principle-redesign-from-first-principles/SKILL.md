Integrate a new requirement as though it had been foundational from day one. Never bolt it on beside what exists.

A bolt-on preserves the old design and charges rent on it forever. A flag, a special case, a parallel path: each looks cheap in the diff that introduces it. Each becomes a permanent fork in every reader's mental model, and every later change must route around it. After three such additions the codebase is the old design plus three exceptions, and nobody can say what the design is anymore. The cheap change was the expensive one.

Without this the architecture drifts one accommodation at a time. Nobody decides to make a mess. Each requirement is met where the code already is, because redesigning feels disproportionate to the ticket. But the ticket is not the unit that matters. The shape after ten tickets is, and ten bolt-ons produce a shape nobody would have designed and nobody can now change without breaking an exception they did not know existed.

The test: if we were writing this from scratch with this new requirement, what would we build? Describe that shape honestly, then move the code toward it and let the old shape dissolve into the new one. If the answer looks nothing like the change you were about to make, the change you were about to make was a bolt-on. The redesign does not have to land in one diff. It has to be the direction, stated plainly, with the first step inside this change.

Reach for this when a requirement arrives the current shape never anticipated, and the plan starts with a flag or a special case. Deleting first to keep the addition small is principle-laziness-protocol. Naming the domain shape the redesign lands in is principle-model-the-domain.
Adapted from pstack (MIT, Lauren Tan).
