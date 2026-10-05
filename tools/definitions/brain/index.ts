import type { Plugin } from "@opencode/plugin/effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { join } from "node:path";
import { evidence } from "./evidence";
import { type Edge, ledger, live } from "./ledger";
import type { Claim } from "./neuron";
import { recall } from "./recall";

export { attach } from "./inject";

const CLAIMS = ["feature", "gotcha", "decision", "constraint", "lesson"] as const;
const EDGES = ["relates", "supersedes", "contradicts", "derived-from", "demoted"] as const;

const ClaimKind = Schema.Literals([...CLAIMS]);
const EdgeKind = Schema.Literals([...EDGES]);

export const Recall = Schema.Struct({
  action: Schema.optional(Schema.Literals(["recall"])).annotate({
    description: "Ask the brain a question. The default when `action` is omitted.",
  }),
  query: Schema.String.annotate({
    description:
      "The question, in the words the answer would use. A path is a good query: a claim whose `subject` lists that file matches it.",
  }),
  subject: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Paths to search around as well as the query. Naming the files turns a vague question into a claim's own `subject`.",
  }),
  budget: Schema.optional(Schema.Number).annotate({
    description:
      "Token budget for the whole answer. The default is ample for a turn; a smaller one returns fewer claims and says it clipped.",
  }),
});

export const Assert = Schema.Struct({
  action: Schema.Literals(["assert"]).annotate({
    description:
      "Record a fact the repository does not contain, after a diff lands or something bit you.",
  }),
  kind: ClaimKind.annotate({
    description:
      "`feature` for one coherent area, `gotcha` for what bit you, `decision` for why something is the way it is, `constraint` for what may not change, `lesson` for what you learned.",
  }),
  subject: Schema.Array(Schema.String).annotate({
    description:
      "Project-relative paths the claim is about. Every one must exist: a claim about a file that is not there is refused.",
  }),
  claim: Schema.String.annotate({
    description:
      "One sentence. Headline only — the body is never carried in context, and this is the whole of what `recall` returns.",
  }),
});

export const Relate = Schema.Struct({
  action: Schema.Literals(["relate"]).annotate({
    description: "Say two claims are joined, contradict each other, or one came out of the other.",
  }),
  from: Schema.String.annotate({ description: "Id of the first claim, as a previous call returned it." }),
  to: Schema.String.annotate({ description: "Id of the second claim." }),
  kind: Schema.Literals(["relates", "contradicts", "derived-from"]).annotate({
    description:
      "`relates` is one feature across two surfaces. `contradicts` is a claim the other one falsifies. `derived-from` is a claim distilled out of the other.",
  }),
  why: Schema.String.annotate({
    description: "The reason they are joined. An empty one is refused.",
  }),
});

export const Supersede = Schema.Struct({
  action: Schema.Literals(["supersede"]).annotate({
    description: "Record that one claim replaced another. An edge, never an edit.",
  }),
  from: Schema.String.annotate({ description: "Id of the claim that is now wrong." }),
  to: Schema.String.annotate({ description: "Id of the claim that replaced it." }),
  why: Schema.String.annotate({
    description: "Why the old one stopped being true. An empty one is refused.",
  }),
});

export const Demote = Schema.Struct({
  action: Schema.Literals(["demote"]).annotate({
    description: "Stop trusting a claim for now. A demotion, never a deletion.",
  }),
  id: Schema.String.annotate({ description: "Id of the claim to demote." }),
  why: Schema.String.annotate({
    description: "What made it untrustworthy. An empty one is refused.",
  }),
  until: Schema.optional(Schema.String).annotate({
    description:
      "When to start trusting it again, as a date. Omit it to demote with no end.",
  }),
});

export const Action = Schema.Union([Assert, Relate, Supersede, Demote, Recall]);

const ClaimRow = Schema.Struct({
  id: Schema.String,
  kind: ClaimKind,
  claim: Schema.String,
  subject: Schema.Array(Schema.String),
  at: Schema.String,
  path: Schema.String.annotate({
    description: "Where the note is. One Read away — `recall` never carries a body.",
  }),
});

const EdgeRow = Schema.Struct({
  kind: EdgeKind,
  from: Schema.String,
  to: Schema.optional(Schema.String),
  why: Schema.String,
  at: Schema.String,
  until: Schema.optional(Schema.String).annotate({
    description: "Present on a demotion that ends. Until then it is out of every answer.",
  }),
});

export const Recalled = Schema.Struct({
  status: Schema.Literals(["recalled"]).annotate({
    description: "What the brain knows about the question. Empty on a brain nobody has seeded.",
  }),
  claims: Schema.Array(ClaimRow),
  edges: Schema.Array(EdgeRow),
  sources: Schema.Array(Schema.String),
  problems: Schema.Array(Schema.String),
  clipped: Schema.Boolean,
});

