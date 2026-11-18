/**
 * The opening of the home page: sparks thrown by the grinding wheel fly across the hero and
 * settle into the letters of the lab's name, which then firms up into the real headline.
 *
 * This module is the choreography only: where each spark is at each moment. It knows nothing
 * about the page, so it can be tested without a browser. Finding the letter shapes and drawing
 * the sparks is done in components/HeroScene.astro.
 */

export interface Point {
  x: number;
  y: number;
}

/** A point inside a letter, and which line of the headline that letter is on. */
export interface Target extends Point {
  line: number;
}

export interface Spark {
  /** Where it leaves the wheel. */
  sx: number;
  sy: number;
  /** The bend of its path: the control point of a quadratic curve from source to target. */
  cx: number;
  cy: number;
  /** Where it lands. */
  tx: number;
  ty: number;
  line: number;
  /** When it leaves and when it lands, in seconds from the start of the scene. */
  depart: number;
  arrive: number;
  /** Width in pixels. */
  size: number;
  /** Phase of its shimmer once it has landed. */
  twinkle: number;
}

/** The beats of the opening, in seconds from the start of the scene. */
export const TIMING = {
  /** The wheel starts throwing sparks. */
  ignite: 0.75,
  /** The first and the last spark land. */
  firstLanding: 1.5,
  lastLanding: 2.45,
  /** The solid headline starts to fade in over the sparks. */
  firm: 2.4,
  /** The sparks have faded away. */
  end: 3.3,
} as const;

/** How far into the writing of one line the next line starts. */
const LINE_OVERLAP = 0.62;
/** Sparks bound for the same spot land within this many seconds of each other. */
const JITTER = 0.16;

/**
 * Give every target a spark. The name is written in reading order: each line from left to
 * right, the next line starting before the one above it has finished.
 */
export function planSparks(targets: readonly Target[], source: Point, rand: () => number): Spark[] {
  if (!targets.length) return [];
  let left = Infinity;
  let right = -Infinity;
  let lines = 0;
  for (const target of targets) {
    left = Math.min(left, target.x);
    right = Math.max(right, target.x);
    lines = Math.max(lines, target.line + 1);
  }
  const width = Math.max(1, right - left);
  const turns = (lines - 1) * LINE_OVERLAP + 1;
  const window = TIMING.lastLanding - TIMING.firstLanding - JITTER;

  return targets.map((target) => {
    const order = (target.line * LINE_OVERLAP + (target.x - left) / width) / turns;
    const arrive = TIMING.firstLanding + order * window + rand() * JITTER;
    const flight = Math.min(arrive - TIMING.ignite, 0.7 + rand() * 0.4);
    const sx = source.x + (rand() - 0.5) * 10;
    const sy = source.y + (rand() - 0.5) * 6;
    const dx = target.x - sx;
    const dy = target.y - sy;
    // The path arcs above the straight line, like a spark thrown up and falling into place.
    const along = 0.3 + rand() * 0.35;
    const lift = Math.hypot(dx, dy) * (0.1 + rand() * 0.3);
    return {
      sx,
      sy,
      cx: sx + dx * along,
      cy: sy + dy * along - lift,
      tx: target.x,
      ty: target.y,
      line: target.line,
      depart: arrive - flight,
      arrive,
      size: 1.4 + rand() * 0.9,
      twinkle: rand() * Math.PI * 2,
    };
  });
}

/**
 * Where a spark is at a given moment, written into `out`: still at the wheel before it
 * departs, exactly on its target once it has arrived. It leaves fast and slows as it settles.
 */
export function sparkPosition(spark: Spark, time: number, out: Point): Point {
  const progress = (time - spark.depart) / (spark.arrive - spark.depart);
  if (progress >= 1) {
    out.x = spark.tx;
    out.y = spark.ty;
    return out;
  }
  if (progress <= 0) {
    out.x = spark.sx;
    out.y = spark.sy;
    return out;
  }
  const s = 1 - (1 - progress) ** 3;
  const a = (1 - s) * (1 - s);
  const b = 2 * (1 - s) * s;
  const c = s * s;
  out.x = a * spark.sx + b * spark.cx + c * spark.tx;
  out.y = a * spark.sy + b * spark.cy + c * spark.ty;
  return out;
}
