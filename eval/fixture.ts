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
  // The seven leaves the corpus never covered. Each row is the moment, said
  // the way a person says it, and none of them is the description's phrasing.
  { prompt: "i am editing the same call in twenty files by hand, one after another", label: "principle-build-the-lever", provenance: "judged" },
  { prompt: "this rename has to land in every service, and we will do it again next quarter", label: "principle-build-the-lever", provenance: "judged" },
  { prompt: "we keep pasting the same fix into every module, there has to be a way to run it once", label: "principle-build-the-lever", provenance: "judged" },
  { prompt: "i have written this same warning three times now, where should it live instead", label: "principle-encode-lessons-in-structure", provenance: "judged" },
  { prompt: "this keeps coming back in review and every time it costs the same argument", label: "principle-encode-lessons-in-structure", provenance: "judged" },
  { prompt: "i told the last two people joining this team the same thing about this file", label: "principle-encode-lessons-in-structure", provenance: "judged" },
  { prompt: "nobody here has done this before and picking wrong costs us a whole quarter", label: "principle-exhaust-the-design-space", provenance: "judged" },
  { prompt: "there is nothing in this repo like it, should i write two versions and see which survives", label: "principle-exhaust-the-design-space", provenance: "judged" },
  { prompt: "the first idea that came to mind is probably a guess, how do i choose properly", label: "principle-exhaust-the-design-space", provenance: "judged" },
  { prompt: "this screen works but feels slow, should we make every screen feel this good or only this one", label: "principle-experience-first", provenance: "judged" },
  { prompt: "we could add a knob so people pick their own, is that worth what it costs them", label: "principle-experience-first", provenance: "judged" },
  { prompt: "the team wants this feature but the people using it would be fine without it, what do we do", label: "principle-experience-first", provenance: "judged" },
  { prompt: "this job runs over four stages and stage one decides what the other three can even do", label: "principle-foundational-thinking", provenance: "judged" },
  { prompt: "we have not decided where the pieces meet yet, should we settle that before writing any of it", label: "principle-foundational-thinking", provenance: "judged" },
  { prompt: "the shape of the data will carry every later part of this, is now the cheap moment to pick it", label: "principle-foundational-thinking", provenance: "judged" },
  { prompt: "everything compiles, does that mean it actually works for someone using it", label: "principle-prove-it-works", provenance: "judged" },
  { prompt: "the script said it wrote the file, how do i know the file is right", label: "principle-prove-it-works", provenance: "judged" },
  { prompt: "nobody has opened the thing in a browser, the checks all pass though", label: "principle-prove-it-works", provenance: "judged" },
  { prompt: "this feature never fit the way the thing works, do we bolt it on or change the thing", label: "principle-redesign-from-first-principles", provenance: "judged" },
  { prompt: "the plan is an extra branch beside the old path, that feels like the wrong shape", label: "principle-redesign-from-first-principles", provenance: "judged" },
  { prompt: "if we started today knowing about this, we would build it differently, should we move there", label: "principle-redesign-from-first-principles", provenance: "judged" },

  // Boundary rows. Each one has a neighbour it could go to, and the neighbour
  // is the point: a router that cannot separate two leaves that say almost the
  // same thing has not learned either of them.
  { prompt: "this retry hides the error instead of removing it, is there a deeper cause", label: "principle-fix-root-causes", provenance: "judged" },
  { prompt: "if the process dies halfway and the command runs again, what state do we end up in", label: "principle-make-operations-idempotent", provenance: "judged" },
  { prompt: "the suite is green, am i entitled to say it works", label: "principle-verification", provenance: "judged" },
  { prompt: "the migration applied cleanly to an empty database, does that mean real data survives", label: "principle-prove-it-works", provenance: "judged" },
  { prompt: "the plan has six steps, each one has to end with something i can see", label: "principle-sequence-verifiable-units", provenance: "judged" },
  { prompt: "this spans four commits and i cannot say what finished state it converges on", label: "principle-outcome-oriented-execution", provenance: "judged" },
  { prompt: "there are two readings of this request and i could pick one or ask", label: "principle-never-block-on-the-human", provenance: "judged" },
  { prompt: "before i put this new option in, can the old ones go", label: "principle-subtract-before-you-add", provenance: "judged" },
  { prompt: "these two jobs both change the same record, should they take turns", label: "principle-separate-before-serializing-shared-state", provenance: "judged" },
  { prompt: "this repo has four thousand files, i cannot read them all today", label: "principle-guard-the-context-window", provenance: "judged" },
  { prompt: "the billing code has no idea what a subscription is, it only knows amounts and dates", label: "principle-model-the-domain", provenance: "judged" },
  { prompt: "this test would still pass if the function returned nothing, is it real", label: "principle-test-behavior-not-implementation", provenance: "judged" },

  // The other direction: work that is not a principle moment and must not pull
  // a leaf. A router that fires on everything is as wrong as one that fires on
  // nothing.
  { prompt: "write the release notes for this version", label: "none", provenance: "neg" },
  { prompt: "format this file with prettier", label: "none", provenance: "neg" },
  { prompt: "add a github action that runs the suite on every push", label: "none", provenance: "neg" },
  { prompt: "bump the copyright year in the license file", label: "none", provenance: "neg" },
];

export const rows: ReadonlyArray<Row> = [...tuned, ...heldOut];

export const tsv = (input: ReadonlyArray<Row>) =>
  input.map((row) => `${row.prompt}\t${row.label}\t${row.provenance}`).join("\n") + "\n";
