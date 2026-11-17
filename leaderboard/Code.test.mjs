/**
 * Tests for the leaderboard backend (Code.gs), run against a fake spreadsheet. `npm test`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadBackend } from './fake-google.mjs';

/** A plausible finished run. */
const run = (overrides = {}) => ({
  name: 'Ada',
  email: 'ada@example.edu',
  score: 12340,
  distance: 310,
  duration: 62.4,
  cleared: 48,
  sweeps: 5,
  clots: 3,
  ...overrides,
});

test('a posted run becomes one row in the Scores tab', () => {
  const backend = loadBackend();
  const result = backend.post(run());
  assert.equal(result.ok, true);
  assert.equal(result.rank, 1);

  const [header, row] = backend.rows('Scores');
  assert.deepEqual(header.slice(1, 4), ['Name', 'Email', 'Score']);
  assert.equal(Object.prototype.toString.call(row[0]), '[object Date]');
  assert.deepEqual(row.slice(1), ['Ada', 'ada@example.edu', 12340, 310, 62, 48, 5, 3]);
  assert.ok(backend.sheet('Scores').formats.includes('@'), 'name and email columns are not plain text');
});

test('email is optional, and is never sent back to the website', () => {
  const backend = loadBackend();
  assert.equal(backend.post(run({ email: '' })).ok, true);
  assert.equal(backend.post(run({ name: 'Grace', email: undefined, score: 900 })).ok, true);
  const posted = backend.post(run({ name: 'Linus', email: 'linus@example.org', score: 500 }));

  for (const reply of [posted, backend.get(), backend.get({ limit: '50' })]) {
    assert.ok(!JSON.stringify(reply).includes('@'), 'an email address leaked');
    for (const entry of reply.entries) assert.deepEqual(Object.keys(entry).sort(), ['name', 'rank', 'score']);
  }
});

test('the board shows each player once, best score first', () => {
  const backend = loadBackend();
  backend.post(run({ name: 'Ada', score: 1000 }));
  backend.post(run({ name: 'Grace', score: 3000 }));
  backend.post(run({ name: 'ada', score: 2500 }));
  backend.post(run({ name: 'Linus', score: 2500 }));
  const low = backend.post(run({ name: 'Grace', score: 10 }));

  assert.equal(low.rank, 1, 'a worse run should not lower the rank');
  assert.equal(low.best, 3000, 'the best score should be reported, not the latest');
  assert.equal(low.total, 3);
  // Ada and Linus are level on 2500; Ada reached it first.
  assert.deepEqual(
    low.entries.map((entry) => [entry.rank, entry.name, entry.score]),
    [
      [1, 'Grace', 3000],
      [2, 'ada', 2500],
      [3, 'Linus', 2500],
    ],
  );
  assert.equal(backend.rows('Scores').length, 1 + 5, 'every run is kept in the sheet');
});

test('the limit is honoured and bounded', () => {
  const backend = loadBackend();
  for (let i = 0; i < 60; i++) {
    if (i === 35) backend.expireCache(); // a new minute, so the flood brake does not kick in
    backend.post(run({ name: `Player ${i}`, score: 100 + i }));
  }
  backend.expireCache();
  assert.equal(backend.get().entries.length, 10);
  assert.equal(backend.get({ limit: '3' }).entries.length, 3);
  assert.equal(backend.get({ limit: '999' }).entries.length, 50);
  assert.equal(backend.get({ limit: 'abc' }).entries.length, 10);
  assert.equal(backend.get().total, 60);
  assert.equal(backend.get().entries[0].name, 'Player 59');
});

test('unacceptable names are refused', () => {
  const backend = loadBackend();
  const refused = {
    name: [
      '',
      'A',
      'x'.repeat(21),
      '=1+1',
      '+SUM(A1)',
      '@handle',
      '<script>',
      'a,b',
      'tab\there'.replace('\t', '\u0007'),
      42,
      null,
    ],
    'name-blocked': ['Shit', 'sh1t head', 'F.u.c.k', 'BITCH', 'a55hole'],
  };
  for (const [error, names] of Object.entries(refused)) {
    for (const name of names)
      assert.deepEqual(backend.post(run({ name })), { ok: false, error }, `name ${JSON.stringify(name)}`);
  }
  assert.equal(backend.rows('Scores').length, 0, 'nothing should have been stored');

  for (const name of ['Jo', "D'Arcy", 'Anne-Marie', 'Zoë B.', '李小龍', 'Dr_Burr 2', 'Hancock']) {
    assert.equal(backend.post(run({ name })).ok, true, `name ${name}`);
  }
  // Extra spaces are tidied rather than refused.
  backend.post(run({ name: '  Mary   Ann  ', score: 99999 }));
  assert.equal(backend.get().entries[0].name, 'Mary Ann');
});

test('the lab can block more words in the Blocked words tab', () => {
  const backend = loadBackend();
  assert.equal(backend.post(run({ name: 'Buckeye' })).ok, true);
  backend.sheet('Blocked words').appendRow(['Buckeye']);
  assert.deepEqual(backend.post(run({ name: 'buckeye fan' })), { ok: false, error: 'name-blocked' });
});

test('malformed emails are refused', () => {
  const backend = loadBackend();
  for (const email of ['nope', 'a@b', '=cmd@x.com', 'a b@x.com', '@x.com', `${'a'.repeat(250)}@x.com`]) {
    assert.deepEqual(backend.post(run({ email })), { ok: false, error: 'email' }, `email ${email}`);
  }
  assert.equal(backend.post(run({ email: '  first.last+tag@sub.example.co.uk ' })).ok, true);
  assert.equal(backend.rows('Scores')[1][2], 'first.last+tag@sub.example.co.uk');
});

test('runs the game could not have produced are refused', () => {
  const backend = loadBackend();
  const impossible = [
    { score: 0 },
    { score: -5 },
    { score: 12.5 },
    { score: '9000' },
    { score: 9999999 },
    { score: 900000, duration: 20 },
    { distance: 5000, duration: 60 },
    { duration: 0 },
    { duration: 99999 },
    { cleared: 140 },
    { sweeps: -1 },
    { clots: 1.5 },
  ];
  for (const change of impossible) {
    assert.deepEqual(backend.post(run(change)), { ok: false, error: 'score' }, JSON.stringify(change));
  }
  assert.equal(backend.rows('Scores').length, 0);
});

test('junk requests are refused', () => {
  const backend = loadBackend();
  for (const body of ['', 'not json', '[]', 'null', '"text"', JSON.stringify(run({ note: 'x'.repeat(3000) }))]) {
    assert.deepEqual(backend.post(body), { ok: false, error: 'bad-request' }, body.slice(0, 20));
  }
});

test('a flood of posts is slowed down', () => {
  const backend = loadBackend();
  const results = Array.from({ length: 45 }, (_, i) => backend.post(run({ name: `Bot ${i}` })));
  assert.equal(results.filter((result) => result.ok).length, 40);
  assert.deepEqual(results.at(-1), { ok: false, error: 'busy' });
});

test('deleting a row in the sheet removes it from the board', () => {
  const backend = loadBackend();
  backend.post(run({ name: 'Keep', score: 100 }));
  backend.post(run({ name: 'Remove me', score: 5000 }));
  assert.equal(backend.get().entries[0].name, 'Remove me');

  backend.rows('Scores').splice(2, 1);
  backend.expireCache();
  assert.deepEqual(backend.get().entries, [{ rank: 1, name: 'Keep', score: 100 }]);
});

test('an empty sheet gives an empty board', () => {
  const backend = loadBackend();
  assert.deepEqual(backend.get(), { ok: true, total: 0, entries: [] });
});
