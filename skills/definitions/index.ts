import { Effect } from "effect";
import { architect } from "./architect";
import { arena } from "./arena";
import { automateMe } from "./automate-me";
import { blastRadius } from "./blast-radius";
import { bro } from "./bro";
import { canvas } from "./canvas";
import { codeHygiene } from "./code-hygiene";
import { communication } from "./communication";
import { createVerificationSkill } from "./create-verification-skill";
import {
  type Definition,
  type LoadedSkill,
  type PullCategory,
  type PushGroup,
  type SkillCatalog,
  toSkillInfo,
} from "./definition";
import { diagram } from "./diagram";
import { effectBestPractices } from "./effect-best-practices";
import { elysiaBestPractices } from "./elysia-best-practices";
import { figureItOut } from "./figure-it-out";
import { grammar } from "./grammar";
import { how } from "./how";
import { interrogate } from "./interrogate";
import { lookFirst } from "./look-first";
import { maintainVerificationSkill } from "./maintain-verification-skill";
import { modelRouter } from "./model-router";
import { opencodePlatform } from "./opencode-platform";
import { playbook } from "./playbook";
import { playbookAuthoringASkill } from "./playbook-authoring-a-skill";
import { playbookAutonomousRun } from "./playbook-autonomous-run";
import { playbookAutopilotFull } from "./playbook-autopilot-full";
import { playbookAutopilotStack } from "./playbook-autopilot-stack";
import { playbookBabysit } from "./playbook-babysit";
import { playbookBrain } from "./playbook-brain";
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
import { playbookWorktreeInit } from "./playbook-worktree-init";
import { prCanvas } from "./pr-canvas";
import { principleAttackThePremise } from "./principle-attack-the-premise";
import { principleBoundaryDiscipline } from "./principle-boundary-discipline";
import { principleBuildTheLever } from "./principle-build-the-lever";
import { principleEncodeLessonsInStructure } from "./principle-encode-lessons-in-structure";
import { principleEvidence } from "./principle-evidence";
import { principleExhaustTheDesignSpace } from "./principle-exhaust-the-design-space";
import { principleExperienceFirst } from "./principle-experience-first";
import { principleFixRootCauses } from "./principle-fix-root-causes";
import { principleFoundationalThinking } from "./principle-foundational-thinking";
import { principleGuardTheContextWindow } from "./principle-guard-the-context-window";
import { principleHygiene } from "./principle-hygiene";
import { principleLazinessProtocol } from "./principle-laziness-protocol";
import { principleMakeOperationsIdempotent } from "./principle-make-operations-idempotent";
import { principleMakeStatesUnrepresentable } from "./principle-make-states-unrepresentable";
import { principleMigrateCallersThenDeleteLegacyApis } from "./principle-migrate-callers-then-delete-legacy-apis";
import { principleMinimizeReaderLoad } from "./principle-minimize-reader-load";
import { principleModelTheDomain } from "./principle-model-the-domain";
import { principleNeverBlockOnTheHuman } from "./principle-never-block-on-the-human";
import { principleOutcomeOrientedExecution } from "./principle-outcome-oriented-execution";
import { principleProveItWorks } from "./principle-prove-it-works";
import { principleRedesignFromFirstPrinciples } from "./principle-redesign-from-first-principles";
import { principleSeparateBeforeSerializingSharedState } from "./principle-separate-before-serializing-shared-state";
import { principleSequenceVerifiableUnits } from "./principle-sequence-verifiable-units";
import { principleSubtractBeforeYouAdd } from "./principle-subtract-before-you-add";
import { principleTestBehaviorNotImplementation } from "./principle-test-behavior-not-implementation";
import { principleTestForTruth } from "./principle-test-for-truth";
import { principleTypeSystemDiscipline } from "./principle-type-system-discipline";
import { principleVerification } from "./principle-verification";
import { ripwire } from "./ripwire";
import { showMeYourWork } from "./show-me-your-work";
import { solidjsBestPractices } from "./solidjs-best-practices";
import { spectreMode } from "./spectre-mode";
import { swarm } from "./swarm";
import { tdd } from "./tdd";
import { teach } from "./teach";
import { technicalWriting } from "./technical-writing";
import { typescriptBestPractices } from "./typescript-best-practices";
import { why } from "./why";
import { worktreeCleanup } from "./worktree-cleanup";

export const definitions: ReadonlyArray<Definition> = [
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
  effectBestPractices,
  elysiaBestPractices,
  solidjsBestPractices,
  opencodePlatform,
  playbook,
  playbookAuthoringASkill,
  playbookAutonomousRun,
  playbookAutopilotFull,
  playbookAutopilotStack,
  playbookBabysit,
  playbookBrain,
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
  playbookWorktreeInit,
  prCanvas,
  arena,
  bro,
  canvas,
  diagram,
  codeHygiene,
  communication,
  grammar,
  lookFirst,
  modelRouter,
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
  principleTestForTruth,
  principleVerification,
  spectreMode,
  principleGuardTheContextWindow,
  ripwire,
  swarm,
];

export {
  type Definition,
  type LoadedSkill,
  type PullCategory,
  type PushGroup,
  type SkillCatalog,
  toSkillInfo,
};

export const notALeaf: ReadonlySet<string> = new Set(
  definitions
    .filter((definition) => !(definition.catalog.tier === "push" && definition.catalog.group === "leaf"))
    .map((definition) => definition.id),
);

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

let cached: ReadonlyArray<LoadedSkill> | undefined;

export const load = Effect.fn("skills.load")(function* (options?: { readonly fresh?: boolean }) {
  if (cached !== undefined && options?.fresh !== true) return cached;

  const onDisk = yield* Effect.promise(() => bodies());
  const listed = new Set(definitions.map((definition) => definition.path.slice(ROOT.length + 1)));
  const forgotten = onDisk.filter((entry) => !listed.has(entry));

  if (forgotten.length > 0) {
    return yield* Effect.die(`Add these to skills/definitions/index.ts: ${forgotten.join(", ")}`);
  }

  const loaded = yield* Effect.forEach(definitions, (definition) =>
    Effect.map(body(definition), (content): LoadedSkill => ({ ...definition, content })),
  );
  cached = loaded;
  return loaded;
});
