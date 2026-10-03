// Online duels: two browsers play one pvp Battle in lockstep. The battle is deterministic (seeded rolls,
// same unit order), so peers only exchange the commands each player makes, numbered by their index in
// the shared action log. A gap (lost message) is detected and filled by asking the other side for the log.
//
// Transports share one tiny interface: channel(topic) → { subscribe(), send(msg), onMessage(fn),
// track(meta), onPresence(fn(list)), close() }.
//  - SupabaseTransport: Supabase Realtime broadcast + presence (no database tables needed)
//  - LocalTransport: BroadcastChannel, for two tabs on one machine (?net=local) and for tests

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const LOBBY = 'wwt-lobby';
export const roomTopic = code => `wwt-room-${code}`;
export function makeCode(rand = Math.random) { let s = ''; for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)]; return s; }
export const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const uid = () => (globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2)).slice(0, 12);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ transports
export class LocalTransport {
  constructor({ heartbeat = 700, ttl = 2500 } = {}) { this.kind = 'local'; this.hb = heartbeat; this.ttl = ttl; }
  channel(topic) {
    const bc = new BroadcastChannel('wwt:' + topic), me = uid(), peers = new Map(), hb = this.hb, ttl = this.ttl;
    let onMsg = () => {}, onPres = () => {}, meta = null, timer = null, closed = false;
    const list = () => [...peers.values()].map(p => p.meta).concat(meta ? [meta] : []);
    const emitPres = () => onPres(list());
    const beat = () => { if (meta && !closed) bc.postMessage({ k: 'p', from: me, meta }); };
    bc.onmessage = ({ data }) => {
      if (closed || data.from === me) return;
      if (data.k === 'm') onMsg(data.payload);
      else if (data.k === 'p') { const had = peers.has(data.from); peers.set(data.from, { meta: data.meta, at: Date.now() }); if (!had) { emitPres(); beat(); } }
      else if (data.k === 'q') beat();
      else if (data.k === 'l') { if (peers.delete(data.from)) emitPres(); }
    };
    return {
      async subscribe() {
        timer = setInterval(() => {
          beat();
          let gone = false;
          for (const [k, p] of peers) if (Date.now() - p.at > ttl) { peers.delete(k); gone = true; }
          if (gone) emitPres();
        }, hb);
        bc.postMessage({ k: 'q', from: me });
      },
      send(payload) { if (!closed) bc.postMessage({ k: 'm', from: me, payload }); },
      onMessage(fn) { onMsg = fn; },
      onPresence(fn) { onPres = fn; },
      track(m) { meta = m; beat(); emitPres(); },
      untrack() { meta = null; if (!closed) bc.postMessage({ k: 'l', from: me }); emitPres(); },
      close() { if (closed) return; this.untrack?.(); closed = true; clearInterval(timer); bc.close(); },
    };
  }
}

export class SupabaseTransport {
  constructor(config) { this.kind = 'supabase'; this.config = config; this.sb = null; }
  async client() {
    if (this.sb) return this.sb;
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    this.sb = createClient(this.config.supabaseUrl, this.config.supabasePublishableKey);
    return this.sb;
  }
  channel(topic) {
    const key = uid();
    let ch = null, onMsg = () => {}, onPres = () => {};
    const self = this;
    return {
      async subscribe() {
        const sb = await self.client();
        ch = sb.channel(topic, { config: { broadcast: { self: false }, presence: { key } } });
        ch.on('broadcast', { event: 'm' }, ({ payload }) => onMsg(payload));
        ch.on('presence', { event: 'sync' }, () => onPres(Object.values(ch.presenceState()).flat()));
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Timed out connecting to the online service.')), 12000);
          ch.subscribe((status, err) => {
            if (status === 'SUBSCRIBED') { clearTimeout(t); resolve(); }
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { clearTimeout(t); reject(new Error(err?.message || `Realtime channel ${status.toLowerCase()}`)); }
          });
        });
      },
      send(payload) { ch?.send({ type: 'broadcast', event: 'm', payload }); },
      onMessage(fn) { onMsg = fn; },
      onPresence(fn) { onPres = fn; },
      track(meta) { return ch?.track(meta); },
      untrack() { return ch?.untrack(); },
      close() { if (ch) { const c = ch; ch = null; c.untrack().catch(() => {}); self.sb.removeChannel(c); } },
    };
  }
}

/** Pick the transport for this page: ?net=local → BroadcastChannel, else Supabase when configured. */
export function pickTransport(config, search = globalThis.location?.search || '') {
  const q = new URLSearchParams(search);
  if (q.get('net') === 'local') return new LocalTransport();
  if (q.has('offline') || !config?.supabaseUrl || !config?.supabasePublishableKey) return null;
  return new SupabaseTransport(config);
}

