import { describe, expect, test } from "bun:test";
import {
  advanceDrift,
  classifyShellMechanical,
  DRIFT_THRESHOLDS,
  ESCALATION_SENTINEL,
  emptyDriftState,
  type MutableContextMessage,
  parseWorkerReport,
  shapeEscalationMessages,
} from "../../tools/definitions/routing";

describe("parseWorkerReport", () => {
  test("parses STATUS: DONE with sessionID, paths, and multiline outcome", () => {
    const raw = `<background-result kind="subagent" sessionID="ses_done_1" state="completed" description="Rename key">
STATUS: DONE
TOUCHED: tools/a.ts, \`tools/b.ts\`
VERIFIED: bun run typecheck (exit 0)
OUTCOME:
- Updated schema
- Updated tests
</background-result>`;

    expect(parseWorkerReport(raw)).toEqual({
      kind: "done",
      sessionID: "ses_done_1",
      touched: ["tools/a.ts", "tools/b.ts"],
      verified: "bun run typecheck (exit 0)",
      outcome: "- Updated schema\n- Updated tests",
    });
  });

  test("parses STATUS: DONE with TOUCHED: none", () => {
    const raw = `STATUS: DONE
TOUCHED: none
VERIFIED: spectre_search complete=1
OUTCOME: Mapped 3 call sites.`;

    expect(parseWorkerReport(raw)).toEqual({
      kind: "done",
      sessionID: undefined,
      touched: [],
      verified: "spectre_search complete=1",
      outcome: "Mapped 3 call sites.",
    });
  });

  test("parses STATUS: ESCALATE for AMBIGUITY, SCOPE, and FAILURE_CAP", () => {
    const ambiguity = `<background-result kind="subagent" sessionID="ses_amb" state="completed" description="Task">
STATUS: ESCALATE
REASON: AMBIGUITY
BLOCKER: Two conflicting contracts in order.ts and check.ts.
OPTIONS_OR_ATTEMPTS: (A) fail; (B) fallback
TOUCHED: none
RECOMMENDED_NEXT: orchestrator_decision
</background-result>`;

    expect(parseWorkerReport(ambiguity)).toEqual({
      kind: "escalate",
      sessionID: "ses_amb",
      reason: "AMBIGUITY",
      blocker: "Two conflicting contracts in order.ts and check.ts.",
      optionsOrAttempts: "(A) fail; (B) fallback",
      touched: [],
      recommendedNext: "orchestrator_decision",
    });

    const scope = `STATUS: ESCALATE
REASON: SCOPE
BLOCKER: Needs edit to src/public.ts outside brief scope.
OPTIONS_OR_ATTEMPTS: Widen scope to src/public.ts.
TOUCHED: src/parser.ts
RECOMMENDED_NEXT: orchestrator_decision`;

    expect(parseWorkerReport(scope)).toEqual({
      kind: "escalate",
      sessionID: undefined,
      reason: "SCOPE",
      blocker: "Needs edit to src/public.ts outside brief scope.",
      optionsOrAttempts: "Widen scope to src/public.ts.",
      touched: ["src/parser.ts"],
      recommendedNext: "orchestrator_decision",
    });

    const failureCap = `STATUS: ESCALATE
REASON: FAILURE_CAP
BLOCKER: 2 attempts failed tsc.
OPTIONS_OR_ATTEMPTS: Attempt 1 broke A; Attempt 2 broke B.
TOUCHED: a.ts, b.ts
RECOMMENDED_NEXT: higher_profile`;

    expect(parseWorkerReport(failureCap)).toEqual({
      kind: "escalate",
      sessionID: undefined,
      reason: "FAILURE_CAP",
      blocker: "2 attempts failed tsc.",
      optionsOrAttempts: "Attempt 1 broke A; Attempt 2 broke B.",
      touched: ["a.ts", "b.ts"],
      recommendedNext: "higher_profile",
    });
  });

  test("tolerates markdown bold **STATUS:** and a 1-line preamble", () => {
    const raw = `<background-result kind="subagent" sessionID="ses_pre" state="completed" description="Fix bug">
I inspected the module and hit a snag before editing.
**STATUS:** ESCALATE
**REASON:** AMBIGUITY
BLOCKER: Unclear null vs Error convention.
</background-result>`;

    expect(parseWorkerReport(raw)).toEqual({
      kind: "escalate",
      sessionID: "ses_pre",
      reason: "AMBIGUITY",
      blocker: "Unclear null vs Error convention.",
      optionsOrAttempts: "",
      touched: [],
      recommendedNext: "orchestrator_decision",
    });
  });

  test("defaults missing REASON and RECOMMENDED_NEXT safely", () => {
    const raw = `STATUS: ESCALATE
BLOCKER: Repeated test failure.`;

    expect(parseWorkerReport(raw)).toEqual({
      kind: "escalate",
      sessionID: undefined,
      reason: "FAILURE_CAP",
      blocker: "Repeated test failure.",
      optionsOrAttempts: "",
      touched: [],
      recommendedNext: "higher_profile",
    });
  });

  test("passes through swarm PASS/ISSUES/BLOCKED and unstructured prose", () => {
    expect(
      parseWorkerReport(`<background-result kind="subagent" sessionID="ses_sw1" state="completed" description="Worker">
PASS
Touched files: a.ts
</background-result>`),
    ).toEqual({ kind: "unstructured", sessionID: "ses_sw1" });

    expect(
      parseWorkerReport(`<background-result kind="subagent" sessionID="ses_sw2" state="completed" description="Worker">
BLOCKED
Missing fixture.
</background-result>`),
    ).toEqual({ kind: "unstructured", sessionID: "ses_sw2" });

    expect(parseWorkerReport("Here is a plain summary with no status header.")).toEqual({
      kind: "unstructured",
      sessionID: undefined,
    });
  });

  test("parses <background-result kind=\"subagent\"> reports", () => {
    const done = `<background-result kind="subagent" sessionID="ses_bg_done" state="completed" description="Update guard">
STATUS: DONE
TOUCHED: tools/definitions/routing/guard.ts
VERIFIED: bun run typecheck
OUTCOME: Updated guard hooks.
</background-result>`;

    expect(parseWorkerReport(done)).toEqual({
      kind: "done",
      sessionID: "ses_bg_done",
      touched: ["tools/definitions/routing/guard.ts"],
      verified: "bun run typecheck",
      outcome: "Updated guard hooks.",
    });

    const esc = `<background-result sessionID="ses_bg_esc" kind="subagent" state="completed">
STATUS: ESCALATE
REASON: SCOPE
BLOCKER: Needs edit outside scope.
TOUCHED: none
RECOMMENDED_NEXT: orchestrator_decision
</background-result>`;

    expect(parseWorkerReport(esc)).toEqual({
      kind: "escalate",
      sessionID: "ses_bg_esc",
      reason: "SCOPE",
      blocker: "Needs edit outside scope.",
      optionsOrAttempts: "",
      touched: [],
      recommendedNext: "orchestrator_decision",
    });

    const otherKind = `<background-result kind="shell" sessionID="ses_bg_shell">
STATUS: DONE
OUTCOME: Ignored tag.
</background-result>`;
    expect(parseWorkerReport(otherKind)).toEqual({
      kind: "done",
      sessionID: undefined,
      touched: [],
      verified: "",
      outcome: "Ignored tag.\n</background-result>",
    });

    const legacyTag = `<subagent sessionID="ses_legacy" state="completed">
STATUS: DONE
OUTCOME: Legacy tag.
</subagent>`;
    expect(parseWorkerReport(legacyTag)).toEqual({
      kind: "done",
      sessionID: undefined,
      touched: [],
      verified: "",
      outcome: "Legacy tag.\n</subagent>",
    });
  });
});

