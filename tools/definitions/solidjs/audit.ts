/**
 * Audit SolidJS source for the mistakes that survive a compiler and surface as a
 * frozen prop, a double fetch, a hydration mismatch, or a v1 API in a v2 app.
 *
 * The audit is deliberately rule-based and local: it reads source text, masks
 * comments, and reports a file and a line. It is not a typechecker and does not
 * replace one. Every rule names the anti-pattern id in
 * `references/anti-patterns.md`, so a finding sends the reader to the long form.
 */

import { join, relative } from "node:path";
import { detect, type Report } from "./detect";

export type Severity = "error" | "warn";

export interface Finding {
  readonly rule: string;
  readonly severity: Severity;
  readonly file: string;
  readonly line?: number;
  readonly message: string;
  readonly fix: string;
}

export interface Audit {
  readonly directory: string;
  readonly report: Report;
  readonly findings: ReadonlyArray<Finding>;
  readonly errors: number;
  readonly warnings: number;
  readonly files: number;
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

/** Replace comments with spaces, keeping every byte offset and newline. */
export const maskComments = (body: string): string => {
  let out = "";
  let index = 0;
  type State = "code" | "line" | "block" | "single" | "double" | "template";
  let state: State = "code";

  while (index < body.length) {
    const char = body[index] ?? "";
    const next = body[index + 1] ?? "";

    if (state === "code") {
      if (char === "/" && next === "/") {
        state = "line";
        out += "  ";
        index += 2;
        continue;
      }
      if (char === "/" && next === "*") {
        state = "block";
        out += "  ";
        index += 2;
        continue;
      }
      if (char === "'") state = "single";
      else if (char === '"') state = "double";
      else if (char === "`") state = "template";
      out += char;
      index += 1;
      continue;
    }

    if (state === "line") {
      if (char === "\n") {
        state = "code";
        out += "\n";
      } else out += " ";
      index += 1;
      continue;
    }

    if (state === "block") {
      if (char === "*" && next === "/") {
        state = "code";
        out += "  ";
        index += 2;
        continue;
      }
      out += char === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }

    out += char;
    if (char === "\\" && index + 1 < body.length) {
      out += body[index + 1] ?? "";
      index += 2;
      continue;
    }
    if (
      (state === "single" && char === "'") ||
      (state === "double" && char === '"') ||
      (state === "template" && char === "`")
    ) {
      state = "code";
    }
    index += 1;
  }

  return out;
};

const lineAt = (body: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index && i < body.length; i += 1) if (body[i] === "\n") line += 1;
  return line;
};

const topLevelArgumentCount = (body: string, open: number): number => {
  let depth = 0;
  let commas = 0;
  let index = open;
  let quote: string | undefined;

  while (index < body.length) {
    const char = body[index] ?? "";
    if (quote !== undefined) {
      if (char === "\\") index += 2;
      else {
        if (char === quote) quote = undefined;
        index += 1;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) return commas + 1;
      index += 1;
      continue;
    }
    if (char === "," && depth === 1) commas += 1;
    index += 1;
  }

  return 0;
};

const isComponentFile = (path: string): boolean => /\.(tsx|jsx)$/.test(path);

