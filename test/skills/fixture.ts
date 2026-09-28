export type Provenance = "judged" | "desc" | "neg";

export type Row = { prompt: string; label: string; provenance: Provenance };

export const tuned: ReadonlyArray<Row> = [
  { prompt: "summarize what you just changed", label: "i-have-adhd", provenance: "judged" },
  { prompt: "reply with just the answer, no preamble", label: "i-have-adhd", provenance: "judged" },
  { prompt: "should I use a map or a lookup table here", label: "principle-evidence,ripwire", provenance: "judged" },
  { prompt: "which of these two parsers should I use", label: "principle-evidence", provenance: "judged" },
  { prompt: "how do I know this test can actually fail", label: "principle-evidence", provenance: "judged" },
  { prompt: "is this benchmark number trustworthy", label: "principle-evidence", provenance: "judged" },
  { prompt: "what does the skill transform signature actually return", label: "principle-evidence", provenance: "judged" },
  { prompt: "is the typecheck passing, confirm it", label: "principle-verification", provenance: "judged" },
  { prompt: "update the README to say version 2.0.20", label: "principle-verification", provenance: "judged" },
  { prompt: "bump effect to the latest rc", label: "principle-hygiene", provenance: "judged" },
  { prompt: "that function is unused now, remove it", label: "principle-hygiene", provenance: "judged" },
  { prompt: "this test file is 3000 lines, what do I do", label: "principle-guard-the-context-window", provenance: "judged" },
  { prompt: "read every file under tools and tell me the structure", label: "principle-guard-the-context-window", provenance: "judged" },
  { prompt: "this log is 50000 lines, read it and tell me what broke", label: "principle-guard-the-context-window", provenance: "judged" },
  { prompt: "the file list is too big to read one at a time", label: "principle-guard-the-context-window", provenance: "judged" },
  { prompt: "summarize these 12 files without blowing up the session", label: "principle-guard-the-context-window", provenance: "judged" },
  { prompt: "this module is impossible to follow, what is wrong with it", label: "principle-minimize-reader-load", provenance: "judged" },
  { prompt: "should I extract this into a service class", label: "principle-minimize-reader-load", provenance: "judged" },
  { prompt: "you said nothing calls that, prove it", label: "ripwire", provenance: "judged" },
  { prompt: "is that test suite actually covering the routing change", label: "ripwire", provenance: "judged" },
  { prompt: "strip the comments from this diff", label: "no-comments", provenance: "judged" },
  { prompt: "delete the narration in the function I just wrote", label: "no-comments", provenance: "judged" },
  { prompt: "spawn a subagent to do the mechanical part", label: "model-router", provenance: "judged" },
  { prompt: "which model should handle this refactor", label: "model-router", provenance: "judged" },
  { prompt: "the readme is stale and the code is hard to follow", label: "principle-verification,principle-minimize-reader-load,ripwire", provenance: "judged" },
  { prompt: "remove dead code and update the docs", label: "principle-hygiene,principle-verification", provenance: "judged" },
  { prompt: "this abstraction has one caller, collapse it", label: "principle-minimize-reader-load,principle-hygiene", provenance: "judged" },
  { prompt: "run the tests and tell me if i can ship", label: "principle-verification,ripwire", provenance: "judged" },
  { prompt: "whats the weather in lisbon", label: "none", provenance: "neg" },
  { prompt: "add a retry with exponential backoff to the fetch call", label: "none", provenance: "neg" },
  { prompt: "rename this variable everywhere it appears", label: "none", provenance: "neg" },
  { prompt: "add a dependency for date parsing", label: "none", provenance: "neg" },
  { prompt: "write a python script to rename files in a directory", label: "none", provenance: "neg" },
  { prompt: "what port does postgres use by default", label: "none", provenance: "neg" },
  { prompt: "fix the typo in the commit message", label: "none", provenance: "neg" },
  { prompt: "how do i center a div", label: "none", provenance: "neg" },
];

export const heldOut: ReadonlyArray<Row> = [
  { prompt: "can I push this yet", label: "principle-verification", provenance: "judged" },
  { prompt: "did the tests actually run", label: "principle-verification", provenance: "judged" },
  { prompt: "bump the pin and make sure nothing else still has the old one", label: "principle-hygiene", provenance: "judged" },
  { prompt: "theres an unused helper at the top of this file", label: "principle-hygiene", provenance: "judged" },
  { prompt: "this yaml file is 4000 lines, walk me through it", label: "principle-guard-the-context-window", provenance: "judged" },
  { prompt: "the tool output dumped 80k lines into the session", label: "principle-guard-the-context-window", provenance: "judged" },
  { prompt: "give me a map of the whole repo before i touch anything", label: "principle-guard-the-context-window", provenance: "judged" },
  { prompt: "this class has one caller and it just forwards, flatten it", label: "principle-minimize-reader-load", provenance: "judged" },
  { prompt: "where does this value get set", label: "principle-minimize-reader-load", provenance: "judged" },
  { prompt: "prove the retry logic is reachable", label: "ripwire", provenance: "judged" },
  { prompt: "is the parser branch covered by any test", label: "ripwire", provenance: "judged" },
  { prompt: "get rid of the comments you just added", label: "no-comments", provenance: "judged" },
  { prompt: "use a cheaper model for the file reading part", label: "model-router", provenance: "judged" },
  { prompt: "turn on spectre mode", label: "spectre-mode", provenance: "judged" },
  { prompt: "should I write the test first or after the code", label: "principle-evidence", provenance: "judged" },
  { prompt: "add a dark mode toggle to the header", label: "none", provenance: "neg" },
  { prompt: "why does this page render twice", label: "none", provenance: "neg" },
  { prompt: "change the port to 4000", label: "none", provenance: "neg" },
];

export const rows: ReadonlyArray<Row> = [...tuned, ...heldOut];

export const tsv = (input: ReadonlyArray<Row>) =>
  input.map((row) => `${row.prompt}\t${row.label}\t${row.provenance}`).join("\n") + "\n";
