/// <reference types="node" />
/**
 * Tests for the choreography of the home page opening, where sparks from the grinding wheel
 * form the lab's name. Run with `npm test`. What matters to a visitor: every spark ends up
 * exactly on its letter, nothing is still in the air when the headline firms up, and the name
 * is written in reading order.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TIMING, planSparks, sparkPosition, type Point, type Target } from './forge.ts';

/** A small deterministic generator, so a failing test fails the same way every time. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
}

/** Three lines of letters, as the headline has: a grid of points 600 wide. */
function headline(): Target[] {
  const targets: Target[] = [];
  for (let line = 0; line < 3; line++) {
    for (let x = 40; x <= 640; x += 6) {
      for (let y = 0; y < 60; y += 12) targets.push({ x, y: 200 + line * 80 + y, line });
    }
  }
  return targets;
}

const SOURCE: Point = { x: 1040, y: 640 };
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

test('every spark lands exactly on its target, inside the landing window', () => {
  const targets = headline();
  const sparks = planSparks(targets, SOURCE, seeded(1));
  assert.equal(sparks.length, targets.length);
  const at: Point = { x: 0, y: 0 };
  sparks.forEach((spark, i) => {
    assert.ok(spark.depart >= TIMING.ignite - 1e-9, `spark ${i} leaves before the wheel ignites`);
    assert.ok(spark.arrive > spark.depart, `spark ${i} arrives before it leaves`);
    assert.ok(spark.arrive >= TIMING.firstLanding && spark.arrive <= TIMING.lastLanding, `spark ${i} lands late`);
    sparkPosition(spark, spark.arrive, at);
    assert.deepEqual([at.x, at.y], [targets[i].x, targets[i].y]);
    // It stays put afterwards, for as long as the headline takes to firm up.
    sparkPosition(spark, TIMING.end + 10, at);
    assert.deepEqual([at.x, at.y], [targets[i].x, targets[i].y]);
  });
});

test('sparks start at the wheel and travel a smooth path', () => {
  const sparks = planSparks(headline(), SOURCE, seeded(2));
  const at: Point = { x: 0, y: 0 };
  const before: Point = { x: 0, y: 0 };
  for (const spark of sparks) {
    sparkPosition(spark, spark.depart - 1, at);
    assert.ok(Math.hypot(at.x - SOURCE.x, at.y - SOURCE.y) < 8, 'a spark starts away from the wheel');
    // No jumps: between two frames a spark moves a small part of its whole journey.
    const journey = Math.hypot(spark.tx - spark.sx, spark.ty - spark.sy);
    for (let time = spark.depart; time < spark.arrive; time += 1 / 60) {
      sparkPosition(spark, time, before);
      sparkPosition(spark, time + 1 / 60, at);
      const step = Math.hypot(at.x - before.x, at.y - before.y);
      assert.ok(Number.isFinite(step) && step < journey * 0.2, `a spark jumped ${step} of ${journey}`);
    }
  }
});

test('the name is written in reading order', () => {
  const sparks = planSparks(headline(), SOURCE, seeded(3));
  const arrivals = (keep: (spark: (typeof sparks)[number]) => boolean) =>
    mean(sparks.filter(keep).map((spark) => spark.arrive));
  // Line by line...
  assert.ok(arrivals((s) => s.line === 0) < arrivals((s) => s.line === 1));
  assert.ok(arrivals((s) => s.line === 1) < arrivals((s) => s.line === 2));
  // ...and each line from left to right.
  for (let line = 0; line < 3; line++) {
    assert.ok(arrivals((s) => s.line === line && s.tx < 240) < arrivals((s) => s.line === line && s.tx > 440));
  }
  // The headline starts to firm up only as the last sparks are landing.
  assert.ok(TIMING.firm > TIMING.firstLanding && TIMING.firm <= TIMING.lastLanding);
  assert.ok(TIMING.end > TIMING.lastLanding);
});

test('the plan is the same for the same seed, and copes with nothing to write', () => {
  assert.deepEqual(planSparks(headline(), SOURCE, seeded(4)), planSparks(headline(), SOURCE, seeded(4)));
  assert.deepEqual(planSparks([], SOURCE, seeded(4)), []);
  // A single point still gets a spark that lands on it.
  const [only] = planSparks([{ x: 10, y: 20, line: 0 }], SOURCE, seeded(5));
  const at = sparkPosition(only, only.arrive, { x: 0, y: 0 });
  assert.deepEqual([at.x, at.y], [10, 20]);
});
