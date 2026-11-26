import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { REPO } from "../../resume/docker";
import {
  assertExactSkillSet,
  auditStagedPlugin,
  sourceSkillIds,
  stagePluginArm,
} from "../stage";

const scratchRoots: Array<string> = [];

const makeScratch = async (tag: string): Promise<string> => {
  const dir = join(
    Bun.env.TMPDIR ?? "/tmp",
    `spectre-stage-${tag}-${crypto.randomUUID().slice(0, 8)}`,
  );
  await mkdir(dir, { recursive: true });
  scratchRoots.push(dir);
  return dir;
};

afterAll(async () => {
  while (scratchRoots.length > 0) {
    const dir = scratchRoots.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

describe("exact deduplicated skill set comparison", () => {
  test("passes on identical unordered sets and rejects extra, missing, or duplicate ids", () => {
    const ok = assertExactSkillSet(["b", "a"], ["a", "b"], "exact");
    expect(ok.ok).toBe(true);
    expect(ok.findings).toEqual([]);

    const extra = assertExactSkillSet(["a", "b", "tdd"], ["a", "b"], "extra-check");
    expect(extra.ok).toBe(false);
    expect(extra.extra).toEqual(["tdd"]);
    expect(extra.findings.some((line) => line.includes("tdd"))).toBe(true);

    const missing = assertExactSkillSet(["a"], ["a", "b"], "missing-check");
    expect(missing.ok).toBe(false);
    expect(missing.missing).toEqual(["b"]);

    const dup = assertExactSkillSet(["a", "a", "b"], ["a", "b"], "dup-check");
    expect(dup.ok).toBe(false);
    expect(dup.duplicates).toEqual(["a"]);
  });
});

describe("staged plugin stripping and leakage closure", () => {
  test("stages present and stripped tdd arms cleanly and catches an injected surviving cue", async () => {
    const root = await makeScratch("arms");
    const allIds = sourceSkillIds();
    expect(allIds).toContain("tdd");

    const present = await stagePluginArm({ baseDir: root, arm: "present", targetSkill: "tdd" });
    expect(present.expectedIds.length).toBe(allIds.length);
    expect(basename(present.bundleDir)).not.toMatch(/present|stripped|replicate|ablation|tdd/i);

    const presentAudit = await auditStagedPlugin(present);
    expect(presentAudit.ok).toBe(true);
    expect(presentAudit.exactSet.ok).toBe(true);
    expect(presentAudit.toolListExactSet.ok).toBe(true);
    expect(presentAudit.inspectStatus).toBe("inspected");
    expect(presentAudit.leaks).toEqual([]);

    const stripped = await stagePluginArm({ baseDir: root, arm: "stripped", targetSkill: "tdd" });
    expect(stripped.expectedIds.length).toBe(allIds.length - 1);
    expect(stripped.expectedIds).not.toContain("tdd");
    expect(basename(stripped.bundleDir)).not.toMatch(/present|stripped|replicate|ablation|tdd/i);
    expect(await Bun.file(join(stripped.pluginDir, "skills/definitions/tdd/SKILL.md")).exists()).toBe(
      false,
    );
    expect(await Bun.file(join(stripped.pluginDir, "skills/definitions/tdd/index.ts")).exists()).toBe(
      true,
    );

    const strippedAudit = await auditStagedPlugin(stripped);
    expect(strippedAudit.ok).toBe(true);
    expect(strippedAudit.exactSet.ok).toBe(true);
    expect(strippedAudit.toolListExactSet.ok).toBe(true);
    expect(strippedAudit.inspectStatus).toBe("not-found");
    expect(strippedAudit.searchContainsTarget).toBe(false);
    expect(strippedAudit.schemaClean).toBe(true);
    expect(strippedAudit.leaks).toEqual([]);

    const playbookPath = join(stripped.pluginDir, "skills/definitions/playbook/SKILL.md");
    const current = await Bun.file(playbookPath).text();
    await Bun.write(playbookPath, `${current}\nRemember to load \`tdd\` first.\n`);

    const leakedAudit = await auditStagedPlugin(stripped);
    expect(leakedAudit.ok).toBe(false);
    expect(leakedAudit.leaks.length).toBeGreaterThan(0);
    expect(leakedAudit.leaks.some((item) => item.location.includes("playbook"))).toBe(true);

    expect(await Bun.file(join(REPO, "skills/definitions/tdd/SKILL.md")).exists()).toBe(true);
  }, 60_000);

  test("forbids hub stripping and rejects unknown or unsupported targets", async () => {
    const root = await makeScratch("guards");

    await expect(
      stagePluginArm({ baseDir: root, arm: "stripped", targetSkill: "spectre-mode" }),
    ).rejects.toThrow(/hub/i);

    await expect(
      stagePluginArm({ baseDir: root, arm: "stripped", targetSkill: "playbook" }),
    ).rejects.toThrow(/hub/i);

    await expect(
      stagePluginArm({ baseDir: root, arm: "stripped", targetSkill: "does-not-exist" }),
    ).rejects.toThrow(/unknown/i);

    await expect(
      stagePluginArm({ baseDir: root, arm: "stripped", targetSkill: "code-hygiene" }),
    ).rejects.toThrow(/v1/i);
  });
});