export const Asserted = Schema.Struct({
  status: Schema.Literals(["asserted"]).annotate({
    description: "The claim is on disk and cannot be rewritten. Read the evidence before trusting the grouping.",
  }),
  id: Schema.String,
  kind: ClaimKind,
  claim: Schema.String,
  subject: Schema.Array(Schema.String),
  at: Schema.String,
  path: Schema.String,
  evidence: Schema.Array(Schema.Json).annotate({
    description:
      "What git says about `subject`: per path, how many commits touched it, when it was last touched, and how many paths it co-changes with. Derived, never written by the model.",
  }),
  problems: Schema.optional(Schema.String),
});

export const Related = Schema.Struct({
  status: Schema.Literals(["related"]),
  kind: Schema.Literals(["relates", "contradicts", "derived-from"]),
  from: Schema.String,
  to: Schema.String,
  why: Schema.String,
  wrote: Schema.Boolean.annotate({
    description: "`false` means this exact edge was already there, so the ledger did not change and `git diff` is empty.",
  }),
});

export const Superseded = Schema.Struct({
  status: Schema.Literals(["superseded"]),
  from: Schema.String,
  to: Schema.String,
  why: Schema.String,
  wrote: Schema.Boolean,
});

export const Demoted = Schema.Struct({
  status: Schema.Literals(["demoted"]),
  id: Schema.String,
  why: Schema.String,
  until: Schema.optional(Schema.String),
  wrote: Schema.Boolean,
});

export const Rejected = Schema.Struct({
  status: Schema.Literals(["rejected"]).annotate({
    description: "Nothing was written. `problems` says which rule.",
  }),
  action: Schema.Literals(["recall", "assert", "relate", "supersede", "demote"]),
  problems: Schema.String,
});

export const Answered = Schema.Union([Recalled, Asserted, Related, Superseded, Demoted, Rejected]);

const DEFAULT_BUDGET = 400;

const root = (ctx: Plugin.Context): AbsolutePath =>
  AbsolutePath.make(join(ctx.location.project.directory, ".spectre", "brain"));

const rejected = (action: typeof Rejected.Type["action"], problems: string): typeof Rejected.Type => ({
  status: "rejected",
  action,
  problems,
});

const NO_WHY =
  "an edge with no reason is not a relation, and the reason is the only part a reader gets once the session that wrote it is gone. Nothing was written.";

const claimRow = (claim: Claim): typeof ClaimRow.Type => ({
  id: claim.id,
  kind: claim.kind,
  claim: claim.claim,
  subject: claim.subject,
  at: claim.at,
  path: claim.path,
});

const edgeRow = (edge: Edge): typeof EdgeRow.Type => ({
  kind: edge.kind,
  from: edge.from,
  ...(edge.to === null ? {} : { to: edge.to }),
  why: edge.why,
  at: edge.at,
  ...(edge.until === null ? {} : { until: edge.until }),
});

const runAssert = (ctx: Plugin.Context) =>
  Effect.fn("spectre.brain.assert")(function* (input: typeof Assert.Type) {
    const directory = ctx.location.project.directory;
    const seen = yield* evidence(directory, input.subject);
    if (seen.missing.length > 0)
      return rejected(
        "assert",
        `${seen.missing.join(", ")}: not a path in ${directory}. A claim about a file that is not there describes nothing. Nothing was written.`,
      );

    const claim = yield* ledger(root(ctx)).mint({
      kind: input.kind,
      claim: input.claim,
      subject: input.subject,
    });

    return {
      status: "asserted" as const,
      ...claimRow(claim),
      evidence: seen.rows,
      ...(seen.problems.length > 0 ? { problems: seen.problems.join("\n") } : {}),
    };
  });

const runRelate = (ctx: Plugin.Context) =>
  Effect.fn("spectre.brain.relate")(function* (input: typeof Relate.Type) {
    const why = input.why.trim();
    if (why.length === 0) return rejected("relate", NO_WHY);

    const wrote = yield* ledger(root(ctx)).append({
      kind: input.kind,
      from: input.from,
      to: input.to,
      why,
      at: new Date().toISOString(),
      until: null,
    });

    return {
      status: "related" as const,
      kind: input.kind,
      from: input.from,
      to: input.to,
      why,
      wrote,
    };
  });

const runSupersede = (ctx: Plugin.Context) =>
  Effect.fn("spectre.brain.supersede")(function* (input: typeof Supersede.Type) {
    const why = input.why.trim();
    if (why.length === 0) return rejected("supersede", NO_WHY);

    const wrote = yield* ledger(root(ctx)).append({
      kind: "supersedes",
      from: input.from,
      to: input.to,
      why,
      at: new Date().toISOString(),
      until: null,
    });

    return { status: "superseded" as const, from: input.from, to: input.to, why, wrote };
  });

const runDemote = (ctx: Plugin.Context) =>
  Effect.fn("spectre.brain.demote")(function* (input: typeof Demote.Type) {
    const why = input.why.trim();
    if (why.length === 0) return rejected("demote", NO_WHY);

    const wrote = yield* ledger(root(ctx)).append({
      kind: "demoted",
      from: input.id,
      to: null,
      why,
      at: new Date().toISOString(),
      until: input.until ?? null,
    });

    return {
      status: "demoted" as const,
      id: input.id,
      why,
      ...(input.until === undefined ? {} : { until: input.until }),
      wrote,
    };
  });

