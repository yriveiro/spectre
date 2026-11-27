import { type Plugin, Tool } from "@opencode/plugin/effect";
import { Cause, Effect, Option } from "effect";
import { snapshot as snapshotBrain } from "../brain";
import { collectNocturna } from "../nocturna";
import { board } from "./board";
import { composeBrain } from "./brain";
import { diagram, page, report } from "./compose";
import {
  type Composed,
  type DiffInput,
  Input,
  type Input as InputType,
  Output,
  type RenderableContent,
  refused,
} from "./content";
import { bundle } from "./d3";
import { load, write } from "./evidence";
import { nocturnaBoard } from "./nocturna";
import { applyPatchOps, CANVAS_STATE_FILE, decodeCanvasState, encodeCanvasState } from "./patch";
import { pr as composePr } from "./pr";
import { create, preflight, readArtifact, update } from "./publish";
import type { Read, Input as ReadInput } from "./read";
import { read as readDiff, totalsOf } from "./read";

const DESCRIPTION = `Publish or update visual HTML pages, Mermaid diagrams, Markdown reports, dashboards, brain graphs, and PR reviews.
Use action "diff" to parse a pull request or local diff into review evidence, "publish" to create a visual OpenCode artifact URL, "update" to replace an art_ artifact, and "patch" to edit saved canvas state.
Content kinds cover "page" (with bundled d3.min.js), "report", "diagram", "pr", "board" dashboards, "brain" connectome graphs, and "nocturna" for a Nocturna telemetry dashboard.`;

const subjectOf = (
  input: DiffInput,
):
  | { readonly ok: true; readonly input: ReadInput }
  | { readonly ok: false; readonly problem: string } => {
  if (input.pr !== undefined) return { ok: true, input: { pr: input.pr } };
  if (input.url !== undefined) return { ok: true, input: { url: input.url } };
  if (input.base === undefined && input.head === undefined)
    return {
      ok: false,
      problem:
        "a diff needs one of `pr`, `url`, or `base` with `head`; none is inferred from the branch",
    };
  if (input.base === undefined || input.head === undefined)
    return { ok: false, problem: "a local diff needs both `base` and `head`; neither is inferred" };
  return { ok: true, input: { base: input.base, head: input.head } };
};

const bytesOf = (files: Readonly<Record<string, string>>): number => {
  const encoder = new TextEncoder();
  return Object.values(files).reduce((total, file) => total + encoder.encode(file).byteLength, 0);
};

const causeMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Turn a rejecting promise into a value the tool can report. The filesystem and
 * the installed d3 bundle are outside the program, so a rejection is a refusal,
 * never a defect that reaches the host as a crash.
 */
const attempt = <A>(
  run: () => Promise<A>,
): Effect.Effect<
  { readonly ok: true; readonly value: A } | { readonly ok: false; readonly problem: string }
> =>
  Effect.tryPromise({ try: run, catch: causeMessage }).pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catch((problem: string) => Effect.succeed({ ok: false as const, problem })),
  );

const resolveBrainDirectory = (
  ctx: Plugin.Context,
  sessionID: Tool.Context["sessionID"],
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const fallback = ctx.location.directory ?? ctx.location.project.directory;
    if (typeof ctx.session?.get !== "function") return fallback;
    const info = yield* Effect.catch(ctx.session.get({ sessionID }), () =>
      Effect.succeed(undefined),
    );
    return info?.location?.directory ?? fallback;
  });

