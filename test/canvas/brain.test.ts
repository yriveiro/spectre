import { describe, expect, test } from "bun:test";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { snapshot } from "../../tools/definitions/brain";
import { ledger } from "../../tools/definitions/brain/ledger";
import { composeBrain } from "../../tools/definitions/canvas/brain";
import { bundle } from "../../tools/definitions/canvas/d3";
import { useTempDirs } from "../fixture";

const temp = useTempDirs("canvas-brain");

describe("composeBrain", () => {
  test("renders the canonical Brain UI, attaches vendor/d3.min.js, and escapes untrusted script payloads", async () => {
    const dir = temp();
    await Bun.write(`${dir}/src/a.ts`, "export const a = 1;\n");
    const book = ledger(AbsolutePath.make(dir));
    const hostile = await Effect.runPromise(
      book.mint({
        kind: "gotcha",
        claim: 'Hostile </script><img src="https://evil.example/x.png" onerror="alert(1)"> claim',
        subject: ["src/a.ts"],
        body: "## Details\n\n- Safe markdown line\n- Raw <script>alert(2)</script> stays escaped",
      }),
    );

    const snap = await Effect.runPromise(snapshot(dir));
    const built = await composeBrain(snap, { kind: "brain", focus: hostile.id.slice(0, 8) }, bundle);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.title).toContain("Brain");
    expect(Object.keys(built.files).toSorted()).toEqual(["index.html", "vendor/d3.min.js"]);
    const html = built.files["index.html"] ?? "";
    expect(html).toContain('src="vendor/d3.min.js"');
    expect(html).toContain("Connectome");
    expect(html).toContain("Prompt Cortex");
    expect(html).toContain("Lineage");
    expect(html).toContain("Codebase Map");
    expect(html).not.toContain("</script><img");
    expect(html).not.toContain("<script>alert(2)</script>");
  });

  test("neutralizes markdown javascript links, data:text/html links, and remote images inside neuron bodies", async () => {
    const dir = temp();
    await Bun.write(`${dir}/src/a.ts`, "export const a = 1;\n");
    const book = ledger(AbsolutePath.make(dir));
    await Effect.runPromise(
      book.mint({
        kind: "lesson",
        claim: "Markdown link boundary check.",
        subject: ["src/a.ts"],
        body: [
          "[xss](javascript:alert(1))",
          "",
          "[payload](data:text/html,<script>alert(1)</script>)",
          "",
          "![beacon](https://evil.example/pixel.png)",
        ].join("\n"),
      }),
    );

    const snap = await Effect.runPromise(snapshot(dir));
    const built = await composeBrain(snap, { kind: "brain" }, bundle);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const html = built.files["index.html"] ?? "";
    expect(html).not.toContain('href=\\"javascript:');
    expect(html).not.toContain('href=\\"data:text/html');
    expect(html).not.toContain('src=\\"https://evil.example/pixel.png\\"');
    expect(built.warnings.some((w) => w.includes("rendered as plain text"))).toBe(true);
  });

  test("refuses an unknown focus prefix instead of silently dropping it", async () => {
    const dir = temp();
    const snap = await Effect.runPromise(snapshot(dir));
    const built = await composeBrain(snap, { kind: "brain", focus: "0199deadbeef" }, bundle);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.problem).toContain("0199deadbeef");
  });
});
