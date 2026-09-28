import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { load } from "../../skills/definitions";
import { writeMirror } from "./mirror";
import { rows, tsv } from "./fixture";

const RIPWIRE = Bun.which("ripwire");
const TMP = Bun.env.TMPDIR ?? "/tmp";
const CHANCE = 0.5;

const roots: Array<string> = [];
let seq = 0;

const scratch = () => {
  const root = `${TMP}/spectre-skills-${process.pid}-${seq++}`;
  roots.push(root);
  return { mirror: `${root}/skills`, file: `${root}/eval.tsv` };
};

afterAll(async () => {
  for (const root of roots) await Bun.$`rm -rf ${root}`.quiet();
});

let result: { ids: Array<string>; output: string } | undefined;

const once = async () => {
  if (result) return result;
  const { mirror, file } = scratch();
  const ids = await writeMirror(mirror);
  await Bun.write(file, tsv(rows));
  const proc = Bun.spawnSync([RIPWIRE!, mirror, `--eval-skills=${file}`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return (result = { ids, output: `${proc.stdout.toString()}${proc.stderr.toString()}` });
};

const auc = (output: string, arm: string) => {
  const body = output.replace(/<!--[\s\S]*?-->/, "");
  const row = body.match(new RegExp(`^ *${arm} +\\S+ +\\S+ +\\S+ +([0-9.]+)`, "m"));
  return row?.[1] === undefined ? undefined : Number(row[1]);
};

describe("skill descriptions", () => {
  test("every definition states one", async () => {
    const skills = await Effect.runPromise(load());
    const blank = skills
      .filter((skill) => (skill.description ?? "").trim() === "")
      .map((skill) => skill.id);
    expect(blank).toEqual([]);
  });
});

describe.skipIf(!RIPWIRE)("skill routing", () => {
  beforeAll(once);

  test("the mirror carries every definition", async () => {
    const { ids } = await once();
    const skills = await Effect.runPromise(load());
    expect(ids).toEqual(skills.map((skill) => skill.id).toSorted());
  });

  test("a frontmatter reader sees every description", async () => {
    const { output } = await once();
    expect(output).not.toContain("empty description");
  });

  test("routing on descriptions beats chance", async () => {
    const { output } = await once();
    expect(auc(output, "bm25-desc")).toBeGreaterThan(CHANCE);
  });

  test("routing on full text beats chance", async () => {
    const { output } = await once();
    expect(auc(output, "bm25-full")).toBeGreaterThan(CHANCE);
  });
});
