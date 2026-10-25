/**
 * Detect which Solid line a project runs before any code is written.
 *
 * Solid has two APIs that look alike and do not mix: stable `solid-js` 1.x and
 * the 2.0 release candidate. SolidStart adds a third axis, because the stable
 * `@solidjs/start` 2.x still peers on `solid-js` 1.x. A wrong guess produces code
 * that reads correctly and fails at the compiler or, worse, at hydration.
 *
 * The detector is deliberately conservative. It reports what it found and why,
 * and it says `unknown` rather than guessing from a filename.
 *
 * The `solidjs` tool is the agent surface; the tests call this function directly.
 */

import { join, relative } from "node:path";

export type Line = "1" | "2" | "unknown";
export type Mode = "solid-1" | "solid-2" | "mixed" | "unknown";
export type Framework = "solidstart-1" | "solidstart-2" | "none";

export interface Evidence {
  readonly file: string;
  readonly line?: number;
  readonly detail: string;
}

export interface Report {
  readonly directory: string;
  readonly mode: Mode;
  readonly compatible: boolean;
  readonly framework: Framework;
  readonly solid: {
    readonly declared?: string;
    readonly resolved?: string;
    readonly line: Line;
    readonly prerelease: boolean;
  };
  readonly start?: { readonly declared?: string; readonly line: Line };
  readonly router?: { readonly declared?: string; readonly line: Line };
  readonly meta?: { readonly declared?: string; readonly line: "0" | Line };
  readonly jsxImportSource?: string;
  readonly config: {
    readonly appConfig: boolean;
    readonly viteConfig: boolean;
    readonly startPlugin: boolean;
    readonly solidPlugin?: "vite-plugin-solid" | "@solidjs/vite-plugin";
  };
  readonly evidence: ReadonlyArray<Evidence>;
  readonly warnings: ReadonlyArray<string>;
  readonly incompatible: ReadonlyArray<string>;
}

const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".output",
  ".vinxi",
  ".solid",
  "coverage",
  ".turbo",
]);

const SOURCE = "**/*.{ts,tsx,js,jsx,mts,cts}";

const lineAt = (text: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
};

const text = async (path: string): Promise<string | undefined> => {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : undefined;
};

const json = async <T>(path: string): Promise<T | undefined> => {
  const body = await text(path);
  if (body === undefined) return undefined;
  try {
    return JSON.parse(body) as T;
  } catch {
    return undefined;
  }
};

const firstVersionIn = (range: string | undefined): string | undefined => {
  if (range === undefined) return undefined;
  const alias = range.startsWith("npm:") ? range.slice(range.lastIndexOf("@") + 1) : range;
  const match = /(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?/.exec(alias);
  return match?.[0];
};

const majorOf = (range: string | undefined): Line => {
  const version = firstVersionIn(range);
  if (version === undefined) return "unknown";
  const major = version.split(".")[0];
  return major === "1" || major === "2" ? major : "unknown";
};

const isPrerelease = (version: string | undefined): boolean =>
  version !== undefined && version.includes("-");

const isOurs = (name: string): boolean =>
  name === "solid-js" ||
  name === "@solidjs/start" ||
  name === "@solidjs/router" ||
  name === "@solidjs/meta" ||
  name === "@solidjs/web" ||
  name === "@solidjs/signals";

const sourceFiles = async (directory: string): Promise<ReadonlyArray<string>> => {
  const found: Array<string> = [];
  const glob = new Bun.Glob(SOURCE);
  for await (const entry of glob.scan({ cwd: directory, onlyFiles: true })) {
    const first = entry.split("/")[0];
    if (first === undefined || SKIP.has(first)) continue;
    found.push(entry);
  }
  return found.toSorted();
};

const dependencyVersion = (
  manifest: Record<string, Record<string, string> | undefined>,
  name: string,
): string | undefined =>
  manifest.dependencies?.[name] ??
  manifest.devDependencies?.[name] ??
  manifest.peerDependencies?.[name] ??
  manifest.optionalDependencies?.[name];

const lockVersions = async (directory: string): Promise<Map<string, string>> => {
  const found = new Map<string, string>();

  const packageLock = await json<{
    packages?: Record<string, { version?: string }>;
  }>(join(directory, "package-lock.json"));
  for (const [path, value] of Object.entries(packageLock?.packages ?? {})) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(path);
    if (match?.[1] !== undefined && isOurs(match[1]) && value.version !== undefined) {
      found.set(match[1], value.version);
    }
  }

  for (const name of ["bun.lock", "pnpm-lock.yaml", "yarn.lock"]) {
    const body = await text(join(directory, name));
    if (body === undefined) continue;
    for (const dependency of ["solid-js", "@solidjs/start", "@solidjs/router", "@solidjs/meta", "@solidjs/web"]) {
      const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = new RegExp(`${escaped}@(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)`).exec(body);
      if (match?.[1] !== undefined && !found.has(dependency)) found.set(dependency, match[1]);
    }
  }

  return found;
};

