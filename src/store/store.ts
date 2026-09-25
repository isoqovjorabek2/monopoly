import { create } from 'zustand';
import { play, type SfxName } from '../audio/sfx';
import { botDecide, botDelay } from '../game/ai';
import { createGame, botifySeat, handOverSeat, reduce, type SeatSpec } from '../game/engine';
import { logLine, type LogLine } from '../game/describe';
import { tr, setBoardTheme } from '../i18n';
import { clockKey, clockSeconds, legalActions, waitingOn } from '../game/rules';
import { randomSeed } from '../game/rng';
import { BOT_NAMES, PLAYER_COLORS, TOKENS, defaultSettings, normalizeToken } from '../game/settings';
import type { GameAction, GameEvent, GameSettings, GameState, TokenId, SkinId } from '../game/types';
import { botDecide as cfBotDecide, botDelay as cfBotDelay } from '../cashflow/ai';
import { cfLogLine, type CFLogLine } from '../cashflow/describe';
import {
  CF_DEFAULTS, botifySeat as cfBotifySeat, createCashflow, handOverSeat as cfHandOverSeat,
  reduce as cfReduce,
} from '../cashflow/engine';
import {
  clockKey as cfClockKey, clockSeconds as cfClockSeconds, currentId as cfCurrentId,
  waitingOn as cfWaitingOn,
} from '../cashflow/rules';
import type { CFAction, CFEvent, CFRules, CFSettings, CFState } from '../cashflow/types';
import {
  mentionsIn, mfBotDecide, mfBotDelay, mfBotLine, mfBotTalkDelay, talkKind, type BotLine, type TalkLine,
} from '../mafia/ai';
import { MAF_MAX_SEATS, MAF_MIN_PLAYERS, MAF_PRACTICE_BOTS } from '../mafia/data';
import { REACT_GAP_MS, canReact, isReaction, type Reaction, type ReactionShown } from '../net/reactions';
import { botLineText, mafLogLine, type MFLogLine } from '../mafia/describe';
import {
  MAF_DEFAULTS, MAF_RULES_DEFAULT, botifySeat as mfBotifySeat, createMafia,
  handOverSeat as mfHandOverSeat, reduce as mfReduce, spendLastWords,
} from '../mafia/engine';
import { routeMafChat } from '../mafia/chat';
import {
  clockKey as mfClockKey, clockSeconds as mfClockSeconds, privateFor as mfPrivateFor,
} from '../mafia/rules';
import type {
  MafiaAction, MafiaEvent, MafiaPrivate, MafiaRules, MafiaSettings, MafiaState,
} from '../mafia/types';
import { GuestNet, HostNet, type NetStatus } from '../net/net';
import { cleanPhoto, currentAccount, isAccountId, myPhoto, signOut, useAccount, hasPlus } from '../net/account';
import { cleanSkin, roomTheme } from '../net/plus';
import { fetchTable, membersOf, uploadTable } from '../net/saves';
import { announce as announceRoom, close as closeRoom, closeOnUnload } from '../net/directory';
import {
  canKick, elected, eligibleCandidates, eligibleVoters, ownerOf, voteOpen,
} from '../net/moderation';
import {
  type ChatMessage, type Down, type GameKind, type RoomSnapshot, type SeatInfo, type Up,
  cleanText, generateRoomCode, localPlayerId, rehydrateForHost,
} from '../net/protocol';
import type { TakeoverPolicy } from '../game/types';
import { buzz, buzzFor, cfBuzzFor, readHaptics } from '../ui/haptics';

export type Screen = 'home' | 'account' | 'lobby' | 'game';
export type Role = 'host' | 'guest' | 'local';
export type AnyAction = GameAction | CFAction | MafiaAction;

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
  (room.kind === 'cashflow' ? Math.min(room.settings.maxPlayers, CF_MAX_SEATS)
    : room.kind === 'mafia' ? Math.min(room.settings.maxPlayers, MAF_MAX_SEATS)
      : room.settings.maxPlayers);

interface Store {
  screen: Screen;
  role: Role;
  code: string;
  /** Whether this room is announced in the public directory. Host only. */
  listed: boolean;
  me: { playerId: string; name: string; token: TokenId; skin?: SkinId };
  /** Which game the front door has selected. Remembered between visits. */
  pick: GameKind;

  room: RoomSnapshot | null;
  log: LogLine[];
  cfLog: CFLogLine[];
  mafLog: MFLogLine[];
  /** This seat's private slice of an Omertà table, pushed by the host.
   *  Null for anyone not holding a role. */
  mafPrivate: MafiaPrivate | null;
  chat: ChatMessage[];
  /** Emoji reactions floating over the table right now. */
  reactions: ReactionShown[];
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
  /** Short vibration pulses on events that matter to the holder (phones). */
  hapticsOn: boolean;

  setPick: (kind: GameKind) => void;
  /** Open the account screen, and go back to where it was opened from. */
  openAccount: () => void;
  closeAccount: () => void;
  setProfile: (name: string, token: TokenId) => void;
  /** Show this tab's own seat with the Plus and the picture its account now
   *  carries. Host or solo only: a guest's seat is set by the host from the
   *  pass it shows. */
  syncPlus: () => void;
  /** Choose a finish for this player's piece and dice. The table shows it only
   *  while their seat holds Plus; the choice is remembered either way. */
  setSkin: (skin: SkinId) => void;
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
  updateMafRules: (patch: Partial<MafiaRules>) => void;
  /** Omertà: the host cuts the current phase short. */
  mafSkip: () => void;
  addBot: () => void;
  removeSeat: (playerId: string) => void;
  /** The operator's word, carried by the directory's answers: these accounts
   *  may not play - remove their seats from this table. */
  enforceModeration: (ids: string[]) => void;
  /** This tab's own player is banned (or its room was closed): leave the
   *  table and say why. */
  moderationLeave: (kind: 'banned' | 'delisted') => void;
  /** Endorse a candidate for co-owner while the owner is away
   *  (net/moderation.ts). */
  endorse: (candidate: string) => void;
  startGame: () => void;
  /** Host: seat bots up to a playable table and start. On a public table
   *  the bots are seats for whoever turns up next. */
  startWithBots: () => void;

