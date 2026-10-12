// From the subpath, as `commands/definitions/pr/index.ts` does for
// `CommandDefinition`: the barrel does not re-export this one.
import type { ToolHooks } from "@opencode/plugin/effect/tool";
import { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";
import { isFigure, readReceipt } from "./receipt";

/** The input a `present` call carries, narrowed so `id` needs no cast below. */
type Present = { readonly action: "present"; readonly id: string };

const isPresent = (input: unknown): input is Present =>
  typeof input === "object" &&
  input !== null &&
  (input as { action?: unknown }).action === "present" &&
  typeof (input as { id?: unknown }).id === "string";

/**
 * A figure cannot be shown until it has been proved.
 *
 * This hooks `tool.execute.before` because that is the only hook that can reject
 * a call, and the canvas tool's `present` is the moment a figure becomes the
 * reader's. The rule is narrow on purpose: it fires only for a canvas this
 * plugin marked as a figure, and only when a receipt records that it has not
 * passed.
 *
 * The check reads a receipt rather than re-running the audit, because the audit
 * needs the figure's own module and this hook cannot safely import the caller's
 * code on the way to deciding whether to show a page. `tools.spectre.anatomy`
 * writes the receipt; this reads it.
 *
 * It fails open: a figure with no receipt is shown, because refusing to show work
 * in progress would stop the reader seeing a draft.
 */
export const guardFigure =
  () =>
  (event: ToolHooks["execute.before"]): Effect.Effect<void, Tool.Error> => {
    if (event.tool !== "spectre_canvas") return Effect.void;
    if (!isPresent(event.input)) return Effect.void;
    const { id } = event.input;

    return Effect.gen(function* () {
      if (!(yield* Effect.promise(() => isFigure(id)))) return;
      const receipt = yield* Effect.promise(() => readReceipt(id));
      if (receipt === null || receipt.passed) return;

      yield* Effect.fail(
        new Tool.Error({
          message: [
            `This figure has not passed its audit, so it is not shown.`,
            ``,
            `Faults still open: ${receipt.failures.length}`,
            ...receipt.failures.slice(0, 8).map((one) => `  ${one}`),
            ``,
            `Run \`tools.spectre.anatomy({ action: "check", file: "${receipt.file}" })\``,
            `and fix the geometry rather than the key that hides it.`,
          ].join("\n"),
          metadata: { canvas: id, failures: receipt.failures.length },
        }),
      );
    }).pipe(
      // `catchDefect`, not `catchCause`: the refusal above is a typed
      // `Tool.Error` and is the whole point of this channel, so it has to reach
      // the caller. Only a defect — a receipt read that blew up — is swallowed,
      // because a defect must not become a rejected tool call the model cannot
      // act on.
      Effect.catchDefect((defect) =>
        Effect.logWarning("figure guard could not read its receipt", { canvas: id, defect }).pipe(
          Effect.asVoid,
        ),
      ),
    );
  };