// ------------------------------------------------------------------ match
/**
 * One online match. Events (assign the on* fields):
 *   onStatus(text)        lobby progress for the UI
 *   onStart(setup)        { seed, mySide, names: {player, enemy}, parties: {player, enemy}, code }
 *   onCommand(cmd)        a command from the opponent, in order
 *   onOpponent(present)   opponent dropped / came back
 *   onRematch()           the opponent asks for a rematch
 *   onLeft()              the opponent left for good
 * attach({ logLength: () => n, log: () => actions }) links the battle so gaps can be repaired.
 */
export class OnlineMatch {
  constructor(transport, { name, party, pingMs = 4000 }) {
    this.t = transport; this.pingMs = pingMs; this.name = name || 'Player'; this.party = party; this.id = uid();
    this.room = null; this.lobby = null; this.role = null; this.code = null; this.peer = null; this.setup = null;
    this.expect = 0; this.buffer = new Map(); this.linked = null; this.present = false; this.closed = false;
    this.wantRematch = false; this.peerRematch = false;
    this.onStatus = this.onStart = this.onCommand = this.onOpponent = this.onRematch = this.onLeft = () => {};
  }

  attach(linked) { this.linked = linked; this.expect = linked.logLength(); this.buffer.clear(); }

  async openRoom(code) {
    this.code = code;
    this.room = this.t.channel(roomTopic(code));
    this.room.onMessage(m => this.handle(m));
    this.room.onPresence(list => this.presence(list));
    await this.room.subscribe();
    await this.room.track({ id: this.id, name: this.name, role: this.role });
  }

  /** Create a room and wait for a guest. Resolves once the room is open. */
  async host(code = makeCode()) {
    this.role = 'host';
    await this.openRoom(code);
    this.onStatus(`Room <b>${code}</b> is open. Waiting for an opponent…`);
    return code;
  }

  /** Join a room by code. Resolves when the host has started the match; rejects if nobody answers. */
  async join(code, { timeout = 9000 } = {}) {
    this.role = 'guest';
    await this.openRoom(code);
    this.onStatus(`Joining room <b>${code}</b>…`);
    const until = Date.now() + timeout;
    while (!this.setup && !this.closed && !this.rejected && Date.now() < until) {
      this.room.send({ t: 'hello', from: this.id, name: this.name, party: this.party });
      await sleep(700);
    }
    if (this.setup) return this.setup;
    const why = this.rejected ? 'That room already has two players.' : `No open room called ${code}.`;
    this.leaveRoom();
    throw new Error(why);
  }

  /** Pair with any waiting player, or open a room and advertise it in the lobby. */
  async quickMatch({ settle = 1500 } = {}) {
    const lobby = this.t.channel(LOBBY);
    this.lobby = lobby;
    let waiting = [];
    lobby.onPresence(list => { waiting = list.filter(p => p.id !== this.id && p.state === 'waiting'); this.checkLobby?.(waiting); });
    lobby.onMessage(() => {});
    this.onStatus('Looking for an opponent…');
    await lobby.subscribe();
    await sleep(settle);
    const tried = new Set();
    for (;;) {
      if (this.closed) return null;
      const open = waiting.filter(p => !tried.has(p.code)).sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
      if (!open.length) break;
      const p = open[0];
      tried.add(p.code);
      try { this.onStatus(`Found <b>${p.name}</b>, joining…`); await this.join(p.code, { timeout: 5000 }); this.leaveLobby(); return this.setup; }
      catch { this.rejected = false; }
    }
    // nobody waiting: host and advertise. If an older host shows up (both searched at once), join theirs.
    const code = await this.host();
    const since = Date.now();
    await lobby.track({ id: this.id, name: this.name, code, since, state: 'waiting' });
    this.onStatus('Waiting for an opponent to join… (anyone pressing Quick Match will be paired with you)');
    return new Promise(resolve => {
      this.resolveQuick = resolve;
      this.checkLobby = list => {
        if (this.peer || this.closed || this.switching) return;
        const older = list.filter(p => p.since < since || (p.since === since && p.id < this.id)).sort((a, b) => a.since - b.since)[0];
        if (!older) return;
        this.switching = true;
        this.leaveRoom(); lobby.untrack();
        this.join(older.code, { timeout: 5000 })
          .then(s => { this.leaveLobby(); resolve(s); })
          .catch(async () => {
            this.switching = false; this.rejected = false;
            await this.host(code); await lobby.track({ id: this.id, name: this.name, code, since, state: 'waiting' });
          });
      };
      this.checkLobby(waiting);
    });
  }

  leaveLobby() { this.checkLobby = null; this.lobby?.close(); this.lobby = null; }
  leaveRoom() { this.room?.close(); this.room = null; this.setup = null; this.peer = null; }

