import { describe, expect, test } from "bun:test";
import { Schema } from "effect";

/**
 * `tools/FOR_AGENTS.md` documents the boundary the host applies to a declared schema,
 * and the JSON Schema the model is shown is not it. `runtime.ts:76` at v2.0.26 calls
 * `Schema.decodeUnknownEffect` on the declared schema; `runtime.ts:155` builds the JSON
 * Schema separately and only describes the tool.
 *
 * So these assert the two disagree, on the same `effect@4.0.0-rc.112` the plugin pins.
 * A bump that changes either side fails here rather than in a session.
 */

const shown = (schema: never) => Schema.toJsonSchemaDocument(schema).schema;
const accepts = (schema: never, value: unknown) =>
  Schema.decodeUnknownOption(schema)(value)._tag === "Some";

describe("what the model is shown", () => {
  test("Schema.URL advertises the one type it cannot accept", () => {
    expect(shown(Schema.URL as never)).toEqual({ type: "string" });
  });

  test("Schema.BigInt advertises a pattern matching the string it refuses", () => {
    const doc = shown(Schema.BigInt as never) as { type: string; pattern: string };
    expect(doc.type).toBe("string");
    expect(new RegExp(doc.pattern).test("42")).toBe(true);
  });

  test("Int and String describe themselves", () => {
    expect(shown(Schema.Int as never)).toEqual({ type: "integer" });
    expect(shown(Schema.String as never)).toEqual({ type: "string" });
  });
});

describe("what the host enforces", () => {
  test("Schema.URL takes a URL instance and refuses every JSON shape", () => {
    expect(accepts(Schema.URL as never, new URL("https://example.com"))).toBe(true);
    expect(accepts(Schema.URL as never, "https://example.com")).toBe(false);
    expect(accepts(Schema.URL as never, { href: "https://example.com" })).toBe(false);
    expect(accepts(Schema.URL as never, { path: "https://example.com" })).toBe(false);
  });

  test("Date is the same trap as URL, and a string is refused", () => {
    expect(accepts(Schema.Date as never, new Date("2026-10-10"))).toBe(true);
    expect(accepts(Schema.Date as never, "2026-10-10")).toBe(false);
  });

  test("URLSearchParams and Uint8Array refuse their advertised JSON too", () => {
    expect(accepts(Schema.URLSearchParams as never, "a=1")).toBe(false);
    expect(accepts(Schema.Uint8Array as never, [1, 2, 3])).toBe(false);
    expect(accepts(Schema.Uint8Array as never, "AQID")).toBe(false);
  });

  test("the rows FOR_AGENTS calls ok really are honoured, not ignored", () => {
    expect(accepts(Schema.Int as never, 1)).toBe(true);
    expect(accepts(Schema.Int as never, 1.5)).toBe(false);
    expect(accepts(Schema.NonEmptyString as never, "x")).toBe(true);
    expect(accepts(Schema.NonEmptyString as never, "")).toBe(false);
    expect(accepts(Schema.Natural as never, 3)).toBe(true);
    expect(accepts(Schema.Natural as never, -3)).toBe(false);
    expect(accepts(Schema.Finite as never, 1)).toBe(true);
    expect(accepts(Schema.Finite as never, Number.NaN)).toBe(false);
  });

  test("Trim transforms rather than validating, which is why execute sees other bytes", () => {
    const decoded = Schema.decodeUnknownOption(Schema.Trim)("  x  ");
    expect(decoded._tag).toBe("Some");
    expect((decoded as { value: string }).value).toBe("x");
  });
});

describe("the rule the table states", () => {
  test("a JSON payload cannot carry a Type that is an instance", () => {
    // The list FOR_AGENTS.md names, asserted rather than trusted, so a future Effect
    // release that makes one of them decodable from JSON fails here and the doc moves.
    const instances: ReadonlyArray<[string, never, unknown]> = [
      ["URL", Schema.URL as never, "https://example.com"],
      ["Date", Schema.Date as never, "2026-10-10"],
      ["BigInt", Schema.BigInt as never, "42"],
      ["URLSearchParams", Schema.URLSearchParams as never, "a=1"],
      ["Uint8Array", Schema.Uint8Array as never, "AQID"],
      ["FormData", Schema.FormData as never, []],
    ];
    const decoded = instances.filter(([, schema, value]) => accepts(schema, value));
    expect(decoded.map(([name]) => name)).toEqual([]);
  });

  test("and the primitives the plugin actually uses cross the boundary", () => {
    expect(accepts(Schema.String as never, "x")).toBe(true);
    expect(accepts(Schema.Struct({ a: Schema.String }) as never, { a: "x" })).toBe(true);
    expect(accepts(Schema.Array(Schema.String) as never, ["x"])).toBe(true);
    expect(accepts(Schema.Union([Schema.String, Schema.Number]) as never, "x")).toBe(true);
    expect(accepts(Schema.optional(Schema.String) as never, undefined)).toBe(true);
    expect(accepts(Schema.Literals(["a", "b"]) as never, "a")).toBe(true);
  });
});