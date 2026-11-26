import { join } from "node:path";
import { Skill } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { anchor, type Definition, type PreloadOutcome, type SkillPreload } from "../definition";
import { VERIFIED } from "./verified";

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_EFFECT_PACKAGES = 20;

const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

type ManifestRecord = Record<string, unknown>;

const readBoundedJson = async (
  filePath: string,
  signal: AbortSignal,
): Promise<{ readonly kind: "ok"; readonly value: ManifestRecord } | { readonly kind: "missing" | "oversized" | "invalid" }> => {
  if (signal.aborted) return { kind: "missing" };
  const file = Bun.file(filePath);
  if (!(await file.exists())) return { kind: "missing" };
  if (file.size > MAX_MANIFEST_BYTES) return { kind: "oversized" };
  if (signal.aborted) return { kind: "missing" };
  try {
    const parsed: unknown = JSON.parse(await file.text());
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { kind: "invalid" };
    }
    return { kind: "ok", value: parsed as ManifestRecord };
  } catch {
    return { kind: "invalid" };
  }
};

const collectEffectDeclarations = (manifest: ManifestRecord) => {
  const declared: Array<string> = [];
  const scoped = new Map<string, string>();
  for (const section of DEP_SECTIONS) {
    const entries = manifest[section];
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) continue;
    for (const [name, version] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof version !== "string") continue;
      if (name === "effect") declared.push(`${section}=${version}`);
      else if (name.startsWith("@effect/") && !scoped.has(name)) scoped.set(name, version);
    }
  }
  const effectPackages = [...scoped.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_EFFECT_PACKAGES)
    .map(([name, version]) => `${name}=${version}`);
  return { declared, effectPackages };
};

const probeEffectWorkspace = async (
  directory: string,
  signal: AbortSignal,
): Promise<PreloadOutcome> => {
  const manifestRes = await readBoundedJson(join(directory, "package.json"), signal);
  if (manifestRes.kind === "oversized") {
    return { kind: "skip", reason: "package.json exceeds preload read bound" };
  }

  const { declared, effectPackages } =
    manifestRes.kind === "ok"
      ? collectEffectDeclarations(manifestRes.value)
      : { declared: [], effectPackages: [] };

  const installedRes = await readBoundedJson(
    join(directory, "node_modules/effect/package.json"),
    signal,
  );
  if (installedRes.kind === "oversized") {
    return { kind: "skip", reason: "node_modules/effect/package.json exceeds preload read bound" };
  }
  const installedVersion =
    installedRes.kind === "ok" && typeof installedRes.value.version === "string"
      ? installedRes.value.version
      : undefined;

  if (declared.length === 0 && effectPackages.length === 0 && installedVersion === undefined) {
    return { kind: "skip", reason: "effect is not declared or installed in this workspace" };
  }

  const distPresent = signal.aborted
    ? false
    : await Bun.file(join(directory, "node_modules/effect/dist"))
        .stat()
        .then((stat) => stat.isDirectory())
        .catch(() => false);

  const status =
    installedVersion === undefined
      ? "uninstalled"
      : installedVersion === VERIFIED.effect
        ? "aligned"
        : "drifted";

  const lines: Array<string> = [
    `directory: ${directory}`,
    `verified-skill-version: ${VERIFIED.effect}`,
    `status: ${status}`,
    `declared: ${declared.length > 0 ? declared.join(", ") : "none"}`,
    `installed: ${installedVersion ?? "not-installed"}`,
    `declarations: node_modules/effect/dist/<Module>.d.ts (${distPresent ? "present" : "absent"})`,
  ];
  if (effectPackages.length > 0) {
    lines.push(`effect-packages: ${effectPackages.join(", ")}`);
  }
  lines.push(
    "note: Version metadata only. Still inspect node_modules/effect/dist/<Module>.d.ts before relying on an Effect export.",
  );

  return { kind: "ok", body: lines.join("\n") };
};

const effectPreload: SkillPreload = {
  source: "package.json + node_modules/effect/package.json",
  readResources: ["package.json", "node_modules/effect/package.json"],
  timeoutMs: 1_000,
  maxBytes: 2_048,
  maxLines: 30,
  run: (context) =>
    Effect.tryPromise({
      try: () => probeEffectWorkspace(context.directory, context.signal),
      catch: (cause) => cause,
    }),
};

export const effectBestPractices: Definition = {
  id: Skill.ID.make("effect-best-practices"),
  name: Skill.Name.make("effect-best-practices"),
  description:
    "The Effect spelling that resolves against the `effect` version this repo pins, and the rule behind each decision. Reach for it while you are writing or reviewing `Effect` or `@effect/*` code: choosing `Schema.Struct` against `Schema.Class` against `Schema.TaggedClass`, branding a primitive with `Schema.brand`, giving a failure its own `Schema.TaggedError` and recovering it with `Effect.catchTag`, building a `Context.Service` and composing a `Layer`, deciding between `Effect.provide`, `Layer.provideMerge` and `Layer.mergeAll`, forking work that outlives the call, or reading configuration through `Config` and `ConfigProvider`. Phase A is the one to read when an export you expected is missing. `principle-evidence` owns checking a claim at source. This records what that check returned, so a near-miss is not rediscovered every session. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  catalog: {
    tier: "pull",
    category: "stack",
    summary: "Effect 4.1.0 schemas, branded types, TaggedError, Context.Service, Layer, and Config patterns",
  },
  path: anchor(import.meta.dir),
  preload: effectPreload,
};
