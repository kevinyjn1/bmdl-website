/**
 * Lumen Run - the picture.
 *
 * Draws the state of a Game onto a 2D canvas and owns everything that is purely visual:
 * sparks, debris, floating score labels, blood cells, screen shake. Nothing here affects play.
 */
import { GRIND_R, type Game, type GameEvent } from './sim.ts';
import { COL, VIEW_H, type Side } from './world.ts';

const TAU = Math.PI * 2;
const MONO = '"JetBrains Mono Variable", ui-monospace, "SF Mono", Menlo, monospace';
const WALL = '255, 122, 107';
const PLAQUE = '233, 223, 201';
const MAX_SPARKS = 320;
const MAX_DEBRIS = 160;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  span: number;
}

/** A speck of plaque dust, or of whatever was just picked up. */
interface Mote extends Spark {
  colour: string;
}

interface Label {
  x: number;
  y: number;
  text: string;
  colour: string;
  size: number;
  life: number;
}

interface Cell {
  x: number;
  lane: number;
  drift: number;
  size: number;
  phase: number;
}

/** Burr colour: maize when cool, through orange to red as it overheats. */
function heatColour(heat: number, alpha = 1): string {
  const t = Math.min(1, Math.max(0, heat));
  const stops: [number, number, number][] = [
    [255, 203, 5],
    [255, 138, 31],
    [255, 64, 48],
  ];
  const from = t < 0.6 ? stops[0] : stops[1];
  const to = t < 0.6 ? stops[1] : stops[2];
  const k = t < 0.6 ? t / 0.6 : (t - 0.6) / 0.4;
  const mix = (i: 0 | 1 | 2) => Math.round(from[i] + (to[i] - from[i]) * k);
  return `rgba(${mix(0)}, ${mix(1)}, ${mix(2)}, ${alpha})`;
}

