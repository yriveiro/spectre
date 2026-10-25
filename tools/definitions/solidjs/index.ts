import { resolve } from "node:path";
import type { AbsolutePath } from "@opencode/schema/schema";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { audit } from "./audit";
import { detect } from "./detect";

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

const DESCRIPTION = `Detect the Solid line a project runs, then audit the API it uses.

  await tools.spectre.solidjs({})                              // detect, the default
  await tools.spectre.solidjs({ action: "detect", target: "." })
  await tools.spectre.solidjs({ action: "audit", target: "." })
  await tools.spectre.solidjs({ action: "audit", rule: "v2-effect-arity" })

## Detect answers the version gate

\`mode\` is \`solid-1\`, \`solid-2\`, \`mixed\`, or \`unknown\`. Solid 2 is a release
candidate, so \`solid-2\` also sets \`solid.prerelease\`. \`framework\` separates
SolidStart 1 from SolidStart 2, and both run on Solid 1. A stable
\`@solidjs/start\` 2.x plus a Solid 2 core is \`compatible: false\`, because
SolidStart does not support Solid 2. \`unknown\` means the inputs did not decide;
ask which version is installed rather than guessing from a filename.

Read \`evidence\` when a row surprises you. Every mode is derived from a manifest,
a lockfile, a config, or an import, and the evidence names which one.

## Audit names the mistake and the fix

\`audit\` reads source text, masks comments, and reports a rule, a file, a line, a
message, and the fix. It is not a typechecker. A finding is a place to look, not
a proof that the code is wrong; the rule ids match the \`Audit rule\` lines in
\`references/anti-patterns.md\`.

\`errors\` and \`warnings\` count the whole filtered set, while \`findings\` is only
the page named by \`offset\` and \`limit\`. \`truncated\` is true when the page is
not the whole set.

A \`target\` that is not a directory comes back as \`status: "refused"\` with the
reason, never as an empty clean audit.`;

export const solidjs = (directory: AbsolutePath): Tool.Info<typeof Input, typeof Output> => ({
  name: "solidjs",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "read" },
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
