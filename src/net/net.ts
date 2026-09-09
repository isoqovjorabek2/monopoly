import Peer, { type DataConnection } from 'peerjs';
import type { GameEvent } from '../game/types';
import {
  type ChatMessage, type Down, type RoomSnapshot, type Up,
  toPeerId, unwrap, wrap,
} from './protocol';

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
}

const friendlyError = (err: unknown): string => {
  const type = (err as { type?: string })?.type ?? '';
  switch (type) {
    case 'peer-unavailable':
      return 'That room is not active. Check the code, or ask for a fresh link.';
    case 'unavailable-id':
      return 'That room code is already taken.';
    case 'browser-incompatible':
      return 'This browser does not support the peer-to-peer connection this game needs.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the matchmaking service. Check your connection and try again.';
    case 'disconnected':
      return 'Disconnected from the matchmaking service.';
    default:
      return (err as { message?: string })?.message ?? 'Connection failed.';
  }
};

/* ------------------------------- host ------------------------------- */

export class HostNet {
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();   // playerId -> conn
  private lastSeen = new Map<string, number>();
  private pings = new Map<string, number>();
  private pingSent = new Map<string, number>();
  private timer: number | null = null;
  private seq = 0;

  constructor(private code: string, private h: HostHandlers) {}

  start(): void {
    this.h.onStatus('starting');
    const peer = new Peer(toPeerId(this.code), { debug: 0, config: ICE });
    this.peer = peer;

    peer.on('open', () => this.h.onStatus('online'));
    peer.on('error', (err) => this.h.onStatus('error', friendlyError(err)));
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
        if (!bound) {
          this.conns.set(msg.playerId, conn);
          this.lastSeen.set(msg.playerId, Date.now());
        }
        this.h.onUp(msg.playerId, msg);
        this.h.onPresence(msg.playerId, true, 0);
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
    this.broadcast({ t: 'ROOM', snapshot });
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

  constructor(
    private code: string,
    private me: { playerId: string; name: string; token: import('../game/types').TokenId },
    private h: GuestHandlers,
  ) {}

  start(): void {
    this.h.onStatus('connecting');
    const peer = new Peer({ debug: 0, config: ICE });
    this.peer = peer;

    peer.on('open', () => this.dial());
    peer.on('error', (err) => {
      if (this.closedByUs) return;
      this.h.onStatus('error', friendlyError(err));
    });
  }

  private dial(): void {
    if (!this.peer) return;
    const conn = this.peer.connect(toPeerId(this.code), { reliable: true });
    this.conn = conn;

    // No 'open' inside the window almost always means NAT traversal failed.
    this.timeout = window.setTimeout(() => {
      if (!conn.open && !this.closedByUs) {
        this.h.onStatus(
          'error',
          hasRelay
            ? 'Could not reach the host, directly or through the relay. Check the room code, and that the host still has the page open.'
            : 'Could not open a direct connection. Your network may be blocking it - try a different network or a phone hotspot.',
        );
      }
    }, CONNECT_TIMEOUT_MS);

    conn.on('open', () => {
      if (this.timeout) window.clearTimeout(this.timeout);
      this.retries = 0;
      this.h.onStatus('online');
      // Sending before 'open' silently drops the message, so HELLO goes here.
      this.send({ t: 'HELLO', playerId: this.me.playerId, name: this.me.name, token: this.me.token });
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

  private onLost(): void {
    if (this.closedByUs) return;
    if (this.retries >= 4) {
      this.h.onStatus('error', 'Lost the connection to the host and could not get it back.');
      return;
    }
    this.retries += 1;
    this.h.onStatus('reconnecting', `Reconnecting (attempt ${this.retries})...`);
    window.setTimeout(() => { if (!this.closedByUs) this.dial(); }, 800 * this.retries);
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
