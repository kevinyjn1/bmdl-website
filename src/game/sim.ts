/**
 * Lumen Run - the rules.
 *
 * A burr on a catheter is fed through the vessel. Plaque it touches is ground away for points,
 * grinding heats the burr, and touching the vessel wall or overheating costs vessel integrity.
 * The simulation is advanced in fixed time steps and is completely deterministic for a given
 * seed and input, and it knows nothing about the screen: drawing lives in render.ts.
 */
import { COL, VIEW_H, Vessel, createRng, difficulty, type Side } from './world.ts';

/** Plaque inside this radius of the burr centre is ground away. */
export const GRIND_R = 26;
/** The vessel wall is injured inside this (smaller) radius, which leaves room to shave plaque off it. */
export const HIT_R = 18;
export const MAX_INTEGRITY = 3;
export const MAX_MULTIPLIER = 9;
/** Length of one vessel segment; each new segment restores one point of integrity. */
export const SEGMENT_LENGTH = 6000;
/** Simulation step, in seconds. */
export const STEP = 1 / 120;

const BASE_SPEED = 180;
const SPEED_GAIN = 160;
/** Heat gained per unit of plaque area ground away; 1 is an overheated burr. */
const HEAT_PER_AREA = 0.00012;
const COOLING = 0.18;
/** Cooling once the burr has been clear of plaque for a moment. */
const COOLING_CLEAR = 0.36;
const POINTS_PER_AREA = 0.1;
/** Fraction of a deposit that has to be removed for a clean sweep. */
const SWEEP_FRACTION = 0.8;
const SWEEP_POINTS = 300;
const CLOT_POINTS = 150;
const COOLANT_AMOUNT = 0.4;
const SHIELD_TIME = 1.6;
const RECOIL_TIME = 0.3;

export interface Pickup {
  kind: 'clot' | 'coolant';
  x: number;
  y: number;
  radius: number;
  phase: number;
}

