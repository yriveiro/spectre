import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import type { Fields, Finding, Info, Output } from "./fields";
import { DESCRIPTION, Input as InputSchema, Output as OutputSchema } from "./fields";
import { lint } from "./lint";
import { commitChanges, findingsText, openPullRequest, push, read, write } from "./read";
import { compose, composeCommit, type Draft } from "./render";

const publishBranch = async (
  cwd: string,
  input: Fields,
  draft: Draft,
  committed?: boolean,
): Promise<Output> => {
  const baseFail = {
    status: "failed" as const,
    ...(committed === undefined ? {} : { committed }),
    draft: false,
    directory: cwd,
  };

  const facts = await read(cwd, input.base);
  if (!facts.ok) return { ...baseFail, problems: facts.problems, pushed: false };

  const sent = await push(cwd, facts);
  if (sent.problems !== "") return { ...baseFail, problems: sent.problems, pushed: sent.pushed };

  const existing = await openPullRequest(cwd, facts.branch);
  if (existing.kind === "unreadable")
    return { ...baseFail, problems: existing.problems, pushed: sent.pushed };

  const wrote = await write(cwd, draft, facts.base, existing);
  if (!wrote.ok) return { ...baseFail, problems: wrote.problems, pushed: sent.pushed };

  return {
    status: existing.kind === "open" ? "updated" : "created",
    number: wrote.number,
    url: wrote.url,
    branch: facts.branch,
    base: facts.base,
    title: draft.title,
    body: draft.body,
    ...(committed === undefined ? {} : { committed }),
    pushed: sent.pushed,
    changed: wrote.changed,
    ...(wrote.problems === "" ? {} : { problems: wrote.problems }),
  };
};

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

  if (input.action === "compose") {
    return { status: "composed", title: draft.title, body: draft.body };
  }

  let committed: boolean | undefined;
  if (input.commit !== undefined) {
    const res = await commitChanges(cwd, composeCommit(input, input.commit), input.commit.files);
    if (!res.ok) {
      return {
        status: "failed",
        problems: res.problems,
        committed: false,
        pushed: false,
        draft: false,
        directory: cwd,
      };
    }
    committed = res.committed;
  }

  return publishBranch(cwd, input, draft, committed);
};

export const pr = (ctx: Plugin.Context): Info => ({
  name: "pr",
  description: DESCRIPTION,
  input: InputSchema,
  output: OutputSchema,
  options: { namespace: "spectre", codemode: true, permission: "pr" },
  execute: (input, context) =>
    Effect.gen(function* () {
      let cwd: string = ctx.location.directory;
      const explicit = input.cwd?.trim();
      if (explicit !== undefined && explicit !== "") {
        cwd = explicit;
      } else if (context?.sessionID !== undefined && typeof ctx.session?.get === "function") {
        const info = yield* Effect.result(ctx.session.get({ sessionID: context.sessionID }));
        if (info._tag === "Success" && info.success.location.directory !== "") {
          cwd = info.success.location.directory;
        }
      }
      return { output: yield* Effect.promise(() => run(cwd, input)) };
    }),
});

export type { Fields, Finding, Output };
