import { describe, expect, test } from "bun:test";
import { reporter, type Status } from "../reporter";

const capture = () => {
  const written: Array<string> = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string) => {
    written.push(String(chunk));
    return true;
  };
  return { written, release: () => (process.stdout.write = original) };
};

const TMP = `${Bun.env.TMPDIR ?? "/tmp"}spectre-reporter-test-${process.pid}`;

describe("reporter", () => {
  test("a line reaches both the transcript and stdout", async () => {
    const { written, release } = capture();
    const r = reporter({ logPath: `${TMP}/a.log`, statusPath: `${TMP}/a.json` });
    r.say("hello");
    r.close(false);
    release();
    expect(written.join("")).toContain("hello");
    expect(await Bun.file(`${TMP}/a.log`).text()).toContain("hello");
  });

  test("the status file says what is running and how far it got", async () => {
    const { release } = capture();
    const r = reporter({ logPath: `${TMP}/b.log`, statusPath: `${TMP}/b.json` });
    const bar = r.bar("m1", 4);
    bar.advance();
    bar.advance();
    r.close(false);
    release();
    const status = (await Bun.file(`${TMP}/b.json`).json()) as Status;
    expect(status.running).toBe(false);
    expect(status.models[0]).toMatchObject({
      ref: "m1",
      done: 2,
      total: 4,
      failed: 0,
      finished: false,
    });
  });

  test("a failure reason is announced once, as it happens", async () => {
    const { written, release } = capture();
    const r = reporter({ logPath: `${TMP}/c.log`, statusPath: `${TMP}/c.json` });
    const bar = r.bar("m1", 3);
    bar.fail("timeout");
    bar.advance("timeout");
    bar.advance("timeout");
    bar.advance("other");
    r.close(false);
    release();
    const text = written.join("");
    expect(text.match(/! m1: timeout/g)).toHaveLength(1);
    expect(text).toContain("! m1: other");
  });

  test("a bar with no note never invents one", async () => {
    const { written, release } = capture();
    const r = reporter({ logPath: `${TMP}/d.log`, statusPath: `${TMP}/d.json` });
    const bar = r.bar("m1", 1);
    bar.advance();
    r.close(false);
    release();
    expect(written.join("")).not.toContain("! m1:");
  });

  test("models accumulate in the status so a partial run is readable", async () => {
    const { release } = capture();
    const r = reporter({ logPath: `${TMP}/e.log`, statusPath: `${TMP}/e.json` });
    r.bar("m1", 2).finish();
    r.bar("m2", 2).advance();
    r.close(false);
    release();
    const status = (await Bun.file(`${TMP}/e.json`).json()) as Status;
    expect(status.models.map((m) => m.ref)).toEqual(["m1", "m2"]);
    expect(status.models[0]?.finished).toBe(true);
    expect(status.models[1]?.finished).toBe(false);
  });
});
