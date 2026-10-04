import { Effect } from "effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { prose } from "./tools/definitions/prose";

// Prints every semicolon with its full paragraph, so each one is read in context
// rather than as a line and a column.
const tool = prose(AbsolutePath.make(process.cwd()));
const ctx = { sessionID: "s", agent: "b", messageID: "m", id: "c", progress: () => Effect.void };
const out = await Effect.runPromise(
  tool.execute(
    { targets: ["skills/definitions", "AGENTS.md", "TODO.md", "README.md", "skills/FOR_AGENTS.md", "tools/FOR_AGENTS.md"] },
    ctx,
  ),
);

const want = process.argv.slice(2);
const semis = out.output!.findings.filter((f) => f.rule === "semicolon" && want.includes(f.file));
const lines = semis.map((f) => ({ ...f, src: Bun.file(f.file).text() }));
const texts = await Promise.all(semis.map((f) => Bun.file(f.file).text()));

for (const [i, f] of semis.entries()) {
  const src = texts[i]!.split("\n");
  // The paragraph: walk back to a blank line, forward to a blank line.
  let start = f.line - 1;
  while (start > 0 && src[start - 1]!.trim() !== "") start -= 1;
  let end = f.line - 1;
  while (end < src.length - 1 && src[end + 1]!.trim() !== "") end += 1;
  console.log(`\n=== ${f.file}:${f.line} (${f.line - start + 1}..${end + 1}) ===`);
  for (let n = start; n <= end; n += 1) {
    const mark = n === f.line - 1 ? ">>" : "  ";
    console.log(`${mark} ${String(n + 1).padStart(4)} ${src[n]}`);
  }
}
