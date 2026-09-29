import type { Message, Part } from "./opencode";
import { NONE, type Via } from "./score";

/**
 * The decision is the `skill` activation, not the prose. A model that says "I
 * would load no-comments" has stated a preference; a model that activates the
 * skill has done the thing OpenCode routes on. `via` records which was observed,
 * so a model that never activates anything is visible as its own measurement
 * rather than folded into the same column.
 */
export type Observed = { readonly got: string; readonly via: Via };

export type Transcript = {
  /** Ids from `Session.Message.Skill`, which the message list already carries. */
  readonly activated: ReadonlyArray<string>;
  /** Assistant turns, fetched for their `content`. */
  readonly messages: ReadonlyArray<Message>;
};

const SKILL_TOOLS = new Set(["skill", "skills"]);

/**
 * The field is `content`, not `parts`. Measured on a live assistant turn: the
 * per-message route answers with `content` holding `reasoning`, `tool`, and
 * `text` entries, and no `parts` key exists anywhere in the response. Reading
 * `parts` yields nothing, which scored every row as a silent miss.
 */
const partsOf = (message: Message): ReadonlyArray<Part> =>
  Array.isArray(message.content) ? message.content : [];

const fromTool = (message: Message): string | undefined => {
  for (const part of partsOf(message)) {
    if (part.type !== "tool" || part.name === undefined) continue;
    if (!SKILL_TOOLS.has(part.name)) continue;
    const input = part.state?.input;
    if (input === undefined) continue;
    for (const key of ["id", "skill", "name"]) {
      const value = input[key];
      if (typeof value === "string" && value !== "") return value;
    }
  }
  return undefined;
};

const textOf = (message: Message) =>
  partsOf(message)
    .filter((part) => part.type === "text" && part.text !== undefined)
    .map((part) => part.text!)
    .join("\n");

/** Graded on the first catalogue id a reply mentions, so an explained answer still counts. */
export const fromText = (raw: string, catalogue: ReadonlyArray<string>): string => {
  const text = raw.trim();
  if (text === "") return "";
  const tokens = text.split(/[\s"'`,.:;()[\]]+/).map((token) => token.replace(/^-+|-+$/g, ""));
  const named = tokens.find((token) => catalogue.includes(token));
  if (named !== undefined) return named;
  if (/\bnone\b/i.test(text)) return NONE;
  return tokens[0] ?? "";
};

export const observe = (transcript: Transcript, catalogue: ReadonlyArray<string>): Observed => {
  const activated = transcript.activated[0];
  if (activated !== undefined) return { got: activated, via: "skill" };
  for (const message of transcript.messages) {
    const called = fromTool(message);
    if (called !== undefined) return { got: called, via: "tool" };
  }
  const text = transcript.messages.map(textOf).join("\n");
  if (text.trim() === "") return { got: "", via: "silent" };
  return { got: fromText(text, catalogue), via: "text" };
};
