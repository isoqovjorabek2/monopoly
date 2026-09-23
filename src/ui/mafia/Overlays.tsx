import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Crown } from 'lucide-react';
import { useT } from '../../i18n';
import { ROLE_TEAM } from '../../mafia/data';
import type { MafiaDeath, MafiaRole, MafiaState, MatchStats } from '../../mafia/types';
import { playSFX, TRACKS } from './audio';
import { AvatarImg } from './Hud';
import { roleDef, type RoleDef, type ViewPlayer } from './model';
import { RoleCard, RoleCardBack } from './RoleCard';

const mono = "'JetBrains Mono', monospace";
const cinzel = "'Cinzel', serif";
const crimson = "'Crimson Text', serif";

/* ═══════════════════════════ the deal ═══════════════════════════ */

type RevealStep = 'backs' | 'flip' | 'reveal' | 'done';

const FACTION_STYLE = {
  mafia: { ambient: 'rgba(192,57,43,0.35)', text: '#e74c3c' },
  town: { ambient: 'rgba(41,128,185,0.35)', text: '#3498db' },
  neutral: { ambient: 'rgba(142,68,173,0.35)', text: '#9b59b6' },
};

export function RoleReveal({ role, teammates, onClose }: {
  role: RoleDef;
  teammates: ViewPlayer[];
  onClose: () => void;
}) {
  const t = useT();
  const R = t.maf.ui.reveal;
  const [step, setStep] = useState<RevealStep>('backs');
  const [flipped, setFlipped] = useState(-1);

  useEffect(() => {
    const t1 = setTimeout(() => setStep('flip'), 800);
    return () => clearTimeout(t1);
  }, []);
  useEffect(() => {
    if (step !== 'flip') return;
    let i = 0;
    const id = setInterval(() => {
      setFlipped(i);
      i++;
      if (i >= 5) { clearInterval(id); setTimeout(() => setStep('reveal'), 300); }
    }, 120);
    return () => clearInterval(id);
  }, [step]);
  useEffect(() => {
    if (step !== 'reveal') return;
    playSFX(TRACKS.reveal, 0.6);
    const id = setTimeout(() => setStep('done'), 800);
    return () => clearTimeout(id);
  }, [step]);

  const fs = FACTION_STYLE[role.faction];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="tw:fixed tw:inset-0 tw:z-50 tw:flex tw:items-center tw:justify-center tw:overflow-auto tw:py-6"
      style={{ background: 'rgba(0,0,0,0.96)', backdropFilter: 'blur(24px)' }}
      role="dialog" aria-modal="true" aria-label={role.name}
    >
      <motion.div
        className="tw:absolute tw:inset-0 tw:pointer-events-none"
        animate={{ opacity: step === 'reveal' || step === 'done' ? 1 : 0 }}
        transition={{ duration: 1.2 }}
        style={{ background: `radial-gradient(ellipse at center, ${fs.ambient} 0%, transparent 65%)` }}
      />
      <div className="tw:relative tw:z-10 tw:flex tw:flex-col tw:items-center tw:gap-6 tw:max-w-sm tw:w-full tw:px-4 tw:my-auto">
        <AnimatePresence mode="wait">
          {(step === 'backs' || step === 'flip') && (
            <motion.div key="shuffle" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -20 }} transition={{ duration: 0.4 }} className="tw:flex tw:justify-center tw:gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <motion.div key={i} style={{ perspective: 600 }}
                  animate={{ scale: flipped === i ? 1.1 : 1 }} transition={{ duration: 0.45, ease: 'easeInOut' }}>
                  <motion.div style={{ transformStyle: 'preserve-3d', position: 'relative' }}
                    animate={{ rotateY: flipped >= i ? 180 : 0 }} transition={{ duration: 0.45, ease: 'easeInOut' }}>
                    <div style={{ backfaceVisibility: 'hidden' }}><RoleCardBack size="sm" /></div>
                    <div className="tw:absolute tw:inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                      <RoleCard role={role} size="sm" />
                    </div>
                  </motion.div>
                </motion.div>
              ))}
            </motion.div>
          )}

          {(step === 'reveal' || step === 'done') && (
            <motion.div key="reveal" initial={{ scale: 0.6, opacity: 0, rotateY: -90 }} animate={{ scale: 1, opacity: 1, rotateY: 0 }}
              transition={{ type: 'spring', stiffness: 180, damping: 18 }} className="tw:flex tw:flex-col tw:items-center tw:gap-5 tw:w-full">
              <RoleCard role={role} size="lg" glowing />

              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
                className="tw:w-full tw:p-4 tw:rounded-lg"
                style={{ background: 'rgba(10,10,15,0.8)', border: `1px solid ${fs.text}33`, backdropFilter: 'blur(10px)' }}>
                <p className="tw:text-xs tw:font-bold tw:mb-1.5 tw:tracking-wider" style={{ color: fs.text, fontFamily: cinzel }}>⚡ {role.ability}</p>
                <p className="tw:text-sm tw:text-[#c8b8a2] tw:leading-relaxed" style={{ fontFamily: crimson, fontSize: '0.95rem' }}>
                  {role.abilityDescription}
                </p>
              </motion.div>

              {teammates.length > 0 && (
                <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.55, type: 'spring', stiffness: 200, damping: 20 }}
                  className="tw:w-full tw:rounded-xl tw:overflow-hidden"
                  style={{ border: '2px solid rgba(231,76,60,0.7)', boxShadow: '0 0 40px rgba(192,57,43,0.45), inset 0 0 30px rgba(192,57,43,0.08)' }}>
                  <motion.div className="tw:px-4 tw:py-3 tw:flex tw:items-center tw:justify-center tw:gap-2"
                    style={{ background: 'rgba(180,30,20,0.55)' }} animate={{ opacity: [0.85, 1, 0.85] }} transition={{ duration: 1.6, repeat: Infinity }}>
                    <span className="tw:text-lg">🔫</span>
                    <p className="tw:text-sm tw:font-bold tw:tracking-widest tw:text-white tw:uppercase" style={{ fontFamily: cinzel, textShadow: '0 0 12px rgba(255,100,80,0.8)' }}>
                      {R.crew}
                    </p>
                    <span className="tw:text-lg">🔫</span>
                  </motion.div>
                  <div className="tw:px-4 tw:py-5 tw:flex tw:flex-wrap tw:justify-center tw:gap-5" style={{ background: 'rgba(100,10,5,0.25)' }}>
                    {teammates.map((ally) => (
                      <motion.div key={ally.id} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.7, type: 'spring', stiffness: 260, damping: 18 }} className="tw:flex tw:flex-col tw:items-center tw:gap-2">
                        <motion.div className="tw:rounded-full tw:overflow-hidden"
                          style={{ width: 72, height: 72, border: '3px solid #e74c3c' }}
                          animate={{ boxShadow: ['0 0 12px rgba(231,76,60,0.5)', '0 0 28px rgba(231,76,60,0.9)', '0 0 12px rgba(231,76,60,0.5)'] }}
                          transition={{ duration: 2, repeat: Infinity }}>
                          <AvatarImg avatar={ally.avatar} playerId={ally.id} size={72} style={{ width: '100%', height: '100%' }} />
                        </motion.div>
                        <span className="tw:text-sm tw:font-bold tw:text-[#ff6b6b] tw:tracking-wide" style={{ fontFamily: cinzel, textShadow: '0 0 8px rgba(231,76,60,0.6)' }}>
                          {ally.username}
                        </span>
                        <span className="tw:text-[10px] tw:tracking-widest tw:text-[#c0392b] tw:uppercase" style={{ fontFamily: mono }}>
                          {ally.roleId ? roleDef(t, ally.roleId).name : t.maf.ui.ally}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                  <div className="tw:px-4 tw:py-2 tw:text-center" style={{ background: 'rgba(180,30,20,0.35)', borderTop: '1px solid rgba(231,76,60,0.3)' }}>
                    <p className="tw:text-[11px] tw:text-[#ff8888] tw:tracking-widest tw:uppercase" style={{ fontFamily: mono }}>{R.crewNote}</p>
                  </div>
                </motion.div>
              )}

              {step === 'done' && (
                <motion.button type="button" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }} onClick={onClose} autoFocus
                  className="tw:w-full tw:py-3 tw:rounded-lg tw:font-bold tw:tracking-widest tw:uppercase tw:text-sm"
                  style={{ fontFamily: cinzel, background: role.gradient, border: `1px solid ${fs.text}55`, color: '#fff', boxShadow: `0 0 20px ${fs.ambient}` }}>
                  {R.understood}
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════ a death ═══════════════════════════ */

export function ElimScreen({ m, death, onClose }: { m: MafiaState; death: MafiaDeath; onClose: () => void }) {
  const t = useT();
  const E = t.maf.ui.elim;
  useEffect(() => {
    playSFX(TRACKS.elim, 0.6);
    const id = setTimeout(onClose, 6000);
    return () => clearTimeout(id);
  }, [onClose]);

  const player = m.players[death.id];
  const role = death.role ? roleDef(t, death.role) : null;
  const jester = death.role === 'jester' && (death.cause === 'vote' || death.cause === 'sniper');
  const reason = `${E[death.cause]}${jester ? E.jester : ''}`;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
      className="tw:fixed tw:inset-0 tw:z-50 tw:flex tw:items-center tw:justify-center tw:overflow-hidden tw:py-6"
      style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(10px)' }} role="alert">
      <motion.div className="tw:absolute tw:inset-0 tw:pointer-events-none"
        initial={{ scale: 0, opacity: 0.8 }} animate={{ scale: 3, opacity: 0 }} transition={{ duration: 2.5, ease: 'easeOut' }}
        style={{ background: 'radial-gradient(circle, rgba(192,57,43,0.6) 0%, transparent 60%)' }} />
      <div className="tw:relative tw:z-10 tw:text-center tw:max-w-sm tw:px-6">
        <motion.div initial={{ scale: 0, rotateZ: -15 }} animate={{ scale: 1, rotateZ: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.3 }}>
          <motion.div className="tw:text-8xl tw:mb-4" animate={{ y: [0, -10, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}>
            💀
          </motion.div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
          {player && (
            <div className="tw:w-20 tw:h-20 tw:rounded-full tw:mx-auto tw:mb-4 tw:flex tw:items-center tw:justify-center tw:overflow-hidden"
              style={{ background: 'rgba(192,57,43,0.2)', border: '3px solid rgba(192,57,43,0.6)', filter: 'grayscale(0.5)' }}>
              <AvatarImg avatar={player.name} playerId={player.id} size={72} />
            </div>
          )}
          <h2 className="tw:text-3xl tw:font-black tw:mb-2 tw:text-[#e74c3c]"
            style={{ fontFamily: "'Cinzel Decorative', serif", textShadow: '0 0 20px rgba(231,76,60,0.6)' }}>
            {player?.name ?? t.defaults.someone}
          </h2>
          <p className="tw:text-lg tw:text-[#c8b8a2] tw:mb-6 tw:italic" style={{ fontFamily: crimson }}>{reason}</p>
          {role && (
            <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1 }}
              className="tw:inline-flex tw:items-center tw:gap-3 tw:px-6 tw:py-3 tw:rounded-lg"
              style={{ background: `${role.color}20`, border: `2px solid ${role.color}66` }}>
              <span className="tw:text-3xl">{role.icon}</span>
              <div className="tw:text-left">
                <p className="tw:text-xs tw:text-[#8888aa]" style={{ fontFamily: mono }}>{E.theyWere}</p>
                <p className="tw:text-lg tw:font-bold" style={{ color: role.color, fontFamily: cinzel }}>{role.name}</p>
              </div>
            </motion.div>
          )}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }} className="tw:mt-6">
            <div className="tw:w-full tw:bg-[rgba(255,255,255,0.05)] tw:rounded-full tw:h-1">
              <motion.div className="tw:h-full tw:rounded-full" style={{ background: 'linear-gradient(90deg, #c0392b, #8e44ad)' }}
                initial={{ width: '100%' }} animate={{ width: '0%' }} transition={{ duration: 4, ease: 'linear', delay: 2 }} />
            </div>
            <p className="tw:text-xs tw:text-[#555] tw:mt-2" style={{ fontFamily: mono }}>{E.continuing}</p>
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════ the end ═══════════════════════════ */

