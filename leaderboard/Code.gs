/**
 * Lumen Run leaderboard - the backend.
 *
 * This is a Google Apps Script that lives inside a Google Sheet and is deployed as a web app.
 * The game posts finished runs to it and reads the top scores back; every run becomes one row
 * in the "Scores" tab, where the lab can read it and remove it by deleting the row.
 *
 *   GET  <web app url>?limit=10   ->  { ok: true, entries: [{ rank, name, score }], total }
 *   POST <web app url>            ->  the same, plus the rank and best score of whoever posted
 *        body: JSON { name, email, score, distance, duration, cleared, sweeps, clots }
 *
 * Email addresses are stored in the sheet only. They are never sent back to the website.
 * Setup instructions are in leaderboard/README.md.
 *
 * The next line limits what the script may touch to the one spreadsheet it lives in, which is
 * also all that Google then asks permission for.
 *
 * @OnlyCurrentDoc
 */

const SCORES_TAB = 'Scores';
const BLOCKED_TAB = 'Blocked words';
const HEADERS = [
  'When',
  'Name',
  'Email',
  'Score',
  'Distance (mm)',
  'Run time (s)',
  'Plaque cleared (%)',
  'Clean sweeps',
  'Clots',
];
const COLUMN = { NAME: 1, SCORE: 3 };

const NAME_MIN = 2;
const NAME_MAX = 20;
/** Letters (any alphabet), digits, spaces and . - _ ' only, starting with a letter or digit. */
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'_-]*$/u;
const EMAIL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const EMAIL_MAX = 254;

const MAX_BODY = 2000;
const MAX_ROWS = 20000;
const MAX_POSTS_PER_MINUTE = 40;
const MAX_LIMIT = 50;
const BOARD_CACHE_SECONDS = 60;

/** Sanity limits for a run. They stop casually faked scores, not a determined cheat. */
const MAX_SCORE = 5000000;
const MAX_DURATION = 3600;
const MAX_POINTS_PER_SECOND = 6000;
const MAX_MM_PER_SECOND = 7.2;

/** Seeded into the "Blocked words" tab the first time; the lab can edit the list there. */
// Kept short on purpose: words that also occur inside real surnames would lock people out.
const DEFAULT_BLOCKED_WORDS = ['fuck', 'shit', 'bitch', 'cunt', 'pussy', 'asshole', 'slut'];

// ---- web app entry points -----------------------------------------------------------------

function doGet(e) {
  const params = (e && e.parameter) || {};
  return respond({ ok: true, ...boardFor(readBoard(), params.limit) });
}

function doPost(e) {
  try {
    return respond(submit(e));
  } catch (error) {
    console.error(error);
    return respond({ ok: false, error: 'server' });
  }
}

/** Optional: run once from the editor to create the tabs before the first score arrives. */
function setup() {
  scoresSheet();
  blockedWords();
}

// ---- posting a score ----------------------------------------------------------------------

function submit(e) {
  const body = (e && e.postData && e.postData.contents) || '';
  if (!body || body.length > MAX_BODY) return { ok: false, error: 'bad-request' };

  let data;
  try {
    data = JSON.parse(body);
  } catch (error) {
    return { ok: false, error: 'bad-request' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'bad-request' };

  const name = cleanName(data.name);
  if (!name) return { ok: false, error: 'name' };
  if (isBlocked(name, blockedWords())) return { ok: false, error: 'name-blocked' };

  const email = typeof data.email === 'string' ? data.email.trim() : '';
  if (email && (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email))) return { ok: false, error: 'email' };

  const run = cleanRun(data);
  if (!run) return { ok: false, error: 'score' };

  if (tooManyPosts()) return { ok: false, error: 'busy' };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = scoresSheet();
    if (sheet.getLastRow() > MAX_ROWS) return { ok: false, error: 'full' };
    sheet.appendRow([
      new Date(),
      name,
      email,
      run.score,
      run.distance,
      run.duration,
      run.cleared,
      run.sweeps,
      run.clots,
    ]);
    const board = computeBoard(sheet);
    cacheBoard(board);
    const key = name.toLowerCase();
    const index = board.players.findIndex((player) => player.key === key);
    return { ok: true, rank: index + 1, best: board.players[index].score, ...boardFor(board, data.limit) };
  } finally {
    lock.releaseLock();
  }
}

/** Trim, collapse spaces and check a display name. Returns '' when it is not acceptable. */
function cleanName(value) {
  if (typeof value !== 'string') return '';
  const name = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) return '';
  return NAME_PATTERN.test(name) ? name : '';
}

