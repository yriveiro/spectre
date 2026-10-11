/**
 * A figure with one deliberate fault: the pipe runs through the middle of the
 * plate instead of over its edge. The audit is expected to find it, so a change
 * that stops the audit noticing shows up as a failing test rather than as a
 * quiet regression in the figures built from this kit.
 */

import {
  FLOOR,
  recorder,
  settle,
  slab,
  tubeShape,
} from "../../tools/definitions/anatomy/kit/audit";
import { boxCorners, fitProjection } from "../../tools/definitions/anatomy/kit/iso-kit";

const projection = fitProjection(boxCorners({ x: 0, y: 0, w: 60, d: 60, r: 0 }, 0, 40), 400, 300);

export const R = recorder(projection, ["pipe"]);

R.put({
  name: "plate",
  piece: "base",
  at: [20, 20, 0],
  shapes: [slab({ x: 0, y: 0, w: 40, d: 40, r: 0 }, 0, 20, { name: "plate", ground: true })],
});

// The fault: this run is at z = 10, which is inside the plate's own height.
R.put({
  name: "post",
  piece: "base",
  at: [20, 20, 20],
  shapes: [slab({ x: 14, y: 14, w: 12, d: 12, r: 0 }, 20, 10, { name: "post" })],
});

// The fault: this run is at z = 10, which is inside the plate's own height.
R.route(
  "pipe",
  [
    [-5, 20, 10],
    [45, 20, 10],
  ],
  1,
  { name: "pipe", piece: "pipe", move: [0, 0, 30] },
);

void FLOOR;
void tubeShape;

settle(R);

export default { recorder: R, svg: '<svg data-spectre-anatomy="fixture"/>' };