const WIN_LOOK = {
  mafia: { icon: '🔫', color: '#e74c3c', glow: 'rgba(231,76,60,0.4)' },
  village: { icon: '⚖️', color: '#f1c40f', glow: 'rgba(241,196,15,0.4)' },
  jester: { icon: '🃏', color: '#9b59b6', glow: 'rgba(155,89,182,0.4)' },
  abandoned: { icon: '🕯️', color: '#8888aa', glow: 'rgba(136,136,170,0.3)' },
};

export function myTeamWon(m: MafiaState, myId: string): boolean {
  const role = m.finalRoles?.[myId];
  if (!role || !m.winner) return false;
  if (m.winner === 'jester') return m.winnerId === myId;
  return ROLE_TEAM[role] === m.winner;
}

function mvpReason(t: ReturnType<typeof useT>, st: MatchStats, survived: boolean): string {
  const S = t.maf.end.stat;
  const parts: string[] = [];
  if (st.kills) parts.push(S.kills(st.kills));
  if (st.saves) parts.push(S.saves(st.saves));
  if (st.reads) parts.push(S.reads(st.reads));
  if (st.finds) parts.push(S.finds(st.finds));
  if (survived) parts.push(S.survived);
  return parts.slice(0, 2).join(' · ') || S.clutch;
}

