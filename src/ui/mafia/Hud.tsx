import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { useT } from '../../i18n';
import type { MafiaState } from '../../mafia/types';
import { useStore } from '../../store/store';
import { avatarUrl, formatTime } from './model';

/** A Google picture at about the size it is drawn, for a sharp card. */
const sized = (url: string, px: number): string => url.replace(/=s\d+(-c)?$/, `=s${Math.min(512, Math.ceil(px * 2))}-c`);

/**
 * A player's face: their Google picture when they sat down signed in, the
 * app's DiceBear adventurer otherwise - and again if the picture fails to
 * load. A picture carries the `is-photo` class, so a frame that expects a
 * cut-out bust can crop it instead.
 */
export function AvatarImg({ avatar, playerId, size = 28, className = '', style }: {
  avatar: string; playerId?: string; size?: number; className?: string; style?: CSSProperties;
}) {
  const photo = useStore((s) => (playerId ? s.room?.seats.find((x) => x.playerId === playerId)?.photo : undefined));
  const [broken, setBroken] = useState<string | null>(null);
  if (photo && broken !== photo) {
    return (
      <img
        src={sized(photo, size)}
        alt=""
        width={size}
        height={size}
        draggable={false}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(photo)}
        className={`is-photo ${className}`}
        style={{ display: 'block', flexShrink: 0, objectFit: 'cover', borderRadius: '50%', ...style }}
      />
    );
  }
  return (
    <img
      src={avatarUrl(avatar)}
      alt=""
      width={size}
      height={size}
      draggable={false}
      loading="lazy"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
    />
  );
}

type PhaseKey = 'lobby' | 'night' | 'day' | 'vote' | 'game_over';

const PHASE_CONFIG: Record<PhaseKey, { icon: string; color: string }> = {
  lobby: { icon: '🏠', color: '#f1c40f' },
  night: { icon: '🌙', color: '#8e44ad' },
  day: { icon: '☀️', color: '#f39c12' },
  vote: { icon: '🗳️', color: '#e74c3c' },
  game_over: { icon: '🏆', color: '#f1c40f' },
};

export function PhaseTimer({ phase, timeLeft, round }: { phase: PhaseKey; timeLeft: number | null; round: number }) {
  const t = useT();
  const config = PHASE_CONFIG[phase] ?? PHASE_CONFIG.lobby;
  const left = timeLeft ?? 0;
  const isUrgent = left <= 15 && left > 0;

  return (
    <div className="tw:flex tw:items-center tw:gap-2 tw:sm:gap-4">
      <div
        className="phase-badge"
        style={{ background: `${config.color}20`, border: `1px solid ${config.color}66`, color: config.color }}
      >
        <motion.span
          animate={phase === 'night' ? { opacity: [1, 0.5, 1] } : {}}
          transition={{ duration: 2, repeat: Infinity }}
        >
          {config.icon}
        </motion.span>
        <span className="tw:hidden tw:sm:inline" style={{ fontFamily: "'Cinzel', serif" }}>{t.maf.ui.phase[phase]}</span>
      </div>

      {round > 0 && (
        <span className="tw:hidden tw:sm:inline tw:text-xs tw:text-[#8888aa]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          {t.maf.ui.round(round)}
        </span>
      )}

      {left > 0 && (
        <motion.div
          animate={isUrgent ? { scale: [1, 1.05, 1] } : {}}
          transition={{ duration: 0.5, repeat: isUrgent ? Infinity : 0 }}
          className="tw:flex tw:items-center tw:gap-2"
        >
          <div
            className="tw:font-bold tw:text-lg tw:tabular-nums"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: isUrgent ? '#e74c3c' : config.color,
              textShadow: isUrgent ? '0 0 10px rgba(231,76,60,0.6)' : 'none',
            }}
          >
            {formatTime(left)}
          </div>
        </motion.div>
      )}
    </div>
  );
}

/* ── Rolling count with a directional flash on the digit that changed ── */
function AnimatedCount({ value, color }: { value: number; color: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => String(Math.round(v)));
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prev = useRef(value);

  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.55, ease: [0.16, 1, 0.3, 1] });
    const from = prev.current;
    prev.current = value;
    if (from === value) return () => controls.stop();
    setFlash(value < from ? 'down' : 'up');
    const clear = setTimeout(() => setFlash(null), 650);
    return () => { controls.stop(); clearTimeout(clear); };
  }, [value, mv]);

  const flashColor = flash === 'down' ? '#e74c3c' : flash === 'up' ? '#e9c97a' : color;
  return (
    <motion.span
      animate={flash && !reduce
        ? { scale: [1, 1.35, 1], color: [color, flashColor, color], textShadow: ['0 0 0px transparent', `0 0 10px ${flashColor}`, '0 0 0px transparent'] }
        : { scale: 1, color }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, display: 'inline-block', minWidth: '0.7ch', textAlign: 'center' }}
    >
      {text}
    </motion.span>
  );
}

/** Who is left: by side when the table shows roles, a bare count when not. */
export function SurvivorCounter({ m, compact = false }: { m: MafiaState; compact?: boolean }) {
  const t = useT();
  const U = t.maf.ui;
  const total = m.seats.filter((id) => m.players[id].alive).length;
  const c = m.aliveCounts;

  const chip = (sticker: string, name: string, value: number, color: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color }}>
      <span style={{ fontSize: 13 }}>{sticker}</span>
      {!compact && <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11 }}>{name}</span>}
      <AnimatedCount value={value} color={color} />
    </span>
  );

  return (
    <div
      title={U.aliveTitle}
      className={compact
        ? 'tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-1 tw:rounded-lg tw:text-xs'
        : 'tw:hidden tw:sm:flex tw:items-center tw:gap-2.5 tw:px-3 tw:py-1.5 tw:rounded-lg tw:text-xs'}
      style={{ background: 'rgba(10,10,15,0.6)', border: '1px solid rgba(255,215,0,0.12)', fontFamily: "'JetBrains Mono', monospace" }}
    >
      {c ? (
        <>
          {chip('🏠', U.faction.town, c.village, '#c8c0a8')}
          <span style={{ color: '#3e3a2f' }}>·</span>
          {chip('🔪', U.faction.mafia, c.mafia, '#e74c3c')}
          {c.jester > 0 && (
            <>
              <span style={{ color: '#3e3a2f' }}>·</span>
              {chip('🃏', U.faction.neutral, c.jester, '#a978d6')}
            </>
          )}
        </>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#8a8576' }}>
          <span style={{ fontSize: 13 }}>👁</span>
          <AnimatedCount value={total} color="#8a8576" />
          <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11 }}>{U.alive}</span>
        </span>
      )}
    </div>
  );
}