const buildContent = (
  ctx: Plugin.Context,
  sessionID: Tool.Context["sessionID"],
  content: RenderableContent,
): Effect.Effect<Composed> =>
  Effect.gen(function* () {
    const project = ctx.location.project.directory;
    switch (content.kind) {
      case "pr": {
        const evidence = yield* Effect.promise(() => load(project, content.token));
        if (evidence === undefined)
          return {
            ok: false as const,
            problem: `no evidence for token ${content.token}; run \`diff\` again and use the token it returns`,
          };
        return composePr(evidence, content.review);
      }
      case "page": {
        const built = yield* attempt(() => page(content, bundle));
        return built.ok ? built.value : { ok: false as const, problem: built.problem };
      }
      case "report":
        return report(content);
      case "diagram":
        return diagram(content);
      case "board": {
        const built = yield* attempt(() => board(project, content));
        return built.ok ? built.value : { ok: false as const, problem: built.problem };
      }
      case "brain": {
        const brainDirectory = yield* resolveBrainDirectory(ctx, sessionID);
        const snap = yield* snapshotBrain(brainDirectory).pipe(
          Effect.map((value) => ({ ok: true as const, value })),
          Effect.catch((error) => Effect.succeed({ ok: false as const, problem: causeMessage(error) })),
        );
        if (!snap.ok) return { ok: false as const, problem: snap.problem };
        const built = yield* attempt(() => composeBrain(snap.value, content, bundle));
        return built.ok ? built.value : { ok: false as const, problem: built.problem };
      }
      default: {
        const _exhaustive: never = content;
        return _exhaustive;
      }
    }
  });

const executeDiff = (ctx: Plugin.Context, input: DiffInput): Effect.Effect<{ output: Output }> =>
  Effect.gen(function* () {
    const project = ctx.location.project.directory;
    const cwd = ctx.location.directory;
    const subject = subjectOf(input);
    if (!subject.ok) return { output: refused(subject.problem) };

    const read: Read = yield* Effect.promise(() => readDiff(cwd, subject.input));
    if (read.status === "refused") return { output: refused(read.problem) };

    const wrote = yield* attempt(() => write(project, read));
    if (!wrote.ok) return { output: refused(wrote.problem) };

    return {
      output: {
        status: "read" as const,
        token: wrote.value.token,
        subject: read.subject,
        totals: totalsOf(read.files),
        cross: read.cross,
        files: wrote.value.rows,
        warnings: read.problems,
      },
    };
  });

const PERMISSION_SIGNALS = new Set<unknown>([
  "Permission.DeclinedError",
  "Permission.CorrectedError",
]);

const isPermissionSignal = (cause: Cause.Cause<unknown>): boolean =>
  cause.reasons.some((reason) => {
    const item = Cause.isDieReason(reason)
      ? reason.defect
      : Cause.isFailReason(reason)
        ? reason.error
        : undefined;
    const candidate = item instanceof Tool.Error ? item.error : item;
    return (
      typeof candidate === "object" &&
      candidate !== null &&
      "_tag" in candidate &&
      PERMISSION_SIGNALS.has(candidate._tag)
    );
  });

const inspectPermissionError = (
  error: Tool.Error,
): { readonly kind: "declined" } | { readonly kind: "refused"; readonly problem: string } => {
  const inner = error.error;
  if (typeof inner === "object" && inner !== null && "_tag" in inner) {
    if (inner._tag === "Permission.DeclinedError") return { kind: "declined" };
    if (inner._tag === "Permission.CorrectedError") {
      const raw =
        "feedback" in inner && typeof inner.feedback === "string" ? inner.feedback : error.message;
      const trimmed = raw.trim();
      if (trimmed !== "") return { kind: "refused", problem: trimmed };
    }
  }
  return { kind: "refused", problem: "Nocturna telemetry requires read permission." };
};

const assertNocturnaReadPermission = (
  ctx: Plugin.Context,
  context: Tool.Context,
): Effect.Effect<
  { readonly ok: true } | { readonly ok: false; readonly problem: string },
  Tool.Error
