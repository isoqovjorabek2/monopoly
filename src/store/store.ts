import { create } from 'zustand';
import { play, type SfxName } from '../audio/sfx';
import { botDecide, botDelay } from '../game/ai';
import { createGame, reduce, type SeatSpec } from '../game/engine';
import { logLine, type LogLine } from '../game/describe';
import { tr } from '../i18n';
import { legalActions } from '../game/rules';
import { randomSeed } from '../game/rng';
import { BOT_NAMES, PLAYER_COLORS, TOKENS, defaultSettings } from '../game/settings';
import type { GameAction, GameEvent, GameSettings, GameState, TokenId } from '../game/types';
import { botDecide as cfBotDecide, botDelay as cfBotDelay } from '../cashflow/ai';
import { cfLogLine, type CFLogLine } from '../cashflow/describe';
import { CF_DEFAULTS, createCashflow, reduce as cfReduce } from '../cashflow/engine';
import { currentId as cfCurrentId } from '../cashflow/rules';
import type { CFAction, CFEvent, CFRules, CFSettings, CFState } from '../cashflow/types';
import { GuestNet, HostNet, type NetStatus } from '../net/net';
import { announce as announceRoom, close as closeRoom } from '../net/directory';
import {
  type ChatMessage, type Down, type GameKind, type RoomSnapshot, type SeatInfo, type Up,
  cleanText, generateRoomCode, localPlayerId,
} from '../net/protocol';

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
  hostRoom: (settings?: GameSettings, kind?: GameKind) => void;
  /** List this room publicly, or take it off the list. Host only. */
  setListed: (on: boolean) => void;
  joinRoom: (code: string) => void;
  playSolo: (kind?: GameKind) => void;
  leave: () => void;

  updateSettings: (patch: Partial<GameSettings>) => void;
  updateCfRules: (patch: Partial<CFRules>) => void;
  addBot: () => void;
  removeSeat: (playerId: string) => void;
  startGame: () => void;

  dispatch: (action: AnyAction) => void;
  sendChat: (text: string) => void;

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
/* Heartbeat for the public directory. Module scope, not component state:
 * a room stays listed for as long as it is open, which outlives every
 * screen that can be unmounted while it is. */
let listTimer: number | null = null;
/** Seat count as the directory last heard it, so a change can be sent at
 *  once rather than waiting out the heartbeat. */
let listedSeats = -1;
let logSeq = 0;

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
        if (room.game || room.cf) { host?.send(from, { t: 'BYE', reason: 'in_progress' }); return; }
        if (room.seats.length >= seatLimit(room)) {
          host?.send(from, { t: 'BYE', reason: 'room_full' });
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

      case 'CHAT': {
        const text = cleanText(msg.text, 220);
        if (!text) return;
        const seat = room.seats.find((s) => s.playerId === from);
        const message: ChatMessage = {
          id: `c${logSeq++}`,
          from,
          name: seat?.name ?? tr().defaults.player,
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

  /* ------------------------ guest: host output --------------------- */

  const inGame = (snap: RoomSnapshot): boolean => Boolean(snap.game || snap.cf);

  const handleDown = (msg: Down): void => {
    switch (msg.t) {
      case 'WELCOME':
        set({ room: msg.snapshot, screen: inGame(msg.snapshot) ? 'game' : 'lobby' });
        return;

      case 'ROOM': {
        const cur = get().room;
        // Out-of-order arrival is real; never go backwards.
        if (cur && msg.snapshot.rev <= cur.rev) return;
        const wasInGame = Boolean(cur && inGame(cur));
        set({ room: msg.snapshot, screen: inGame(msg.snapshot) ? 'game' : 'lobby' });
        cfFloats(cur?.cf ?? null, msg.snapshot.cf);
        if (msg.snapshot.game && !wasInGame) {
          const pos: Record<string, number> = {};
          for (const id of msg.snapshot.game.seats) pos[id] = msg.snapshot.game.players[id].position;
          set({ animPos: pos });
        }
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
        set({ netError: msg.reason });
        window.setTimeout(() => set({ netError: null }), 3000);
        return;

      case 'BYE': {
        const reason = tr().net.bye[msg.reason];
        // A guest whose seat was refused as already-taken should not keep
        // trying to reconnect into the same rejection.
        teardown();
        set({ screen: 'home', netStatus: 'closed', netError: reason, room: null });
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
    // A started game cannot be joined, so it does not belong on a list of
    // rooms you can join.
    if (inGame(room)) { stopListing(); return; }
    listedSeats = room.seats.length;
    void announceRoom({
      id: room.roomId,
      host: get().me.name || tr().defaults.someone,
      seats: room.seats.length,
      maxSeats: room.settings.maxPlayers,
      settings: room.settings,
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
    me: { playerId: localPlayerId(), name: savedName(), token: savedToken() },
    pick: savedPick(),

    room: null,
    log: [],
    cfLog: [],
    chat: [],
    floats: [],

    netStatus: 'idle',
    netError: null,

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

    hostRoom: (settings, kind = get().pick) => {
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
        // A new room is private until its host says otherwise.
        listed: false,
      });

      host = new HostNet(code, {
        onUp: handleUp,
        onPresence: (playerId, connected, ping) => {
          const cur = snapshot();
          if (!cur) return;
          publish({
            ...cur,
            seats: cur.seats.map((s) => (s.playerId === playerId ? { ...s, connected, ping } : s)),
          });
        },
        onStatus: (status, detail) => set({ netStatus: status, netError: detail ?? null }),
      });
      // The host plays from this tab and never connects to itself, so its
      // seat can only ever be claimed by somebody pretending to be it.
      host.reserve(me.playerId);
      host.start();
    },

    joinRoom: (rawCode) => {
      teardown();
      const me = get().me;
      const code = rawCode.trim().toUpperCase();
      set({
        role: 'guest', code, room: null, screen: 'lobby',
        log: [], cfLog: [], chat: [], netError: null, netStatus: 'connecting',
      });
      guest = new GuestNet(code, { playerId: me.playerId, name: me.name || tr().defaults.player, token: me.token }, {
        onDown: handleDown,
        onStatus: (status, detail) => set({ netStatus: status, netError: detail ?? null }),
      });
      guest.start();
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
      set({
        screen: 'home', role: 'local', room: null, code: '', listed: false,
        log: [], cfLog: [], chat: [], floats: [], animPos: {},
        netStatus: 'idle', netError: null, sheet: 'none', inspecting: null,
      });
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

      // Off the public list before the first roll: joining a game in
      // progress is not supported, so leaving it listed would be an
      // invitation to a door that does not open.
      stopListing();

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

    inspect: (spaceId) => set({ inspecting: spaceId }),
    openSheet: (sheet) => set({ sheet }),
    toggleSound: () => set((s) => {
      const soundOn = !s.soundOn;
      try { localStorage.setItem('mply.sound', soundOn ? 'on' : 'off'); } catch { /* private mode */ }
      return { soundOn };
    }),
  };
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
