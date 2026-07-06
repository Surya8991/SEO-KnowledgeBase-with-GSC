/** npx tsx --test lib/thresholds.test.ts */
import { test, assert } from "vitest";
import { THRESHOLDS } from "./thresholds";

test("defaults are sane and ordered", () => {
  assert.ok(THRESHOLDS.bodyCosineMerge > THRESHOLDS.bodyCosineConsolidate);
  assert.ok(THRESHOLDS.bodyCosineMerge <= 1 && THRESHOLDS.bodyCosineConsolidate >= 0);
  assert.ok(THRESHOLDS.titleJaccardDup > 0 && THRESHOLDS.titleJaccardDup <= 1);
});

test("traffic weight is off by default (GSC intentionally not surfaced)", () => {
  assert.equal(THRESHOLDS.winner.traffic, 0);
});

test("inbound is the highest winner weight", () => {
  const { inbound, depth, urlClean } = THRESHOLDS.winner;
  assert.ok(inbound >= depth && inbound >= urlClean);
});
