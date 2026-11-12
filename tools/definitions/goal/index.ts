import type { Plugin } from "@opencode/plugin/effect";
import { Goal } from "@opencode/schema/goal";
import type { Session } from "@opencode/schema/session";
import type { Tool } from "@opencode/schema/tool";
import { Cause, Effect, Schema } from "effect";
import { compose, type GoalView, ledgerPath, parseContract, refusal } from "./contract";
import { ensureHeader } from "./ledger";
import { place as readPlace } from "./read";

/**
 * The tool is the only boundary between a Spectre run and the host's `/goal`
 * loop. The host owns the loop, the reviewer, the round budget and the pause
 * rules. This tool owns the four facts the host cannot know: where the session
 * stands, what "done" means, which command settles it, and where the ledger is.
 *
 * `arm` composes, calls the built-in command, and reads the state back. The read
 * back is what makes it a boundary rather than a forwarder: a later command
 * transform shadows by name (`packages/core/src/command.ts` uses `editor.set`),
 * so a call that only forwards would report `armed` while nothing ran.
 */

const GoalStatus = Schema.Literals(["active", "paused", "complete"]);

const GoalViewSchema = Schema.Struct({
  id: Schema.String,
  objective: Schema.String,
  status: GoalStatus,
  reason: Schema.optional(Schema.String),
  rounds: Schema.Number,
  maxRounds: Schema.Number,
  stalls: Schema.optional(Schema.Number),
  updatedAt: Schema.Number,
});

const Arm = Schema.Struct({
  action: Schema.Literals(["arm"]).annotate({
    description:
      "Arm the built-in /goal loop for this session. Call it once, at the start of a run.",
  }),
  objective: Schema.String.annotate({
    description: "One imperative sentence: the outcome the run must reach, in the user's words.",
  }),
  predicate: Schema.String.annotate({
    description: "The exit condition, as a statement that can come out false.",
  }),
  check: Schema.String.annotate({
    description:
      "The one command or tools.spectre.* call that settles the predicate. One line, no &, < or >.",
  }),
  evidence: Schema.optional(
    Schema.String.annotate({
      description: "Optional extra evidence the run must show, one line.",
    }),
  ),
});

const Status = Schema.Struct({
  action: Schema.Literals(["status"]).annotate({
    description:
      "Read the live goal and the ledger path. Call it on resume and before the final report; it never changes state.",
  }),
});

const Input = Schema.Union([Arm, Status]);

const Armed = Schema.Struct({
  status: Schema.Literals(["armed"]),
  goal: GoalViewSchema,
  ledger: Schema.String,
  problems: Schema.optional(Schema.String),
});

const Read = Schema.Struct({
  status: Schema.Literals(["read"]),
  goal: Schema.NullOr(GoalViewSchema),
  remaining: Schema.NullOr(Schema.Number),
  ledger: Schema.String,
  ledgerExists: Schema.Boolean,
});

const Rejected = Schema.Struct({
  status: Schema.Literals(["rejected"]),
  problems: Schema.String,
});

const Failed = Schema.Struct({
  status: Schema.Literals(["failed"]),
  problems: Schema.String,
});

const Output = Schema.Union([Armed, Read, Rejected, Failed]);

