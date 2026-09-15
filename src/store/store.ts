import { create } from 'zustand';
import { play, type SfxName } from '../audio/sfx';
import { botDecide, botDelay } from '../game/ai';
import { createGame, handOverSeat, reduce, type SeatSpec } from '../game/engine';
import { logLine, type LogLine } from '../game/describe';
import { tr } from '../i18n';
import { clockKey, clockSeconds, legalActions, waitingOn } from '../game/rules';
import { randomSeed } from '../game/rng';
import { BOT_NAMES, PLAYER_COLORS, TOKENS, defaultSettings } from '../game/settings';
import type { GameAction, GameEvent, GameSettings, GameState, TokenId } from '../game/types';
import { botDecide as cfBotDecide, botDelay as cfBotDelay } from '../cashflow/ai';
import { cfLogLine, type CFLogLine } from '../cashflow/describe';
import {
  CF_DEFAULTS, createCashflow, handOverSeat as cfHandOverSeat, reduce as cfReduce,
} from '../cashflow/engine';
import {
  clockKey as cfClockKey, clockSeconds as cfClockSeconds, currentId as cfCurrentId,
  waitingOn as cfWaitingOn,
} from '../cashflow/rules';
import type { CFAction, CFEvent, CFRules, CFSettings, CFState } from '../cashflow/types';
import { GuestNet, HostNet, type NetStatus } from '../net/net';
import { currentAccount, isAccountId, signOut, useAccount } from '../net/account';
import { fetchTable, membersOf, uploadTable } from '../net/saves';
import { announce as announceRoom, close as closeRoom } from '../net/directory';
import {
  type ChatMessage, type Down, type GameKind, type RoomSnapshot, type SeatInfo, type Up,
  cleanText, generateRoomCode, localPlayerId, rehydrateForHost,
} from '../net/protocol';
import type { TakeoverPolicy } from '../game/types';

export type Screen = 'home' | 'lobby' | 'game';
export type Role = 'host' | 'guest' | 'local';
export type AnyAction = GameAction | CFAction;

/** A floating +$200 / -$450 over a player's card. */
export interface CashFloat { id: string; playerId: string; delta: number }

/** Cashflow has room for six: its player rail and its board are drawn
 *  for that many, and there are only so many professions to go round. */
export const CF_MAX_SEATS = 6;

export const CF_RULES_DEFAULT: CFRules = {
  strictLoans: CF_DEFAULTS.strictLoans,
  turnLimit: CF_DEFAULTS.turnLimit,
  fastGoal: CF_DEFAULTS.fastGoal,
};

/** Seats a room can hold, which depends on the game it plays. */
export const seatLimit = (room: RoomSnapshot): number =>
  (room.kind === 'cashflow' ? Math.min(room.settings.maxPlayers, CF_MAX_SEATS) : room.settings.maxPlayers);

interface Store {
  screen: Screen;
  role: Role;
  code: string;
  /** Whether this room is announced in the public directory. Host only. */
  listed: boolean;
  me: { playerId: string; name: string; token: TokenId };
  /** Which game the front door has selected. Remembered between visits. */
  pick: GameKind;

  room: RoomSnapshot | null;
  log: LogLine[];
  cfLog: CFLogLine[];
  chat: ChatMessage[];
  floats: CashFloat[];

  netStatus: NetStatus;
  netError: string | null;
  /** A room that turned this tab away because its game had started and the
   *  player was not signed in. Signing in picks the join straight back up. */
  retryCode: string | null;

  /** Board positions the renderer draws, which lag state while a token walks. */
  animPos: Record<string, number>;
  /** Dice currently tumbling, for the roll animation. */
  rolling: boolean;
  /** Deed the player has opened for inspection. */
  inspecting: number | null;
  /** Which side panel is open on small screens. */
  sheet: 'none' | 'players' | 'log' | 'manage' | 'trade';
  soundOn: boolean;

  setPick: (kind: GameKind) => void;
  setProfile: (name: string, token: TokenId) => void;
  /** Open a table. `listed` puts it on the public list from the start; a
   *  host can still change that from the lobby. */
  hostRoom: (settings?: GameSettings, kind?: GameKind, opts?: { listed?: boolean }) => void;
  /** List this room publicly, or take it off the list. Host only. */
  setListed: (on: boolean) => void;
  joinRoom: (code: string, epoch?: number) => void;
  playSolo: (kind?: GameKind) => void;
  leave: () => void;
  /** Pick up the table saved in this browser. `auto` only resumes one saved
   *  moments ago - a refresh or a crash, rather than a game left yesterday. */
  resumeSaved: (auto?: boolean) => void;

  updateSettings: (patch: Partial<GameSettings>) => void;
  updateCfRules: (patch: Partial<CFRules>) => void;
  addBot: () => void;
  removeSeat: (playerId: string) => void;
  startGame: () => void;

  dispatch: (action: AnyAction) => void;
  sendChat: (text: string) => void;
  /** A signed-in watcher takes over a bot's seat - or asks to. */
  takeSeat: (target: string) => void;
  /** The host lets a waiting watcher take the seat they asked for, or not. */
  answerSeatRequest: (uid: string, allow: boolean) => void;
  /** Pick a saved table back up: rejoin it if somebody is hosting it, and
   *  host it from the server's copy if nobody is. */
  resumeTable: (code: string, epoch: number) => void;
  /** After a game ends: the same table, back in its lobby, for another. */
  rematch: () => void;

  inspect: (spaceId: number | null) => void;
  openSheet: (sheet: Store['sheet']) => void;
  toggleSound: () => void;
}

/* ------------------------------------------------------------------ *
 * Host-side mutable context. Kept outside the store because it is
 * transport plumbing, not render state.
 * ------------------------------------------------------------------ */
let host: HostNet | null = null;
let guest: GuestNet | null = null;
let botTimer: number | null = null;
let walkTimer: number | null = null;
let clockTimer: number | null = null;
/** What the armed clock is timing (see clockKey), so an unrelated publish -
 *  the presence ping every few seconds, a chat line - does not restart it. */
let clockArmed = '';
/** Seconds a dropped player gets to come back before the table plays on
 *  without them, clock or no clock. */
const OFFLINE_GRACE_S = 30;
/* Heartbeat for the public directory. Module scope, not component state:
 * a room stays listed for as long as it is open, which outlives every
 * screen that can be unmounted while it is. */
let listTimer: number | null = null;
/** A host coming back late looks for the table before taking the chair back;
 *  this is what it falls back to when nobody else picked it up. */
let pendingHostResume: SavedGame | null = null;
/** Seat count as the directory last heard it, so a change can be sent at
 *  once rather than waiting out the heartbeat. */
let listedSeats = -1;
/* Uploading the table to the server: at most this often, and once more after
 * the last change so the save is never more than a beat behind. */
const UPLOAD_EVERY_MS = 30_000;
let uploadTimer: number | null = null;
let lastUpload = 0;
/** A table being resumed from the server's copy, if nobody answers for it. */
let pendingServerResume: string | null = null;
let logSeq = 0;

