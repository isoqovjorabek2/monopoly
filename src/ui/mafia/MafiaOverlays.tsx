import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { mafRoleCard } from '../../art/art';
import { useT } from '../../i18n';
import { deathLine } from '../../mafia/describe';
import { ROLE_TEAM } from '../../mafia/data';
import type { MafiaDeath, MafiaRole, MafiaState, MatchStats } from '../../mafia/types';
import { Modal } from '../bits';

/* ------------------------------ the deal ------------------------------ */

/** The card turned over at the start: the role, what it does, the family. */
export function RoleReveal({
  role, teammates, name, onClose,
}: {
  role: MafiaRole;
  teammates: { id: string; role: MafiaRole }[];
  name: (id: string) => string;
  onClose: () => void;
}) {
  const t = useT();
  const M = t.maf;
  return (
    <motion.div className="mfOverlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      role="dialog" aria-modal="true" aria-label={M.reveal.title}>
      <div className="mfOverlay__body">
        <p className="overline mfOverlay__kicker">{M.reveal.title}</p>
        <motion.div
          className="mfCard"
          data-team={ROLE_TEAM[role]}
          initial={{ rotateY: 180, scale: 0.8 }}
          animate={{ rotateY: 0, scale: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
        >
          <img className="mfCard__art" src={mafRoleCard(role)} alt={M.roles[role].name} width={283} height={265} />
          <div className="mfCard__text">
            <p className="overline">{M.reveal.yourRole}</p>
            <h2 className="mfCard__name">{M.roles[role].name}</h2>
            <p className="mfCard__brief">{M.roles[role].brief}</p>
            {teammates.length > 0 && (
              <p className="mfCard__team">
                <span className="overline">{M.reveal.teammatesTitle}</span>{' '}
                {teammates.map((x) => `${name(x.id)} (${M.roles[x.role].name})`).join(', ')}
              </p>
            )}
          </div>
        </motion.div>
        <p className="muted small">{M.reveal.lead}</p>
        <button type="button" className="btn btn--primary" onClick={onClose} autoFocus>{M.reveal.ack}</button>
      </div>
    </motion.div>
  );
}

/* ------------------------------ a death ------------------------------ */

/** A death, full screen for a moment: the card if the table shows roles,
 *  the cause either way. */
export function ElimScreen({ m, death, onClose }: { m: MafiaState; death: MafiaDeath; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const id = window.setTimeout(onClose, 4200);
    return () => window.clearTimeout(id);
  }, [onClose]);
  const p = m.players[death.id];
  return (
    <motion.div className="mfOverlay mfOverlay--elim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose} role="alert">
      <motion.div className="mfOverlay__blood" initial={{ scale: 0, opacity: 0.8 }} animate={{ scale: 3, opacity: 0 }}
        transition={{ duration: 2.4, ease: 'easeOut' }} aria-hidden />
      <div className="mfOverlay__body">
        <motion.div initial={{ scale: 0.6, rotate: -8, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.2 }}>
          {death.role
            ? <img className="mfElim__card" src={mafRoleCard(death.role)} alt="" width={200} height={187} />
            : <span className="mfElim__mark" aria-hidden>✝</span>}
        </motion.div>
        <h2 className="mfElim__name" style={{ color: p?.color }}>{p?.name}</h2>
        <p className="mfElim__line">{deathLine(m, death, t)}</p>
      </div>
    </motion.div>
  );
}

/* ------------------------------ the end ------------------------------ */

export function myTeamWon(m: MafiaState, myId: string): boolean {
  const role = m.finalRoles?.[myId];
  if (!role || !m.winner) return false;
  if (m.winner === 'jester') return m.winnerId === myId;
  return ROLE_TEAM[role] === m.winner;
}

function statLine(t: ReturnType<typeof useT>, st: MatchStats, survived: boolean): string {
  const S = t.maf.end.stat;
  const parts: string[] = [];
  if (st.kills) parts.push(S.kills(st.kills));
  if (st.saves) parts.push(S.saves(st.saves));
  if (st.reads) parts.push(S.reads(st.reads));
  if (st.finds) parts.push(S.finds(st.finds));
  if (survived) parts.push(S.survived);
  return parts.slice(0, 2).join(' · ') || S.clutch;
}

export function MafiaGameOver({
  m, myId, onLeave, onRematch,
}: { m: MafiaState; myId: string; onLeave: () => void; onRematch?: () => void }) {
  const t = useT();
  const M = t.maf;
  const name = (id: string | null): string => (id && m.players[id]?.name) || t.defaults.someone;
  const headline = m.winner === 'mafia' ? M.over.mafiaWins
    : m.winner === 'village' ? M.over.villageWins
      : m.winner === 'jester' ? M.over.jesterWins(name(m.winnerId))
        : M.over.abandoned;
  const seated = Boolean(m.players[myId]);
  const won = myTeamWon(m, myId);
  const verdict = !seated || !m.finalRoles ? M.end.spectated : won ? M.end.youWon : M.end.youLost;

  // For a loser, the one that got away - the most specific that fits.
  let nearMiss: string | null = null;
  if (seated && m.finalRoles && !won) {
    const familyLeft = m.seats.filter((id) => m.players[id].alive && ROLE_TEAM[m.finalRoles![id]] === 'mafia').length;
    if (m.finalEliminatedId === myId && m.lastVoteMargin === 1) nearMiss = M.end.nearMiss.survive;
    else if (m.winner === 'mafia' && familyLeft === 1) nearMiss = M.end.nearMiss.town;
    else if (m.winner === 'village' && m.lastVoteMargin === 1) nearMiss = M.end.nearMiss.family;
  }

  return (
    <Modal open onClose={() => {}} title={M.over.title} dismissable={false}>
      <div className="mfOver">
        <motion.p className="mfOver__headline" data-winner={m.winner ?? undefined}
          initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 240, damping: 18 }}>
          {headline}
        </motion.p>
        <p className="mfOver__verdict" data-won={won || undefined}>{verdict}</p>
        {nearMiss && <p className="mfOver__near">{nearMiss}</p>}
        {m.mvp && (
          <p className="mfOver__mvp" data-you={m.mvp.id === myId || undefined}>
            <span className="mfOver__mvpBadge">{M.end.mvp}</span>
            {m.mvp.id === myId ? M.end.mvpYou : name(m.mvp.id)}
            <span className="muted"> · {statLine(t, m.mvp.stats, m.mvp.survived)}</span>
          </p>
        )}
        {m.finalRoles && (
          <>
            <p className="overline">{M.end.rolesTitle}</p>
            <ul className="mfOver__roles">
              {m.seats.map((id) => {
                const r = m.finalRoles![id];
                return (
                  <li key={id} data-team={ROLE_TEAM[r]} data-dead={!m.players[id].alive || undefined}>
                    <img src={mafRoleCard(r)} alt="" width={36} height={34} />
                    <span className="truncate">{m.players[id].name}{id === myId && ` ${M.table.self}`}</span>
                    <span className="spacer" />
                    <span className="mfOver__role">{M.roles[r].name}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {onRematch ? (
          <button type="button" className="btn btn--primary btn--block" onClick={onRematch}>{t.table.rematch.again}</button>
        ) : (
          <p className="muted small">{t.table.rematch.waiting}</p>
        )}
        <button type="button" className={`btn btn--block ${onRematch ? 'btn--ghost' : 'btn--primary'}`} onClick={onLeave}>
          {t.gameOver.home}
        </button>
      </div>
    </Modal>
  );
}

export function MafiaHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const H = t.maf.help;
  return (
    <Modal open={open} onClose={onClose} title={H.title}>
      <ul className="mfHelp">{H.lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </Modal>
  );
}
