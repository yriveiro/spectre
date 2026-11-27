import { Model as ModelSchema } from "@opencode/plugin/effect";
import { Effect, Option, Schema } from "effect";
import {
  candidates,
  crosscheckOf,
  DEFAULT_AGENT,
  DEFAULT_PROFILES,
  defaultAgentFor,
  known,
  load,
  priorityOf,
  resolveProfile,
} from "../../tools/definitions/routing/index.ts";
import type { ProfileRouting } from "./usage.ts";

const decodeInfo = Schema.decodeUnknownOption(ModelSchema.Info);

const catalogue = (models: ReadonlyArray<unknown>) =>
  models.flatMap((info) =>
    Option.match(decodeInfo(info), {
      onNone: () => [],
      onSome: (decoded) => [known(decoded)],
    }),
  );

type Spent = {
  readonly ref: string;
  readonly rung?: string | undefined;
};

const spendRef = (one: Spent): string =>
  one.rung === undefined || one.ref.includes("#") ? one.ref : `${one.ref}#${one.rung}`;

/**
 * The routing profiles as this project resolves them, each with the agent
 * and the spent `provider/model#rung` the routing tool would use. Read
 * through the same shared module the routing tool spends from
 * (`load`, not `loadProject`, so the global config merges the way the tool
 * merges it), so the panel and the tool cannot disagree about what a
 * profile means.
 *
 * A config the tool would refuse — unreadable, or carrying validation
 * problems such as a missing `priority` — returns `[]`: the runs then land
 * in the panel's unrouted rows instead of under refs the tool would never
 * spend.
 */
export const profileRouting = async (
  directory: string,
  models: ReadonlyArray<unknown>,
): Promise<ReadonlyArray<ProfileRouting>> => {
  const found = await Effect.runPromise(load(directory)).catch(() => undefined);
  if (found === undefined) return [];
  const ordered = priorityOf(found.tables.models, found.tables.priority);
  const crosscheck = crosscheckOf(
    found.tables.models,
    found.tables.crosscheck,
    ordered.ranked.map((one) => one.alias),
  );
  const problems = [...found.problems, ...ordered.problems, ...crosscheck.problems];
  if (problems.length > 0) return [];
  const kept = candidates(
    ordered.ranked.map((one) => ({ alias: one.alias, ref: one.ref, pinned: undefined })),
    catalogue(models),
  );
  const specs = found.configuredProfiles ? found.tables.profiles : DEFAULT_PROFILES;

  const entries = Object.entries(specs).map(([name, entry]) => ({
    name,
    agent: entry.agent ?? defaultAgentFor(name, DEFAULT_AGENT),
    resolved: resolveProfile(name, entry, kept.kept, DEFAULT_AGENT, crosscheck.listed),
  }));

  const primary: ProfileRouting[] = entries.map(({ name, agent, resolved }) => ({
    name,
    agent,
    ref: resolved.resolution === undefined ? undefined : spendRef(resolved.resolution.primary),
  }));

  const secondary: ProfileRouting[] = entries.flatMap(({ name, agent, resolved }) =>
    resolved.resolution?.crosscheck === undefined
      ? []
      : [
          {
            name,
            agent,
            ref: spendRef(resolved.resolution.crosscheck),
            crosscheck: true,
          },
        ],
  );

  return [...primary, ...secondary];
};
