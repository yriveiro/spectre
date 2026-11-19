import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { pr } from "../../tools/definitions/pr";
import {
  branchOk,
  commitChanges,
  type Facts,
  needsPush,
  push,
  type Run,
  type Spawn,
  sshRemoteHost,
  write,
} from "../../tools/definitions/pr/read";

const facts = (over: Partial<Extract<Facts, { readonly ok: true }>> = {}) => ({
  ok: true as const,
  branch: "compose-pr",
  base: "main",
  ahead: 0,
  ...over,
});

describe("what the remote holds decides whether a push happens", () => {
  test("no upstream means the remote holds nothing, so push", () => {
    expect(needsPush(facts())).toBe(true);
  });

  test("the remote holding every commit means no push", () => {
    expect(needsPush(facts({ upstream: "origin", ahead: 0 }))).toBe(false);
  });

  test("commits the remote lacks mean push", () => {
    expect(needsPush(facts({ upstream: "origin", ahead: 2 }))).toBe(true);
  });

  test("a comparison that failed is NaN, which is neither zero nor a count, so push", () => {
    expect(needsPush(facts({ upstream: "origin", ahead: Number.NaN }))).toBe(true);
    expect(Number.isNaN(facts({ upstream: "origin", ahead: Number.NaN }).ahead)).toBe(true);
  });
});

describe("a branch name reaches an argv slot", () => {
  test("an ordinary name is accepted", () => {
    expect(branchOk("compose-pr")).toBe(true);
    expect(branchOk("feature/one-two")).toBe(true);
  });

  test("a leading dash reads as a flag to git and gh, so it is refused", () => {
    expect(branchOk("--repo")).toBe(false);
    expect(branchOk("-x")).toBe(false);
  });

  test("traversal and a traversal run are refused", () => {
    expect(branchOk("..")).toBe(false);
    expect(branchOk("a..b")).toBe(false);
  });

  test("an empty name is refused", () => {
    expect(branchOk("")).toBe(false);
  });
});

describe("SSH remote fallback and REST PR updates", () => {
  test("sshRemoteHost extracts host and rewrite prefix for SCP and ssh:// remotes only", () => {
    expect(sshRemoteHost("autodoc@autodoc.ghe.com:autodoc/autodoc-github-core.git")).toEqual({
      host: "autodoc.ghe.com",
      prefix: "autodoc@autodoc.ghe.com:",
    });
    expect(sshRemoteHost("git@github.com:yriveiro/spectre.git")).toEqual({
      host: "github.com",
      prefix: "git@github.com:",
    });
    expect(sshRemoteHost("ssh://git@github.com/yriveiro/spectre.git")).toEqual({
      host: "github.com",
      prefix: "ssh://git@github.com/",
    });
    expect(sshRemoteHost("https://github.com/yriveiro/spectre.git")).toBeUndefined();
  });

  test("push retries over gh HTTPS credentials when ED25519-SK SSH signing fails", async () => {
    const calls: Array<{ program: string; args: ReadonlyArray<string> }> = [];
    const fake: Spawn = async (_cwd, program, args): Promise<Run> => {
      calls.push({ program, args });
      if (program === "git" && args[0] === "push") {
        return {
          ran: true,
          out: "",
          err: 'sign_and_send_pubkey: signing failed for ED25519-SK "/Users/x/.ssh/id_ed25519_sk": invalid format\nautodoc@autodoc.ghe.com: Permission denied (publickey).',
          code: 128,
        };
      }
      if (program === "git" && args[0] === "remote") {
        return {
          ran: true,
          out: "autodoc@autodoc.ghe.com:autodoc/autodoc-github-core.git",
          err: "",
          code: 0,
        };
      }
      if (program === "gh" && args[0] === "auth") {
        return { ran: true, out: "Logged in to autodoc.ghe.com", err: "", code: 0 };
      }
      if (program === "git" && args[0] === "-c") {
        return { ran: true, out: "Everything up-to-date", err: "", code: 0 };
      }
      return { ran: false, err: "unexpected call" };
    };

    const res = await push("/repo", facts({ branch: "fix-tier" }), fake);
    expect(res).toEqual({ pushed: true, problems: "" });
    expect(calls.find((c) => c.program === "git" && c.args[0] === "-c")?.args).toEqual([
      "-c",
      "url.https://autodoc.ghe.com/.insteadOf=autodoc@autodoc.ghe.com:",
      "-c",
      "credential.https://autodoc.ghe.com.helper=!gh auth git-credential",
      "push",
      "--set-upstream",
      "origin",
      "HEAD:refs/heads/fix-tier",
    ]);
  });

  test("updating an open PR uses gh api REST PATCH with stdin JSON rather than gh pr edit", async () => {
    const calls: Array<{ program: string; args: ReadonlyArray<string>; stdin?: string }> = [];
    let updated = false;
    const draft = { title: "fix(pr): update via rest", body: "Literal `{owner}/{repo}` stays." };
    const fake: Spawn = async (_cwd, program, args, stdin): Promise<Run> => {
      calls.push({ program, args, stdin });
      if (program === "gh" && args[0] === "pr" && args[1] === "view") {
        return {
          ran: true,
          out: JSON.stringify({
            number: 124,
            url: "https://github.com/yriveiro/spectre/pull/124",
            title: updated ? draft.title : "old title",
            body: updated ? draft.body : "old body",
            isDraft: false,
          }),
          err: "",
          code: 0,
        };
      }
      if (program === "gh" && args[0] === "api") {
        updated = true;
        return { ran: true, out: "{}", err: "", code: 0 };
      }
      return { ran: false, err: "unexpected" };
    };

    const res = await write(
      "/repo",
      draft,
      "main",
      { kind: "open", number: 124, title: "old title", body: "old body" },
      fake,
    );
    expect(res).toEqual({
      ok: true,
      number: 124,
      url: "https://github.com/yriveiro/spectre/pull/124",
      draft: false,
      changed: true,
      problems: "",
    });
    const patchCall = calls.find((c) => c.args[0] === "api");
    expect(patchCall?.args).toEqual([
      "api",
      "repos/{owner}/{repo}/pulls/124",
      "-X",
      "PATCH",
      "--input",
      "-",
    ]);
    expect(JSON.parse(patchCall?.stdin ?? "{}")).toEqual({
      title: draft.title,
      body: draft.body,
      base: "main",
    });
  });
});