  dispatch: (action: AnyAction) => void;
  sendChat: (text: string) => void;
  /** React with one of net/reactions.ts's emoji. */
  sendReaction: (emoji: Reaction) => void;
  /** A signed-in watcher takes over a bot's seat - or asks to. */
  takeSeat: (target: string) => void;
  /** The host lets a waiting watcher take the seat they asked for, or not. */
  answerSeatRequest: (uid: string, allow: boolean) => void;
  /** Pick a saved table back up: rejoin it if somebody is hosting it, and
   *  host it from the server's copy if nobody is. */
  resumeTable: (code: string, epoch: number) => void;
  /** After a game ends: the same table, back in its lobby, for another. */
  rematch: () => void;
  /** The host earned a Plus board for the next game by watching a video. */
  openBoardsForAGame: () => void;

  inspect: (spaceId: number | null) => void;
  openSheet: (sheet: Store['sheet']) => void;
  toggleSound: () => void;
  toggleHaptics: () => void;
}

/* ------------------------------------------------------------------ *
 * Host-side mutable context. Kept outside the store because it is
 * transport plumbing, not render state.
 * ------------------------------------------------------------------ */
let host: HostNet | null = null;
let guest: GuestNet | null = null;
let botTimer: number | null = null;
/** Seconds per decision a public table starts with when it had no clock. */
const PUBLIC_TURN_TIMER = 60;
/* Omertà's table talk, as the host heard it: who named whom. The bots read
 * it (it is public, or family-only where the family said it), and it lives
 * only on the host - a new host after a migration starts with a clean slate,
 * which costs the bots some memory and nothing else. */
let mafTalk: TalkLine[] = [];
/** Bots that have had their say this phase: `${round}|${phase}|${id}`. */
const botSpoken = new Set<string>();
let talkTimers: number[] = [];
/** When each seat last reacted, for the host's rate limit. */
const lastReacted = new Map<string, number>();
const resetTalk = (): void => {
  mafTalk = [];
  botSpoken.clear();
  for (const id of talkTimers) window.clearTimeout(id);
  talkTimers = [];
};
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
/** Each Omertà seat's private slice as last pushed (JSON), so a publish that
 *  changed nothing for a seat costs no message. Cleared when the room is. */
const mafPrivateCache = new Map<string, string>();

/**
 * What of an Omertà reduction may go out to every tab. A night move says
 * who has night business - and a villager never does - so it stays on the
 * authority. Everything else is public.
 */
const publicMafEvents = (events: MafiaEvent[]): MafiaEvent[] => events.filter((e) => e.type !== 'ACTED');

/**
 * A new host that inherited an Omertà match mid-game holds no night ledger:
 * the roles were only ever in the old host's tab. Nobody can re-deal them,
 * so the match ends here, said plainly, rather than limping on blind.
 */
