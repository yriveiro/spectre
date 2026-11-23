import type { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { h, show } from "../render.ts";
import { displayName, type Usage } from "./usage.ts";

/** Rows the compact box shows before folding the rest into `+N more`. */
const COMPACT_ROWS = 5;

/**
 * The sidebar box: call counts and nothing else. Tokens do not fit in the
 * sidebar's width, and the panel is one click away for the numbers that do.
 * The whole surface opens the panel; the marker is the only part that
 * toggles the box's own collapse. It stops the same `mouseup` the header
 * listens on: opentui propagates each event instance on its own, so a
 * stopped `mousedown` guards nothing and the following `mouseup` still
 * reaches the header's open-panel handler.
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
          {
            flexDirection: "row",
            justifyContent: "space-between",
            width: "100%",
            onMouseUp: input.onOpenPanel,
          },
          h(
            "box",
            { flexDirection: "row", gap: 1, minWidth: 0, flexShrink: 1 },
            h(
              "box",
              {
                flexShrink: 0,
                onMouseUp: (event: unknown) => {
                  const mouse = event as { stopPropagation?: () => void };
                  mouse.stopPropagation?.();
                  input.onToggle();
                },
              },
              h("text", { fg: input.theme.text.base }, () => (input.open() ? "▼" : "▶")),
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
            "text",
            {
              fg: input.theme.text.muted,
              wrapMode: "none",
              flexShrink: 0,
            },
            () => `${input.usage().totals.calls} calls`,
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
                    onMouseUp: input.onOpenPanel,
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
                      { flexDirection: "row", width: "100%", onMouseUp: input.onOpenPanel },
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
