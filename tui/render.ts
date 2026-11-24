import type { ResolvedTheme } from "@opencode/theme/tui";
import { type KeyEvent, RGBA } from "@opentui/core";
import {
  createElement,
  createTextNode,
  effect,
  insert,
  insertNode,
  type JSX,
  memo,
  setProp,
  useRenderer,
} from "@opentui/solid";
import { onCleanup } from "solid-js";

/**
 * The small render helpers the page uses.
 *
 * The terminal library gives a JSX runtime, and this file gives the three
 * things every page needs: an element builder, a text node, and a reactive
 * branch. The builder is written by hand because a page that has to be read
 * months later is easier to read when the tree it builds is visible in the
 * source.
 */

/** The resolved palette tokens the modal and its controls share. */
export type Palette = {
  readonly modalBg: RGBA;
  readonly insetBg: RGBA;
  readonly selectHoverBg: RGBA;
  readonly rowHoverBg: RGBA;
  readonly activeBg: RGBA;
  readonly activeFg: RGBA;
  readonly borderOuter: RGBA;
  readonly border: RGBA;
  readonly text: RGBA;
  readonly muted: RGBA;
  readonly faint: RGBA;
  readonly disabled: RGBA;
  readonly blue: RGBA;
  readonly teal: RGBA;
  readonly cyan: RGBA;
  readonly green: RGBA;
  readonly yellow: RGBA;
  readonly warning: RGBA;
  readonly red: RGBA;
  readonly jsonKey: RGBA;
  readonly jsonString: RGBA;
  readonly jsonNumber: RGBA;
  readonly jsonKeyword: RGBA;
  readonly jsonPunctuation: RGBA;
};

const jsonPalette = (dialogTheme: ResolvedTheme) => ({
  jsonKey: dialogTheme.syntax?.variable ?? RGBA.fromHex("#8fbcbb"),
  jsonString:
    dialogTheme.syntax?.string ??
    dialogTheme.text.feedback?.success?.base ??
    RGBA.fromHex("#a3be8c"),
  jsonNumber:
    dialogTheme.syntax?.number ??
    dialogTheme.text.feedback?.warning?.base ??
    RGBA.fromHex("#d08770"),
  jsonKeyword: dialogTheme.syntax?.keyword ?? RGBA.fromHex("#81a1c1"),
  jsonPunctuation: dialogTheme.syntax?.punctuation ?? dialogTheme.text.muted,
});

export const palette = (
  baseTheme: ResolvedTheme,
  dialogTheme: ResolvedTheme = baseTheme,
): Palette => {
  const modalBg = dialogTheme.background?.base ?? RGBA.fromHex("#353b49");
  const steppedBg =
    typeof dialogTheme.increase === "function" ? dialogTheme.increase(modalBg, 1) : undefined;
  const baseBg = baseTheme.background?.base;
  const insetBg =
    baseBg !== undefined && baseBg !== modalBg
      ? baseBg
      : steppedBg !== undefined && steppedBg !== modalBg
        ? steppedBg
        : (dialogTheme.background?.formfield?.base ?? RGBA.fromHex("#2b303b"));
  const hoverSurface =
    dialogTheme.background?.action?.primary?.hovered ??
    dialogTheme.background?.raised?.high ??
    RGBA.fromHex("#434c5e");

  return {
    modalBg,
    insetBg,
    selectHoverBg: hoverSurface,
    rowHoverBg: hoverSurface,
    activeBg:
      dialogTheme.background?.action?.primary?.focused ??
      dialogTheme.background?.raised?.max ??
      hoverSurface,
    activeFg: dialogTheme.text.action?.primary?.focused ?? dialogTheme.text.base,
    borderOuter: dialogTheme.scrollbar?.base ?? dialogTheme.border?.base ?? RGBA.fromHex("#4c566a"),
    border: dialogTheme.border?.base ?? hoverSurface,
    text: dialogTheme.text.base,
    muted: dialogTheme.text.muted,
    faint: dialogTheme.text.faint,
    disabled: dialogTheme.text.action?.primary?.disabled ?? dialogTheme.text.faint,
    blue:
      dialogTheme.syntax?.keyword ??
      dialogTheme.text.formfield?.selected ??
      RGBA.fromHex("#81a1c1"),
    teal: dialogTheme.syntax?.variable ?? dialogTheme.syntax?.type ?? RGBA.fromHex("#8fbcbb"),
    cyan:
      dialogTheme.syntax?.function ??
      dialogTheme.text.feedback?.info?.base ??
      dialogTheme.text.formfield?.focused ??
      RGBA.fromHex("#88c0d0"),
    green:
      dialogTheme.syntax?.string ??
      dialogTheme.text.feedback?.success?.base ??
      RGBA.fromHex("#a3be8c"),
    yellow:
      dialogTheme.markdown?.strong ??
      dialogTheme.text.feedback?.warning?.base ??
      RGBA.fromHex("#ebcb8b"),
    warning: dialogTheme.text.feedback?.warning?.base ?? RGBA.fromHex("#ebcb8b"),
    red:
      dialogTheme.text.feedback?.error?.base ??
      dialogTheme.text.action?.destructive?.base ??
      RGBA.fromHex("#bf616a"),
    ...jsonPalette(dialogTheme),
  };
};

