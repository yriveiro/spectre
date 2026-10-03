import { Effect } from "effect";
import { arena } from "./arena";
import { bro } from "./bro";
import { canvas } from "./canvas";
import { communication } from "./communication";
import { type Definition } from "./definition";
import { grammar } from "./grammar";
import { modelRouter } from "./model-router";
import { noComments } from "./no-comments";
import { principleBoundaryDiscipline } from "./principle-boundary-discipline";
import { principleEvidence } from "./principle-evidence";
import { principleHygiene } from "./principle-hygiene";
import { principleAttackThePremise } from "./principle-attack-the-premise";
import { principleBuildTheLever } from "./principle-build-the-lever";
import { principleEncodeLessonsInStructure } from "./principle-encode-lessons-in-structure";
import { principleExhaustTheDesignSpace } from "./principle-exhaust-the-design-space";
import { principleExperienceFirst } from "./principle-experience-first";
import { principleFixRootCauses } from "./principle-fix-root-causes";
import { principleFoundationalThinking } from "./principle-foundational-thinking";
import { principleMinimizeReaderLoad } from "./principle-minimize-reader-load";
import { principleModelTheDomain } from "./principle-model-the-domain";
import { principleNeverBlockOnTheHuman } from "./principle-never-block-on-the-human";
import { principleProveItWorks } from "./principle-prove-it-works";
import { principleRedesignFromFirstPrinciples } from "./principle-redesign-from-first-principles";
import { principleSeparateBeforeSerializingSharedState } from "./principle-separate-before-serializing-shared-state";
import { principleSequenceVerifiableUnits } from "./principle-sequence-verifiable-units";
import { principleSubtractBeforeYouAdd } from "./principle-subtract-before-you-add";
import { principleTypeSystemDiscipline } from "./principle-type-system-discipline";
import { principleMakeOperationsIdempotent } from "./principle-make-operations-idempotent";
import { principleMigrateCallersThenDeleteLegacyApis } from "./principle-migrate-callers-then-delete-legacy-apis";
import { principleOutcomeOrientedExecution } from "./principle-outcome-oriented-execution";
import { principleTestBehaviorNotImplementation } from "./principle-test-behavior-not-implementation";
import { principleVerification } from "./principle-verification";
import { spectreMode } from "./spectre-mode";
import { principleGuardTheContextWindow } from "./principle-guard-the-context-window";
import { principleLazinessProtocol } from "./principle-laziness-protocol";
import { principleMakeStatesUnrepresentable } from "./principle-make-states-unrepresentable";
import { architect } from "./architect";
import { automateMe } from "./automate-me";
import { blastRadius } from "./blast-radius";
import { createVerificationSkill } from "./create-verification-skill";
import { figureItOut } from "./figure-it-out";
import { how } from "./how";
import { interrogate } from "./interrogate";
import { maintainVerificationSkill } from "./maintain-verification-skill";
import { showMeYourWork } from "./show-me-your-work";
import { tdd } from "./tdd";
import { teach } from "./teach";
import { technicalWriting } from "./technical-writing";
import { typescriptBestPractices } from "./typescript-best-practices";
import { playbook } from "./playbook";
import { prCanvas } from "./pr-canvas";
import { playbookAuthoringASkill } from "./playbook-authoring-a-skill";
import { playbookAutonomousRun } from "./playbook-autonomous-run";
import { playbookAutopilotFull } from "./playbook-autopilot-full";
import { playbookAutopilotStack } from "./playbook-autopilot-stack";
import { playbookBabysit } from "./playbook-babysit";
import { playbookBugFix } from "./playbook-bug-fix";
import { playbookEval } from "./playbook-eval";
import { playbookFeature } from "./playbook-feature";
import { playbookHillclimb } from "./playbook-hillclimb";
import { playbookInvestigation } from "./playbook-investigation";
import { playbookMultiPhasePlan } from "./playbook-multi-phase-plan";
import { playbookOpeningAPr } from "./playbook-opening-a-pr";
import { playbookOrchestrate } from "./playbook-orchestrate";
import { playbookPauseSafely } from "./playbook-pause-safely";
import { playbookPerfIssue } from "./playbook-perf-issue";
import { playbookPrototype } from "./playbook-prototype";
import { playbookRefactoring } from "./playbook-refactoring";
import { playbookRuntimeForensics } from "./playbook-runtime-forensics";
import { playbookSessionPickup } from "./playbook-session-pickup";
import { playbookShipping } from "./playbook-shipping";
import { playbookTraceForensics } from "./playbook-trace-forensics";
import { playbookVisualParity } from "./playbook-visual-parity";
import { ripwire } from "./ripwire";
import { swarm } from "./swarm";
import { why } from "./why";
import { worktreeCleanup } from "./worktree-cleanup";