const DESCRIPTION = `Arm or read the built-in /goal loop for this session. This tool never continues the session; the host's goal plugin does.

  const armed = await tools.spectre.goal({
    action: "arm",
    objective: "Take PRs 412-414 to merge-ready",
    predicate: "tools.spectre.stack returns clear and no unresolved threads remain",
    check: "tools.spectre.stack({ prs: [412, 413, 414] })",
  })

Call \`arm\` once, at the start of a run. Call \`status\` when a run resumes or ends.

## The boundary

\`arm\` measures the session's place and refuses to run anywhere a goal would edit the
directory the session stands in:

- the main worktree of an ordinary repository
- a linked worktree checked out on the trunk
- a detached HEAD
- a directory that is not a git working tree
- a child session

It also refuses an active or paused goal, an empty or multi-line field, a field containing
\`&\`, \`<\` or \`>\`, and a composition over the host's 4,000-character cap. The host
HTML-escapes those three characters before every kickoff, continuation and reviewer prompt,
so a command containing one would reach the model as a different command.

After the command returns, \`arm\` reads \`opencode.goal\` back and reports \`armed\` only when
the state is active with the exact composed objective. If another plugin has shadowed the
\`goal\` command, the read-back is how that is caught.

## The objective

The composed text carries the objective, the measured worktree and branch, the exit
predicate, the exact check, the ledger path, the procedure name, the blocked rule and the
delegation rule. It is the durable statement: after a compaction the host's reminder shows
the objective, and the ledger is the only other survivor.

The ledger is \`.spectre/run.md\`. This tool writes its header once per goal id; the model
appends one row per round. A failed header returns \`armed\` with \`problems\`, because the
loop is running and hiding that is worse than the missing file.

## What it will not do

It does not pause, resume, clear, continue, judge or merge. Those are the host's command
and the reviewer's job. It does not mirror \`Goal.State\`: \`status\` reads the live state
through \`opencode.goal.get\`, and the caller reads the ledger for the run's history.

An \`arm\` with the same objective as an already-active goal is idempotent: it returns
\`armed\` and writes no second ledger section. A different objective while a goal is active
is \`rejected\`; the user must \`/goal clear\` first.`;

const viewOf = (state: Goal.State): GoalView => ({
  id: state.id,
  objective: state.objective,
  status: state.status,
  ...(state.reason === undefined ? {} : { reason: state.reason }),
  rounds: state.rounds,
  maxRounds: state.maxRounds,
  ...(state.stalls === undefined ? {} : { stalls: state.stalls }),
  updatedAt: state.updatedAt,
});

type GoalRead =
  | { readonly kind: "read"; readonly goal: Goal.State | null }
  | { readonly kind: "failed"; readonly why: string };

const readGoal = (ctx: Plugin.Context, sessionID: Session.ID): Effect.Effect<GoalRead> =>
  // The plugin's RPC client is bound to this location, so the session's own
  // location is the default. Passing one is not in the plugin client's type.
  Effect.result(ctx.rpc(Goal.Definition).get({ sessionID })).pipe(
    Effect.map((result) =>
      result._tag === "Success"
        ? { kind: "read" as const, goal: result.success }
        : { kind: "failed" as const, why: String(result.failure) },
    ),
  );

type SessionRead =
  | { readonly kind: "read"; readonly session: Session.Info }
  | { readonly kind: "failed"; readonly why: string };

const readSession = (ctx: Plugin.Context, sessionID: Session.ID): Effect.Effect<SessionRead> =>
  Effect.result(ctx.session.get({ sessionID })).pipe(
    Effect.map((result) =>
      result._tag === "Success"
        ? { kind: "read" as const, session: result.success }
        : { kind: "failed" as const, why: String(result.failure) },
    ),
  );

const rejected = (problems: string): typeof Rejected.Type => ({ status: "rejected", problems });
const failed = (problems: string): typeof Failed.Type => ({ status: "failed", problems });

const armed = (goal: GoalView, ledger: string, problems?: string): typeof Armed.Type => ({
  status: "armed",
  goal,
  ledger,
  ...(problems === undefined ? {} : { problems }),
});

