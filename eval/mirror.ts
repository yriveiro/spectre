import { Effect } from "effect";
import { load } from "../skills/definitions";

const frontmatter = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n`;

// The rivals a live session actually sees. ripwire's install script copies its
// skill directories here, and OpenCode registers them next to ours, so the
// model arm's catalogue has always held both. The mirror held ours alone, so
// the lexical arms ranked every prompt against a catalogue the model never
// gets: a rival could win the live session and lose the eval by absence.
export const rivalsRoot = () => `${Bun.env.HOME}/.local/share/ripwire/skills`;

export const rivalIds = async (root: string = rivalsRoot()): Promise<ReadonlyArray<string>> => {
  const ids: Array<string> = [];
  for await (const entry of new Bun.Glob("ripwire-*/SKILL.md").scan(root))
    ids.push(entry.split("/")[0]!);
  return ids.toSorted();
};

export const writeMirror = async (root: string) => {
  const skills = await Effect.runPromise(load());
  for (const skill of skills)
    await Bun.write(
      `${root}/${skill.id}/SKILL.md`,
      `${frontmatter(skill.id, skill.description ?? "")}${skill.content}`,
    );

  const rivals: Array<string> = [];
  const from = rivalsRoot();
  for (const id of await rivalIds(from)) {
    await Bun.write(`${root}/${id}/SKILL.md`, await Bun.file(`${from}/${id}/SKILL.md`).text());
    rivals.push(id);
  }

  return { ours: skills.map((skill) => skill.id).toSorted(), rivals: rivals.toSorted() };
};
