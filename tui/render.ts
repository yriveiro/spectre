import type { ResolvedTheme } from "@opencode/theme/tui";
import {
  createComponent,
  createElement,
  createTextNode,
  effect,
  insert,
  insertNode,
  type JSX,
  memo,
  setProp,
} from "@opentui/solid";

/**
 * The small render helpers the page uses.
 *
 * The terminal library gives a JSX runtime, and this file gives the three
 * things every page needs: an element builder, a text node, and a reactive
 * branch. The builder is written by hand because a page that has to be read
 * months later is easier to read when the tree it builds is visible in the
 * source.
 */

/** An element, with its props and its children. */
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

/** A label and a value, in the muted colour the theme gives for labels. */
export const field = (theme: ResolvedTheme, label: string, value: () => string): JSX.Element =>
  h(
    "text",
    { fg: theme.text.muted },
    `${label}: `,
    h("span", { style: { fg: theme.text.base } }, value()),
  );
