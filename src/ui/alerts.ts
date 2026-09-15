import { useCallback, useEffect, useRef, useState } from 'react';
import { waitingOn } from '../game/rules';
import { waitingOn as cfWaitingOn } from '../cashflow/rules';
import type { Dict } from '../i18n';
import type { RoomSnapshot } from '../net/protocol';

/* ------------------------------------------------------------------ *
 * Telling a player the table is waiting on them when they are looking
 * somewhere else.
 *
 * A long game is played in the background: a player checks another tab,
 * and the table sits waiting on a roll nobody knows is theirs. So when the
 * table needs this player and the tab is hidden, the tab's title flashes -
 * always, since it costs nothing and asks nothing - and, if the player has
 * turned alerts on, the browser shows a notification too. Both stop the
 * moment the tab is looked at.
 * ------------------------------------------------------------------ */

const KEY = 'mply.alerts';

const readOn = (): boolean => {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
};

const canNotify = (): boolean => typeof window !== 'undefined' && 'Notification' in window;

/** The alerts switch: on only once the browser has actually allowed it. */
export function useAlertsSwitch(): {
  on: boolean;
  blocked: boolean;
  toggle: () => void;
} {
  const [on, setOn] = useState(() => readOn() && canNotify() && Notification.permission === 'granted');
  const [blocked, setBlocked] = useState(() => canNotify() && Notification.permission === 'denied');

  const toggle = useCallback(() => {
    const save = (v: boolean) => { try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch { /* private */ } setOn(v); };
    if (on) { save(false); return; }
    if (!canNotify()) return;
    if (Notification.permission === 'granted') { save(true); return; }
    void Notification.requestPermission().then((p) => {
      setBlocked(p === 'denied');
      save(p === 'granted');
    });
  }, [on]);

  return { on, blocked, toggle };
}

/** What the table wants from this player right now, if anything. `key`
 *  changes whenever it is a new thing to be told about. */
export interface Need { key: string; message: string }

/**
 * What the table is waiting on this player for, in order of how much it
 * matters: their own move, then an offer sent to them, then - for the host -
 * a watcher asking for a seat.
 */
export function tableNeed(t: Dict, room: RoomSnapshot | null, myId: string, isHost: boolean): Need | null {
  if (!room) return null;
  const g = room.game;
  const c = room.cf;
  const phase = g?.phase ?? c?.phase;
  if (!phase || phase === 'lobby' || phase === 'game_over') return null;

  const waiting = g ? waitingOn(g) : c ? cfWaitingOn(c) : [];
  if (waiting.includes(myId)) {
    const mine = g ? g.seats[g.seatIndex] === myId : c ? c.seats[c.seatIndex] === myId : false;
    const at = g ? `${g.turnNumber}|${g.phase}` : `${c?.turnNumber}|${c?.phase}`;
    return { key: `move|${at}`, message: mine ? t.table.alerts.yourTurn : t.table.alerts.needed };
  }
  const offer = g?.trades.filter((x) => x.to === myId).at(-1);
  if (offer) {
    return { key: `offer|${offer.id}`, message: t.table.alerts.offer(g!.players[offer.from]?.name ?? '') };
  }
  const request = isHost ? room.seatRequests?.at(-1) : undefined;
  if (request) return { key: `seat|${request.uid}|${request.target}`, message: t.table.alerts.request(request.name) };
  return null;
}

export function useTableAlert(need: Need | null, alertsOn: boolean): void {
  const baseTitle = useRef(typeof document !== 'undefined' ? document.title : '');
  const flash = useRef<number | null>(null);
  const told = useRef('');

  const stop = useCallback(() => {
    if (flash.current) window.clearInterval(flash.current);
    flash.current = null;
    document.title = baseTitle.current;
  }, []);

  useEffect(() => {
    const onVisible = () => { if (!document.hidden) stop(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); stop(); };
  }, [stop]);

  useEffect(() => {
    if (!need) { told.current = ''; stop(); return; }
    if (need.key === told.current || !document.hidden) return;
    told.current = need.key;

    stop();
    let lit = false;
    flash.current = window.setInterval(() => {
      lit = !lit;
      document.title = lit ? `● ${need.message}` : baseTitle.current;
    }, 1000);

    if (alertsOn && canNotify() && Notification.permission === 'granted') {
      try {
        const n = new Notification(need.message, { tag: 'mply-table', body: baseTitle.current });
        n.onclick = () => { window.focus(); n.close(); };
      } catch { /* some mobile browsers only notify from a service worker */ }
    }
  }, [need, alertsOn, stop]);
}
