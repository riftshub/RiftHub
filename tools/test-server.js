// Spins up the server and simulates a host + joiner over real WebSockets.
import { spawn } from 'node:child_process';
const PORT = 10777;
const srv = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
const base = `ws://127.0.0.1:${PORT}/ws`;
const fail = (m) => { console.log('FAIL', m); srv.kill(); process.exit(1); };
const client = (name) => new Promise((res, rej) => {
  const ws = new WebSocket(base); const inbox = [];
  ws.onmessage = (e) => inbox.push(JSON.parse(e.data));
  ws.onopen = () => res({ ws, inbox, send: (o) => ws.send(JSON.stringify(o)), wait: async (pred, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { const i = inbox.findIndex(pred); if (i >= 0) return inbox.splice(i, 1)[0]; await new Promise((r) => setTimeout(r, 10)); } fail(`${name} timed out`); } });
  ws.onerror = rej;
});
const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
if (!health.ok) fail('health');
const page = await fetch(`http://127.0.0.1:${PORT}/`);
if (!(await page.text()).includes('THE BACKROOMS')) fail('index');
if ((await fetch(`http://127.0.0.1:${PORT}/../package.json`)).status === 200) fail('path traversal');

const A = await client('host');
A.send({ t: 'create', name: 'Alice<script>', seed: 42, level: 3 });
const roomA = await A.wait((m) => m.t === 'room');
if (roomA.host !== roomA.you || roomA.code.length !== 5 || roomA.level !== 3) fail('create');
A.send({ t: 'ev', k: 'level', level: 3, lseed: 999, cycle: 0 });
await new Promise((r) => setTimeout(r, 50));
const B = await client('joiner');
B.send({ t: 'join', code: roomA.code.toLowerCase(), name: 'Bob' });
const roomB = await B.wait((m) => m.t === 'room');
if (roomB.lseed !== 999 || roomB.players.length !== 2 || roomB.players[0].name !== 'Alicescript') fail('join info ' + JSON.stringify(roomB));
await A.wait((m) => m.t === 'join' && m.name === 'Bob');
// state relay
B.send({ t: 'st', x: 1, z: 2 });
const st = await A.wait((m) => m.t === 'st');
if (st.from !== roomB.you) fail('relay from');
// non-host cannot send entities
B.send({ t: 'ent', s: [] });
A.send({ t: 'ent', s: [[1, 2, 3]], pw: 1 });
const ent = await B.wait((m) => m.t === 'ent');
if (ent.from !== roomA.you) fail('ent from');
await new Promise((r) => setTimeout(r, 100));
if (A.inbox.some((m) => m.t === 'ent')) fail('non-host ent relayed');
// large message (extended length frames)
A.send({ t: 'ent', s: Array.from({ length: 400 }, (_, i) => [i, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), pw: 1 });
const big = await B.wait((m) => m.t === 'ent');
if (big.s.length !== 400) fail('big frame');
// bad code
const C = await client('c');
C.send({ t: 'join', code: 'ZZZZZ', name: 'x' });
await C.wait((m) => m.t === 'err');
// host leaves -> migration
A.ws.close();
const h = await B.wait((m) => m.t === 'host');
if (h.id !== roomB.you) fail('host migration');
await B.wait((m) => m.t === 'leave');
B.ws.close(); C.ws.close();
await new Promise((r) => setTimeout(r, 100));
const h2 = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
if (h2.rooms !== 0) fail('room cleanup ' + JSON.stringify(h2));
console.log('ALL SERVER TESTS OK');
srv.kill();
process.exit(0);
