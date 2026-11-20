Publish or update the project's canonical Brain canvas from `.spectre/brain/`.

## Read the optional focus prefix

The host appends typed text at the end of this prompt, after `The user added: `.
Take the first whitespace-separated token after that marker as `focus` (a neuron UUIDv7 or prefix).
Omit `focus` when no marker appears.

## Publish or update in one call

When this session already holds an `art_` id from an earlier Brain canvas call, pass `action: "update"` and that `id`.
Otherwise publish a new Brain canvas:

```js
await tools.spectre.canvas({
  action: "publish",
  content: { kind: "brain" },
})
```

Include `focus` inside `content` only when the user typed a token.
Code composes the entire Connectome, Prompt Cortex, Lineage, and Codebase Map interface from `.spectre/brain/`.
Never write custom HTML for a Brain canvas.

## Report the handle

Report the artifact `id` and relative `url` that `tools.spectre.canvas` returned.
On `refused`, report `problem` verbatim.
