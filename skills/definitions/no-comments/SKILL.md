# No comments

Spawn @sicko. Act on accepted findings.

Defer to the fresh perspective it brings. It judges the comments; you fix them.

## Steps

1. Spawn Sicko with the `task` tool: `subagent_type` is `sicko` — that is the
   agent id, not the persona name. Pass the scope: the caller's files or diff, or
   the working-tree diff against the base branch, default `main`. Set
   `description` to a short phrase naming the scope. Do not restate its rules;
   the keep list is its own.

2. Vet the report before acting on any of it. Sicko applied the keep list and
   its own procedure before reporting, so do not re-apply them and do not invent
   a second rulebook. Reject the calls it got wrong:

   - any edit to application code
   - a scope escape
   - a deletion the keep list protects
   - a `MUST KILL` whose stated reason is wrong
   - a flag that treats kept intentional code as guilty

   Do not restore a comment it killed.

   Audit what it missed with the bundled inventory, then judge anything new with
   the same keep list it used:

   ```sh
   bun run scripts/audit.ts <scope>
   ```

   It lists every comment and every lint or type suppression in the scope, grouped
   by file, so the audit is total rather than whatever pattern you thought to grep
   for. It is an inventory and not a judgment — it cannot apply the keep list, so
   every line it prints still goes through it.

   Revert and rerun one rejected report with the failure named. Reject a second,
   report it open, and fail this skill.

3. Fix the accepted flags with the remedy Sicko named — rename, extract, add a
   type, or restructure until the behavior is obvious without prose. `edit` for a
   bounded change, `apply_patch` when the fix spans hunks. If a fix needs a shape
   rather than a change, sketch it once for the accepted set and stop at the
   sketch; step 4 implements.

4. Implement the smallest root-cause fix in scope, and remove every named
   workaround. If the root cause is out of scope, land the smallest in-scope fix
   and report the rest open. `principle-hygiene` guides the intent; it does not
   authorize widening the fence or fixing instances outside it. Never bolt on a
   symptom guard.

5. A comment that claims a constraint — `do not remove`, `do not change wording`,
   `talk to X before changing` — is not a keep on its own. Judge it with the
   same keep list; if it survives, offer the cheapest in-scope encoding: a type
   constraint, a runtime check, a test, or a CI lint. Name which one and what it
   would assert.

   Then wait for approval with the `question` tool. Unattended runs and evals
   need the caller's pre-approval instead. If approved, encode it and then delete
   the comment. If not, delete the comment, report the constraint open, and
   sketch the out-of-scope work.

6. Report what you deleted, the comments you restored, reruns, sketches, fixes,
   encoding offers, encodings, unenforced constraints, and any other open work.
