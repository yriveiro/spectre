Open a pull request for this branch.

Follow the attached `playbook-opening-a-pr` skill. Trust `<pr-preflight>` when present instead of running redundant git, signing, or `ripwire` discovery commands.

`/pr` authorizes staging branch files, committing, pushing without force, and opening the pull request. Do not edit source code or open a `todolist` for one PR.

For diffs touching `>=3` code files or `>=100` LOC, run `interrogate` (different model family) and `code-hygiene` by default. Skip that review only when the user passes `--no-review`. On smaller diffs, skip `interrogate` and `sicko` subagents unless the user passes `--review`.

Call `tools.spectre.pr` directly through `execute` without calling `search()` first:

```js
return await tools.spectre.pr({
  action: "open", // or "compose" for GitLab / title-and-body only
  commit: {       // omit when all changes are already committed
    files: ["path/to/changed-file.ts"],
    description: "One sentence of 8 to 25 words describing the staged change.",
    changes: ["update symbol in path/to/changed-file.ts"],
  },
  type: "feat",
  scope: "area",
  subject: "imperative one-clause subject under 72 chars",
  summary: "Why the change exists, in plain active-voice sentences.",
  review: "The one decision you want from the reviewer.",
  scopeItems: ["path/to/changed-file.ts"],
  validation: [{ check: "bun test", result: "exact output" }],
  risk: "What it touches and how to revert it.",
});
```
