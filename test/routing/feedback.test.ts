import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { type FeedbackPage, routingFeedback } from "../../tools/definitions/routing/feedback";
import { context, useScratch } from "./fixture";

const scratch = useScratch();

const call = async (
  directory: string,
  input: {
    readonly profile: string;
    readonly model: string;
    readonly outcome: "accepted" | "revised" | "failed" | "unknown";
    readonly confidence?: number;
    readonly task?: string;
    readonly note?: string;
  },
  sessionID = "ses_project",
) => {
  const run = routingFeedback(context(directory, undefined, { ses_project: directory }))
    .execute as unknown as (
    given: typeof input,
    context: { readonly sessionID: string },
  ) => Effect.Effect<{ output: FeedbackPage }>;
  return (await Effect.runPromise(run(input, { sessionID }))).output;
};

describe("routing_feedback", () => {
  test("appends one line with the profile, the model and the outcome", async () => {
    await scratch.writeProject("{}");
    const out = await call(scratch.projectDir(), {
      profile: "worker",
      model: "opencode-go/muse-spark-1.3-contributor#high",
      outcome: "accepted",
      confidence: 0.82,
      task: "add the field",
    });

    expect(out.status).toBe("recorded");
    if (out.status !== "recorded") return;
    const lines = (await Bun.file(out.path).text()).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      profile: "worker",
      model: "opencode-go/muse-spark-1.3-contributor#high",
      outcome: "accepted",
      confidence: 0.82,
      task: "add the field",
    });
  });

  test("a second outcome is appended, not written over the first", async () => {
    await scratch.writeProject("{}");
    const first = await call(scratch.projectDir(), {
      profile: "worker",
      model: "m",
      outcome: "revised",
    });
    const second = await call(scratch.projectDir(), {
      profile: "worker",
      model: "m",
      outcome: "accepted",
    });

    expect(first.status).toBe("recorded");
    expect(second.status).toBe("recorded");
    if (first.status !== "recorded") return;
    const lines = (await Bun.file(first.path).text()).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ outcome: "accepted" });
  });

  test("a session that cannot be read is refused, not guessed", async () => {
    await scratch.writeProject("{}");
    const out = await call(
      scratch.projectDir(),
      { profile: "worker", model: "m", outcome: "unknown" },
      "ses_missing",
    );
    expect(out.status).toBe("refused");
    if (out.status !== "refused") return;
    expect(out.problem).toContain("could not be read");
  });
});