/** True when the name contains a blocked word, also when written with digits or symbols. */
function isBlocked(name, words) {
  const plain = name
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/[^\p{L}]/gu, '');
  return words.some((word) => word && plain.includes(word));
}

/** Check the numbers of a run against what the game can actually produce. */
function cleanRun(data) {
  const whole = (value, max) => (Number.isInteger(value) && value >= 0 && value <= max ? value : null);
  const score = whole(data.score, MAX_SCORE);
  const distance = whole(data.distance, MAX_DURATION * MAX_MM_PER_SECOND);
  const cleared = whole(data.cleared, 100);
  const sweeps = whole(data.sweeps, 100000);
  const clots = whole(data.clots, 100000);
  const duration = typeof data.duration === 'number' && isFinite(data.duration) ? Math.round(data.duration) : null;
  if ([score, distance, cleared, sweeps, clots, duration].includes(null)) return null;
  if (score < 1 || duration < 1 || duration > MAX_DURATION) return null;
  if (score > duration * MAX_POINTS_PER_SECOND + 3000) return null;
  if (distance > duration * MAX_MM_PER_SECOND + 10) return null;
  return { score, distance, duration, cleared, sweeps, clots };
}

/** A simple brake on floods: at most MAX_POSTS_PER_MINUTE submissions per minute overall. */
function tooManyPosts() {
  const cache = CacheService.getScriptCache();
  const key = 'posts:' + Math.floor(Date.now() / 60000);
  const count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 120);
  return count > MAX_POSTS_PER_MINUTE;
}

// ---- reading the board --------------------------------------------------------------------

/** The cached board, rebuilt from the sheet at most once a minute. */
function readBoard() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('board');
  if (cached) return JSON.parse(cached);
  const board = computeBoard(scoresSheet());
  cacheBoard(board);
  return board;
}

function cacheBoard(board) {
  // Only the top of the board is cached; ranks further down are computed when a score is posted.
  const top = { total: board.total, players: board.players.slice(0, MAX_LIMIT) };
  CacheService.getScriptCache().put('board', JSON.stringify(top), BOARD_CACHE_SECONDS);
}

/** Every player's best score, best first. Players are told apart by name, ignoring case. */
function computeBoard(sheet) {
  const rows = sheet.getLastRow() - 1;
  const values = rows > 0 ? sheet.getRange(2, 1, rows, HEADERS.length).getValues() : [];
  const best = new Map();
  values.forEach((row, index) => {
    const name = cleanName(String(row[COLUMN.NAME]));
    const score = Number(row[COLUMN.SCORE]);
    if (!name || !Number.isFinite(score) || score < 1) return;
    const key = name.toLowerCase();
    const current = best.get(key);
    if (!current || score > current.score) best.set(key, { key, name, score: Math.floor(score), order: index });
  });
  // Equal scores: whoever got there first ranks higher.
  const players = [...best.values()].sort((a, b) => b.score - a.score || a.order - b.order);
  return { total: players.length, players: players.map(({ key, name, score }) => ({ key, name, score })) };
}

/** The public shape of the board: rank, name and score only. */
function boardFor(board, limit) {
  const count = Math.min(MAX_LIMIT, Math.max(1, parseInt(limit, 10) || 10));
  return {
    total: board.total,
    entries: board.players.slice(0, count).map((player, index) => ({
      rank: index + 1,
      name: player.name,
      score: player.score,
    })),
  };
}

// ---- the spreadsheet ----------------------------------------------------------------------

function scoresSheet() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(SCORES_TAB);
  if (!sheet) {
    sheet = book.insertSheet(SCORES_TAB);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Names and emails are stored as plain text, so nothing typed by a player is ever
    // treated as a formula.
    sheet.getRange('B:C').setNumberFormat('@');
  }
  return sheet;
}

/** The lab's list of words that may not appear in a name (one per row in the Blocked words tab). */
function blockedWords() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(BLOCKED_TAB);
  if (!sheet) {
    sheet = book.insertSheet(BLOCKED_TAB);
    const rows = [['Names containing these words are refused (one per row)']].concat(
      DEFAULT_BLOCKED_WORDS.map((word) => [word]),
    );
    sheet.getRange(1, 1, rows.length, 1).setValues(rows);
    sheet.getRange(1, 1, 1, 1).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return [];
  return sheet
    .getRange(2, 1, rows, 1)
    .getValues()
    .map((row) =>
      String(row[0])
        .toLowerCase()
        .replace(/[^\p{L}]/gu, ''),
    )
    .filter(Boolean);
}

function respond(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
