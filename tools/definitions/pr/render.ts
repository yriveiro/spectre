import type { Fields } from "./fields";

/**
 * The only place a title and a body are spelled. It is pure and total: every field
 * becomes text, no field is consulted twice, and the same fields always produce the
 * same bytes. That is what makes the second run of this tool converge — `updated`
 * compares against these bytes, not against the text the caller happened to send
 * last time.
 */

export type Draft = {
  readonly title: string;
  readonly body: string;
};

const heading = (name: string) => `## ${name}`;

const bullets = (items: ReadonlyArray<string>) => items.map((one) => `- ${one}`).join("\n");

const checks = (fields: Fields) =>
  fields.validation.map((one) => `- ${one.check} → ${one.result}`).join("\n");

/**
 * Untickable by construction. The playbook asks for a recorded human approval, and
 * this tool has no way to read one, so a ticked box here would be a claim the
 * repository makes about a person who has not looked. The reviewer ticks it.
 */
const MERGE_GATE = [
  "- [ ] Explicit direct user approval is recorded.",
  "- [ ] All required GitHub Actions checks are green.",
  "- [ ] If checks are not green, the direct user override names the failed checks and reason.",
].join("\n");

export const compose = (fields: Fields): Draft => {
  const title = `${fields.type}(${fields.scope})${fields.breaking === undefined ? "" : "!"}: ${fields.subject}`;

  const sections = [
    fields.summary,
    heading("Review"),
    fields.review,
    // An empty list renders as an empty heading, and the lint refuses that composition
    // anyway. So this shape only reaches GitHub through a body the lint cleared, which
    // is what makes `body` in a `lint-failed` result diagnostic output and not something
    // to hand to `gh pr create`.
    heading("Scope"),
    bullets(fields.scopeItems),
    ...(fields.tradeoffs === undefined ? [] : [heading("Tradeoffs"), fields.tradeoffs]),
    heading("Validation"),
    checks(fields),
    heading("Risk and Rollback"),
    fields.risk,
    ...(fields.breaking === undefined ? [] : [heading("Breaking Changes"), fields.breaking]),
    heading("Merge Gate"),
    MERGE_GATE,
  ];

  return { title, body: sections.join("\n\n") };
};