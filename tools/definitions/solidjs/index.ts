import { resolve } from "node:path";
import type { Tool } from "@opencode/plugin/effect";
import type { AbsolutePath } from "@opencode/schema/schema";
import { Effect, Schema } from "effect";
import { audit } from "./audit";
import {
  DetectAbortedError,
  DetectBoundedError,
  type DetectOptions,
  detect,
  type Report as SolidDetectReport,
} from "./detect";

export { DetectAbortedError, DetectBoundedError, detect, type DetectOptions, type SolidDetectReport };

const Mode = Schema.Literals(["solid-1", "solid-2", "mixed", "unknown"]);
const Line = Schema.Literals(["1", "2", "unknown"]);
const MetaLine = Schema.Literals(["0", "1", "2", "unknown"]);
const Framework = Schema.Literals(["solidstart-1", "solidstart-2", "none"]);

const Evidence = Schema.Struct({
  file: Schema.String,
  line: Schema.optional(Schema.Number),
  detail: Schema.String,
});

const PackageLine = Schema.Struct({
  declared: Schema.optional(Schema.String),
  line: Line,
});

const ReportSchema = Schema.Struct({
  directory: Schema.String,
  mode: Mode,
  compatible: Schema.Boolean,
  framework: Framework,
  solid: Schema.Struct({
    declared: Schema.optional(Schema.String),
    resolved: Schema.optional(Schema.String),
    line: Line,
    prerelease: Schema.Boolean,
  }),
  start: Schema.optional(PackageLine),
  router: Schema.optional(PackageLine),
  meta: Schema.optional(
    Schema.Struct({
      declared: Schema.optional(Schema.String),
      line: MetaLine,
    }),
  ),
  jsxImportSource: Schema.optional(Schema.String),
  config: Schema.Struct({
    appConfig: Schema.Boolean,
    viteConfig: Schema.Boolean,
    startPlugin: Schema.Boolean,
    solidPlugin: Schema.optional(
      Schema.Literals(["vite-plugin-solid", "@solidjs/vite-plugin"]),
    ),
  }),
  evidence: Schema.Array(Evidence),
  warnings: Schema.Array(Schema.String),
  incompatible: Schema.Array(Schema.String),
});

const Finding = Schema.Struct({
  rule: Schema.String,
  severity: Schema.Literals(["error", "warn"]),
  file: Schema.String,
  line: Schema.optional(Schema.Number),
  message: Schema.String,
  fix: Schema.String,
});

const Detect = Schema.Struct({
  action: Schema.optional(Schema.Literals(["detect"])).annotate({
    description: "Detect the Solid line. The default when `action` is omitted.",
  }),
  target: Schema.optional(Schema.String).annotate({
    description:
      "Project directory to read, relative to the current project or absolute. Defaults to the project root.",
  }),
});

const Audit = Schema.Struct({
  action: Schema.Literals(["audit"]).annotate({
    description: "Audit Solid source for version mixing and known mistakes.",
  }),
  target: Schema.optional(Schema.String).annotate({
    description:
      "Project directory to read, relative to the current project or absolute. Defaults to the project root.",
  }),
  rule: Schema.optional(Schema.String).annotate({
    description:
      "Return only findings with this rule id. The ids are the `Audit rule` lines in `references/anti-patterns.md`.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum findings to return. Default 200.",
  }),
  offset: Schema.optional(Schema.Number).annotate({
    description: "Findings to skip before the returned page starts. Default 0.",
  }),
});

export const Input = Schema.Union([Detect, Audit]);

const DetectResult = Schema.Struct({
  status: Schema.Literals(["ok"]),
  action: Schema.Literals(["detect"]),
  report: ReportSchema,
});

const AuditResult = Schema.Struct({
  status: Schema.Literals(["ok"]),
  action: Schema.Literals(["audit"]),
  report: ReportSchema,
  findings: Schema.Array(Finding),
  errors: Schema.Number.annotate({
    description: "Errors in the filtered set, not only on the returned page.",
  }),
  warnings: Schema.Number.annotate({
    description: "Warnings in the filtered set, not only on the returned page.",
  }),
  files: Schema.Number.annotate({
    description: "Source files scanned.",
  }),
  total: Schema.Number.annotate({
    description: "Findings in the filtered set, before paging.",
  }),
  truncated: Schema.Boolean,
});

const Refused = Schema.Struct({
  status: Schema.Literals(["refused"]),
  action: Schema.Literals(["detect", "audit"]),
  problems: Schema.String,
});

export const Output = Schema.Union([DetectResult, AuditResult, Refused]);

const DESCRIPTION = `Detect whether a project runs Solid 1 or Solid 2 and SolidStart, and audit JSX reactivity and API anti-patterns.
Use action "detect" to inspect package manifests, lockfiles, Vite plugins, and JSX config for version compatibility, or action "audit" to scan SolidJS source files for version-mixing bugs, broken reactivity, and rule-specific fixes.`;

export const solidjs = (directory: AbsolutePath): Tool.Info<typeof Input, typeof Output> => ({
  name: "solidjs",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, permission: "read" },
  execute: (input) =>
    Effect.promise(async () => {
      const asked = input.target ?? ".";
      const target = resolve(directory, asked);
      const stat = await Bun.file(target)
        .stat()
        .catch((cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))));

      if (stat instanceof Error) {
        return {
          output: {
            status: "refused" as const,
            action: input.action ?? "detect",
            problems: `Cannot read ${asked}: ${stat.message}`,
          },
        };
      }

      if (!stat.isDirectory()) {
        return {
          output: {
            status: "refused" as const,
            action: input.action ?? "detect",
            problems: `Not a directory: ${asked}`,
          },
        };
      }

      if (input.action !== "audit") {
        const report = await detect(target);
        return {
          output: {
            status: "ok" as const,
            action: "detect" as const,
            report,
          },
        };
      }

      const result = await audit(target);
      const filtered =
        input.rule === undefined
          ? result.findings
          : result.findings.filter((finding) => finding.rule === input.rule);
      const offset = Math.max(0, input.offset ?? 0);
      const limit = Math.max(1, input.limit ?? 200);
      const findings = filtered.slice(offset, offset + limit);

      return {
        output: {
          status: "ok" as const,
          action: "audit" as const,
          report: result.report,
          findings,
          errors: filtered.filter((finding) => finding.severity === "error").length,
          warnings: filtered.filter((finding) => finding.severity === "warn").length,
          files: result.files,
          total: filtered.length,
          truncated: offset + findings.length < filtered.length,
        },
      };
    }),
});