/** Things that happened during a step, for the screen to react to. Positions are in world units. */
export type GameEvent =
  | { type: 'grind'; x: number; y: number; side: Side; area: number }
  | { type: 'wall'; x: number; y: number; side: Side }
  | { type: 'overheat'; x: number; y: number }
  | { type: 'sweep'; x: number; y: number; points: number; multiplier: number }
  | { type: 'clot'; x: number; y: number; points: number }
  | { type: 'coolant'; x: number; y: number }
  | { type: 'segment'; segment: number; healed: boolean }
  | { type: 'over' };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export class Game {
  readonly vessel: Vessel;
  /** Filled by step(); whoever draws the game should empty it every frame. */
  readonly events: GameEvent[] = [];
  readonly pickups: Pickup[] = [];
  readonly stats = { plaqueSeen: 0, plaqueCleared: 0, clots: 0, sweeps: 0, bestMultiplier: 1 };

  /** Visible width in world units, and where in it the burr sits. */
  viewW = 960;
  burrX = 250;
  /** World x of the left edge of the view; also the distance travelled. */
  scroll = 0;
  /** Burr centre. */
  y = VIEW_H / 2;
  /** 0 (cool) to 1 (overheated). */
  heat = 0;
  /** 0 to 1: how hard the burr is working right now. */
  load = 0;
  speed = 0;
  integrity = MAX_INTEGRITY;
  /** Seconds of invulnerability left after an injury. */
  shield = 0;
  score = 0;
  multiplier = 1;
  segment = 1;
  time = 0;
  over = false;

  private pace = 1;
  private recoil = 0;
  private clearFor = 1;
  private nextPickupAt = 1300;
  private readonly rng: () => number;

  constructor(seed: number, viewW: number) {
    this.vessel = new Vessel(seed);
    this.rng = createRng(seed ^ 0x9e3779b9);
    this.resize(viewW);
    this.vessel.extendTo(this.viewW + 160);
    const col = Math.floor(this.burrX / COL);
    this.y = (this.vessel.top(col) + this.vessel.bottom(col)) / 2;
  }

  /** Adapt to a different view width (a narrow phone screen sees less of the vessel ahead). */
  resize(viewW: number): void {
    this.viewW = viewW;
    this.burrX = clamp(viewW * 0.26, 96, 250);
    this.pace = clamp(viewW / 960, 0.7, 1);
  }

  /** World x of the burr centre. */
  get x(): number {
    return this.scroll + this.burrX;
  }

  /** Fraction of the plaque passed so far that was ground away. */
  get cleared(): number {
    return this.stats.plaqueSeen > 0 ? this.stats.plaqueCleared / this.stats.plaqueSeen : 0;
  }

  /** Advance the game by dt seconds, steering the burr towards targetY. */
  step(dt: number, targetY: number): void {
    if (this.over) return;
    const vessel = this.vessel;
    this.time += dt;
    this.shield = Math.max(0, this.shield - dt);
    this.recoil = Math.max(0, this.recoil - dt);

    // Feed: the burr advances along the vessel and bogs down while it grinds hard.
    this.speed = (BASE_SPEED + SPEED_GAIN * difficulty(this.x)) * this.pace * (1 - 0.4 * this.load);
    this.scroll += this.speed * dt;
    vessel.extendTo(this.scroll + this.viewW + 160);
    this.spawnPickups();
    const x = this.x;

    // Steering: quick in open blood, slow against plaque. After hitting the wall the burr
    // springs back towards the middle of the vessel for a moment.
    if (this.recoil > 0) {
      const col = Math.floor(x / COL);
      targetY = (vessel.top(col) + vessel.bottom(col)) / 2;
    }
    const maxSpeed = this.clearFor < 0.05 ? 320 : 1400;
    this.y += clamp((targetY - this.y) * 18, -maxSpeed, maxSpeed) * dt;

    // The vessel wall: the burr cannot pass it, and touching it is an injury.
    let minY = -Infinity;
    let maxY = Infinity;
    const hitFirst = Math.floor((x - HIT_R) / COL);
    const hitLast = Math.floor((x + HIT_R) / COL);
    for (let col = hitFirst; col <= hitLast; col++) {
      const dx = (col + 0.5) * COL - x;
      const reach = Math.sqrt(Math.max(0, HIT_R * HIT_R - dx * dx));
      minY = Math.max(minY, vessel.top(col) + reach);
      maxY = Math.min(maxY, vessel.bottom(col) - reach);
    }
    if (this.y < minY) {
      this.y = minY;
      if (this.hurt({ type: 'wall', x, y: minY - HIT_R, side: 0 })) this.recoil = RECOIL_TIME;
    } else if (this.y > maxY) {
      this.y = maxY;
      if (this.hurt({ type: 'wall', x, y: maxY + HIT_R, side: 1 })) this.recoil = RECOIL_TIME;
    }
    if (this.over) return;

    // Grinding: plaque inside the burr's reach comes off.
    let ground = 0;
    const most: [number, number] = [0, 0];
    const at: [[number, number], [number, number]] = [
      [0, 0],
      [0, 0],
    ];
    const grindFirst = Math.floor((x - GRIND_R) / COL);
    const grindLast = Math.floor((x + GRIND_R) / COL);
    for (let col = grindFirst; col <= grindLast; col++) {
      const cx = (col + 0.5) * COL;
      const reach = Math.sqrt(Math.max(0, GRIND_R * GRIND_R - (cx - x) * (cx - x)));
      const upper = vessel.cut(0, col, Math.max(0, this.y - reach - vessel.top(col)));
      const lower = vessel.cut(1, col, Math.max(0, vessel.bottom(col) - (this.y + reach)));
      if (upper > most[0]) {
        most[0] = upper;
        at[0] = [cx, this.y - reach];
      }
      if (lower > most[1]) {
        most[1] = lower;
        at[1] = [cx, this.y + reach];
      }
      ground += upper + lower;
    }
    for (const side of [0, 1] as const) {
      if (most[side] > 0) this.events.push({ type: 'grind', x: at[side][0], y: at[side][1], side, area: ground });
    }

    this.clearFor = ground > 0 ? 0 : this.clearFor + dt;
    this.score += ground * POINTS_PER_AREA * this.multiplier;
    this.load += (Math.min(1, ground / dt / 9000) - this.load) * Math.min(1, dt * 12);

    // Heat: grinding warms the burr, blood flow cools it, faster once it is clear of plaque.
    this.heat += ground * HEAT_PER_AREA;
    this.heat = Math.max(0, this.heat - (this.clearFor > 0.4 ? COOLING_CLEAR : COOLING) * dt);
    if (this.heat >= 1) {
      this.heat = 0.45;
      this.hurt({ type: 'overheat', x, y: this.y });
      if (this.over) return;
    }

    this.collectPickups(x);
    this.settleDeposits(x);

    const segment = 1 + Math.floor(this.scroll / SEGMENT_LENGTH);
    if (segment > this.segment) {
      this.segment = segment;
      const healed = this.integrity < MAX_INTEGRITY;
      if (healed) this.integrity += 1;
      this.events.push({ type: 'segment', segment, healed });
    }
  }

  /** Take one point of vessel integrity, unless the burr is still shielded from the last injury. */
  private hurt(event: GameEvent): boolean {
    if (this.shield > 0) return false;
    this.integrity -= 1;
    this.multiplier = 1;
    this.shield = SHIELD_TIME;
    this.events.push(event);
    if (this.integrity <= 0) {
      this.over = true;
      this.events.push({ type: 'over' });
    }
    return true;
  }

  /** Score each deposit once the burr has passed it. */
  private settleDeposits(x: number): void {
    for (const deposit of this.vessel.deposits.values()) {
      if (deposit.x1 > x - GRIND_R - COL) continue;
      this.vessel.deposits.delete(deposit.id);
      this.stats.plaqueSeen += deposit.area;
      this.stats.plaqueCleared += deposit.removed;
      if (deposit.area <= 0 || deposit.removed < SWEEP_FRACTION * deposit.area) continue;

      const points = SWEEP_POINTS * this.multiplier;
      this.score += points;
      this.multiplier = Math.min(MAX_MULTIPLIER, this.multiplier + 1);
      this.stats.sweeps += 1;
      this.stats.bestMultiplier = Math.max(this.stats.bestMultiplier, this.multiplier);
      const col = Math.floor(x / COL);
      const wall = deposit.side === 0 ? this.vessel.top(col) + 34 : this.vessel.bottom(col) - 34;
      this.events.push({ type: 'sweep', x, y: wall, points, multiplier: this.multiplier });
    }
  }

  /** Blood clots (bonus points) and coolant (less heat) drift in the open lumen. */
  private spawnPickups(): void {
    const edge = this.scroll + this.viewW + 80;
    while (edge >= this.nextPickupAt) {
      const px = this.nextPickupAt;
      this.nextPickupAt += 520 + 620 * this.rng();
      const place = 0.2 + 0.6 * this.rng();
      const coolant = this.rng() < 0.38;
      const phase = this.rng() * Math.PI * 2;
      const col = Math.floor(px / COL);
      const low = this.vessel.surface(0, col) + 24;
      const high = this.vessel.surface(1, col) - 24;
      if (high - low < 12) continue;
      this.pickups.push({
        kind: coolant ? 'coolant' : 'clot',
        x: px,
        y: low + (high - low) * place,
        radius: coolant ? 12 : 15,
        phase,
      });
    }
  }

  private collectPickups(x: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i];
      if (pickup.x < this.scroll - 80) {
        this.pickups.splice(i, 1);
        continue;
      }
      const dx = pickup.x - x;
      const dy = pickup.y - this.y;
      const reach = GRIND_R + pickup.radius;
      if (dx * dx + dy * dy > reach * reach) continue;
      this.pickups.splice(i, 1);
      if (pickup.kind === 'clot') {
        const points = CLOT_POINTS * this.multiplier;
        this.score += points;
        this.stats.clots += 1;
        this.events.push({ type: 'clot', x: pickup.x, y: pickup.y, points });
      } else {
        this.heat = Math.max(0, this.heat - COOLANT_AMOUNT);
        this.events.push({ type: 'coolant', x: pickup.x, y: pickup.y });
      }
    }
  }
}

