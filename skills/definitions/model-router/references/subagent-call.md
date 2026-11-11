# The subagent call

Read this page when you are about to spawn a routed subagent, or when you need the model precedence and the agent rules.

## Arguments

| Argument | Required | What it is |
| --- | --- | --- |
| `agent` | yes | The spectre agent to spawn. |
| `description` | yes | A 3-5 word label for the task. |
| `prompt` | yes | The task itself. |
| `model` | no | `providerID/modelID` or `providerID/modelID#variant`. |
| `sessionID` | no | Continue a previous child instead of starting one. |
| `background` | no | Run without blocking the caller. |

`agent` must name an agent the session can run as a subagent. The routing config accepts only a spectre agent, so take `agent` from the profile. A profile that names none uses `spectre`.

## Model precedence

For a new child, an explicit `model` wins over the agent's own model, and the agent's model wins over the model of the parent session. The host applies the choice before the run starts. One agent therefore serves every profile.

The host checks the ref against the models the session can see. It rejects an unknown provider or model, a variant the model does not declare, and an image or decision model. It does not check the routing allowlist, so a ref outside that list can still run. That is why the skill treats the routing answer as the only vocabulary.

## The spectre agents

| Agent | Mode | What it is for |
| --- | --- | --- |
| `spectre` | all | The default. Selectable in a chat and spawnable as a subagent. |
| `sicko` | subagent | A narrow persona for comment work. The wrong agent for anything else. |
| `mnemonic` | subagent | A brain sweep. The only agent that may write `.spectre/brain`. |

The routing config refuses any other agent name, so a routed run cannot drop out of spectre mode by being some other agent. The agents differ in persona, in chat visibility, and in one permission: only `mnemonic` may write the brain.

## The call

```text
subagent({
  agent:       profile.agent,        // from the routing row
  description: "Run tests, report failures",
  prompt:      "Run the test suite. Report which tests failed and why.",
  model:       profile.model.ref,    // copied exactly
})
```

`model` is optional. When it is absent, the agent's own model runs the work. When the agent has no model of its own, the parent's model runs it. Every path still spawns something.

A `sessionID` continues a child. A `background` call returns at once, and the host notifies you when it finishes. Do not poll a background child.
