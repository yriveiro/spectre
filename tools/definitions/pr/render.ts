import type { Commit, Fields } from "./fields";

export type Draft = {
  readonly title: string;
  readonly body: string;
};

const heading = (name: string) => `## ${name}`;

const stripBullet = (item: string) => item.trim().replace(/^[-*+]\s+/, "");

const bullets = (items: ReadonlyArray<string>) =>
  items.map((one) => `- ${stripBullet(one)}`).join("\n");

const checks = (fields: Fields) =>
  fields.validation.map((one) => `- ${one.check} → ${one.result}`).join("\n");

const MERGE_GATE = [
  "- [ ] Explicit direct user approval is recorded.",
  "- [ ] All required GitHub Actions checks are green.",
  "- [ ] If checks are not green, the direct user override names the failed checks and reason.",
].join("\n");

export const composeTitle = (fields: Pick<Fields, "type" | "scope" | "breaking" | "subject">) =>
  `${fields.type}(${fields.scope})${fields.breaking === undefined ? "" : "!"}: ${fields.subject}`;

export const compose = (fields: Fields): Draft => {
  const title = composeTitle(fields);

  const sections = [
    heading("Summary"),
    fields.summary,
    heading("Review"),
    fields.review,
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

export const composeCommit = (fields: Fields, commit: Commit): string => {
  const blocks = [
    composeTitle(fields),
    `# Description\n${commit.description.trim()}`,
    `# Changes\n${bullets(commit.changes)}`,
    ...(fields.breaking === undefined
      ? []
      : [`# Breaking Changes\n- ${stripBullet(fields.breaking)}`]),
  ];
  return blocks.join("\n\n");
};
