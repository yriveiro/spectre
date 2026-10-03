export type Provenance = "judged" | "desc" | "neg";

export type Row = { prompt: string; label: string; provenance: Provenance };

export const tuned: ReadonlyArray<Row> = [
  { prompt: "summarize what you just changed", label: "communication", provenance: "judged" },
  { prompt: "reply with just the answer, no preamble", label: "communication", provenance: "judged" },
  {
    prompt: "should I use a map or a lookup table here",
    label: "principle-evidence,ripwire",
    provenance: "judged",
  },
  {
    prompt: "this function has three optional params and callers pass them in any order",
    label: "principle-make-states-unrepresentable",
    provenance: "judged",
  },
  {
    prompt: "i added an isActive flag next to deletedAt, is that fine",
    label: "principle-make-states-unrepresentable",
    provenance: "judged",
  },
  {
    prompt: "should the type be a union or an interface with optional fields",
    label: "principle-make-states-unrepresentable",
    provenance: "judged",
  },
  {
    prompt: "i cannot tell which of these two layouts is better and both look fine",
    label: "principle-evidence",
    provenance: "judged",
  },
  {
    prompt: "this api is easy to call but the internals are a mess, is that ok",
    label: "principle-laziness-protocol",
    provenance: "judged",
  },
  {
    prompt: "which of these two parsers should I use",
    label: "principle-evidence",
    provenance: "judged",
  },
  {
    prompt: "how do I know this test can actually fail",
    label: "principle-evidence",
    provenance: "judged",
  },
  {
    prompt: "is this benchmark number trustworthy",
    label: "principle-evidence",
    provenance: "judged",
  },
  {
    prompt: "what does the skill transform signature actually return",
    label: "principle-evidence",
    provenance: "judged",
  },
  {
    prompt: "is the typecheck passing, confirm it",
    label: "principle-verification",
    provenance: "judged",
  },
  {
    prompt: "update the README to say version 2.0.20",
    label: "principle-verification",
    provenance: "judged",
  },
  { prompt: "bump effect to the latest rc", label: "principle-hygiene", provenance: "judged" },
  {
    prompt: "that function is unused now, remove it",
    label: "principle-hygiene",
    provenance: "judged",
  },
  {
    prompt: "this test file is 3000 lines, what do I do",
    label: "principle-guard-the-context-window",
    provenance: "judged",
  },
  {
    prompt: "read every file under tools and tell me the structure",
    label: "principle-guard-the-context-window",
    provenance: "judged",
  },
  {
    prompt: "this log is 50000 lines, read it and tell me what broke",
    label: "principle-guard-the-context-window",
    provenance: "judged",
  },
  {
    prompt: "the file list is too big to read one at a time",
    label: "principle-guard-the-context-window",
    provenance: "judged",
  },
  {
    prompt: "summarize these 12 files without blowing up the session",
    label: "principle-guard-the-context-window",
    provenance: "judged",
  },
  {
    prompt: "this module is impossible to follow, what is wrong with it",
    label: "principle-laziness-protocol",
    provenance: "judged",
  },
  {
    prompt: "should I extract this into a service class",
    label: "principle-laziness-protocol",
    provenance: "judged",
  },
  { prompt: "you said nothing calls that, prove it", label: "ripwire", provenance: "judged" },
  {
    prompt: "is that test suite actually covering the routing change",
    label: "ripwire",
    provenance: "judged",
  },
  { prompt: "strip the comments from this diff", label: "code-hygiene", provenance: "judged" },
  {
    prompt: "delete the narration in the function I just wrote",
    label: "code-hygiene",
    provenance: "judged",
  },
  {
    prompt: "this doc says utilize and leverage everywhere, it reads like marketing",
    label: "grammar",
    provenance: "judged",
  },
  {
    prompt: "the user is called the customer in one paragraph and the client in the next",
    label: "grammar",
    provenance: "judged",
  },
  {
    prompt: "i had to read this sentence three times to work out who is validating what",
    label: "grammar",
    provenance: "judged",
  },
  {
    prompt: "this sentence runs on for half a page",
    label: "grammar",
    provenance: "judged",
  },
  {
    prompt: "every heading in this doc is just a noun",
    label: "grammar",
    provenance: "judged",
  },
  {
    prompt: "the refactor is done, tell me what to do next",
    label: "communication",
    provenance: "judged",
  },
  {
    prompt: "i do not understand what you want me to change, ask me one question",
    label: "communication",
    provenance: "judged",
  },
  {
    prompt: "the build is red and i cannot tell which of these two causes it",
    label: "communication",
    provenance: "judged",
  },
  {
    prompt: "give me the three ways we could do this and pick one",
    label: "communication",
    provenance: "judged",
  },
  { prompt: "say that again, i did not follow", label: "none", provenance: "neg" },
  { prompt: "throw it in the arena", label: "none", provenance: "neg" },
  { prompt: "swarm this across the six packages", label: "none", provenance: "neg" },
  {
    prompt: "run a gauntlet of five workers and tell me which one wins",
    label: "none",
    provenance: "neg",
  },
  { prompt: "arena this, give me three takes on the layout", label: "none", provenance: "neg" },
  { prompt: "what did you mean, say it without the jargon", label: "none", provenance: "neg" },
  {
    prompt: "explain that last bit like i am new to this codebase",
    label: "none",
    provenance: "neg",
  },
  {
    prompt: "spawn a subagent to do the mechanical part",
    label: "model-router",
    provenance: "judged",
  },
  {
    prompt: "which model should handle this refactor",
    label: "model-router",
    provenance: "judged",
  },
  {
    prompt: "the readme is stale and the code is hard to follow",
    label: "principle-verification,principle-laziness-protocol,ripwire",
    provenance: "judged",
  },
  {
    prompt: "remove dead code and update the docs",
    label: "principle-hygiene,principle-verification",
    provenance: "judged",
  },
  {
    prompt: "this abstraction has one caller, collapse it",
    label: "principle-laziness-protocol,principle-hygiene",
    provenance: "judged",
  },
  {
    prompt: "run the tests and tell me if i can ship",
    label: "principle-verification,ripwire",
    provenance: "judged",
  },
  { prompt: "whats the weather in lisbon", label: "none", provenance: "neg" },
  {
    prompt: "add a retry with exponential backoff to the fetch call",
    label: "none",
    provenance: "neg",
  },
  { prompt: "rename this variable everywhere it appears", label: "none", provenance: "neg" },
  { prompt: "add a dependency for date parsing", label: "none", provenance: "neg" },
  {
    prompt: "write a python script to rename files in a directory",
    label: "none",
    provenance: "neg",
  },
  { prompt: "what port does postgres use by default", label: "none", provenance: "neg" },
  { prompt: "fix the typo in the commit message", label: "none", provenance: "neg" },
  { prompt: "how do i center a div", label: "none", provenance: "neg" },
  {
    prompt: "where should this null check live",
    label: "principle-boundary-discipline",
    provenance: "judged",
  },
  {
    prompt: "this route handler has three try catch blocks, is that right",
    label: "principle-boundary-discipline",
    provenance: "judged",
  },
  {
    prompt: "should the config loader validate or the function that reads the config",
    label: "principle-boundary-discipline",
    provenance: "judged",
  },
  {
    prompt: "refactor this to be cleaner",
    label: "principle-laziness-protocol",
    provenance: "judged",
  },
  {
    prompt: "this task wants me to thread a flag through five layers, do i have to",
    label: "principle-laziness-protocol",
    provenance: "judged",
  },
  {
    prompt: "is this abstraction worth keeping or should i inline it",
    label: "principle-laziness-protocol",
    provenance: "judged",
  },
  {
    prompt: "simplify this function, it does too much",
    label: "principle-laziness-protocol",
    provenance: "judged",
  },
  {
    prompt: "i renamed the client, should i keep the old name working",
    label: "principle-migrate-callers-then-delete-legacy-apis",
    provenance: "judged",
  },
  {
    prompt: "the new config key replaces the old one, how do i roll that out",
    label: "principle-migrate-callers-then-delete-legacy-apis",
    provenance: "judged",
  },
  {
    prompt: "leave the old path in place until the other team migrates",
    label: "principle-migrate-callers-then-delete-legacy-apis",
    provenance: "judged",
  },
  {
    prompt: "what happens if this command runs twice",
    label: "principle-make-operations-idempotent",
    provenance: "judged",
  },
  {
    prompt: "the migration crashed halfway, how do i make it safe to retry",
    label: "principle-make-operations-idempotent",
    provenance: "judged",
  },
  {
    prompt: "should this background loop be resumable or convergent",
    label: "principle-make-operations-idempotent",
    provenance: "judged",
  },
  {
    prompt: "my cleanup deletes the wrong files when it runs again",
    label: "principle-make-operations-idempotent",
    provenance: "judged",
  },
];

