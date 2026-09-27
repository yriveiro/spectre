# No comments

Spawn @sicko. Act on accepted findings.

Defer to the fresh perspective it brings. It judges the comments; you fix them.

Requires Code Mode. Step 1 is the check, and the audit in step 3 runs on a Code
Mode tool that has no other surface.

## Steps

1. Prove the audit tool runs, before anything else. Call it once, on one file
   you know has a comment in it:

   ```js
   const smoke = await tools.spectre.comments({ targets: ["<any source file>"] })
   ```

   A page comes back — do not go further if it does not. If `execute` is
   missing from your tool list, or `search()` has no `spectre` namespace, or the
   call errors, then Code Mode is off or this plugin is not the copy that got
   loaded: say which of the two it is and stop. Do not substitute grep, and do
   not spawn Sicko first — its report cannot be audited without this, and a
   report nobody can audit is worse than no report.

2. Spawn Sicko with the `task` tool: `subagent_type` is `sicko` — that is the
   agent id, not the persona name. Pass the scope: the caller's files or diff, or
   the working-tree diff against the base branch, default `main`. Set
   `description` to a short phrase naming the scope. Do not restate its rules;
   the keep list is its own.

3. Vet the report before acting on any of it. Sicko applied the keep list and
   its own procedure before reporting, so do not re-apply them and do not invent
   a second rulebook. Reject the calls it got wrong:

   - any edit to application code
   - a scope escape
   - a deletion the keep list protects
   - a `MUST KILL` whose stated reason is wrong
   - a flag that treats kept intentional code as guilty

   Do not restore a comment it killed.

   Audit what it missed, then judge anything new with the same keep list it
   used:

   ```js
   const audit = await tools.spectre.comments({ targets: ["<scope>"] })
   ```

   It returns the hits, not a report to read whole: `hits` is a page of
   `{file, line, kind, text}`, and `total`, `suppressions` and `scanned` count
   the whole scope, so you can narrow before reading a thing. Page the rest with
   `offset` and `limit` while `truncated` is true. `errors` names a target it
   could not scan — narrow and retry it, or report it open. `empty` names a
   target with nothing in it, and `empty: []` with `total: 0` means you scanned
   nothing: the scope resolved to no targets, which is a bug in the scope, not a
   clean audit. Fix the scope and call it again.

   Filter the hits down to what the report did not cover and judge those. The
   inventory is an inventory: it cannot apply the keep list, so every hit it
   returns still goes through it.

   Revert and rerun one rejected report with the failure named. Reject a second,
   report it open, and fail this skill.

4. Fix the accepted flags with the remedy Sicko named — rename, extract, add a
   type, or restructure until the behavior is obvious without prose. `edit` for a
   bounded change, `apply_patch` when the fix spans hunks. If a fix needs a shape
   rather than a change, sketch it once for the accepted set and stop at the
   sketch; step 5 implements.

5. Implement the smallest root-cause fix in scope, and remove every named
   workaround. If the root cause is out of scope, land the smallest in-scope fix
   and report the rest open. `principle-hygiene` guides the intent; it does not
   authorize widening the fence or fixing instances outside it. Never bolt on a
   symptom guard.

6. A comment that claims a constraint — `do not remove`, `do not change wording`,
   `talk to X before changing` — is not a keep on its own. Judge it with the
   same keep list; if it survives, offer the cheapest in-scope encoding: a type
   constraint, a runtime check, a test, or a CI lint. Name which one and what it
   would assert.

   Then wait for approval with the `question` tool. Unattended runs and evals
   need the caller's pre-approval instead. If approved, encode it and then delete
   the comment. If not, delete the comment, report the constraint open, and
   sketch the out-of-scope work.

7. Report what you deleted, the comments you restored, reruns, sketches, fixes,
   encoding offers, encodings, unenforced constraints, and any other open work.
