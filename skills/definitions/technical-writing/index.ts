import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * Why this is registered and not indexed: `skills/FOR_AGENTS.md`, rule 3.
 *
 * It is a procedure and not a principle: it is a set of passes over a document,
 * and the claim it states has no single test to fail. Reader-called, so the
 * description is written for the person picking from the Skills dialog.
 *
 * It owns the structure of a document and the layer its reader is in.
 * `unslop` owns the tells inside a sentence and `i-have-adhd` owns the shape of
 * a message, so this leaf does not restate either of them, and it says so in one
 * line so the reader knows where to go next.
 */
export const technicalWriting: Definition = {
  id: Skill.ID.make("technical-writing"),
  name: Skill.Name.make("technical-writing"),
  description:
    "Take a document to a tired engineer on the first read: pick the mode it belongs to, address the reader, load one idea per sentence, and leave nothing open to two readings. Reach for it when the words are the deliverable rather than the code, which is a README, an RFC, a design note, a PR description, a commit message, or a document that is correct and still unclear. It owns the structure of a document and the layer its reader is in, while `unslop` owns the tells inside a sentence and `i-have-adhd` owns the shape of a message. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
