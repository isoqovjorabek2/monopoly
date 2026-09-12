import Peer, { type DataConnection } from 'peerjs';
import type { GameEvent } from '../game/types';
import type { CFEvent } from '../cashflow/types';
import {
  type ChatMessage, type Down, type RoomSnapshot, type Up,
  epochCode, localSecret, redactForGuests, toPeerId, unwrap, wrap,
} from './protocol';
import { tr } from '../i18n';

/* ------------------------------------------------------------------ *
 * Star topology, host-authoritative. Guests send intents and never
 * mutate their own game state; the host owns the only real copy and
 * broadcasts full snapshots. See ~/.claude/skills/p2p-netcode.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * ICE.
 *
 * STUN is enough for most pairs: it tells each browser what its public
 * address looks like from outside, and they meet in the middle. It cannot
 * help the rest - symmetric NAT, and firewalls that allow no inbound UDP
 * at all - because there is no middle to meet in. Those pairs need a relay
 * that both sides can reach outbound, and there is nothing to discover at
 * runtime on a static host, so one is configured at build time.
 *
 * Without VITE_TURN_URLS the game behaves exactly as it did before: STUN
 * only, and the 8-15% of pairs that cannot form a direct path are told so
 * rather than left spinning.
 *
 * A credential shipped in a static bundle is public - anyone who opens
 * devtools can read it, and there is no backend here to mint short-lived
 * ones. The defence is quotas and a restricted relay on the server side,
 * not secrecy. docs/turn.md sets that up.
 * ------------------------------------------------------------------ */

const TURN_URLS = (import.meta.env.VITE_TURN_URLS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME ?? '';
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL ?? '';

/** True when this build has a relay to fall back on. */
export const hasRelay = TURN_URLS.length > 0 && Boolean(TURN_USERNAME) && Boolean(TURN_CREDENTIAL);

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    // Last resort, and only ever used when a direct path fails: ICE tries
    // host and server-reflexive candidates first and picks a relay only if
    // nothing else connects, so this costs no bandwidth for the pairs that
    // would have worked anyway.
    ...(hasRelay
      ? [{ urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL }]
      : []),
  ],
};

const HEARTBEAT_MS = 5000;
const DEAD_AFTER_MS = 16000;
const CONNECT_TIMEOUT_MS = 15000;
/** How long a vanished host is given to come back - a refresh, a tunnel,
 *  a laptop lid - before the table is handed to somebody else. */
const HOST_RESUME_MS = 15000;
/** And how long each successor in turn gets to actually appear. */
const TAKEOVER_MS = 20000;
/** Generations a guest will look through when a room code seems dead: the
 *  table may have been handed over while this tab was away. */
const EPOCH_SEARCH = 5;

export type NetStatus =
  | 'idle' | 'starting' | 'online' | 'connecting'
  | 'reconnecting' | 'error' | 'closed';

export interface HostHandlers {
  onUp: (fromPlayerId: string, msg: Up) => void;
  onPresence: (playerId: string, connected: boolean, ping: number) => void;
  onStatus: (status: NetStatus, detail?: string) => void;
}

export interface GuestHandlers {
  onDown: (msg: Down) => void;
  onStatus: (status: NetStatus, detail?: string) => void;
  /** The host has been unreachable long enough to be treated as gone. Called
   *  once per waiting window, counting from 0, so the table can hand itself
   *  to the next player in line - or give up when the line runs out. */
  onHostGone?: (attempt: number) => void;
}

const friendlyError = (err: unknown): string => {
  const type = (err as { type?: string })?.type ?? '';
  const t = tr().net;
  switch (type) {
    case 'peer-unavailable':
      return t.unavailable;
    case 'unavailable-id':
      return t.taken;
    case 'browser-incompatible':
      return t.incompatible;
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return t.broker;
    case 'disconnected':
      return t.disconnected;
    default:
      return (err as { message?: string })?.message ?? t.failed;
  }
};

/* ------------------------------- host ------------------------------- */

