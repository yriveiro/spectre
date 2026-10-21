import { describe, expect, test } from "bun:test";
import { opener } from "../../tui/index";

/**
 * The command that opens the page.
 *
 * This pins the bug a live terminal found: the layer declared no mode, so it
 * sat in the base mode, and the palette is itself a mode. The palette could
 * not reach the command, so it answered "No results found", and the page was
 * unreachable from the only two places it opens from.
 */
describe("the opener", () => {
  test("the layer is global, because the palette is itself a mode", () => {
    expect(opener(() => {}).mode).toBe("global");
  });

  test("the command is the palette's and the slash command's", () => {
    const [command] = opener(() => {}).commands;
    expect(command?.id).toBe("spectre.routing.open");
    expect(command?.title).toBe("Routing");
    expect(command?.group).toBe("Spectre");
    expect(command?.palette).toBe(true);
    expect(command?.slash?.name).toBe("routing");
  });

  test("running it opens the page", () => {
    let opened = 0;
    const [command] = opener(() => {
      opened += 1;
    }).commands;
    command?.run();
    expect(opened).toBe(1);
  });
});