const orphanedMafia = (room: RoomSnapshot): { room: RoomSnapshot; events: MafiaEvent[] } => {
  const mf = room.mf;
  if (!mf || mf.secret || mf.phase === 'lobby' || mf.phase === 'game_over') return { room, events: [] };
  return {
    room: { ...room, mf: { ...mf, phase: 'game_over', winner: null, winnerId: null } },
    events: [{ type: 'GAME_OVER', winner: null, winnerId: null }],
  };
};

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
  me: { playerId: string; name: string; token: TokenId; skin?: SkinId };
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
    // An Omertà table saved under the first rules cannot be run by these.
    if (s.room?.mf && !Array.isArray(s.room.mf.lastWords)) return null;
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
  try { return normalizeToken(localStorage.getItem('mply.token')); } catch { return 'camel'; }
};
const savedSkin = (): SkinId => {
  try { return cleanSkin(localStorage.getItem('mply.skin')); } catch { return 'classic'; }
};
const savedSound = (): boolean => {
  try { return localStorage.getItem('mply.sound') !== 'off'; } catch { return true; }
};
const savedPick = (): GameKind => {
  try {
    const v = localStorage.getItem('mply.game');
    return v === 'cashflow' || v === 'mafia' ? v : 'monopoly';
  } catch { return 'monopoly'; }
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

/** A room with no game in it yet, of any kind. */
const freshRoom = (
  code: string, hostSeat: SeatInfo, kind: GameKind, settings: GameSettings,
): RoomSnapshot => ({
  roomId: code,
  hostId: hostSeat.playerId,
  ownerId: hostSeat.playerId,
  kind,
  seats: [hostSeat],
  settings,
  cfRules: { ...CF_RULES_DEFAULT },
  mafRules: { ...MAF_RULES_DEFAULT },
  game: null,
  cf: null,
  mf: null,
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

  /** Omertà scores its own table - phase music, the elimination sting, the
   *  reveal (ui/mafia/audio.ts) - so the house cues keep out of its way. */
  const mafCueFor = (e: MafiaEvent): SfxName | null => (e.type === 'SEAT_TAKEN' ? 'cash' : null);

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
    const { soundOn, hapticsOn, me } = get();
    for (const e of events) {
      const cue = cueFor(e, me.playerId);
      if (cue) play(cue, soundOn);
      const pulse = buzzFor(e, me.playerId);
      if (pulse) buzz(hapticsOn, pulse);
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
    const { soundOn, hapticsOn, me } = get();
    for (const e of events) {
      const cue = cfCueFor(e, me.playerId);
      if (cue) play(cue, soundOn);
      const pulse = cfBuzzFor(e, me.playerId);
      if (pulse) buzz(hapticsOn, pulse);
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

  /** Omertà's log and sounds. Night business stays off the log by the
   *  describer's own choice (mafLogLine returns null for ACTED and VOTED). */
  const pushMafEvents = (events: MafiaEvent[]): void => {
    if (events.length === 0) return;
    const lines: MFLogLine[] = [];
    const { soundOn } = get();
    for (const e of events) {
      const cue = mafCueFor(e);
      if (cue) play(cue, soundOn);
      const l = mafLogLine(e, logSeq++);
      if (l) lines.push(l);
    }
    if (lines.length > 0) set((s) => ({ mafLog: [...s.mafLog, ...lines].slice(-200) }));
  };

  /** Omertà's hidden ledger, one slice per player, pushed only where it
   *  belongs: this tab's state for the seat it plays, a direct message for
   *  every connected guest seat. It never travels inside the snapshot. */
  const pushMafPrivate = (room: RoomSnapshot): void => {
    const mf = room.mf;
    if (!mf) return;
    const me = get().me.playerId;
    for (const seat of room.seats) {
      const priv = mfPrivateFor(mf, seat.playerId);
      const json = JSON.stringify(priv);
      if (mafPrivateCache.get(seat.playerId) === json) continue;
      mafPrivateCache.set(seat.playerId, json);
      if (seat.playerId === me) set({ mafPrivate: priv });
      else if (priv && host) host.send(seat.playerId, { t: 'MF_PRIVATE', private: priv });
    }
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

  const publish = (
    next: RoomSnapshot,
    events: GameEvent[] = [],
    cfEvents: CFEvent[] = [],
    mfEvents: MafiaEvent[] = [],
  ): void => {
    const prevCf = get().room?.cf ?? null;
    const withRev = { ...next, rev: next.rev + 1 };
    set({ room: withRev });
    if (withRev.game) pushEvents(withRev.game, events);
    if (withRev.cf) { pushCfEvents(cfEvents); cfFloats(prevCf, withRev.cf); }
    if (withRev.mf) pushMafEvents(mfEvents);
    // The private slices go wherever this tab is the authority, solo or host.
    if (get().role !== 'guest' && withRev.mf) pushMafPrivate(withRev);
    if (get().role === 'host' && host) {
      host.broadcastEvents(withRev.rev, events);
      host.broadcastCfEvents(withRev.rev, cfEvents);
      host.broadcastMafEvents(withRev.rev, publicMafEvents(mfEvents));
      host.broadcastRoom(withRev);
      // Somebody sat down or left. Twenty seconds of a wrong seat count is
      // how a lobby list earns its reputation for lying, and the fix costs
      // one request per actual change rather than per publish.
      if (get().listed && !withRev.game && !withRev.cf && !withRev.mf && withRev.seats.length !== listedSeats) beat();
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
    // An Omertà table is never kept on the server: its copy there would be
    // the redacted one, with no roles in it, and nobody could run it again.
    if (!account || room.mf || !(room.game || room.cf)) return false;
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
    const over = (room.game?.phase ?? room.cf?.phase ?? room.mf?.phase) === 'game_over';
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
    const phase = room?.game?.phase ?? room?.cf?.phase ?? room?.mf?.phase;
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
        // The co-owner clock follows the owner's seat: it starts when they
        // drop, and a vote in progress is moot the moment they are back.
        let ownerAwayAt = cur.ownerAwayAt ?? null;
        let coownerVotes = cur.coownerVotes;
        if (playerId === ownerOf(cur)) {
          if (!connected && ownerAwayAt == null) ownerAwayAt = Date.now();
          if (connected) { ownerAwayAt = null; coownerVotes = {}; }
        }
        publish({
          ...cur,
          watchers,
          seatRequests,
          ownerAwayAt,
          coownerVotes,
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
      log: [], cfLog: [], mafLog: [], mafPrivate: null, chat: [], netError: null,
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
    const orphan = orphanedMafia(room);
    const positions: Record<string, number> = {};
    for (const id of room.game?.seats ?? []) positions[id] = room.game!.players[id].position;
    set((s) => ({
      role: 'host', code, room: orphan.room, screen: 'game', animPos: positions, listed: false,
      log: [], cfLog: [], mafLog: [], mafPrivate: null, chat: [], netError: null, netStatus: 'starting',
      me: { ...s.me, playerId: mine.playerId },
    }));
    startHost(code, epoch);
    publish(orphan.room, [], [], orphan.events);
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
    // If the table's owner is the host who just vanished, the co-owner clock
    // starts here; this tab becoming host says nothing about where they went.
    if (ownerOf(next) !== me.playerId && next.ownerAwayAt == null) next.ownerAwayAt = Date.now();
    const orphan = orphanedMafia(next);
    set({ role: 'host', room: orphan.room, netStatus: 'starting', netError: tr().net.migrated });
    startHost(code, epoch);
    publish(orphan.room, [], [], orphan.events);
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

  /** A bot line as the host reads it; each guest re-renders `say` itself. */
  const botText = (s: MafiaState, line: BotLine): string => botLineText(tr(), s, line) ?? '…';

  /** Give each Omertà bot its say, once a phase, a few seconds in. The line
   *  is chosen when it is spoken, from the table as it is by then. */
  const scheduleBotTalk = (s: MafiaState): void => {
    if (mafTalk.some((t) => t.round > s.round)) resetTalk();
    for (const id of s.seats) {
      const p = s.players[id];
      if (!p?.isBot || !p.alive) continue;
      const key = `${s.round}|${s.phase}|${id}`;
      if (botSpoken.has(key)) continue;
      // In the vote a bot speaks after it has voted; until then, wait.
      if (s.phase === 'vote' && !(id in s.votes)) continue;
      botSpoken.add(key);
      const timer = window.setTimeout(() => {
        talkTimers = talkTimers.filter((x) => x !== timer);
        const now = snapshot()?.mf;
        if (!now || `${now.round}|${now.phase}|${id}` !== key) return;
        const line = mfBotLine(now, id, mafTalk);
        const seat = snapshot()?.seats.find((x) => x.playerId === id);
        if (!line || !seat) return;
        speak(id, seat.name, seat.color, botText(now, line), line);
      }, mfBotTalkDelay(s, id));
      talkTimers.push(timer);
    }
  };

  const scheduleBots = (): void => {
    if (botTimer) { window.clearTimeout(botTimer); botTimer = null; }
    const { role, room } = get();
    if (role === 'guest' || !room) return;

    if (room.mf) {
      const s = room.mf;
      if (s.phase === 'game_over' || s.phase === 'lobby') return;
      scheduleBotTalk(s);
      for (const seat of room.seats) {
        if (!seat.isBot) continue;
        const action = mfBotDecide(s, seat.playerId, mafTalk);
        if (!action) continue;
        botTimer = window.setTimeout(() => {
          botTimer = null;
          applyIntent(seat.playerId, action);
        }, mfBotDelay(s, seat.playerId));
        return;
      }
      return;
    }

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
    const phase = g?.phase ?? c?.phase ?? room?.mf?.phase;
    if (role === 'guest' || !room || !phase || phase === 'game_over' || phase === 'lobby') {
      stopClock();
      return;
    }
    if (room.mf) { scheduleMafClock(room.mf); return; }
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

  /**
   * Omertà's clock: every phase runs on its own clock, and when it runs out
   * the host moves the table on. Nobody is played for - an idle player
   * simply misses their chance. With only bots left alive there is nobody
   * to wait for, so the talk is cut to a breath.
   */
  const scheduleMafClock = (m: MafiaState): void => {
    const key = mfClockKey(m);
    if (key === clockArmed && clockTimer) return;
    stopClock();
    const humansAlive = m.seats.some((id) => m.players[id]?.alive && !m.players[id].isBot);
    const secs = humansAlive ? mfClockSeconds(m) : Math.min(mfClockSeconds(m), 3);
    if (secs <= 0) return;
    clockArmed = key;
    clockTimer = window.setTimeout(() => {
      clockTimer = null;
      clockArmed = '';
      const cur = snapshot()?.mf;
      if (cur && mfClockKey(cur) === key) applyIntent(get().me.playerId, { type: 'ADVANCE', playerId: get().me.playerId });
    }, secs * 1000);
  };

  /** The single funnel every action goes through on the authority. The
   *  host's own clicks take this path too, so there is exactly one code
   *  path and no chance of the host diverging from everyone else. */
  const applyIntent = (playerId: string, action: AnyAction): void => {
    const room = snapshot();
    if (!room) return;
    if (!action || typeof action !== 'object' || action.playerId !== playerId) return; // spoofed actor

    if (room.kind === 'mafia') {
      if (!room.mf) return;
      const { state, events } = mfReduce(room.mf, action as MafiaAction);
      if (state.version === room.mf.version) return;      // rejected, no-op
      publish({ ...room, mf: state }, [], [], events);
      return;
    }

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
        // A removed player stays removed, however they arrive - by their old
        // seat id, or by the account that was sitting in it.
        if ((room.kicked ?? []).includes(from) || (uid != null && (room.kicked ?? []).includes(uid))) {
          host?.refuse(from, 'kicked');
          return;
        }
        const existing = room.seats.find((s) => s.playerId === from);
        if (existing) {
          // Reconnect: identity is the playerId, never the connection.
          const seats = room.seats.map((s) =>
            s.playerId === from ? {
              ...s, connected: true, name,
              plus: uid ? Boolean(msg.verifiedPlus) : s.plus,
              skin: uid ? (msg.verifiedPlus ? cleanSkin(msg.skin) : undefined) : s.skin,
              photo: uid ? cleanPhoto(msg.photo) : s.photo,
            } : s);
          const next = { ...room, seats };
          set({ room: next });
          host?.welcome(from, next);
          host?.broadcastRoom(next);
          // A fresh connection has no role in hand: send it again.
          mafPrivateCache.delete(from);
          pushMafPrivate(next);
          return;
        }
        if (inGame(room)) {
          // A game in progress takes signed-in players only: they come in
          // watching, and may take over a bot. A guest is told how to get in.
          if (!uid || from !== uid) {
            host?.refuse(from, 'sign_in_to_join');
            return;
          }
          const watchers = [...(room.watchers ?? []).filter((w) => w.uid !== uid), { uid, name, photo: cleanPhoto(msg.photo) }];
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
        const seat = {
          ...emptySeat(from, name, token, room.seats.length, false),
          plus: Boolean(msg.verifiedPlus),
          skin: msg.verifiedPlus ? cleanSkin(msg.skin) : undefined,
          // Only a pass the transport checked lets a picture onto a seat.
          photo: uid ? cleanPhoto(msg.photo) : undefined,
        };
        const next = { ...room, seats: [...room.seats, seat] };
        set({ room: next });
        host?.welcome(from, next);
        publish(next);
        return;
      }

      case 'PROFILE': {
        if (inGame(room)) return;
        const name = cleanText(msg.name, 18) || tr().defaults.player;
        const taken = new Set(room.seats.filter((x) => x.playerId !== from).map((x) => x.token));
        const token = taken.has(msg.token)
          ? room.seats.find((x) => x.playerId === from)?.token ?? msg.token
          : msg.token;
        publish({
          ...room,
          // A finish shows only on a seat the host verified as Plus.
          seats: room.seats.map((s) => (s.playerId === from ? { ...s, name, token, skin: s.plus ? cleanSkin(msg.skin) : undefined } : s)),
        });
        return;
      }

      case 'SETTINGS':
        if (from !== room.hostId) return;
        publish({
          ...room,
          settings: msg.settings,
          cfRules: msg.cfRules ?? room.cfRules,
          mafRules: msg.mafRules ?? room.mafRules,
        });
        return;

      case 'ADD_BOT':
        if (from !== room.hostId) return;
        addBotSeat();
        return;

      case 'REMOVE_SEAT':
        kickTarget(from, msg.target);
        return;

      case 'ELECT':
        endorseVote(seatFor(from), msg.candidate);
        return;

      case 'INTENT':
        // The clock is the host's alone. A guest sending a time-out or an
        // advance could cut a turn, or Omertà's day talk, short.
        if (msg.action?.type === 'TIME_OUT' || msg.action?.type === 'ADVANCE') return;
        applyIntent(from, msg.action);
        return;

      case 'TAKE_SEAT':
        takeOverSeat(from, msg.target);
        return;

      case 'REACT':
        react(seatFor(from), msg.emoji);
        return;

      case 'CHAT': {
        const text = cleanText(msg.text, 220);
        if (!text) return;
        const seatId = seatFor(from);
        const seat = room.seats.find((s) => s.playerId === seatId);
        const watcher = room.watchers?.find((w) => w.uid === from);
        speak(seat ? seatId : null, seat?.name ?? watcher?.name ?? tr().defaults.player, seat?.color ?? '#fff', text);
        return;
      }

      case 'PONG':
        return;
    }
  };

  /** A reaction this host has checked: everyone sees it, nobody keeps it. */
  const react = (seat: string, emoji: unknown): void => {
    const room = snapshot();
    if (!isReaction(emoji) || !canReact(room, seat)) return;
    const now = Date.now();
    if (now - (lastReacted.get(seat) ?? 0) < REACT_GAP_MS) return;
    lastReacted.set(seat, now);
    const id = `r${logSeq++}`;
    showReaction(id, seat, emoji);
    host?.broadcast({ t: 'REACT', id, from: seat, emoji });
  };

  const showReaction = (id: string, from: string, emoji: Reaction): void => {
    const shown: ReactionShown = { id, from, emoji, at: Date.now() };
    set((s) => ({ reactions: [...s.reactions, shown].slice(-12) }));
    window.setTimeout(() => set((s) => ({ reactions: s.reactions.filter((r) => r.id !== id) })), 2600);
  };

  /**
   * Say something at the table, on the authority. Every table but a running
   * Omertà match hears everything; there, chat.ts decides who may speak and
   * who hears it, and the message goes only to those seats.
   */
  const speak = (seat: string | null, name: string, color: string, text: string, say?: BotLine): void => {
    const room = snapshot();
    if (!room) return;
    const base: ChatMessage = {
      id: `c${logSeq++}`, from: seat ?? '', name, color, text, at: Date.now(), ...(say ? { say } : {}),
    };
    const mf = room.mf;
    const route = mf ? routeMafChat(mf, seat, text) : null;
    if (mf && !route) return;
    // What the bots will remember of it. A whisper is heard by two, so it
    // is nobody's evidence.
    if (mf && route && seat && route.channel !== 'whisper' && route.channel !== 'dead' && mf.phase !== 'lobby' && mf.phase !== 'game_over') {
      const phase = mf.phase as TalkLine['phase'];
      const family = route.channel === 'family' || undefined;
      const kind = say ? talkKind(say) : null;
      if (say && kind && say.target) mafTalk.push({ round: mf.round, phase, from: seat, target: say.target, kind, family });
      else if (!say) {
        for (const target of mentionsIn(mf, seat, route.text)) {
          mafTalk.push({ round: mf.round, phase, from: seat, target, kind: 'mention', family });
        }
      }
      if (mafTalk.length > 400) mafTalk = mafTalk.slice(-300);
    }
    const message: ChatMessage = route
      ? {
        ...base,
        text: route.text,
        ...(route.channel ? { channel: route.channel } : {}),
        ...(route.whisperTo ? { to: route.whisperTo.id, toName: route.whisperTo.name } : {}),
      }
      : base;
    if (mf && route?.lastWords && seat) publish({ ...room, mf: spendLastWords(mf, seat) });
    const me = get().me.playerId;
    if (!route?.to) {
      set((s) => ({ chat: [...s.chat, message].slice(-80) }));
      host?.broadcastChat(message);
      return;
    }
    for (const id of new Set(route.to)) {
      if (id === me) set((s) => ({ chat: [...s.chat, message].slice(-80) }));
      else host?.send(room.owners?.[id] ?? id, { t: 'CHAT', message });
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
    if ((room.kicked ?? []).includes(uid)) return;
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
    if (room.mf) return Boolean(room.mf.players[target]?.alive);
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
    let mfEvents: MafiaEvent[] = [];
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
    } else if (room.mf) {
      const r = mfHandOverSeat(room.mf, target, name);
      if (r.state === room.mf) return;
      next = { ...room, mf: r.state };
      mfEvents = r.events;
      // The bot's role is the new player's now: it has to reach them.
      mafPrivateCache.delete(target);
    } else {
      return;
    }

    next = {
      ...next,
      seats: next.seats.map((s) => (s.playerId === target
        ? { ...s, isBot: false, name, connected: true, ping: 0, photo: watcher?.photo }
        : s)),
      owners: { ...(room.owners ?? {}), [target]: uid },
      watchers: (room.watchers ?? []).filter((w) => w.uid !== uid),
      // This watcher's question is answered, and nobody else can have that bot.
      seatRequests: (room.seatRequests ?? []).filter((r) => r.uid !== uid && r.target !== target),
    };
    // The seat stays reserved against guest claims; the pass is the way in.
    host.setOwner(target, uid);
    host.rebind(uid, target);
    publish(next, events, cfEvents, mfEvents);
    const published = snapshot();
    if (published) host.welcome(target, published);
  };

  /* ------------------------ guest: host output --------------------- */

  const inGame = (snap: RoomSnapshot): boolean => Boolean(snap.game || snap.cf || snap.mf);

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
        if (wasInGame && !inGame(msg.snapshot)) set({ log: [], cfLog: [], mafLog: [], mafPrivate: null, animPos: {} });
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

      case 'MF_EVENTS':
        pushMafEvents(msg.events);
        return;

      case 'MF_PRIVATE':
        set({ mafPrivate: msg.private });
        return;

      case 'CHAT':
        set((s) => ({ chat: [...s.chat, msg.message].slice(-80) }));
        return;

      case 'REACT':
        if (isReaction(msg.emoji) && typeof msg.from === 'string') showReaction(String(msg.id), msg.from, msg.emoji);
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
    const token = TOKENS.find((t) => !usedTokens.has(t.id))?.id ?? 'doppi';
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

  /**
   * Remove a player, from the lobby or mid-game. The owner's call, or a
   * co-owner's - but never against the owner or another co-owner (see
   * net/moderation.ts). In a started game the seat plays on as a bot, so
   * the turn cycle and the estate stay intact; either way the removed
   * player is on the kicked list and stays out for good.
   */
  const kickTarget = (from: string, target: string): void => {
    const room = snapshot();
    if (!room) return;
    const seat = room.seats.find((s) => s.playerId === target);
    const actor = seatFor(from);
    // Bots have no connection to drop; the owner simply deletes the seat,
    // in the lobby only - in a game the turn cycle needs it where it is.
    if (seat?.isBot) {
      if (actor === ownerOf(room)) removeSeatById(target);
      return;
    }
    if (!host || !canKick(room, actor, seat)) return;

    const connId = room.owners?.[target] ?? target;
    host.kick(connId);
    const kicked = [...new Set([...(room.kicked ?? []), target, connId])];
    const coowners = (room.coowners ?? []).filter((c) => c !== target);
    const coownerVotes = Object.fromEntries(
      Object.entries(room.coownerVotes ?? {}).filter(([v, c]) => v !== target && c !== target),
    );

    if (!inGame(room)) {
      publish({
        ...room,
        seats: room.seats.filter((s) => s.playerId !== target),
        kicked, coowners, coownerVotes,
      });
      return;
    }

    const game = room.game ? botifySeat(room.game, target).state : room.game;
    const cf = room.cf ? cfBotifySeat(room.cf, target).state : room.cf;
    const mf = room.mf ? mfBotifySeat(room.mf, target).state : room.mf;
    publish({
      ...room,
      game,
      cf,
      mf,
      seats: room.seats.map((s) => (s.playerId === target
        ? { ...s, isBot: true, connected: false, ping: 0, photo: undefined }
        : s)),
      owners: Object.fromEntries(Object.entries(room.owners ?? {}).filter(([seatId]) => seatId !== target)),
      kicked, coowners, coownerVotes,
    });
    // The seat is a bot again: nobody may connect as it, and no account
    // owns it any more.
    host.reserve(target);
    host.clearOwner(target);
  };

  /** One endorsement per voter, the latest replacing it; a strict majority
   *  of the table seats a co-owner. See net/moderation.ts for the rules. */
  const endorseVote = (voter: string, candidate: string): void => {
    const room = snapshot();
    if (!room || !host || typeof candidate !== 'string') return;
    if (!voteOpen(room, Date.now())) return;
    if (!eligibleVoters(room).includes(voter)) return;
    if (!eligibleCandidates(room).includes(candidate)) return;
    const coownerVotes = { ...(room.coownerVotes ?? {}), [voter]: candidate };
    const chosen = elected({ ...room, coownerVotes });
    publish(chosen
      ? {
        ...room,
        coowners: [...new Set([...(room.coowners ?? []), chosen])],
        coownerVotes: {},
      }
      : { ...room, coownerVotes });
  };

  const teardown = (): void => {
    mafPrivateCache.clear();
    resetTalk();
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
    window.removeEventListener('pagehide', onPageHide);
    const { code, listed } = get();
    if (listed && code) void closeRoom(code);
  };

  /** The tab is going away: timers are already dead, so close with a
   *  beacon rather than leaving the room to expire on its own. */
  const onPageHide = (): void => {
    const { code, listed } = get();
    if (listed && code) closeOnUnload(code);
  };

  /** Announce now, then keep announcing. The directory forgets a room a
   *  minute and a half after the last beat - slow enough that a hidden
   *  tab's throttled timers still count - so this is also what removes a
   *  room when the tab is closed without warning. */
  const beat = (): void => {
    const { room, listed, role } = get();
    if (!room || !listed || role !== 'host') return;
    // A started game stays on the list only while a signed-in player could
    // still come in and take over a bot. Once there is no seat to take, it
    // is no longer a table anyone can join. The unlist also settles the
    // listing itself: a new game is announced again by choice, not by a
    // flag left over from the last one.
    let live: { openSeats: number; round: number } | undefined;
    if (inGame(room)) {
      // Any game with a bot a newcomer could take over (see mayTakeOver).
      const g = room.game;
      const c = room.cf;
      const m = room.mf;
      const takeable = (id: string): boolean => (g ? Boolean(g.players[id]) && !g.players[id].bankrupt
        : m ? Boolean(m.players[id]?.alive) : Boolean(c?.players[id]));
      const bots = room.seats.filter((x) => x.isBot && takeable(x.playerId)).length;
      const over = (g ?? c ?? m)?.phase === 'game_over';
      if (over || bots === 0 || (room.settings.takeovers ?? 'ask') === 'off') {
        stopListing();
        set({ listed: false });
        return;
      }
      live = { openSeats: bots, round: g?.round ?? c?.round ?? m?.round ?? 0 };
    }
    listedSeats = room.seats.length;
    void announceRoom({
      id: room.roomId,
      kind: room.kind,
      host: get().me.name || tr().defaults.someone,
      seats: room.seats.length,
      maxSeats: room.settings.maxPlayers,
      settings: room.settings,
      live,
    }).then(({ expired, banned, closed, plus }) => {
      // The operator banned this player outright: leave the table entirely.
      if (banned) { get().moderationLeave('banned'); return; }
      // The directory declines to keep a room that has been open for hours:
      // a table that old is done, whether or not anyone remembered to leave.
      // A closed room is the operator's word: off the list, and it stays off.
      if (expired || closed) { stopListing(); set({ listed: false }); }
      if (closed) set({ netError: tr().net.delisted });
      // The directory would not take it as a Plus table (the pass lapsed, or
      // was never there): it goes on as a private room, its code unchanged.
      if (plus) { stopListing(); set({ listed: false }); }
    });
  };

  const startListing = (): void => {
    if (listTimer) window.clearInterval(listTimer);
    window.addEventListener('pagehide', onPageHide);
    beat();
    listTimer = window.setInterval(beat, 20000);
  };

  /* ------------------------------ store ---------------------------- */

  return {
    screen: 'home',
    role: 'local',
    code: '',
    listed: false,
    me: { playerId: currentAccount()?.uid ?? localPlayerId(), name: savedName(), token: savedToken(), skin: savedSkin() },
    pick: savedPick(),

    room: null,
    log: [],
    cfLog: [],
    mafLog: [],
    mafPrivate: null,
    chat: [],
    reactions: [],
    floats: [],

    netStatus: 'idle',
    netError: null,
    retryCode: null,

    animPos: {},
    rolling: false,
    inspecting: null,
    sheet: 'none',
    soundOn: savedSound(),
    hapticsOn: readHaptics(),

    setPick: (kind) => {
      try { localStorage.setItem('mply.game', kind); } catch { /* private mode */ }
      set({ pick: kind });
    },

    openAccount: () => {
      // Only from the front door: a table is never left behind by it.
      if (get().screen === 'home') set({ screen: 'account' });
    },

    closeAccount: () => {
      if (get().screen === 'account') set({ screen: 'home' });
    },

    setProfile: (name, token) => {
      const clean = cleanText(name, 18) || tr().defaults.player;
      try {
        localStorage.setItem('mply.name', clean);
        localStorage.setItem('mply.token', token);
      } catch { /* private mode */ }
      set((s) => ({ me: { ...s.me, name: clean, token } }));

      const { role, room, me } = get();
      if (role === 'guest') guest?.send({ t: 'PROFILE', playerId: me.playerId, name: clean, token, skin: me.skin });
      else if (room && !inGame(room)) {
        publish({
          ...room,
          seats: room.seats.map((s) => (s.playerId === me.playerId ? { ...s, name: clean, token } : s)),
        });
      }
    },

    setSkin: (skin) => {
      const clean = cleanSkin(skin);
      try { localStorage.setItem('mply.skin', clean); } catch { /* private mode */ }
      set((st) => ({ me: { ...st.me, skin: clean } }));
      const { role, room, me } = get();
      if (role === 'guest') {
        guest?.send({ t: 'PROFILE', playerId: me.playerId, name: me.name, token: me.token, skin: clean });
      } else if (room && !inGame(room)) {
        publish({
          ...room,
          seats: room.seats.map((x) => (x.playerId === me.playerId ? { ...x, skin: x.plus ? clean : undefined } : x)),
        });
      }
    },

    syncPlus: () => {
      const { role, room, me } = get();
      if (!room || role === 'guest') return;
      const plus = hasPlus(currentAccount());
      const photo = myPhoto();
      const mine = room.seats.find((x) => x.playerId === me.playerId);
      if (!mine || (Boolean(mine.plus) === plus && mine.photo === photo)) return;
      publish({
        ...room,
        seats: room.seats.map((x) => (x.playerId === me.playerId ? { ...x, plus, skin: plus ? cleanSkin(me.skin) : undefined, photo } : x)),
      });
    },

    hostRoom: (settings, kind = get().pick, opts = {}) => {
      teardown();
      const me = get().me;
      const code = generateRoomCode();
      const room = freshRoom(
        code,
        {
          ...emptySeat(me.playerId, me.name || tr().defaults.host, me.token, 0, true),
          plus: hasPlus(currentAccount()),
          skin: hasPlus(currentAccount()) ? cleanSkin(me.skin) : undefined,
          photo: myPhoto(),
        },
        kind,
        {
          ...(settings ?? defaultSettings()),
          ...(kind === 'mafia' ? { maxPlayers: MAF_DEFAULTS.maxPlayers } : {}),
          seed: randomSeed(),
        },
      );
      set({
        role: 'host', code, room, screen: 'lobby',
        log: [], cfLog: [], mafLog: [], mafPrivate: null, chat: [], netError: null,
        // Private unless the host chose a public table on the way in.
        listed: false,
      });

      startHost(code, 0);
      // Public tables are a Plus feature; setListed says no to anyone else.
      if (opts.listed) get().setListed(true);
    },

    joinRoom: (rawCode, epoch = 0) => {
      teardown();
      const me = get().me;
      const code = rawCode.trim().toUpperCase();
      set({
        role: 'guest', code, room: null, screen: 'lobby',
        log: [], cfLog: [], mafLog: [], mafPrivate: null, chat: [], netError: null, netStatus: 'connecting',
      });
      guest = new GuestNet(code, { playerId: me.playerId, name: me.name || tr().defaults.player, token: me.token, skin: me.skin }, {
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
        return account ? { uid: account.uid, pass: account.pass, photo: myPhoto() } : null;
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
        {
          ...emptySeat(me.playerId, me.name || tr().defaults.you, me.token, 0, true),
          plus: hasPlus(currentAccount()),
          skin: hasPlus(currentAccount()) ? cleanSkin(me.skin) : undefined,
          photo: myPhoto(),
        },
        kind,
        {
          ...defaultSettings(),
          ...(kind === 'mafia' ? { maxPlayers: MAF_DEFAULTS.maxPlayers } : {}),
          fillWithBots: true,
        },
      );
      set({
        role: 'local', code: '', room, screen: 'lobby',
        log: [], cfLog: [], mafLog: [], mafPrivate: null, chat: [], netError: null, netStatus: 'idle',
      });
      const bots = kind === 'mafia' ? MAF_PRACTICE_BOTS : 2;
      for (let i = 0; i < bots; i++) addBotSeat();
    },

    leave: () => {
      teardown();
      forgetSave();
      pendingHostResume = null;
      set((s) => ({
        screen: 'home', role: 'local', room: null, code: '', listed: false,
        log: [], cfLog: [], mafLog: [], mafPrivate: null, chat: [], floats: [], animPos: {},
        netStatus: 'idle', netError: null, sheet: 'none', inspecting: null, retryCode: null,
        // A bot seat taken over belongs to that table; out here this tab is
        // its account again, or its guest self.
        me: { ...s.me, playerId: currentAccount()?.uid ?? localPlayerId() },
      }));
    },

    setListed: (on) => {
      const { role, room } = get();
      if (role !== 'host') return;
      // Any game can be listed, but only by a host holding Party Hall Plus.
      // The directory checks the pass too; this just saves it the trip.
      if (on && (!room || !hasPlus(currentAccount()))) return;
      // Strangers do not wait on each other the way friends do: a public
      // table with no turn clock gets one. The host can still turn it off.
      if (on && room && !inGame(room) && room.kind !== 'mafia' && !room.settings.turnTimer) {
        get().updateSettings({ turnTimer: PUBLIC_TURN_TIMER });
      }
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

    updateMafRules: (patch) => {
      const { role, room, me } = get();
      if (!room || inGame(room)) return;
      const mafRules = { ...room.mafRules, ...patch };
      if (role === 'guest') guest?.send({ t: 'SETTINGS', playerId: me.playerId, settings: room.settings, mafRules });
      else publish({ ...room, mafRules });
    },

    mafSkip: () => {
      const { role, room, me } = get();
      // The host's call alone.
      if (!room?.mf || role === 'guest' || room.hostId !== me.playerId) return;
      applyIntent(me.playerId, { type: 'ADVANCE', playerId: me.playerId });
    },

    addBot: () => {
      const { role, me } = get();
      if (role === 'guest') guest?.send({ t: 'ADD_BOT', playerId: me.playerId });
      else addBotSeat();
    },

    removeSeat: (playerId) => {
      const { role, me } = get();
      if (role === 'guest') guest?.send({ t: 'REMOVE_SEAT', playerId: me.playerId, target: playerId });
      else kickTarget(me.playerId, playerId);
    },

    enforceModeration: (ids) => {
      const room = snapshot();
      if (!room || get().role === 'guest') return;
      for (const id of ids) {
        // Our own seat is never the target here - a ban on the account
        // holding this tab arrives as `banned`, not as a seat to remove.
        if (id === get().me.playerId) continue;
        const seat = room.seats.find((s) => s.playerId === id && !s.isBot);
        // The usual removal path, with its usual rules: the seat is botified
        // in a running game, deleted in a lobby, and the kicked list keeps
        // the account from walking back in.
        if (seat) kickTarget(get().me.playerId, id);
      }
    },

    moderationLeave: (kind) => {
      get().leave();
      set({ netStatus: 'closed', netError: kind === 'banned' ? tr().net.banned : tr().net.delisted });
    },

    endorse: (candidate) => {
      const { role, me } = get();
      if (role === 'guest') guest?.send({ t: 'ELECT', playerId: me.playerId, candidate });
      else endorseVote(seatFor(me.playerId), candidate);
    },

    startWithBots: () => {
      const { role, room } = get();
      if (role !== 'host' || !room || inGame(room)) return;
      const target = Math.min(seatLimit(room), room.kind === 'mafia' ? Math.max(MAF_MIN_PLAYERS, 6) : 4);
      let seats = room.seats.length;
      while (seats < target) {
        addBotSeat();
        const now = snapshot()?.seats.length ?? seats;
        if (now === seats) break;
        seats = now;
      }
      get().startGame();
    },

    startGame: () => {
      const { role, room, me } = get();
      if (!room || inGame(room)) return;
      if (role === 'guest') {
        guest?.send({ t: 'INTENT', playerId: me.playerId, action: { type: 'START_GAME', playerId: me.playerId } });
        return;
      }
      const need = room.kind === 'mafia' ? MAF_MIN_PLAYERS : 2;
      let seats = room.seats;
      if (room.settings.fillWithBots) {
        while (seats.length < need && seats.length < seatLimit(room)) {
          addBotSeat();
          seats = snapshot()?.seats ?? seats;
        }
      }
      if (seats.length < need) return;

      // The board is fixed for the game from here on: a Plus player who
      // leaves mid-game does not take the theme with them (see roomTheme).
      if (room.kind === 'monopoly' && room.settings.boardTheme !== roomTheme(room)) {
        const current = snapshot() ?? room;
        publish({ ...current, settings: { ...current.settings, boardTheme: roomTheme(room) } });
      }

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

      if (room.kind === 'mafia') {
        const settings: MafiaSettings = {
          ...MAF_DEFAULTS,
          ...room.mafRules,
          seed: room.settings.seed || randomSeed(),
          maxPlayers: seatLimit(room),
          botLevel: room.settings.botLevel,
          fillWithBots: room.settings.fillWithBots,
        };
        const started = mfReduce(createMafia(settings, specs), { type: 'START_GAME', playerId: me.playerId });
        mafPrivateCache.clear();
        resetTalk();
        set({ screen: 'game', mafLog: [], mafPrivate: null, log: [], cfLog: [] });
        publish({ ...base, seats, mf: started.state }, [], [], started.events);
        return;
      }

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

    sendReaction: (emoji) => {
      const { role, me } = get();
      if (role === 'guest') { guest?.send({ t: 'REACT', playerId: me.playerId, emoji }); return; }
      react(me.playerId, emoji);
    },

    sendChat: (text) => {
      const clean = cleanText(text, 220);
      if (!clean) return;
      const { role, me, room } = get();
      if (role === 'guest') { guest?.send({ t: 'CHAT', playerId: me.playerId, text: clean }); return; }
      const seat = room?.seats.find((s) => s.playerId === me.playerId);
      speak(seat ? me.playerId : null, seat?.name ?? me.name, seat?.color ?? '#fff', clean);
    },

    takeSeat: (target) => {
      const { role, me } = get();
      if (role === 'guest') guest?.send({ t: 'TAKE_SEAT', playerId: me.playerId, target });
    },

    rematch: () => {
      const { role, room } = get();
      if (!room || role === 'guest') return;
      if ((room.game?.phase ?? room.cf?.phase ?? room.mf?.phase) !== 'game_over') return;
      // Everyone stays seated. Signed-in watchers who stayed to the end get a
      // chair for the next one, while there are chairs.
      const seats = [...room.seats];
      for (const w of room.watchers ?? []) {
        if (seats.length >= seatLimit(room) || seats.some((x) => x.playerId === w.uid)) continue;
        const taken = new Set(seats.map((x) => x.token));
        const token = TOKENS.find((tk) => !taken.has(tk.id))?.id ?? 'camel';
        seats.push(emptySeat(w.uid, w.name, token, seats.length, false));
      }
      mafPrivateCache.clear();
      resetTalk();
      set({ screen: 'lobby', log: [], cfLog: [], mafLog: [], mafPrivate: null, animPos: {}, inspecting: null });
      // The listing ended with the game - and has to end here, before the
      // publish below announces a lobby: rematching inside one heartbeat
      // skips the game-over unlist entirely, and the room would sit on the
      // public list forever. The lobby's Public switch is there if this
      // table wants to be found again.
      stopListing();
      set({ listed: false });
      publish({
        ...room,
        game: null,
        cf: null,
        mf: null,
        seats,
        watchers: [],
        seatRequests: [],
        // A new game deals new dice and new decks. The table's moderators
        // carry over; a vote still in progress does not.
        coownerVotes: {},
        // One watched video, one game: the next board has to be earned again.
        themeTrial: false,
        settings: { ...room.settings, seed: randomSeed() },
      });
    },

    openBoardsForAGame: () => {
      const { role, room } = get();
      // Only the host runs the table, and only a lobby has a board to pick.
      if (!room || role === 'guest' || inGame(room) || room.kind !== 'monopoly') return;
      publish({ ...room, themeTrial: true });
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
    toggleHaptics: () => set((s) => {
      const hapticsOn = !s.hapticsOn;
      try { localStorage.setItem('mply.haptics', hapticsOn ? 'on' : 'off'); } catch { /* private mode */ }
      return { hapticsOn };
    }),
  };
});

/* Signing in or out changes who this tab is. At the front door that is just
 * the id it will join with next; at a table the seat is already bound, and
 * the next connect presents the pass. A sign-in that was prompted by being
 * turned away from a game in progress goes straight back to that game. */
useAccount.subscribe((next, prev) => {
  // A refreshed pass can bring Plus with it; the seat this tab hosts shows it.
  if (hasPlus(next.account) !== hasPlus(prev.account) || next.account?.profile?.picture !== prev.account?.profile?.picture) {
    useStore.getState().syncPlus();
  }
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

/* The table's board decides what every square is called on this screen. */
useStore.subscribe((s) => setBoardTheme(roomTheme(s.room)));

// Dev-only handle so the store can be poked from the console while
// debugging a live game. Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __mply: unknown }).__mply = useStore;
  // The account store too, so a signed-in (or Plus) screen can be checked
  // without a real Google round trip.
  (window as unknown as { __mplyAccount: unknown }).__mplyAccount = useAccount;
}

/* ------------------------- derived selectors ------------------------ */

export const useGame = (): GameState | null => useStore((s) => s.room?.game ?? null);

export const useCF = (): CFState | null => useStore((s) => s.room?.cf ?? null);

export const useMF = (): MafiaState | null => useStore((s) => s.room?.mf ?? null);

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
