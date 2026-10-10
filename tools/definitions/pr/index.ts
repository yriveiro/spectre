import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import type { Fields, Finding, Info, Output } from "./fields";
import { DESCRIPTION, Input as InputSchema, Output as OutputSchema } from "./fields";
import { lint } from "./lint";
import { findingsText, openPullRequest, push, read, write } from "./read";
import { compose } from "./render";

/**
 * Lint before anything is written, so a refused composition leaves the remote as it was.
 * The order of the six calls below is that guarantee: compose, lint, read, push,
 * reconcile, write.
 */
const run = async (cwd: string, input: Fields): Promise<Output> => {
  const draft = compose(input);
  const found: ReadonlyArray<Finding> = lint(input, draft);

  if (found.length > 0)
    return {
      status: "lint-failed",
      problems: findingsText(found),
      title: draft.title,
      body: draft.body,
    };

  const facts = await read(cwd, input.base);
  if (!facts.ok) return { status: "failed", problems: facts.problems, pushed: false, draft: false };

  const sent = await push(cwd, facts);
  if (sent.problems !== "")
    return { status: "failed", problems: sent.problems, pushed: sent.pushed, draft: false };

  const existing = await openPullRequest(cwd, facts.branch);
  if (existing.kind === "unreadable")
    return { status: "failed", problems: existing.problems, pushed: sent.pushed, draft: false };

  const wrote = await write(cwd, draft, facts.base, existing);
  if (!wrote.ok)
    return { status: "failed", problems: wrote.problems, pushed: sent.pushed, draft: false };

  return {
    status: existing.kind === "open" ? "updated" : "created",
    number: wrote.number,
    url: wrote.url,
    branch: facts.branch,
    base: facts.base,
    title: draft.title,
    body: draft.body,
    pushed: sent.pushed,
    changed: wrote.changed,
    ...(wrote.problems === "" ? {} : { problems: wrote.problems }),
  };
};

export const pr = (ctx: Plugin.Context): Info => ({
  name: "pr",
  description: DESCRIPTION,
  input: InputSchema,
  output: OutputSchema,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "pr" },
  execute: (input) =>
    Effect.promise(async () => ({ output: await run(ctx.location.directory, input) })),
});

export type { Fields, Finding, Output };