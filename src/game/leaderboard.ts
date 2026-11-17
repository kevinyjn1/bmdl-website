/**
 * Lumen Run - the online leaderboard.
 *
 * Talks to the Google Apps Script backend in leaderboard/Code.gs. The checks on names and
 * email addresses here mirror the ones the backend applies (the backend is the one that
 * counts; these only save the player a round trip), and leaderboard.test.ts keeps the two
 * in step.
 */

export interface BoardEntry {
  rank: number;
  name: string;
  score: number;
}

export interface Board {
  /** Number of players on the whole board, not just the entries returned. */
  total: number;
  entries: BoardEntry[];
}

/** A finished run, as posted to the leaderboard. */
export interface RunReport {
  name: string;
  /** Empty when the player chose not to give one. */
  email: string;
  score: number;
  /** Millimetres travelled. */
  distance: number;
  /** Seconds played. */
  duration: number;
  /** Percentage of the plaque passed that was ground away. */
  cleared: number;
  sweeps: number;
  clots: number;
}

/** Why a run was not posted. The first ones come from the backend; 'offline' is ours. */
export type LeaderboardErrorCode =
  'name' | 'name-blocked' | 'email' | 'score' | 'busy' | 'full' | 'bad-request' | 'server' | 'offline';

export class LeaderboardError extends Error {
  readonly code: LeaderboardErrorCode;

  constructor(code: LeaderboardErrorCode) {
    super(`Leaderboard: ${code}`);
    this.code = code;
  }
}

export const NAME_MIN = 2;
export const NAME_MAX = 20;
export const EMAIL_MAX = 254;
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'_-]*$/u;
const EMAIL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const ERROR_CODES: readonly string[] = [
  'name',
  'name-blocked',
  'email',
  'score',
  'busy',
  'full',
  'bad-request',
  'server',
];
const TIMEOUT = 15_000;

/** Tidy a display name. Returns '' when it is not one the leaderboard accepts. */
export function cleanName(value: string): string {
  const name = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) return '';
  return NAME_PATTERN.test(name) ? name : '';
}

export function isEmail(value: string): boolean {
  return value.length <= EMAIL_MAX && EMAIL_PATTERN.test(value);
}

/** The top of the board. */
export async function loadBoard(url: string, limit = 10): Promise<Board> {
  const address = new URL(url);
  address.searchParams.set('limit', String(limit));
  return toBoard(await request(address.href));
}

/** Where the player who just posted stands: their rank, and the best score under their name. */
export interface Standing extends Board {
  rank: number;
  best: number;
}

/** Post a run. Resolves with the refreshed board and the player's standing on it. */
export async function postRun(url: string, run: RunReport, limit = 10): Promise<Standing> {
  // Sent as plain text on purpose: that keeps it a "simple" request, which the browser sends
  // without a CORS preflight. Apps Script web apps cannot answer preflights.
  const reply = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...run, limit }),
  });
  const rank = Number(reply.rank);
  const best = Number(reply.best);
  if (!Number.isInteger(rank) || rank < 1 || !Number.isFinite(best)) throw new LeaderboardError('server');
  return { ...toBoard(reply), rank, best: Math.floor(best) };
}

async function request(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let reply: unknown;
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    reply = await response.json();
  } catch {
    // No connection, a timeout, or something other than our backend answered.
    throw new LeaderboardError('offline');
  }
  if (typeof reply !== 'object' || reply === null) throw new LeaderboardError('server');
  const data = reply as Record<string, unknown>;
  if (data.ok !== true) {
    const code = typeof data.error === 'string' && ERROR_CODES.includes(data.error) ? data.error : 'server';
    throw new LeaderboardError(code as LeaderboardErrorCode);
  }
  return data;
}

/** Take only what we expect from the reply; it comes from outside, so nothing is assumed. */
function toBoard(data: Record<string, unknown>): Board {
  const list = Array.isArray(data.entries) ? data.entries : [];
  const entries: BoardEntry[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const { name, score } = item as Record<string, unknown>;
    if (typeof name !== 'string' || typeof score !== 'number' || !Number.isFinite(score)) continue;
    entries.push({ rank: entries.length + 1, name: name.slice(0, NAME_MAX), score: Math.floor(score) });
  }
  const total = Number(data.total);
  return { entries, total: Number.isInteger(total) && total >= entries.length ? total : entries.length };
}