describe("shapeEscalationMessages", () => {
  test("decorates escalation messages once and is idempotent", () => {
    const messages: Array<MutableContextMessage> = [
      {
        role: "user",
        metadata: { source: "subagent" },
        content: [
          {
            type: "text",
            text: `<background-result kind="subagent" sessionID="ses_w1" state="completed" description="Check">
STATUS: ESCALATE
REASON: AMBIGUITY
BLOCKER: Need decision.
</background-result>`,
          },
        ],
      },
      {
        role: "user",
        metadata: { source: "subagent" },
        content: [
          {
            type: "text",
            text: `<background-result kind="subagent" sessionID="ses_w2" state="completed" description="Fix">
STATUS: ESCALATE
REASON: FAILURE_CAP
BLOCKER: Two failed runs.
</background-result>`,
          },
        ],
      },
      {
        role: "user",
        metadata: { source: "subagent" },
        content: [
          {
            type: "text",
            text: `<background-result kind="subagent" sessionID="ses_w3" state="completed" description="Done">
STATUS: DONE
OUTCOME: All good.
</background-result>`,
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "STATUS: ESCALATE" }],
      },
    ];

    expect(shapeEscalationMessages(undefined)).toBe(0);
    expect(shapeEscalationMessages(messages)).toBe(2);

    const firstText = (messages[0]?.content as Array<{ text?: string }> | undefined)?.[0]?.text;
    const secondText = (messages[1]?.content as Array<{ text?: string }> | undefined)?.[0]?.text;
    const doneText = (messages[2]?.content as Array<{ text?: string }> | undefined)?.[0]?.text;

    expect(firstText).toContain(ESCALATION_SENTINEL);
    expect(firstText).toContain('resume sessionID="ses_w1" omitting model');
    expect(secondText).toContain(ESCALATION_SENTINEL);
    expect(secondText).toContain("tools.spectre.routing");
    expect(secondText).toContain('sessionID="ses_w2"');
    expect(doneText).not.toContain(ESCALATION_SENTINEL);

    expect(shapeEscalationMessages(messages)).toBe(0);
  });

  test("decorates <background-result kind=\"subagent\"> escalation without metadata", () => {
    const messages: Array<MutableContextMessage> = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `<background-result kind="subagent" sessionID="ses_bg_1" state="completed" description="Check">
STATUS: ESCALATE
REASON: AMBIGUITY
BLOCKER: Need decision.
</background-result>`,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `<background-result kind="shell" sessionID="ses_sh_1" state="completed">
STATUS: ESCALATE
REASON: FAILURE_CAP
BLOCKER: Shell failed.
</background-result>`,
          },
        ],
      },
    ];

    expect(shapeEscalationMessages(messages)).toBe(1);
    const firstText = (messages[0]?.content as Array<{ text?: string }> | undefined)?.[0]?.text;
    const secondText = (messages[1]?.content as Array<{ text?: string }> | undefined)?.[0]?.text;
    expect(firstText).toContain(ESCALATION_SENTINEL);
    expect(firstText).toContain('resume sessionID="ses_bg_1" omitting model');
    expect(secondText).not.toContain(ESCALATION_SENTINEL);
  });
});

