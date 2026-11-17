/// <reference types="node" />
/**
 * Tests for the Lumen Run rules and world generation. Run with `npm test`.
 * They exercise the simulation only (no browser), which is what keeps the game fair:
 * the vessel must always be passable, and a run must be reproducible.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game, HIT_R, MAX_INTEGRITY, STEP, autopilot, type GameEvent } from './sim.ts';
import { COL, MIN_GAP, VIEW_H, Vessel } from './world.ts';

const SEEDS = [1, 2, 3, 42, 20261116];

/** Play for a number of seconds with a steering policy, collecting every event. */
function play(game: Game, seconds: number, steer: (game: Game) => number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < seconds / STEP && !game.over; i++) {
    game.step(STEP, steer(game));
    events.push(...game.events);
    game.events.length = 0;
  }
  return events;
}

test('the vessel stays on screen and never closes completely', () => {
  for (const seed of SEEDS) {
    const vessel = new Vessel(seed);
    const length = 120_000;
    vessel.extendTo(0);
    for (let col = 0; col < length / COL; col++) {
      vessel.extendTo((col + 1) * COL);
      const top = vessel.top(col);
      const bottom = vessel.bottom(col);
      assert.ok(top > 20 && bottom < VIEW_H - 20, `seed ${seed}: wall off screen at column ${col}`);
      assert.ok(bottom - top > 4 * HIT_R, `seed ${seed}: vessel too narrow for the burr at column ${col}`);
      const open = vessel.surface(1, col) - vessel.surface(0, col);
      assert.ok(open >= MIN_GAP - 0.01, `seed ${seed}: lumen closed to ${open} at column ${col}`);
    }
  }
});

test('a run is reproducible for a given seed', () => {
  const a = new Game(7, 960);
  const b = new Game(7, 960);
  play(a, 30, autopilot);
  play(b, 30, autopilot);
  assert.equal(a.score, b.score);
  assert.equal(a.scroll, b.scroll);
  assert.equal(a.heat, b.heat);

  const other = new Game(8, 960);
  play(other, 30, autopilot);
  assert.notEqual(other.score, a.score);
});

test('grinding plaque scores points and heats the burr', () => {
  const game = new Game(3, 960);
  // Hug the upper wall as closely as is safe: every deposit there gets ground away.
  const events = play(game, 20, (g) => g.vessel.top(Math.floor(g.x / COL)) + HIT_R + 6);
  assert.ok(game.score > 0, 'no points scored');
  assert.ok(
    events.some((event) => event.type === 'grind'),
    'no plaque was ground',
  );
  assert.ok(game.stats.plaqueCleared > 0);
  assert.ok(game.cleared > 0 && game.cleared <= 1, `cleared fraction out of range: ${game.cleared}`);
});

test('touching the vessel wall costs integrity and ends the run', () => {
  const game = new Game(5, 960);
  const events = play(game, 60, () => 0);
  const injuries = events.filter((event) => event.type === 'wall').length;
  assert.equal(injuries, MAX_INTEGRITY);
  assert.equal(game.integrity, 0);
  assert.ok(game.over);
  assert.equal(events.at(-1)?.type, 'over');

  // Nothing moves once the run is over.
  const { score, scroll } = game;
  game.step(STEP, VIEW_H / 2);
  assert.deepEqual([game.score, game.scroll], [score, scroll]);
});

test('an overworked burr overheats', () => {
  const game = new Game(11, 960);
  // Plough along the lower wall without ever backing off to cool down.
  const events = play(game, 120, (g) => g.vessel.bottom(Math.floor(g.x / COL)) - HIT_R - 10);
  assert.ok(
    events.some((event) => event.type === 'overheat'),
    'the burr never overheated',
  );
  assert.ok(game.heat >= 0 && game.heat < 1);
});

test('careful play survives: the autopilot clears plaque without a single injury', () => {
  for (const seed of SEEDS) {
    for (const viewW of [432, 960, 1400]) {
      const game = new Game(seed, viewW);
      const events = play(game, 150, autopilot);
      const label = `seed ${seed}, width ${viewW}`;
      assert.ok(!game.over, `${label}: the run ended`);
      assert.equal(game.integrity, MAX_INTEGRITY, `${label}: integrity lost`);
      assert.ok(!events.some((event) => event.type === 'wall' || event.type === 'overheat'), `${label}: injured`);
      assert.ok(game.stats.sweeps > 0, `${label}: no clean sweeps`);
      assert.ok(Number.isFinite(game.score) && game.score > 0, `${label}: bad score ${game.score}`);
    }
  }
});

test('each new segment restores one point of integrity', () => {
  const game = new Game(13, 960);
  // Take one injury early on, then play carefully into the next segment.
  play(game, 1, () => 0);
  assert.equal(game.integrity, MAX_INTEGRITY - 1);
  const events = play(game, 60, autopilot);
  const segment = events.find((event) => event.type === 'segment');
  assert.ok(segment && segment.type === 'segment' && segment.healed, 'no healing segment event');
  assert.equal(game.integrity, MAX_INTEGRITY);
});
