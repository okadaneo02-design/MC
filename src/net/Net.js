/**
 * All-web-based multiplayer transport.
 *
 * Both players load the game from the host's Ruby server over the same WiFi; that
 * same server runs a tiny WebSocket relay (see tools/serve.rb) on port+1. This
 * class is a thin wrapper over a relay room: connect, send JSON, receive JSON.
 * No Node, no external hosts, no signaling dance — the relay just forwards
 * messages between the (up to two) peers sharing a room code.
 */
export class Net {
  constructor() {
    this.ws = null;
    this.room = null;
    this.isHost = false;
    this.connected = false;
    this.peerCount = 0;
    this._handlers = new Set();
    this._peerFn = null;
  }

  get wsUrl() {
    const base = (parseInt(location.port || '80', 10) || 80) + 1;
    return `ws://${location.hostname}:${base}/?room=${encodeURIComponent(this.room)}`;
  }

  connect(room, isHost) {
    this.room = room;
    this.isHost = isHost;
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.wsUrl); } catch (e) { reject(e); return; }
      this.ws = ws;
      const to = setTimeout(() => { if (!this.connected) { try { ws.close(); } catch {} reject(new Error('Timed out reaching the relay.')); } }, 5000);
      ws.onopen = () => { this.connected = true; clearTimeout(to); resolve(); };
      ws.onerror = () => { if (!this.connected) { clearTimeout(to); reject(new Error('Could not reach the relay on this network.')); } };
      ws.onclose = () => { this.connected = false; this._emit({ t: '__closed' }); };
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === '__peers') { this.peerCount = msg.n; this._peerFn && this._peerFn(msg.n); }
        this._emit(msg);
      };
    });
  }

  onMessage(fn) { this._handlers.add(fn); return () => this._handlers.delete(fn); }
  onPeers(fn) { this._peerFn = fn; }
  _emit(msg) { for (const fn of this._handlers) fn(msg); }

  send(obj) {
    if (this.ws && this.connected) {
      try { this.ws.send(JSON.stringify(obj)); } catch {}
    }
  }

  close() {
    try { this.ws && this.ws.close(); } catch {}
    this.ws = null;
    this.connected = false;
    this.peerCount = 0;
  }
}
