/** npx tsx --test lib/series.test.ts */
import { test, assert } from "vitest";
import { matchSeries, SERIES } from "./series";

const B = "https://www.edstellar.com/blog/";

test("matches each series by its slug template", () => {
  assert.equal(matchSeries(B + "web-development-training-companies")?.name, "Training Companies");
  assert.equal(matchSeries(B + "best-ai-training-companies-japan")?.name, "Training Companies");
  assert.equal(matchSeries(B + "top-ai-training-companies")?.name, "Training Companies");
  assert.equal(matchSeries(B + "director-of-finance-roles-responsibilities")?.name, "Roles & Responsibilities");
  assert.equal(matchSeries(B + "skills-in-demand-in-norway")?.name, "In-Demand Skills");
  assert.equal(matchSeries(B + "most-in-demand-skills-in-it")?.name, "In-Demand Skills");
  assert.equal(matchSeries(B + "problem-solving-activities-games-exercises")?.name, "Games & Exercises");
  assert.equal(matchSeries(B + "critical-thinking-activities-games-for-employees")?.name, "Games & Exercises");
  assert.equal(matchSeries(B + "digital-transformation-in-retail")?.name, "Digital Transformation");
  assert.equal(matchSeries(B + "japanese-work-culture")?.name, "Work Culture");
  assert.equal(matchSeries(B + "chinese-workplace-culture")?.name, "Work Culture");
});

test("the big-data-training-companies blog is a Training Companies listicle", () => {
  // It shares "big data" tokens but is a "{X} Training Companies" page - the
  // series template wins (that's the intended override).
  assert.equal(matchSeries(B + "big-data-training-companies")?.name, "Training Companies");
});

test("non-series blogs and non-blog URLs never match", () => {
  assert.equal(matchSeries(B + "how-stress-affects-employee-productivity"), null);
  assert.equal(matchSeries("https://www.edstellar.com/category/big-data-training"), null);
  assert.equal(matchSeries("https://www.edstellar.com/course/google-big-data-training"), null);
  assert.equal(matchSeries("https://www.edstellar.com/category/sales-roles-responsibilities"), null); // not /blog/
  assert.equal(matchSeries(null), null);
  assert.equal(matchSeries(""), null);
});

test("digital-transformation only matches at the slug start (prefix series)", () => {
  assert.equal(matchSeries(B + "digital-transformation-challenges-solutions")?.name, "Digital Transformation");
  // A mid-slug mention shouldn't hijack an unrelated post.
  assert.equal(matchSeries(B + "benefits-of-digital-transformation-tools"), null);
});

test("SERIES entries are well-formed", () => {
  for (const s of SERIES) {
    assert.ok(s.name.length > 0);
    assert.ok(s.pattern instanceof RegExp);
    assert.ok(s.tokens.length > 0);
  }
});
