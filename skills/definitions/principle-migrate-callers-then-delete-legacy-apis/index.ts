import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

export const principleMigrateCallersThenDeleteLegacyApis: Definition = {
  id: Skill.ID.make("principle-migrate-callers-then-delete-legacy-apis"),
  name: Skill.Name.make("principle-migrate-callers-then-delete-legacy-apis"),
  description:
    "A new internal API replaces the old one, and no commit in between leaves a tree where nobody can say which path is live. Load it when you add something that supersedes something that already exists: a renamed function, a reshaped type, a command that replaces an older one, a config key that replaces an older one. Write the caller list down before you write the new path, since that list is also the commit plan. Then split the migration by caller group, one group per commit, each one small enough to read and each one leaving the tests passing, and delete the old path in the commit that empties it, along with its adapter, its flag, and any test that only pinned the old shape. The rule holds inside this repository, where you can see all the callers. It does not hold for anything in the package's exports map or in a released version, because those have callers you cannot see, and breaking one is a release rather than a refactor.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
