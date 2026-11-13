Open a worktree for the unit of work the user names, and keep building in it.

Load `playbook-worktree-init` and follow it.

## Read the name from the marker

The host appends the typed text at the end of this prompt, behind the marker `The user added: `.
Nothing above that marker came from the user.

Take the first whitespace-separated token as `name`. Text after it describes the work, not the
directory. No marker means the user typed no name. Ask for one and stop. Never invent one.

## Open it with one call

```js
await tools.spectre.worktrees({ action: "start", name: "<the token>" })
```

`start` reads the branch state itself, so do not survey first. Pass only `name`, unless the
user names a `branch` or a `base`.

## Report the status

On `opened`, report `directory`, `branch` and `cut`, then keep building. The playbook covers
every other status.