  /** Leave everything (menu / window closed). */
  close() {
    if (this.closed) return;
    try { this.room?.send({ t: 'bye', from: this.id }); } catch {}
    this.closed = true; clearInterval(this.pinger);
    this.leaveLobby(); this.leaveRoom();
  }

  send(msg) { this.room?.send({ ...msg, from: this.id }); }

  /** Host only: start (or restart for a rematch) the battle. */
  begin(seed = Math.floor(Math.random() * 1e9)) {
    const setup = { seed, code: this.code, names: { player: this.name, enemy: this.peer.name }, parties: { player: this.party, enemy: this.peer.party } };
    this.send({ t: 'start', to: this.peer.id, setup });
    this.started({ ...setup, mySide: 'player' });
  }

  started(setup) {
    this.setup = setup; this.expect = 0; this.buffer.clear(); this.wantRematch = this.peerRematch = false; this.present = true;
    this.resolveQuick?.(setup); this.resolveQuick = null;
    if (this.lobby) this.leaveLobby();
    clearInterval(this.pinger);
    this.pinger = setInterval(() => { if (this.linked) this.send({ t: 'ping', n: this.linked.logLength() }); }, this.pingMs);
    this.onStart(setup);
  }

  /** Log entries we already hold: applied (log length) or accepted and still animating (expect). */
  have() { return Math.max(this.expect, this.linked?.logLength() ?? 0); }

  /** Send one of our own commands; seq is its index in the shared log (defaults to the next one). */
  sendCommand(cmd, seq = this.have()) {
    this.expect = Math.max(this.expect, seq + 1);
    this.send({ t: 'cmd', seq, cmd });
  }

  requestRematch() {
    this.wantRematch = true;
    this.send({ t: 'rematch' });
    if (this.peerRematch && this.role === 'host') this.begin();
  }

  presence(list) {
    if (!this.peer) return;
    const here = list.some(p => p.id === this.peer.id);
    if (here !== this.present) { this.present = here; this.onOpponent(here); if (here && this.linked) this.send({ t: 'ping', n: this.linked.logLength() }); }
  }

  accept(seq, cmd) {
    const have = this.have();
    if (seq < have) return;                           // duplicate, or one of our own entries echoed back
    if (seq > have) {                                 // gap: keep it and ask for what we missed
      this.buffer.set(seq, cmd);
      this.send({ t: 'sync', since: have });
      return;
    }
    this.expect = seq + 1;
    this.onCommand(cmd);
    for (const [k, c] of [...this.buffer].sort((a, b) => a[0] - b[0])) {
      if (k < this.expect) { this.buffer.delete(k); continue; }
      if (k > this.expect) break;
      this.buffer.delete(k); this.expect = k + 1; this.onCommand(c);
    }
  }

  handle(m) {
    if (this.closed || !m || m.from === this.id) return;
    if (m.to && m.to !== this.id) return;
    switch (m.t) {
      case 'hello':
        if (this.role !== 'host') return;
        if (!this.peer) {
          this.peer = { id: m.from, name: String(m.name || 'Rival').slice(0, 20), party: m.party };
          this.lobby?.untrack();
          this.begin();
        } else if (this.peer.id === m.from && this.setup) {
          this.send({ t: 'start', to: m.from, setup: { ...this.setup, mySide: undefined } }); // their hello crossed our start
        } else if (this.peer.id !== m.from) this.send({ t: 'full', to: m.from });
        return;
      case 'start':
        if (this.role !== 'guest') return;
        this.peer = { id: m.from, name: m.setup.names.player, party: m.setup.parties.player };
        if (this.setup && this.setup.seed === m.setup.seed) return;
        this.started({ ...m.setup, mySide: 'enemy' });
        return;
      case 'full': this.rejected = true; return;
      case 'cmd': if (this.setup && m.from === this.peer?.id) this.accept(m.seq, m.cmd); return;
      case 'sync':
        if (!this.linked || m.from !== this.peer?.id) return;
        { const log = this.linked.log(); this.send({ t: 'log', since: m.since, cmds: log.slice(m.since) }); }
        return;
      case 'log':
        if (m.from !== this.peer?.id) return;
        m.cmds.forEach((c, i) => this.accept(m.since + i, c));
        return;
      case 'ping':
        if (this.linked && m.from === this.peer?.id && m.n > this.have()) this.send({ t: 'sync', since: this.have() });
        return;
      case 'rematch':
        if (m.from !== this.peer?.id) return;
        this.peerRematch = true; this.onRematch();
        if (this.wantRematch && this.role === 'host') this.begin();
        return;
      case 'bye':
        if (m.from === this.peer?.id) { this.present = false; this.onLeft(); }
        return;
    }
  }
}
