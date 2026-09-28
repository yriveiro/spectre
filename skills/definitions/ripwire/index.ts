import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const ripwire: Definition = {
  id: Skill.ID.make("ripwire"),
  name: Skill.Name.make("ripwire"),
  description:
    "Run the command instead of asserting it. Load it whenever a claim about the code has not been measured: you said nothing calls that, you want to know whether a change is really covered by tests, you are about to report a number or a passing check or done, or you are choosing between two shapes and want the one that already exists here. It maps every spectre principle to the ripwire verb that can falsify that principle's test, states where ripwire is wrong, and hands off to the moment-skills ripwire installs.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
