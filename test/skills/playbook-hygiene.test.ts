import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { type LoadedSkill, load } from "../../skills/definitions";

const MAX_PLAYBOOK_LINES = 200;
const MAX_PLAYBOOK_TOKENS = 2_500;

type PlaybookRule =
  | "size-lines"
  | "size-tokens"
  | "phases"
  | "phase-verification"
  | "failure-recovery"
  | "vague-retry";

type PlaybookViolation = {
  readonly rule: PlaybookRule;
  readonly detail: string;
};

type H2Section = {
  readonly heading: string;
  readonly index: number;
  readonly rawLines: Array<string>;
  readonly proseBlocks: Array<string>;
  readonly orderedListNums: Array<number>;
};

type ScannedMarkdown = {
  readonly lineCount: number;
  readonly preambleBlocks: Array<string>;
  readonly h2Sections: Array<H2Section>;
};

type FenceState = {
  readonly char: string;
  readonly len: number;
};

type ScanState = {
  readonly preambleBlocks: Array<string>;
  readonly h2Sections: Array<H2Section>;
  fence: FenceState | null;
  current: H2Section | null;
  buf: Array<string>;
};

const isPlaybook = (skill: LoadedSkill): boolean =>
  skill.catalog.tier === "pull" && skill.catalog.category === "playbook";

const flushProse = (state: ScanState): void => {
  if (state.buf.length === 0) return;
  const block = state.buf.join(" ");
  if (state.current !== null) state.current.proseBlocks.push(block);
  else state.preambleBlocks.push(block);
  state.buf = [];
};

const matchFenceOpen = (raw: string): FenceState | null => {
  const open = raw.match(/^ {0,3}(`{3,})[^`]*$/) ?? raw.match(/^ {0,3}(~{3,}).*$/);
  const marker = open?.[1];
  if (marker === undefined) return null;
  return { char: marker[0] ?? "`", len: marker.length };
};

const isFenceClose = (raw: string, fence: FenceState): boolean => {
  const close = raw.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
  const marker = close?.[1];
  return marker !== undefined && marker[0] === fence.char && marker.length >= fence.len;
};

const consumeFenceLine = (state: ScanState, raw: string): boolean => {
  if (state.fence !== null) {
    if (state.current !== null) state.current.rawLines.push(raw);
    if (isFenceClose(raw, state.fence)) state.fence = null;
    return true;
  }
  const opened = matchFenceOpen(raw);
  if (opened === null) return false;
  flushProse(state);
  if (state.current !== null) state.current.rawLines.push(raw);
  state.fence = opened;
  return true;
};

const pushProseLine = (state: ScanState, raw: string): void => {
  const trimmed = raw.trim();
  if (/^#{1,6}\s+/.test(trimmed) || trimmed === "") {
    flushProse(state);
    return;
  }
  if (/^\|/.test(trimmed)) {
    flushProse(state);
    if (!/^\|[\s:-]+\|[\s|:-]*$/.test(trimmed)) {
      if (state.current !== null) state.current.proseBlocks.push(trimmed);
      else state.preambleBlocks.push(trimmed);
    }
    return;
  }
  const ordered = raw.match(/^ {0,3}(\d+)\.\s+\S/);
  if (ordered?.[1] !== undefined) {
    flushProse(state);
    if (state.current !== null) state.current.orderedListNums.push(Number(ordered[1]));
    state.buf.push(trimmed);
    return;
  }
  if (/^ {0,3}[-*+]\s+/.test(raw)) flushProse(state);
  state.buf.push(trimmed);
};

