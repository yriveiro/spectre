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

  test("playbook-feature and playbook-bug-fix pass profile.agent and profile.model.ref to subagent", async () => {
    for (const path of [
      "skills/definitions/playbook-feature/SKILL.md",
      "skills/definitions/playbook-bug-fix/SKILL.md",
    ]) {
      const text = await readRepoFile(path);
      expect(text).toContain("subagent");
      expect(text).toContain("tools.spectre.routing");
      expect(text).toContain("profile.agent");
      expect(text).toContain("profile.model.ref");
    }
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