export class HostNet {
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();   // playerId -> conn
  /* The secret each seat first presented. A later HELLO claiming that seat
   * has to match, so knowing another player's id (it is in every snapshot)
   * is not enough to take their seat or reconnect as them. */
  private secrets = new Map<string, string>();
  /* Seats that never arrive over the wire - the host's own and every bot's.
   * Their ids are in every snapshot too, and with no secret on file the
   * first HELLO claiming one would have been accepted: a guest could then
   * play the host's turns, change the rules, kick players, or drive a bot. */
  private reserved = new Set<string>();
  private lastSeen = new Map<string, number>();
  private pings = new Map<string, number>();
  private pingSent = new Map<string, number>();
  private timer: number | null = null;
  private seq = 0;
  private epoch: number;
  /** A host that has just refreshed finds its own id still registered for a
   *  few seconds. That is worth waiting out rather than failing the room. */
  private takenRetries = 0;

  constructor(
    private code: string,
    private h: HostHandlers,
    opts: { epoch?: number; secrets?: Record<string, string> } = {},
  ) {
    this.epoch = opts.epoch ?? 0;
    for (const [pid, secret] of Object.entries(opts.secrets ?? {})) this.secrets.set(pid, secret);
  }

  /** The seat secrets, to be handed back after a refresh so returning
   *  players keep proving who they are. */
  exportSecrets(): Record<string, string> {
    return Object.fromEntries(this.secrets);
  }

  /** Mark a seat as one no connection may ever claim. */
  reserve(playerId: string): void {
    this.reserved.add(playerId);
  }

  broadcastCfEvents(rev: number, events: CFEvent[]): void {
    if (events.length === 0) return;
    this.broadcast({ t: 'CF_EVENTS', rev, events });
  }

  start(): void {
    this.h.onStatus('starting');
    const peer = new Peer(toPeerId(epochCode(this.code, this.epoch)), { debug: 0, config: ICE });
    this.peer = peer;

    peer.on('open', () => { this.takenRetries = 0; this.h.onStatus('online'); });
    peer.on('error', (err) => {
      const type = (err as { type?: string })?.type;
      // Our own id from a moment ago, still held by the broker: wait for it.
      if (type === 'unavailable-id' && this.takenRetries < 8) {
        this.takenRetries += 1;
        if (this.peer === peer) {
          this.peer = null;
          try { peer.destroy(); } catch { /* already gone */ }
          window.setTimeout(() => { if (!this.peer) this.start(); }, 1500);
        }
        return;
      }
      this.h.onStatus('error', friendlyError(err));
    });
    peer.on('disconnected', () => {
      // The broker link dropped; existing data channels are unaffected.
      try { peer.reconnect(); } catch { /* nothing useful to do */ }
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => this.attach(conn));
      conn.on('error', () => this.drop(conn));
    });

