import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { type Live, startLive } from "../../resume/live";
import {
  artifactFromVerification,
  createSessionJudgeTransport,
  judgePairSwapped,
} from "../judge";
import {
  isolatedServerEnv,
  verifyHostRegistration,
  verifyPluginlessJudgeServer,
} from "../runner";
import { loadScenario } from "../scenario";
import { stagePluginArm } from "../stage";
import { extractTrajectory } from "../trajectory";
import { verifyTrialWorkspace, writeWorkspaceFiles } from "../verify";

type ScriptedStep =
  | { readonly kind: "tool"; readonly name: string; readonly args: Record<string, unknown> }
  | { readonly kind: "text"; readonly text: string };

interface LoopbackMock {
  readonly baseURL: string;
  readonly stop: () => void;
}

const encodeSseStep = (step: ScriptedStep): string => {
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const firstDelta =
    step.kind === "tool"
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
              type: "function",
              function: { name: step.name, arguments: JSON.stringify(step.args) },
            },
          ],
        }
      : { role: "assistant", content: step.text };
  const finishReason = step.kind === "tool" ? "tool_calls" : "stop";
  const events = [
    {
      id,
      object: "chat.completion.chunk",
      created,
      model: "ablation",
      choices: [{ index: 0, delta: firstDelta, finish_reason: null }],
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model: "ablation",
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      usage: { prompt_tokens: 120, completion_tokens: 35, total_tokens: 155 },
    },
  ];
  return `${events.map((evt) => `data: ${JSON.stringify(evt)}\n\n`).join("")}data: [DONE]\n\n`;
};

