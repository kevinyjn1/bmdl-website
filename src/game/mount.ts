/**
 * Lumen Run - wiring to the page.
 *
 * Connects the simulation (sim.ts) and the renderer (render.ts) to the markup in
 * components/LumenRun.astro: the frame loop, mouse, touch and keyboard input, the HUD, the
 * title, pause and results cards, and the online leaderboard (leaderboard.ts).
 */
import {
  LeaderboardError,
  cleanName,
  isEmail,
  loadBoard,
  nextToBeat,
  postRun,
  rankFor,
  type Board,
  type LeaderboardErrorCode,
  type RunReport,
  type Standing,
} from './leaderboard.ts';
import { Renderer } from './render.ts';
import { Game, STEP, autopilot, type GameEvent } from './sim.ts';
import { VIEW_H } from './world.ts';

/** demo: the game plays itself behind the title card. */
type Mode = 'demo' | 'playing' | 'paused' | 'over';

const BEST_KEY = 'bmdl:lumen-run:best';
const NAME_KEY = 'bmdl:lumen-run:name';
/** Rows shown on the leaderboard, and on the short list on the start screen. */
const BOARD_SIZE = 10;
const TOP_SIZE = 5;
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

/** What to tell the player when a score could not be posted. */
const POST_ERRORS: Record<LeaderboardErrorCode, string> = {
  name: 'Use 2 to 20 letters, digits or spaces for your name.',
  'name-blocked': 'Please choose a different name.',
  email: 'That email address does not look right.',
  score: 'This run could not be verified, so it was not posted.',
  busy: 'The leaderboard is busy. Try again in a minute.',
  full: 'The leaderboard is not taking new scores right now.',
  'bad-request': 'Could not post the score. Please try again.',
  server: 'Could not post the score. Please try again.',
  offline: 'Could not reach the leaderboard. Check your connection and try again.',
};