interface Scan {
  readonly files: number;
  readonly v1Imports: ReadonlyArray<Evidence>;
  readonly v2Imports: ReadonlyArray<Evidence>;
  readonly v1Names: ReadonlyArray<Evidence>;
  readonly v2Names: ReadonlyArray<Evidence>;
  readonly v1Tags: ReadonlyArray<Evidence>;
  readonly v2Tags: ReadonlyArray<Evidence>;
}

const V2_NAMES = new Set([
  "onSettled",
  "createProjection",
  "createOptimistic",
  "createOptimisticStore",
  "isPending",
  "latest",
  "until",
  "refresh",
  "affects",
  "snapshot",
  "flush",
  "merge",
  "omit",
  "Errored",
  "Loading",
  "Reveal",
  "Repeat",
]);

const V1_NAMES = new Set([
  "onMount",
  "createResource",
  "batch",
  "createSelector",
  "mergeProps",
  "splitProps",
  "unwrap",
  "createMutable",
  "modifyMutable",
  "produce",
  "Index",
  "Suspense",
  "SuspenseList",
  "ErrorBoundary",
  "createComputed",
  "startTransition",
  "useTransition",
  "observable",
  "indexArray",
]);

const scanSources = async (directory: string): Promise<Scan> => {
  const v1Imports: Array<Evidence> = [];
  const v2Imports: Array<Evidence> = [];
  const v1Names: Array<Evidence> = [];
  const v2Names: Array<Evidence> = [];
  const v1Tags: Array<Evidence> = [];
  const v2Tags: Array<Evidence> = [];
  let files = 0;

  for (const entry of await sourceFiles(directory)) {
    const body = await text(join(directory, entry));
    if (body === undefined) continue;
    files += 1;

    const add = (list: Array<Evidence>, index: number, detail: string): void => {
      list.push({ file: entry, line: lineAt(body, index), detail });
    };

    for (const match of body.matchAll(/(?:from\s+|require\(\s*|import\s+)["']([^"']+)["']/g)) {
      const source = match[1];
      if (source === undefined) continue;
      if (source === "solid-js/web" || source === "solid-js/store" || source === "solid-js/h" || source === "solid-js/html" || source === "solid-js/universal") {
        add(v1Imports, match.index, `imports ${source}`);
      }
      if (source === "@solidjs/web" || source === "@solidjs/h" || source === "@solidjs/html" || source === "@solidjs/universal" || source === "@solidjs/signals") {
        add(v2Imports, match.index, `imports ${source}`);
      }
    }

    for (const match of body.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g)) {
      const names = match[1];
      const source = match[2];
      if (names === undefined || source === undefined || source !== "solid-js") continue;
      for (const raw of names.split(",")) {
        const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
        if (name === undefined || name.length === 0) continue;
        if (V2_NAMES.has(name)) add(v2Names, match.index, `imports ${name} from solid-js (2.0 only)`);
        if (V1_NAMES.has(name)) add(v1Names, match.index, `imports ${name} from solid-js (1.x only)`);
      }
    }

    for (const match of body.matchAll(/<(Loading|Errored|Reveal|Repeat)\b/g)) {
      add(v2Tags, match.index, `renders <${match[1]}> (2.0 only)`);
    }
    for (const match of body.matchAll(/<(Index|Suspense|SuspenseList|ErrorBoundary)\b/g)) {
      add(v1Tags, match.index, `renders <${match[1]}> (1.x only)`);
    }
  }

  return { files, v1Imports, v2Imports, v1Names, v2Names, v1Tags, v2Tags };
};

const jsxSource = async (directory: string): Promise<string | undefined> => {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const body = await text(join(directory, name));
    if (body === undefined) continue;
    const match = /"jsxImportSource"\s*:\s*"([^"]+)"/.exec(body);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
};

