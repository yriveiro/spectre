import type { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { h, show } from "../render.ts";
import { displayName, type Usage } from "./usage.ts";

/** Rows the compact box shows before folding the rest into `+N more`. */
const COMPACT_ROWS = 5;

/**
 * The sidebar box: call counts and nothing else. Tokens do not fit in the
 * sidebar's width, and the panel carries the numbers that do. Two things
 * here take a click and nothing else: the header's marker group toggles
 * the box's own collapse, and the `☰` beside the call count opens the
 * session panel. No handler sits inside another's subtree, so no click
 * can race a collapse into a panel open. The glyph lives in the header,
 * which renders in both the expanded and collapsed states, so the panel
 * stays reachable while the rows are folded away.
 */
export const toolsSidebar = (input: {
  readonly theme: Plugin.Context["theme"];
  readonly usage: () => Usage;
  readonly open: () => boolean;
  readonly onToggle: () => void;
  readonly onOpenPanel: () => void;
}): JSX.Element =>
  show(
    () => input.usage().tools.length > 0,
    () =>
      h(
        "box",
        { flexDirection: "column", width: "100%" },
        h(
          "box",
          { flexDirection: "row", justifyContent: "space-between", width: "100%" },
          h(
            "box",
            { flexDirection: "row", gap: 1, minWidth: 0, flexShrink: 1, onMouseUp: input.onToggle },
            h("text", { fg: input.theme.text.base, flexShrink: 0 }, () =>
              input.open() ? "▼" : "▶",
            ),
            h(
              "text",
              {
                fg: input.theme.text.base,
                attributes: TextAttributes.BOLD,
                wrapMode: "none",
                flexShrink: 0,
              },
              "Tools",
            ),
          ),
          h(
            "box",
            { flexDirection: "row", gap: 1, flexShrink: 0 },
            h(
              "text",
              { fg: input.theme.text.muted, wrapMode: "none" },
              () => `${input.usage().totals.calls} calls`,
            ),
            h(
              "text",
              {
                fg: input.theme.text.base,
                wrapMode: "none",
                flexShrink: 0,
                onMouseUp: input.onOpenPanel,
              },
              "☰",
            ),
          ),
        ),
        show(
          () => input.open(),
          () =>
            h("box", { flexDirection: "column", width: "100%" }, () => {
              const usage = input.usage();
              const rows = usage.tools.slice(0, COMPACT_ROWS);
              const rest = usage.tools.length - rows.length;
              const items = rows.map((one) =>
                h(
                  "box",
                  {
                    flexDirection: "row",
                    justifyContent: "space-between",
                    width: "100%",
                    gap: 1,
                    minWidth: 0,
                  },
                  h(
                    "text",
                    {
                      fg: input.theme.text.base,
                      wrapMode: "none",
                      truncate: true,
                      flexGrow: 1,
                      flexShrink: 1,
                      minWidth: 0,
                    },
                    displayName(one.name),
                  ),
                  h(
                    "text",
                    { fg: input.theme.text.muted, wrapMode: "none", flexShrink: 0 },
                    String(one.calls),
                  ),
                ),
              );
              return rest > 0
                ? [
                    ...items,
                    h(
                      "box",
                      { flexDirection: "row", width: "100%" },
                      h(
                        "text",
                        { fg: input.theme.text.faint, wrapMode: "none", truncate: true },
                        `+${rest} more`,
                      ),
                    ),
                  ]
                : items;
            }),
        ),
      ),
  );
