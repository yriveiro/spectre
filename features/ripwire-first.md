# Ripwire first

Status: slices 1 to 4 built.

## The gates

The search guard renames a code-shaped text or shell search to
`spectre_search`. The read gate refuses the first code-file read of a session.
The landing gate refuses the first commit, push or PR while the tree holds
unmeasured code edits.

Both gates refuse one time. After that refusal they are advisory by design,
because a blocked model must be able to continue and land. The landing gate
asks for two commands, `ripwire . --quality-delta` and
`ripwire . --affected=`. It checks that both ran after the last code edit. It
cannot check the value of the report.

A doc edit is not a code edit. It never asks for a measurement and it never
blocks a landing.