/** Read something this browser remembered. Storage can be unavailable (private browsing). */
function recall(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage, the value simply lasts for this visit only.
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

  // The leaderboard. Without a backend address the game simply has none.
  const boardUrl = root.dataset.leaderboard ?? '';
  const overViews = { result: part('over-result'), post: part('post-form'), posted: part('posted') };
  const openPostButton = part<HTMLButtonElement>('open-post');
  const postSubmit = part<HTMLButtonElement>('post-submit');
  const nameInput = part<HTMLInputElement>('post-name');
  const emailInput = part<HTMLInputElement>('post-email');
  const postError = part('post-error');
  const boardRows = part('board-rows');
  const boardYou = part('board-you');
  const topCard = part('top-card');
  const topRows = part('top-rows');
  const topNote = part('top-note');
  const chase = part('chase');
  const wouldRank = part('would-rank');
  const boardNote = part('board-note');
  const boardMeta = part('board-meta');
  const rowTemplate = part<HTMLTemplateElement>('board-row');
  const startBest = part('start-best');
  const status = part('status');

  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new Renderer(canvas, calm);

  let mode: Mode = 'demo';
  let viewW = 960;
  let game = new Game(newSeed(), viewW);
  let best = Number(recall(BEST_KEY)) || 0;
  let lastInjury: 'wall' | 'overheat' = 'wall';

  /** The run that just ended, until it has been posted; and who posted, to highlight their row. */
  /** The leaderboard as last loaded; null until it has arrived. */
  let board: Board | null = null;
  let finishedRun: Omit<RunReport, 'name' | 'email'> | null = null;
  let you = '';
  let posting = false;
  let boardRequest = 0;

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
  const shown = { score: -1, multiplier: 0, integrity: -1, distance: -1, hot: false, chase: '' };

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
      remember(BEST_KEY, String(best));
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
    status.textContent = `${cause}. Final score ${number.format(score)}. Level: ${rank}.`;

    finishedRun = {
      score,
      distance: Math.round(game.scroll * MM_PER_UNIT),
      duration: Math.round(game.time * 10) / 10,
      cleared: Math.round(game.cleared * 100),
      sweeps: game.stats.sweeps,
      clots: game.stats.clots,
    };
    openPostButton.hidden = !boardUrl || score < 1;
    showWouldRank(score);
    showOver('result');
    void refreshBoard();

    setMode('over');
    // Let the final hit play out before the results cover the scene.
    revealTimer = window.setTimeout(() => {
      overCard.hidden = false;
      againButton.focus({ preventScroll: true });
    }, 700);
  }

  // ---- leaderboard ---------------------------------------------------------------------------

  /** The results card has three views: the result, the form to post it, and the confirmation. */
  function showOver(view: keyof typeof overViews): void {
    for (const [name, element] of Object.entries(overViews)) element.hidden = name !== view;
  }

  function boardRow(rank: number, name: string, score: number, index = 0): HTMLElement {
    const row = rowTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
    row.style.setProperty('--i', String(index));
    row.classList.toggle('is-top', rank <= 3);
    row.classList.toggle('is-you', you !== '' && name.toLowerCase() === you);
    row.querySelector('.pos')!.textContent = String(rank).padStart(2, '0');
    row.querySelector('.who')!.textContent = name;
    row.querySelector('.pts')!.textContent = number.format(score);
    return row;
  }

  /** Draw the board. `standing` is given right after posting, to show where the player landed. */
  function renderBoard(next: Board, standing?: Standing & { name: string }): void {
    board = next;
    const rows = next.entries.map((entry, index) => boardRow(entry.rank, entry.name, entry.score, index));
    boardRows.replaceChildren(...rows);
    // Below the top of the board, the player still gets to see their own row.
    if (standing) {
      const listed = next.entries.some((entry) => entry.name.toLowerCase() === you);
      boardYou.hidden = listed;
      boardYou.replaceChildren(...(listed ? [] : [boardRow(standing.rank, standing.name, standing.best)]));
    }
    boardNote.textContent = rows.length ? '' : 'No scores yet. Be the first on the board.';
    boardMeta.textContent =
      next.total === 0 ? '' : next.total === 1 ? '1 player' : `${number.format(next.total)} players`;

    // The same scores, in short form, on the start screen.
    const top = next.entries.slice(0, TOP_SIZE);
    topRows.replaceChildren(...top.map((entry) => boardRow(entry.rank, entry.name, entry.score)));
    topNote.textContent = top.length ? '' : 'No scores yet. Yours could be the first.';
    topCard.hidden = false;

    shown.chase = '';
    if (finishedRun) showWouldRank(finishedRun.score);
  }

  /** On the results card: where this run would land if it were posted. */
  function showWouldRank(score: number): void {
    const known = board !== null && score >= 1;
    wouldRank.hidden = !known;
    if (!board || !known) return;
    const rank = rankFor(board, score);
    const last = board.entries.at(-1);
    wouldRank.textContent =
      rank !== null
        ? `This run would rank #${number.format(rank)}`
        : `Top ${board.entries.length} starts at ${number.format(last?.score ?? 0)}`;
  }

  /** In the HUD: the leaderboard score the player is closing in on. */
  function updateChase(score: number): void {
    const target = board ? nextToBeat(board, score) : null;
    const leading = !!board && board.entries.length > 0 && !target;
    const key = !board || board.entries.length === 0 ? 'none' : target ? `#${target.rank}` : 'leading';
    if (key === shown.chase) return;
    shown.chase = key;
    chase.hidden = key === 'none';
    part('chase-label').textContent = leading ? 'Leaderboard' : 'Next to beat';
    part('chase-name').textContent = leading ? 'You lead the board' : target ? `#${target.rank} ${target.name}` : '';
    part('chase-score').textContent = target ? number.format(target.score) : '';
  }

  async function refreshBoard(): Promise<void> {
    if (!boardUrl) return;
    const request = ++boardRequest;
    try {
      const board = await loadBoard(boardUrl, BOARD_SIZE);
      // A newer request (or a posted score) has already drawn a fresher board.
      if (request === boardRequest) renderBoard(board);
    } catch {
      if (request === boardRequest && !boardRows.children.length) {
        boardNote.textContent = 'The leaderboard could not be loaded right now.';
      }
    }
  }

  function openPost(): void {
    if (!finishedRun) return;
    part('post-score').textContent = number.format(finishedRun.score);
    if (!nameInput.value) nameInput.value = recall(NAME_KEY);
    postError.textContent = '';
    showOver('post');
    nameInput.focus({ preventScroll: true });
  }

  function refuse(code: LeaderboardErrorCode): void {
    postError.textContent = POST_ERRORS[code];
    const field = code === 'email' ? emailInput : code === 'name' || code === 'name-blocked' ? nameInput : null;
    nameInput.setAttribute('aria-invalid', String(field === nameInput));
    emailInput.setAttribute('aria-invalid', String(field === emailInput));
    field?.focus({ preventScroll: true });
  }

  async function submitPost(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!finishedRun || posting) return;
    const name = cleanName(nameInput.value);
    const email = emailInput.value.trim();
    if (!name) return refuse('name');
    if (email && !isEmail(email)) return refuse('email');

    posting = true;
    postSubmit.disabled = true;
    postSubmit.textContent = 'Posting';
    postError.textContent = '';
    try {
      const result = await postRun(boardUrl, { ...finishedRun, name, email }, BOARD_SIZE);
      remember(NAME_KEY, name);
      you = name.toLowerCase();
      // A run can be posted once.
      finishedRun = null;
      openPostButton.hidden = true;
      boardRequest++;
      renderBoard(result, { ...result, name });

      const detail = result.total > 1 ? `of ${number.format(result.total)} players` : 'You are the first on the board';
      part('posted-rank').textContent = `#${number.format(result.rank)}`;
      part('posted-detail').textContent = detail;
      nameInput.setAttribute('aria-invalid', 'false');
      emailInput.setAttribute('aria-invalid', 'false');
      showOver('posted');
      part('again-posted').focus({ preventScroll: true });
      status.textContent = `Score posted. You are number ${result.rank} ${detail}.`;
    } catch (error) {
      refuse(error instanceof LeaderboardError ? error.code : 'offline');
    } finally {
      posting = false;
      postSubmit.disabled = false;
      postSubmit.textContent = 'Post score';
    }
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
    updateChase(score);
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
  part('again-posted').addEventListener('click', startRun);
  openPostButton.addEventListener('click', openPost);
  part<HTMLFormElement>('post-form').addEventListener('submit', (event) => void submitPost(event));
  part('post-back').addEventListener('click', () => {
    showOver('result');
    openPostButton.focus({ preventScroll: true });
  });
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

  if (boardUrl) {
    part('board').hidden = false;
    boardNote.textContent = 'Loading scores';
    void refreshBoard();
  }

  showBest();
  setMode('demo');
  fit();
}
