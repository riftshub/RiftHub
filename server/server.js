// Backrooms co-op server: serves the web build and relays game state between players in rooms.
// Zero dependencies — runs on Render with `node server/server.js`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocket } from './ws.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WWW = path.resolve(__dirname, '..', 'www');
const PORT = process.env.PORT || 10000;
const MAX_PLAYERS = 8;
const MAX_ROOMS = 500;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

const rooms = new Map();
let nextPlayer = 1;

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

const server = http.createServer((req, res) => {
  cors(res);
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.players.size, 0) }));
    return;
  }
  let file = path.normalize(path.join(WWW, url === '/' ? 'index.html' : url));
  if (!file.startsWith(WWW)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

function broadcast(room, msg, except) {
  const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const p of room.players.values()) if (p !== except) p.conn.send(s);
}

function leave(player) {
  const room = player.room;
  if (!room) return;
  room.players.delete(player.id);
  player.room = null;
  if (!room.players.size) { rooms.delete(room.code); return; }
  broadcast(room, { t: 'leave', id: player.id });
  if (room.host === player.id) {
    room.host = room.players.keys().next().value;
    broadcast(room, { t: 'host', id: room.host });
  }
}

function roomInfo(room, you) {
  return { t: 'room', code: room.code, you, host: room.host, seed: room.seed, level: room.level, lseed: room.lseed, cycle: room.cycle, players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name })) };
}

const cleanName = (n) => String(n || 'Wanderer').replace(/[^\w \-.']/g, '').slice(0, 16) || 'Wanderer';

attachWebSocket(server, '/ws', (conn) => {
  const player = { id: 'p' + nextPlayer++, name: 'Wanderer', conn, room: null, tokens: 60, last: Date.now() };
  conn.on('message', (raw) => {
    // simple rate limit: ~60 msgs/sec sustained
    const now = Date.now();
    player.tokens = Math.min(120, player.tokens + ((now - player.last) / 1000) * 60);
    player.last = now;
    if (player.tokens < 1) return;
    player.tokens--;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    switch (m.t) {
      case 'ping': conn.send(JSON.stringify({ t: 'pong', ts: m.ts })); return;
      case 'create': {
        if (player.room) leave(player);
        if (rooms.size >= MAX_ROOMS) { conn.send(JSON.stringify({ t: 'err', msg: 'Server is full, try again later.' })); return; }
        player.name = cleanName(m.name);
        const room = { code: code(), host: player.id, players: new Map(), seed: (m.seed >>> 0) || (Math.random() * 2 ** 32) >>> 0, level: Math.max(0, Math.min(99, m.level | 0)), lseed: 0, cycle: 0, created: now };
        room.players.set(player.id, player);
        player.room = room;
        rooms.set(room.code, room);
        conn.send(JSON.stringify(roomInfo(room, player.id)));
        console.log(`room ${room.code} created by ${player.name}`);
        return;
      }
      case 'join': {
        const room = rooms.get(String(m.code || '').toUpperCase());
        if (!room) { conn.send(JSON.stringify({ t: 'err', msg: 'No room with that code.' })); return; }
        if (room.players.size >= MAX_PLAYERS) { conn.send(JSON.stringify({ t: 'err', msg: 'That room is full (8 players).' })); return; }
        if (player.room) leave(player);
        player.name = cleanName(m.name);
        room.players.set(player.id, player);
        player.room = room;
        conn.send(JSON.stringify(roomInfo(room, player.id)));
        broadcast(room, { t: 'join', id: player.id, name: player.name }, player);
        return;
      }
      default: break;
    }
    const room = player.room;
    if (!room) return;
    // relay messages; only the host may send entity snapshots and level changes
    if (m.t === 'ent' && room.host !== player.id) return;
    if (m.t === 'ev' && m.k === 'level') {
      if (room.host !== player.id) return;
      room.level = m.level | 0; room.lseed = m.lseed >>> 0; room.cycle = m.cycle | 0;
    }
    if (m.t === 'ev' && m.k === 'items' && room.host !== player.id) return;
    if (!['st', 'ent', 'ev'].includes(m.t)) return;
    m.from = player.id;
    broadcast(room, m, player);
  });
  conn.on('close', () => leave(player));
});

// keep connections alive through proxies and drop dead ones
setInterval(() => {
  for (const room of rooms.values()) for (const p of room.players.values()) {
    if (!p.conn.alive) { p.conn.close(1001); continue; }
    p.conn.ping();
  }
}, 25000);

server.listen(PORT, () => console.log(`Backrooms server on :${PORT} (serving ${WWW})`));