export function GameOverScreen({ m, myId, onRematch, onLeave }: {
  m: MafiaState;
  myId: string;
  onRematch?: () => void;
  onLeave: () => void;
}) {
  const t = useT();
  const U = t.maf.ui;
  const key = m.winner ?? 'abandoned';
  const look = WIN_LOOK[key];
  const [title, subtitle, reason] = U.over[key];
  const seated = Boolean(m.players[myId]);
  const iWon = myTeamWon(m, myId);
  const myRole = m.finalRoles?.[myId];
  const mvpName = m.mvp ? m.players[m.mvp.id]?.name : null;
  const iAmMvp = m.mvp?.id === myId;

  let nearMiss: string | null = null;
  if (seated && m.finalRoles && !iWon) {
    const familyLeft = m.seats.filter((id) => m.players[id].alive && ROLE_TEAM[m.finalRoles![id]] === 'mafia').length;
    if (m.finalEliminatedId === myId && m.lastVoteMargin === 1) nearMiss = t.maf.end.nearMiss.survive;
    else if (m.winner === 'mafia' && familyLeft === 1) nearMiss = t.maf.end.nearMiss.town;
    else if (m.winner === 'village' && m.lastVoteMargin === 1) nearMiss = t.maf.end.nearMiss.family;
  }

  useEffect(() => {
    if (seated) playSFX(iWon ? TRACKS.victory : TRACKS.defeat, 0.6);
  }, [seated, iWon]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="tw:fixed tw:inset-0 tw:z-50 tw:flex tw:items-start tw:justify-center tw:overflow-auto tw:py-8"
      style={{ background: 'rgba(0,0,0,0.95)', backdropFilter: 'blur(20px)' }} role="dialog" aria-modal="true" aria-label={title}>
      <motion.div className="tw:fixed tw:inset-0 tw:pointer-events-none" animate={{ opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 3, repeat: Infinity }} style={{ background: `radial-gradient(ellipse at center, ${look.glow} 0%, transparent 60%)` }} />

      <div className="tw:relative tw:z-10 tw:text-center tw:max-w-2xl tw:w-full tw:px-4 tw:my-auto">
        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
          <div className="tw:text-7xl tw:mb-4">{look.icon}</div>
          <h1 className="tw:text-4xl tw:md:text-6xl tw:font-black tw:mb-2"
            style={{ fontFamily: "'Cinzel Decorative', serif", color: look.color, textShadow: `0 0 30px ${look.glow}, 0 0 60px ${look.glow}` }}>
            {title}
          </h1>
          <p className="tw:text-lg tw:text-[#c8b8a2] tw:mb-2" style={{ fontFamily: crimson, fontStyle: 'italic' }}>{subtitle}</p>
          <p className="tw:text-sm tw:text-[#8888aa] tw:mb-8" style={{ fontFamily: mono }}>
            {m.winner === 'jester' ? t.maf.over.jesterWins(m.players[m.winnerId ?? '']?.name ?? '') : reason}
          </p>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
            className="tw:inline-flex tw:items-center tw:gap-3 tw:px-6 tw:py-3 tw:rounded-lg tw:mb-8"
            style={{
              background: !seated ? 'rgba(136,136,170,0.12)' : iWon ? 'rgba(26,188,156,0.15)' : 'rgba(192,57,43,0.15)',
              border: `1px solid ${!seated ? 'rgba(136,136,170,0.3)' : iWon ? 'rgba(26,188,156,0.4)' : 'rgba(192,57,43,0.4)'}`,
            }}>
            <span className="tw:text-3xl">{!seated ? '👁️' : iWon ? '🏆' : '💔'}</span>
            <div className="tw:text-left">
              <p className="tw:font-bold tw:text-white" style={{ fontFamily: cinzel }}>{!seated ? U.watched : iWon ? U.victory : U.defeat}</p>
              {myRole && (
                <p className="tw:text-xs tw:text-[#8888aa]" style={{ fontFamily: mono }}>{U.playedAs(roleDef(t, myRole).name)}</p>
              )}
            </div>
          </motion.div>
        </motion.div>

        {nearMiss && (
          <div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
              className="tw:inline-flex tw:items-center tw:gap-2 tw:px-5 tw:py-2.5 tw:rounded-lg tw:mb-5"
              style={{ background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.35)' }}>
              <span className="tw:text-lg">😤</span>
              <span style={{ fontFamily: crimson, fontStyle: 'italic', fontSize: 14, color: '#e0a0a0' }}>{nearMiss}</span>
            </motion.div>
          </div>
        )}

        {m.mvp && (
          <div>
            {iAmMvp ? (
              <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.45, type: 'spring', stiffness: 260 }}
                className="tw:inline-flex tw:items-center tw:gap-2 tw:px-5 tw:py-2 tw:rounded-full tw:mb-5"
                style={{ background: 'rgba(233,201,122,0.14)', border: '1px solid rgba(233,201,122,0.5)', boxShadow: '0 0 18px rgba(233,201,122,0.25)' }}>
                <Crown size={16} style={{ color: '#e9c97a' }} />
                <span style={{ fontFamily: cinzel, fontSize: 14, fontWeight: 700, color: '#e9c97a' }}>{t.maf.end.mvp}</span>
                <span style={{ fontFamily: mono, fontSize: 11, color: '#c89b4a' }}>· {mvpReason(t, m.mvp.stats, m.mvp.survived)}</span>
              </motion.div>
            ) : mvpName ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                className="tw:inline-flex tw:items-center tw:gap-2 tw:px-4 tw:py-1.5 tw:rounded-full tw:mb-5"
                style={{ background: 'rgba(233,201,122,0.07)', border: '1px solid rgba(233,201,122,0.2)' }}>
                <Crown size={12} style={{ color: '#c89b4a' }} />
                <span style={{ fontFamily: mono, fontSize: 11, color: '#c89b4a', letterSpacing: '0.05em' }}>
                  {t.maf.end.mvp}: {mvpName} · {mvpReason(t, m.mvp.stats, m.mvp.survived)}
                </span>
              </motion.div>
            ) : null}
          </div>
        )}

        {m.finalRoles && (
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }} className="glass tw:rounded-lg tw:p-6 tw:mb-8">
            <h2 className="tw:text-sm tw:font-bold tw:text-white tw:mb-4" style={{ fontFamily: cinzel }}>{U.rolesTitle}</h2>
            <div className="tw:grid tw:grid-cols-2 tw:sm:grid-cols-3 tw:gap-3">
              {m.seats.map((id, i) => {
                const p = m.players[id];
                const role = roleDef(t, m.finalRoles![id] as MafiaRole);
                const isMvp = m.mvp?.id === id;
                const dead = !p.alive;
                return (
                  <motion.div key={id} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.9 + i * 0.05 }}
                    className="tw:relative tw:flex tw:items-center tw:gap-2 tw:p-2 tw:rounded-lg tw:text-left"
                    style={{
                      background: isMvp ? 'rgba(233,201,122,0.12)' : dead ? 'rgba(192,57,43,0.1)' : 'rgba(26,26,46,0.6)',
                      border: isMvp ? '1px solid rgba(233,201,122,0.5)' : id === myId ? '1px solid rgba(255,215,0,0.3)' : '1px solid rgba(255,255,255,0.05)',
                      opacity: dead && !isMvp ? 0.7 : 1,
                    }}>
                    {isMvp && (
                      <span className="tw:absolute tw:-top-2 tw:-right-1.5 tw:px-1.5 tw:py-0.5 tw:rounded-full tw:text-[8px] tw:font-bold tw:flex tw:items-center tw:gap-0.5"
                        style={{ background: '#e9c97a', color: '#1a0d04', fontFamily: mono, letterSpacing: '0.1em' }}>
                        <Crown size={8} /> {t.maf.end.mvp}
                      </span>
                    )}
                    <AvatarImg avatar={p.name} playerId={p.id} size={28} />
                    <div className="tw:flex-1 tw:min-w-0">
                      <p className="tw:text-xs tw:font-bold tw:truncate tw:text-white" style={{ fontFamily: cinzel }}>
                        {p.name}{id === myId && ' ★'}
                      </p>
                      <p className="tw:text-[11px] tw:truncate" style={{ color: role.color, fontFamily: mono }}>
                        {role.icon} {role.name}{dead && ` · ${U.dead}`}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }} className="tw:flex tw:flex-col tw:items-center tw:gap-3">
          {onRematch ? (
            <>
              <motion.button type="button" whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                onClick={() => { playSFX(TRACKS.notif, 0.4); onRematch(); }}
                className="tw:relative tw:overflow-hidden tw:rounded-lg tw:px-8 tw:py-3.5 tw:font-bold"
                style={{
                  fontFamily: cinzel, fontSize: 15, color: '#fff',
                  background: 'linear-gradient(135deg, #c0392b, #8e44ad)', border: '1px solid rgba(255,215,0,0.3)',
                  boxShadow: '0 0 30px rgba(192,57,43,0.3)',
                }}>
                <motion.div className="tw:absolute tw:inset-0 tw:pointer-events-none"
                  style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)' }}
                  animate={{ x: ['-100%', '100%'] }} transition={{ duration: 2, repeat: Infinity }} />
                {U.playAgain}
              </motion.button>
              <p className="tw:text-[10px] tw:text-[#8888aa]" style={{ fontFamily: mono, letterSpacing: '0.05em' }}>{U.playAgainNote}</p>
            </>
          ) : (
            <p className="tw:text-xs tw:text-[#8888aa]" style={{ fontFamily: mono }}>{U.waitHost}</p>
          )}
          <motion.button type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }} onClick={onLeave}
            className="btn-secondary tw:rounded" style={{ fontFamily: cinzel }}>
            {U.mainMenu}
          </motion.button>
        </motion.div>
      </div>
    </motion.div>
  );
}
