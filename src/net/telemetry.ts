import { passiveIncome } from '../cashflow/rules';
import { netWorth } from '../game/rules';
import { tr } from '../i18n';
import { useStore } from '../store/store';
import { closeTable, hasDirectory, reportTable, type TableReport } from './directory';
import type { RoomSnapshot } from './protocol';

/* ------------------------------------------------------------------ *
 * Table reports for the operator's panel.
 *
 * Whoever runs a table - the host of a shared room, or the one browser a
 * solo game lives in - tells the directory what that table looks like:
 * which game, who is sitting at it, whether it has started, whose cash is
 * where. Guests never report; the host already holds the whole picture.
 *
 * Same rule as the public list: fire and forget. A report that fails is a
 * gap on a monitoring page, never a hiccup at the table, and nothing here
 * waits on the network.
 *
 * Sent on anything that changes the shape of a table (a seat filling, the
 * game starting, a player dropping, a winner) and otherwise every 20
 * seconds, which is also how the directory learns a table has gone: it
 * stops hearing about it.
 * ------------------------------------------------------------------ */

const BEAT_MS = 20_000;
/** Bots can change a table several times a second; the panel does not
 *  need every one of them. */
const MIN_GAP_MS = 2_500;
/** A solo table has no room code, so it gets one for the life of the tab. */
const SOLO_KEY = 'mply.table';

let started = false;
let tableId: string | null = null;
let lastSig = '';
let lastSent = 0;
let pending: number | null = null;
let beat: number | null = null;

const soloId = (): string => {
  try {
    const saved = sessionStorage.getItem(SOLO_KEY);
    if (saved) return saved;
  } catch { /* private mode */ }
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'SOLO-';
  for (let i = 0; i < 8; i++) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  try { sessionStorage.setItem(SOLO_KEY, id); } catch { /* private mode */ }
  return id;
};

export function buildReport(
  id: string, room: RoomSnapshot & { kind: 'monopoly' | 'cashflow' }, role: 'host' | 'local', listed: boolean,
): TableReport {
  const hostIds = new Set(room.seats.filter((s) => s.isHost).map((s) => s.playerId));
  const base = {
    id,
    kind: room.kind,
    mode: role === 'local' ? 'solo' : listed ? 'public' : 'private',
    maxSeats: room.settings.maxPlayers,
    epoch: room.epoch,
    device: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop',
    lang: tr().langName,
  } as const;

  if (room.game) {
    const g = room.game;
    const current = g.players[g.seats[g.seatIndex]];
    return {
      ...base,
      phase: g.phase === 'game_over' ? 'over' : 'playing',
      round: g.round,
      turn: g.phase === 'game_over' ? null : current?.name ?? null,
      winner: g.winnerId ? g.players[g.winnerId]?.name ?? null : null,
      players: g.seats.map((pid) => {
        const p = g.players[pid];
        return {
          id: pid, name: p.name, color: p.color, token: p.token,
          bot: p.isBot, host: hostIds.has(pid), connected: p.isBot || p.connected,
          cash: p.cash, worth: netWorth(g, pid), out: p.bankrupt,
        };
      }),
    };
  }

  if (room.cf) {
    const s = room.cf;
    const current = s.players[s.seats[s.seatIndex]];
    return {
      ...base,
      phase: s.phase === 'game_over' ? 'over' : 'playing',
      round: s.round,
      turn: s.phase === 'game_over' ? null : current?.name ?? null,
      winner: s.winnerId ? s.players[s.winnerId]?.name ?? null : null,
      players: s.seats.map((pid) => {
        const p = s.players[pid];
        return {
          id: pid, name: p.name, color: p.color, token: p.token,
          bot: p.isBot, host: hostIds.has(pid), connected: p.isBot || p.connected,
          // Cashflow's score is passive income against the way out, not a pile.
          cash: p.cash, worth: passiveIncome(p), out: p.out, track: p.track,
        };
      }),
    };
  }

  return {
    ...base,
    phase: 'lobby',
    round: 0,
    turn: null,
    winner: null,
    players: room.seats.map((s) => ({
      id: s.playerId, name: s.name, color: s.color, token: s.token,
      bot: s.isBot, host: s.isHost, connected: s.isBot || s.connected,
      cash: 0, worth: 0, out: false,
    })),
  };
}

/** What makes a report worth sending before the next beat. */
const signature = (r: TableReport): string => [
  r.id, r.mode, r.phase, r.round, r.winner ?? '',
  r.players.map((p) => `${p.id}:${p.connected ? 1 : 0}:${p.out ? 1 : 0}`).join(','),
].join('|');

const current = (): TableReport | null => {
  const { room, role, listed } = useStore.getState();
  // The lobby server knows the two older games; an Omertà table reports
  // nothing rather than being rejected on every beat.
  if (!room || role === 'guest' || !tableId || room.kind === 'mafia') return null;
  return buildReport(tableId, room as RoomSnapshot & { kind: 'monopoly' | 'cashflow' }, role, listed);
};

const sendNow = (): void => {
  if (pending) { window.clearTimeout(pending); pending = null; }
  const report = current();
  if (!report) return;
  lastSent = Date.now();
  lastSig = signature(report);
  void reportTable(report);
};

const sendSoon = (): void => {
  if (pending) return;
  const wait = MIN_GAP_MS - (Date.now() - lastSent);
  if (wait <= 0) sendNow();
  else pending = window.setTimeout(sendNow, wait);
};

const forgetSoloId = (): void => {
  try { sessionStorage.removeItem(SOLO_KEY); } catch { /* private mode */ }
};

const onChange = (): void => {
  const { room, role } = useStore.getState();

  // A solo game ends and a new one is dealt without the room ever being
  // empty in between: a finished table going back to a lobby is a new table.
  const restarted = tableId?.startsWith('SOLO-') && room && !room.game && !room.cf && lastSig.includes('|over|');

  let nextId: string | null = null;
  if (room && role !== 'guest') {
    if (role !== 'local') nextId = room.roomId;
    else if (tableId?.startsWith('SOLO-') && !restarted) nextId = tableId;
    else {
      if (restarted) forgetSoloId();
      nextId = soloId();
    }
  }

  if (nextId !== tableId) {
    if (tableId) {
      void closeTable(tableId);
      // The solo id belongs to the table that ended, not to the tab. (A
      // refresh never gets here: a fresh page has no table to close, so the
      // saved game picks the same id back up.)
      if (tableId.startsWith('SOLO-') && !nextId?.startsWith('SOLO-')) forgetSoloId();
    }
    tableId = nextId;
    lastSig = '';
    if (beat) { window.clearInterval(beat); beat = null; }
    if (tableId) {
      beat = window.setInterval(sendNow, BEAT_MS);
      sendNow();
    }
    return;
  }

  const report = current();
  if (report && signature(report) !== lastSig) sendSoon();
};

export function startTelemetry(): void {
  if (started || !hasDirectory) return;
  started = true;
  useStore.subscribe(onChange);
  onChange();
}
