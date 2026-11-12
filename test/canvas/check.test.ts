import { describe, expect, test } from "bun:test";
import {
  bytesOf,
  deadAnchors,
  externalLoads,
  hasDoctype,
  outboundLinks,
  titleOf,
  unsafeLinks,
} from "../../tools/definitions/canvas/check";

describe("externalLoads", () => {
  test("a CDN script is external", () => {
    expect(externalLoads('<script src="https://cdn.example.com/x.js"></script>', {})).toEqual([
      { target: "https://cdn.example.com/x.js", kind: "remote" },
    ]);
  });

  test("the d3 bundle is allowed when the file map holds it", () => {
    const files = { "index.html": "", "vendor/d3.min.js": "/* d3 */" };
    expect(externalLoads('<script src="vendor/d3.min.js"></script>', files)).toEqual([]);
    expect(externalLoads('<script src="./vendor/d3.min.js"></script>', files)).toEqual([]);
  });

  test("a relative load with no file in the artifact is external", () => {
    expect(externalLoads('<img src="img/logo.png">', { "index.html": "" })).toEqual([
      { target: "img/logo.png", kind: "missing" },
    ]);
  });

  test("a data: image and an in-page fragment are local", () => {
    expect(externalLoads('<img src="data:image/png;base64,AAAA">', {})).toEqual([]);
    expect(externalLoads('<iframe src="#frame"></iframe>', {})).toEqual([]);
  });

  test("a CSS url(https://…) is external", () => {
    expect(
      externalLoads("<style>body { background: url(https://x.test/a.png) }</style>", {}),
    ).toEqual([{ target: "https://x.test/a.png", kind: "remote" }]);
  });

  test("a stylesheet link loads; a canonical link does not", () => {
    expect(externalLoads('<link rel="stylesheet" href="https://x.test/a.css">', {})).toEqual([
      { target: "https://x.test/a.css", kind: "remote" },
    ]);
    expect(externalLoads('<link rel="canonical" href="https://x.test/a">', {})).toEqual([]);
  });
});

describe("link scans", () => {
  test("a javascript: link is unsafe", () => {
    expect(unsafeLinks('<a href="javascript:alert(1)">x</a>')).toEqual(["javascript:alert(1)"]);
    expect(unsafeLinks('<a href="JaVaScRiPt:alert(1)">x</a>')).toEqual(["JaVaScRiPt:alert(1)"]);
    expect(unsafeLinks('<a href="vbscript:msgbox(1)">x</a>')).toEqual(["vbscript:msgbox(1)"]);
    expect(unsafeLinks('<a href="data:text/html,<script>x</script>">x</a>')).toEqual([
      "data:text/html,<script>x</script>",
    ]);
  });

  test("a dead anchor is found and a resolved one is not", () => {
    expect(deadAnchors('<a href="#missing">x</a><p id="there"></p>')).toEqual(["missing"]);
    expect(deadAnchors('<a href="#there">x</a><p id="there"></p>')).toEqual([]);
  });

  test("a scheme and a root-absolute path are outbound; a fragment is not", () => {
    expect(
      outboundLinks(
        '<a href="https://x.test">x</a><a href="/local">y</a><a href="#a">z</a><a href="page.html">w</a>',
      ),
    ).toEqual(["https://x.test", "/local"]);
  });
});

describe("document facts", () => {
  test("bytesOf counts UTF-8 bytes across the file map", () => {
    expect(bytesOf({ "a.html": "é" })).toBe(2);
    expect(bytesOf({ "a.html": "ab", "b.html": "c" })).toBe(3);
    expect(bytesOf({})).toBe(0);
  });

  test("titleOf collapses whitespace and reports an absent title", () => {
    expect(titleOf("<title> A   b </title>")).toBe("A b");
    expect(titleOf("<html></html>")).toBeUndefined();
  });

  test("hasDoctype only accepts a document that starts with one", () => {
    expect(hasDoctype("<!doctype html><html></html>")).toBe(true);
    expect(hasDoctype("<!DOCTYPE html>")).toBe(true);
    expect(hasDoctype("<html></html>")).toBe(false);
  });
});
