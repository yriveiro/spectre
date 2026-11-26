import { describe, expect, test } from "bun:test";
import { renderCatalog } from "../../skills/catalog";
import { definitions } from "../../skills/definitions";

const readRepoFile = (relativePath: string) =>
  Bun.file(new URL(`../../${relativePath}`, import.meta.url)).text();

describe("playbook contracts", () => {
  test("playbook-feature and playbook-bug-fix use tools.spectre.pr instead of gh pr create", async () => {
    for (const path of [
      "skills/definitions/playbook-feature/SKILL.md",
      "skills/definitions/playbook-bug-fix/SKILL.md",
    ]) {
      const text = await readRepoFile(path);
      expect(text).toContain("tools.spectre.pr");
      expect(text).not.toContain("gh pr create");
    }
  });

  test("playbooks and tdd do not reference non-existent ripwire.from_trace", async () => {
    for (const path of [
      "skills/definitions/playbook-feature/SKILL.md",
      "skills/definitions/playbook-bug-fix/SKILL.md",
      "skills/definitions/tdd/SKILL.md",
    ]) {
      const text = await readRepoFile(path);
      expect(text).not.toContain("ripwire.from_trace");
    }

    const bugFix = await readRepoFile("skills/definitions/playbook-bug-fix/SKILL.md");
    const tdd = await readRepoFile("skills/definitions/tdd/SKILL.md");
    expect(bugFix).toContain("ripwire . --from-trace");
    expect(tdd).toContain("ripwire . --from-trace");
  });

  test("playbook-feature, playbook-bug-fix, and playbook-babysit pass profile.agent and profile.model.ref to subagent", async () => {
    for (const path of [
      "skills/definitions/playbook-feature/SKILL.md",
      "skills/definitions/playbook-bug-fix/SKILL.md",
      "skills/definitions/playbook-babysit/SKILL.md",
    ]) {
      const text = await readRepoFile(path);
      expect(text).toContain("subagent");
      expect(text).toContain("tools.spectre.routing");
      expect(text).toContain("profile.agent");
      expect(text).toContain("profile.model.ref");
    }
  });

  test("playbook-babysit offloads failed CI log triage to read-only operator and fails closed", async () => {
    const raw = await readRepoFile("skills/definitions/playbook-babysit/SKILL.md");
    const flat = raw.replace(/\s+/g, " ");

    expect(flat).toContain("model-router");
    expect(flat).toContain('tools.spectre.routing({ profile: "mechanical" })');
    expect(flat).toContain("tools.spectre.routing({})");
    expect(flat).toContain("operator");
    expect(flat).toContain("profile.agent");
    expect(flat).toContain("profile.model.ref");

    expect(flat).toContain("**Scope:**");
    expect(flat).toContain("**Invariants:**");
    expect(flat).toContain("**Verification:**");
    expect(flat).toContain("**Stop boundary:**");

    expect(flat).toContain("gh pr checks");
    expect(flat).toContain("gh run view");
    expect(flat).toContain("--job");
    expect(flat).toContain("--attempt");
    expect(flat).toContain("--log-failed");
    expect(flat).toContain("headRefOid");
    expect(flat).toContain("untrusted data");
    expect(flat).toContain("15 lines");
    expect(flat).toContain("200 characters");
    expect(flat).toContain("redact");

    expect(flat).toContain("sessionID");
    expect(flat).toMatch(/omit(?:ting)? `model`/i);
    expect(flat).toContain("<background-result>");
    expect(flat).toMatch(/yield/i);
    expect(flat).toMatch(/never (?:read|fetch) raw (?:CI )?logs/i);

    expect(flat).toContain("rows[].ci");
    expect(flat).toContain("github-rejected");
    expect(flat).not.toContain("rather than a CI failure");
    expect(flat).toMatch(/github-rejected[^.]*check failed/i);
    expect(flat).toMatch(/github-rejected[^.]*triage the failed check/i);
    expect(flat).toMatch(/both the failed check evidence and the merge rejection/i);
    expect(flat).toMatch(/never retrigger merely to clear/i);
    expect(flat).toContain("unknown");
    expect(flat).toMatch(/stop without retrying/i);

    expect(flat).not.toContain("offset: -50");
    expect(flat).not.toContain("read the child logs");
  });

  test("/pr prompt enables review by default for >=3 code files or >=100 LOC", async () => {
    const prompt = await readRepoFile("commands/definitions/pr/prompt.md");
    expect(prompt).toContain(">=3");
    expect(prompt).toContain(">=100");
    expect(prompt).toContain("interrogate");
    expect(prompt).toContain("code-hygiene");
    expect(prompt).toContain("--no-review");
    expect(prompt).toContain("--review");
  });

  test("renderCatalog surfaces tdd, playbook-bug-fix, and interrogate SDLC gates", () => {
    const rendered = renderCatalog(definitions);
    expect(rendered).toContain("SDLC gates:");
    expect(rendered).toContain("`playbook-bug-fix`");
    expect(rendered).toContain("`tdd`");
    expect(rendered).toContain("`interrogate`");
    expect(rendered).toContain("`opencode-platform`");
  });
});
