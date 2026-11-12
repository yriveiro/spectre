import { join } from "node:path";

/**
 * The goal contract, as types rather than a bag of strings.
 *
 * A `Contract` is only produced by `parseContract`, and a `Composed` only by
 * `compose`. The brand on each is a unique symbol that never leaves this module,
 * so a caller cannot build either from raw fields and skip the rules.
 *
 * The host owns the loop; this module owns what the loop is told.
 */

/** The host's cap at `packages/core/src/plugin/goal.ts` in OpenCode 2.2.7. */
export const MAX_OBJECTIVE = 4_000;

/**
 * The host HTML-escapes these before it puts the objective in the kickoff, every
 * continuation and the reviewer prompt (`escape` in the same file). A check that
 * contains one would reach the model as a different command, so the contract
 * refuses it.
 */
export const FORBIDDEN = ["&", "<", ">"] as const;

declare const objectiveBrand: unique symbol;
declare const predicateBrand: unique symbol;
declare const checkBrand: unique symbol;
declare const evidenceBrand: unique symbol;
declare const contractBrand: unique symbol;
declare const composedBrand: unique symbol;

export type Objective = string & { readonly [objectiveBrand]: "Goal.Objective" };
export type Predicate = string & { readonly [predicateBrand]: "Goal.Predicate" };
export type Check = string & { readonly [checkBrand]: "Goal.Check" };
export type Evidence = string & { readonly [evidenceBrand]: "Goal.Evidence" };

/** The procedure the objective names, so a babysit does not read the autonomous-run steps. */
export type Playbook = "playbook-autonomous-run" | "playbook-babysit";

/** The fields the arming call carries, before any rule is applied. */
export type RawContract = {
  readonly objective: string;
  readonly predicate: string;
  readonly check: string;
  readonly evidence?: string;
  readonly playbook?: Playbook;
};

/** A contract whose fields passed `parseContract`. It cannot be built another way. */
export type Contract = {
  readonly objective: Objective;
  readonly predicate: Predicate;
  readonly check: Check;
  readonly evidence?: Evidence;
  readonly playbook: Playbook;
} & { readonly [contractBrand]: true };

/** The objective text the host will store. It cannot be built another way. */
export type Composed = string & { readonly [composedBrand]: "Goal.Composed" };

export type Parsed<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly problems: ReadonlyArray<string> };

/** The measured place a session stands in. */
export type Feature = {
  readonly kind: "feature";
  readonly directory: string;
  readonly branch: string;
};

export type Place =
  | Feature
  | { readonly kind: "main-worktree"; readonly directory: string }
  | { readonly kind: "main-branch"; readonly directory: string; readonly branch: string }
  | { readonly kind: "detached"; readonly directory: string }
  | { readonly kind: "not-a-repository"; readonly directory: string; readonly why: string };

/** What the session may read back from the host's goal state. */
export type GoalView = {
  readonly id: string;
  readonly objective: string;
  readonly status: "active" | "paused" | "complete";
  readonly reason?: string;
  readonly rounds: number;
  readonly maxRounds: number;
  readonly stalls?: number;
  readonly updatedAt: number;
};

export const LEDGER = join(".spectre", "run.md");

export const ledgerPath = (directory: string) => join(directory, LEDGER);

const forbiddenProblems = (field: string, value: string): ReadonlyArray<string> =>
  FORBIDDEN.flatMap((char) =>
    value.includes(char)
      ? [
          `${field} contains "${char}". The host escapes it in every goal prompt, so the model would see a different instruction. Rewrite it without that character.`,
        ]
      : [],
  );

const oneLine = (field: string, value: string): ReadonlyArray<string> => {
  const problems: Array<string> = [];
  if (value.trim() === "") problems.push(`${field} is empty.`);
  if (value !== value.trim()) problems.push(`${field} has leading or trailing whitespace.`);
  if (/[\r\n]/.test(value)) problems.push(`${field} must be one line.`);
  problems.push(...forbiddenProblems(field, value));
  return problems;
};

/** Parse raw fields into the only shape `compose` accepts. */
export const parseContract = (raw: RawContract): Parsed<Contract> => {
  const problems = [
    ...oneLine("objective", raw.objective),
    ...oneLine("predicate", raw.predicate),
    ...oneLine("check", raw.check),
    ...(raw.evidence === undefined ? [] : oneLine("evidence", raw.evidence)),
  ];

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    value: {
      objective: raw.objective as Objective,
      predicate: raw.predicate as Predicate,
      check: raw.check as Check,
      ...(raw.evidence === undefined ? {} : { evidence: raw.evidence as Evidence }),
      playbook: raw.playbook ?? "playbook-autonomous-run",
    } as Contract,
  };
};

/** The one text the host stores, and the one every round reads back. */
export const compose = (contract: Contract, place: Feature): Parsed<Composed> => {
  const ledger = ledgerPath(place.directory);
  const text = [
    `Objective: ${contract.objective}`,
    "",
    `Worktree: ${place.directory} (branch ${place.branch}). Change files only inside it.`,
    "",
    `Exit predicate: ${contract.predicate}`,
    `Check: ${contract.check}. Run it after your last change of every round, and quote its output. The reviewer sees only this conversation.`,
    ...(contract.evidence === undefined ? [] : [`Evidence also required: ${contract.evidence}`]),
    "",
    `Ledger: ${ledger}. Append one row per round: the round number, what changed, the check output in one line, whether the predicate moved, and the head SHA. Never rewrite a row.`,
    "",
    `Follow the ${contract.playbook} skill. If you need a decision, credentials, or a manual step only the user can provide, say exactly what and stop. When you delegate, choose the model with tools.spectre.routing first.`,
    "",
    "A claim without tool output, command output, or file contents shown in this conversation does not count.",
  ].join("\n");

  const problems: Array<string> = [];
  if (text.length > MAX_OBJECTIVE)
    problems.push(
      `The composed objective is ${text.length} characters; the host accepts ${MAX_OBJECTIVE}. Shorten the objective or the evidence.`,
    );
  for (const char of FORBIDDEN)
    if (text.includes(char))
      problems.push(`The composed objective contains "${char}", which the host escapes.`);

  return problems.length > 0 ? { ok: false, problems } : { ok: true, value: text as Composed };
};

/** The refusal for every place that is not a feature worktree, with the fix. */
export const refusal = (place: Exclude<Place, Feature>): string => {
  switch (place.kind) {
    case "main-worktree":
      return `This session is in the main worktree at ${place.directory}. A goal armed here would edit a branch in the directory you stand in. Run /wt <name> here, then arm from the feature worktree.`;
    case "main-branch":
      return `This session is in a linked worktree on the trunk at ${place.directory}. A goal must run on a feature branch. Open a feature worktree from the project's main worktree with /wt <name>, then arm there.`;
    case "detached":
      return `This session is on a detached HEAD at ${place.directory}. A goal must run on a feature branch. Move this session to the project's main worktree, run /wt <name> there, and arm.`;
    case "not-a-repository":
      return `This session is not in a git working tree at ${place.directory}: ${place.why}. Open the project's main worktree, run /wt <name>, and arm there.`;
  }
};
