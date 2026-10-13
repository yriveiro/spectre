import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const effectBestPractices: Definition = {
  id: Skill.ID.make("effect-best-practices"),
  name: Skill.Name.make("effect-best-practices"),
  description:
    "The Effect spelling that resolves against the `effect` version this repo pins, and the rule behind each decision. Reach for it while you are writing or reviewing `Effect` or `@effect/*` code: choosing `Schema.Struct` against `Schema.Class` against `Schema.TaggedClass`, branding a primitive with `Schema.brand`, giving a failure its own `Schema.TaggedError` and recovering it with `Effect.catchTag`, building a `Context.Service` and composing a `Layer`, deciding between `Effect.provide`, `Layer.provideMerge` and `Layer.mergeAll`, forking work that outlives the call, or reading configuration through `Config` and `ConfigProvider`. Phase A is the one to read when an export you expected is missing. `principle-evidence` owns checking a claim at source. This records what that check returned, so a near-miss is not rediscovered every session. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};