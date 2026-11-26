import { Skill } from "@opencode/plugin/effect";
import { Effect } from "effect";
import {
  DetectAbortedError,
  DetectBoundedError,
  detect,
  type SolidDetectReport,
} from "../../../tools/definitions/solidjs";
import { anchor, type Definition, type PreloadOutcome, type SkillPreload } from "../definition";

const SOLIDJS_DETECT_BOUNDS = {
  maxSourceFiles: 200,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 2 * 1024 * 1024,
  maxLockBytes: 8 * 1024 * 1024,
} as const;

const MAX_EVIDENCE_ITEMS = 10;

const pushBulletSection = (lines: Array<string>, label: string, items: ReadonlyArray<string>): void => {
  if (items.length === 0) return;
  lines.push(`${label}:`);
  for (const item of items) lines.push(`- ${item}`);
};

const pushEvidenceSection = (
  lines: Array<string>,
  evidence: SolidDetectReport["evidence"],
): void => {
  if (evidence.length === 0) return;
  lines.push("evidence:");
  for (const item of evidence.slice(0, MAX_EVIDENCE_ITEMS)) {
    const loc = item.line === undefined ? item.file : `${item.file}:${item.line}`;
    lines.push(`- ${loc}: ${item.detail}`);
  }
  if (evidence.length > MAX_EVIDENCE_ITEMS) {
    lines.push(`- (+${evidence.length - MAX_EVIDENCE_ITEMS} more evidence items)`);
  }
};

const pushOptionalPackages = (lines: Array<string>, report: SolidDetectReport): void => {
  const entries: ReadonlyArray<readonly [string, { readonly declared?: string; readonly line: string } | undefined]> = [
    ["start", report.start],
    ["router", report.router],
    ["meta", report.meta],
  ];
  for (const [label, pkg] of entries) {
    if (pkg !== undefined) {
      lines.push(`${label}: declared=${pkg.declared ?? "none"}, line=${pkg.line}`);
    }
  }
  if (report.jsxImportSource !== undefined) {
    lines.push(`jsxImportSource: ${report.jsxImportSource}`);
  }
};

const formatSolidReport = (directory: string, report: SolidDetectReport): string => {
  const lines: Array<string> = [
    `directory: ${directory}`,
    `mode: ${report.mode}`,
    `compatible: ${report.compatible}`,
    `framework: ${report.framework}`,
    `solid: line=${report.solid.line}, declared=${report.solid.declared ?? "none"}, resolved=${report.solid.resolved ?? "none"}, prerelease=${report.solid.prerelease}`,
  ];
  pushOptionalPackages(lines, report);
  lines.push(
    `config: appConfig=${report.config.appConfig}, viteConfig=${report.config.viteConfig}, startPlugin=${report.config.startPlugin}, solidPlugin=${report.config.solidPlugin ?? "none"}`,
  );
  pushBulletSection(lines, "incompatible", report.incompatible);
  pushBulletSection(lines, "warnings", report.warnings);
  pushEvidenceSection(lines, report.evidence);
  return lines.join("\n");
};

const solidjsPreload: SkillPreload = {
  source: 'tools.spectre.solidjs({ action: "detect" })',
  readResources: ["package.json", "tsconfig.json", "vite.config.ts"],
  timeoutMs: 2_000,
  maxBytes: 2_048,
  maxLines: 50,
  run: (context) =>
    Effect.tryPromise({
      try: async (): Promise<PreloadOutcome> => {
        try {
          const report = await detect(context.directory, {
            signal: context.signal,
            ...SOLIDJS_DETECT_BOUNDS,
          });
          return { kind: "ok", body: formatSolidReport(context.directory, report) };
        } catch (cause) {
          if (cause instanceof DetectAbortedError || cause instanceof DetectBoundedError) {
            return { kind: "skip", reason: cause.message };
          }
          throw cause;
        }
      },
      catch: (cause) => cause,
    }),
};

export const solidjsBestPractices: Definition = {
  id: Skill.ID.make("solidjs-best-practices"),
  name: Skill.Name.make("solidjs-best-practices"),
  description:
    "Reach for it while writing, reviewing or migrating SolidJS code: a signal or memo that does not update, a prop that freezes, an effect that fetches or writes state, a store setter that takes a path, `<For>` or `<Index>`, context, a SolidStart route, server function or hydration mismatch, or a Solid 1.x to 2.0 migration. It detects whether the project runs stable `solid-js` 1.9, the 2.0 release candidate, or SolidStart 1/2 (which still runs Solid 1), then gives the API for that exact version, the anti-patterns it punishes, and the checks that prove the change. Do not use it for React, Vue or Svelte. You call it. Nothing in this set calls it for you.",
  autoinvoke: false,
  catalog: {
    tier: "pull",
    category: "stack",
    summary: "Version-gated Solid 1.9, Solid 2.0, and SolidStart reactivity, stores, and SSR rules",
  },
  path: anchor(import.meta.dir),
  preload: solidjsPreload,
};
