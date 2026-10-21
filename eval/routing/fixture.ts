/**
 * The routing corpus: a task statement, and the profile a human would route it
 * to.
 *
 * A row is a user request, not a label. The label is the profile, and the
 * rows in `blind` were written by writers who never saw the routing surface,
 * so the measurement is not the corpus reading back the surface that wrote it.
 *
 * The blind slice is fifty rows: six for each of the seven profiles, and eight
 * negative rows that fit none of them. Two writers wrote it, on two model
 * families, from the taxonomy alone. Neither read a `match` line, and none of
 * the rows shares a four-word run with one, which `eval/routing/tests/`
 * holds them to.
 */

export const NONE = "none";

export type Provenance = "judged" | "neg";

export type Row = {
  /** The request, in the words a person would use. */
  readonly prompt: string;
  /** The profile a human would route it to, or `none` when no profile fits. */
  readonly label: string;
  /** `neg` rows ask the matcher to stay quiet. */
  readonly provenance: Provenance;
};

/** The rows the surface was written against. In sample, so they prove little. */
export const tuned: ReadonlyArray<Row> = [];

/** The rows written blind, and the honest read. */
export const blind: ReadonlyArray<Row> = [
  {
    prompt: "install everything and tell me whether it comes back clean",
    label: "mechanical",
    provenance: "judged",
  },
  {
    prompt: "check which version is on this machine and paste the output",
    label: "mechanical",
    provenance: "judged",
  },
  {
    prompt: "start it up and tell me which port it landed on",
    label: "mechanical",
    provenance: "judged",
  },
  {
    prompt:
      "Run the style check across the whole tree and just list what it flags. Don't fix anything yet.",
    label: "mechanical",
    provenance: "judged",
  },
  {
    prompt: "Now do that same run against the other branch and report what it says.",
    label: "mechanical",
    provenance: "judged",
  },
  {
    prompt: "how much space is all this build output taking? just the number",
    label: "mechanical",
    provenance: "judged",
  },
  {
    prompt: "where do we handle the retry logic? just point me at it",
    label: "search",
    provenance: "judged",
  },
  { prompt: "where is the default timeout set?", label: "search", provenance: "judged" },
  {
    prompt: "find every place that still calls the old billing endpoint and list them",
    label: "search",
    provenance: "judged",
  },
  {
    prompt:
      "I'm looking for the thing that turns those raw errors into the messages the user sees — where does that live?",
    label: "search",
    provenance: "judged",
  },
  {
    prompt: "which part owns the cache invalidation? don't change anything, just tell me",
    label: "search",
    provenance: "judged",
  },
  {
    prompt: "we had a helper for turning titles into slugs somewhere. where did it end up?",
    label: "search",
    provenance: "judged",
  },
  {
    prompt: "add the missing field to the response and update the docs to match",
    label: "worker",
    provenance: "judged",
  },
  {
    prompt: "rename that setting everywhere it appears, samples included",
    label: "worker",
    provenance: "judged",
  },
  {
    prompt: "wire the new flag through to the handler — the behaviour is already agreed",
    label: "worker",
    provenance: "judged",
  },
  {
    prompt: "take the fix we just agreed on and put it on the other endpoint too",
    label: "worker",
    provenance: "judged",
  },
  {
    prompt: "bump the version to 2.4.0 and fix whatever the bump breaks",
    label: "worker",
    provenance: "judged",
  },
  {
    prompt: "move that helper into the shared folder and update the imports",
    label: "worker",
    provenance: "judged",
  },
  {
    prompt: "should we keep the cache or drop it? I can argue either way and I need a call",
    label: "judgment",
    provenance: "judged",
  },
  {
    prompt:
      "there are two reasonable ways to do this and I can't tell which is better. Which would you take, and why?",
    label: "judgment",
    provenance: "judged",
  },
  {
    prompt:
      "is it worth splitting this into its own service, or are we better off leaving it alone?",
    label: "judgment",
    provenance: "judged",
  },
  {
    prompt:
      "The team is split on shipping it behind a flag versus releasing it outright. Give me a recommendation.",
    label: "judgment",
    provenance: "judged",
  },
  {
    prompt: "we can either fix this properly or work around it for the release — which one?",
    label: "judgment",
    provenance: "judged",
  },
  {
    prompt: "we're choosing between rewriting it now and patching it as we go. Which would you do?",
    label: "judgment",
    provenance: "judged",
  },
  {
    prompt:
      "our upload cap is 100MB but users on mobile connections fail around 60MB. work out the cap we should ship so a 4G link with 2% packet loss finishes a transfer inside five minutes",
    label: "thinking",
    provenance: "judged",
  },
  {
    prompt:
      "nothing in the diff explains the deadlock from this morning's crash. read the goroutine dump I pasted above and work out what actually caused it",
    label: "thinking",
    provenance: "judged",
  },
  {
    prompt:
      "two users can claim the same coupon code when they submit in the same second. figure out exactly how that race happens — the answer has to explain every report, not just this one",
    label: "thinking",
    provenance: "judged",
  },
  {
    prompt:
      "what is the largest batch size the consumer can take before it falls behind at peak? do the math from the numbers I pasted above",
    label: "thinking",
    provenance: "judged",
  },
  {
    prompt:
      "the round-robin scheduler sometimes picks the same worker twice, but only under load. find the flaw in the selection logic",
    label: "thinking",
    provenance: "judged",
  },
  {
    prompt:
      "I need one number: how many cache nodes do we need at launch if each node serves 8k reads per second, we expect 70k, and ops wants 40% headroom? show the arithmetic",
    label: "thinking",
    provenance: "judged",
  },
  {
    prompt:
      "we're adding offline mode to the mobile client. before anyone writes code, sketch how sync, conflict resolution and local storage fit together end to end",
    label: "deep",
    provenance: "judged",
  },
  {
    prompt:
      "walk how auth flows through every service — gateway, sessions, the email verify step — and tell me whether the design holds up if we add SSO next quarter",
    label: "deep",
    provenance: "judged",
  },
  {
    prompt:
      "I want to split this monolith into two deployables. map what talks to what, where the seams are, and what breaks — the whole design, not one service",
    label: "deep",
    provenance: "judged",
  },
  {
    prompt:
      "does our plugin system still make sense if third parties ship their own tools? work it through at the architecture level before we promise anything",
    label: "deep",
    provenance: "judged",
  },
  {
    prompt:
      "the config system grew five ways to set the same value. map the full picture — env, file, flags, defaults, overrides — and propose how it should work",
    label: "deep",
    provenance: "judged",
  },
  {
    prompt:
      "we need a migration story from Postgres to CockroachDB. cover schema, dual writes, cutover and rollback — give me the whole plan",
    label: "deep",
    provenance: "judged",
  },
  {
    prompt:
      "this 900-line function works but nobody can read it. split it up — same behavior, no feature changes",
    label: "refactor",
    provenance: "judged",
  },
  {
    prompt:
      "the module is a tangle of globals but the tests pass. restructure it so each piece is testable on its own, without changing what it does",
    label: "refactor",
    provenance: "judged",
  },
  {
    prompt:
      "the retry logic is copy-pasted across three services. move it into one shared helper — the behavior has to stay identical",
    label: "refactor",
    provenance: "judged",
  },
  {
    prompt:
      "ok, the bug's fixed. now split that class — it's doing five jobs — but don't touch the public API",
    label: "refactor",
    provenance: "judged",
  },
  {
    prompt:
      "rename everything in the payments module to the new domain terms. pure rename, nothing else moves",
    label: "refactor",
    provenance: "judged",
  },
  {
    prompt:
      "move the validation out of the controllers into a middleware layer. no new rules, none removed — just relocation",
    label: "refactor",
    provenance: "judged",
  },
  { prompt: "hey, you there?", label: "none", provenance: "neg" },
  { prompt: "wait — so is the answer yes or no?", label: "none", provenance: "neg" },
  { prompt: "can you repeat what you just said?", label: "none", provenance: "neg" },
  {
    prompt: "how many messages have we exchanged so far in this session?",
    label: "none",
    provenance: "neg",
  },
  {
    prompt: "translate this to Spanish for me: 'the build failed'",
    label: "none",
    provenance: "neg",
  },
  {
    prompt: "put this in a bullet list: item one, item two, item three",
    label: "none",
    provenance: "neg",
  },
  {
    prompt: "what were we talking about before the last message?",
    label: "none",
    provenance: "neg",
  },
  { prompt: "thanks, that's all", label: "none", provenance: "neg" },
];
