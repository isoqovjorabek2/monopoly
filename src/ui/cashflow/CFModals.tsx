import { cfDreamArt } from '../../art/art';
import { DREAM_IDS, FAST_BOARD } from '../../cashflow/data';
import { fastName } from '../../cashflow/describe';
import { passiveIncome, progress, totalExpenses } from '../../cashflow/rules';
import type { CFAction, CFState } from '../../cashflow/types';
import { useT } from '../../i18n';
import { Avatar, Modal, fmt } from '../bits';
import { CFStatement } from './CFStatement';

const noop = () => {};

/** Everyone picks a dream before the first roll. Not dismissable: the
 *  game cannot start until the table has chosen. */
export function DreamPicker({ s, myId, dispatch }: { s: CFState; myId: string; dispatch: (a: CFAction) => void }) {
  const t = useT();
  const A = t.cf.actions;
  const me = s.players[myId];
  if (s.phase !== 'dreams' || !me || me.out || me.dream != null) return null;

  return (
    <Modal open onClose={noop} dismissable={false} title={A.chooseDream} wide>
      <p className="muted">{A.chooseDreamNote}</p>
      <div className="dreamGrid" role="list">
        {DREAM_IDS.map((id) => {
          const sp = FAST_BOARD[id];
          const takers = s.seats.filter((pid) => s.players[pid].dream === id);
          return (
            <button
              key={id}
              type="button"
              role="listitem"
              className="dreamCard"
              onClick={() => dispatch({ type: 'CHOOSE_DREAM', playerId: myId, spaceId: id })}
            >
              {sp.key && <img className="dreamCard__art" src={cfDreamArt(sp.key)} alt="" width={160} height={160} loading="lazy" />}
              <span className="dreamCard__name">{fastName(t, id)}</span>
              <span className="dreamCard__price num">{fmt(sp.cost ?? 0)}</span>
              {takers.length > 0 && (
                <span className="dreamCard__takers">
                  {takers.map((pid) => (
                    <span key={pid} className="dreamCard__dot" style={{ background: s.players[pid].color }} title={s.players[pid].name} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/** Anyone's statement, read-only. The board is face-up in Cashflow too. */
export function PlayerStatementModal({ s, playerId, onClose }: { s: CFState; playerId: string | null; onClose: () => void }) {
  const p = playerId ? s.players[playerId] : null;
  return (
    <Modal open={Boolean(p)} onClose={onClose} title={p?.name}>
      {p && <CFStatement s={s} p={p} interactive={false} dispatch={noop} />}
    </Modal>
  );
}

export function CFGameOver({ s, myId, onLeave }: { s: CFState; myId: string; onLeave: () => void }) {
  const t = useT();
  const L = t.cf.log;
  const winner = s.winnerId ? s.players[s.winnerId] : null;
  const standings = [...s.seats]
    .map((id) => s.players[id])
    .sort((a, b) => (a.id === s.winnerId ? -1 : b.id === s.winnerId ? 1 : progress(s, b) - progress(s, a)));
  const headline = !winner || !s.winReason || s.winReason === 'none'
    ? L.over.none
    : L.over[s.winReason](winner.name);

  return (
    <Modal open onClose={noop} dismissable={false} title={t.cf.gameOver.title}>
      <p className="cfOver__headline">{headline}</p>
      <ol className="cfOver__list">
        {standings.map((p, i) => (
          <li key={p.id} className="cfOver__row" data-me={p.id === myId || undefined}>
            <span className="num cfOver__rank">{i + 1}</span>
            <Avatar color={p.color} token={p.token} size={30} dim={p.out} />
            <span className="cfOver__who">
              <strong>{p.name}</strong>
              <span className="muted small">{t.cf.professions[p.profession]}</span>
            </span>
            <span className="num small">
              {p.out ? t.cf.rail.out
                : p.track === 'fast' ? t.cf.rail.day(fmt(p.fastIncome), fmt(p.fastGoal))
                  : t.cf.rail.passive(fmt(passiveIncome(p)), fmt(totalExpenses(p)))}
            </span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn--primary btn--block" onClick={onLeave}>{t.cf.gameOver.home}</button>
    </Modal>
  );
}

export function CFHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const H = t.cf.help;
  return (
    <Modal open={open} onClose={onClose} title={H.title}>
      <div className="cfHelp">
        {H.sections.map(([heading, lines]) => (
          <section key={heading}>
            <h3 className="cfHelp__head">{heading}</h3>
            <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
          </section>
        ))}
        <p className="muted small">{H.keys}</p>
      </div>
    </Modal>
  );
}
