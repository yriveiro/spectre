Check the real thing, not something standing in for it.

"It compiles" is not "it works." A green build proves the types align. A passing unit test proves a function behaves in isolation. A tool's self-report proves the tool ran. None of them proves the user can do the thing. The distance between the proxy and the artifact is where the bugs live: the page that renders but shows the wrong data, the binary that builds but fails on launch, the migration that applies cleanly to an empty database and destroys a full one.

Without this you ship confidence instead of software. Each proxy feels like evidence, and stacked together they feel conclusive, so the one check that would have caught the failure never runs. The failure is then discovered by the person least equipped to diagnose it. Every layer of indirection between your check and the artifact is a place for reality to differ from your model of it unobserved.

The test: check the real thing, not something standing in for it. Before you say done, touch the surface the user will touch. Open the rendered page and read what it says. Run the binary you built. Exercise the path a stranger will take, with the data they will bring. If the check you ran could pass while the artifact is broken, it was a rehearsal, not a verification.

Reach for this at the moment of the claim, when the proxies are all green and stopping feels earned. That is exactly when the real check is cheapest and most valuable. Its sibling principle-verification owns never asserting more than has been checked; principle-prove-it-works owns checking the real artifact instead of a stand-in.

This owns which surface you check. How the codebase stays clean while you change it is principle-hygiene.