/* ------------------------------------------------------------------ *
 * The saved table.
 *
 * A game in progress lives in the host's tab and nowhere else, which used
 * to mean a refresh ended it for everybody. It is plain JSON by
 * construction, so it fits in localStorage and comes back with the tab.
 * A guest saves only where it was sitting - the host it rejoins still has
 * the game itself.
 * ------------------------------------------------------------------ */

const SAVE_KEY = 'mply.save';
const SAVE_V = 1;
/** A save this fresh is a refresh or a crash, and is picked up unasked. */
const AUTO_RESUME_MS = 90_000;
/** A host away longer than this may have been replaced at the table, so it
 *  looks for the game before sitting back down at the head of it. */
const HOST_SEAT_WARM_MS = 12_000;

export interface SavedGame {
  v: number;
  role: Role;
  code: string;
  epoch: number;
  kind: GameKind;
  room: RoomSnapshot | null;
  me: { playerId: string; name: string; token: TokenId };
  secrets: Record<string, string>;
  at: number;
}

export function readSave(): SavedGame | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedGame;
    if (!s || s.v !== SAVE_V || typeof s.code !== 'string' || !s.me?.playerId) return null;
    if (s.role !== 'guest' && !s.room) return null;
    return s;
  } catch {
    return null;
  }
}

export function forgetSave(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* private mode */ }
}

const savedName = (): string => {
  try { return localStorage.getItem('mply.name') ?? ''; } catch { return ''; }
};
const savedToken = (): TokenId => {
  try { return (localStorage.getItem('mply.token') as TokenId) ?? 'topper'; } catch { return 'topper'; }
};
const savedSound = (): boolean => {
  try { return localStorage.getItem('mply.sound') !== 'off'; } catch { return true; }
};
const savedPick = (): GameKind => {
  try { return localStorage.getItem('mply.game') === 'cashflow' ? 'cashflow' : 'monopoly'; } catch { return 'monopoly'; }
};

const emptySeat = (
  playerId: string, name: string, token: TokenId, index: number, isHost: boolean,
): SeatInfo => ({
  playerId,
  name,
  token,
  color: PLAYER_COLORS[index % PLAYER_COLORS.length],
  isBot: false,
  botLevel: 'normal',
  isHost,
  connected: true,
  ping: 0,
});

/** A room with no game in it yet, of either kind. */
const freshRoom = (
  code: string, hostSeat: SeatInfo, kind: GameKind, settings: GameSettings,
): RoomSnapshot => ({
  roomId: code,
  hostId: hostSeat.playerId,
  kind,
  seats: [hostSeat],
  settings,
  cfRules: { ...CF_RULES_DEFAULT },
  game: null,
  cf: null,
  epoch: 0,
  rev: 0,
});

