# Maintain a verification skill

A feature map is true on the day it is written. This is the upkeep loop for a
skill built by `create-verification-skill`. The unit of rigor is the feature
rather than the sentence: every feature file is read from source, every feature
is driven live, and the bullets inside each are not separately terminalised.

The two facts that make it its own skill rather than a re-read: nothing ships
that a live drive did not prove, and a run ends in one of three named words.

## Start

1. Locate
2. Index
3. Source wave
4. Reconcile
5. Live pass
6. Triage
7. Ship or stop

## Phase A: Locate and declare

Find the skill to maintain: the one whose body has launch and drive sections and
a `features/` directory. Several candidates means ask which. None means stop and
point at `create-verification-skill` rather than inventing a target.

Say which outcome you are running for, before you start:

- **clean.** Every feature had source and live coverage and nothing was worth
  shipping. No branch, no PR.
- **changed.** One PR of corrections, each one proven.
- **blocked.** Coverage could not finish, or a proven correction could not ship
  safely. Name exactly what stopped it.

Edit only the skill's own directory: the body, `features/`, and the harness
scripts it owns. Never edit product code during a run. A behaviour the map
describes and the app no longer does is either documentation drift, fixed in the
map, or a product regression, reported and left alone.

## Phase B: Index

Read the map's README and list the files beside it. Fix the entries that are
missing, extra, duplicated, or dead. This is quick, and it produces no inventory
file.

## Phase C: Source wave

One read-only reader per feature file, spawned together with `subagent` and
`background: true`. Call `tools.spectre.routing({})` first and take one model per
reader from the profiles. Never write a model id by hand.

Each reader answers one question from source: how does this user-facing feature
work? It returns four things and nothing else:

- a summary of the feature in a few lines
- the source entry points, as paths
- the likely drift, with the citation, or none
- one recipe for driving it live

A reader never starts the app and never edits a file.

## Phase D: Reconcile

Every feature file now has a summary, so merge the recipes that reach the same
app state into as few as you can. That is what keeps the live pass short.
Spot-check the cited drift rather than re-proving the claims the readers called
clean.

Then sweep the recent history for a user-facing surface the map never mentions:

```sh
git log --oneline -n 300 -- <source roots>
```

A surface is missing only once you can name a source path for it. A feature that
exists because a menu label sounds like one is not a finding.

## Phase E: Live pass

Run it even when the source looked clean, because clean source is what drift
hides behind. The coordinator owns every drive: you start the app, nothing else
does.

Follow the skill's own launch model, not this one. One long-lived instance
driven serially for a server or a UI, and a fresh isolated session per drive for
a short-lived CLI.

Exercise every feature at least once and hold three invariants for the whole
pass, whatever fails:

1. **Never drive an instance you have not health-checked.** Doctor before the
   first drive, doctor on each fresh session where the session is the unit, and
   doctor again after a failed drive. Where the doctor cannot see the failure, a
   UI wedged on a healthy process, reset to a known state or relaunch rather
   than hoping.
2. **Evidence survives cleanup.** Check each artifact at the path it names rather
   than assuming it landed.
3. **Nothing a drive started outlives that drive.** Clean the residue from a
   failed attempt whether the session is stuck, exited, or shared. For a shared
   instance, clean the residue and leave the instance running.

A doctor that fails because the skill drifted is itself drift. Fix it inside the
edit scope, restart whatever the fix invalidated, retry once, and only then call
the pass blocked.

A feature you cannot reach is `verified-unreachable` only with the concrete
prerequisite, the auth, the entitlement, the OS, the external state, and the
route you tried. If the map did not record that prerequisite, that is drift in
the map.

Teardown happens after the last drive of the run, the re-proofs included, so
nothing outlives the run. The evidence stays.

## Phase F: Triage

Three kinds, and they go three places.

- A wrong or missing description of what a user sees is documentation drift.
  Fix it in the map.
- Behaviour that works and the harness cannot drive is a harness gap. Fix it,
  and hold it to the rule from generation: an executable script whose invocation
  is in the body.
- Behaviour that is actually broken is a product gap. Record it for the reader
  and keep it out of the PR.

Anything fixed in triage gets driven again before it ships. A correction nobody
re-ran is a guess with a diff on it.

## Phase G: Ship or stop

For **changed**, one PR holding the proven corrections, and re-read every file you
changed before you open it. For **clean** and **blocked**, no branch, and a
report of what you covered and what you did not.

Keep the run notes somewhere scratch: features covered, prerequisites that
blocked a feature, drift confirmed, the outcome. Do not commit them.

## Outputs

One of the three named outcomes, the corrections that shipped with the drive
that proved each one, and an honest list of the features that could not be
covered.