const scanMarkdown = (content: string): ScannedMarkdown => {
  const lines = content.replace(/\r?\n$/, "").split(/\r?\n/);
  const state: ScanState = {
    preambleBlocks: [],
    h2Sections: [],
    fence: null,
    current: null,
    buf: [],
  };

  for (const raw of lines) {
    if (consumeFenceLine(state, raw)) continue;
    const h2 = raw.match(/^##\s+(.+?)\s*$/);
    if (h2?.[1] !== undefined) {
      flushProse(state);
      state.current = {
        heading: `## ${h2[1]}`,
        index: state.h2Sections.length,
        rawLines: [],
        proseBlocks: [],
        orderedListNums: [],
      };
      state.h2Sections.push(state.current);
      continue;
    }
    if (state.current !== null) state.current.rawLines.push(raw);
    pushProseLine(state, raw);
  }

  flushProse(state);
  return {
    lineCount: lines.length,
    preambleBlocks: state.preambleBlocks,
    h2Sections: state.h2Sections,
  };
};

const stripInlineCode = (text: string): string => text.replace(/`[^`]*`/g, " ");

const CODE_DOT_SENTINEL = String.fromCharCode(1);

const splitSentences = (block: string): ReadonlyArray<string> => {
  const masked = block.replace(/`[^`]+`/g, (span) => span.split(".").join(CODE_DOT_SENTINEL));
  return masked
    .split(/(?<=[.!?])\s+(?=[A-Z`"*(])/)
    .map((sentence) => sentence.split(CODE_DOT_SENTINEL).join(".").trim())
    .filter((sentence) => sentence.length > 0);
};

const UNBOUNDED_TRY_AGAIN_RE =
  /\b(?:try(?:ing)?|attempt(?:ing)?)\s+again\b(?!\s+(?:once|one\s+time|at\s+most\s+once)\b)/gi;

const NEGATED_RETRY_PREFIX_RE = /\b(?:do\s+not|don't|never|avoid|without)\s+(?:just\s+)?$/i;

const BANNED_VAGUE_RETRY: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  { name: "keep-trying", pattern: /\bkeep\s+(?:trying|retrying|polling|checking)\b/i },
  {
    name: "try-more-times",
    pattern:
      /\b(?:try|retry)\s+(?:once\s+more|a\s+few\s+(?:more\s+)?times|several\s+times|multiple\s+times|repeatedly|indefinitely)\b/i,
  },
  { name: "just-retry", pattern: /\b(?:just|simply)\s+(?:retry|re-?run)\b/i },
  {
    name: "retry-until-works",
    pattern:
      /\b(?:retry|re-?run|run\s+again|repeat|loop)\s+(?:it\s+)?until\s+(?:it\s+)?(?:works|passes|succeeds|green|clean|clear|fixed|resolved)\b/i,
  },
  { name: "retry-as-needed", pattern: /\bretry\s+(?:as\s+needed|if\s+needed|until\s+resolved)\b/i },
  { name: "sleep-and-poll", pattern: /\bsleep\s+(?:and|then)\s+(?:poll|check|retry)\b/i },
];

const findVagueRetry = (
  block: string,
): { readonly name: string; readonly match: string } | null => {
  const prose = stripInlineCode(block);

  for (const tryMatch of prose.matchAll(UNBOUNDED_TRY_AGAIN_RE)) {
    const before = prose.slice(0, tryMatch.index ?? 0);
    if (!NEGATED_RETRY_PREFIX_RE.test(before)) {
      return { name: "try-again", match: tryMatch[0] };
    }
  }

  for (const { name, pattern } of BANNED_VAGUE_RETRY) {
    const found = prose.match(pattern);
    if (found !== null) return { name, match: found[0] };
  }

  return null;
};

const VERIFY_COMMAND_RE =
  /`(?:bun (?:test|run)|npm (?:test|run)|pytest|cargo test|go test|vitest|jest|tsc|git (?:status|diff|log|merge-base)|gh (?:pr (?:checks|view|diff)|run view)|ripwire\b|tools\.spectre\.(?:comments|stack|goal|brain|history|ripwire|prose)|tools\.playwright\.|browser_console_messages|browser_take_screenshot)[^`]*`/;

const VERIFY_ACTION_RE =
  /\b(?:verif(?:y|ies|ied)|prove(?:s|d)?|confirm(?:s|ed)?|re-?measure(?:s|d)?|measure(?:s|d)?|reproduc(?:e|es|ed)|spot-check(?:s|ed)?|compare(?:s|d)?|audit(?:s|ed)?|diff\s+(?:it|them|against|the\s+new)|read(?:s|ing)?\s+back|re-?read(?:s|ing)?|re-?run\s+(?:the\s+)?(?:gates?|tests?|checks?|harness|suite)|run(?:s|ning)?\s+(?:the\s+|a\s+|its\s+|project's\s+)?(?:tests?|checks?|suite|harness|build|script|typecheck|command|it\s+over)|take\s+(?:one\s+|a\s+)?screenshot|screenshot\s+the|read\s+(?:the\s+|every\s+)?(?:console|output|result|evidence|verdict|status|diff|problems|rows|tail|it\b)|log\s+(?:the\s+)?timings|print\s+(?:the\s+)?output|check\s+(?:that|whether|it\s+with|the\s+(?:result|output|status|diff|pull request|tests?|build|claims?|inherited|baseline|predicate|exit|chain)))\b/gi;

const NEGATED_ACTION_PREFIX_RE =
  /\b(?:do\s+not|don't|never|cannot|can't|none\s+of|nobody\s+can|without)\b[^.!?\n]{0,55}$/i;

const OBSERVABLE_EVIDENCE_RE =
  /\b(?:tests?|test\s+suite|suite|harness|build|typecheck|screenshot(?:s)?|console|timings?|output|diff|delta|baseline|metric|samples?|predicate|verdict|status|opened|exit\s+code|error\s+line|pass(?:es|ing)?|fail(?:s|ed|ing|ure)?|green|red|zero|nonzero|evidence|problems|art[ei]fact(?:s)?|SHAs?|rows?|coverage|claims?|results?|signal|profile|snapshot|trace|before\s+and\s+after|second\s+run|matching\s+surface|pull\s+request|gates?|symbol|comments|suppressions|ancestor|porcelain)\b/i;

const hasActionWithEvidence = (plain: string): boolean => {
  for (const actionMatch of plain.matchAll(VERIFY_ACTION_RE)) {
    const start = actionMatch.index ?? 0;
    const before = plain.slice(0, start);
    if (NEGATED_ACTION_PREFIX_RE.test(before)) continue;
    const rest = `${before} ${plain.slice(start + actionMatch[0].length)}`.trim();
    if (OBSERVABLE_EVIDENCE_RE.test(rest)) return true;
  }
  return false;
};

const sentenceHasVerification = (sentence: string): boolean => {
  if (findVagueRetry(sentence) !== null) return false;
  if (/^\s*[-*+]?\s*(?:Do\s+not|Never|None\s+of)\b/i.test(sentence)) return false;
  const plain = sentence.replace(/`/g, "");
  if (VERIFY_COMMAND_RE.test(sentence) && OBSERVABLE_EVIDENCE_RE.test(plain)) return true;
  return hasActionWithEvidence(plain);
};

const hasConcreteVerification = (block: string): boolean =>
  splitSentences(block).some(sentenceHasVerification);

const FAILURE_CLAUSE_RE =
  /\b(?:(?:if|when|unless|where)\b[^.!?\n]*(?:fail(?:s|ed|ing|ure)?|errored|broken|red\b|nonzero|inconclusive|unconfirmed|unverified|refus(?:e[ds]?|al)|reject(?:ed)?|blocked|missing|absent|empty|conflict(?:s|ing)?|stale|stuck|stall(?:s|ed)?|plateau|ambiguous|disagree(?:s|d|ment)?|contradicts|wrong|throws|already\s+exists|name\s+is\s+taken|cancels|no\s+(?:card|decision|baseline|coverage|base\s+ref|source\s+mapping)|does\s+not\s+(?:exist|build|confirm|drop|move|match|pass|carry)|will\s+not\s+(?:confirm|fire)|cannot\s+(?:reach|be\s+answered|capture)|not\s+(?:reachable|authenticated|fetched|settled|confirmed)|has\s+none|looks\s+wrong|could\s+finish|is\s+gone|hold\s+is\s+on)|on\s+(?:a\s+|an\s+|any\s+)?(?:fail(?:ure)?|refusal|error|stall|plateau|unverified|rejected|conflict|mismatch|timeout)|(?:is|are)\s+(?:stuck|wrong|refused|rejected|missing|not\s+fetched|not\s+reachable|not\s+authenticated|unmerged|not\s+a\s+pass|not\s+yet\s+a\s+diagnosis)|(?:failed|unverified|rejected)\s+(?:errored|left|created)|a\s+refused\s+call|disagreement\s+means|no\s+(?:decision|baseline|coverage)\s+means|comes\s+back\s+as\s+`?failed`?|voids\s+the\s+(?:row|verdicts?)|the\s+operator's\s+(?:hold|stop)\s+is\s+a\s+zero-writes\s+order|a\s+nonzero\s+diff\s+is\s+a\s+failure|an?\s+(?:correction|defect)\s+is\s+a\s+follow-up)\b/i;

const RECOVERY_DIRECTIVE_RE =
  /(?:(?:^|[,;:\u2014]|\band\b|\bthen\b|\bor\b|\bto\b|\bso\b|\bmust\b|\bshould\b|\bowner\b|\broot\b|\byou\b)\s*(?:stop(?:\s+(?:here|and|before|when|the\s+run|burning|spawning))?|stops\s+the\s+run|halt\b|pause\b|stand(?:\s+it)?\s+down|escalat(?:e[ds]?|ing)\b|abort\b|revert(?:s|ed)?\b|discard(?:s|ed)?\b|back\s+it\s+out|supersede\b|reclassify\b|cancel\b|flag\s+it|remove\s+(?:that|the)\s+directory|ask(?:\s+(?:the|them|one|with|for))?\b|report\s+(?:it|that|the|which|what|any|anything)\b|say\s+(?:so|plainly|which|that|why|it\s+did\s+not)\b|mark\s+(?:it\s+)?(?:unconfirmed|as)\b|record\s+(?:the\s+|a\s+)?(?:fallback|gap|failing)\b|write\s+the\s+exact\s+ask|rewrite\s+the\s+rubric|route\s+to\b|switch\s+to\b|pick\s+another\b|dispatch\s+a\s+replacement|fix(?:es)?\s+(?:the\s+(?:repro|file|plan|failure|defect|harness|implementation|path)|its\s+own\s+slice)\b|repair\s+the\s+plan\b|re-?verify\b|re-?check\b|read\s+`?problems`?|run\s+`?git\s+(?:fetch|worktree\s+prune|merge-base)|git\s+worktree\s+prune|open\s+a\s+session|move\s+this\s+session|use\s+the\s+default|follow-up\s+on\s+that|do\s+not\s+(?:proceed|drift|guess|mutate|start|merge|push|retry|continue|edit|commit|relax|touch)\b|never\s+(?:merge|mutate|retry|guess|force-push|loop|retrigger|rm\s+-rf)\b|hand\s+back\b|decline\b|interrogate\b)|`question`)/i;

const hasConcreteRecovery = (block: string): boolean => {
  const sentences = splitSentences(block);
  for (let i = 0; i < sentences.length; i++) {
    const current = sentences[i];
    if (current === undefined || findVagueRetry(current) !== null) continue;
    if (FAILURE_CLAUSE_RE.test(current) && RECOVERY_DIRECTIVE_RE.test(current)) return true;
    const next = sentences[i + 1];
    if (
      next !== undefined &&
      findVagueRetry(next) === null &&
      FAILURE_CLAUSE_RE.test(current) &&
      RECOVERY_DIRECTIVE_RE.test(next)
    ) {
      return true;
    }
  }
  return false;
};

type PhaseEntry = {
  readonly section: H2Section;
  readonly letter: string;
};

const extractPhases = (h2Sections: ReadonlyArray<H2Section>): ReadonlyArray<PhaseEntry> =>
  h2Sections.flatMap((section) => {
    const match = section.heading.match(/^## Phase ([A-Z]):\s+\S/);
    return match?.[1] === undefined ? [] : [{ section, letter: match[1] }];
  });

const checkSize = (lineCount: number, charCount: number): ReadonlyArray<PlaybookViolation> => {
  const out: Array<PlaybookViolation> = [];
  if (lineCount > MAX_PLAYBOOK_LINES) {
    out.push({
      rule: "size-lines",
      detail: `${lineCount} lines exceeds ${MAX_PLAYBOOK_LINES} (move overflow detail to references/*.md)`,
    });
  }
  const estimatedTokens = Math.max(1, Math.ceil(charCount / 4));
  if (estimatedTokens > MAX_PLAYBOOK_TOKENS) {
    out.push({
      rule: "size-tokens",
      detail: `${estimatedTokens} estimated body tokens exceeds ${MAX_PLAYBOOK_TOKENS} (move overflow detail to references/*.md)`,
    });
  }
  return out;
};

const checkStartSection = (
  startSection: H2Section | undefined,
  firstPhase: PhaseEntry | undefined,
): ReadonlyArray<string> => {
  if (startSection === undefined) return ["missing ## Start"];
  const issues: Array<string> = [];
  const nums = startSection.orderedListNums;
  const monotonic = nums.length >= 2 && nums.every((num, idx) => num === idx + 1);
  if (!monotonic) {
    issues.push(`## Start must contain a monotonic 1..K (K>=2) list, found [${nums.join(", ")}]`);
  }
  if (firstPhase !== undefined && startSection.index > firstPhase.section.index) {
    issues.push("## Start must precede ## Phase A:");
  }
  return issues;
};

const checkPhaseSequence = (phases: ReadonlyArray<PhaseEntry>): ReadonlyArray<string> => {
  if (phases.length < 2) {
    return [`expected >=2 ## Phase headings, found ${phases.length}`];
  }
  const issues: Array<string> = [];
  const letters = phases.map((phase) => phase.letter);
  const expected = letters.map((_, idx) => String.fromCharCode(65 + idx));
  if (letters.join("") !== expected.join("")) {
    issues.push(`non-contiguous phases ${letters.join(", ")} (expected ${expected.join(", ")})`);
  }
  for (const { section } of phases) {
    if (section.rawLines.join("\n").trim().length === 0) {
      issues.push(`empty phase section: ${section.heading}`);
    }
  }
  return issues;
};

const checkVagueRetries = (blocks: ReadonlyArray<string>): ReadonlyArray<PlaybookViolation> =>
  blocks.flatMap((block) => {
    const vague = findVagueRetry(block);
    return vague === null
      ? []
      : [{ rule: "vague-retry" as const, detail: `${vague.name}: "${vague.match}"` }];
  });

const checkPhaseSemantics = (
  phases: ReadonlyArray<PhaseEntry>,
): ReadonlyArray<PlaybookViolation> => {
  const phaseBlocks = phases.flatMap((phase) => phase.section.proseBlocks);
  const out: Array<PlaybookViolation> = [];
  if (!phaseBlocks.some(hasConcreteVerification)) {
    out.push({
      rule: "phase-verification",
      detail: "no phase names a concrete verification check with an observable result",
    });
  }
  if (!phaseBlocks.some(hasConcreteRecovery)) {
    out.push({
      rule: "failure-recovery",
      detail:
        "no phase pairs an operational failure/stop condition with a concrete recovery or halt action",
    });
  }
  return out;
};

const lintPlaybook = (content: string): ReadonlyArray<PlaybookViolation> => {
  const scanned = scanMarkdown(content);
  const startSection = scanned.h2Sections.find((section) => section.heading === "## Start");
  const phases = extractPhases(scanned.h2Sections);
  const phaseIssues = [
    ...checkStartSection(startSection, phases[0]),
    ...checkPhaseSequence(phases),
  ];
  const allBlocks = [
    ...scanned.preambleBlocks,
    ...scanned.h2Sections.flatMap((section) => section.proseBlocks),
  ];

  return [
    ...checkSize(scanned.lineCount, content.length),
    ...(phaseIssues.length > 0
      ? [{ rule: "phases" as const, detail: phaseIssues.join("; ") }]
      : []),
    ...checkVagueRetries(allBlocks),
    ...checkPhaseSemantics(phases),
  ];
};

const ruleSet = (content: string): ReadonlyArray<PlaybookRule> =>
  [...new Set(lintPlaybook(content).map((violation) => violation.rule))].toSorted();

const GOOD_BASE = `# Playbook Sample

Ship one scoped change with verifiable evidence.

## Start

1. Build the change
2. Verify the output

## Phase A: Build

Edit the target module directly. If the build fails, stop and report the first error line.

## Phase B: Verify

Run \`bun test\` and confirm every test passes before handover.

## Outputs

The changed file path and the test result.
`;

describe("playbook structural linter", () => {
  test("accepts valid baseline, handover endpoints, fast-path Start, backtick examples, bounded corrective retries, and fenced headings", () => {
    expect(ruleSet(GOOD_BASE)).toEqual([]);

    const handoverFastPath = `# Playbook Handover

## Start

1. Inspect
2. Ship

## Phase A: Inspect

If the check fails, stop and report the blocker.

## Phase B: Build

Apply the edit.

## Phase C: Verify

Run \`bun test\` and confirm zero failing tests.

## Phase D: Handover

Post the pull request URL and stop.
`;
    expect(ruleSet(handoverFastPath)).toEqual([]);

    const backtickExempt = `${GOOD_BASE.replace(
      "Edit the target module directly.",
      "Avoid vague phrases like `try again` or `keep trying`.",
    )}`;
    expect(ruleSet(backtickExempt)).toEqual([]);

    const boundedCorrectiveRetry = `${GOOD_BASE.replace(
      "Edit the target module directly.",
      "After refreshing credentials, try again once. Allow one retry only, check stderr before any retry, or try another approach.",
    )}`;
    expect(ruleSet(boundedCorrectiveRetry)).toEqual([]);

    const fencedBacktickAndTilde = `# Playbook Fences

## Start

\`\`\`markdown
## Phase Z: Fake heading inside backtick fence
1. Fake step
try again
\`\`\`

1. Build
2. Verify

## Phase A: Build

If the build fails, stop and report the first error line.

~~~markdown
## Phase Q: Fake heading inside tilde fence
keep trying
~~~

## Phase B: Verify

Run \`bun test\` and confirm every test passes.
`;
    expect(ruleSet(fencedBacktickAndTilde)).toEqual([]);
  });

  test("enforces size caps for lines and estimated body tokens", () => {
    const tooManyLines = `${GOOD_BASE}${"\n".repeat(205)}Tail line.\n`;
    expect(ruleSet(tooManyLines)).toEqual(["size-lines"]);

    const tooManyTokens = `${GOOD_BASE}\n${"token ".repeat(2_000)}\n`;
    expect(ruleSet(tooManyTokens)).toEqual(["size-tokens"]);
  });

  test("enforces ## Start placement, monotonic Start list, and contiguous non-empty phases", () => {
    const missingStart = GOOD_BASE.replace(/## Start[\s\S]*?(?=## Phase A:)/, "");
    expect(ruleSet(missingStart)).toEqual(["phases"]);

    const startAfterPhase = `# Playbook Sample

## Phase A: Build

If the build fails, stop and report the first error line.

## Start

1. Build
2. Verify

## Phase B: Verify

Run \`bun test\` and confirm every test passes.
`;
    expect(ruleSet(startAfterPhase)).toEqual(["phases"]);

    const startWithoutList = GOOD_BASE.replace(
      "1. Build the change\n2. Verify the output",
      "Follow the steps below.\n\n~~~\n1. Inside fence\n2. Also inside fence\n~~~",
    );
    expect(ruleSet(startWithoutList)).toEqual(["phases"]);

    const nonMonotonicStart = GOOD_BASE.replace("2. Verify the output", "3. Verify the output");
    expect(ruleSet(nonMonotonicStart)).toEqual(["phases"]);

    const skippedPhase = GOOD_BASE.replace("## Phase B: Verify", "## Phase C: Verify");
    expect(ruleSet(skippedPhase)).toEqual(["phases"]);

    const emptyPhase = `${GOOD_BASE.replace("## Outputs", "## Phase C: Empty\n\n## Outputs")}`;
    expect(ruleSet(emptyPhase)).toEqual(["phases"]);
  });

  test("enforces concrete phase-verification and rejects bare verbs, unrelated code spans, and negations", () => {
    const missingVerification = GOOD_BASE.replace(
      "Run `bun test` and confirm every test passes before handover.",
      "Push the branch to origin and hand over the summary.",
    );
    expect(ruleSet(missingVerification)).toEqual(["phase-verification"]);

    const bareCheck = GOOD_BASE.replace(
      "Run `bun test` and confirm every test passes before handover.",
      "Check.",
    );
    expect(ruleSet(bareCheck)).toEqual(["phase-verification"]);

    const unrelatedCodeSpan = GOOD_BASE.replace(
      "Run `bun test` and confirm every test passes before handover.",
      "Check `foo` and read `README.md`.",
    );
    expect(ruleSet(unrelatedCodeSpan)).toEqual(["phase-verification"]);

    const negatedVerification = GOOD_BASE.replace(
      "Run `bun test` and confirm every test passes before handover.",
      "Do not run the tests here.",
    );
    expect(ruleSet(negatedVerification)).toEqual(["phase-verification"]);
  });

  test("enforces operational failure-recovery and rejects descriptive phrases or Outputs-only text", () => {
    const happyPathOutputsOnly = GOOD_BASE.replace(
      "If the build fails, stop and report the first error line.",
      "Save the file directly.",
    ).replace(
      "The changed file path and the test result.",
      "If the build fails, stop and report the failure.",
    );
    expect(ruleSet(happyPathOutputsOnly)).toEqual(["failure-recovery"]);

    const descriptiveFailureReport = GOOD_BASE.replace(
      "If the build fails, stop and report the first error line.",
      "A failure report lists the labels.",
    );
    expect(ruleSet(descriptiveFailureReport)).toEqual(["failure-recovery"]);

    const failureWithoutAction = GOOD_BASE.replace(
      "If the build fails, stop and report the first error line.",
      "A failed build is noisy.",
    );
    expect(ruleSet(failureWithoutAction)).toEqual(["failure-recovery"]);
  });

  test("bans genuinely unbounded retry instructions including hard-wrapped prose", () => {
    const inlineTryAgain = GOOD_BASE.replace(
      "Run `bun test` and confirm every test passes before handover.",
      "Run `bun test` and confirm every test passes. If upload fails, try again.",
    );
    expect(ruleSet(inlineTryAgain)).toEqual(["vague-retry"]);

    const wrappedTryAgain = GOOD_BASE.replace(
      "Run `bun test` and confirm every test passes before handover.",
      "Run `bun test` and confirm every test passes. If upload fails, try\nagain before quitting.",
    );
    expect(ruleSet(wrappedTryAgain)).toEqual(["vague-retry"]);

    const keepTryingOnly = GOOD_BASE.replace(
      "If the build fails, stop and report the first error line.",
      "If the build fails, keep trying.",
    );
    expect(ruleSet(keepTryingOnly)).toEqual(["failure-recovery", "vague-retry"]);

    const rerunUntilGreen = GOOD_BASE.replace(
      "Run `bun test` and confirm every test passes before handover.",
      "Run `bun test` and confirm every test passes. Re-run until green.",
    );
    expect(ruleSet(rerunUntilGreen)).toEqual(["vague-retry"]);

    const sleepAndPoll = GOOD_BASE.replace(
      "Run `bun test` and confirm every test passes before handover.",
      "Run `bun test` and confirm every test passes. Sleep and poll until the check clears.",
    );
    expect(ruleSet(sleepAndPoll)).toEqual(["vague-retry"]);
  });
});

describe("registered playbooks", () => {
  test("scopes strictly to pull playbooks including worktree-cleanup and exempts all principle-* leaves", async () => {
    const loaded = await Effect.runPromise(load());
    const playbooks = loaded.filter(isPlaybook);
    const ids: ReadonlyArray<string> = playbooks.map((skill) => skill.id);

    expect(playbooks.length).toBeGreaterThan(0);
    expect(ids).toContain("worktree-cleanup");
    expect(loaded.some((skill) => skill.id.startsWith("principle-"))).toBe(true);
    expect(playbooks.filter((skill) => skill.id.startsWith("principle-"))).toEqual([]);
    expect(
      playbooks.every(
        (skill) => skill.catalog.tier === "pull" && skill.catalog.category === "playbook",
      ),
    ).toBe(true);
  });

  test("every registered playbook passes structural hygiene", async () => {
    const loaded = await Effect.runPromise(load());
    const playbooks = loaded.filter(isPlaybook);
    const failures: Array<string> = [];

    for (const skill of playbooks) {
      for (const violation of lintPlaybook(skill.content)) {
        failures.push(`${skill.id}: [${violation.rule}] ${violation.detail}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
