/// <reference types="node" />
/**
 * Keeps the game's own checks on names and emails in step with the leaderboard backend
 * (leaderboard/Code.gs), so the form never accepts something the backend then refuses.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBackend } from '../../leaderboard/fake-google.mjs';
import { cleanName, isEmail } from './leaderboard.ts';

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
