/// <reference types="node" />
/**
 * Keeps the game's own checks on names and emails in step with the leaderboard backend
 * (leaderboard/Code.gs), so the form never accepts something the backend then refuses.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBackend } from '../../leaderboard/fake-google.mjs';
import { cleanName, isEmail, nextToBeat, rankFor, type Board } from './leaderboard.ts';

const run = { score: 1200, distance: 60, duration: 30, cleared: 40, sweeps: 1, clots: 0 };

test('the game and the backend agree on which names are acceptable', () => {
  const names = [
    'Ada',
    'A',
    '',
    '  Mary   Ann ',
    "D'Arcy",
    'Anne-Marie',
    'Zoë B.',
    '李小龍',
    'Dr_Burr 2',
    '=1+1',
    '+SUM(A1)',
    '@handle',
    '<b>bold</b>',
    'x'.repeat(20),
    'x'.repeat(21),
    'emoji 🙂',
    'semi;colon',
  ];
  for (const name of names) {
    const backend = loadBackend();
    const reply = backend.post({ ...run, name, email: '' });
    const accepted = reply.ok === true;
    assert.equal(cleanName(name) !== '', accepted, `name ${JSON.stringify(name)}`);
    if (accepted) assert.equal(backend.rows('Scores')[1][1], cleanName(name), 'stored under a different name');
  }
});

test('the game and the backend agree on which emails are acceptable', () => {
  const emails = [
    'ada@example.edu',
    'first.last+tag@sub.example.co.uk',
    'nope',
    'a@b',
    '=cmd@x.com',
    'a b@x.com',
    '@x.com',
    'trailing@dot.',
    `${'a'.repeat(250)}@x.com`,
  ];
  for (const email of emails) {
    const reply = loadBackend().post({ ...run, name: 'Ada', email });
    assert.equal(isEmail(email), reply.ok === true, `email ${email}`);
  }
});

const boardOf = (scores: number[], total = scores.length): Board => ({
  total,
  entries: scores.map((score, i) => ({ rank: i + 1, name: `Player ${i + 1}`, score })),
});

test('a run is ranked against the board, with ties behind whoever was first', () => {
  const board = boardOf([900, 700, 500]);
  assert.equal(rankFor(board, 1000), 1);
  assert.equal(rankFor(board, 900), 2);
  assert.equal(rankFor(board, 800), 2);
  assert.equal(rankFor(board, 500), 4);
  assert.equal(rankFor(board, 10), 4);
  assert.equal(rankFor(boardOf([]), 10), 1);
  // Only the top of a longer board is known: below it, the exact rank is not.
  const top = boardOf([900, 700, 500], 40);
  assert.equal(rankFor(top, 600), 3);
  assert.equal(rankFor(top, 100), null);
});

test('the next score to beat is the lowest one still ahead', () => {
  const board = boardOf([900, 700, 500]);
  assert.equal(nextToBeat(board, 0)?.rank, 3);
  assert.equal(nextToBeat(board, 500)?.rank, 2);
  assert.equal(nextToBeat(board, 899)?.rank, 1);
  assert.equal(nextToBeat(board, 900), null);
  assert.equal(nextToBeat(boardOf([]), 0), null);
});
