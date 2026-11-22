import { type Plugin, Skill } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { snapshot } from "../../../tools/definitions/brain";
import { promptCommand } from "../../definition";

const summarizeBrain = async (directory: string): Promise<string | undefined> => {
  const snap = await Effect.runPromise(
    snapshot(directory).pipe(Effect.catch(() => Effect.succeed(undefined))),
  );
  if (snap === undefined) return undefined;
  return `Live .spectre/brain summary: ${snap.totals.active}/${snap.totals.total} active neurons, ${snap.totals.edges} synapses, ${snap.anomalies.length} curation alerts.`;
};

export const brain = (ctx: Pick<Plugin.Context, "session">) =>
  promptCommand(ctx, import.meta.dir, {
    name: "brain",
    description: "publish or update the canonical Brain connectome canvas for .spectre/brain",
    skills: [Skill.ID.make("canvas")],
    context: summarizeBrain,
  });
