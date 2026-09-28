import { Effect } from "effect";
import { type Definition } from "./definition";
import { iHaveAdhd } from "./i-have-adhd";
import { modelRouter } from "./model-router";
import { noComments } from "./no-comments";
import { principleEvidence } from "./principle-evidence";
import { principleHygiene } from "./principle-hygiene";
import { principleVerification } from "./principle-verification";
import { spectreMode } from "./spectre-mode";
import { principleGuardTheContextWindow } from "./principle-guard-the-context-window";
import { principleMinimizeReaderLoad } from "./principle-minimize-reader-load";
import { ripwire } from "./ripwire";

const definitions: ReadonlyArray<Definition> = [
  iHaveAdhd,
  modelRouter,
  noComments,
  principleEvidence,
  principleHygiene,
  principleVerification,
  spectreMode,
  principleGuardTheContextWindow,
  principleMinimizeReaderLoad,
  ripwire,
];

const ROOT = import.meta.dir;

const bodies = async (): Promise<ReadonlyArray<string>> => {
  const found: Array<string> = [];

  for await (const entry of new Bun.Glob("*/SKILL.md").scan({ cwd: ROOT }))
    found.push(entry);

  return found.toSorted();
};

const body = (definition: Definition) =>
  Effect.tryPromise({
    try: () => Bun.file(definition.path).text(),
    catch: (cause) =>
      new Error(
        `Cannot read the body of ${definition.id}: ${definition.path} (${cause})`,
      ),
  }).pipe(Effect.orDie);

export const load = Effect.fn("skills.load")(function* () {
  const onDisk = yield* Effect.promise(() => bodies());
  // Each definition's own `path`, named the way the scan names it.
  const listed = new Set(
    definitions.map((definition) => definition.path.slice(ROOT.length + 1)),
  );
  const forgotten = onDisk.filter((body) => !listed.has(body));

  if (forgotten.length > 0) {
    return yield* Effect.die(
      `Add these to skills/definitions/index.ts: ${forgotten.join(", ")}`,
    );
  }

  return yield* Effect.forEach(definitions, (definition) =>
    Effect.map(body(definition), (content) => ({ ...definition, content })),
  );
});