    this.timer = window.setInterval(() => this.heartbeat(), HEARTBEAT_MS);
  }

  private attach(conn: DataConnection): void {
    conn.on('data', (raw) => {
      const msg = unwrap<Up>(raw);
      if (!msg) return;

      // A connection is bound to the playerId in its first HELLO. Every
      // later message is forced to that id, so a peer cannot act as another.
      const bound = this.idOf(conn);
      if (msg.t === 'HELLO') {
        const claimed = msg.playerId;
        // The host's own seat and every bot's are never claimable.
        if (typeof claimed !== 'string' || this.reserved.has(claimed)) {
          try { conn.send(wrap({ t: 'BYE', reason: 'seat_taken' })); } catch { /* gone */ }
          try { conn.close(); } catch { /* already gone */ }
          return;
        }
        const known = this.secrets.get(claimed);
        // Someone already holds this seat with a different secret: this is a
        // takeover attempt, not the seat's owner reconnecting. Turn it away
        // without touching the live connection that legitimately has the seat.
        if (known !== undefined && known !== (msg.secret ?? '')) {
          try { conn.send(wrap({ t: 'BYE', reason: 'seat_taken' })); } catch { /* gone */ }
          try { conn.close(); } catch { /* already gone */ }
          return;
        }
        if (known === undefined) this.secrets.set(claimed, msg.secret ?? '');
        // Bind this connection to the claimed id, dropping any stale mapping of
        // the same socket to a different id so one conn never holds two seats.
        if (bound && bound !== claimed) this.conns.delete(bound);
        this.conns.set(claimed, conn);
        this.lastSeen.set(claimed, Date.now());
        this.h.onUp(claimed, msg);
        this.h.onPresence(claimed, true, 0);
        return;
      }
      if (!bound) return;

      this.lastSeen.set(bound, Date.now());
      if (msg.t === 'PONG') {
        const sent = this.pingSent.get(bound);
        if (sent) this.pings.set(bound, Date.now() - sent);
        this.h.onPresence(bound, true, this.pings.get(bound) ?? 0);
        return;
      }
      this.h.onUp(bound, { ...msg, playerId: bound });
    });

    conn.on('close', () => this.drop(conn));
  }

  private idOf(conn: DataConnection): string | null {
    for (const [pid, c] of this.conns) if (c === conn) return pid;
    return null;
  }

  private drop(conn: DataConnection): void {
    const pid = this.idOf(conn);
    if (!pid) return;
    this.conns.delete(pid);
    this.h.onPresence(pid, false, 0);
  }

  private heartbeat(): void {
    const now = Date.now();
    this.seq += 1;
    for (const [pid, conn] of this.conns) {
      // A WebRTC channel can read as open long after the peer has gone, so
      // presence is decided by the heartbeat and never by conn.open alone.
      if (now - (this.lastSeen.get(pid) ?? now) > DEAD_AFTER_MS) {
        try { conn.close(); } catch { /* already gone */ }
        this.conns.delete(pid);
        this.h.onPresence(pid, false, 0);
        continue;
      }
      this.pingSent.set(pid, now);
      this.send(pid, { t: 'PING', seq: this.seq });
    }
  }

  send(playerId: string, msg: Down): void {
    const conn = this.conns.get(playerId);
    if (!conn || !conn.open) return;
    try { conn.send(wrap(msg)); } catch { /* channel closed mid-send */ }
  }

  broadcast(msg: Down): void {
    for (const pid of this.conns.keys()) this.send(pid, msg);
  }

  broadcastRoom(snapshot: RoomSnapshot): void {
    // Guests get a copy with the RNG seed and undrawn decks removed, so the
    // snapshot cannot be read to predict rolls and cards.
    this.broadcast({ t: 'ROOM', snapshot: redactForGuests(snapshot) });
  }

  /** The first snapshot a guest receives on joining, redacted the same way. */
  welcome(playerId: string, snapshot: RoomSnapshot): void {
    this.send(playerId, { t: 'WELCOME', you: playerId, snapshot: redactForGuests(snapshot) });
  }

  broadcastEvents(rev: number, events: GameEvent[]): void {
    if (events.length === 0) return;
    this.broadcast({ t: 'EVENTS', rev, events });
  }

  broadcastChat(message: ChatMessage): void {
    this.broadcast({ t: 'CHAT', message });
  }

  kick(playerId: string): void {
    this.send(playerId, { t: 'BYE', reason: 'kicked' });
    const conn = this.conns.get(playerId);
    if (conn) { try { conn.close(); } catch { /* already gone */ } }
    this.conns.delete(playerId);
  }

  destroy(): void {
    this.broadcast({ t: 'BYE', reason: 'host_left' });
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    try { this.peer?.destroy(); } catch { /* already destroyed */ }
    this.peer = null;
    this.conns.clear();
    this.h.onStatus('closed');
  }
}

/* ------------------------------- guest ------------------------------ */

export class GuestNet {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private timeout: number | null = null;
  private retries = 0;
  private closedByUs = false;
  private epoch: number;
  private searchTo: number;
  /** Whether this tab has ever been in the room. Before that, a dead code is
   *  a wrong code; after it, it is a host that has gone away. */
  private everOpen = false;
  private lostAt = 0;
  private attempt = 0;

  constructor(
    private code: string,
    private me: { playerId: string; name: string; token: import('../game/types').TokenId },
    private h: GuestHandlers,
    epoch = 0,
  ) {
    this.epoch = epoch;
    this.searchTo = epoch + EPOCH_SEARCH;
  }

