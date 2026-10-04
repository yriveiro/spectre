import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { mnemonic } from "./definitions/mnemonic";
import { sicko } from "./definitions/sicko";
import { spectre } from "./definitions/spectre";

const definitions = [spectre, sicko, mnemonic];

/** The only agents model routing may name. Read from the same list that registers them. */
export const agentIds = definitions.map((one) => one.id);

const dataRoot = `${Bun.env.HOME ?? Bun.env.USERPROFILE}/.local/share/spectre`;

/**
 * Granted to every definition rather than to one of them, because a subagent
 * session carries only its own agent's rules and never the parent's, so a
 * permission held by `spectre` alone stops at the subagent boundary.
 *
 * The resource is spelled out in full because `~` is expanded by the config
 * loader, on its way in from `opencode.json` and agent markdown, and by nothing
 * downstream of it. A rule pushed here through `editor.update` arrives at the
 * matcher unexpanded, where `~` is an ordinary character, so writing
 * `~/.local/share/spectre/*` here reads as a directory named `~` and never
 * matches a request for the real path.
 *
 * `bash` is absent and stays that way. The shell only offers a path to
 * `external_directory` for the `cd` family; every other command, a redirect
 * included, is asserted against its own raw text, which no path-shaped rule
 * matches. Ruling on it here could only allow or deny whole command strings, so
 * the redirection is left to the default rather than half-ruled.
 */
const dataPermissions = ["external_directory", "read", "edit"].map((action) => ({
  action,
  resource: `${dataRoot}/*`,
  effect: "allow" as const,
}));

/**
 * Invariant 8 of `features/brain.md`: only `mnemonic` may write the brain, and
 * the mechanism is order, not a separate field. The deny is pushed onto every
 * agent and the allow is pushed after it for `mnemonic` alone, because the
 * matcher is `findLast` over the flattened ruleset (`packages/core/src/
 * permission.ts`, `evaluate`, at `v2.0.21`): the last matching rule wins, so a
 * deny written after the allow would silence the one writer the brain has.
 *
 * The resource is the relative glob `.spectre/brain/*`, for the same reason a
 * rule here never spells `~`. `FileAccess.resolve` sends
 * `path.relative(location.directory, absolute)` as the resource for a file
 * inside the project (`packages/core/src/file-access.ts:100-120`), so an
 * absolute-path rule matches nothing. `read` is denied to nobody: a brain the
 * reader cannot read is not a memory.
 */
const brainDeny = { action: "edit", resource: ".spectre/brain/*", effect: "deny" as const };
const brainAllow = { action: "edit", resource: ".spectre/brain/*", effect: "allow" as const };

export const update = (ctx: Pick<Plugin.Context, "agent">) =>
  Effect.gen(function* () {
    yield* ctx.agent.transform((editor) => {
      for (const definition of definitions) {
        editor.update(definition.id, (agent) => {
          Object.assign(agent, definition);
          agent.permissions.push(...dataPermissions, brainDeny);
          if (definition.id === mnemonic.id) agent.permissions.push(brainAllow);
        });
      }
    });

    yield* Effect.logInfo("Registered agents", {
      agents: definitions.map((item) => item.id),
    });
  });
