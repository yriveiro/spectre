export type Provenance = "judged" | "desc" | "neg";

export type Row = { prompt: string; label: string; provenance: Provenance };

export const tuned: ReadonlyArray<Row> = [
  { prompt: "summarize what you just changed", label: "communication", provenance: "judged" },
  {
    prompt: "reply with just the answer, no preamble",
    label: "communication",
    provenance: "judged",
  },
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
  {
    prompt: "i am about to add a new mode to this parser, there is dead code around it, do i clear it first",
    label: "principle-subtract-before-you-add",
    provenance: "judged",
  },
  {
    prompt: "i am extending this module, there is an unused flag and a wrapper that only forwards, do i remove them first",
    label: "principle-subtract-before-you-add",
    provenance: "judged",
  },
  {
    prompt: "this class has options nobody passes and i am about to add one more, do i clear the old ones first",
    label: "principle-subtract-before-you-add",
    provenance: "judged",
  },
  {
    prompt: "should i ask you before i rewrite this file, it is easy to revert",
    label: "principle-never-block-on-the-human",
    provenance: "judged",
  },
  {
    prompt: "this change is reversible, do i just make it and show you the diff",
    label: "principle-never-block-on-the-human",
    provenance: "judged",
  },
  {
    prompt: "this is reversible, do i need your approval or can i just do it",
    label: "principle-never-block-on-the-human",
    provenance: "judged",
  },
  {
    prompt: "i rewrote this skill description, which version should i keep",
    label: "playbook-eval",
    provenance: "judged",
  },
  {
    prompt: "i cannot tell from reading it which of these two descriptions routes better",
    label: "playbook-eval",
    provenance: "judged",
  },
  {
    prompt: "which of these two skill descriptions sends the prompt to the right skill",
    label: "playbook-eval",
    provenance: "judged",
  },
  {
    prompt: "this suite is green and nobody can say what each test catches",
    label: "principle-test-for-truth",
    provenance: "judged",
  },
  {
    prompt: "which edge cases here are worth a test at all",
    label: "principle-test-for-truth",
    provenance: "judged",
  },
  {
    prompt: "the suite takes twenty minutes to run, is that cost worth paying",
    label: "principle-test-for-truth",
    provenance: "judged",
  },
  {
    prompt: "plot the signups over time so i can see the trend",
    label: "diagram",
    provenance: "judged",
  },
  {
    prompt: "make me a chart that shows how the regions compare",
    label: "diagram",
    provenance: "judged",
  },
  {
    prompt: "show me the distribution of the response sizes",
    label: "diagram",
    provenance: "judged",
  },
  {
    prompt: "this task is big, the order of the steps matters, which procedure do we run",
    label: "playbook",
    provenance: "judged",
  },
  {
    prompt: "pick the procedure for this job and tell me the order",
    label: "playbook",
    provenance: "judged",
  },
  {
    prompt: "this whole task has more than one honest answer, which procedure fits it",
    label: "playbook",
    provenance: "judged",
  },
  {
    prompt: "this code is hard to read, reshape it and hold the behaviour",
    label: "playbook-refactoring",
    provenance: "judged",
  },
  {
    prompt: "restructure this module, the behaviour has to come out identical",
    label: "playbook-refactoring",
    provenance: "judged",
  },
  {
    prompt: "the shape here is nearly the shape the domain wants, what is left to move",
    label: "playbook-refactoring",
    provenance: "judged",
  },
  {
    prompt: "this endpoint takes 400ms and we want it under 100, drive it down in steps",
    label: "playbook-hillclimb",
    provenance: "judged",
  },
  {
    prompt: "the cold start regressed after the last release, measure the number and drive it back",
    label: "playbook-hillclimb",
    provenance: "judged",
  },
  {
    prompt: "one import dominates the bundle, make the bundle smaller against a target",
    label: "playbook-hillclimb",
    provenance: "judged",
  },
  {
    prompt: "what do we already know about this project, is there a decision about the retry policy",
    label: "playbook-brain",
    provenance: "judged",
  },
  {
    prompt: "record this gotcha, the billing webhook timed out last friday",
    label: "playbook-brain",
    provenance: "judged",
  },
  {
    prompt: "what bit us last month with the auth module, is there a lesson about it",
    label: "playbook-brain",
    provenance: "judged",
  },
  {
    prompt: "should i add a guard for this case or find the real bug",
    label: "principle-fix-root-causes",
    provenance: "judged",
  },
  {
    prompt: "this test only passes on the second run, what is really wrong",
    label: "principle-fix-root-causes",
    provenance: "judged",
  },
  {
    prompt: "i could make this error go away with a default value, is that the fix",
    label: "principle-fix-root-causes",
    provenance: "judged",
  },
  {
    prompt: "i have tried three fixes for this and they all fail the same check",
    label: "principle-attack-the-premise",
    provenance: "judged",
  },
  {
    prompt: "should i write another patch or is the whole idea wrong",
    label: "principle-attack-the-premise",
    provenance: "judged",
  },
  {
    prompt: "two of our fixes for this broke for the same reason, what are we believing",
    label: "principle-attack-the-premise",
    provenance: "judged",
  },
  {
    prompt: "this is five steps, how do i cut it into pieces i can check one at a time",
    label: "principle-sequence-verifiable-units",
    provenance: "judged",
  },
  {
    prompt: "i have three half finished changes and the test fails, which one broke it",
    label: "principle-sequence-verifiable-units",
    provenance: "judged",
  },
  {
    prompt: "each piece has to end in a check, how do i write the steps down",
    label: "principle-sequence-verifiable-units",
    provenance: "judged",
  },
  {
    prompt: "a string is sometimes an id and sometimes a name here, how do i stop that",
    label: "principle-type-system-discipline",
    provenance: "judged",
  },
  {
    prompt: "this config object only holds together by convention, the types do not say so",
    label: "principle-type-system-discipline",
    provenance: "judged",
  },
  {
    prompt: "adding a new variant compiles and the match just ignores it",
    label: "principle-type-system-discipline",
    provenance: "judged",
  },
  {
    prompt: "every new case is another branch on this if chain, how do i stop that",
    label: "principle-model-the-domain",
    provenance: "judged",
  },
  {
    prompt: "the same flag is checked in three places and they drift apart",
    label: "principle-model-the-domain",
    provenance: "judged",
  },
  {
    prompt: "this state should be impossible but it keeps showing up at runtime",
    label: "principle-model-the-domain",
    provenance: "judged",
  },
  {
    prompt: "two things write to the same file at once, should i add a lock",
    label: "principle-separate-before-serializing-shared-state",
    provenance: "judged",
  },
  {
    prompt: "can each worker write its own copy and merge them later",
    label: "principle-separate-before-serializing-shared-state",
    provenance: "judged",
  },
  {
    prompt: "we keep adding queues and retries around this shared state, is that the wrong fix",
    label: "principle-separate-before-serializing-shared-state",
    provenance: "judged",
  },
  {
    prompt: "how long should it take a new reader to find where a value comes from and what can change it",
    label: "principle-minimize-reader-load",
    provenance: "judged",
  },
  {
    prompt: "i removed a layer and the reader load went up, is that a transfer or a loss",
    label: "principle-minimize-reader-load",
    provenance: "judged",
  },
  {
    prompt: "this repo gets harder to read every month and no single file changed, what is that",
    label: "principle-minimize-reader-load",
    provenance: "judged",
  },
  {
    prompt: "every new hire needs the same guidance from me about the setup, there has to be a better way",
    label: "principle-encode-lessons-in-structure",
    provenance: "judged",
  },
  {
    prompt: "the same defect keeps reappearing every week, can a tool catch it instead of me",
    label: "principle-encode-lessons-in-structure",
    provenance: "judged",
  },
  {
    prompt: "i wrote the same review comment on three different changes, it should not depend on me noticing",
    label: "principle-encode-lessons-in-structure",
    provenance: "judged",
  },
  {
    prompt: "we have never built anything like this and a wrong choice would be expensive to undo, should we try two ways",
    label: "principle-exhaust-the-design-space",
    provenance: "judged",
  },
  {
    prompt: "nothing in this codebase does this, i am tempted to just write the obvious one",
    label: "principle-exhaust-the-design-space",
    provenance: "judged",
  },
  {
    prompt: "i have one idea for this and no second one, is that enough",
    label: "principle-exhaust-the-design-space",
    provenance: "judged",
  },
  {
    prompt: "every user would carry that choice forever if we add a setting for it, is it worth it",
    label: "principle-experience-first",
    provenance: "judged",
  },
  {
    prompt: "one part of the app feels slow and the rest is fine, should we fix the whole surface or only where people actually use it",
    label: "principle-experience-first",
    provenance: "judged",
  },
  {
    prompt: "the team wants one more feature this quarter but the people using the app would not notice it, what should we ship",
    label: "principle-experience-first",
    provenance: "judged",
  },
  {
    prompt: "everything later depends on this first part, what should we settle now while it is still cheap to change",
    label: "principle-foundational-thinking",
    provenance: "judged",
  },
  {
    prompt: "the seams between the modules are not decided, we should pick them before any of the code exists",
    label: "principle-foundational-thinking",
    provenance: "judged",
  },
  {
    prompt: "this data structure carries every later phase, is now the moment to get it right",
    label: "principle-foundational-thinking",
    provenance: "judged",
  },
  {
    prompt: "i have to change this call in thirty places, is there a way to do it once",
    label: "principle-build-the-lever",
    provenance: "judged",
  },
  {
    prompt: "next month another team will need this same change, how do we not do it by hand again",
    label: "principle-build-the-lever",
    provenance: "judged",
  },
  {
    prompt: "there are twelve modules with the same bug, what do we do instead of editing each one",
    label: "principle-build-the-lever",
    provenance: "judged",
  },
  {
    prompt: "the binary built without errors but nobody has run it, does that count",
    label: "principle-prove-it-works",
    provenance: "judged",
  },
  {
    prompt: "the tool says it wrote the output, how do i check the output itself",
    label: "principle-prove-it-works",
    provenance: "judged",
  },
  {
    prompt: "a first time user would not know what to click here, has anyone tried that",
    label: "principle-prove-it-works",
    provenance: "judged",
  },
  {
    prompt: "this requirement was never thought of when the shape was drawn, what do we do with it",
    label: "principle-redesign-from-first-principles",
    provenance: "judged",
  },
  {
    prompt: "the plan adds a flag for the new case, is that the right way to fit it in",
    label: "principle-redesign-from-first-principles",
    provenance: "judged",
  },
  {
    prompt: "describing this change as the old design with one more case feels wrong, what should we do",
    label: "principle-redesign-from-first-principles",
    provenance: "judged",
  },
  {
    prompt: "the work takes five commits and nobody can say what the end state looks like, what should we write down",
    label: "principle-outcome-oriented-execution",
    provenance: "judged",
  },
  {
    prompt: "we are halfway through a staged migration on a branch, can this branch land yet",
    label: "principle-outcome-oriented-execution",
    provenance: "judged",
  },
  {
    prompt: "the last commit went in but the plan never said what finished looks like, how do we check",
    label: "principle-outcome-oriented-execution",
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

/**
 * The blind slice. It is the honest read, and it is here because the other two
 * slices stopped being one: `tuned` is the set the descriptions were written
 * against, so a row that wins there proves nothing, and `heldOut` reached 28 of
 * 28 while four of its judged rows drifted inside a description.
 *
 * A row here is written from the leaf's body, in the words a person would use,
 * and it is read once. `eval/tests/fixture.test.ts` holds the bar: a row may not
 * share a four-word run with the description of the leaf it names, so a leaf
 * cannot win a row by quoting itself.
 *
 * When a description changes because of a row in this slice, that row stops
 * being blind. Move it into `tuned` in the same change, and write its
 * replacement here from the body again.
 */
export const blind: ReadonlyArray<Row> = [
  // The fresh batch, written on 2026-10-20 by a writer that never saw the
  // descriptions. `eval/writer.ts` booted OpenCode with the plugin absent
  // (minimax-m3.1-flash-free at low effort) and asked for one sentence per id
  // from the id alone, in the voice of a person mid-task; unfair sentences got
  // a blind re-ask, so three passes produced 69 leaf sentences. Twenty-seven of
  // them instantiate the id's moment fairly enough that the label holds — mostly
  // every principle id, which carries its own meaning — and the rest stayed
  // off-domain (a pipeline incident rather than the moment the id names), so
  // those leaves carry no row this batch and the instrument stays clean. A row
  // whose label the writer invented is noise in the denominator, not a miss.
  // The previous batch is in git history at 2560d8d.
  { prompt: "leftover console.log statements are still sitting in the checkout flow PR", label: "code-hygiene", provenance: "judged" },
  { prompt: "i keep retyping the same deploy check across three repos, so i'm finally pulling it into one shared script", label: "principle-build-the-lever", provenance: "judged" },
  { prompt: "wait, who actually asked for a new date picker, the ticket only says the dropdown closes early on safari", label: "principle-attack-the-premise", provenance: "judged" },
  { prompt: "the new dropdown component is pulling in a dozen imports from the old form lib and i keep editing files i don't own", label: "principle-boundary-discipline", provenance: "judged" },
  { prompt: "the nightshift cron job keeps breaking when i touch the schema, so im writing it down in the repo notes instead of my head", label: "principle-encode-lessons-in-structure", provenance: "judged" },
  { prompt: "i'm still poking at three ways to shard the events table before i commit to one", label: "principle-exhaust-the-design-space", provenance: "judged" },
  { prompt: "the checkout api keeps 500ing on expired carts so we're tracing the cart schema instead of patching the endpoint again", label: "principle-fix-root-causes", provenance: "judged" },
  { prompt: "the orders table keeps changing shape underneath us so i keep rewriting the same etl step before i touch anything downstream", label: "principle-foundational-thinking", provenance: "judged" },
  { prompt: "the design system index is eating my context and i still need to finish the prop table for the button component", label: "principle-guard-the-context-window", provenance: "judged" },
  { prompt: "the billing service still has that stale feature flag from the spring release and nobody has cleaned it out yet", label: "principle-hygiene", provenance: "judged" },
  { prompt: "i'm not adding the retry and backoff logic to the ingest worker until we actually see failed rows in prod", label: "principle-laziness-protocol", provenance: "judged" },
  { prompt: "the stripe webhook retry is charging customers twice again, so i need the payments endpoint to ignore duplicate event ids", label: "principle-make-operations-idempotent", provenance: "judged" },
  { prompt: "our tabs component still accepts both null and undefined for hidden panels so the type union never catches the duplicates", label: "principle-make-states-unrepresentable", provenance: "judged" },
  { prompt: "every service still on the old v1 payments schema, so i'm migrating callers first before deleting the legacy endpoint", label: "principle-migrate-callers-then-delete-legacy-apis", provenance: "judged" },
  { prompt: "i keep rereading the same three api docs to figure out where the checkout page actually pulls its pricing from", label: "principle-minimize-reader-load", provenance: "judged" },
  { prompt: "i keep adding one-off fields to the orders table instead of modelling the domain properly", label: "principle-model-the-domain", provenance: "judged" },
  { prompt: "the airflow dag keeps failing on the staging cluster but i still can't tell if the new schema actually works end to end", label: "principle-prove-it-works", provenance: "judged" },
  { prompt: "the payments service schema is wrong at the root, so i'm throwing out the old tables and rebuilding the model from scratch", label: "principle-redesign-from-first-principles", provenance: "judged" },
  { prompt: "the events table is still shared while the export job serializes it, so i'm splitting the state out before the nightly sync runs", label: "principle-separate-before-serializing-shared-state", provenance: "judged" },
  { prompt: "the design system PR is 900 lines, so im cutting it into a stack of small PRs each with its own passing test suite", label: "principle-sequence-verifiable-units", provenance: "judged" },
  { prompt: "the payments schema keeps growing every week and nobody wants to drop anything, can we look at what we can remove", label: "principle-subtract-before-you-add", provenance: "judged" },
  { prompt: "im writing a test for the billing sync job and i keep stubbing the kafka producer, is that testing the wrong thing", label: "principle-test-behavior-not-implementation", provenance: "judged" },
  { prompt: "the checkout api returns 200 with an empty body so i'm adding a test that asserts the actual field before we ship it", label: "principle-test-for-truth", provenance: "judged" },
  { prompt: "the billing service payloads are still untyped and i keep discovering new field names at runtime", label: "principle-type-system-discipline", provenance: "judged" },
  { prompt: "before i land the dialog rewrite let me check the focus-trap claim against what the dom actually does in the a11y test suite", label: "principle-verification", provenance: "judged" },

  // Leaves a blind writer cannot be trusted to instantiate from the id alone.
  // The moment lives in the description, which is exactly what the writer must
  // never see, so a fair row for these waits for a moment observed in real work.
  { prompt: "i need to pull the diff on that pr into the canvas before the review lands on main", label: "pr-canvas", provenance: "judged" },
  { prompt: "the checkout service keeps timing out so im swapping the postgres query for a cached lookup and seeing if the p95 improves", label: "playbook-hillclimb", provenance: "judged" },

  // Ordinary work, written by the same blind writer under the same rules, that
  // must not pull a leaf. A router that fires on everything is as wrong as one
  // that fires on nothing.
  { prompt: "i need to regenerate the type declarations before we cut the release", label: "none", provenance: "neg" },
  { prompt: "i'm renaming the migration files to match the new timestamp convention", label: "none", provenance: "neg" },
  { prompt: "i need to bump the peer dependency range in the component library package.json", label: "none", provenance: "neg" },
  { prompt: "i need to rotate the expired service account key before the nightly job runs", label: "none", provenance: "neg" },
  { prompt: "i need to bump the storybook version and rebuild the docs site before the release", label: "none", provenance: "neg" },
];

export const rows: ReadonlyArray<Row> = [...tuned, ...heldOut];

export const tsv = (input: ReadonlyArray<Row>) =>
  input.map((row) => `${row.prompt}\t${row.label}\t${row.provenance}`).join("\n") + "\n";
