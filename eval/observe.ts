import type { SessionMessageAssistant } from "@opencode/client";
import type { Transcript } from "./opencode";
import { NONE, type Via } from "./score";

export type Observed = { readonly got: string; readonly via: Via };

const SKILL_TOOLS = new Set(["skill", "skills"]);

const fromTool = (message: SessionMessageAssistant): string | undefined => {
  for (const part of message.content) {
    if (part.type !== "tool" || !SKILL_TOOLS.has(part.name)) continue;
    if (part.state.status === "streaming") continue;
    for (const key of ["id", "skill", "name"]) {
      const value = part.state.input[key];
      if (typeof value === "string" && value !== "") return value;
    }
  }
  return undefined;
};

const textOf = (message: SessionMessageAssistant) =>
  message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");

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