/** Stable pseudo-random fraction for a column, so plaque texture does not shimmer. */
function fleck(col: number, salt: number): number {
  let h = Math.imul(col ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** Reduced motion: no screen shake. */
  private readonly calm: boolean;
  private scale = 1;
  private viewW = 960;
  private clock = 0;
  private spin = 0;
  private shake = 0;
  private flash = 0;
  private flashColour = '255, 64, 48';
  private readonly wallFlash: [number, number] = [0, 0];
  private sparks: Spark[] = [];
  private debris: Mote[] = [];
  private labels: Label[] = [];
  private trail: { x: number; y: number }[] = [];
  private readonly cells: Cell[] = [];
  private readonly grit: { along: number; angle: number }[] = [];

  constructor(canvas: HTMLCanvasElement, calm: boolean) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.calm = calm;
    for (let i = 0; i < 44; i++) {
      this.cells.push({
        x: Math.random() * 2000,
        lane: Math.random() * 1.7 - 0.85,
        drift: 30 + Math.random() * 70,
        size: 3 + Math.random() * 3.5,
        phase: Math.random() * TAU,
      });
    }
    for (let i = 0; i < 38; i++) {
      this.grit.push({ along: Math.random() * 1.7 - 0.85, angle: Math.random() * TAU });
    }
  }

  /** Match the canvas bitmap to its size on screen. Returns the visible width in world units. */
  resize(cssWidth: number, cssHeight: number, pixelRatio: number): number {
    const canvas = this.ctx.canvas;
    canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
    canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
    this.scale = canvas.height / VIEW_H;
    this.viewW = canvas.width / this.scale;
    return this.viewW;
  }

  /** Forget all effects, for a fresh run. */
  reset(): void {
    this.sparks = [];
    this.debris = [];
    this.labels = [];
    this.trail = [];
    this.shake = 0;
    this.flash = 0;
    this.wallFlash[0] = this.wallFlash[1] = 0;
  }

  /** Turn what happened in the simulation into effects. */
  absorb(events: readonly GameEvent[], game: Game): void {
    for (const event of events) {
      switch (event.type) {
        case 'grind':
          this.spray(event.x - game.scroll, event.y, event.side, event.area, game.heat);
          break;
        case 'wall':
          this.shake = 9;
          this.flash = 1;
          this.flashColour = '255, 64, 48';
          this.wallFlash[event.side] = 1;
          this.label(
            event.x - game.scroll + 104,
            event.y + (event.side === 0 ? 52 : -52),
            'WALL INJURY',
            `rgb(${WALL})`,
            13,
          );
          break;
        case 'overheat':
          this.shake = 9;
          this.flash = 1;
          this.flashColour = '255, 138, 31';
          this.label(event.x - game.scroll + 104, event.y - 40, 'OVERHEATED', 'rgb(255, 138, 31)', 13);
          break;
        case 'sweep':
          this.label(event.x - game.scroll + 20, event.y, `CLEAN SWEEP +${event.points}`, 'rgb(255, 203, 5)', 14);
          break;
        case 'clot':
          this.label(event.x - game.scroll, event.y - 26, `CLOT +${event.points}`, 'rgb(255, 150, 138)', 13);
          this.burst(event.x - game.scroll, event.y, '224, 86, 74');
          break;
        case 'coolant':
          this.label(event.x - game.scroll, event.y - 26, 'COOLED', 'rgb(126, 214, 255)', 13);
          this.burst(event.x - game.scroll, event.y, '126, 214, 255');
          break;
        default:
          break;
      }
    }
  }

  draw(game: Game, dt: number): void {
    const ctx = this.ctx;
    const W = this.viewW;
    this.advance(game, dt);

    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const background = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    background.addColorStop(0, '#00101f');
    background.addColorStop(0.5, '#001a33');
    background.addColorStop(1, '#00101f');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, W, VIEW_H);

    ctx.save();
    if (!this.calm) {
      const amount = this.shake + game.load * 0.9;
      if (amount > 0.05) ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
    }

    const first = Math.max(0, Math.floor(game.scroll / COL) - 2);
    const last = Math.ceil((game.scroll + W) / COL) + 2;
    this.drawGrid(game, W);
    this.drawVessel(game, first, last);
    this.drawCells(game, W);
    this.drawPlaque(game, first, last);
    this.drawWalls(game, first, last);
    this.drawPickups(game);
    this.drawDebris();
    this.drawCatheter(game, W);
    this.drawBurr(game);
    this.drawSparks(game.heat);
    this.drawLabels();
    ctx.restore();

    // Fade both ends of the vessel into the dark, and flash the whole view on an injury.
    const fade = Math.min(90, W * 0.12);
    const left = ctx.createLinearGradient(0, 0, fade, 0);
    left.addColorStop(0, 'rgba(0, 16, 31, 0.9)');
    left.addColorStop(1, 'rgba(0, 16, 31, 0)');
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, fade, VIEW_H);
    const right = ctx.createLinearGradient(W - fade, 0, W, 0);
    right.addColorStop(0, 'rgba(0, 16, 31, 0)');
    right.addColorStop(1, 'rgba(0, 16, 31, 0.9)');
    ctx.fillStyle = right;
    ctx.fillRect(W - fade, 0, fade, VIEW_H);
    if (this.flash > 0.01) {
      ctx.fillStyle = `rgba(${this.flashColour}, ${this.flash * 0.2})`;
      ctx.fillRect(0, 0, W, VIEW_H);
    }
  }

  // ---- effects ----------------------------------------------------------------------------

  private advance(game: Game, dt: number): void {
    this.clock += dt;
    this.spin += dt * (22 + 34 * game.load);
    this.shake = Math.max(0, this.shake - dt * 26);
    this.flash = Math.max(0, this.flash - dt * 2.6);
    this.wallFlash[0] = Math.max(0, this.wallFlash[0] - dt * 2.2);
    this.wallFlash[1] = Math.max(0, this.wallFlash[1] - dt * 2.2);
    if (dt <= 0) return;

    // The catheter shaft follows the path the burr has taken through the vessel, and slowly
    // pulls itself straighter, the way a catheter under tension would.
    const tip = this.trail[this.trail.length - 1];
    if (!tip || game.x - tip.x > 10) this.trail.push({ x: game.x, y: game.y });
    while (this.trail.length > 2 && this.trail[1].x < game.scroll - 40) this.trail.shift();
    const ease = Math.min(1, dt * 5);
    for (let i = 1; i < this.trail.length - 1; i++) {
      const point = this.trail[i];
      point.y += ((this.trail[i - 1].y + this.trail[i + 1].y) / 2 - point.y) * ease;
    }

    for (const list of [this.sparks, this.debris]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life -= dt;
        if (p.life <= 0) {
          list[i] = list[list.length - 1];
          list.pop();
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
    for (const p of this.sparks) p.vy += 240 * dt;
    for (const p of this.debris) p.vy *= 1 - Math.min(1, dt * 3);

    for (let i = this.labels.length - 1; i >= 0; i--) {
      const label = this.labels[i];
      label.life -= dt;
      label.y -= 26 * dt;
      label.x -= game.speed * 0.35 * dt;
      if (label.life <= 0) this.labels.splice(i, 1);
    }

    const span = this.viewW + 80;
    for (const cell of this.cells) {
      cell.x -= (game.speed * 0.45 + cell.drift) * dt;
      if (cell.x < -40) cell.x += span;
      else if (cell.x > span) cell.x %= span;
    }
  }

  /** Sparks and plaque dust thrown off where the burr meets the plaque. */
  private spray(x: number, y: number, side: Side, area: number, heat: number): void {
    const away = side === 0 ? 1 : -1;
    const count = Math.min(3, 1 + Math.floor(area / 16));
    for (let i = 0; i < count && this.sparks.length < MAX_SPARKS; i++) {
      const span = 0.18 + Math.random() * 0.32;
      this.sparks.push({
        x: x + (Math.random() - 0.5) * 8,
        y,
        vx: -(140 + Math.random() * 420) * (0.7 + heat * 0.5),
        vy: away * (20 + Math.random() * 240) - 40,
        life: span,
        span,
      });
    }
    if (Math.random() < 0.5 && this.debris.length < MAX_DEBRIS) {
      const span = 0.7 + Math.random() * 0.8;
      this.debris.push({
        x,
        y,
        vx: -(90 + Math.random() * 160),
        vy: away * (10 + Math.random() * 70),
        life: span,
        span,
        colour: PLAQUE,
      });
    }
  }

  /** A small ring of particles when something is picked up. */
  private burst(x: number, y: number, colour: string): void {
    for (let i = 0; i < 14 && this.debris.length < MAX_DEBRIS; i++) {
      const angle = (i / 14) * TAU;
      const speed = 70 + Math.random() * 90;
      const span = 0.45 + Math.random() * 0.25;
      this.debris.push({
        x,
        y,
        vx: Math.cos(angle) * speed - 80,
        vy: Math.sin(angle) * speed,
        life: span,
        span,
        colour,
      });
    }
  }

  private label(x: number, y: number, text: string, colour: string, size: number): void {
    this.labels.push({
      x: Math.min(Math.max(x, 70), this.viewW - 70),
      y: Math.min(Math.max(y, 60), VIEW_H - 40),
      text,
      colour,
      size,
      life: 1.25,
    });
  }

  // ---- scene ------------------------------------------------------------------------------

  private drawGrid(game: Game, W: number): void {
    const ctx = this.ctx;
    const pitch = 48;
    const offset = (game.scroll * 0.4) % pitch;
    ctx.beginPath();
    for (let x = -offset; x <= W; x += pitch) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, VIEW_H);
    }
    for (let y = pitch * 0.25; y <= VIEW_H; y += pitch) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.stroke();
  }

  /** Add one wall (pushed outwards by `offset`) to the current path, left to right or back. */
  private trace(game: Game, side: Side, offset: number, first: number, last: number, backwards = false): void {
    const ctx = this.ctx;
    const { vessel, scroll } = game;
    for (let n = 0; n <= last - first; n++) {
      const col = backwards ? last - n : first + n;
      const y = side === 0 ? vessel.top(col) - offset : vessel.bottom(col) + offset;
      ctx.lineTo((col + 0.5) * COL - scroll, y);
    }
  }

  private drawVessel(game: Game, first: number, last: number): void {
    const ctx = this.ctx;
    // Tissue around the vessel.
    for (const side of [0, 1] as const) {
      ctx.beginPath();
      this.trace(game, side, 15, first, last);
      ctx.lineWidth = 30;
      ctx.strokeStyle = `rgba(${WALL}, 0.085)`;
      ctx.stroke();
      ctx.beginPath();
      this.trace(game, side, 31, first, last);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${WALL}, 0.22)`;
      ctx.stroke();
    }
    // The blood-filled lumen.
    ctx.beginPath();
    this.trace(game, 0, 0, first, last);
    this.trace(game, 1, 0, first, last, true);
    ctx.closePath();
    ctx.fillStyle = 'rgba(20, 66, 116, 0.42)';
    ctx.fill();
  }

  private drawCells(game: Game, W: number): void {
    const ctx = this.ctx;
    const { vessel, scroll } = game;
    ctx.fillStyle = `rgba(${WALL}, 0.2)`;
    for (const cell of this.cells) {
      if (cell.x < -10 || cell.x > W + 10) continue;
      const col = Math.max(0, Math.floor((scroll + cell.x) / COL));
      const top = vessel.top(col);
      const bottom = vessel.bottom(col);
      const y =
        (top + bottom) / 2 + cell.lane * ((bottom - top) / 2 - 14) + Math.sin(this.clock * 1.3 + cell.phase) * 5;
      ctx.beginPath();
      ctx.ellipse(cell.x, y, cell.size * 1.25, cell.size * 0.8, cell.phase, 0, TAU);
      ctx.fill();
    }
  }

  private drawPlaque(game: Game, first: number, last: number): void {
    const ctx = this.ctx;
    const { vessel, scroll } = game;
    const xOf = (col: number) => (col + 0.5) * COL - scroll;

    for (const side of [0, 1] as const) {
      const inward = side === 0 ? 1 : -1;
      const wall = (col: number) => (side === 0 ? vessel.top(col) : vessel.bottom(col));

      // The body of the plaque: everything between the wall and the plaque surface.
      ctx.beginPath();
      ctx.moveTo(xOf(first), wall(first));
      for (let col = first; col <= last; col++) ctx.lineTo(xOf(col), vessel.surface(side, col));
      this.trace(game, side, 0, first, last, true);
      ctx.closePath();
      ctx.fillStyle = `rgba(${PLAQUE}, 0.96)`;
      ctx.fill();

      // Calcified flecks, and a faint outline of what has already been ground away.
      ctx.fillStyle = 'rgba(128, 102, 58, 0.5)';
      for (let col = first; col <= last; col++) {
        const original = vessel.originalThickness(side, col);
        if (original < 8) continue;
        const depth = original * (0.12 + 0.8 * fleck(col, side));
        if (depth < vessel.thickness(side, col) - 2.5 && fleck(col, side + 2) < 0.6) {
          const size = 1.4 + fleck(col, side + 4) * 1.6;
          ctx.fillRect(xOf(col) - size / 2, wall(col) + inward * depth - size / 2, size, size);
        }
      }
      ctx.beginPath();
      let open = false;
      for (let col = first; col <= last; col++) {
        const original = vessel.originalThickness(side, col);
        if (original - vessel.thickness(side, col) > 1.5) {
          const y = wall(col) + inward * original;
          if (open) ctx.lineTo(xOf(col), y);
          else ctx.moveTo(xOf(col), y);
          open = true;
        } else open = false;
      }
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${PLAQUE}, 0.26)`;
      ctx.stroke();
      ctx.setLineDash([]);

      // A bright edge along the surface.
      ctx.beginPath();
      open = false;
      for (let col = first; col <= last; col++) {
        if (vessel.thickness(side, col) > 0) {
          if (open) ctx.lineTo(xOf(col), vessel.surface(side, col));
          else ctx.moveTo(xOf(col), vessel.surface(side, col));
          open = true;
        } else open = false;
      }
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255, 252, 242, 0.95)';
      ctx.stroke();
    }
  }

  private drawWalls(game: Game, first: number, last: number): void {
    const ctx = this.ctx;
    ctx.lineJoin = 'round';
    for (const side of [0, 1] as const) {
      ctx.beginPath();
      this.trace(game, side, 0, first, last);
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgb(${WALL})`;
      ctx.stroke();
      if (this.wallFlash[side] > 0.01) {
        ctx.lineWidth = 9;
        ctx.strokeStyle = `rgba(255, 255, 255, ${this.wallFlash[side] * 0.8})`;
        ctx.stroke();
      }
    }
  }

  private drawPickups(game: Game): void {
    const ctx = this.ctx;
    for (const pickup of game.pickups) {
      const x = pickup.x - game.scroll;
      if (x < -40 || x > this.viewW + 40) continue;
      const y = pickup.y + Math.sin(this.clock * 2.2 + pickup.phase) * 4;
      const r = pickup.radius;

      if (pickup.kind === 'clot') {
        const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 2.4);
        glow.addColorStop(0, 'rgba(224, 86, 74, 0.34)');
        glow.addColorStop(1, 'rgba(224, 86, 74, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
        for (let i = 0; i < 6; i++) {
          const angle = pickup.phase + (i / 6) * TAU + this.clock * 0.5;
          const reach = i === 0 ? 0 : r * 0.48;
          ctx.beginPath();
          ctx.arc(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach, r * (i === 0 ? 0.7 : 0.56), 0, TAU);
          ctx.fillStyle = i % 2 ? '#a3231c' : '#c9382d';
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x - r * 0.25, y - r * 0.3, r * 0.22, 0, TAU);
        ctx.fillStyle = 'rgba(255, 190, 180, 0.75)';
        ctx.fill();
      } else {
        const glow = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2.6);
        glow.addColorStop(0, 'rgba(126, 214, 255, 0.4)');
        glow.addColorStop(1, 'rgba(126, 214, 255, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2);
        // A droplet: round at the bottom, drawn to a point at the top.
        ctx.beginPath();
        ctx.moveTo(x, y - r * 1.5);
        ctx.bezierCurveTo(x + r * 0.35, y - r * 0.8, x + r, y - r * 0.25, x + r, y + r * 0.3);
        ctx.arc(x, y + r * 0.3, r, 0, Math.PI);
        ctx.bezierCurveTo(x - r, y - r * 0.25, x - r * 0.35, y - r * 0.8, x, y - r * 1.5);
        const body = ctx.createLinearGradient(x, y - r * 1.5, x, y + r * 1.3);
        body.addColorStop(0, '#e2f6ff');
        body.addColorStop(1, '#45b9f2');
        ctx.fillStyle = body;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x - r * 0.32, y + r * 0.2, r * 0.24, 0, TAU);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fill();
      }
    }
  }

  private drawDebris(): void {
    const ctx = this.ctx;
    for (const p of this.debris) {
      const alpha = Math.min(1, (p.life / p.span) * 1.4);
      ctx.fillStyle = `rgba(${p.colour}, ${alpha * 0.8})`;
      ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
    }
  }

  private drawCatheter(game: Game, W: number): void {
    const ctx = this.ctx;
    const x = game.burrX;
    const y = game.y;

    // The shaft, back along the path the burr has taken.
    if (this.trail.length > 1) {
      ctx.beginPath();
      const start = this.trail[0];
      ctx.moveTo(start.x - game.scroll, start.y);
      for (let i = 1; i < this.trail.length; i++) {
        const point = this.trail[i];
        const next = this.trail[i + 1] ?? { x: game.x, y };
        ctx.quadraticCurveTo(
          point.x - game.scroll,
          point.y,
          (point.x + next.x) / 2 - game.scroll,
          (point.y + next.y) / 2,
        );
      }
      ctx.lineTo(x - 20, y);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(0, 16, 31, 0.75)';
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#9fb3ca';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.stroke();
    }

    // The guidewire, running ahead of the burr towards the middle of the vessel.
    const ahead = Math.min(190, W - x - 30);
    if (ahead > 40) {
      const col = Math.floor((game.x + ahead) / COL);
      const centre = (game.vessel.top(col) + game.vessel.bottom(col)) / 2;
      const end = y + (centre - y) * 0.55;
      const wire = ctx.createLinearGradient(x, 0, x + ahead, 0);
      wire.addColorStop(0, 'rgba(210, 224, 240, 0.8)');
      wire.addColorStop(1, 'rgba(210, 224, 240, 0)');
      ctx.beginPath();
      ctx.moveTo(x + 22, y);
      ctx.quadraticCurveTo(x + ahead * 0.5, y, x + ahead, end);
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = wire;
      ctx.stroke();
    }
  }

  private drawBurr(game: Game): void {
    const ctx = this.ctx;
    const x = game.burrX;
    const y = game.y;
    const heat = game.heat;
    const rx = GRIND_R + 3;
    const ry = GRIND_R - 2;

    // Heat glow.
    ctx.globalCompositeOperation = 'lighter';
    const size = 62 + heat * 46 + game.load * 14;
    const glow = ctx.createRadialGradient(x, y, 6, x, y, size);
    glow.addColorStop(0, heatColour(heat, 0.16 + heat * 0.34 + game.load * 0.18));
    glow.addColorStop(1, heatColour(heat, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
    ctx.globalCompositeOperation = 'source-over';

    // After an injury the burr blinks while it is shielded.
    if (game.shield > 0 && Math.sin(this.clock * 34) > 0) ctx.globalAlpha = 0.35;

    // Collar where the shaft meets the burr.
    ctx.fillStyle = '#c9d6e6';
    ctx.fillRect(x - rx - 5, y - 4.5, 9, 9);

    // Body.
    const body = ctx.createRadialGradient(x - 6, y - 9, 2, x, y, rx);
    body.addColorStop(0, '#1c4a80');
    body.addColorStop(1, '#04162a');
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = heatColour(heat, 0.95);
    ctx.stroke();

    // Diamond grit, streaking round the burr as it spins about the catheter axis.
    const streak = 2.4 + game.load * 5;
    for (const grain of this.grit) {
      const angle = grain.angle + this.spin;
      const facing = Math.cos(angle);
      if (facing <= 0) continue;
      const gy = Math.sin(angle) * (ry - 3);
      const gx = grain.along * rx * Math.sqrt(Math.max(0, 1 - (gy / ry) * (gy / ry)));
      ctx.fillStyle = heatColour(heat, 0.25 + 0.75 * facing);
      ctx.fillRect(x + gx - 1.1, y + gy - streak / 2, 2.2, streak);
    }
    ctx.globalAlpha = 1;
  }

  private drawSparks(heat: number): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.7;
    for (const p of this.sparks) {
      const alpha = Math.min(1, (p.life / p.span) * 1.3);
      ctx.strokeStyle = heatColour(heat * 0.7, alpha);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawLabels(): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const label of this.labels) {
      ctx.globalAlpha = Math.min(1, label.life * 2.2);
      ctx.font = `700 ${label.size}px ${MONO}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 16, 31, 0.85)';
      ctx.strokeText(label.text, label.x, label.y);
      ctx.fillStyle = label.colour;
      ctx.fillText(label.text, label.x, label.y);
    }
    ctx.globalAlpha = 1;
  }
}