const definitions: ReadonlyArray<Definition> = [
  architect,
  why,
  worktreeCleanup,
  automateMe,
  blastRadius,
  createVerificationSkill,
  figureItOut,
  how,
  interrogate,
  maintainVerificationSkill,
  showMeYourWork,
  tdd,
  teach,
  technicalWriting,
  typescriptBestPractices,
  playbook,
  playbookAuthoringASkill,
  playbookAutonomousRun,
  playbookAutopilotFull,
  playbookAutopilotStack,
  playbookBabysit,
  playbookBugFix,
  playbookEval,
  playbookFeature,
  playbookHillclimb,
  playbookInvestigation,
  playbookMultiPhasePlan,
  playbookOpeningAPr,
  playbookOrchestrate,
  playbookPauseSafely,
  playbookPerfIssue,
  playbookPrototype,
  playbookRefactoring,
  playbookRuntimeForensics,
  playbookSessionPickup,
  playbookShipping,
  playbookTraceForensics,
  playbookVisualParity,
  prCanvas,
  arena,
  bro,
  canvas,
  communication,
  grammar,
  modelRouter,
  noComments,
  principleBoundaryDiscipline,
  principleEvidence,
  principleHygiene,
  principleAttackThePremise,
  principleBuildTheLever,
  principleEncodeLessonsInStructure,
  principleExhaustTheDesignSpace,
  principleExperienceFirst,
  principleFixRootCauses,
  principleFoundationalThinking,
  principleMinimizeReaderLoad,
  principleModelTheDomain,
  principleNeverBlockOnTheHuman,
  principleProveItWorks,
  principleRedesignFromFirstPrinciples,
  principleSeparateBeforeSerializingSharedState,
  principleSequenceVerifiableUnits,
  principleSubtractBeforeYouAdd,
  principleTypeSystemDiscipline,
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
];

/**
 * Registered and reader-called rather than indexed, so they carry no row in the
 * ripwire map and do not move its `none` count: `skills/FOR_AGENTS.md`,
 * "Porting a principle from elsewhere", item 3. `spectre-mode` and `ripwire` are
 * the hub and the map itself.
 */
export const notALeaf: ReadonlySet<string> = new Set([
  "architect",
  "arena",
  "automate-me",
  "blast-radius",
  "bro",
  "canvas",
  "communication",
  "create-verification-skill",
  "figure-it-out",
  "how",
  "interrogate",
  "maintain-verification-skill",
  "playbook",
  "playbook-authoring-a-skill",
  "playbook-autonomous-run",
  "playbook-autopilot-full",
  "playbook-autopilot-stack",
  "playbook-babysit",
  "playbook-bug-fix",
  "playbook-eval",
  "playbook-feature",
  "playbook-hillclimb",
  "playbook-investigation",
  "playbook-multi-phase-plan",
  "playbook-opening-a-pr",
  "playbook-orchestrate",
  "playbook-pause-safely",
  "playbook-perf-issue",
  "playbook-prototype",
  "playbook-refactoring",
  "playbook-runtime-forensics",
  "playbook-session-pickup",
  "playbook-shipping",
  "playbook-trace-forensics",
  "playbook-visual-parity",
  "pr-canvas",
  "ripwire",
  "show-me-your-work",
  "spectre-mode",
  "swarm",
  "tdd",
  "teach",
  "technical-writing",
  "typescript-best-practices",
  "why",
  "worktree-cleanup",
]);

const ROOT = import.meta.dir;

const bodies = async (): Promise<ReadonlyArray<string>> => {
  const found: Array<string> = [];

  for await (const entry of new Bun.Glob("*/SKILL.md").scan({ cwd: ROOT })) found.push(entry);

  return found.toSorted();
};

const body = (definition: Definition) =>
  Effect.tryPromise({
    try: () => Bun.file(definition.path).text(),
    catch: (cause) =>
      new Error(`Cannot read the body of ${definition.id}: ${definition.path} (${cause})`),
  }).pipe(Effect.orDie);

export const load = Effect.fn("skills.load")(function* () {
  const onDisk = yield* Effect.promise(() => bodies());
  // Each definition's own `path`, named the way the scan names it.
  const listed = new Set(definitions.map((definition) => definition.path.slice(ROOT.length + 1)));
  const forgotten = onDisk.filter((body) => !listed.has(body));

  if (forgotten.length > 0) {
    return yield* Effect.die(`Add these to skills/definitions/index.ts: ${forgotten.join(", ")}`);
  }

  return yield* Effect.forEach(definitions, (definition) =>
    Effect.map(body(definition), (content) => ({ ...definition, content })),
  );
});
