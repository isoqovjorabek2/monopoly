import { forwardRef, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring } from 'framer-motion';
import { MicOff, Skull, WifiOff } from 'lucide-react';
import { useT } from '../../../i18n';
import type { MafiaRole } from '../../../mafia/types';
import { AvatarImg } from '../Hud';
import { roleDef, type ViewPlayer } from '../model';
import { Ballot } from './Cards';

/* ------------------------------------------------------------------ *
 * A player at the table, drawn as a playing card standing on its end:
 * the portrait above, the name plate below. It tilts toward the
 * pointer, glows when a card in your hand can land on it, dims when it
 * cannot, and turns over when its player dies - to their role, if the
 * table shows roles, or to a skull if it does not.
 * ------------------------------------------------------------------ */

export type SeatMode = 'idle' | 'target' | 'blocked';

export interface SeatBits {
  isMe: boolean;
  isAlly: boolean;
  mode: SeatMode;
  /** The colour a target glows in: the armed card's. */
  aimColor: string;
  /** Ballots lying on this seat, one colour per voter. */
  ballots: string[];
  leading: boolean;
  /** The family's knives on this seat tonight (family eyes only). */
  knives: number;
  /** This seat's own ballot lies here. */
  myBallot: boolean;
  /** A shockwave, when a card slams down here. */
  pulse: { key: number; color: string } | null;
}

interface Props extends SeatBits {
  player: ViewPlayer;
  w: number;
  h: number;
  x: number;
  y: number;
  index: number;
  onTap: (id: string) => void;
}

