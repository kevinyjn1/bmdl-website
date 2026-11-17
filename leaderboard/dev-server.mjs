/**
 * A local stand-in for the deployed leaderboard, for working on the game without touching the
 * real spreadsheet. It runs the actual backend code (Code.gs) against a spreadsheet held in
 * memory, and answers the way Google does: every request is redirected once before the JSON
 * arrives, and CORS preflight requests get no answer.
 *
 *   node leaderboard/dev-server.mjs [--seed]      (npm run leaderboard:dev)
 *   PUBLIC_LEADERBOARD_URL=http://localhost:8787/exec npm run dev
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { loadBackend } from './fake-google.mjs';

const port = Number(process.env.PORT) || 8787;
const backend = loadBackend();

if (process.argv.includes('--seed')) {
  const players = [
    'Ada',
    'Grace',
    'Linus',
    'Marie C.',
    'Rosalind',
    'Hedy',
    'Katherine J',
    'Alan',
    'Barbara',
    'Tim',
    'Margaret',
    'Dennis',
  ];
  players.forEach((name, i) => {
    const duration = 40 + i * 9;
    backend.post({
      name,
      email: '',
      score: 84000 - i * 6100,
      distance: duration * 5,
      duration,
      cleared: 60 - i * 3,
      sweeps: 14 - i,
      clots: 6,
    });
  });
  backend.expireCache();
}

/** Responses waiting to be collected after the redirect. */
const waiting = new Map();
const cors = { 'Access-Control-Allow-Origin': '*' };

const readBody = (request) =>
  new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => resolve(body));
  });

http
  .createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://localhost:${port}`);
    const isRead = request.method === 'GET';
    const isWrite = request.method === 'POST';

    if (url.pathname === '/exec' && (isRead || isWrite)) {
      const payload = isRead
        ? backend.get(Object.fromEntries(url.searchParams))
        : backend.post(await readBody(request));
      const token = randomUUID();
      waiting.set(token, JSON.stringify(payload));
      response.writeHead(302, { ...cors, Location: `/echo?token=${token}` }).end();
      console.log(`${request.method} ${url.pathname}${url.search} -> ${JSON.stringify(payload).slice(0, 100)}`);
    } else if (url.pathname === '/echo' && isRead && waiting.has(url.searchParams.get('token'))) {
      const token = url.searchParams.get('token');
      response.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' }).end(waiting.get(token));
      waiting.delete(token);
    } else {
      response.writeHead(405).end();
    }
  })
  .listen(port, () => console.log(`Leaderboard stand-in listening on http://localhost:${port}/exec`));
