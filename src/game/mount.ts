/**
 * Lumen Run - wiring to the page.
 *
 * Connects the simulation (sim.ts) and the renderer (render.ts) to the markup in
 * components/LumenRun.astro: the frame loop, mouse, touch and keyboard input, the HUD, and the
 * title, pause and results cards.
 */
import { Renderer } from './render.ts';
import { Game, STEP, autopilot, type GameEvent } from './sim.ts';
import { VIEW_H } from './world.ts';

/** demo: the game plays itself behind the title card. */
type Mode = 'demo' | 'playing' | 'paused' | 'over';

const BEST_KEY = 'bmdl:lumen-run:best';
/** World units to millimetres for the distance readout (the vessel is drawn about 5 mm across). */
const MM_PER_UNIT = 0.02;
/** Steering speed with the keyboard, in world units per second. */
const KEY_SPEED = 460;
const DEMO_LENGTH = 70;

const RANKS: [score: number, title: string][] = [
  [0, 'Lab visitor'],
  [4_000, 'Undergraduate researcher'],
  [15_000, 'Graduate student'],
  [40_000, 'Postdoc'],
  [100_000, 'Research scientist'],
  [250_000, 'Principal investigator'],
  [500_000, 'Leaders & Best'],
];

const UP_KEYS = new Set(['ArrowUp', 'KeyW']);
const DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const number = new Intl.NumberFormat('en-US');
const newSeed = () => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    // Storage can be unavailable (private browsing); the best score then lasts for this visit only.
  }
}