const arm = (ctx: Plugin.Context, sessionID: Session.ID, input: typeof Arm.Type) =>
  Effect.gen(function* () {
    const session = yield* readSession(ctx, sessionID);
    if (session.kind === "failed") return failed(`This session could not be read: ${session.why}`);
    if (session.session.parentID !== undefined)
      return rejected("A child session cannot arm a goal. Arm it from the root session.");

    const place = yield* Effect.promise(() => readPlace(session.session.location.directory));
    if (place.kind !== "feature") return rejected(refusal(place));

    const parsed = parseContract(input);
    if (!parsed.ok) return rejected(parsed.problems.join("\n"));

    const composed = compose(parsed.value, place);
    if (!composed.ok) return rejected(composed.problems.join("\n"));

    const current = yield* readGoal(ctx, sessionID);
    if (current.kind === "failed")
      return failed(`The goal state could not be read, so nothing was armed: ${current.why}`);

    const existing = current.goal;
    if (existing?.status === "active") {
      if (existing.objective !== composed.value)
        return rejected(
          `A different goal is active: ${existing.objective}\nRun /goal clear first, or resume that goal.`,
        );
      const recorded = yield* Effect.promise(() =>
        ensureHeader(existing, parsed.value, place, sessionID),
      );
      return armed(
        viewOf(existing),
        ledgerPath(place.directory),
        recorded.status === "failed"
          ? `The goal is already armed, but the ledger header could not be written: ${recorded.why}`
          : undefined,
      );
    }

    if (existing?.status === "paused")
      return rejected(
        `A paused goal is set: ${existing.objective}\nRun /goal resume to continue it, or /goal clear to abandon it.`,
      );

    const command = yield* Effect.result(
      ctx.session.command({ sessionID, name: "goal", text: composed.value }),
    );
    if (command._tag === "Failure")
      return failed(`The /goal command failed: ${String(command.failure)}`);

    const after = yield* readGoal(ctx, sessionID);
    if (after.kind === "failed")
      return failed(`The /goal command ran, but the state could not be read back: ${after.why}`);
    const armedGoal = after.goal;
    if (
      armedGoal === null ||
      armedGoal.status !== "active" ||
      armedGoal.objective !== composed.value
    )
      return failed(
        "The /goal command ran but the active goal did not read back with the composed objective. The goal command may be shadowed by another plugin, or the host refused the objective. Run /goal to inspect the session.",
      );

    const recorded = yield* Effect.promise(() =>
      ensureHeader(armedGoal, parsed.value, place, sessionID),
    );
    return armed(
      viewOf(armedGoal),
      ledgerPath(place.directory),
      recorded.status === "failed"
        ? `The goal is armed, but the ledger header could not be written: ${recorded.why}`
        : undefined,
    );
  });

const status = (ctx: Plugin.Context, sessionID: Session.ID) =>
  Effect.gen(function* () {
    const session = yield* readSession(ctx, sessionID);
    if (session.kind === "failed") return failed(`This session could not be read: ${session.why}`);

    const current = yield* readGoal(ctx, sessionID);
    if (current.kind === "failed")
      return failed(`The goal state could not be read: ${current.why}`);

    const place = yield* Effect.promise(() => readPlace(session.session.location.directory));
    const ledger = ledgerPath(
      place.kind === "feature" ? place.directory : session.session.location.directory,
    );
    const ledgerExists = yield* Effect.promise(() => Bun.file(ledger).exists());

    return {
      status: "read" as const,
      goal: current.goal === null ? null : viewOf(current.goal),
      remaining: current.goal === null ? null : current.goal.maxRounds - current.goal.rounds,
      ledger,
      ledgerExists,
    };
  });

export const goal = (ctx: Plugin.Context): Tool.Info<typeof Input, typeof Output> => ({
  name: "goal",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "goal" },
  execute: (input, context) =>
    Effect.gen(function* () {
      const sessionID = context?.sessionID;
      if (sessionID === undefined)
        return { output: failed("This call carries no session, so no goal can be armed or read.") };

      const output =
        input.action === "arm" ? yield* arm(ctx, sessionID, input) : yield* status(ctx, sessionID);
      return { output };
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.succeed({
              output: failed(`The goal tool failed: ${String(Cause.squash(cause))}`),
            }),
      ),
    ),
});
