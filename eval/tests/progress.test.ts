import { describe, expect, test } from "bun:test";
import { plan, progress, seconds } from "../progress";

const writes: Array<string> = [];
const original = process.stdout.write.bind(process.stdout);
const capture = () => {
  writes.length = 0;
  process.stdout.write = (chunk: string) => {
    writes.push(String(chunk));
    return true;
  };
};
const release = () => {
  process.stdout.write = original;
};

const run = (total: number, rows: number, tty: boolean, every = 5) => {
  capture();
  let clock = 1_000;
  const p = progress({ label: "model", total, tty, every, now: () => clock });
  for (let i = 0; i < rows; i++) {
    clock += 500;
    p.advance();
  }
  p.finish();
  release();
  return writes;
};

describe("seconds", () => {
  test("renders minutes and seconds, and never a negative", () => {
    expect(seconds(0)).toBe("0m00s");
    expect(seconds(64_000)).toBe("1m04s");
    expect(seconds(-5)).toBe("0m00s");
  });
});

describe("progress on a terminal", () => {
  test("rewrites in place with a carriage return, and leaves one newline line at the end", () => {
    const out = run(3, 3, true);
    // In place means the cursor returns to column 0 after the text, then the line
    // is padded so a shorter rewrite cannot leave the tail of the previous one
    // showing. No write before the last is newline terminated.
    expect(out.slice(0, -1).every((chunk) => chunk.includes("\r") && !chunk.endsWith("\n"))).toBe(
      true,
    );
    const last = out.at(-1)!;
    expect(last.endsWith("\n")).toBe(true);
    expect(last.includes("3/3")).toBe(true);
  });

  test("the last line carries the final count", () => {
    const out = run(4, 4, true);
    expect(out.at(-1)).toContain("4/4");
  });
});

describe("progress off a terminal", () => {
  test("writes newline terminated lines, so a log shows movement", () => {
    const out = run(10, 10, false, 5);
    for (const line of out) expect(line.endsWith("\n")).toBe(true);
  });

  test("does not write one line per row, which is what made a pipe unreadable", () => {
    expect(run(50, 50, false, 5).length).toBeLessThan(50);
  });

  test("the final count is on the last line", () => {
    const out = run(7, 7, false, 5);
    expect(out.join("")).toContain("7/7");
  });

  test("an empty run still finishes a line rather than printing nothing", () => {
    const out = run(0, 0, false);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("failures", () => {
  test("a failure is counted and named in the summary", () => {
    capture();
    const p = progress({ label: "model", total: 2, tty: false, now: () => 0 });
    p.advance();
    p.fail("timeout");
    p.advance();
    const line = p.finish();
    release();
    expect(line).toContain("1 failed");
  });
});

describe("plan", () => {
  test("states the request count before the first request", () => {
    expect(plan({ models: 9, rows: 54, concurrency: 6 })).toBe(
      "  486 requests: 9 models x 54 rows, concurrency 6",
    );
  });

  test("one model is singular", () => {
    expect(plan({ models: 1, rows: 10, concurrency: 4 })).toContain("1 model x 10 rows");
  });
});
