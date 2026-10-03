import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const technicalWriting: Definition = {
  id: Skill.ID.make("technical-writing"),
  name: Skill.Name.make("technical-writing"),
  description:
    "Take a document to a tired engineer on the first read: pick the mode it belongs to, address the reader, load one idea per sentence, and leave nothing open to two readings. Reach for it when the words are the deliverable rather than the code, which is a README, an RFC, a design note, a PR description, a commit message, or a document that is correct and still unclear. It owns the structure of a document and the layer its reader is in, while `grammar` owns the tells inside a sentence and `i-have-adhd` owns the shape of a message. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