export function mountLumenRun(root: HTMLElement): void {
  const part = <T extends HTMLElement = HTMLElement>(name: string): T => {
    const element = root.querySelector<T>(`[data-lr="${name}"]`);
    if (!element) throw new Error(`Lumen Run: missing element "${name}"`);
    return element;
  };

  const stage = part('stage');
  const canvas = part<HTMLCanvasElement>('canvas');
  const scoreEl = part('score');
  const multiplierEl = part('multiplier');
  const heatBox = part('heat-box');
  const pips = Array.from(part('pips').children) as HTMLElement[];
  const distanceEl = part('distance');
  const banner = part('banner');
  const startCard = part('start-card');
  const pausedCard = part('paused-card');
  const overCard = part('over-card');
  const resumeButton = part<HTMLButtonElement>('resume');
  const againButton = part<HTMLButtonElement>('again');
  const startBest = part('start-best');
  const status = part('status');

  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new Renderer(canvas, calm);

  let mode: Mode = 'demo';
  let viewW = 960;
  let game = new Game(newSeed(), viewW);
  let best = readBest();
  let lastInjury: 'wall' | 'overheat' = 'wall';

  // Steering.
  let targetY = VIEW_H / 2;
  let mouseY: number | null = null;
  let dragId: number | null = null;
  let dragY = 0;
  const held = new Set<string>();

  // Frame loop.
  let frameId = 0;
  let lastTime = 0;
  let backlog = 0;
  let onScreen = false;
  let revealTimer = 0;

  /** What the HUD currently shows, so the DOM is only touched when a value changes. */
  const shown = { score: -1, multiplier: 0, integrity: -1, distance: -1, hot: false };

  const toWorldY = (clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    return rect.height > 0 ? ((clientY - rect.top) / rect.height) * VIEW_H : VIEW_H / 2;
  };

  function setMode(next: Mode): void {
    mode = next;
    stage.dataset.mode = next;
    startCard.hidden = next !== 'demo';
    pausedCard.hidden = next !== 'paused';
    if (next !== 'over') overCard.hidden = true;
  }

  function showBest(): void {
    startBest.hidden = best <= 0;
    startBest.querySelector('b')!.textContent = number.format(best);
  }

  function startDemo(): void {
    game = new Game(newSeed(), viewW);
    renderer.reset();
    backlog = 0;
    setMode('demo');
  }

  /** Begin a run. `event` is the click that started it, used to pick up the mouse position. */
  function startRun(event: MouseEvent): void {
    window.clearTimeout(revealTimer);
    game = new Game(newSeed(), viewW);
    // A moment of grace while the player finds the burr.
    game.shield = 1.5;
    renderer.reset();
    backlog = 0;
    held.clear();
    dragId = null;
    // event.detail is 0 when the button was pressed from the keyboard.
    const byMouse = event.detail > 0 && mouseY !== null;
    targetY = byMouse ? clamp(toWorldY(event.clientY), 0, VIEW_H) : game.y;
    shown.score = shown.distance = shown.integrity = -1;
    shown.multiplier = 0;
    setMode('playing');
    stage.focus({ preventScroll: true });
    // Line the playfield up under the header so all of it, HUD included, is in view.
    stage.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
    status.textContent = 'Run started.';
  }

  function pause(): void {
    if (mode !== 'playing') return;
    held.clear();
    setMode('paused');
    resumeButton.focus({ preventScroll: true });
  }

  function resume(): void {
    if (mode !== 'paused') return;
    setMode('playing');
    stage.focus({ preventScroll: true });
  }

  function finish(): void {
    const score = Math.floor(game.score);
    const isBest = score > best;
    if (isBest) {
      best = score;
      writeBest(best);
      showBest();
    }
    const rank = RANKS.reduce((title, [threshold, name]) => (score >= threshold ? name : title), RANKS[0][1]);
    const distance = `${number.format(Math.round(game.scroll * MM_PER_UNIT))} mm`;
    const cause = lastInjury === 'overheat' ? 'The burr overheated' : 'The vessel wall was injured';

    part('cause').textContent = cause;
    part('final-score').textContent = number.format(score);
    part('new-best').hidden = !isBest;
    part('rank').textContent = rank;
    part('stat-cleared').textContent = `${Math.round(game.cleared * 100)}%`;
    part('stat-distance').textContent = distance;
    part('stat-sweeps').textContent = String(game.stats.sweeps);
    part('stat-clots').textContent = String(game.stats.clots);
    status.textContent = `${cause}. Final score ${number.format(score)}. Rank: ${rank}.`;

    setMode('over');
    // Let the final hit play out before the results cover the scene.
    revealTimer = window.setTimeout(() => {
      overCard.hidden = false;
      againButton.focus({ preventScroll: true });
    }, 700);
  }

  function announce(title: string, detail: string): void {
    banner.querySelector('b')!.textContent = title;
    banner.querySelector('span')!.textContent = detail;
    banner.classList.remove('is-on');
    void banner.offsetWidth; // restart the animation
    banner.classList.add('is-on');
  }

  function react(event: GameEvent): void {
    if (event.type === 'wall' || event.type === 'overheat') lastInjury = event.type;
    else if (event.type === 'segment') {
      const title = `Segment ${String(event.segment).padStart(2, '0')}`;
      announce(title, event.healed ? 'Vessel integrity restored' : 'The vessel narrows');
    }
  }

  function updateHud(): void {
    const score = Math.floor(game.score);
    if (score !== shown.score) {
      shown.score = score;
      scoreEl.textContent = number.format(score);
    }
    if (game.multiplier !== shown.multiplier) {
      const grew = game.multiplier > shown.multiplier && shown.multiplier > 0;
      shown.multiplier = game.multiplier;
      multiplierEl.textContent = `×${game.multiplier}`;
      multiplierEl.classList.toggle('is-up', game.multiplier > 1);
      if (grew) {
        multiplierEl.classList.remove('is-pop');
        void multiplierEl.offsetWidth; // restart the animation
        multiplierEl.classList.add('is-pop');
      }
    }
    heatBox.style.setProperty('--heat', game.heat.toFixed(3));
    const hot = game.heat > 0.7;
    if (hot !== shown.hot) {
      shown.hot = hot;
      heatBox.classList.toggle('is-hot', hot);
    }
    if (game.integrity !== shown.integrity) {
      shown.integrity = game.integrity;
      pips.forEach((pip, i) => pip.classList.toggle('is-lost', i >= game.integrity));
    }
    const distance = Math.floor(game.scroll * MM_PER_UNIT);
    if (distance !== shown.distance) {
      shown.distance = distance;
      distanceEl.textContent = number.format(distance);
    }
  }

  function frame(now: number): void {
    frameId = requestAnimationFrame(frame);
    const dt = clamp((now - lastTime) / 1000, 0, 0.05);
    lastTime = now;

    if (mode === 'playing' || mode === 'demo') {
      if (mode === 'playing') {
        let steer = 0;
        for (const code of held) steer += UP_KEYS.has(code) ? -1 : 1;
        if (steer !== 0) targetY = clamp(targetY + Math.sign(steer) * KEY_SPEED * dt, 0, VIEW_H);
      }
      backlog += dt;
      while (backlog >= STEP) {
        game.step(STEP, mode === 'demo' ? autopilot(game) : targetY);
        backlog -= STEP;
      }
      renderer.absorb(game.events, game);
      if (mode === 'playing') game.events.forEach(react);
      game.events.length = 0;

      if (mode === 'demo') {
        if (game.over || game.time > DEMO_LENGTH) startDemo();
      } else if (game.over) {
        finish();
      }
    }

    renderer.draw(game, mode === 'paused' ? 0 : dt);
    if (mode !== 'demo') updateHud();
  }

  /** Run the loop only while the game is actually visible. */
  function syncLoop(): void {
    const visible = onScreen && !document.hidden;
    if (!visible) {
      pause();
      cancelAnimationFrame(frameId);
      frameId = 0;
    } else if (!frameId) {
      lastTime = performance.now();
      frameId = requestAnimationFrame(frame);
    }
  }

  function fit(): void {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    viewW = renderer.resize(rect.width, rect.height, Math.min(2, window.devicePixelRatio || 1));
    game.resize(viewW);
    // Keep something on screen even while the loop is not running.
    if (!frameId) renderer.draw(game, 0);
  }

  // ---- input --------------------------------------------------------------------------------

  part('start').addEventListener('click', startRun);
  againButton.addEventListener('click', startRun);
  resumeButton.addEventListener('click', resume);
  part('pause').addEventListener('click', pause);

  // The mouse steers directly; a finger drags the burr from wherever it touches down.
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') {
      mouseY = toWorldY(event.clientY);
      if (mode === 'playing') targetY = clamp(mouseY, 0, VIEW_H);
    } else if (mode === 'playing' && event.pointerId === dragId) {
      const y = toWorldY(event.clientY);
      targetY = clamp(targetY + (y - dragY) * 1.3, 0, VIEW_H);
      dragY = y;
    }
  });
  stage.addEventListener('pointerdown', (event) => {
    if (mode !== 'playing' || event.pointerType === 'mouse') return;
    dragId = event.pointerId;
    dragY = toWorldY(event.clientY);
    // Start from where the burr is, not from wherever the last drag left the target.
    targetY = game.y;
  });
  for (const type of ['pointerup', 'pointercancel'] as const) {
    window.addEventListener(type, (event) => {
      if (event.pointerId === dragId) dragId = null;
    });
  }

  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (mode === 'playing') {
      if (UP_KEYS.has(event.code) || DOWN_KEYS.has(event.code)) {
        held.add(event.code);
        event.preventDefault();
      } else if (event.code === 'KeyP' || event.code === 'Escape') {
        pause();
        event.preventDefault();
      } else if (event.code === 'Space') {
        // Keep the page from scrolling away mid-run.
        event.preventDefault();
      }
    } else if (mode === 'paused' && (event.code === 'KeyP' || event.code === 'Escape')) {
      resume();
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => held.delete(event.code));
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', syncLoop);

  new ResizeObserver(fit).observe(canvas);
  new IntersectionObserver(
    (entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      syncLoop();
    },
    { threshold: 0.05 },
  ).observe(stage);

  showBest();
  setMode('demo');
  fit();
}
