import { describe, expect, test } from "bun:test";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect, Schema } from "effect";
import { audit } from "../../tools/definitions/solidjs/audit";
import { detect } from "../../tools/definitions/solidjs/detect";
import { solidjs, Input, Output } from "../../tools/definitions/solidjs";

const FIXTURES = "test/fixtures/solidjs";

const fixture = (name: string) => `${FIXTURES}/${name}`;

const tool = solidjs(AbsolutePath.make(process.cwd()));

const call = async (input: Parameters<typeof tool.execute>[0]) => {
  const result = await Effect.runPromise(
    tool.execute(input, {
      sessionID: "ses_test" as never,
      agent: "build" as never,
      messageID: "msg_test" as never,
      id: "call_test" as never,
      progress: () => Effect.void,
    }),
  );
  if (result.output === undefined) throw new Error("the tool returned no output");
  return result.output;
};

describe("solidjs detects the line before it writes code", () => {
  test("a Solid 1.9 project is solid-1 and compatible", async () => {
    const report = await detect(fixture("v1"));
    expect(report.mode).toBe("solid-1");
    expect(report.solid.line).toBe("1");
    expect(report.compatible).toBe(true);
  });

  test("a Solid 2 project is solid-2 and compatible", async () => {
    const report = await detect(fixture("v2"));
    expect(report.mode).toBe("solid-2");
    expect(report.solid.line).toBe("2");
    expect(report.solid.prerelease).toBe(true);
    expect(report.compatible).toBe(true);
  });

  test("SolidStart 1 is a framework on Solid 1", async () => {
    const report = await detect(fixture("start-v1"));
    expect(report.mode).toBe("solid-1");
    expect(report.framework).toBe("solidstart-1");
    expect(report.config.appConfig).toBe(true);
    expect(report.compatible).toBe(true);
  });

  test("SolidStart 2 is a framework on Solid 1, not Solid 2", async () => {
    const report = await detect(fixture("start-v2"));
    expect(report.mode).toBe("solid-1");
    expect(report.framework).toBe("solidstart-2");
    expect(report.config.startPlugin).toBe(true);
    expect(report.compatible).toBe(true);
  });

  test("SolidStart 2 plus Solid 2 is refused", async () => {
    const report = await detect(fixture("start-v2-on-solid-2"));
    expect(report.mode).toBe("solid-2");
    expect(report.compatible).toBe(false);
    expect(report.incompatible.join(" ")).toContain("does not run Solid 2");
  });

  test("a v1 config in a v2 project is refused", async () => {
    const report = await detect(fixture("start-v2-wrong-config"));
    expect(report.framework).toBe("solidstart-2");
    expect(report.config.appConfig).toBe(true);
    expect(report.compatible).toBe(false);
    expect(report.incompatible.join(" ")).toContain("app.config.ts");
  });

  test("v1 and v2 imports in one tree are mixed", async () => {
    const report = await detect(fixture("mixed"));
    expect(report.mode).toBe("mixed");
    expect(report.compatible).toBe(false);
    expect(report.incompatible.join(" ")).toContain("mixes Solid 1 and Solid 2");
  });

  test("a React project is unknown, not guessed", async () => {
    const report = await detect(fixture("react"));
    expect(report.mode).toBe("unknown");
    expect(report.compatible).toBe(false);
  });

  test("an empty project is unknown, not guessed", async () => {
    const report = await detect(fixture("unknown"));
    expect(report.mode).toBe("unknown");
    expect(report.solid.line).toBe("unknown");
  });
});