const runRecall = (ctx: Plugin.Context) =>
  Effect.fn("spectre.brain.recall")(function* (input: typeof Recall.Type) {
    const held = yield* ledger(root(ctx)).read();
    const answer = yield* recall({
      claims: held.claims,
      edges: live(held.edges),
      query: [input.query, ...(input.subject ?? [])].join(" "),
      budget: input.budget ?? DEFAULT_BUDGET,
    });

    return {
      status: "recalled" as const,
      claims: answer.claims.map(claimRow),
      edges: answer.edges.map(edgeRow),
      sources: answer.sources,
      problems: [...held.problems, ...answer.problems],
      clipped: answer.clipped,
    };
  });

export const DESCRIPTION = `What this project knows that the code cannot say: which surfaces are one feature, why a decision was made, what bit someone last month.

  const hit = await tools.spectre.brain({ action: "recall", query: "why does routing read spectre.jsonc" })
  hit.claims[0].path      // the note. One Read away — the body never enters context
  hit.edges[0].why        // and the reason two claims belong together

  await tools.spectre.brain({
    action: "assert",
    kind: "gotcha",
    subject: ["tools/definitions/canvas/store.ts"],
    claim: "A canvas is never overwritten: save allocates the directory, the write tool writes the page.",
  })

  await tools.spectre.brain({ action: "relate", from: a, to: b, kind: "relates", why: "one feature, two surfaces" })

## A claim and an edge

A **claim** is one immutable markdown note at \`.spectre/brain/neurons/<ulid>.md\`:
a \`kind\`, one sentence, and the paths it is about. It is minted once and never
rewritten, so \`git log\` on the folder is the whole history of what was believed
and when.

An **edge** is one line of \`.spectre/brain/synapses.ndjson\`: \`relates\`,
\`supersedes\`, \`contradicts\`, \`derived-from\` or \`demoted\`, between two claim
ids, with a \`why\` that is mandatory. Nothing is ever edited or deleted, and the
frontmatter *is* the index, so there is no second copy to go stale.

**A feature is not a folder.** It is a \`feature\` claim whose \`subject\` lists two
or more surfaces, plus the edges that join them. \`ls\` shows ULIDs; \`recall\` is
the reader.

## The five actions

- \`recall\` — the only read. Returns headlines and edges, never a body, and
  \`problems\` says what clipped or went unread. It never starts work.
- \`assert\` — record a \`kind\` claim about \`subject\` paths. Every path must
  exist. See the next section.
- \`relate\` — join two claims, or say they contradict, or that one came out of
  the other.
- \`supersede\` — one claim replaced another. The old one drops out of answers.
- \`demote\` — stop trusting a claim, optionally \`until\` a date. Forgetting is
  an edge with an end, never a deletion.

## The evidence comes back with the assert

\`assert\` returns what git says about the paths you named: per path, how many
commits touched it, when it was last touched, and how many paths it co-changes
with. A model cannot write down its own evidence, so a \`feature\` claim whose
members never co-change arrives visibly wrong **in the return value of the call
that created it**. Supersede it or re-assert it.

A repository with no git history, or twenty genuinely uncoupled files, returns
empty evidence and says so. That is a real answer, not a zero.

## Refusals, and they are the interesting part

- \`assert\` refuses a \`subject\` path that does not exist, and names it. A claim
  about a file that is not there is a hallucinated feature.
- \`relate\`, \`supersede\` and \`demote\` refuse an empty \`why\`. A required
  field is a prompt to the model, not a guarantee, so it is checked here.
- \`recall\` on a brain nobody has seeded returns empty arrays and
  \`problems: ["cold: 0 claims"]\`. It is not an error and it starts nothing. Ask
  \`mnemonic\` to seed.

\`wrote\` on every edge action reports whether the ledger actually changed. A
second identical call returns \`wrote: false\`, which is what an empty \`git diff\`
looks like from the inside.

## What it will not do

It will not rewrite or delete a claim, so there is no "correct the typo" action —
\`supersede\` it. It will not assert something \`ripwire\` answers: if callers,
blast radius, history or co-change are the question, that tool already has the
measurement. It will not carry a note's body into a turn; it hands back a path.`;

export const brain = (ctx: Plugin.Context): Tool.Info<typeof Action, typeof Answered> => ({
  name: "brain",
  description: DESCRIPTION,
  input: Action,
  output: Answered,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "brain" },
  execute: (input) =>
    Effect.gen(function* () {
      const answer =
        input.action === "assert"
          ? yield* runAssert(ctx)(input)
          : input.action === "relate"
            ? yield* runRelate(ctx)(input)
            : input.action === "supersede"
              ? yield* runSupersede(ctx)(input)
              : input.action === "demote"
                ? yield* runDemote(ctx)(input)
                : yield* runRecall(ctx)(input);
      return { output: answer };
    }).pipe(
      // A note the ledger could not read, or a write the filesystem refused. A
      // refusal about the request itself — a missing subject path, an edge with no
      // `why` — is a `rejected` answer and never reaches this channel.
      Effect.mapError((error) => new Tool.Error({ message: error.message, error })),
    ),
});
