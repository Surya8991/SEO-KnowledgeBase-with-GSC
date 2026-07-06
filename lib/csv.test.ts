/**
 * Runnable with: npx tsx --test lib/csv.test.ts
 * Uses Node's built-in test runner — no extra dependency.
 */
import { test, assert } from "vitest";
import { csvField, toCsv, parseCsv } from "./csv";

test("csvField quotes fields with special chars", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField("a,b"), '"a,b"');
  assert.equal(csvField('he said "hi"'), '"he said ""hi"""');
  assert.equal(csvField("line1\nline2"), '"line1\nline2"');
  assert.equal(csvField(null), "");
  assert.equal(csvField(["x", "y"]), "x|y");
});

test("toCsv serialises rows in column order", () => {
  const csv = toCsv(
    [{ url: "u1", title: "T,1" }, { url: "u2", title: "T2" }],
    ["url", "title"],
  );
  assert.equal(csv, 'url,title\r\nu1,"T,1"\r\nu2,T2');
});

test("parseCsv round-trips quoted commas and newlines", () => {
  const rows = [
    { url: "https://a.com", title: "Hello, World", h1: "Line1\nLine2" },
    { url: "https://b.com", title: "Plain", h1: "" },
  ];
  const csv = toCsv(rows, ["url", "title", "h1"]);
  const parsed = parseCsv(csv);
  assert.deepEqual(parsed, rows);
});

test("parseCsv handles CRLF and skips blank lines", () => {
  const parsed = parseCsv("url,title\r\nu1,A\r\n\r\nu2,B\r\n");
  assert.deepEqual(parsed, [
    { url: "u1", title: "A" },
    { url: "u2", title: "B" },
  ]);
});

test("parseCsv on empty input returns empty array", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("url,title\n"), []);
});
