/**
 * Compile the skill's v1 and v2 examples against the pinned versions.
 *
 * This is a maintenance check, not a project check: it installs into a scratch
 * directory under the OS temp folder and never writes inside the repository.
 *
 *   bun scripts/typecheck-examples.ts
 *   bun scripts/typecheck-examples.ts --refresh   # reinstall the scratch tree
 *   bun scripts/typecheck-examples.ts --json
 *
 * Exit codes: 0 every project compiled, 1 a project failed.
 */
import { VERIFIED } from "../verified";

const skillRoot = `${import.meta.dir}/..`;
const exampleRoot = `${skillRoot}/examples`;
const scratchRoot = `${Bun.env.SPECTRE_SOLID_TYPECHECK_DIR ?? `${Bun.env.TMPDIR ?? "/tmp"}/spectre-solid-typecheck`}`;

type Project = {
  readonly name: "v1" | "v2";
  readonly source: string;
  readonly jsxImportSource: string;
  readonly dependencies: Record<string, string>;
};

const projects: readonly Project[] = [
  {
    name: "v1",
    source: `${exampleRoot}/v1`,
    jsxImportSource: "solid-js",
    dependencies: { "solid-js": VERIFIED.solid.stable },
  },
  {
    name: "v2",
    source: `${exampleRoot}/v2`,
    jsxImportSource: "@solidjs/web",
    dependencies: {
      "solid-js": VERIFIED.solid.next,
      "@solidjs/web": VERIFIED.web.next,
    },
  },
];

type Result = {
  project: Project["name"];
  ok: boolean;
  status: number;
  output: string;
};

const json = Bun.argv.includes("--json");
const refresh = Bun.argv.includes("--refresh");

const write = async (path: string, value: string): Promise<void> => {
  await Bun.write(path, value);
};

const run = async (command: string[], cwd: string): Promise<{ code: number; output: string }> => {
  const process = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { code, output: `${stdout}${stderr}`.trim() };
};

const prepare = async (project: Project): Promise<void> => {
  const directory = `${scratchRoot}/${project.name}`;
  const installed = await Bun.file(`${directory}/node_modules/typescript/package.json`).exists();

  if (refresh || !installed) {
    await write(
      `${directory}/package.json`,
      `${JSON.stringify(
        {
          private: true,
          type: "module",
          dependencies: project.dependencies,
          devDependencies: { typescript: "7.0.2" },
        },
        null,
        2,
      )}\n`,
    );
    const install = await run(["bun", "install"], directory);
    if (install.code !== 0) {
      throw new Error(`install failed in ${directory}\n${install.output}`);
    }
  }

  await write(
    `${directory}/tsconfig.json`,
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "preserve",
          jsxImportSource: project.jsxImportSource,
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          isolatedModules: true,
          verbatimModuleSyntax: true,
          noUnusedLocals: false,
          noUnusedParameters: false,
          types: [],
        },
        include: ["src/**/*.ts", "src/**/*.tsx"],
      },
      null,
      2,
    )}\n`,
  );

  const sources = new Bun.Glob("*.{ts,tsx}").scan({ cwd: project.source, absolute: true });
  for await (const source of sources) {
    const name = source.slice(source.lastIndexOf("/") + 1);
    await write(`${directory}/src/${name}`, await Bun.file(source).text());
  }
};

const check = async (project: Project): Promise<Result> => {
  const directory = `${scratchRoot}/${project.name}`;
  try {
    await prepare(project);
  } catch (error) {
    return {
      project: project.name,
      ok: false,
      status: 1,
      output: error instanceof Error ? error.message : String(error),
    };
  }

  const result = await run(["bun", "x", "tsc", "--noEmit", "-p", "tsconfig.json"], directory);
  return { project: project.name, ok: result.code === 0, status: result.code, output: result.output };
};

const results: Result[] = [];
for (const project of projects) {
  results.push(await check(project));
}

if (json) {
  console.log(JSON.stringify({ scratchRoot, results }, null, 2));
} else {
  for (const result of results) {
    const label = result.ok ? "ok" : `failed (${result.status})`;
    console.log(`${result.project}: ${label}`);
    if (!result.ok) {
      console.log(
        result.output
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n"),
      );
    }
  }
}

process.exit(results.every((result) => result.ok) ? 0 : 1);