export const h = (
  tag: string,
  props?: Record<string, unknown> | null,
  ...children: ReadonlyArray<unknown>
): JSX.Element => {
  const el = createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined) continue;
      if (typeof value === "function" && !key.startsWith("on")) {
        const compute = value as () => unknown;
        effect((prev) => setProp(el, key, compute(), prev));
        continue;
      }
      setProp(el, key, value);
    }
  }
  const many = children.length > 1;
  for (const child of children) {
    if (child === null || child === undefined || typeof child === "boolean") continue;
    if (typeof child === "string" || typeof child === "number") {
      insertNode(el, createTextNode(String(child)));
      continue;
    }
    insert(el, child, many ? null : undefined);
  }
  return el;
};

/** A branch that redraws when the condition changes. */
export const show = (when: () => unknown, render: () => JSX.Element): JSX.Element => {
  const cond = memo(() => Boolean(when()), true);
  return (() => (cond() ? render() : null)) as unknown as JSX.Element;
};

/** `value` without `prefix` when it starts with it, unchanged otherwise. */
export const trimPrefix = (value: string, prefix: string): string =>
  value.startsWith(prefix) ? value.slice(prefix.length) : value;

/** A selection index clamped to a list that can shrink under it, so the
 * marker, the bold row and the section below all agree on what is
 * selected. */
export const clampIndex = (at: number, count: number): number =>
  Math.min(at, Math.max(0, count - 1));

/**
 * `text` word-folded to `width` columns, at most `maxLines`, the last
 * visible line ending in an ellipsis when the fold cut anything. Exported
 * for the layout tests, which assert blades' bands as pure data: the
 * renderer's own word wrap is unbounded, and a band's height must not be.
 */
export const wrapLines = (text: string, width: number, maxLines: number): ReadonlyArray<string> => {
  const cap = Math.max(1, width);
  const lines: Array<string> = [];
  const fold = (paragraph: string): void => {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter((one) => one.length > 0)) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (candidate.length <= cap) {
        line = candidate;
        continue;
      }
      if (line !== "") lines.push(line);
      // A word longer than the fold splits hard across lines.
      let rest = word;
      while (rest.length > cap) {
        lines.push(rest.slice(0, cap));
        rest = rest.slice(cap);
      }
      line = rest;
    }
    lines.push(line);
  };
  for (const paragraph of text.split("\n")) {
    fold(paragraph);
    if (lines.length > maxLines) break;
  }
  if (lines.length <= maxLines) return lines;
  const cut = lines.slice(0, maxLines);
  const last = cut[maxLines - 1] ?? "";
  return [...cut.slice(0, -1), `${last.slice(0, Math.max(0, cap - 1))}…`];
};

/** A label in accent blue and its value in the muted text colour. */
export const field = (theme: ResolvedTheme, label: string, value: () => string): JSX.Element =>
  h(
    "text",
    { fg: theme.syntax?.keyword ?? RGBA.fromHex("#81a1c1"), truncate: true, wrapMode: "none" },
    `${label}: `,
    h("span", { style: { fg: theme.text.muted } }, value()),
  );

export const bindKeyboard = (
  fallbackRenderer:
    | {
        readonly keyInput?: {
          on: (event: "keypress", handler: (key: KeyEvent) => void) => void;
          off: (event: "keypress", handler: (key: KeyEvent) => void) => void;
        };
      }
    | undefined,
  handler: (event: KeyEvent) => void,
): void => {
  let keyInput = fallbackRenderer?.keyInput;
  try {
    const live = useRenderer();
    if (live?.keyInput) keyInput = live.keyInput;
  } catch {
    keyInput = fallbackRenderer?.keyInput;
  }
  if (!keyInput) return;
  keyInput.on("keypress", handler);
  onCleanup(() => {
    keyInput.off("keypress", handler);
  });
};
