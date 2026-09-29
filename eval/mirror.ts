import { Effect } from "effect";
import { load } from "../skills/definitions";

const frontmatter = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n`;

export const writeMirror = async (root: string) => {
  const skills = await Effect.runPromise(load());

  for (const skill of skills)
    await Bun.write(
      `${root}/${skill.id}/SKILL.md`,
      `${frontmatter(skill.id, skill.description ?? "")}${skill.content}`,
    );

  return skills.map((skill) => skill.id).toSorted();
};