describe("classifyShellMechanical", () => {
  test("detects test, typecheck, lint, and build commands", () => {
    expect(classifyShellMechanical("bun test test/routing/guard.test.ts")).toBe(true);
    expect(classifyShellMechanical("FOO=1 bun run typecheck && bun test")).toBe(true);
    expect(classifyShellMechanical("tsc --noEmit")).toBe(true);
    expect(classifyShellMechanical("cargo test --workspace")).toBe(true);
    expect(classifyShellMechanical("go test ./...")).toBe(true);
    expect(classifyShellMechanical("pytest -q")).toBe(true);
    expect(classifyShellMechanical("git status")).toBe(false);
    expect(classifyShellMechanical("ls -la tools/")).toBe(false);
  });
});

describe("advanceDrift", () => {
  test("triggers search drift at threshold distinct reads and suppresses after nudge or delegation", () => {
    let state = emptyDriftState();
    for (let i = 1; i < DRIFT_THRESHOLDS.searchReads; i += 1) {
      const step = advanceDrift(state, { kind: "read-code", path: `file_${i}.ts` });
      expect(step.verdict.action).toBe("none");
      state = step.state;
    }

    const dup = advanceDrift(state, { kind: "read-code", path: "file_1.ts" });
    expect(dup.verdict.action).toBe("none");
    state = dup.state;

    const hit = advanceDrift(state, { kind: "read-code", path: "file_4.ts" });
    expect(hit.verdict.action).toBe("put");
    if (hit.verdict.action === "put") {
      expect(hit.verdict.drift).toBe("search");
    }
    state = hit.state;

    const afterNudge = advanceDrift(state, { kind: "read-code", path: "file_5.ts" });
    expect(afterNudge.verdict.action).toBe("none");

    const delegated = advanceDrift(afterNudge.state, { kind: "subagent-called" });
    expect(delegated.verdict.action).toBe("clear");

    const afterDelegate = advanceDrift(delegated.state, { kind: "mutate-file", path: "x.ts" });
    expect(afterDelegate.verdict.action).toBe("none");

    const mut2 = advanceDrift(afterDelegate.state, { kind: "mutate-file", path: "y.ts" });
    expect(mut2.verdict.action).toBe("none");

    const mut3 = advanceDrift(mut2.state, { kind: "mutate-file", path: "z.ts" });
    expect(mut3.verdict.action).toBe("put");
    if (mut3.verdict.action === "put") {
      expect(mut3.verdict.drift).toBe("worker");
    }
  });

  test("triggers worker and mechanical drift and resets on prompt-reset", () => {
    let state = emptyDriftState();
    state = advanceDrift(state, { kind: "mutate-file", path: "a.ts" }).state;
    state = advanceDrift(state, { kind: "mutate-file", path: "b.ts" }).state;
    const workerHit = advanceDrift(state, { kind: "mutate-file", path: "c.ts" });
    expect(workerHit.verdict.action).toBe("put");
    if (workerHit.verdict.action === "put") {
      expect(workerHit.verdict.drift).toBe("worker");
    }

    const reset = advanceDrift(workerHit.state, { kind: "prompt-reset" });
    expect(reset.verdict.action).toBe("clear");

    const cleanReset = advanceDrift(reset.state, { kind: "prompt-reset" });
    expect(cleanReset.verdict.action).toBe("none");

    let mechState = emptyDriftState();
    mechState = advanceDrift(mechState, { kind: "shell-mechanical" }).state;
    const mechHit = advanceDrift(mechState, { kind: "shell-mechanical" });
    expect(mechHit.verdict.action).toBe("put");
    if (mechHit.verdict.action === "put") {
      expect(mechHit.verdict.drift).toBe("mechanical");
    }
  });
});
