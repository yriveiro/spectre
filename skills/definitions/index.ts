import { Effect } from "effect";
import { arena } from "./arena";
import { bro } from "./bro";
import { type Definition } from "./definition";
import { iHaveAdhd } from "./i-have-adhd";
import { modelRouter } from "./model-router";
import { noComments } from "./no-comments";
import { principleBoundaryDiscipline } from "./principle-boundary-discipline";
import { principleEvidence } from "./principle-evidence";
import { principleHygiene } from "./principle-hygiene";
import { principleMakeOperationsIdempotent } from "./principle-make-operations-idempotent";
import { principleMigrateCallersThenDeleteLegacyApis } from "./principle-migrate-callers-then-delete-legacy-apis";
import { principleOutcomeOrientedExecution } from "./principle-outcome-oriented-execution";
import { principleTestBehaviorNotImplementation } from "./principle-test-behavior-not-implementation";
import { principleVerification } from "./principle-verification";
import { spectreMode } from "./spectre-mode";
import { principleGuardTheContextWindow } from "./principle-guard-the-context-window";
import { principleLazinessProtocol } from "./principle-laziness-protocol";
import { principleMakeStatesUnrepresentable } from "./principle-make-states-unrepresentable";
import { ripwire } from "./ripwire";
import { swarm } from "./swarm";
import { unslop } from "./unslop";

const definitions: ReadonlyArray<Definition> = [
  arena,
  bro,
  iHaveAdhd,
  modelRouter,
  noComments,
  principleBoundaryDiscipline,
  principleEvidence,
  principleHygiene,
  principleLazinessProtocol,
  principleMakeOperationsIdempotent,
  principleMakeStatesUnrepresentable,
  principleMigrateCallersThenDeleteLegacyApis,
  principleOutcomeOrientedExecution,
  principleTestBehaviorNotImplementation,
  principleVerification,
  spectreMode,
  principleGuardTheContextWindow,
  ripwire,
  swarm,
  unslop,
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
