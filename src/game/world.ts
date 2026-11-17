/**
 * Lumen Run - the vessel.
 *
 * The world is an endless artery that scrolls past the burr. It is generated one thin column
 * at a time from a seeded random source, so a run is fully reproducible. Everything in this
 * file is plain data and maths (no DOM), which keeps it testable.
 *
 * Units: the playfield is VIEW_H units tall; every length, including x, uses the same unit.
 */

/** Logical height of the playfield. */
export const VIEW_H = 540;
/** Width of one column of vessel. */
export const COL = 4;
/** Plaque never closes the lumen completely: this much always stays open. */
export const MIN_GAP = 26;

/** Columns kept in memory (a power of two); several screens' worth. */
const RING = 1024;
const MASK = RING - 1;

/** 0 = the upper wall, 1 = the lower wall. */
export type Side = 0 | 1;

/** One lump of calcified plaque growing on a wall. */
export interface Deposit {
  id: number;
  side: Side;
  x0: number;
  x1: number;
  /** Plaque area when the deposit formed. */
  area: number;
  /** How much of that area has been ground away. */
  removed: number;
}

interface Plan {
  deposit: Deposit;
  peak: number;
  sharpness: number;
  ripple: number;
  phase: number;
}

/** Small, fast, seedable random number generator (mulberry32). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0 at the start of a run, approaching 1 as the burr travels deeper into the vessel. */
export function difficulty(x: number): number {
  return 1 - Math.exp(-Math.max(0, x) / 16000);
}

export class Vessel {
  /** Deposits that have not yet been scored, by id. */
  readonly deposits = new Map<number, Deposit>();

  private readonly centre = new Float32Array(RING);
  private readonly half = new Float32Array(RING);
  private readonly plaque: [Float32Array, Float32Array] = [new Float32Array(RING), new Float32Array(RING)];
  private readonly original: [Float32Array, Float32Array] = [new Float32Array(RING), new Float32Array(RING)];
  private readonly owner: [Int32Array, Int32Array] = [new Int32Array(RING), new Int32Array(RING)];

  private readonly rng: () => number;
  private readonly phases: [number, number, number];
  private plans: Plan[] = [];
  /** Index of the next column to generate. */
  private frontier = 0;
  private nextDepositAt = 700;
  private depositCount = 0;
  private lastSide: Side = 1;
  /** Per wall: the x from which a new deposit may start. */
  private readonly freeAt: [number, number] = [0, 0];

  constructor(seed: number) {
    this.rng = createRng(seed);
    const tau = Math.PI * 2;
    this.phases = [this.rng() * tau, this.rng() * tau, this.rng() * tau];
  }

  /** Make sure every column up to world position x exists. */
  extendTo(x: number): void {
    const last = Math.floor(x / COL);
    while (this.frontier <= last) this.generate(this.frontier++);
  }

  /** y of the upper wall in a column. */
  top(col: number): number {
    const i = col & MASK;
    return this.centre[i] - this.half[i];
  }

  /** y of the lower wall in a column. */
  bottom(col: number): number {
    const i = col & MASK;
    return this.centre[i] + this.half[i];
  }

  /** Current plaque thickness on a wall. */
  thickness(side: Side, col: number): number {
    return this.plaque[side][col & MASK];
  }

  /** Plaque thickness before any grinding. */
  originalThickness(side: Side, col: number): number {
    return this.original[side][col & MASK];
  }

  /** y of the plaque surface on a wall; the wall itself where there is no plaque. */
  surface(side: Side, col: number): number {
    return side === 0 ? this.top(col) + this.thickness(0, col) : this.bottom(col) - this.thickness(1, col);
  }

  /** Grind the plaque in one column down to the given thickness. Returns the area removed. */
  cut(side: Side, col: number, thickness: number): number {
    const i = col & MASK;
    const current = this.plaque[side][i];
    // Anything thinner than a sliver comes off completely.
    const next = thickness < 1 ? 0 : thickness;
    if (next >= current) return 0;
    this.plaque[side][i] = next;
    const area = (current - next) * COL;
    const deposit = this.deposits.get(this.owner[side][i]);
    if (deposit) deposit.removed += area;
    return area;
  }

