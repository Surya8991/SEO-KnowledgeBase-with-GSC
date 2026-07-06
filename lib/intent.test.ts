/** npx tsx --test lib/intent.test.ts */
import { test, assert } from "vitest";
import { classifyIntent } from "./intent";

test("transactional cues win", () => {
  assert.equal(classifyIntent({ title: "Book a Demo Today" }).label, "transactional");
  assert.equal(classifyIntent({ title: "Training Management Software Pricing" }).label, "transactional");
});

test("navigational cues", () => {
  assert.equal(classifyIntent({ title: "Contact Us" }).label, "navigational");
  assert.equal(classifyIntent({ slug: "how-it-works" }).label, "navigational");
});

test("commercial cues", () => {
  assert.equal(classifyIntent({ title: "Best Leadership Training Programs" }).label, "commercial");
  assert.equal(classifyIntent({ title: "Coaching Solutions for Organizations" }).label, "commercial");
});

test("informational cues", () => {
  assert.equal(classifyIntent({ title: "How to Close a Skill Gap" }).label, "informational");
  assert.equal(classifyIntent({ title: "Skill Gap Analysis Template" }).label, "informational");
});

test("content_type fallback when no cue fires", () => {
  assert.equal(classifyIntent({ title: "Java", contentType: "course" }).label, "transactional");
  assert.equal(classifyIntent({ title: "Java", contentType: "blog" }).label, "informational");
  const r = classifyIntent({ title: "Java", contentType: "course" });
  assert.deepEqual(r.cues, ["type:course"]);
});

test("defaults to informational with no signal", () => {
  const r = classifyIntent({ title: "Xyzzy" });
  assert.equal(r.label, "informational");
  assert.deepEqual(r.cues, []);
});

test("reports which cues fired", () => {
  const r = classifyIntent({ title: "Buy the Best Course", text: "pricing" });
  assert.equal(r.label, "transactional");
  assert.ok(r.cues.includes("buy") || r.cues.includes("pricing"));
});

test("short cues match whole words only (no substring false-positives)", () => {
  // "vs" must not fire inside "TVS"; "hire" must not fire inside "hired".
  assert.notEqual(classifyIntent({ title: "TVS Motors Leadership" }).label, "commercial");
  assert.equal(classifyIntent({ title: "Java vs Python" }).label, "commercial"); // real "vs"
  // "demo" must not fire inside "democracy".
  assert.notEqual(classifyIntent({ title: "Democracy in the Workplace" }).label, "transactional");
});
