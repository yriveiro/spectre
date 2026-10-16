import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const elysiaBestPractices: Definition = {
  id: Skill.ID.make("elysia-best-practices"),
  name: Skill.Name.make("elysia-best-practices"),
  description:
    "Reach for it while you are writing or changing an Elysia server: routes and handlers, TypeBox or Standard-Schema validation, guards and macros, auth, plugins (CORS, OpenAPI, static, JWT), websockets, tests, project structure and deployment. It is the map to the references, plugins, integrations, examples and patterns this skill carries, and the llms.txt source of truth it leans on. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