> => {
  const assertPermission = ctx.permission?.assert;
  if (typeof assertPermission !== "function") {
    return Effect.succeed({
      ok: false as const,
      problem: "Nocturna telemetry requires read permission.",
    });
  }
  return assertPermission({
    sessionID: context.sessionID,
    ...(context.agent === undefined ? {} : { agent: context.agent }),
    action: "read",
    resources: ["*"],
    ...(context.messageID !== undefined && context.id !== undefined
      ? { source: { type: "tool" as const, messageID: context.messageID, id: context.id } }
      : {}),
  }).pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) => {
        if (Cause.hasDies(cause) || Cause.hasInterrupts(cause)) {
          return Effect.failCause(cause);
        }
        const failure = Option.getOrUndefined(Cause.findErrorOption(cause));
        if (!(failure instanceof Tool.Error)) return Effect.failCause(cause);
        const inspected = inspectPermissionError(failure);
        if (inspected.kind === "declined") return Effect.failCause(cause);
        return Effect.succeed({ ok: false as const, problem: inspected.problem });
      },
      onSuccess: () => Effect.succeed({ ok: true as const }),
    }),
  );
};

const resolveTargetContent = (
  ctx: Plugin.Context,
  context: Tool.Context,
  input: Exclude<InputType, DiffInput>,
  now: number,
): Effect.Effect<
  | { readonly ok: true; readonly content: RenderableContent }
  | { readonly ok: false; readonly problem: string },
  Tool.Error
> =>
  Effect.gen(function* () {
    if (input.action !== "patch") {
      const { content } = input;
      if (content.kind !== "nocturna") return { ok: true as const, content };
      const permitted = yield* assertNocturnaReadPermission(ctx, context);
      if (!permitted.ok) return permitted;
      return yield* collectNocturna(
        ctx,
        {
          days: content.days,
          limit: content.limit,
          includeAnalyzed: content.includeAnalyzed,
        },
        context,
        now,
      ).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            Cause.hasInterrupts(cause) || isPermissionSignal(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning("Nocturna telemetry collection failed", {
                  cause: Cause.pretty(cause),
                }).pipe(
                  Effect.as({
                    ok: false as const,
                    problem: "Nocturna telemetry could not be collected.",
                  }),
                ),
          onSuccess: ({ output }) =>
            Effect.succeed({ ok: true as const, content: nocturnaBoard(output) }),
        }),
      );
    }
    const existing = yield* readArtifact({ ctx, context, id: input.id });
    if (existing.status !== "read") return { ok: false as const, problem: existing.problem };
    const decoded = decodeCanvasState(existing.files);
    if (!decoded.ok) return decoded;
    return applyPatchOps(decoded.content, input.ops);
  });

export const canvases = (
  ctx: Plugin.Context,
  clock: () => number = Date.now,
): Tool.Info<typeof Input, typeof Output> => ({
  name: "canvas",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, permission: "canvas" },
  execute: Effect.fn("Canvas.execute")(function* (input: InputType, context: Tool.Context) {
    if (input.action === "diff") return yield* executeDiff(ctx, input);
    if (input.action !== "publish" && !input.id.startsWith("art_"))
      return { output: refused(`${input.action} id must be an artifact id that starts with \`art_\``) };

    if (input.action === "publish" || input.action === "update") {
      const ready = yield* preflight(ctx, input.action);
      if (!ready.ok) return { output: refused(ready.problem) };
    }

    const resolved = yield* resolveTargetContent(ctx, context, input, clock());
    if (!resolved.ok) return { output: refused(resolved.problem) };

    const built: Composed = yield* buildContent(ctx, context.sessionID, resolved.content);
    if (!built.ok) return { output: refused(built.problem) };

    const filesWithState: Readonly<Record<string, string>> =
      resolved.content.kind === "brain"
        ? built.files
        : {
            ...built.files,
            [CANVAS_STATE_FILE]: encodeCanvasState(resolved.content),
          };

    const publication =
      input.action === "publish"
        ? yield* create({ ctx, context, title: built.title, files: filesWithState })
        : yield* update({ ctx, context, id: input.id, title: built.title, files: filesWithState });

    if (publication.status !== "published") return { output: refused(publication.problem) };

    return {
      output: {
        status: "published" as const,
        id: publication.id,
        url: publication.url,
        provider: publication.provider,
        title: publication.title,
        bytes: bytesOf(filesWithState),
        warnings: [...built.warnings],
      },
    };
  }),
});
