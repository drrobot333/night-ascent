/**
 * Peer-to-peer session over WebRTC (PeerJS public broker, no game server).
 * The host owns the simulation; the guest sends its own transform + requests.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PREFIX = 'night-ascent-v1-';

export class Net {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.connected = false;
    this.onMessage = null;
    this.onConnect = null;
    this.onDisconnect = null;
    this.onError = null;
    this.code = null;
    this.rtt = 0;
    this._pingAt = 0;
  }

  async _loadPeer() {
    const mod = await import('peerjs');
    return mod.Peer || mod.default;
  }

  async host() {
    const Peer = await this._loadPeer();
    this.isHost = true;
    let code = '';
    for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    this.code = code;
    return new Promise((resolve, reject) => {
      const peer = new Peer(PREFIX + code, { debug: 0 });
      this.peer = peer;
      peer.on('open', () => resolve(code));
      peer.on('error', (e) => { if (this.onError) this.onError(e); reject(e); });
      peer.on('connection', (conn) => {
        if (this.conn) { conn.close(); return; }
        this._bind(conn);
      });
    });
  }

  async join(code) {
    const Peer = await this._loadPeer();
    this.isHost = false;
    this.code = code.toUpperCase();
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      this.peer = peer;
      let settled = false;
      const timeout = setTimeout(() => { if (!settled) { settled = true; reject(new Error('timeout')); } }, 15000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
        this._bind(conn, () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(); } });
      });
      peer.on('error', (e) => { if (!settled) { settled = true; clearTimeout(timeout); reject(e); } else if (this.onError) this.onError(e); });
    });
  }

  _bind(conn, onOpen) {
    this.conn = conn;
    conn.on('open', () => {
      this.connected = true;
      if (onOpen) onOpen();
      if (this.onConnect) this.onConnect();
    });
    conn.on('data', (d) => {
      if (d && d.t === 'ping') { this.send({ t: 'pong', at: d.at }); return; }
      if (d && d.t === 'pong') { this.rtt = performance.now() - d.at; return; }
      if (this.onMessage) this.onMessage(d);
    });
    conn.on('close', () => { this.connected = false; if (this.onDisconnect) this.onDisconnect(); });
    conn.on('error', (e) => { if (this.onError) this.onError(e); });
  }

  send(obj) {
    if (this.conn && this.connected) { try { this.conn.send(obj); } catch (e) { /* drop */ } }
  }

  tick(now) {
    if (this.connected && now - this._pingAt > 2000) { this._pingAt = now; this.send({ t: 'ping', at: now }); }
  }

  close() {
    try { if (this.conn) this.conn.close(); } catch (e) { /* ignore */ }
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
    this.conn = null; this.peer = null; this.connected = false;
  }
}
