import { motion, type HTMLMotionProps } from 'framer-motion';
import type { NightKind } from '../../../mafia/types';

/* ------------------------------------------------------------------ *
 * The small cards a player holds and throws: one per thing they can
 * do, plus the ballot. Drawn in the app's card language - obsidian
 * stock, a thin gold frame with cut corners, a glowing medallion.
 * ------------------------------------------------------------------ */

export type PlayKind = NightKind | 'snipe' | 'vote';

export const PLAY_LOOK: Record<PlayKind, { icon: string; color: string; glow: string }> = {
  kill: { icon: '🔪', color: '#e74c3c', glow: 'rgba(231,76,60,0.55)' },
  silence: { icon: '🤫', color: '#a978d6', glow: 'rgba(169,120,214,0.5)' },
  protect: { icon: '💊', color: '#1abc9c', glow: 'rgba(26,188,156,0.5)' },
  investigate: { icon: '🔍', color: '#4ea0e9', glow: 'rgba(78,160,233,0.5)' },
  shoot: { icon: '🔫', color: '#c0392b', glow: 'rgba(192,57,43,0.6)' },
  guard: { icon: '🛡️', color: '#5fb3d4', glow: 'rgba(95,179,212,0.5)' },
  snipe: { icon: '🎯', color: '#e9c97a', glow: 'rgba(233,201,122,0.55)' },
  vote: { icon: '🗳️', color: '#f39c12', glow: 'rgba(243,156,18,0.5)' },
};

/** A card face: the medallion, the name, the frame. Sized by its parent. */
export function ActionFace({ kind, label, compact = false }: { kind: PlayKind; label: string; compact?: boolean }) {
  const look = PLAY_LOOK[kind];
  return (
    <div
      className="tw:relative tw:w-full tw:h-full tw:rounded-lg tw:overflow-hidden tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-1 tw:select-none"
      style={{
        background: `radial-gradient(ellipse 90% 60% at 50% 30%, ${look.color}33, transparent 70%), linear-gradient(180deg, #18120f, #0a0809 70%, #050507)`,
        border: `1px solid ${look.color}88`,
        boxShadow: `0 10px 24px -10px rgba(0,0,0,0.9), 0 0 18px -6px ${look.glow}, inset 0 0 0 1px rgba(0,0,0,0.6)`,
      }}
    >
      <span className="tw:absolute tw:inset-[4px] tw:rounded tw:pointer-events-none" style={{ border: `1px solid ${look.color}44` }} />
      <span className="tw:absolute tw:top-[3px] tw:left-[3px] tw:w-2.5 tw:h-2.5 tw:border-t tw:border-l" style={{ borderColor: look.color }} />
      <span className="tw:absolute tw:bottom-[3px] tw:right-[3px] tw:w-2.5 tw:h-2.5 tw:border-b tw:border-r" style={{ borderColor: look.color }} />
      <span
        className="tw:flex tw:items-center tw:justify-center tw:rounded-full"
        style={{
          width: compact ? 22 : 34, height: compact ? 22 : 34, fontSize: compact ? 12 : 18,
          background: `radial-gradient(circle at 30% 30%, ${look.color}55, #0a0508 70%)`,
          border: `1px solid ${look.color}`,
          boxShadow: `0 0 14px ${look.glow}`,
        }}
      >
        {look.icon}
      </span>
      {!compact && (
        <span
          className="tw:px-1 tw:text-center tw:leading-tight tw:uppercase"
          style={{ fontFamily: "'Cinzel', serif", fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: look.color }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/** The back every card shares: the gold rose on black. */
export function CardBack({ label }: { label?: string }) {
  return (
    <div
      className="tw:relative tw:w-full tw:h-full tw:rounded-lg tw:overflow-hidden tw:flex tw:items-center tw:justify-center"
      style={{
        background: 'repeating-linear-gradient(45deg, #120d0a 0 6px, #0b0807 6px 12px)',
        border: '1px solid rgba(200,155,74,0.55)',
        boxShadow: '0 10px 24px -10px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.6)',
      }}
    >
      <span className="tw:absolute tw:inset-[5px] tw:rounded" style={{ border: '1px solid rgba(200,155,74,0.35)' }} />
      <span
        className="tw:flex tw:items-center tw:justify-center tw:rounded-full"
        style={{
          width: 30, height: 30, fontSize: 16,
          background: 'radial-gradient(circle at 30% 30%, #c0392b, #3a0d0a 75%)',
          border: '1px solid #c89b4a', boxShadow: '0 0 14px rgba(233,201,122,0.35)',
        }}
      >
        🌹
      </span>
      {label && (
        <span className="tw:absolute tw:bottom-1.5 tw:inset-x-0 tw:text-center tw:uppercase"
          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7, letterSpacing: '0.2em', color: 'rgba(233,201,122,0.7)' }}>
          {label}
        </span>
      )}
    </div>
  );
}

/** A thrown ballot: a little card in the voter's colour. */
export function Ballot({ color, ...rest }: { color: string } & HTMLMotionProps<'div'>) {
  return (
    <motion.div
      {...rest}
      className={`tw:rounded-[3px] tw:flex tw:items-center tw:justify-center ${rest.className ?? ''}`}
      style={{
        width: 14, height: 19, fontSize: 8,
        background: `linear-gradient(160deg, ${color}, #0a0809 140%)`,
        border: '1px solid rgba(255,255,255,0.35)',
        boxShadow: `0 2px 6px rgba(0,0,0,0.7), 0 0 8px ${color}88`,
        ...(rest.style ?? {}),
      }}
    />
  );
}
