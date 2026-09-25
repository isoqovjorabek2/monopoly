import { useStore } from '../store/store';
import { buildReport } from './tableReport';
import { closeTable, hasDirectory, reportTable, type TableReport } from './directory';

export { buildReport };

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

/** What makes a report worth sending before the next beat. */
const signature = (r: TableReport): string => [
  r.id, r.mode, r.phase, r.round, r.winner ?? '',
  r.players.map((p) => `${p.id}:${p.connected ? 1 : 0}:${p.out ? 1 : 0}`).join(','),
].join('|');

const current = (): TableReport | null => {
  const { room, role, listed } = useStore.getState();
  if (!room || role === 'guest' || !tableId) return null;
  return buildReport(tableId, room, role, listed);
};

const sendNow = (): void => {
  if (pending) { window.clearTimeout(pending); pending = null; }
  const report = current();
  if (!report) return;
  lastSent = Date.now();
  lastSig = signature(report);
  void reportTable(report).then((ack) => {
    // The directory's answer can carry the operator's moderation. This tab
    // runs the table, so it is the one that can act on it: remove banned
    // accounts from their seats, and disband the table if its own host -
    // this tab - is the one banned.
    if (!ack) return;
    const st = useStore.getState();
    if (ack.bannedSeats?.length) st.enforceModeration(ack.bannedSeats);
    if (ack.banned) st.moderationLeave('banned');
  });
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
