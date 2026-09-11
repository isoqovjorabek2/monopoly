import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT, type Dict } from '../i18n';
import { hasDirectory, listRooms, type PublicRoom } from '../net/directory';

/* ------------------------------------------------------------------ *
 * Tables anyone can walk up to.
 *
 * Private rooms have always worked by passing a code to someone you know.
 * This is the other half: hosts who tick "list publicly" appear here, and
 * stop appearing 45 seconds after they close the tab or the first roll is
 * made - a game in progress cannot be joined, so listing one would be an
 * invitation to a door that does not open.
 *
 * The list is the only thing on this page that needs a server, so it is
 * built to be absent: no directory, no section, and every other way in
 * still works.
 * ------------------------------------------------------------------ */

function ago(t: Dict, seconds: number): string {
  if (seconds < 60) return t.rooms.justOpened;
  const m = Math.floor(seconds / 60);
  return m < 60 ? t.rooms.minAgo(m) : t.rooms.hoursAgo(Math.floor(m / 60));
}

export function PublicRooms({ onJoin }: { onJoin: (code: string) => void }) {
  const t = useT();
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    const list = await listRooms();
    setRooms(list);
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!hasDirectory) return undefined;
    void refresh();
    // Rooms expire in 45s, so anything slower than this shows tables that
    // are already gone; anything faster is polling a phone book.
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (!hasDirectory) return null;

  const [emptyBefore, emptyStrong, emptyAfter] = t.rooms.empty;

  return (
    <section className="rooms" aria-labelledby="rooms-title">
      <header className="rooms__head">
        <h2 className="rooms__title" id="rooms-title">{t.rooms.title}</h2>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => { void refresh(); }}
          disabled={busy}
        >
          {busy ? t.rooms.looking : t.rooms.refresh}
        </button>
      </header>

      {/* Three states, all of them designed: not yet asked, asked and empty,
          asked and full. The middle one is the common case for a small game
          and it should not look like a failure. */}
      {rooms === null ? (
        <ul className="rooms__list" aria-hidden>
          {[0, 1].map((i) => <li key={i} className="roomRow roomRow--ghost" />)}
        </ul>
      ) : rooms.length === 0 ? (
        <p className="rooms__empty">
          {emptyBefore}
          <strong>{emptyStrong}</strong>{emptyAfter}
        </p>
      ) : (
        <ul className="rooms__list">
          <AnimatePresence initial={false}>
            {rooms.map((room, i) => {
              const full = room.seats >= room.maxSeats;
              return (
                <motion.li
                  key={room.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.24, delay: Math.min(i, 6) * 0.03, ease: [0.22, 1, 0.36, 1] }}
                  className="roomRow"
                  data-full={full || undefined}
                >
                  <span className="roomRow__who">
                    <span className="roomRow__host truncate">{room.host}</span>
                    <span className="roomRow__meta">
                      {t.presets[room.preset]?.name ?? t.rooms.custom}
                      {room.deviations > 0 && (
                        <> · <span title={t.rooms.changedRules}>
                          {t.rooms.houseRules(room.deviations)}
                        </span></>
                      )}
                      {' · '}{ago(t, room.age)}
                    </span>
                  </span>

                  <span className="roomRow__seats num" title={t.rooms.seatsTaken(room.seats, room.maxSeats)}>
                    {room.seats}/{room.maxSeats}
                  </span>

                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={full}
                    title={full ? t.rooms.tableFull : t.rooms.joinHost(room.host)}
                    onClick={() => onJoin(room.id)}
                  >
                    {full ? t.common.full : t.common.join}
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