export const SeatCard = forwardRef<HTMLDivElement, Props>(function SeatCard(
  { player, w, h, x, y, index, isMe, isAlly, mode, aimColor, ballots, leading, knives, myBallot, pulse, onTap },
  ref,
) {
  const t = useT();
  const dead = player.status === 'dead';
  const role = player.roleId && (dead || isMe || isAlly) ? roleDef(t, player.roleId as MafiaRole) : null;
  const tappable = mode === 'target';

  // Tilt toward a mouse; a finger gets none.
  const rx = useSpring(useMotionValue(0), { stiffness: 300, damping: 20 });
  const ry = useSpring(useMotionValue(0), { stiffness: 300, damping: 20 });
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || dead) return;
    const r = e.currentTarget.getBoundingClientRect();
    ry.set(((e.clientX - r.left) / r.width - 0.5) * 22);
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * 22);
  };
  const onLeave = () => { rx.set(0); ry.set(0); };

  const border = mode === 'target' ? aimColor
    : isMe ? '#c89b4a'
      : isAlly ? '#e74c3c'
        : leading ? '#e74c3c'
          : 'rgba(200,155,74,0.28)';
  const name = player.username;
  const label = `${name}${isMe ? ` ${t.maf.ui.you}` : ''}${role ? ` · ${role.name}` : ''}${dead ? ` · ${t.maf.ui.dead}` : ''}`;

  return (
    <motion.div
      ref={ref}
      data-seat={player.id}
      className="tw:absolute tw:left-0 tw:top-0"
      style={{ width: w, height: h, perspective: 700, zIndex: mode === 'target' ? 12 : 10 }}
      initial={{ opacity: 0, x: x - w / 2, y: y - h / 2 - 40, scale: 0.6 }}
      animate={{
        opacity: mode === 'blocked' ? 0.38 : 1,
        x: x - w / 2,
        y: y - h / 2,
        scale: 1,
        filter: mode === 'blocked' ? 'grayscale(0.8) brightness(0.7)' : 'grayscale(0) brightness(1)',
      }}
      transition={{ type: 'spring', stiffness: 260, damping: 24, delay: index * 0.04 }}
      whileHover={tappable ? { scale: 1.08, y: y - h / 2 - 6 } : undefined}
      whileTap={tappable ? { scale: 0.95 } : undefined}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onClick={() => onTap(player.id)}
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : -1}
      aria-label={label}
      onKeyDown={(e) => { if (tappable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onTap(player.id); } }}
    >
      {/* The glow a target wears while a card is armed. */}
      <AnimatePresence>
        {mode === 'target' && (
          <motion.div
            key="aim"
            className="tw:absolute tw:pointer-events-none tw:rounded-xl"
            style={{ inset: -5, border: `2px solid ${aimColor}`, boxShadow: `0 0 22px ${aimColor}, inset 0 0 14px ${aimColor}55` }}
            initial={{ opacity: 0, scale: 1.2 }}
            animate={{ opacity: [0.45, 1, 0.45], scale: 1 }}
            exit={{ opacity: 0, scale: 1.15 }}
            transition={{ opacity: { duration: 1.3, repeat: Infinity }, scale: { duration: 0.25 } }}
          />
        )}
      </AnimatePresence>

      <motion.div
        className="tw:relative tw:w-full tw:h-full"
        style={{ transformStyle: 'preserve-3d', rotateX: rx, rotateY: ry }}
      >
        <motion.div
          className="tw:relative tw:w-full tw:h-full"
          style={{ transformStyle: 'preserve-3d' }}
          initial={false}
          animate={{ rotateY: dead ? 180 : 0 }}
          transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
        >
          {/* Face: the living player. */}
          <div
            className="tw:absolute tw:inset-0 tw:rounded-lg tw:overflow-hidden tw:flex tw:flex-col"
            style={{
              backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
              background: isAlly
                ? 'linear-gradient(180deg, #3a0f0c, #120606 75%)'
                : isMe ? 'linear-gradient(180deg, #2a2112, #0e0b08 75%)' : 'linear-gradient(180deg, #1c1a26, #0b0a10 75%)',
              border: `1.5px solid ${border}`,
              boxShadow: isMe ? '0 10px 26px -8px rgba(0,0,0,0.9), 0 0 16px rgba(200,155,74,0.25)'
                : isAlly ? '0 10px 26px -8px rgba(0,0,0,0.9), 0 0 16px rgba(231,76,60,0.35)'
                  : '0 10px 26px -8px rgba(0,0,0,0.9)',
              opacity: player.isConnected ? 1 : 0.6,
            }}
          >
            <span className="tw:absolute tw:inset-[3px] tw:rounded-md tw:pointer-events-none" style={{ border: '1px solid rgba(200,155,74,0.14)' }} />
            <div className="tw:flex-1 tw:min-h-0 tw:flex tw:items-end tw:justify-center tw:overflow-hidden"
              style={{ background: `radial-gradient(ellipse 70% 60% at 50% 60%, ${role ? `${role.color}33` : 'rgba(200,155,74,0.12)'}, transparent 70%)` }}>
              <AvatarImg avatar={player.avatar} size={Math.round(w * 0.92)} />
            </div>
            <div className="tw:flex-shrink-0 tw:px-1 tw:py-[3px] tw:text-center tw:truncate"
              style={{
                fontFamily: "'Cinzel', serif", fontSize: w < 56 ? 8 : 9.5, fontWeight: 700,
                color: isMe ? '#e9c97a' : '#e8e8f0', background: 'rgba(0,0,0,0.55)',
                borderTop: `1px solid ${border}55`,
              }}>
              {name}
            </div>
            {role && (
              <span className="tw:absolute tw:top-1 tw:left-1 tw:flex tw:items-center tw:justify-center tw:rounded-full"
                title={role.name}
                style={{ width: 17, height: 17, fontSize: 9, background: `${role.color}33`, border: `1px solid ${role.color}` }}>
                {role.icon}
              </span>
            )}
            {player.isSilenced && (
              <span className="tw:absolute tw:top-1 tw:right-1 tw:rounded-full tw:p-[3px]" style={{ background: 'rgba(136,78,160,0.85)' }}>
                <MicOff size={9} color="#fff" />
              </span>
            )}
            {!player.isConnected && (
              <span className="tw:absolute tw:bottom-6 tw:right-1"><WifiOff size={10} color="#8888aa" /></span>
            )}
          </div>

          {/* Back: the dead, turned over. */}
          <div
            className="tw:absolute tw:inset-0 tw:rounded-lg tw:overflow-hidden tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-1"
            style={{
              backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)',
              background: role
                ? `radial-gradient(ellipse 80% 55% at 50% 38%, ${role.color}40, transparent 70%), linear-gradient(180deg, #18120f, #050507)`
                : 'repeating-linear-gradient(45deg, #120d0a 0 6px, #0b0807 6px 12px)',
              border: `1.5px solid ${role ? `${role.color}88` : 'rgba(120,120,140,0.3)'}`,
              filter: 'saturate(0.7)',
            }}
          >
            {role ? (
              <>
                <span style={{ fontSize: w * 0.34, lineHeight: 1 }}>{role.icon}</span>
                <span className="tw:uppercase tw:text-center tw:px-0.5 tw:leading-tight"
                  style={{ fontFamily: "'Cinzel', serif", fontSize: w < 56 ? 7 : 8, fontWeight: 800, letterSpacing: '0.06em', color: role.color }}>
                  {role.name}
                </span>
              </>
            ) : (
              <Skull size={w * 0.36} color="#c0392b" />
            )}
            <span className="tw:absolute tw:bottom-1 tw:inset-x-1 tw:truncate tw:text-center"
              style={{ fontFamily: "'Cinzel', serif", fontSize: 7.5, color: '#777' }}>
              {name}
            </span>
          </div>
        </motion.div>
      </motion.div>

      {/* Ballots thrown here, fanned over the top edge. */}
      <div className="tw:absolute tw:left-1/2 tw:pointer-events-none" style={{ top: -12, transform: 'translateX(-50%)', zIndex: 3 }}>
        <AnimatePresence>
          {ballots.slice(0, 8).map((c, i) => {
            const n = Math.min(ballots.length, 8);
            return (
              <Ballot
                key={`${i}-${c}`}
                color={c}
                className="tw:absolute"
                style={{ left: (i - (n - 1) / 2) * 7 - 7, top: 0 }}
                initial={{ opacity: 0, scale: 0, rotate: 0 }}
                animate={{ opacity: 1, scale: 1, rotate: (i - (n - 1) / 2) * 9 }}
                exit={{ opacity: 0, scale: 0 }}
                transition={{ delay: 0.45, type: 'spring', stiffness: 420, damping: 18 }}
              />
            );
          })}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {ballots.length > 0 && (
          <motion.span
            key="count"
            className="tw:absolute tw:flex tw:items-center tw:justify-center tw:rounded-full tw:pointer-events-none"
            style={{
              right: -7, top: -7, minWidth: 20, height: 20, padding: '0 5px', zIndex: 4,
              background: leading ? '#e74c3c' : 'rgba(243,156,18,0.95)', border: '2px solid #0a0a0f',
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, color: '#fff',
              boxShadow: leading ? '0 0 12px rgba(231,76,60,0.7)' : undefined,
            }}
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
          >
            {ballots.length}
          </motion.span>
        )}
      </AnimatePresence>
      {myBallot && (
        <motion.span className="tw:absolute tw:pointer-events-none" style={{ left: -8, top: -9, fontSize: 14, zIndex: 4 }}
          initial={{ scale: 0 }} animate={{ scale: 1 }}>🗳️</motion.span>
      )}
      {knives > 0 && (
        <motion.span
          className="tw:absolute tw:flex tw:items-center tw:gap-0.5 tw:rounded-full tw:px-1.5 tw:pointer-events-none"
          style={{ left: -8, bottom: 14, zIndex: 4, background: 'rgba(160,25,15,0.92)', border: '1px solid #ff6450', fontSize: 10, color: '#fff', fontFamily: "'JetBrains Mono', monospace" }}
          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.4 }}
        >
          🔪{knives > 1 ? knives : ''}
        </motion.span>
      )}
      {isAlly && !dead && (
        <span className="tw:absolute tw:left-1/2 tw:-translate-x-1/2 tw:px-1.5 tw:rounded tw:uppercase tw:pointer-events-none"
          style={{ bottom: -8, zIndex: 4, fontSize: 7, fontWeight: 700, color: '#fff', background: 'rgba(192,57,43,0.95)', border: '1px solid rgba(255,100,80,0.8)', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.06em' }}>
          {t.maf.ui.ally}
        </span>
      )}

      {/* Where a card slams down. */}
      <AnimatePresence>
        {pulse && (
          <motion.div
            key={pulse.key}
            className="tw:absolute tw:pointer-events-none tw:rounded-full"
            style={{ left: '50%', top: '50%', width: w * 1.4, height: w * 1.4, marginLeft: -w * 0.7, marginTop: -w * 0.7, border: `3px solid ${pulse.color}`, boxShadow: `0 0 30px ${pulse.color}`, zIndex: 5 }}
            initial={{ scale: 0.3, opacity: 1 }}
            animate={{ scale: 2.4, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
});
