import { join, resolve } from "node:path";
import type { AbsolutePath } from "@opencode/schema/schema";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { kitDirectory, runAudit } from "./run";

/**
 * Where the geometry kit lives inside the installed package.
 *
 * A figure is built by a script that imports the kit, so the path has to be the
 * real one on this machine rather than a guess: the plugin is installed under a
 * hashed cache directory that no relative path survives.
 */
const Kit = Schema.Struct({
  action: Schema.Literals(["kit"]).annotate({
    description: "Report the absolute path of the geometry kit, for a build script to import.",
  }),
});

const Check = Schema.Struct({
  action: Schema.Literals(["check"]).annotate({
    description:
      "Prove a figure's geometry: nothing passes through anything, every end lands on a mount, every crossing is drawn in true depth order.",
  }),
  file: Schema.String.annotate({
    description:
      "Absolute path, or a path relative to the project directory, of the module that builds the figure. It must record its shapes with the kit's recorder.",
  }),
  figure: Schema.optional(Schema.String).annotate({
    description:
      "The canvas slug this figure is written into. Pass it so a later present is held until the check passes.",
  }),
  only: Schema.optional(Schema.Array(Schema.String)).annotate({
    description:
      "Run only these checks. Known: clearance, apart, flight, terminals, loose, supports, depth. Omit for all of them.",
  }),
});

const Lines = Schema.Struct({
  action: Schema.Literals(["lines"]).annotate({
    description:
      "Every open line in a built page lands on a stroke, a dot or an outline. A line that stops in mid-face is a mistake a reader sees.",
  }),
  file: Schema.String.annotate({
    description: "The built page, absolute or relative to the project directory.",
  }),
});

const Input = Schema.Union([Kit, Check, Lines]);

/**
 * One struct per outcome.
 *
 * A flat struct of optionals would let a `kit` answer carry `failures`, and a
 * caller reading `status` as a string would have to remember which fields that
 * status implies. The union removes that knowledge from the caller: a field an
 * outcome cannot carry is not on its type at all.
 */
const KitOut = Schema.Struct({
  action: Schema.Literals(["kit"]),
  status: Schema.Literals(["ok"]),
  kit: Schema.String,
});

const Counts = Schema.Struct({
  tubes: Schema.Number,
  solids: Schema.Number,
  items: Schema.Number,
  states: Schema.Number,
});

const CheckOut = Schema.Struct({
  action: Schema.Literals(["check"]),
  status: Schema.Literals(["ok", "problems", "unreadable", "no recorder", "refused"]),
  passed: Schema.Boolean,
  counts: Schema.optional(Counts),
  failures: Schema.Array(Schema.String),
  notes: Schema.optional(Schema.Array(Schema.String)),
  report: Schema.optional(Schema.String),
});

const LinesOut = Schema.Struct({
  action: Schema.Literals(["lines"]),
  status: Schema.Literals(["ok", "floating ends", "unreadable"]),
  ends: Schema.optional(Schema.Number),
  floating: Schema.optional(Schema.Number),
  failures: Schema.Array(Schema.String),
  report: Schema.optional(Schema.String),
});

const Output = Schema.Union([KitOut, CheckOut, LinesOut]);

type Page = typeof Output.Type;

const DESCRIPTION = `Prove an isometric figure, or hand back the kit that draws one.

Four actions:

- \`kit\` returns the absolute path of the geometry modules. A build script imports them by that path; it is the only way to name them, because the plugin is installed under a hashed cache directory. The kit is TypeScript, so a browser page that wants the runtime half either imports the modules through a bundler or takes the finished SVG string from the build script.
- \`check\` runs the geometry audit over a figure's recorded shapes and returns every fault it finds.
- \`lines\` reads a built page and returns the line ends that land on nothing.

**What \`check\` proves**, and what it cannot:

- \`clearance\`: no pipe or cable passes through a solid it is not joined to, at rest. It keeps about one and a half radii of air.
- \`apart\` and \`flight\`: the same, with the figure exploded, at every spring frame and at every reversal. A fault that appears only halfway through opening is the one a reader catches.
- \`terminals\`: every end finishes on a mount, rather than in mid-air.
- \`loose\`: when apart, every end touches something that moved with it.
- \`supports\`: every solid reaches the ground through solids it touches.
- \`depth\`: where two parts overlap on screen, the nearer one is drawn later. The keys are measured from the geometry by ray-casting, never set by eye.

A clean result is necessary and not sufficient. The audit cannot see a seam, a tone staircase or a texture that fades in the wrong place, so a figure that passes still has to be looked at.

**What it will not do.** It reads the shapes a build script recorded, so a stand-in shape that covers less than most of the drawing silences a real interlock. Record the true shape of what you draw. An item with no shape at all is reported in \`notes\`, never counted as a pass.

The check module is imported and run in this process, so it loads the figure's own code. Run \`check\` on a script you wrote or read.`;

export const anatomy = (directory: AbsolutePath): Tool.Info<typeof Input, typeof Output> => ({
  name: "anatomy",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "read" },
  execute: (input) =>
    Effect.promise(async () => ({
      output:
        input.action === "kit"
          ? { action: "kit", status: "ok", kit: join(kitDirectory(), "index.ts") }
          : input.action === "lines"
            ? await linesIn(directory, input.file)
            : await runAudit(directory, input.file, input.only, input.figure),
    })),
});

/** Every open line in a page, and how many of them land on nothing drawn. */
const linesIn = async (directory: AbsolutePath, file: string): Promise<Page> => {
  const { drawnPoints, lineEnds } = await import("./kit/audit");
  const path = resolve(directory, file);
  let html: string;
  try {
    html = await Bun.file(path).text();
  } catch (cause) {
    return {
      action: "lines",
      status: "unreadable",
      failures: [`cannot read ${file}: ${cause instanceof Error ? cause.message : String(cause)}`],
      report: `cannot read ${file}: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  const ends = lineEnds(html);
  const drawn = drawnPoints(html);
  // A line lands on a stroke, a dot or an outline, so it floats only when
  // nothing else in the page is drawn within a pixel of its end.
  const floating = ends.filter(
    (end) =>
      !end.free &&
      !drawn.some(
        (other) =>
          other.element !== end.d &&
          Math.hypot(other.at[0] - end.at[0], other.at[1] - end.at[1]) <= 1,
      ),
  );
  return {
    action: "lines",
    status: floating.length === 0 ? "ok" : "floating ends",
    ends: ends.length,
    floating: floating.length,
    failures: floating
      .slice(0, 40)
      .map((end) => `line end at ${end.at[0]}, ${end.at[1]} lands on nothing`),
  };
};
