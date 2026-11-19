# Principle: Hygiene

Hygiene is custody over small details before four hundred rounding errors make a codebase unsafe to change. Leave touched files cleaner than you found them. Judge adjacent rot while standing on it, and keep total codebase surface flat or smaller as features land. The test is whether you could touch this code again on a bad day without a grudge.

## The moves

**Clean adjacent rot while context and checks are already warm.** Editing a file is the cheapest moment to clear a stale feature flag, dead branch, or `"clean this up later"` shortcut. Leave unrelated files out so the diff keeps one focus.

**Remove dead code that nothing reaches.** Delete unused exports, unused helpers kept `"just in case"`, unreachable branches, and commented-out blocks, then confirm checks pass. Pass-through wrappers with one caller belong to `principle-laziness-protocol`, and live legacy paths belong to `principle-migrate-callers-then-delete-legacy-apis`.

**Delete clutter before abstracting or building on top.** Remove replaced paths without leaving flags or conditions behind, and clear redundant validators or empty stubs so clean designs stay visible (`principle-laziness-protocol`).

**Take safe in-range dependency upgrades completely.** Bump an outdated dependency inside its declared range when project checks pass, and schedule breaking major bumps as explicit tasks. Move the direct pin, lockfile, and every transitive or documented copy together so the old version appears nowhere.

**Separate dirt from damage.** Clean dead code, stale comments, and duplicated blocks as hygiene, and report broken invariants, silent failures, or security holes as bugs rather than tidying past them.

**Update or delete stale comments, and prefer code that needs none.** Re-read every comment inside a touched hunk so none lies about old behavior, and choose the implementation that explains itself without narration.

**Let formatters, linters, and audits handle mechanical checks.** Run project tools instead of hand-formatting, and fix every linter warning you touch or document why it stays.

**Count deletions alongside additions, and check the working tree last.** Offset new lines by removing obsolete ones, and clear temp files, debug prints, widened ignores, or stray install edits before `principle-verification` reports done.

## What this principle is not

- **Not a formatting obsession.** Formatters own alignment, while hygiene owns what is true and reachable.
- **Not maximalism on throwaway probes.** Match care to stakes: shared artifacts owe maintainers a clean tree, while disposable probes owe nothing.