  private generate(col: number): void {
    const x = col * COL;
    const i = col & MASK;
    const d = difficulty(x);
    const [p0, p1, p2] = this.phases;

    // The vessel winds more and narrows as the run goes on.
    const sway = 30 + 88 * d;
    const half = 142 - 40 * d + 8 * Math.sin(x / 530 + p2);
    this.centre[i] = VIEW_H / 2 + sway * (0.62 * Math.sin(x / 310 + p0) + 0.38 * Math.sin(x / 127 + p1));
    this.half[i] = half;

    if (x >= this.nextDepositAt) this.planDeposit(x, d, half);

    const thickness: [number, number] = [0, 0];
    const owners: [Deposit | undefined, Deposit | undefined] = [undefined, undefined];
    let finished = false;
    for (const plan of this.plans) {
      const { deposit } = plan;
      if (x >= deposit.x1) {
        finished = true;
        continue;
      }
      if (x < deposit.x0) continue;
      const u = (x - deposit.x0) / (deposit.x1 - deposit.x0);
      const lumps = 0.86 + 0.14 * Math.sin(u * plan.ripple + plan.phase);
      thickness[deposit.side] = plan.peak * Math.pow(Math.sin(Math.PI * u), plan.sharpness) * lumps;
      owners[deposit.side] = deposit;
    }
    if (finished) this.plans = this.plans.filter((plan) => x < plan.deposit.x1);

    // However much plaque there is, a gap always stays open.
    const room = 2 * half - MIN_GAP;
    const total = thickness[0] + thickness[1];
    const scale = total > room ? room / total : 1;

    for (const side of [0, 1] as const) {
      const value = thickness[side] * scale;
      const kept = value < 1 ? 0 : value;
      const deposit = owners[side];
      this.plaque[side][i] = kept;
      this.original[side][i] = kept;
      this.owner[side][i] = deposit && kept > 0 ? deposit.id : -1;
      if (deposit) deposit.area += kept * COL;
    }
  }

  private planDeposit(x: number, d: number, half: number): void {
    const rng = this.rng;
    const free: [boolean, boolean] = [x >= this.freeAt[0], x >= this.freeAt[1]];
    if (!free[0] && !free[1]) {
      this.nextDepositAt = Math.min(this.freeAt[0], this.freeAt[1]);
      return;
    }

    const gapToNext = (150 + 180 * rng()) * (1 - 0.45 * d);

    // A stenosis: plaque on both walls leaves only a narrow neck that has to be ground open.
    if (free[0] && free[1] && this.depositCount >= 3 && rng() < 0.1 + 0.2 * d) {
      const length = 120 + 60 * rng();
      const neck = MIN_GAP + 30 * rng();
      const share = 0.3 + 0.4 * rng();
      const total = 2 * half - neck;
      this.addDeposit(0, x, length, total * share, 2 + rng());
      this.addDeposit(1, x, length, total * (1 - share), 2 + rng());
      this.nextDepositAt = x + length + gapToNext;
      return;
    }

    // A single deposit, usually on the opposite wall to the previous one.
    const other: Side = this.lastSide === 0 ? 1 : 0;
    let side: Side = rng() < 0.7 ? other : this.lastSide;
    if (!free[side]) side = side === 0 ? 1 : 0;
    const length = 150 + 90 * rng() + 90 * d * rng();
    const peak = Math.min(34 + 28 * rng() + 46 * d * rng(), half * 0.78);
    this.addDeposit(side, x, length, peak, 0.8 + 0.8 * rng());
    this.lastSide = side;

    // Later in the run deposits start to overlap, forcing a slalom between the walls.
    const staggered = this.depositCount >= 5 && rng() < 0.4 * d;
    this.nextDepositAt = staggered ? x + length * (0.45 + 0.2 * rng()) : x + length + gapToNext;
  }

  private addDeposit(side: Side, x0: number, length: number, peak: number, sharpness: number): void {
    const deposit: Deposit = { id: this.depositCount++, side, x0, x1: x0 + length, area: 0, removed: 0 };
    this.deposits.set(deposit.id, deposit);
    this.plans.push({ deposit, peak, sharpness, ripple: 9 + 14 * this.rng(), phase: this.rng() * Math.PI * 2 });
    this.freeAt[side] = x0 + length + 40;
  }
}