describe("the solidjs tool is the agent surface", () => {
  test("detect is the default action", async () => {
    const result = await call({ target: fixture("v1") });
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || result.action !== "detect") throw new Error("wrong outcome");
    expect(result.report.mode).toBe("solid-1");
  });

  test("detect names the framework and the incompatible pairing", async () => {
    const result = await call({ action: "detect", target: fixture("start-v2-on-solid-2") });
    if (result.status !== "ok" || result.action !== "detect") throw new Error("wrong outcome");
    expect(result.report.framework).toBe("solidstart-2");
    expect(result.report.compatible).toBe(false);
  });

  test("audit returns rule, severity, and fix", async () => {
    const result = await call({ action: "audit", target: fixture("v2-wrong") });
    if (result.status !== "ok" || result.action !== "audit") throw new Error("wrong outcome");
    const finding = result.findings.find((one) => one.rule === "v2-effect-arity");
    expect(finding?.severity).toBe("error");
    expect(finding?.fix).toContain("createEffect");
  });

  test("a rule filter narrows the set, and paging reports the whole set", async () => {
    const result = await call({
      action: "audit",
      target: fixture("v2-wrong"),
      rule: "v1-api-in-v2",
      limit: 1,
    });
    if (result.status !== "ok" || result.action !== "audit") throw new Error("wrong outcome");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.rule).toBe("v1-api-in-v2");
    expect(result.total).toBeGreaterThan(1);
    expect(result.truncated).toBe(true);
  });

  test("a target that is not a directory is refused, not reported clean", async () => {
    const result = await call({ action: "audit", target: "package.json" });
    expect(result.status).toBe("refused");
    if (result.status !== "refused") throw new Error("wrong outcome");
    expect(result.problems).toContain("Not a directory");
  });

  test("the declared schemas carry a real call and refuse an unknown action", async () => {
    const decoded = Schema.decodeUnknownOption(Input)({
      action: "audit",
      target: fixture("v2"),
    });
    expect(decoded._tag).toBe("Some");
    expect(Schema.decodeUnknownOption(Input)({ action: "nope" })._tag).toBe("None");

    const result = await call({ action: "detect", target: fixture("v1") });
    expect(Schema.decodeUnknownOption(Output)(result)._tag).toBe("Some");
  });
});

describe("solidjs audits the API that the detector named", () => {
  test("a clean v1 project has no findings", async () => {
    const result = await audit(fixture("v1"));
    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(0);
  });

  test("a clean v2 project has no findings", async () => {
    const result = await audit(fixture("v2"));
    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(0);
  });

  test("a one-argument createEffect is allowed in Solid 1.9", async () => {
    const result = await audit(fixture("v1"));
    expect(result.findings.some((finding) => finding.rule === "v2-effect-arity")).toBe(false);
  });

  test("v2 violations are named by rule", async () => {
    const result = await audit(fixture("v2-wrong"));
    const rules = new Set(result.findings.map((finding) => finding.rule));

    expect(rules.has("v2-effect-arity")).toBe(true);
    expect(rules.has("v2-store-path-setter")).toBe(true);
    expect(rules.has("v2-draft-return")).toBe(true);
    expect(rules.has("v1-api-in-v2")).toBe(true);
    expect(rules.has("a11y-img-alt")).toBe(true);
    expect(rules.has("xss-inner-html")).toBe(true);
    expect(rules.has("type-any")).toBe(true);
  });

  test("a removed v1 primitive is named, not folded into a generic warning", async () => {
    const result = await audit(fixture("v2-wrong"));
    const removed = result.findings.find(
      (finding) => finding.rule === "v1-api-in-v2" && finding.message.includes("createResource"),
    );
    expect(removed).toBeDefined();
  });

  test("v2-only APIs in a v1 project are named", async () => {
    const result = await audit(fixture("v1-wrong"));
    const rules = result.findings.map((finding) => finding.rule);
    expect(rules).toContain("v2-api-in-v1");
    expect(result.errors).toBeGreaterThan(0);
  });

  test("async effects, destructured props, and SSR hazards are named", async () => {
    const result = await audit(fixture("v2-review"));
    const rules = new Set(result.findings.map((finding) => finding.rule));

    expect(rules.has("effect-async")).toBe(true);
    expect(rules.has("props-destructured")).toBe(true);
    expect(rules.has("ssr-browser-global")).toBe(true);
    expect(rules.has("ssr-nondeterministic")).toBe(true);
  });

  test("an incompatible dependency matrix is a finding, not a silent pass", async () => {
    const result = await audit(fixture("mixed"));
    expect(result.findings.some((finding) => finding.rule === "version-mixing")).toBe(true);
    expect(result.errors).toBeGreaterThan(0);
  });

  test("React idioms are caught even when the project is not Solid", async () => {
    const result = await audit(fixture("react"));
    const rules = new Set(result.findings.map((finding) => finding.rule));

    expect(rules.has("react-import")).toBe(true);
    expect(rules.has("react-hook")).toBe(true);
    expect(rules.has("react-prop")).toBe(true);
    expect(rules.has("react-key")).toBe(true);
    expect(rules.has("react-map")).toBe(true);
  });

  test("the same rule at the same place is reported once", async () => {
    const result = await audit(fixture("v2-wrong"));
    const keys = result.findings.map((finding) => `${finding.rule}:${finding.file}:${finding.line}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
