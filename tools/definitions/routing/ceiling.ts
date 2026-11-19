import type { Candidate, CostCeiling } from "./types";

/**
 * The cost ceiling, and the reports it produces.
 *
 * A ceiling constrains the priority order; it never sorts it. The arithmetic
 * and the wording live here, so the resolver and the check cannot drift.
 */

/** True when the candidate's price is within the ceiling. */
export const affordable = (
  candidate: Pick<Candidate, "model">,
  ceiling: CostCeiling | undefined,
): boolean => {
  if (ceiling === undefined) return true;
  if (ceiling.input !== undefined && candidate.model.costInput > ceiling.input) return false;
  if (ceiling.output !== undefined && candidate.model.costOutput > ceiling.output) return false;
  return true;
};

/** The ceiling as a sentence fragment, for a report that names what it refused. */
export const ceilingOf = (ceiling: CostCeiling): string => {
  const parts: Array<string> = [];
  if (ceiling.input !== undefined) parts.push(`input $${ceiling.input}`);
  if (ceiling.output !== undefined) parts.push(`output $${ceiling.output}`);
  return `${parts.join(" / ")} per million tokens`;
};

/** Why a candidate that reaches the requirement is still not spent. */
export const ceilingReason = (candidate: Candidate, ceiling: CostCeiling): string =>
  `costs input $${candidate.model.costInput} / output $${candidate.model.costOutput} per million tokens, above the ceiling of ${ceilingOf(ceiling)}`;

/** The shape problems a ceiling can have, and whether it can be used. */
export const ceilingProblems = (
  label: string,
  ceiling: CostCeiling | undefined,
): { readonly problems: ReadonlyArray<string>; readonly ok: boolean } => {
  if (ceiling === undefined) return { problems: [], ok: true };

  const problems: Array<string> = [];
  if (ceiling.input === undefined && ceiling.output === undefined)
    problems.push(`${label}: states no bound. Name "input", "output", or both.`);

  for (const [side, value] of [
    ["input", ceiling.input],
    ["output", ceiling.output],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0)
      problems.push(
        `${label}.${side}: ${value} is not a price. Use a finite number at or above zero.`,
      );
  }

  return { problems, ok: problems.length === 0 };
};

/** The contradiction between a pin and a ceiling, when there is one. */
export const pinCeilingProblem = (
  label: string,
  pin:
    | {
        readonly alias: string;
        readonly costInput: number;
        readonly costOutput: number;
      }
    | undefined,
  ceiling: CostCeiling | undefined,
): string | undefined => {
  if (pin === undefined || ceiling === undefined) return undefined;

  const over =
    (ceiling.input !== undefined && pin.costInput > ceiling.input) ||
    (ceiling.output !== undefined && pin.costOutput > ceiling.output);
  if (!over) return undefined;

  return `${label}: the pinned model "${pin.alias}" costs input $${pin.costInput} / output $${pin.costOutput} per million tokens, above the ceiling. A pin and a ceiling contradict; raise the ceiling or remove the pin.`;
};