export const heldOut: ReadonlyArray<Row> = [
  { prompt: "can I push this yet", label: "principle-verification", provenance: "judged" },
  { prompt: "did the tests actually run", label: "principle-verification", provenance: "judged" },
  {
    prompt: "bump the pin and make sure nothing else still has the old one",
    label: "principle-hygiene",
    provenance: "judged",
  },
  {
    prompt: "theres an unused helper at the top of this file",
    label: "principle-hygiene",
    provenance: "judged",
  },
  {
    prompt: "this yaml file is 4000 lines, walk me through it",
    label: "principle-guard-the-context-window",
    provenance: "judged",
  },
  {
    prompt: "the tool output dumped 80k lines into the session",
    label: "principle-guard-the-context-window",
    provenance: "judged",
  },
  {
    prompt: "give me a map of the whole repo before i touch anything",
    label: "principle-guard-the-context-window",
    provenance: "judged",
  },
  {
    prompt: "this class has one caller and it just forwards, flatten it",
    label: "principle-laziness-protocol",
    provenance: "judged",
  },
  {
    prompt: "where does this value get set",
    label: "principle-laziness-protocol",
    provenance: "judged",
  },
  { prompt: "prove the retry logic is reachable", label: "ripwire", provenance: "judged" },
  {
    prompt: "i added the new api but callers still use the old one",
    label: "principle-migrate-callers-then-delete-legacy-apis",
    provenance: "judged",
  },
  {
    prompt: "this test just asserts the mock was called, is that enough",
    label: "principle-test-behavior-not-implementation",
    provenance: "judged",
  },
  {
    prompt: "i want to pin the default timeout in a test so it does not change",
    label: "principle-test-behavior-not-implementation",
    provenance: "judged",
  },
  {
    prompt: "the suite is green but i am not sure the new code is covered",
    label: "principle-test-behavior-not-implementation",
    provenance: "judged",
  },
  {
    prompt: "this migration is six commits, what do i check on each one",
    label: "principle-outcome-oriented-execution",
    provenance: "judged",
  },
  {
    prompt: "half the callers are migrated, should i land this branch",
    label: "principle-outcome-oriented-execution",
    provenance: "judged",
  },
  {
    prompt: "the rewrite is three phases, how do i know i am done",
    label: "principle-outcome-oriented-execution",
    provenance: "judged",
  },
  { prompt: "is the parser branch covered by any test", label: "ripwire", provenance: "judged" },
  { prompt: "get rid of the comments you just added", label: "code-hygiene", provenance: "judged" },
  {
    prompt: "use a cheaper model for the file reading part",
    label: "model-router",
    provenance: "judged",
  },
  { prompt: "turn on spectre mode", label: "spectre-mode", provenance: "judged" },
  {
    prompt: "should I write the test first or after the code",
    label: "principle-evidence",
    provenance: "judged",
  },
  {
    prompt: "draw me a page that shows what that endpoint returns",
    label: "canvas",
    provenance: "judged",
  },
  {
    prompt: "make me something I can actually open and click through",
    label: "canvas",
    provenance: "judged",
  },
  {
    prompt: "can you show me what the login flow would look like as an app",
    label: "canvas",
    provenance: "judged",
  },
  { prompt: "review PR 42 visually", label: "pr-canvas", provenance: "judged" },
  {
    prompt: "I just opened a PR, walk me through the diff in a page",
    label: "pr-canvas",
    provenance: "judged",
  },
  {
    prompt: "build me a page from the diff between main and my branch",
    label: "pr-canvas",
    provenance: "judged",
  },
  { prompt: "add a dark mode toggle to the header", label: "none", provenance: "neg" },
  { prompt: "why does this page render twice", label: "none", provenance: "neg" },
  { prompt: "change the port to 4000", label: "none", provenance: "neg" },
];

export const rows: ReadonlyArray<Row> = [...tuned, ...heldOut];

export const tsv = (input: ReadonlyArray<Row>) =>
  input.map((row) => `${row.prompt}\t${row.label}\t${row.provenance}`).join("\n") + "\n";
