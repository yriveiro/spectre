import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const opencodePlatform: Definition = {
  id: Skill.ID.make("opencode-platform"),
  name: Skill.Name.make("opencode-platform"),
  description:
    "Read it before writing anything that runs inside OpenCode 2.2.7: a plugin `effect`, a `ctx.*` domain call, a session or tool hook, a `Tool.Info` registration, a command, agent, skill or MCP transform, `ctx.session.prompt`, or an RPC method. It is the host contract at that tag — the plugin shape and its scope, the context by domain, every hook with when it runs and what it may change, the tool editor and its code-mode default, the session operations and delivery modes, the HTTP route families, which package a plugin versus an application uses, and the tag path each fact came from. The tag beats the docs, and it names the two places the 2.2.7 pages are stale. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