const auditFile = (path: string, body: string, report: Report, add: (finding: Finding) => void): void => {
  const masked = maskComments(body);
  const lines = masked.split("\n");
  const original = body.split("\n");
  const tsx = isComponentFile(path);
  const storeSetters = new Set<string>(["setStore"]);

  for (const match of masked.matchAll(/const\s*\[\s*\w+\s*,\s*(\w+)\s*\]\s*=\s*createStore\s*\(/g)) {
    const setter = match[1];
    if (setter !== undefined) storeSetters.add(setter);
  }

  const push = (finding: Omit<Finding, "file">): void => add({ ...finding, file: path });

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lineNumber = index + 1;
    const raw = original[index] ?? "";

    if (/\bfrom\s+["']react(?:-dom)?["']|\brequire\(\s*["']react(?:-dom)?["']/.test(line)) {
      push({
        rule: "react-import",
        severity: "error",
        line: lineNumber,
        message: "Imports React into a Solid project.",
        fix: "Delete the import. Solid components, signals, memos and effects all come from `solid-js`; there is no React runtime.",
      });
    }

    if (/\b(useState|useEffect|useMemo|useCallback|useRef|useReducer|useLayoutEffect)\s*\(/.test(line)) {
      push({
        rule: "react-hook",
        severity: "error",
        line: lineNumber,
        message: "Calls a React hook by name.",
        fix: "Use `createSignal`, `createMemo`, `createEffect`, or a plain function. Solid has no hooks and no dependency array.",
      });
    }

    if (/\bclassName\s*=|\bhtmlFor\s*=/.test(line)) {
      push({
        rule: "react-prop",
        severity: "error",
        line: lineNumber,
        message: "Uses a React DOM prop name.",
        fix: "Use `class` for `className` and `for` for `htmlFor`; Solid writes the platform attribute.",
      });
    }

    if (tsx && /\bkey\s*=\s*\{/.test(line)) {
      push({
        rule: "react-key",
        severity: "warn",
        line: lineNumber,
        message: "Uses a React `key` prop.",
        fix: "Use `<For each={items()}>` (Solid 1.9) or `<For each={items()} keyed={...}>` (Solid 2.0). Solid keys by item identity, not by a prop.",
      });
    }

    if (/\b(?:function|const)\s+[A-Z][A-Za-z0-9_$]*\s*(?:=\s*)?\(\s*\{/.test(line)) {
      push({
        rule: "props-destructured",
        severity: "error",
        line: lineNumber,
        message: "Destructures props in a component signature.",
        fix: "Keep the `props` object and read `props.name` where it is used. Destructuring reads the getter once and freezes the value.",
      });
    }

    if (/\bcreateEffect\s*\(\s*async\b/.test(line)) {
      push({
        rule: "effect-async",
        severity: "error",
        line: lineNumber,
        message: "Passes an async function to `createEffect`.",
        fix: "An async effect returns a Promise, which Solid does not await and cannot clean up. Track the input, start the request in the apply phase, and return an abort or cleanup function.",
      });
    }

    if (tsx && /<img\b/.test(line) && !/\balt\s*=/.test(line) && /\/?>/.test(line)) {
      push({
        rule: "a11y-img-alt",
        severity: "warn",
        line: lineNumber,
        message: "`<img>` has no `alt` attribute.",
        fix: 'Add `alt="..."`; use `alt=""` only when the image is decorative and the surrounding text already says the same thing.',
      });
    }

    if (/\binnerHTML\s*=/.test(line)) {
      push({
        rule: "xss-inner-html",
        severity: "warn",
        line: lineNumber,
        message: "Writes raw HTML into the DOM.",
        fix: "Render trusted JSX instead. If the HTML is unavoidable, sanitize it at the boundary and document why the value is trusted.",
      });
    }

    if (/\bas\s+any\b|:\s*any\b|<any>/.test(line)) {
      push({
        rule: "type-any",
        severity: "warn",
        line: lineNumber,
        message: "Uses `any`.",
        fix: "Name the shape with a type or a generic. `any` erases the prop and store checks that catch the reactivity mistakes this audit looks for.",
      });
    }

    if (/^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:window|document|localStorage|sessionStorage|navigator)\.|^(?:window|document|localStorage|sessionStorage|navigator)\./.test(line)) {
      push({
        rule: "ssr-browser-global",
        severity: "warn",
        line: lineNumber,
        message: "Reads a browser global at module scope.",
        fix: "Guard with `isServer`/`typeof window !== \"undefined\"`, or move the read into `onMount` (Solid 1.9) / `onSettled` (Solid 2.0), an event handler, or a ref callback.",
      });
    }

    if (tsx && /\b(Math\.random|Date\.now)\s*\(/.test(line)) {
      push({
        rule: "ssr-nondeterministic",
        severity: "warn",
        line: lineNumber,
        message: "Uses a non-deterministic value in a component file.",
        fix: "If this runs during render, the server and client produce different values and hydration mismatches. Move it to an effect, an event handler, or a server-only loader.",
      });
    }

    if (report.mode === "solid-1" && /\b(onSettled|createProjection|createOptimistic|createOptimisticStore|isPending|until|affects|snapshot|flush)\s*\(/.test(line)) {
      push({
        rule: "v2-api-in-v1",
        severity: "error",
        line: lineNumber,
        message: "Calls a Solid 2.0-only primitive in a Solid 1.x project.",
        fix: "Use the Solid 1.9 API: `onMount`, `createResource`, `batch`, or `createStore` with `produce`/`reconcile`. See `references/migration-v1-v2.md`.",
      });
    }

    if (report.mode === "solid-1" && /<(Loading|Errored|Reveal|Repeat)\b/.test(line)) {
      push({
        rule: "v2-api-in-v1",
        severity: "error",
        line: lineNumber,
        message: "Renders a Solid 2.0-only control-flow component in a Solid 1.x project.",
        fix: "Use `<Suspense>`, `<ErrorBoundary>`, `<SuspenseList>`, or `<For>` for Solid 1.9.",
      });
    }

    if (report.mode === "solid-2" && /\bfrom\s+["']solid-js\/(web|store|h|html|universal)["']/.test(line)) {
      push({
        rule: "v1-api-in-v2",
        severity: "error",
        line: lineNumber,
        message: "Imports a Solid 1.x subpath in a Solid 2.0 project.",
        fix: "Import DOM APIs from `@solidjs/web`; store APIs are exported from `solid-js` directly.",
      });
    }

    if (report.mode === "solid-2" && /<(Index|Suspense|SuspenseList|ErrorBoundary)\b/.test(line)) {
      push({
        rule: "v1-api-in-v2",
        severity: "error",
        line: lineNumber,
        message: "Renders a removed Solid 1.x component in a Solid 2.0 project.",
        fix: "Use `<For keyed={false}>`, `<Loading>`, `<Reveal>`, or `<Errored>`; `Suspense` and `ErrorBoundary` are renamed in 2.0.",
      });
    }

    const removedV1 = /\b(createResource|createSelector|createMutable|modifyMutable|onMount)\s*\(/.exec(line);
    if (report.mode === "solid-2" && removedV1 !== null) {
      push({
        rule: "v1-api-in-v2",
        severity: "error",
        line: lineNumber,
        message: `Calls \`${removedV1[1]}\`, which Solid 2.0 removed.`,
        fix: "Use an async memo or an async store under `Loading`, `createProjection` for a derived collection, and `onSettled` for once-after-settle setup. `createStore` with draft setters replaces the mutable store.",
      });
    }

    if (report.mode === "solid-2" && /\b(classList|use:|on:|attr:|bool:)\s*=/.test(line)) {
      push({
        rule: "v1-api-in-v2",
        severity: "error",
        line: lineNumber,
        message: "Uses a removed Solid 1.x JSX namespace.",
        fix: "Use `class={[...]}` or `class={{...}}`; use a `ref` directive factory for behavior; use camelCase event handlers and plain attributes.",
      });
    }

    if (report.mode === "solid-2" && /\bsetStore\s*\(\s*["']/.test(line)) {
      push({
        rule: "v2-store-path-setter",
        severity: "error",
        line: lineNumber,
        message: "Uses the Solid 1.x path form of a store setter in a Solid 2.0 project.",
        fix: "Use the draft form: `setStore((s) => { s.user.name = \"B\"; })`.",
      });
    }

    if (report.mode === "solid-2" && /\bset[A-Z][A-Za-z0-9_$]*\s*\(\s*\(?\w+\)?\s*=>\s*\w+\.\w+\.(push|pop|shift|unshift|splice|sort|reverse)\s*\(/.test(line)) {
      push({
        rule: "v2-draft-return",
        severity: "error",
        line: lineNumber,
        message: "A draft setter returns the result of a mutating array method.",
        fix: "Use a block body: `setStore((s) => { s.list.push(item); })`. `push` returns a number, and an expression-bodied callback returns it to the setter.",
      });
    }
  }

  if (tsx) {
    const mapIntoJsx =
      /\.map\s*\(\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:\(\s*)?(?:<[A-Za-z]|\{[^}]*?\breturn\s*<[A-Za-z])/gs;
    for (const match of masked.matchAll(mapIntoJsx)) {
      push({
        rule: "react-map",
        severity: "warn",
        line: lineAt(masked, match.index ?? 0),
        message: "Maps an array into JSX with `.map()`.",
        fix: "Use `<For each={items()}>{(item) => ...}</For>` (or `<Index>` in Solid 1.9 when the shape is stable). `.map()` recreates every node on every change.",
      });
    }
  }

  if (report.mode !== "solid-1") {
    for (const match of masked.matchAll(/\bcreateEffect\s*\(/g)) {
      const open = (match.index ?? 0) + match[0].length - 1;
      if (topLevelArgumentCount(masked, open) !== 1) continue;
      const line = lineAt(masked, match.index ?? 0);
      const known = report.mode === "solid-2";
      push({
        rule: "v2-effect-arity",
        severity: known ? "error" : "warn",
        line,
        message: known
          ? "Solid 2.0 `createEffect` requires a compute function and an apply function."
          : "A one-argument `createEffect` is the Solid 1.9 form. Confirm the project is on Solid 1.9 before keeping it.",
        fix: known
          ? "Split it: `createEffect(() => input(), (value) => { sideEffect(value); return cleanup; })`."
          : "If this is Solid 2.0, split it into compute and apply phases. If it is Solid 1.9, leave it.",
      });
    }
  }

  if (report.mode === "solid-2") {
    for (const setter of storeSetters) {
      const pattern = new RegExp(`\\b${setter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(\\s*["']`, "g");
      for (const match of masked.matchAll(pattern)) {
        push({
          rule: "v2-store-path-setter",
          severity: "error",
          line: lineAt(masked, match.index ?? 0),
          message: "A store setter takes path strings in a Solid 2.0 project.",
          fix: "Use the draft form; path-string setters were removed in 2.0.",
        });
      }
    }
  }
};

const startRules = (report: Report, add: (finding: Finding) => void): void => {
  for (const problem of report.incompatible) {
    add({
      rule: "version-mixing",
      severity: "error",
      file: "package.json",
      message: problem,
      fix: "Make the dependency matrix coherent before changing source. `references/version-gate.md` holds the supported combinations.",
    });
  }
};

export const audit = async (directory: string): Promise<Audit> => {
  const root = directory === "" ? "." : directory;
  const report = await detect(root);
  const findings: Array<Finding> = [];
  const add = (finding: Finding): void => {
    findings.push(finding);
  };

  startRules(report, add);

  let files = 0;
  const glob = new Bun.Glob(SOURCE);

  for await (const entry of glob.scan({ cwd: root, onlyFiles: true })) {
    const first = entry.split("/")[0];
    if (first === undefined || SKIP.has(first)) continue;
    const body = await Bun.file(join(root, entry)).text();
    files += 1;
    auditFile(relative(root, join(root, entry)), body, report, add);
  }

  const unique = new Map<string, Finding>();
  for (const finding of findings) {
    unique.set(`${finding.rule}\u0000${finding.file}\u0000${finding.line ?? "-"}`, finding);
  }

  const ordered = [...unique.values()].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.rule.localeCompare(b.rule),
  );

  return {
    directory: report.directory,
    report,
    findings: ordered,
    errors: ordered.filter((finding) => finding.severity === "error").length,
    warnings: ordered.filter((finding) => finding.severity === "warn").length,
    files,
  };
};

