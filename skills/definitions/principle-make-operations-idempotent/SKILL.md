# Principle: Make Operations Idempotent

State-mutating operations must reach the same end state whether run once, run twice, or restarted after dying halfway. Crashes, restarts, and retries are normal in CLI commands, platform lifecycle steps, scheduler background loops, webhooks, and deploy migrations.

Answer three questions before writing code. What happens if this runs twice? What happens if the previous run died at any step, and does re-execution converge? Answering `"it depends on what state remained"` names a missing reconciliation step. Real operations rely on convergence rather than strict mathematical idempotence. Inspect current state, recognize completed work, and converge without resume checkpoints.

## The moves

**Converge from current state plus desired input instead of resuming.** Scan existing state, diff it against desired state, and apply only the missing delta. Eliminate run counters, append-only assumptions, progress files, and comparison timestamps that make a second run diverge.

**Compare and clean up by content or event id, never by creation order.** Creation order, `"newest wins"`, and `"files this run created"` fail across crashes, clock skew, and retries. Match content hashes or deduplicate webhook event ids, and verify directory listings and file contents rather than item counts.

**Design for duplicate delivery and regenerate intermediates from truth.** Networks and queues drop and duplicate messages, so handle duplicate arrivals safely. Recompute cycle inputs from the source of truth instead of reading cached intermediates a crash may have left half-written.

**Give every lock an explicit staleness and expiry rule before shipping.** A lock file checked only by existence turns one dead process into a permanent outage across deploys. Attach a PID check, heartbeat, or age threshold and verify stale recovery.

**Prefer state reconciliation over blind `"already exists"` skips.** Compare existing artifacts against desired content and report mismatches rather than silently continuing past a half-built resource.

**Verify by running twice back-to-back and crashing between steps.** Kill the process between write and rename, advance the crash point across steps, rerun, and confirm final contents match (`principle-evidence`).

## What this principle is not

- **Not transactions on pure reads.** Stateless functions leave nothing behind to reconcile.
- **Not reconciliation on code nothing retries.** Skip convergence machinery when no person, deploy, or scheduler ever reruns the path.
- **Not assuming exactly-once transport delivery.** Design for duplicate messages rather than waiting for transport guarantees.
- **Not stateful resumability.** Resume checkpoints add state that can corrupt, whereas stateless convergence needs no memory of where the last attempt stopped.
