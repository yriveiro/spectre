import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The prose pass: the words in a sentence.
 *
 * The test the whole set asks of a leaf: does it have one question with a check that can fail. Rules 1 to
 * 11 here are the shape of a message and are judged by a person. The rules in
 * `unslop` are the words in a sentence, and most of them are greppable, so they
 * answer to a different question and fire on a different moment: a commit message,
 * a code comment, a doc, not only a reply.
 *
 * Rule numbers are stable ids that other skills cite, so they are declared and
 * kept. A renumbering breaks a reference.
 */
export const unslop: Definition = {
  id: Skill.ID.make("unslop"),
  name: Skill.Name.make("unslop"),
  description:
    "Cut the tells out of writing so the reader spends nothing on decoding. Load it before sending anything a person will read, and when writing a commit message, a code comment, a doc, or a report where the wording matters. Each rule has a check: a dash, an -ing clause at the end of a sentence, an adjective with no fact behind it, three items where the content has two, four words for one referent, a colon doing a sentence's job, a bold label restating the line after it, and an attribution with no name. The sharpest is rule 27: if the sentence could appear unchanged in another project's docs, it says nothing about this one, so cut it. Say what the thing does, not how it feels. Grep for the two mechanical ones, read the rest.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
