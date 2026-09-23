import type { CSSProperties, ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { MicOff, WifiOff } from 'lucide-react';
import { useT } from '../../../i18n';
import { AvatarImg } from '../Hud';
import type { RoleDef, ViewPlayer } from '../model';
import { Portrait } from './Portrait';

/* ------------------------------------------------------------------ *
 * One suspect, dealt face up: a seat number, a portrait, a name plate.
 * Around its edge sit what this seat knows about them - an ally's
 * seal, a detective's finding, the family's knives, the ballots on
 * them - and your own private read in the corner. A move lands on it
 * as a stamp: ghosted while you decide, slammed down when you do.
 * ------------------------------------------------------------------ */

export type Note = 'suspect' | 'trust';

export interface Stamp {
  label: string;
  color: string;
  pending: boolean;
  /** Changes on each slam, so the card jolts again. */
  key: string;
}

interface Props {
  player: ViewPlayer;
  seatNo: number;
  index: number;
  role: RoleDef | null;
  isMe: boolean;
  isAlly: boolean;
  tappable: boolean;
  selected: boolean;
  dim: boolean;
  stamp: Stamp | null;
  voters: { id: string; name: string; color: string }[];
  leading: boolean;
  knives: string[];
  check: { faction: string; guilty: boolean } | null;
  note: Note | null;
  /** Null when this card takes no note (you, the dead). */
  onNote: (() => void) | null;
  onTap: () => void;
  /** The lobby's use: a line in place of the role under the name, a seal
   *  in place of "You", and a control in place of the note tag. */
  sub?: string;
  seal?: string;
  corner?: ReactNode;
}

const ROMAN: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export const roman = (n: number): string => {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
};

const MAX_FACES = 5;

export function SuspectCard({
  player, seatNo, index, role, isMe, isAlly, tappable, selected, dim, stamp, voters, leading, knives, check, note, onNote, onTap,
  sub, seal, corner,
}: Props) {
  const t = useT();
  const D = t.maf.ui.deck;
  const reduce = useReducedMotion();
  // Dealt a little crooked, the same way every time.
  const tilt = reduce ? 0 : ((seatNo * 7) % 5 - 2) * 0.6;
  const label = [
    player.username,
    isMe ? D.you : '',
    role ? role.name : '',
    check ? D.checked(check.faction) : '',
    voters.length ? t.maf.table.votes(voters.length) : '',
    leading ? D.leading : '',
  ].filter(Boolean).join(' · ');
  const shown = voters.slice(0, MAX_FACES);
  const extra = voters.length - shown.length;

  return (
    <motion.div
      layoutId={`dk-${player.id}`}
      className="dk-card"
      data-tappable={tappable}
      data-selected={selected}
      data-dim={dim}
      data-me={isMe}
      data-ally={isAlly}
      data-leading={leading}
      data-offline={!player.isConnected}
      style={{ '--dk-card-c': role?.color } as CSSProperties}
      initial={reduce ? false : { opacity: 0, y: 60, rotate: -8, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, rotate: tilt, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24, delay: reduce ? 0 : index * 0.045 }}
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      aria-pressed={tappable ? selected : undefined}
      aria-label={label}
      onClick={tappable ? onTap : undefined}
      onKeyDown={(e) => { if (tappable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onTap(); } }}
    >
      <motion.div
        key={stamp && !stamp.pending ? stamp.key : 'still'}
        className="dk-card__body"
        initial={false}
        animate={stamp && !stamp.pending && !reduce ? { x: [0, -5, 4, -2, 0], rotate: [0, -1.5, 1, 0] } : {}}
        transition={{ duration: 0.38, delay: 0.12 }}
      >
        <span className="dk-card__frame" />
        <span className="dk-card__num">{roman(seatNo)}</span>
        {role && <span className="dk-card__role" title={role.name} aria-hidden>{role.icon}</span>}
        {(player.isSilenced || !player.isConnected) && (
          <span className="dk-card__icons" aria-hidden>
            {player.isSilenced && <MicOff size={12} />}
            {!player.isConnected && <WifiOff size={12} />}
          </span>
        )}
        <div className="dk-card__art">
          <Portrait playerId={player.id} avatar={player.avatar} size={180} />
        </div>
        <div className="dk-card__plate">
          <span className="dk-card__name">{player.username}</span>
          <span className="dk-card__sub">
            {sub ?? (isMe ? D.you : role ? role.name : player.isSilenced ? t.maf.table.silenced : ' ')}
          </span>
        </div>
      </motion.div>

      {(seal || isMe) && <span className="dk-seal dk-seal--you">{seal ?? D.you}</span>}
      {corner}
      {isAlly && <span className="dk-seal dk-seal--ally">{t.maf.ui.ally}</span>}
      {check && <span className="dk-seal dk-seal--check" data-guilty={check.guilty}>🔍 {check.faction}</span>}

      <AnimatePresence>
        {knives.length > 0 && (
          <motion.span key="knives" className="dk-seal dk-seal--knife" title={D.marks(knives.join(', '))}
            initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.4 }}>
            🔪 {knives.length > 1 ? `×${knives.length}` : knives[0]}
          </motion.span>
        )}
      </AnimatePresence>

      {onNote && (
        <button
          type="button"
          className="dk-note"
          data-note={note ?? 'none'}
          aria-label={`${D.noteLabel(player.username)}${note ? `: ${D.notes[note]}` : ''}`}
          title={note ? D.notes[note] : D.noteLabel(player.username)}
          onClick={(e) => { e.stopPropagation(); onNote(); }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {note === 'trust' ? '✓' : '?'}
        </button>
      )}

      <AnimatePresence>
        {stamp && (
          <motion.span
            key={`${stamp.label}-${stamp.pending ? 'p' : stamp.key}`}
            className="dk-stamp"
            data-pending={stamp.pending}
            style={{ '--dk-stamp-c': stamp.color } as CSSProperties}
            initial={reduce ? { opacity: 0 } : stamp.pending ? { opacity: 0, scale: 0.9, rotate: -12 } : { opacity: 0, scale: 2.6, rotate: -28 }}
            animate={stamp.pending
              ? { opacity: [0.7, 1, 0.7], scale: [1, 1.05, 1], rotate: -12 }
              : { opacity: 1, scale: 1, rotate: -12 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
            transition={stamp.pending
              ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }
              : { type: 'spring', stiffness: 700, damping: 26 }}
          >
            {stamp.label}
          </motion.span>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {voters.length > 0 && (
          <motion.span key="tally" className="dk-tally" aria-hidden
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
            {voters.length}
          </motion.span>
        )}
      </AnimatePresence>
      <div className="dk-ballots" aria-hidden>
        <AnimatePresence>
          {shown.map((v) => (
            <motion.span key={v.id} className="dk-ballot" title={v.name}
              style={{ '--dk-ballot-c': v.color } as CSSProperties}
              initial={reduce ? false : { opacity: 0, y: -40, scale: 1.6 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.5 }}
              transition={{ type: 'spring', stiffness: 520, damping: 24 }}>
              <AvatarImg avatar={v.name} playerId={v.id} size={24} />
            </motion.span>
          ))}
          {extra > 0 && <span key="more" className="dk-ballot dk-ballot--more">+{extra}</span>}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** A card turned over and laid aside: the role if the table shows it. */
export function GraveCard({ player, role }: { player: ViewPlayer; role: RoleDef | null }) {
  const t = useT();
  return (
    <motion.div
      layoutId={`dk-${player.id}`}
      className="dk-grave"
      style={{ '--dk-card-c': role?.color } as CSSProperties}
      role="img"
      aria-label={`${player.username} · ${role ? role.name : t.maf.ui.dead}`}
      initial={{ rotateY: 180, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 22 }}
    >
      <span className="dk-grave__icon">{role ? role.icon : '💀'}</span>
      {role && <span className="dk-grave__role">{role.name}</span>}
      <span className="dk-grave__name">{player.username}</span>
    </motion.div>
  );
}
