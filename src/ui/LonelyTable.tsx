import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useStore } from '../store/store';

/* ------------------------------------------------------------------ *
 * A public table nobody has sat down at. After a minute of waiting the
 * host is offered the way out: start now against bots. The table stays
 * listed while it has bots, and whoever finds it later can take a bot's
 * chair - so starting is not giving up on company.
 * ------------------------------------------------------------------ */

const WAIT_MS = 60_000;

export function LonelyTable({ className }: { className?: string }) {
  const t = useT();
  const L = t.lonely;
  const room = useStore((s) => s.room);
  const role = useStore((s) => s.role);
  const listed = useStore((s) => s.listed);
  const startWithBots = useStore((s) => s.startWithBots);
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const humans = room?.seats.filter((s) => !s.isBot).length ?? 0;
  const alone = role === 'host' && listed && humans <= 1;

  useEffect(() => { setSince(alone ? Date.now() : null); }, [alone]);
  useEffect(() => {
    if (since === null) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, [since]);

  if (since === null || now - since < WAIT_MS) return null;
  return (
    <div className={`banner lonely ${className ?? ''}`} role="status">
      <span className="lonely__text">
        <strong>{L.title}</strong> {L.body}
      </span>
      <button type="button" className="btn btn--primary btn--sm" onClick={startWithBots}>{L.start}</button>
    </div>
  );
}