/**
 * Plays the game by itself: returns the y the burr should steer towards. It drives the demo
 * behind the title card and is used to test that the game stays playable.
 */
export function autopilot(game: Game): number {
  const { vessel, heat } = game;
  const x = game.x;

  // What lies just ahead: the walls, the plaque on them, and the open corridor in between.
  let wall0 = -Infinity;
  let wall1 = Infinity;
  let open0 = -Infinity;
  let open1 = Infinity;
  let plaque0 = 0;
  let plaque1 = 0;
  const first = Math.floor((x - GRIND_R) / COL);
  const last = Math.floor((x + GRIND_R + 44) / COL);
  for (let col = first; col <= last; col++) {
    wall0 = Math.max(wall0, vessel.top(col));
    wall1 = Math.min(wall1, vessel.bottom(col));
    open0 = Math.max(open0, vessel.surface(0, col));
    open1 = Math.min(open1, vessel.surface(1, col));
    plaque0 = Math.max(plaque0, vessel.thickness(0, col));
    plaque1 = Math.max(plaque1, vessel.thickness(1, col));
  }
  const middle = (open0 + open1) / 2;

  // Cool enough to work: shave the thicker deposit right down to the wall.
  if (heat < 0.5 && (plaque0 > 0 || plaque1 > 0)) {
    return plaque0 >= plaque1 ? wall0 + HIT_R + 5 : wall1 - HIT_R - 5;
  }

  // Too narrow to pass without grinding: go straight through the neck.
  if (open1 - open0 < GRIND_R * 2 + 6) return middle;

  // Otherwise stay clear of the plaque to cool down, and pick up whatever drifts by.
  let target = middle;
  for (const pickup of game.pickups) {
    const ahead = pickup.x - x;
    if (ahead > -10 && ahead < 280) {
      target = pickup.y;
      break;
    }
  }
  return clamp(target, open0 + GRIND_R + 3, open1 - GRIND_R - 3);
}