export const useStore = create<Store>((set, get) => {
  /* ---------------------------- helpers ---------------------------- */

  /** One short cue per event worth hearing. Silence is the default for
   *  anything that fires more than once a turn. */
  const cueFor = (e: GameEvent, myId: string): SfxName | null => {
    switch (e.type) {
      case 'DICE_ROLLED': return 'dice';
      case 'BOUGHT': return 'buy';
      case 'BUILT': return 'build';
      case 'CARD_DRAWN': return 'card';
      case 'JAILED': return 'jail';
      case 'GAME_OVER': return 'win';
      case 'TURN_STARTED': return e.playerId === myId ? 'turn' : null;
      case 'RENT_PAID': return e.from === myId ? 'pay' : e.to === myId ? 'cash' : null;
      case 'PASSED_GO': return e.playerId === myId ? 'cash' : null;
      case 'DEBT_INCURRED': return e.playerId === myId ? 'error' : null;
      case 'TIMED_OUT': return e.playerId === myId ? 'error' : null;
      default: return null;
    }
  };

  const cfCueFor = (e: CFEvent, myId: string): SfxName | null => {
    const mine = 'playerId' in e && e.playerId === myId;
    switch (e.type) {
      case 'ROLLED': return 'dice';
      case 'CARD': return 'card';
      case 'BOUGHT_STOCK':
      case 'BOUGHT_HOLDING':
      case 'BUSINESS': return 'buy';
      case 'ESCAPED':
      case 'DREAM_BOUGHT':
      case 'GAME_OVER': return 'win';
      case 'TURN_STARTED': return mine ? 'turn' : null;
      case 'PAYDAY': return mine ? (e.amount >= 0 ? 'cash' : 'pay') : null;
      case 'CASHFLOW_DAY':
      case 'SOLD_STOCK':
      case 'SOLD_HOLDING': return mine ? 'cash' : null;
      case 'DOODAD':
      case 'LOSS':
      case 'DOWNSIZED':
      case 'REPAIR': return mine ? 'pay' : null;
      case 'BANKRUPT': return mine ? 'error' : null;
      default: return null;
    }
  };

  const spin = (speed: number): void => {
    set({ rolling: true });
    window.setTimeout(() => set({ rolling: false }), 700 / Math.max(speed, 0.25));
  };

  const addFloats = (floats: CashFloat[]): void => {
    if (floats.length === 0) return;
    set((s) => ({ floats: [...s.floats, ...floats] }));
    window.setTimeout(() => {
      const ids = new Set(floats.map((f) => f.id));
      set((s) => ({ floats: s.floats.filter((f) => !ids.has(f.id)) }));
    }, 1600);
  };

  const pushEvents = (state: GameState, events: GameEvent[]): void => {
    const lines: LogLine[] = [];
    const floats: CashFloat[] = [];
    const { soundOn, me } = get();
    for (const e of events) {
      const cue = cueFor(e, me.playerId);
      if (cue) play(cue, soundOn);
      const l = logLine(e, logSeq++);
      if (l) lines.push(l);
      if (e.type === 'MONEY' && Math.abs(e.delta) > 0) {
        floats.push({ id: `f${logSeq++}`, playerId: e.playerId, delta: e.delta });
      }
      if (e.type === 'MOVED') queueWalk(e.playerId, e.from, e.to, e.direct, state);
      if (e.type === 'DICE_ROLLED') spin(state.settings.animationSpeed);
    }
    if (lines.length > 0) set((s) => ({ log: [...s.log, ...lines].slice(-160) }));
    addFloats(floats);
  };

  /** Cashflow's log and sounds. Its money floats come from comparing the
   *  two snapshots instead (see cfFloats), which works the same for a
   *  guest, whose events and snapshot arrive as separate messages. */
  const pushCfEvents = (events: CFEvent[]): void => {
    if (events.length === 0) return;
    const lines: CFLogLine[] = [];
    const { soundOn, me } = get();
    for (const e of events) {
      const cue = cfCueFor(e, me.playerId);
      if (cue) play(cue, soundOn);
      const l = cfLogLine(e, logSeq++);
      if (l) lines.push(l);
      if (e.type === 'ROLLED') spin(1);
    }
    if (lines.length > 0) set((s) => ({ cfLog: [...s.cfLog, ...lines].slice(-200) }));
  };

  const cfFloats = (prev: CFState | null, next: CFState | null): void => {
    if (!prev || !next) return;
    const floats: CashFloat[] = [];
    for (const id of next.seats) {
      const delta = (next.players[id]?.cash ?? 0) - (prev.players[id]?.cash ?? 0);
      if (delta !== 0) floats.push({ id: `f${logSeq++}`, playerId: id, delta });
    }
    addFloats(floats);
  };

  /** Walk a token space by space. Teleports (cards) jump straight there. */
  const queueWalk = (
    playerId: string, from: number, to: number, direct: boolean, state: GameState,
  ): void => {
    if (direct || from === to) { set((s) => ({ animPos: { ...s.animPos, [playerId]: to } })); return; }
    const forward = ((to - from) % 40 + 40) % 40;
    const backward = forward > 20 ? forward - 40 : forward;
    const stepCount = Math.abs(backward);
    const dir = Math.sign(backward);
    const perStep = Math.max(70, 150 / Math.max(state.settings.animationSpeed, 0.25));

    let i = 0;
    if (walkTimer) window.clearInterval(walkTimer);
    set((s) => ({ animPos: { ...s.animPos, [playerId]: from } }));
    walkTimer = window.setInterval(() => {
      i += 1;
      const pos = ((from + dir * i) % 40 + 40) % 40;
      set((s) => ({ animPos: { ...s.animPos, [playerId]: pos } }));
      if (i >= stepCount) {
        if (walkTimer) window.clearInterval(walkTimer);
        walkTimer = null;
      }
    }, perStep);
  };

  const snapshot = (): RoomSnapshot | null => get().room;

  const publish = (next: RoomSnapshot, events: GameEvent[] = [], cfEvents: CFEvent[] = []): void => {
    const prevCf = get().room?.cf ?? null;
    const withRev = { ...next, rev: next.rev + 1 };
    set({ room: withRev });
    if (withRev.game) pushEvents(withRev.game, events);
    if (withRev.cf) { pushCfEvents(cfEvents); cfFloats(prevCf, withRev.cf); }
    if (get().role === 'host' && host) {
      host.broadcastEvents(withRev.rev, events);
      host.broadcastCfEvents(withRev.rev, cfEvents);
      host.broadcastRoom(withRev);
      // Somebody sat down or left. Twenty seconds of a wrong seat count is
      // how a lobby list earns its reputation for lying, and the fix costs
      // one request per actual change rather than per publish.
      if (get().listed && !withRev.game && !withRev.cf && withRev.seats.length !== listedSeats) beat();
    }
    scheduleBots();
    scheduleClock();
    writeSave();
    scheduleUpload();
  };

  /**
   * Whether this tab is the one that keeps the server's copy of the table.
   * The host does, if a signed-in player is hosting; otherwise the first
   * signed-in player in seat order who is still here does. Exactly one tab,
   * worked out from the same snapshot everywhere, so saves never race.
   */
  const keepsTheSave = (room: RoomSnapshot): boolean => {
    const account = currentAccount();
    if (!account || !(room.game || room.cf)) return false;
    const accountSeat = (seatId: string): boolean =>
      isAccountId(seatId) || Boolean(room.owners?.[seatId]);
    const me = get().me.playerId;
    if (!membersOf(room).includes(account.uid)) return false;
    if (accountSeat(room.hostId)) return room.hostId === me;
    const first = room.seats.find((s) => !s.isBot && s.connected && accountSeat(s.playerId));
    return first?.playerId === me;
  };

  const scheduleUpload = (): void => {
    const room = get().room;
    if (!room || !keepsTheSave(room)) return;
    const over = (room.game?.phase ?? room.cf?.phase) === 'game_over';
    const wait = over ? 0 : Math.max(0, lastUpload + UPLOAD_EVERY_MS - Date.now());
    if (uploadTimer && !over) return;
    if (uploadTimer) window.clearTimeout(uploadTimer);
    uploadTimer = window.setTimeout(() => {
      uploadTimer = null;
      lastUpload = Date.now();
      const latest = get().room;
      if (latest && keepsTheSave(latest)) void uploadTable(latest);
    }, wait);
  };

  /* ---------------------------- the save --------------------------- */

  const writeSave = (): void => {
    const { role, room, code, me } = get();
    const phase = room?.game?.phase ?? room?.cf?.phase;
    if (phase === 'game_over') { forgetSave(); return; }
    if (!room || !phase || phase === 'lobby') return;
    const save: SavedGame = {
      v: SAVE_V,
      role,
      code,
      epoch: role === 'guest' ? (guest?.currentEpoch() ?? room.epoch) : room.epoch,
      kind: room.kind,
      // A guest's copy is redacted and could not run the game anyway. The
      // seat is the part worth keeping.
      room: role === 'guest' ? null : room,
      me,
      secrets: host?.exportSecrets() ?? {},
      at: Date.now(),
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* quota, private mode */ }
  };

  /* ------------------------- becoming the host --------------------- */

  const startHost = (code: string, epoch: number, secrets?: Record<string, string>): void => {
    host = new HostNet(code, {
      onUp: handleUp,
      seatFor,
      onSeatKey: (playerId, hash) => {
        const cur = snapshot();
        if (!cur || cur.seatKeys?.[playerId] === hash) return;
        publish({ ...cur, seatKeys: { ...(cur.seatKeys ?? {}), [playerId]: hash } });
      },
      onPresence: (playerId, connected, ping) => {
        const cur = snapshot();
        if (!cur) return;
        // A watcher who leaves is simply gone; there is no seat to grey out,
        // and nothing left to ask the host on their behalf.
        const watchers = connected
          ? cur.watchers
          : cur.watchers?.filter((w) => w.uid !== playerId);
        const seatRequests = connected
          ? cur.seatRequests
          : cur.seatRequests?.filter((r) => r.uid !== playerId);
        publish({
          ...cur,
          watchers,
          seatRequests,
          seats: cur.seats.map((s) => (s.playerId === playerId ? { ...s, connected, ping } : s)),
        });
      },
      onStatus: (status, detail) => set({ netStatus: status, netError: detail ?? null }),
    }, { epoch, secrets, seatKeys: get().room?.seatKeys });
    // This tab plays from the host seat and never connects to itself, and a
    // bot never connects at all, so those seats can only ever be claimed by
    // somebody pretending to be them.
    host.reserve(get().me.playerId);
    const room = get().room;
    for (const seat of room?.seats ?? []) {
      // A bot a signed-in player has taken over is still never claimable by
      // id - only by that player's pass.
      const owner = room?.owners?.[seat.playerId];
      if (seat.isBot || owner) host.reserve(seat.playerId);
      if (owner) host.setOwner(seat.playerId, owner);
    }
    host.start();
  };

  /** The seat an account plays here: its own, or a bot it took over. */
  const seatFor = (uid: string): string => {
    const room = snapshot();
    const seat = room?.seats.find((s) => s.playerId === uid || room.owners?.[s.playerId] === uid);
    return seat?.playerId ?? uid;
  };

  /** Restore a table this tab was running, from its own save. */
  const restoreHost = (saved: SavedGame, epoch: number): void => {
    if (!saved.room) return;
    teardown();
    const room: RoomSnapshot = { ...saved.room, epoch };
    const positions: Record<string, number> = {};
    for (const id of room.game?.seats ?? []) positions[id] = room.game!.players[id].position;
    set({
      role: saved.role,
      code: saved.code,
      room,
      screen: 'game',
      animPos: positions,
      listed: false,
      log: [], cfLog: [], chat: [], netError: null,
      netStatus: saved.role === 'host' ? 'starting' : 'idle',
    });
    if (saved.role === 'host') startHost(saved.code, epoch, saved.secrets);
    publish(room);
  };

  /**
   * Host a saved table from the server's copy. The copy is the redacted one
   * every guest holds, so the dice and the undrawn cards are dealt afresh -
   * nobody at the table ever knew them. Everyone else comes back in as a
   * guest: their pass, or their seat's secret, finds their seat.
   */
  const restoreFromServer = async (code: string): Promise<void> => {
    const account = currentAccount();
    const saved = account ? await fetchTable(code) : null;
    if (!account || !saved) {
      set({ netStatus: 'error', netError: tr().net.unavailable });
      return;
    }
    const src = saved.room;
    const mine = src.seats.find((s) => s.playerId === account.uid || src.owners?.[s.playerId] === account.uid);
    if (!mine) {
      set({ netStatus: 'error', netError: tr().net.unavailable });
      return;
    }
    teardown();
    const epoch = Math.max(src.epoch, saved.epoch) + 1;
    const room = rehydrateForHost({
      ...src,
      epoch,
      hostId: mine.playerId,
      watchers: [],
      seatRequests: [],
      seats: src.seats.map((s) => ({
        ...s,
        isHost: s.playerId === mine.playerId,
        connected: s.isBot || s.playerId === mine.playerId,
      })),
    }, randomSeed());
    const positions: Record<string, number> = {};
    for (const id of room.game?.seats ?? []) positions[id] = room.game!.players[id].position;
    set((s) => ({
      role: 'host', code, room, screen: 'game', animPos: positions, listed: false,
      log: [], cfLog: [], chat: [], netError: null, netStatus: 'starting',
      me: { ...s.me, playerId: mine.playerId },
    }));
    startHost(code, epoch);
    publish(room);
  };

  /**
   * Who takes the table if the host does not come back. Every guest works
   * it out from the same snapshot - connected humans, in seat order, the
   * host excluded - so they all pick the same one without negotiating.
   */
  const successionLine = (room: RoomSnapshot): string[] =>
    room.seats
      .filter((s) => !s.isBot && s.connected && s.playerId !== room.hostId)
      .map((s) => s.playerId);

  /** This tab is next in line: run the table from the snapshot it holds. */
  const becomeHost = (epoch: number): void => {
    const { room, me, code } = get();
    if (!room) return;
    guest?.destroy();
    guest = null;
    const seats = room.seats.map((s) => ({
      ...s,
      isHost: s.playerId === me.playerId,
      // The host that left is away until it comes back as a guest.
      connected: s.playerId === room.hostId ? false : s.connected,
    }));
    // The shuffled decks and the dice seed went with the old host: they were
    // never ours to know, so the table deals fresh ones.
    const next = rehydrateForHost(
      { ...room, seats, hostId: me.playerId, epoch },
      randomSeed(),
    );
    set({ role: 'host', room: next, netStatus: 'starting', netError: tr().net.migrated });
    startHost(code, epoch);
    publish(next);
  };

  /** The host has been gone a while. Hand the table on, or say so plainly. */
  const onHostGone = (attempt: number): void => {
    const { room, me } = get();
    if (!room || !inGame(room)) {
      set({ netStatus: 'error', netError: tr().net.lost });
      return;
    }
    const line = successionLine(room);
    if (attempt >= line.length) {
      teardown();
      set({ netStatus: 'error', netError: tr().net.hostGone });
      return;
    }
    const epoch = room.epoch + 1 + attempt;
    if (line[attempt] === me.playerId) { becomeHost(epoch); return; }
    const who = room.seats.find((s) => s.playerId === line[attempt])?.name ?? tr().defaults.someone;
    set({ netStatus: 'reconnecting', netError: tr().net.migrating(who) });
    guest?.retarget(epoch);
  };

  /* --------------------------- bot driver -------------------------- */

  const scheduleBots = (): void => {
    if (botTimer) { window.clearTimeout(botTimer); botTimer = null; }
    const { role, room } = get();
    if (role === 'guest' || !room) return;

    if (room.cf) {
      const s = room.cf;
      if (s.phase === 'game_over' || s.phase === 'lobby') return;
      // Seats whose turn it is not go first: a bot selling into a card on
      // the table should not be beaten to it by the bot ending its turn.
      const cur = cfCurrentId(s);
      const order = [...room.seats.filter((x) => x.playerId !== cur), ...room.seats.filter((x) => x.playerId === cur)];
      for (const seat of order) {
        if (!seat.isBot) continue;
        const action = cfBotDecide(s, seat.playerId);
        if (!action) continue;
        botTimer = window.setTimeout(() => {
          botTimer = null;
          applyIntent(seat.playerId, action);
        }, cfBotDelay(s, seat.playerId));
        return;
      }
      return;
    }

    if (!room.game) return;
    const game = room.game;
    if (game.phase === 'game_over' || game.phase === 'lobby') return;

    for (const seat of room.seats) {
      if (!seat.isBot) continue;
      const action = botDecide(game, seat.playerId);
      if (!action) continue;
      botTimer = window.setTimeout(() => {
        botTimer = null;
        applyIntent(seat.playerId, action);
      }, botDelay(game, seat.playerId));
      return;
    }
  };

  /* ----------------------------- clock ----------------------------- */

  const stopClock = (): void => {
    if (clockTimer) window.clearTimeout(clockTimer);
    clockTimer = null;
    clockArmed = '';
  };

  /**
   * The turn and auction clocks, and the backstop for a player who has
   * dropped off the table. When one runs out the authority sends TIME_OUT
   * for that player and the engine makes their pending choices, so a closed
   * tab or an idle player can no longer stall everyone else.
   */
  const scheduleClock = (): void => {
    const { role, room } = get();
    const g = room?.game ?? null;
    const c = room?.cf ?? null;
    const phase = g?.phase ?? c?.phase;
    if (role === 'guest' || !room || !phase || phase === 'game_over' || phase === 'lobby') {
      stopClock();
      return;
    }
    // Both games answer the same three questions; only the rulebook differs.
    const players: Record<string, { isBot: boolean }> = g ? g.players : c!.players;
    const waiting = g ? waitingOn(g) : cfWaitingOn(c!);
    const humans = waiting.filter((id) => !players[id]?.isBot);
    const away = humans.filter((id) => room.seats.find((x) => x.playerId === id)?.connected === false);
    const limit = g ? clockSeconds(g) : cfClockSeconds(c!);
    let secs = limit > 0 ? limit : Infinity;
    if (away.length > 0) secs = Math.min(secs, OFFLINE_GRACE_S);
    if (humans.length === 0 || !Number.isFinite(secs)) { stopClock(); return; }

    const key = `${g ? clockKey(g) : cfClockKey(c!)}|${humans.join(',')}|${away.join(',')}`;
    if (key === clockArmed && clockTimer) return;
    stopClock();
    clockArmed = key;
    // At the full limit everyone the table is waiting on is played for; the
    // shorter grace only covers the ones who are not there.
    const due = limit > 0 && secs === limit ? humans : away;
    clockTimer = window.setTimeout(() => {
      clockTimer = null;
      clockArmed = '';
      for (const id of due) applyIntent(id, { type: 'TIME_OUT', playerId: id });
      scheduleClock();
    }, secs * 1000);
  };

  /** The single funnel every action goes through on the authority. The
   *  host's own clicks take this path too, so there is exactly one code
   *  path and no chance of the host diverging from everyone else. */
  const applyIntent = (playerId: string, action: AnyAction): void => {
    const room = snapshot();
    if (!room) return;
    if (!action || typeof action !== 'object' || action.playerId !== playerId) return; // spoofed actor

    if (room.kind === 'cashflow') {
      if (!room.cf) return;
      const { state, events } = cfReduce(room.cf, action as CFAction);
      if (state.version === room.cf.version) return;      // rejected, no-op
      publish({ ...room, cf: state }, [], events);
      return;
    }

    if (!room.game) return;
    const { state, events } = reduce(room.game, action as GameAction);
    if (state.version === room.game.version) return;      // rejected, no-op
    publish({ ...room, game: state }, events);
  };

  /* ------------------------- host: guest input --------------------- */

  const handleUp = (from: string, msg: Up): void => {
    const room = snapshot();
    if (!room) return;

    switch (msg.t) {
      case 'HELLO': {
        const name = cleanText(msg.name, 18) || tr().defaults.player;
        // Set only by the host's transport, after the pass checked out.
        const uid = msg.verified;
        const existing = room.seats.find((s) => s.playerId === from);
        if (existing) {
          // Reconnect: identity is the playerId, never the connection.
          const seats = room.seats.map((s) =>
            s.playerId === from ? { ...s, connected: true, name } : s);
          const next = { ...room, seats };
          set({ room: next });
          host?.welcome(from, next);
          host?.broadcastRoom(next);
          return;
        }
        if (room.game || room.cf) {
          // A game in progress takes signed-in players only: they come in
          // watching, and may take over a bot. A guest is told how to get in.
          if (!uid || from !== uid) {
            host?.refuse(from, 'sign_in_to_join');
            return;
          }
          const watchers = [...(room.watchers ?? []).filter((w) => w.uid !== uid), { uid, name }];
          const next = { ...room, watchers };
          host?.welcome(from, next);
          publish(next);
          return;
        }
        if (room.seats.length >= seatLimit(room)) {
          host?.refuse(from, 'room_full');
          return;
        }
        // Two players can easily arrive wanting the same piece (it is the
        // saved default), so the host hands out the nearest free one.
        const taken = new Set(room.seats.map((x) => x.token));
        const token = taken.has(msg.token)
          ? TOKENS.find((t) => !taken.has(t.id))?.id ?? msg.token
          : msg.token;
        const seat = emptySeat(from, name, token, room.seats.length, false);
        const next = { ...room, seats: [...room.seats, seat] };
        set({ room: next });
        host?.welcome(from, next);
        publish(next);
        return;
      }

      case 'PROFILE': {
        if (room.game || room.cf) return;
        const name = cleanText(msg.name, 18) || tr().defaults.player;
        const taken = new Set(room.seats.filter((x) => x.playerId !== from).map((x) => x.token));
        const token = taken.has(msg.token)
          ? room.seats.find((x) => x.playerId === from)?.token ?? msg.token
          : msg.token;
        publish({
          ...room,
          seats: room.seats.map((s) => (s.playerId === from ? { ...s, name, token } : s)),
        });
        return;
      }

      case 'SETTINGS':
        if (from !== room.hostId) return;
        publish({ ...room, settings: msg.settings, cfRules: msg.cfRules ?? room.cfRules });
        return;

      case 'ADD_BOT':
        if (from !== room.hostId) return;
        addBotSeat();
        return;

      case 'REMOVE_SEAT':
        if (from !== room.hostId) return;
        removeSeatById(msg.target);
        return;

      case 'INTENT':
        applyIntent(from, msg.action);
        return;

      case 'TAKE_SEAT':
        takeOverSeat(from, msg.target);
        return;

      case 'CHAT': {
        const text = cleanText(msg.text, 220);
        if (!text) return;
        const seat = room.seats.find((s) => s.playerId === from);
        const watcher = room.watchers?.find((w) => w.uid === from);
        const message: ChatMessage = {
          id: `c${logSeq++}`,
          from,
          name: seat?.name ?? watcher?.name ?? tr().defaults.player,
          color: seat?.color ?? '#fff',
          text,
          at: Date.now(),
        };
        set((s) => ({ chat: [...s.chat, message].slice(-80) }));
        host?.broadcastChat(message);
        return;
      }

      case 'PONG':
        return;
    }
  };

  /**
   * A watcher asks for a bot's seat. Everything is checked here, on the host:
   * the connection must be bound to its own account (a watcher who proved who
   * they are, not a seated player hopping chairs), the target must be a bot
   * still in the game, and the account must not already play a seat. Then the
   * table's policy decides: straight in, a question for the host, or no.
   */
  const takeOverSeat = (from: string, target: string): void => {
    const room = snapshot();
    if (!room || !host || typeof target !== 'string') return;
    const uid = host.accountOf(from);
    if (!uid || from !== uid) return;
    if (!mayTakeOver(room, uid, target)) return;
    const policy: TakeoverPolicy = room.settings.takeovers ?? 'ask';
    if (policy === 'off') return;
    if (policy === 'anyone') { applyTakeOver(uid, target); return; }
    const name = room.watchers?.find((w) => w.uid === uid)?.name ?? tr().defaults.player;
    // One question per watcher: asking for another bot replaces the first.
    publish({
      ...room,
      seatRequests: [...(room.seatRequests ?? []).filter((r) => r.uid !== uid), { uid, name, target }],
    });
  };

  const mayTakeOver = (room: RoomSnapshot, uid: string, target: string): boolean => {
    if (seatFor(uid) !== uid || room.seats.some((s) => s.playerId === uid)) return false;
    const seat = room.seats.find((s) => s.playerId === target);
    if (!seat || !seat.isBot) return false;
    if (room.game) return Boolean(room.game.players[target]) && !room.game.players[target].bankrupt;
    return Boolean(room.cf?.players[target]);
  };

  /** Hand the seat over, once whatever the table's policy asked for is met. */
  const applyTakeOver = (uid: string, target: string): void => {
    const room = snapshot();
    if (!room || !host) return;
    // Still here, still watching, and the bot still free.
    if (host.accountOf(uid) !== uid || !mayTakeOver(room, uid, target)) {
      publish({ ...room, seatRequests: (room.seatRequests ?? []).filter((r) => r.uid !== uid) });
      return;
    }
    const watcher = room.watchers?.find((w) => w.uid === uid);
    const name = watcher?.name ?? tr().defaults.player;

    let next: RoomSnapshot;
    let events: GameEvent[] = [];
    let cfEvents: CFEvent[] = [];
    if (room.game) {
      const r = handOverSeat(room.game, target, name);
      if (r.state === room.game) return;
      next = { ...room, game: r.state };
      events = r.events;
    } else if (room.cf) {
      const r = cfHandOverSeat(room.cf, target, name);
      if (r.state === room.cf) return;
      next = { ...room, cf: r.state };
      cfEvents = r.events;
    } else {
      return;
    }

    next = {
      ...next,
      seats: next.seats.map((s) => (s.playerId === target
        ? { ...s, isBot: false, name, connected: true, ping: 0 }
        : s)),
      owners: { ...(room.owners ?? {}), [target]: uid },
      watchers: (room.watchers ?? []).filter((w) => w.uid !== uid),
      // This watcher's question is answered, and nobody else can have that bot.
      seatRequests: (room.seatRequests ?? []).filter((r) => r.uid !== uid && r.target !== target),
    };
    // The seat stays reserved against guest claims; the pass is the way in.
    host.setOwner(target, uid);
    host.rebind(uid, target);
    publish(next, events, cfEvents);
    const published = snapshot();
    if (published) host.welcome(target, published);
  };

  /* ------------------------ guest: host output --------------------- */

  const inGame = (snap: RoomSnapshot): boolean => Boolean(snap.game || snap.cf);

  const handleDown = (msg: Down): void => {
    switch (msg.t) {
      case 'WELCOME':
        pendingServerResume = null;
        // The host says which seat this connection plays. Signed in, that is
        // wherever the account sits - its own id, a bot it took over, or its
        // own id again while it only watches.
        set((s) => ({
          room: msg.snapshot,
          screen: inGame(msg.snapshot) ? 'game' : 'lobby',
          me: typeof msg.you === 'string' ? { ...s.me, playerId: msg.you } : s.me,
          retryCode: null,
        }));
        writeSave();
        return;

      case 'ROOM': {
        const cur = get().room;
        // Out-of-order arrival is real; never go backwards - unless the table
        // has been handed on, which starts a fresh count under a new host.
        if (cur && msg.snapshot.epoch === cur.epoch && msg.snapshot.rev <= cur.rev) return;
        const wasInGame = Boolean(cur && inGame(cur));
        set({ room: msg.snapshot, screen: inGame(msg.snapshot) ? 'game' : 'lobby' });
        // The host started a rematch: last game's log is not this game's.
        if (wasInGame && !inGame(msg.snapshot)) set({ log: [], cfLog: [], animPos: {} });
        cfFloats(cur?.cf ?? null, msg.snapshot.cf);
        scheduleUpload();
        if (msg.snapshot.game && !wasInGame) {
          const pos: Record<string, number> = {};
          for (const id of msg.snapshot.game.seats) pos[id] = msg.snapshot.game.players[id].position;
          set({ animPos: pos });
        }
        writeSave();
        return;
      }

      case 'EVENTS': {
        const room = get().room;
        if (room?.game) pushEvents(room.game, msg.events);
        return;
      }

      case 'CF_EVENTS':
        pushCfEvents(msg.events);
        return;

      case 'CHAT':
        set((s) => ({ chat: [...s.chat, msg.message].slice(-80) }));
        return;

      case 'REJECT':
        set({ netError: msg.reason === 'seat_denied' ? tr().account.seatDenied : msg.reason });
        window.setTimeout(() => set({ netError: null }), 3000);
        return;

      case 'BYE': {
        const reason = tr().net.bye[msg.reason] ?? tr().net.failed;
        // Remember where this tab was trying to go, so signing in can go
        // straight back there.
        const retryCode = msg.reason === 'sign_in_to_join' ? get().code : null;
        if (msg.reason === 'auth_invalid') signOut();
        forgetSave();
        // A guest whose seat was refused as already-taken should not keep
        // trying to reconnect into the same rejection.
        teardown();
        set({ screen: 'home', netStatus: 'closed', netError: reason, room: null, retryCode });
        return;
      }

      case 'PING':
        return;
    }
  };

  /* ------------------------- lobby mutations ----------------------- */

  const addBotSeat = (): void => {
    const room = snapshot();
    if (!room || inGame(room)) return;
    if (room.seats.length >= seatLimit(room)) return;
    const used = new Set(room.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? tr().defaults.bot(room.seats.length + 1);
    const usedTokens = new Set(room.seats.map((s) => s.token));
    const token = TOKENS.find((t) => !usedTokens.has(t.id))?.id ?? 'thimble';
    const seat: SeatInfo = {
      ...emptySeat(`bot_${Math.random().toString(36).slice(2, 8)}`, name, token, room.seats.length, false),
      isBot: true,
      botLevel: room.settings.botLevel,
    };
    // A bot never connects, so nobody else may ever connect as it.
    host?.reserve(seat.playerId);
    publish({ ...room, seats: [...room.seats, seat] });
  };

  const removeSeatById = (playerId: string): void => {
    const room = snapshot();
    if (!room || inGame(room)) return;
    if (playerId === room.hostId) return;
    const seat = room.seats.find((s) => s.playerId === playerId);
    if (seat && !seat.isBot) host?.kick(playerId);
    publish({ ...room, seats: room.seats.filter((s) => s.playerId !== playerId) });
  };

  const teardown = (): void => {
    host?.destroy();
    guest?.destroy();
    host = null;
    guest = null;
    if (botTimer) window.clearTimeout(botTimer);
    if (walkTimer) window.clearInterval(walkTimer);
    botTimer = null;
    walkTimer = null;
    stopClock();
    stopListing();
  };

  /** Take the room off the public list and stop the heartbeat. */
  const stopListing = (): void => {
    if (listTimer) window.clearInterval(listTimer);
    listTimer = null;
    listedSeats = -1;
    const { code, listed } = get();
    if (listed && code) void closeRoom(code);
  };

  /** Announce now, then keep announcing. The directory forgets a room 45
   *  seconds after the last beat, so this is also what removes a room when
   *  the tab is closed without warning. */
  const beat = (): void => {
    const { room, listed, role } = get();
    if (!room || !listed || role !== 'host') return;
    // A started game stays on the list only while a signed-in player could
    // still come in and take over a bot. Once there is no seat to take, it
    // is no longer a table anyone can join.
    let live: { openSeats: number; round: number } | undefined;
    if (inGame(room)) {
      const g = room.game;
      const bots = g
        ? room.seats.filter((s) => s.isBot && g.players[s.playerId] && !g.players[s.playerId].bankrupt).length
        : 0;
      if (!g || g.phase === 'game_over' || bots === 0 || (room.settings.takeovers ?? 'ask') === 'off') {
        stopListing();
        return;
      }
      live = { openSeats: bots, round: g.round };
    }
    listedSeats = room.seats.length;
    void announceRoom({
      id: room.roomId,
      host: get().me.name || tr().defaults.someone,
      seats: room.seats.length,
      maxSeats: room.settings.maxPlayers,
      settings: room.settings,
      live,
    });
  };

  const startListing = (): void => {
    if (listTimer) window.clearInterval(listTimer);
    beat();
    listTimer = window.setInterval(beat, 20000);
  };

  /* ------------------------------ store ---------------------------- */

  return {
    screen: 'home',
    role: 'local',
    code: '',
    listed: false,
    me: { playerId: currentAccount()?.uid ?? localPlayerId(), name: savedName(), token: savedToken() },
    pick: savedPick(),

    room: null,
    log: [],
    cfLog: [],
    chat: [],
    floats: [],

    netStatus: 'idle',
    netError: null,
    retryCode: null,

    animPos: {},
    rolling: false,
    inspecting: null,
    sheet: 'none',
    soundOn: savedSound(),

    setPick: (kind) => {
      try { localStorage.setItem('mply.game', kind); } catch { /* private mode */ }
      set({ pick: kind });
    },

    setProfile: (name, token) => {
      const clean = cleanText(name, 18) || tr().defaults.player;
      try {
        localStorage.setItem('mply.name', clean);
        localStorage.setItem('mply.token', token);
      } catch { /* private mode */ }
      set((s) => ({ me: { ...s.me, name: clean, token } }));

      const { role, room, me } = get();
      if (role === 'guest') guest?.send({ t: 'PROFILE', playerId: me.playerId, name: clean, token });
      else if (room && !inGame(room)) {
        publish({
          ...room,
          seats: room.seats.map((s) => (s.playerId === me.playerId ? { ...s, name: clean, token } : s)),
        });
      }
    },

    hostRoom: (settings, kind = get().pick, opts = {}) => {
      teardown();
      const me = get().me;
      const code = generateRoomCode();
      const room = freshRoom(
        code,
        emptySeat(me.playerId, me.name || tr().defaults.host, me.token, 0, true),
        kind,
        { ...(settings ?? defaultSettings()), seed: randomSeed() },
      );
      set({
        role: 'host', code, room, screen: 'lobby',
        log: [], cfLog: [], chat: [], netError: null,
        // Private unless the host chose a public table on the way in.
        listed: false,
      });

      startHost(code, 0);
      // The directory only knows Monopoly's presets, so a Cashflow table
      // stays invite-only whatever was asked for.
      if (opts.listed && kind === 'monopoly') get().setListed(true);
    },

    joinRoom: (rawCode, epoch = 0) => {
      teardown();
      const me = get().me;
      const code = rawCode.trim().toUpperCase();
      set({
        role: 'guest', code, room: null, screen: 'lobby',
        log: [], cfLog: [], chat: [], netError: null, netStatus: 'connecting',
      });
      guest = new GuestNet(code, { playerId: me.playerId, name: me.name || tr().defaults.player, token: me.token }, {
        onDown: handleDown,
        onStatus: (status, detail) => {
          // A host that came back late and found no table still has its own
          // save: rather than an error, it sits back down at the head.
          if (status === 'error' && pendingHostResume) {
            const saved = pendingHostResume;
            pendingHostResume = null;
            restoreHost(saved, saved.epoch);
            return;
          }
          // Nobody is hosting a table this player saved: host it themselves.
          if (status === 'error' && pendingServerResume === code) {
            pendingServerResume = null;
            void restoreFromServer(code);
            return;
          }
          if (status === 'online') pendingHostResume = null;
          set({ netStatus: status, netError: detail ?? null });
        },
        onHostGone,
      }, epoch, () => {
        const account = currentAccount();
        return account ? { uid: account.uid, pass: account.pass } : null;
      });
      guest.start();
    },

    resumeSaved: (auto = false) => {
      if (get().room) return;
      const saved = readSave();
      if (!saved) return;
      if (auto && Date.now() - saved.at > AUTO_RESUME_MS) return;
      // The seat is held against the saved identity, so take that back first.
      // A signed-in player's seat comes back through their pass instead, and
      // a bot seat they took over is not an id this tab should ever wear as
      // a guest.
      if (saved.me.playerId.startsWith('p_')) {
        try { sessionStorage.setItem('mply.pid', saved.me.playerId); } catch { /* private mode */ }
      }
      set({ me: saved.me, pick: saved.kind });

      if (saved.role === 'guest') { get().joinRoom(saved.code, saved.epoch); return; }
      // A host who has only just gone is still expected on the same id. One
      // who has been away longer looks for the table first: somebody at it
      // may have picked it up, and two hosts would be worse than none.
      if (saved.role === 'local' || Date.now() - saved.at < HOST_SEAT_WARM_MS) {
        restoreHost(saved, saved.epoch);
        return;
      }
      pendingHostResume = saved;
      get().joinRoom(saved.code, saved.epoch + 1);
    },

    playSolo: (kind = get().pick) => {
      teardown();
      const me = get().me;
      const room = freshRoom(
        'LOCAL',
        emptySeat(me.playerId, me.name || tr().defaults.you, me.token, 0, true),
        kind,
        { ...defaultSettings(), fillWithBots: true },
      );
      set({
        role: 'local', code: '', room, screen: 'lobby',
        log: [], cfLog: [], chat: [], netError: null, netStatus: 'idle',
      });
      addBotSeat();
      addBotSeat();
    },

    leave: () => {
      teardown();
      forgetSave();
      pendingHostResume = null;
      set((s) => ({
        screen: 'home', role: 'local', room: null, code: '', listed: false,
        log: [], cfLog: [], chat: [], floats: [], animPos: {},
        netStatus: 'idle', netError: null, sheet: 'none', inspecting: null, retryCode: null,
        // A bot seat taken over belongs to that table; out here this tab is
        // its account again, or its guest self.
        me: { ...s.me, playerId: currentAccount()?.uid ?? localPlayerId() },
      }));
    },

    setListed: (on) => {
      const { role, room } = get();
      if (role !== 'host') return;
      // The directory only knows Monopoly's presets; a Cashflow table on it
      // would be listed as a Monopoly one. Invite-only until it learns.
      if (on && room?.kind !== 'monopoly') return;
      if (on) { set({ listed: true }); startListing(); }
      else { stopListing(); set({ listed: false }); }
    },

    updateSettings: (patch) => {
      const { role, room, me } = get();
      if (!room || inGame(room)) return;
      const settings = { ...room.settings, ...patch };
      if (role === 'guest') guest?.send({ t: 'SETTINGS', playerId: me.playerId, settings });
      else publish({ ...room, settings });
    },

    updateCfRules: (patch) => {
      const { role, room, me } = get();
      if (!room || inGame(room)) return;
      const cfRules = { ...room.cfRules, ...patch };
      if (role === 'guest') guest?.send({ t: 'SETTINGS', playerId: me.playerId, settings: room.settings, cfRules });
      else publish({ ...room, cfRules });
    },

    addBot: () => {
      const { role, me } = get();
      if (role === 'guest') guest?.send({ t: 'ADD_BOT', playerId: me.playerId });
      else addBotSeat();
    },

    removeSeat: (playerId) => {
      const { role, me } = get();
      if (role === 'guest') guest?.send({ t: 'REMOVE_SEAT', playerId: me.playerId, target: playerId });
      else removeSeatById(playerId);
    },

    startGame: () => {
      const { role, room, me } = get();
      if (!room || inGame(room)) return;
      if (role === 'guest') {
        guest?.send({ t: 'INTENT', playerId: me.playerId, action: { type: 'START_GAME', playerId: me.playerId } });
        return;
      }
      let seats = room.seats;
      if (room.settings.fillWithBots) {
        while (seats.length < 2) {
          addBotSeat();
          seats = snapshot()?.seats ?? seats;
        }
      }
      if (seats.length < 2) return;

      // A listed table stays listed into its game while it has bots to take
      // over; the heartbeat decides, and says so at once.
      if (get().listed) window.setTimeout(beat, 0);

      const specs: SeatSpec[] = seats.map((s) => ({
        id: s.playerId,
        name: s.name,
        token: s.token,
        color: s.color,
        isBot: s.isBot,
        botLevel: s.botLevel,
      }));
      const base = snapshot() ?? room;

      if (room.kind === 'cashflow') {
        const settings: CFSettings = {
          ...CF_DEFAULTS,
          ...room.cfRules,
          seed: room.settings.seed || randomSeed(),
          maxPlayers: seatLimit(room),
          botLevel: room.settings.botLevel,
          fillWithBots: room.settings.fillWithBots,
          turnTimer: room.settings.turnTimer,
        };
        const started = cfReduce(createCashflow(settings, specs), { type: 'START_GAME', playerId: me.playerId });
        set({ screen: 'game', cfLog: [], log: [] });
        publish({ ...base, seats, cf: started.state }, [], started.events);
        return;
      }

      const fresh = createGame({ ...room.settings, seed: room.settings.seed || randomSeed() }, specs);
      const started = reduce(fresh, { type: 'START_GAME', playerId: me.playerId });
      const pos: Record<string, number> = {};
      for (const id of started.state.seats) pos[id] = 0;
      set({ screen: 'game', animPos: pos, log: [] });
      publish({ ...base, seats, game: started.state }, started.events);
    },

    dispatch: (action) => {
      const { role, me } = get();
      if (action.playerId !== me.playerId) return;
      if (role === 'guest') { guest?.send({ t: 'INTENT', playerId: me.playerId, action }); return; }
      applyIntent(me.playerId, action);
    },

    sendChat: (text) => {
      const clean = cleanText(text, 220);
      if (!clean) return;
      const { role, me, room } = get();
      if (role === 'guest') { guest?.send({ t: 'CHAT', playerId: me.playerId, text: clean }); return; }
      const seat = room?.seats.find((s) => s.playerId === me.playerId);
      const message: ChatMessage = {
        id: `c${logSeq++}`,
        from: me.playerId,
        name: seat?.name ?? me.name,
        color: seat?.color ?? '#fff',
        text: clean,
        at: Date.now(),
      };
      set((s) => ({ chat: [...s.chat, message].slice(-80) }));
      host?.broadcastChat(message);
    },

    takeSeat: (target) => {
      const { role, me } = get();
      if (role === 'guest') guest?.send({ t: 'TAKE_SEAT', playerId: me.playerId, target });
    },

    rematch: () => {
      const { role, room } = get();
      if (!room || role === 'guest') return;
      if ((room.game?.phase ?? room.cf?.phase) !== 'game_over') return;
      // Everyone stays seated. Signed-in watchers who stayed to the end get a
      // chair for the next one, while there are chairs.
      const seats = [...room.seats];
      for (const w of room.watchers ?? []) {
        if (seats.length >= seatLimit(room) || seats.some((x) => x.playerId === w.uid)) continue;
        const taken = new Set(seats.map((x) => x.token));
        const token = TOKENS.find((tk) => !taken.has(tk.id))?.id ?? 'topper';
        seats.push(emptySeat(w.uid, w.name, token, seats.length, false));
      }
      set({ screen: 'lobby', log: [], cfLog: [], animPos: {}, inspecting: null });
      publish({
        ...room,
        game: null,
        cf: null,
        seats,
        watchers: [],
        seatRequests: [],
        // A new game deals new dice and new decks.
        settings: { ...room.settings, seed: randomSeed() },
      });
      if (get().listed) startListing();
    },

    resumeTable: (code, epoch) => {
      pendingServerResume = code;
      get().joinRoom(code, epoch);
    },

    answerSeatRequest: (uid, allow) => {
      const room = snapshot();
      if (!room || get().role !== 'host') return;
      const request = room.seatRequests?.find((r) => r.uid === uid);
      if (!request) return;
      if (allow) { applyTakeOver(uid, request.target); return; }
      publish({ ...room, seatRequests: (room.seatRequests ?? []).filter((r) => r.uid !== uid) });
      host?.send(uid, { t: 'REJECT', reason: 'seat_denied' });
    },

    inspect: (spaceId) => set({ inspecting: spaceId }),
    openSheet: (sheet) => set({ sheet }),
    toggleSound: () => set((s) => {
      const soundOn = !s.soundOn;
      try { localStorage.setItem('mply.sound', soundOn ? 'on' : 'off'); } catch { /* private mode */ }
      return { soundOn };
    }),
  };
});

/* Signing in or out changes who this tab is. At the front door that is just
 * the id it will join with next; at a table the seat is already bound, and
 * the next connect presents the pass. A sign-in that was prompted by being
 * turned away from a game in progress goes straight back to that game. */
useAccount.subscribe((next, prev) => {
  if (next.account?.uid === prev.account?.uid) return;
  const st = useStore.getState();
  if (st.screen === 'home') {
    useStore.setState({ me: { ...st.me, playerId: next.account?.uid ?? localPlayerId() } });
    // Signing in is saying who you are: the table calls you by the name on
    // the Google account. It stays editable, and a later edit sticks.
    if (next.account) st.setProfile(next.account.profile?.name || next.account.name, st.me.token);
    if (next.account && st.retryCode) st.joinRoom(st.retryCode);
  }
});

// Dev-only handle so the store can be poked from the console while
// debugging a live game. Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __mply: unknown }).__mply = useStore;
}

/* ------------------------- derived selectors ------------------------ */

export const useGame = (): GameState | null => useStore((s) => s.room?.game ?? null);

export const useCF = (): CFState | null => useStore((s) => s.room?.cf ?? null);

export const useMyId = (): string => useStore((s) => s.me.playerId);

export const useMyActions = (): GameAction[] => useStore((s) => {
  const game = s.room?.game;
  if (!game) return [];
  return legalActions(game, s.me.playerId);
});

export const useIsMyTurn = (): boolean => useStore((s) => {
  const game = s.room?.game;
  if (!game) return false;
  return game.seats[game.seatIndex] === s.me.playerId;
});