const TMP = Bun.env.TMPDIR ?? "/tmp";
const scratchDirs: Array<string> = [];

afterAll(async () => {
  for (const dir of scratchDirs) await Bun.$`rm -rf ${dir}`.quiet();
});

describe("convergent commit staging and session directory resolution", () => {
  test("commitChanges stages only named files and converges on retry", async () => {
    const dir = `${TMP}/spectre-pr-commit-${process.pid}-${Date.now()}`;
    scratchDirs.push(dir);
    await Bun.$`mkdir -p ${dir} && git -C ${dir} init -b main`.quiet();
    await Bun.$`git -C ${dir} config user.email test@example.com && git -C ${dir} config user.name Test && git -C ${dir} config commit.gpgsign false`.quiet();
    await Bun.write(`${dir}/tracked.txt`, "one\n");
    await Bun.$`git -C ${dir} add tracked.txt && git -C ${dir} commit -m "initial"`.quiet();
    await Bun.$`git -C ${dir} switch -c feat-x`.quiet();

    await Bun.write(`${dir}/tracked.txt`, "two\n");
    await Bun.write(`${dir}/spectre.json`, '{"untracked":true}\n');

    const msg = [
      "feat(pr): stage named files only",
      "",
      "# Description",
      "Stage only the explicit commit file list and leave untracked files untouched.",
      "",
      "# Changes",
      "- update tracked.txt",
    ].join("\n");

    const first = await commitChanges(dir, msg, ["tracked.txt"]);
    expect(first).toEqual({ ok: true, committed: true });

    const untracked = (await Bun.$`git -C ${dir} status --porcelain`.text()).trim();
    expect(untracked).toBe("?? spectre.json");

    const second = await commitChanges(dir, msg, ["tracked.txt"]);
    expect(second).toEqual({ ok: true, committed: false });
  });

  test("pr tool resolves the moved session directory rather than boot ctx.location.directory", async () => {
    const moved = `${TMP}/spectre-pr-moved-${process.pid}-${Date.now()}`;
    scratchDirs.push(moved);
    await Bun.write(`${moved}/not-a-git-repo.txt`, "hello\n");

    const tool = pr({
      location: { directory: "/boot-directory-should-not-be-used" },
      session: {
        get: () => Effect.succeed({ location: { directory: moved } }),
      },
    } as never);

    const res = await Effect.runPromise(
      tool.execute(
        {
          type: "fix",
          scope: "pr",
          subject: "read active session directory",
          summary: "Boot location stayed on main after session_move ran.",
          review: "Does the error name the moved session directory?",
          scopeItems: ["tools/definitions/pr/index.ts"],
          validation: [{ check: "bun test test/pr", result: "pass" }],
          risk: "Reads session directory first. Revert restores boot directory.",
        },
        {
          sessionID: "ses_moved",
          agent: "spectre",
          messageID: "msg_1",
          id: "call_1",
          progress: () => Effect.void,
        } as never,
      ),
    );

    const out = res.output;
    expect(out?.status).toBe("failed");
    if (out?.status === "failed") {
      expect(out.problems).toContain(moved);
      expect(out.problems).not.toContain("/boot-directory-should-not-be-used");
    }
  });
});