const startLoopbackMock = (steps: ReadonlyArray<ScriptedStep>): LoopbackMock => {
  const token = crypto.randomUUID();
  const prefix = `/${token}/v1`;
  let cursor = 0;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      if (!url.pathname.startsWith(prefix)) return new Response("not found", { status: 404 });
      const route = url.pathname.slice(prefix.length);
      if (route === "/models") {
        return Response.json({ object: "list", data: [{ id: "ablation", object: "model" }] });
      }
      if (route !== "/chat/completions") return new Response("not found", { status: 404 });

      const body = (await req.json()) as { readonly stream?: boolean };
      const step = steps[cursor] ?? { kind: "text" as const, text: "done" };
      cursor++;

      if (body.stream === false) {
        const text = step.kind === "text" ? step.text : "done";
        return Response.json({
          id: `chatcmpl-${crypto.randomUUID()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "ablation",
          choices: [
            { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
        });
      }

      return new Response(encodeSseStep(step), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });

  if (server.port === undefined) throw new Error("loopback mock bound no port");
  return {
    baseURL: `http://127.0.0.1:${server.port}/${token}`,
    stop: () => server.stop(true),
  };
};

const mockProviderConfig = (baseURL: string): Readonly<Record<string, unknown>> => ({
  provider: {
    mock: {
      name: "Mock",
      npm: "@ai-sdk/openai-compatible",
      options: {
        baseURL: `${baseURL}/v1`,
        apiKey: "mock",
      },
      models: {
        ablation: { name: "Ablation", tool_call: true },
      },
    },
  },
});

const hermeticEnv = (homeDir: string): Readonly<Record<string, string | undefined>> =>
  isolatedServerEnv({
    HOME: homeDir,
    XDG_CONFIG_HOME: join(homeDir, ".config"),
    XDG_DATA_HOME: join(homeDir, ".local/share"),
    XDG_CACHE_HOME: join(homeDir, ".cache"),
    XDG_STATE_HOME: join(homeDir, ".local/state"),
    OPENCODE_DISABLE_MODELS_FETCH: "1",
  });

const scratchRoots: Array<string> = [];
const activeServers: Array<Live> = [];
const activeMocks: Array<LoopbackMock> = [];

afterAll(async () => {
  await Promise.all(activeServers.map((server) => server.stop().catch(() => {})));
  for (const mock of activeMocks) mock.stop();
  for (const dir of scratchRoots) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}, 30_000);

describe("pinned OpenCode v2.4.2 loopback smoke (zero LLM, no Docker)", () => {
  test("verifies present and stripped arms, real v2.4.2 wire decoding, and plugin-less judge session.generate", async () => {
    const scenario = await loadScenario(`${import.meta.dir}/../scenarios/tdd-bugfix.json`);
    const root = join(
      Bun.env.TMPDIR ?? "/tmp",
      `spectre-loopback-${crypto.randomUUID().slice(0, 8)}`,
    );
    scratchRoots.push(root);
    await mkdir(root, { recursive: true });

    const presentStage = await stagePluginArm({
      baseDir: join(root, "bundles"),
      arm: "present",
      targetSkill: "tdd",
    });
    const strippedStage = await stagePluginArm({
      baseDir: join(root, "bundles"),
      arm: "stripped",
      targetSkill: "tdd",
    });

    const specOld =
      '  it("tracks keys independently", () => {\n    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 1000 });\n    expect(limiter.check("alpha", 100).allowed).toBe(true);\n    expect(limiter.check("beta", 100).allowed).toBe(true);\n  });\n});';
    const specNew = `${specOld.slice(0, -3)}\n  it("expires a hit at exact nowMs - windowMs", () => {\n    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 1000 });\n    expect(limiter.check("alpha", 1000).allowed).toBe(true);\n    expect(limiter.check("alpha", 2000)).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });\n  });\n});`;

    const presentRunDir = join(root, "arm-1");
    const presentWorkspace = join(presentRunDir, "app");
    const presentCfg = join(presentRunDir, "cfg");
    const presentHome = join(presentRunDir, "home");
    await mkdir(presentWorkspace, { recursive: true });
    await mkdir(presentCfg, { recursive: true });
    await mkdir(presentHome, { recursive: true });
    await writeWorkspaceFiles(presentWorkspace, scenario.setup);

    const presentMock = startLoopbackMock([
      {
        kind: "tool",
        name: "execute",
        args: { code: 'return await tools.spectre.skills({ id: "tdd" });' },
      },
      { kind: "tool", name: "skill", args: { id: "tdd" } },
      {
        kind: "tool",
        name: "edit",
        args: {
          path: join(presentWorkspace, "spec/limiter.spec.ts"),
          oldString: specOld,
          newString: specNew,
        },
      },
      { kind: "tool", name: "shell", args: { command: "bun run check" } },
      {
        kind: "tool",
        name: "edit",
        args: {
          path: join(presentWorkspace, "src/limiter.ts"),
          oldString: "const active = entries.filter((ts) => ts >= cutoff);",
          newString: "const active = entries.filter((ts) => ts > cutoff);",
        },
      },
      { kind: "tool", name: "shell", args: { command: "bun run check" } },
      { kind: "text", text: "Fixed boundary condition after red-to-green verification." },
    ]);
    activeMocks.push(presentMock);

    const presentServer = await startLive({
      directory: presentWorkspace,
      configDir: presentCfg,
      pluginDir: presentStage.pluginDir,
      model: "mock/ablation",
      extraConfig: mockProviderConfig(presentMock.baseURL),
      env: hermeticEnv(presentHome),
    });
    activeServers.push(presentServer);

    const presentSession = await presentServer.client.session.create({
      title: scenario.sessionTitle,
      agent: "spectre",
      model: { providerID: "mock", id: "ablation" },
      location: { directory: presentWorkspace },
    });

    const presentReg = await verifyHostRegistration({
      server: presentServer,
      expectedIds: presentStage.expectedIds,
      strippedIds: presentStage.strippedIds,
      directory: presentWorkspace,
    });
    expect(presentReg.ok).toBe(true);
    expect(presentReg.hostSkillIds).toContain("tdd");

    await presentServer.client.session.prompt({
      sessionID: presentSession.id,
      text: scenario.turns[0]!.prompt.replaceAll("/workspace", presentWorkspace),
    });
    await presentServer.client.experimental.session.wait({ sessionID: presentSession.id });
    const presentTranscript = await presentServer.client.transcript(presentSession.id);
    await presentServer.stop();
    presentMock.stop();

    const presentExtracted = extractTrajectory({
      scenario,
      parent: presentTranscript,
      children: new Map(),
      workspaceDir: presentWorkspace,
    });
    expect(presentExtracted.activation.targetSkillLoaded).toBe(true);
    expect(
      presentExtracted.trajectory.codemodeCalls.some(
        (call) =>
          call.tool === "spectre.skills" &&
          call.status === "completed" &&
          call.wireFormat === "structured",
      ),
    ).toBe(true);
    expect(presentExtracted.trajectory.causalRedBeforeEdit).toBe(true);
    expect(presentExtracted.trajectory.redRunCompletedBeforeProdEdit).toBe(true);
    expect(presentExtracted.trajectory.testEditedBeforeRedRun).toBe(true);
    expect(presentExtracted.trajectory.greenRunAfterLastProdEdit).toBe(true);
    expect(presentExtracted.trajectory.toolErrors).toBe(0);

    const presentVerified = await verifyTrialWorkspace({
      scenario,
      workspaceDir: presentWorkspace,
    });
    expect(presentVerified.passed).toBe(true);

    const strippedRunDir = join(root, "arm-2");
    const strippedWorkspace = join(strippedRunDir, "app");
    const strippedCfg = join(strippedRunDir, "cfg");
    const strippedHome = join(strippedRunDir, "home");
    await mkdir(strippedWorkspace, { recursive: true });
    await mkdir(strippedCfg, { recursive: true });
    await mkdir(strippedHome, { recursive: true });
    await writeWorkspaceFiles(strippedWorkspace, scenario.setup);

    const strippedMock = startLoopbackMock([
      {
        kind: "tool",
        name: "execute",
        args: { code: 'return await tools.spectre.skills({ id: "tdd" });' },
      },
      {
        kind: "tool",
        name: "edit",
        args: {
          path: join(strippedWorkspace, "src/limiter.ts"),
          oldString: "const active = entries.filter((ts) => ts >= cutoff);",
          newString: "const active = entries.filter((ts) => ts > cutoff);",
        },
      },
      {
        kind: "tool",
        name: "edit",
        args: {
          path: join(strippedWorkspace, "spec/limiter.spec.ts"),
          oldString: specOld,
          newString: specNew,
        },
      },
      { kind: "tool", name: "shell", args: { command: "bun run check" } },
      { kind: "text", text: "Fixed boundary condition and verified check suite." },
    ]);
    activeMocks.push(strippedMock);

    const strippedServer = await startLive({
      directory: strippedWorkspace,
      configDir: strippedCfg,
      pluginDir: strippedStage.pluginDir,
      model: "mock/ablation",
      extraConfig: mockProviderConfig(strippedMock.baseURL),
      env: hermeticEnv(strippedHome),
    });
    activeServers.push(strippedServer);

    const strippedSession = await strippedServer.client.session.create({
      title: scenario.sessionTitle,
      agent: "spectre",
      model: { providerID: "mock", id: "ablation" },
      location: { directory: strippedWorkspace },
    });

    const strippedReg = await verifyHostRegistration({
      server: strippedServer,
      expectedIds: strippedStage.expectedIds,
      strippedIds: strippedStage.strippedIds,
      directory: strippedWorkspace,
    });
    expect(strippedReg.ok).toBe(true);
    expect(strippedReg.hostSkillIds).not.toContain("tdd");
    expect(strippedReg.leakedInHost).toEqual([]);

    await strippedServer.client.session.prompt({
      sessionID: strippedSession.id,
      text: scenario.turns[0]!.prompt.replaceAll("/workspace", strippedWorkspace),
    });
    await strippedServer.client.experimental.session.wait({ sessionID: strippedSession.id });
    const strippedTranscript = await strippedServer.client.transcript(strippedSession.id);
    await strippedServer.stop();
    strippedMock.stop();

    const strippedExtracted = extractTrajectory({
      scenario,
      parent: strippedTranscript,
      children: new Map(),
      workspaceDir: strippedWorkspace,
    });
    expect(strippedExtracted.activation.targetSkillLoaded).toBe(false);
    const strippedExecEvent = strippedExtracted.trajectory.events.find(
      (event) => event.name === "execute",
    );
    expect(strippedExecEvent?.outputText).toContain("not-found");
    expect(strippedExtracted.trajectory.causalRedBeforeEdit).toBe(false);
    expect(strippedExtracted.trajectory.redWitnessRejectionReasons).toContain(
      "prod_edit_before_red_test",
    );

    const strippedVerified = await verifyTrialWorkspace({
      scenario,
      workspaceDir: strippedWorkspace,
    });
    expect(strippedVerified.passed).toBe(true);

    const judgeRunDir = join(root, "judge-host");
    const judgeWorkspace = join(judgeRunDir, "app");
    const judgeCfg = join(judgeRunDir, "cfg");
    const judgeHome = join(judgeRunDir, "home");
    await mkdir(judgeWorkspace, { recursive: true });
    await mkdir(judgeCfg, { recursive: true });
    await mkdir(judgeHome, { recursive: true });

    const judgeMock = startLoopbackMock([
      {
        kind: "text",
        text: JSON.stringify({
          winner: "A",
          scoresA: { boundary_correctness: 5, regression_coverage: 5, minimal_diff: 5 },
          scoresB: { boundary_correctness: 4, regression_coverage: 4, minimal_diff: 4 },
          rationale: "Submission A is cleaner.",
        }),
      },
      {
        kind: "text",
        text: JSON.stringify({
          winner: "B",
          scoresA: { boundary_correctness: 4, regression_coverage: 4, minimal_diff: 4 },
          scoresB: { boundary_correctness: 5, regression_coverage: 5, minimal_diff: 5 },
          rationale: "Submission B is cleaner.",
        }),
      },
    ]);
    activeMocks.push(judgeMock);

    const judgeServer = await startLive({
      directory: judgeWorkspace,
      configDir: judgeCfg,
      pluginDir: undefined,
      model: "mock/ablation",
      extraConfig: mockProviderConfig(judgeMock.baseURL),
      env: hermeticEnv(judgeHome),
    });
    activeServers.push(judgeServer);

    const judgeProof = await verifyPluginlessJudgeServer({
      client: judgeServer.client,
      directory: judgeWorkspace,
    });
    expect(judgeProof.ok).toBe(true);
    expect(judgeProof.hasSpectreAgent).toBe(false);
    expect(judgeProof.leakedSpectreSkills).toEqual([]);

    const judgeResult = await judgePairSwapped({
      scenario,
      left: artifactFromVerification(presentVerified),
      right: artifactFromVerification(strippedVerified),
      transport: createSessionJudgeTransport({
        client: judgeServer.client,
        model: { providerID: "mock", id: "ablation" },
        timeoutMs: 30_000,
      }),
      forbiddenTokens: [root, presentWorkspace, strippedWorkspace],
    });
    expect(judgeResult.outcome).toBe("left");
    expect(judgeResult.leftWeightedScore).toBe(5);
    expect(judgeResult.rightWeightedScore).toBe(4);

    const remainingSessions = await judgeServer.client.session.list({
      directory: judgeWorkspace,
    });
    expect(remainingSessions.data.length).toBe(0);

    await judgeServer.stop();
    judgeMock.stop();
  }, 120_000);
});
