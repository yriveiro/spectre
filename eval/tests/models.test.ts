import { describe, expect, test } from "bun:test";
import { PINNED, ref, select } from "../models";
import type { ModelInfo } from "../opencode";

const info = (providerID: string, id: string, variants?: ReadonlyArray<string>): ModelInfo => ({
  providerID,
  id,
  variants: variants?.map((v) => ({ id: v })),
});

const free = info("opencode-go", "minimax-m3.1-flash-free", [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const catalogue: ReadonlyArray<ModelInfo> = [
  free,
  info("opencode", "minimax-m3.1-flash-free"),
  info("opencode-go", "muse-spark-1.3-contributor", ["minimal", "low", "medium", "high", "xhigh"]),
  info("opencode-go", "longcat-2.5-preview-free"),
  info("opencode", "mimo-v2.6-flash-free"),
];

describe("select", () => {
  test("the pinned model is the default and nothing else runs", () => {
    expect(select(catalogue).models.map(ref)).toEqual([
      "opencode-go/minimax-m3.1-flash-free#high",
      "opencode-go/minimax-m3.1-flash-free#low",
      "opencode-go/minimax-m3.1-flash-free#max",
      "opencode-go/minimax-m3.1-flash-free#medium",
      "opencode-go/minimax-m3.1-flash-free#xhigh",
    ]);
  });

  test("longcat is not reachable by default", () => {
    expect(select(catalogue).models.some((m) => ref(m).includes("longcat"))).toBe(false);
  });

  test("the same model on the other provider is not the one that runs", () => {
    const picked = select(catalogue).models.map(ref);
    expect(picked.every((r) => r.startsWith(PINNED))).toBe(true);
    expect(picked.some((r) => r === "opencode/minimax-m3.1-flash-free")).toBe(false);
  });

  test("a variant can be pinned to a single arm", () => {
    expect(select(catalogue, { variant: "high" }).models.map(ref)).toEqual([
      "opencode-go/minimax-m3.1-flash-free#high",
    ]);
  });

  test("a variant that does not exist is refused with the list of the ones that do", () => {
    expect(() => select(catalogue, { variant: "turbo" })).toThrow(/low, medium, high, xhigh, max/);
  });

  test("a skip drops one variant and keeps the rest", () => {
    const picked = select(catalogue, { skip: "xhigh" }).models.map(ref);
    expect(picked).toHaveLength(4);
    expect(picked.some((r) => r.includes("xhigh"))).toBe(false);
  });

  test("an override may name another model", () => {
    expect(select(catalogue, { models: "mimo" }).models.map(ref)).toEqual([
      "opencode/mimo-v2.6-flash-free",
    ]);
  });

  test("a model with no variants is one arm, named without a suffix", () => {
    expect(select(catalogue, { models: "mimo" }).models.map((m) => m.variant)).toEqual([undefined]);
  });

  test("a model that is not in the catalogue fails loudly, naming what is", () => {
    expect(() => select(catalogue, { models: "gpt-9" })).toThrow(/This session sees/);
  });

  test("the arms are ordered, so two runs compare like for like", () => {
    const once = select(catalogue).models.map(ref);
    const twice = select([...catalogue].reverse()).models.map(ref);
    expect(once).toEqual(twice);
  });
});
