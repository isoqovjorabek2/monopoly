import { useEffect, useState } from 'react';
import { useLang, useT } from '../i18n';
import { useAccount } from '../net/account';
import { fetchHistory, type History } from '../net/history';
import { Modal, fmt } from './bits';
import { PlusBadge } from './Plus';

/* ------------------------------------------------------------------ *
 * "Your games": totals for every signed-in player, and the game-by-game
 * list for Plus. The server decides which comes back; this only draws it.
 * ------------------------------------------------------------------ */

export function StatsSheet({
  open, onClose, onGetPlus,
}: { open: boolean; onClose: () => void; onGetPlus: () => void }) {
  const t = useT();
  const P = t.account.plus;
  const lang = useLang();
  const uid = useAccount((s) => s.account?.uid);
  const [data, setData] = useState<History | 'loading' | 'failed'>('loading');

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setData('loading');
    void fetchHistory().then((h) => { if (live) setData(h ?? 'failed'); });
    return () => { live = false; };
  }, [open, uid]);

  const gameName = (k: 'monopoly' | 'cashflow') => (k === 'cashflow' ? t.cf.name : 'Bazaar Barons');
  const day = (at: number) => {
    try {
      return new Date(at * 1000).toLocaleDateString(lang, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={P.statsTitle} wide>
      {data === 'loading' ? (
        <p className="muted">{P.loading}</p>
      ) : data === 'failed' ? (
        <p className="muted">{P.statsUnavailable}</p>
      ) : (
        <div className="stats">
          <div className="stats__totals">
            <Stat label={P.played} value={String(data.totals.played)} />
            <Stat label={P.wins} value={String(data.totals.wins)} />
            <Stat
              label={P.winRate}
              value={data.totals.played ? `${Math.round((100 * data.totals.wins) / data.totals.played)}%` : '—'}
            />
          </div>

          <div className="stats__kinds">
            {(['monopoly', 'cashflow'] as const).map((k) => {
              const kind = data.totals.byKind[k];
              return (
                <div key={k} className="stats__kind">
                  <span className="stats__kindName">{gameName(k)}</span>
                  <span className="muted small">{P.kindLine(kind.played, kind.wins)}</span>
                  {kind.played > 0 && <span className="small">{P.best(fmt(kind.best))}</span>}
                </div>
              );
            })}
          </div>

          <h3 className="stats__heading">
            {P.recent}
            {!data.plus && <PlusBadge small />}
          </h3>

          {!data.plus ? (
            <div className="stats__locked">
              <p className="muted small">{P.historyLocked}</p>
              <button type="button" className="btn btn--primary btn--sm" onClick={onGetPlus}>{P.get}</button>
            </div>
          ) : data.games.length === 0 ? (
            <p className="muted small">{P.noGames}</p>
          ) : (
            <ul className="stats__games">
              {data.games.map((g) => (
                <li key={g.id} className="stats__game" data-won={g.won || undefined}>
                  <span className="stats__place num">{g.won ? P.won : P.place(g.place)}</span>
                  <span className="stats__gameMain">
                    <span className="stats__gameName">{gameName(g.kind)}</span>
                    <span className="muted small truncate">
                      {g.players.map((p) => (p.you ? `${p.name} ★` : p.name)).join(', ')}
                    </span>
                  </span>
                  <span className="stats__gameMeta muted small num">
                    {fmt(g.score)} · {P.rounds(g.rounds)} · {day(g.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats__stat">
      <span className="stats__value num">{value}</span>
      <span className="stats__label">{label}</span>
    </div>
  );
}