const hasFile = async (directory: string, pattern: string): Promise<boolean> => {
  const glob = new Bun.Glob(pattern);
  for await (const _ of glob.scan({ cwd: directory, onlyFiles: true })) return true;
  return false;
};

const viteText = async (directory: string): Promise<string | undefined> => {
  for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"]) {
    const body = await text(join(directory, name));
    if (body !== undefined) return body;
  }
  return undefined;
};

export const detect = async (directory: string): Promise<Report> => {
  const root = directory === "" ? "." : directory;
  const warnings: Array<string> = [];
  const manifestBody = await text(join(root, "package.json"));
  let manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  } = {};
  if (manifestBody !== undefined) {
    try {
      manifest = JSON.parse(manifestBody) as typeof manifest;
    } catch {
      warnings.push("package.json could not be parsed; the version gate is unknown.");
    }
  }

  const locks = await lockVersions(root);
  const solidRange = dependencyVersion(manifest, "solid-js");
  const startRange = dependencyVersion(manifest, "@solidjs/start");
  const routerRange = dependencyVersion(manifest, "@solidjs/router");
  const metaRange = dependencyVersion(manifest, "@solidjs/meta");
  const webRange = dependencyVersion(manifest, "@solidjs/web");
  const declaredSolid = firstVersionIn(solidRange);
  const resolvedSolid = locks.get("solid-js");
  const solidLine = majorOf(declaredSolid ?? resolvedSolid ?? solidRange);
  const startLine = majorOf(startRange);
  const routerLine = majorOf(routerRange);
  const metaMajor = firstVersionIn(metaRange)?.split(".")[0];
  const metaLine = metaMajor === "0" ? "0" : majorOf(metaRange);
  const jsx = await jsxSource(root);
  const scan = await scanSources(root);

  const appConfig = await hasFile(root, "app.config.*");
  const vite = await viteText(root);
  const startPlugin = vite !== undefined && /solidStart\s*\(/.test(vite);
  const solidPlugin = vite?.includes("@solidjs/vite-plugin")
    ? "@solidjs/vite-plugin"
    : vite?.includes("vite-plugin-solid")
      ? "vite-plugin-solid"
      : undefined;

  const evidence: Array<Evidence> = [];
  const incompatible: Array<string> = [];

  if (declaredSolid !== undefined) {
    evidence.push({
      file: "package.json",
      detail: `solid-js ${solidRange ?? ""} -> ${declaredSolid}`,
    });
  } else if (resolvedSolid !== undefined) {
    warnings.push("solid-js is not declared in package.json; the lockfile supplied the version.");
    evidence.push({ file: "lockfile", detail: `solid-js -> ${resolvedSolid}` });
  } else if (webRange !== undefined) {
    warnings.push("@solidjs/web is present without solid-js; treat the project as Solid 2 and check the manifest.");
  }

  if (startRange !== undefined) evidence.push({ file: "package.json", detail: `@solidjs/start ${startRange}` });
  if (routerRange !== undefined) evidence.push({ file: "package.json", detail: `@solidjs/router ${routerRange}` });
  if (metaRange !== undefined) evidence.push({ file: "package.json", detail: `@solidjs/meta ${metaRange}` });
  if (jsx !== undefined) evidence.push({ file: "tsconfig.json", detail: `jsxImportSource ${jsx}` });
  if (appConfig) evidence.push({ file: "app.config.*", detail: "Vinxi/SolidStart v1 configuration entry" });
  if (startPlugin) evidence.push({ file: "vite.config.*", detail: "solidStart() plugin (SolidStart v2)" });
  if (solidPlugin !== undefined) evidence.push({ file: "vite.config.*", detail: `${solidPlugin} plugin` });

  for (const hit of scan.v1Imports) evidence.push(hit);
  for (const hit of scan.v2Imports) evidence.push(hit);
  for (const hit of scan.v1Names) evidence.push(hit);
  for (const hit of scan.v2Names) evidence.push(hit);
  for (const hit of scan.v1Tags) evidence.push(hit);
  for (const hit of scan.v2Tags) evidence.push(hit);

  const sourceV1 = scan.v1Imports.length + scan.v1Names.length + scan.v1Tags.length;
  const sourceV2 = scan.v2Imports.length + scan.v2Names.length + scan.v2Tags.length;

  let line: Line = solidLine;
  if (line === "unknown" && sourceV2 > 0 && sourceV1 === 0) {
    line = "2";
    warnings.push("No solid-js version was declared; the source imports are the only evidence for Solid 2.");
  }
  if (line === "unknown" && sourceV1 > 0 && sourceV2 === 0) {
    line = "1";
    warnings.push("No solid-js version was declared; the source imports are the only evidence for Solid 1.");
  }

  if (line === "1" && sourceV2 > 0) {
    incompatible.push("Solid 1 source contains a 2.0-only import or JSX tag; it will not compile against solid-js 1.x.");
  }
  if (line === "2" && sourceV1 > 0) {
    incompatible.push("Solid 2 source contains a 1.x-only import or JSX tag; it will not compile against solid-js 2.x.");
  }
  if (sourceV1 > 0 && sourceV2 > 0) {
    incompatible.push("Source mixes Solid 1 and Solid 2 imports; pick one line and migrate the whole module.");
  }

  if (line === "2" && startRange !== undefined) {
    incompatible.push(
      `@solidjs/start ${startRange} peers on solid-js ^1.9.15; SolidStart 2.x does not run Solid 2. Install solid-js 1.9, or drop SolidStart.`,
    );
  }
  if (line === "2" && startLine === "1") {
    incompatible.push("@solidjs/start 1.x does not run Solid 2; migrate the app to SolidStart 2 or keep Solid 1.");
  }
  if (startLine === "2" && routerLine === "2") {
    incompatible.push("@solidjs/start 2.x peers on @solidjs/router <2.0.0-0; router 2 is the Solid 2 line.");
  }
  if (line === "1" && routerLine === "2") {
    incompatible.push("@solidjs/router 2.x peers on solid-js ^2.0.0-rc.17; a Solid 1 app needs router 1.x.");
  }
  if (line === "2" && routerLine === "1") {
    incompatible.push("@solidjs/router 1.x peers on solid-js ^1.8.6; a Solid 2 app needs router 2.x next.");
  }
  if (line === "1" && metaMajor === "1") {
    incompatible.push("@solidjs/meta 1.x peers on solid-js ^2.0.0-rc.0; a Solid 1 app needs @solidjs/meta 0.29.x.");
  }
  if (line === "2" && metaMajor === "0") {
    incompatible.push("@solidjs/meta 0.29.x peers on solid-js ^1.8; a Solid 2 app needs @solidjs/meta 1.x next.");
  }
  if (line === "2" && jsx === "solid-js") {
    incompatible.push('Solid 2 web projects need "jsxImportSource": "@solidjs/web"; solid-js no longer ships the JSX runtime.');
  }
  if (line === "1" && jsx === "@solidjs/web") {
    incompatible.push('Solid 1 projects use "jsxImportSource": "solid-js", or the v1 JSX runtime is missing.');
  }
  if (startLine === "2" && appConfig) {
    incompatible.push("app.config.ts is the SolidStart v1 entry; SolidStart 2 configures vite.config.ts with solidStart().");
  }
  if (startLine === "1" && startPlugin) {
    incompatible.push("solidStart() in vite.config.ts is the SolidStart v2 entry; v1 uses app.config.ts.");
  }

  let mode: Mode;
  if (line === "1") mode = "solid-1";
  else if (line === "2") mode = "solid-2";
  else if (sourceV1 > 0 || sourceV2 > 0) mode = "mixed";
  else mode = "unknown";

  if (line !== "unknown" && sourceV1 > 0 && sourceV2 > 0) mode = "mixed";

  const framework: Framework =
    startLine === "1" ? "solidstart-1" : startLine === "2" ? "solidstart-2" : "none";

  const compatible = incompatible.length === 0 && mode !== "mixed" && mode !== "unknown";
  const relativeRoot = relative(process.cwd(), root);

  return {
    directory: relativeRoot === "" ? "." : relativeRoot,
    mode,
    compatible,
    framework,
    solid: {
      declared: declaredSolid,
      resolved: resolvedSolid,
      line,
      prerelease: isPrerelease(declaredSolid ?? resolvedSolid),
    },
    ...(startRange === undefined ? {} : { start: { declared: startRange, line: startLine } }),
    ...(routerRange === undefined ? {} : { router: { declared: routerRange, line: routerLine } }),
    ...(metaRange === undefined ? {} : { meta: { declared: metaRange, line: metaLine } }),
    ...(jsx === undefined ? {} : { jsxImportSource: jsx }),
    config: { appConfig, viteConfig: vite !== undefined, startPlugin, solidPlugin },
    evidence,
    warnings,
    incompatible,
  };
};

