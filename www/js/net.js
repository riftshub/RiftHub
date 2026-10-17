// Co-op networking client. Talks JSON over WebSocket to server/server.js (deployed on Render).
export class Net {
  constructor(onMessage, onStatus) {
    this.ws = null;
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.id = null;
    this.code = null;
    this.isHost = false;
    this.connected = false;
  }

  static wsUrl(base) {
    let u = (base || '').trim().replace(/\/+$/, '');
    if (!u) u = location.origin;
    if (u.startsWith('https://')) u = 'wss://' + u.slice(8);
    else if (u.startsWith('http://')) u = 'ws://' + u.slice(7);
    else if (!u.startsWith('ws')) u = 'wss://' + u;
    return u + '/ws';
  }

  // Render free instances sleep; hit the health endpoint first so the user sees "waking server".
  static async wake(base, onWait) {
    const http = (base || location.origin).trim().replace(/\/+$/, '').replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      try {
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(http + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(to);
        if (r.ok) return true;
      } catch (e) { /* still waking */ }
      onWait && onWait(Math.round((Date.now() - t0) / 1000));
      await new Promise((res) => setTimeout(res, 3000));
    }
    return false;
  }

  connect(base) {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(Net.wsUrl(base)); } catch (e) { reject(e); return; }
      this.ws = ws;
      const timer = setTimeout(() => { reject(new Error('Connection timed out')); try { ws.close(); } catch (e) { /* */ } }, 15000);
      ws.onopen = () => { clearTimeout(timer); this.connected = true; this.onStatus('connected'); this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: Date.now() }), 10000); resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('Could not reach the co-op server')); };
      ws.onclose = () => { this.connected = false; clearInterval(this.pingTimer); this.onStatus('closed'); };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'pong') { this.ping = Date.now() - m.ts; return; }
        if (m.t === 'room') { this.id = m.you; this.code = m.code; this.isHost = m.host === m.you; }
        if (m.t === 'host') this.isHost = m.id === this.id;
        this.onMessage(m);
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() { if (this.ws) { this.ws.onclose = null; this.ws.close(); } this.connected = false; this.ws = null; clearInterval(this.pingTimer); }
}
