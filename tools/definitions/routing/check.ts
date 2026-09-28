import { Model } from "@opencode/schema/model";
import { formatRef, type Tables } from "./types";

export type Row = { name: string; model: string };

export type Checked = {
  readonly models: ReadonlyArray<Row>;
  readonly profiles: ReadonlyArray<{
    name: string;
    models: ReadonlyArray<Row>;
    agent: string;
    why: string;
  }>;
  readonly problems: ReadonlyArray<string>;
};

/**
 * The allowlist is the whole vocabulary. A ref that does not resolve is reported
 * against the models the user did allow, never against the catalogue, so the list
 * is short enough not to need a cap and every name in it is one they chose.
 */
const allowed = (resolved: ReadonlyMap<string, string>): string =>
  [...resolved].map(([name, ref]) => `${name} (${ref})`).join(", ") || "none";

/**
 * Every check collects, so one run shows the whole list. A model whose ref failed
 * is left out of `resolved`, so the profile pointing at it is skipped rather than
 * reported twice.
 */
export const check = (
  tables: Tables,
  catalogue: ReadonlyArray<Model.Info>,
  defaultAgent: string,
  spectreAgents: ReadonlyArray<string>,
): Checked => {
  const problems: Array<string> = [];
  const unresolved: Array<{ name: string; ref: string }> = [];
  const resolved = new Map<string, string>();
  const models: Array<Row> = [];

  for (const [name, raw] of Object.entries(tables.models)) {
    let ref: Model.Ref;
    try {
      ref = Model.Ref.parse(raw);
    } catch (e) {
      problems.push(`models.${name}: ${(e as Error).message}`);
      continue;
    }

    const found = catalogue.find(
      (one) => one.providerID === ref.providerID && one.id === ref.id,
    );
    if (found === undefined) {
      unresolved.push({ name, ref: formatRef(ref) });
      continue;
    }

    if (
      ref.variant !== undefined &&
      !found.variants.some((one) => one.id === ref.variant)
    ) {
      const have = found.variants.map((one) => one.id).join(", ");
      problems.push(
        `models.${name}: "${ref.variant}" is not a variant of ${ref.providerID}/${ref.id}. Variants: ${have || "none"}`,
      );
      continue;
    }

    resolved.set(name, formatRef(ref));
    models.push({ name, model: formatRef(ref) });
  }

  // Reported after the loop, so the list is the same whatever order the file
  // was written in.
  for (const one of unresolved)
    problems.push(
      `models.${one.name}: ${one.ref} is not a model this session can see. Allowed: ${allowed(resolved)}`,
    );

  const profiles: Array<{
    name: string;
    models: Array<Row>;
    agent: string;
    why: string;
  }> = [];

  for (const [name, entry] of Object.entries(tables.profiles)) {
    const agent = entry.agent ?? defaultAgent;
    if (!spectreAgents.includes(agent)) {
      problems.push(
        `profiles.${name}.agent: "${agent}" is not a spectre agent, so the run would not be in spectre mode. Spectre agents: ${spectreAgents.join(", ")}`,
      );
      continue;
    }
    const rows: Array<Row> = [];
    for (const asked of entry.model) {
      const model = resolved.get(asked);
      if (model === undefined) {
        if (!(asked in tables.models))
          problems.push(
            `profiles.${name}.model: "${asked}" is not a name in models. Names: ${
              Object.keys(tables.models).join(", ") || "none"
            }`,
          );
        continue;
      }
      rows.push({ name: asked, model });
    }
    if (rows.length !== entry.model.length) continue;
    profiles.push({ name, models: rows, agent, why: entry.why });
  }

  return { models, profiles, problems };
};