  /** The generation this tab is talking to, so it can be saved and resumed. */
  currentEpoch(): number {
    return this.epoch;
  }

  /** Point this guest at another host generation and start dialling it. */
  retarget(epoch: number): void {
    this.epoch = epoch;
    this.searchTo = epoch;
    this.lostAt = Date.now();
    this.retries = 0;
    this.dial();
  }

  start(): void {
    this.h.onStatus('connecting');
    const peer = new Peer({ debug: 0, config: ICE });
    this.peer = peer;

    peer.on('open', () => this.dial());
    peer.on('error', (err) => {
      if (this.closedByUs) return;
      if ((err as { type?: string })?.type === 'peer-unavailable') {
        // Nobody is answering on that id. Either the table has been handed on
        // since this tab last saw it, or the host is away and may come back.
        if (!this.everOpen && this.epoch < this.searchTo) {
          this.epoch += 1;
          this.dial();
          return;
        }
        if (this.everOpen) { this.onLost(); return; }
      }
      this.h.onStatus('error', friendlyError(err));
    });
  }

  private dial(): void {
    if (!this.peer || this.closedByUs) return;
    if (this.timeout) window.clearTimeout(this.timeout);
    const conn = this.peer.connect(toPeerId(epochCode(this.code, this.epoch)), { reliable: true });
    this.conn = conn;

    // No 'open' inside the window almost always means NAT traversal failed -
    // unless this tab was in the room a moment ago, in which case the host
    // going quiet is the likelier story, and one we can act on.
    this.timeout = window.setTimeout(() => {
      if (conn.open || this.closedByUs) return;
      if (this.everOpen) { this.onLost(); return; }
      this.h.onStatus('error', hasRelay ? tr().net.noRelay : tr().net.noDirect);
    }, CONNECT_TIMEOUT_MS);

    conn.on('open', () => {
      if (this.timeout) window.clearTimeout(this.timeout);
      this.retries = 0;
      this.everOpen = true;
      this.lostAt = 0;
      this.attempt = 0;
      this.h.onStatus('online');
      // Sending before 'open' silently drops the message, so HELLO goes here.
      this.send({
        t: 'HELLO',
        playerId: this.me.playerId,
        name: this.me.name,
        token: this.me.token,
        secret: localSecret(),
      });
    });

    conn.on('data', (raw) => {
      const msg = unwrap<Down>(raw);
      if (!msg) return;
      if (msg.t === 'PING') { this.send({ t: 'PONG', playerId: this.me.playerId, seq: msg.seq }); return; }
      this.h.onDown(msg);
    });

    conn.on('close', () => this.onLost());
    conn.on('error', () => this.onLost());
  }

  /**
   * The host stopped answering. Keep dialling for a while - a refreshing
   * host is back in a few seconds and keeps its id - and when that window
   * closes, tell the store, which decides who takes the table over.
   */
  private onLost(): void {
    if (this.closedByUs) return;
    const now = Date.now();
    if (!this.lostAt) this.lostAt = now;
    const waitMs = this.attempt === 0 ? HOST_RESUME_MS : TAKEOVER_MS;

    if (now - this.lostAt >= waitMs) {
      const attempt = this.attempt;
      this.attempt += 1;
      this.lostAt = now;
      if (this.h.onHostGone) { this.h.onHostGone(attempt); return; }
      this.h.onStatus('error', tr().net.lost);
      return;
    }

    this.retries += 1;
    this.h.onStatus('reconnecting', tr().net.reconnecting(this.retries));
    window.setTimeout(() => { if (!this.closedByUs) this.dial(); }, 1200);
  }

  send(msg: Up): void {
    if (!this.conn || !this.conn.open) return;
    try { this.conn.send(wrap(msg)); } catch { /* channel closed mid-send */ }
  }

  destroy(): void {
    this.closedByUs = true;
    if (this.timeout) window.clearTimeout(this.timeout);
    try { this.conn?.close(); } catch { /* already closed */ }
    try { this.peer?.destroy(); } catch { /* already destroyed */ }
    this.conn = null;
    this.peer = null;
    this.h.onStatus('closed');
  }
}
