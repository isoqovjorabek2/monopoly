import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MicOff, Skull, Vote } from 'lucide-react';
import { useT } from '../../i18n';
import type { MafiaRole } from '../../mafia/types';
import { AvatarImg } from './Hud';
import { roleDef, type ViewPlayer } from './model';

type PhaseKey = 'lobby' | 'night' | 'day' | 'vote' | 'game_over';

interface Props {
  players: ViewPlayer[];
  phase: PhaseKey;
  round: number;
  myPlayerId: string;
  teammates: string[];
  onSelect?: (playerId: string) => void;
  selectedId?: string | null;
  votes: Record<string, string>;
  /** Who a tap may land on right now; empty when a tap means nothing. */
  targets: string[];
}

function tally(votes: Record<string, string>) {
  const counts: Record<string, number> = {};
  for (const target of Object.values(votes)) counts[target] = (counts[target] || 0) + 1;
  return { counts, max: Math.max(0, ...Object.values(counts)) };
}

/* ═══════════════════════════ card grid ═══════════════════════════ */

export function PlayerGrid({ players, phase, myPlayerId, teammates, onSelect, selectedId, votes, targets }: Props) {
  const t = useT();
  const isNight = phase === 'night';
  const isVoting = phase === 'vote';
  const { counts, max } = tally(votes);
  const aliveCount = players.filter((p) => p.status === 'alive').length;

  return (
    <div className="tw:grid tw:grid-cols-2 tw:sm:grid-cols-3 tw:md:grid-cols-4 tw:lg:grid-cols-5 tw:gap-3">
      <AnimatePresence>
        {players.map((player, i) => {
          const isMe = player.id === myPlayerId;
          const isDead = player.status === 'dead';
          const isSelected = selectedId === player.id;
          const myVoteTarget = votes[myPlayerId] === player.id;
          const voteCount = counts[player.id] || 0;
          const isHighestVoted = voteCount > 0 && voteCount === max;
          const isMafiaTeammate = !isMe && teammates.includes(player.username);
          const role = player.roleId ? roleDef(t, player.roleId as MafiaRole) : null;
          const canTarget = targets.includes(player.id);

          return (
            <motion.div
              key={player.id}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: isDead ? 0.4 : 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ delay: i * 0.04, type: 'spring', stiffness: 300, damping: 25 }}
              whileHover={canTarget ? { scale: 1.04, y: -2 } : {}}
              onClick={() => canTarget && onSelect?.(player.id)}
              role={canTarget ? 'button' : undefined}
              tabIndex={canTarget ? 0 : undefined}
              onKeyDown={(e) => { if (canTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect?.(player.id); } }}
              aria-pressed={canTarget ? isSelected : undefined}
              className={`tw:relative tw:flex tw:flex-col tw:items-center tw:gap-2 tw:p-4 tw:rounded-xl tw:transition-all ${canTarget ? 'tw:cursor-pointer' : ''} ${isDead ? 'player-dead tw:grayscale' : ''}`}
              style={{
                background: isSelected ? 'rgba(192,57,43,0.35)'
                  : isMafiaTeammate ? 'rgba(160,25,15,0.45)'
                    : isMe ? 'rgba(192,57,43,0.12)'
                      : 'rgba(26,26,46,0.7)',
                border: isSelected ? '2px solid rgba(192,57,43,0.9)'
                  : isMafiaTeammate ? '2px solid rgba(231,76,60,0.75)'
                    : isHighestVoted && isVoting ? '1px solid rgba(231,76,60,0.6)'
                      : isMe ? '1px solid rgba(192,57,43,0.4)'
                        : canTarget ? '1px solid rgba(255,215,0,0.22)'
                          : '1px solid rgba(255,215,0,0.08)',
                boxShadow: isSelected ? '0 0 25px rgba(192,57,43,0.5)'
                  : isMafiaTeammate ? '0 0 20px rgba(192,57,43,0.4)'
                    : isHighestVoted && isVoting ? '0 0 15px rgba(231,76,60,0.25)'
                      : 'none',
              }}
            >
              {isMafiaTeammate && (
                <motion.div
                  className="tw:absolute tw:top-1.5 tw:right-1.5 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[9px] tw:font-bold tw:text-white tw:uppercase"
                  style={{
                    background: 'rgba(192,57,43,0.9)', border: '1px solid rgba(255,100,80,0.8)',
                    fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.05em', boxShadow: '0 0 8px rgba(231,76,60,0.6)',
                  }}
                  animate={{ opacity: [0.8, 1, 0.8] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                >
                  {t.maf.ui.ally}
                </motion.div>
              )}

              {isDead && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="tw:absolute tw:inset-0 tw:flex tw:items-center tw:justify-center tw:rounded-xl tw:z-10 tw:pointer-events-none"
                  style={{ background: 'rgba(0,0,0,0.5)' }}
                >
                  <Skull size={28} className="tw:text-[#c0392b]" />
                </motion.div>
              )}

              {player.isSilenced && (
                <div className="tw:absolute tw:top-1.5 tw:left-1.5">
                  <MicOff size={13} className="tw:text-[#8e44ad]" />
                </div>
              )}

              <motion.div
                className="tw:w-16 tw:h-16 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:relative tw:overflow-hidden"
                style={{
                  background: isMe ? 'rgba(192,57,43,0.2)' : 'rgba(10,10,15,0.5)',
                  border: isSelected ? '3px solid rgba(192,57,43,0.8)' : isMe ? '2px solid rgba(192,57,43,0.5)' : '2px solid rgba(255,215,0,0.12)',
                }}
                animate={isSelected && isNight
                  ? { boxShadow: ['0 0 10px rgba(192,57,43,0.5)', '0 0 25px rgba(192,57,43,0.8)', '0 0 10px rgba(192,57,43,0.5)'] }
                  : { boxShadow: '0 0 0px rgba(0,0,0,0)' }}
                transition={isSelected && isNight ? { duration: 1, repeat: Infinity } : { duration: 0.3 }}
              >
                <AvatarImg avatar={player.avatar} size={64} />
              </motion.div>

              <div className="tw:text-center tw:w-full">
                <p className="tw:text-xs tw:font-bold tw:truncate" style={{ fontFamily: "'Cinzel', serif", color: isMe ? '#f1c40f' : '#e8e8f0' }}>
                  {player.username}{isMe && ` ${t.maf.ui.you}`}
                </p>
                {role && (isDead || isMe || isMafiaTeammate) && (
                  <p className="tw:text-[11px] tw:mt-0.5" style={{ color: role.color, fontFamily: "'JetBrains Mono', monospace" }}>
                    {role.icon} {role.name}
                  </p>
                )}
              </div>

              {isVoting && voteCount > 0 && (
                <motion.div initial={{ width: 0 }} animate={{ width: '100%' }} className="tw:absolute tw:bottom-0 tw:left-0 tw:right-0">
                  <div className="tw:h-1 tw:rounded-b-xl tw:bg-[rgba(255,255,255,0.05)]">
                    <motion.div
                      className="tw:h-full tw:rounded-b-xl"
                      style={{ background: isHighestVoted ? '#e74c3c' : '#f39c12' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(voteCount / Math.max(1, aliveCount)) * 100}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <div className="tw:absolute tw:-top-5 tw:right-1">
                    <span className="tw:text-[11px] tw:font-bold" style={{ color: isHighestVoted ? '#e74c3c' : '#f39c12' }}>{voteCount}</span>
                  </div>
                </motion.div>
              )}

              {myVoteTarget && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="tw:absolute tw:-top-2 tw:-right-2 tw:w-5 tw:h-5 tw:rounded-full tw:bg-[#e74c3c] tw:flex tw:items-center tw:justify-center"
                  style={{ border: '2px solid rgba(10,10,15,0.8)' }}
                >
                  <Vote size={10} className="tw:text-white" />
                </motion.div>
              )}

              {isSelected && (
                <motion.div
                  className="tw:absolute tw:inset-0 tw:rounded-xl tw:pointer-events-none"
                  animate={{ opacity: [0.3, 0.6, 0.3] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  style={{ border: '2px solid rgba(192,57,43,0.8)', boxShadow: 'inset 0 0 20px rgba(192,57,43,0.2)' }}
                />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════ round table ═══════════════════════════ */

const PHASE_DISPLAY: Record<PhaseKey, { icon: string; color: string }> = {
  night: { icon: '🌙', color: '#8e44ad' },
  day: { icon: '☀️', color: '#f39c12' },
  vote: { icon: '🗳️', color: '#e74c3c' },
  lobby: { icon: '🎲', color: '#8a6a30' },
  game_over: { icon: '🏆', color: '#e9c97a' },
};

function TableCenter({ phase, round }: { phase: PhaseKey; round: number }) {
  const t = useT();
  const pd = PHASE_DISPLAY[phase] ?? PHASE_DISPLAY.night;
  return (
    <div style={{
      position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, zIndex: 5, pointerEvents: 'none',
    }}>
      <motion.div key={phase} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }} style={{ fontSize: 36, lineHeight: 1 }}>
        {pd.icon}
      </motion.div>
      <motion.div key={`${phase}-l`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        style={{
          fontFamily: "'Cinzel', serif", fontSize: 12, fontWeight: 700, color: pd.color,
          letterSpacing: '0.18em', textShadow: `0 0 14px ${pd.color}55`, textTransform: 'uppercase',
        }}>
        {t.maf.ui.phaseShort[phase]}
      </motion.div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: '#8888aa', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
        {t.maf.ui.round(round)}
      </div>
    </div>
  );
}

interface SeatPos { player: ViewPlayer; x: number; y: number }

function VoteLines({ seats, votes }: { seats: SeatPos[]; votes: Record<string, string> }) {
  const pos = new Map(seats.map((s) => [s.player.id, { x: s.x, y: s.y }]));
  const lines = Object.entries(votes).flatMap(([voter, target]) => {
    const from = pos.get(voter);
    const to = pos.get(target);
    return from && to ? [{ from, to, key: `${voter}-${target}` }] : [];
  });
  if (lines.length === 0) return null;
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 15 }} viewBox="0 0 100 100">
      <defs>
        <marker id="vt-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 6 3 L 0 6 z" fill="rgba(237,137,54,0.7)" />
        </marker>
      </defs>
      {lines.map((line, i) => {
        const midX = (line.from.x + line.to.x) / 2;
        const midY = (line.from.y + line.to.y) / 2;
        const cpX = midX + (50 - midX) * 0.55;
        const cpY = midY + (50 - midY) * 0.55;
        return (
          <motion.path
            key={line.key}
            d={`M ${line.from.x} ${line.from.y} Q ${cpX} ${cpY} ${line.to.x} ${line.to.y}`}
            fill="none" stroke="rgba(237,137,54,0.4)" strokeWidth="0.35" strokeDasharray="1.2 0.6"
            markerEnd="url(#vt-arrow)"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: i * 0.04 }}
          />
        );
      })}
    </svg>
  );
}

export function RoundTable({ players, phase, round, myPlayerId, teammates, onSelect, selectedId, votes, targets }: Props) {
  const t = useT();
  const isNight = phase === 'night';
  const isVoting = phase === 'vote';
  const { counts, max } = tally(votes);
  const n = players.length;
  const size = n <= 8 ? 64 : n <= 12 ? 54 : 46;
  const radiusPct = n <= 6 ? 35 : n <= 10 ? 38 : 41;

  // You sit at the bottom of the table; the rest follow round from you.
  const seats = useMemo<SeatPos[]>(() => {
    const myIdx = players.findIndex((p) => p.id === myPlayerId);
    const ordered = myIdx >= 0 ? [...players.slice(myIdx), ...players.slice(0, myIdx)] : players;
    return ordered.map((player, i) => {
      const angle = (i / n) * 2 * Math.PI;
      return { player, x: 50 + radiusPct * Math.sin(angle), y: 50 + radiusPct * Math.cos(angle) };
    });
  }, [players, myPlayerId, n, radiusPct]);

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 560, margin: '0 auto', aspectRatio: '1' }}>
      <div style={{
        position: 'absolute', inset: '22%', borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(42,32,20,0.5) 0%, rgba(28,22,15,0.3) 60%, transparent 100%)',
        border: '1.5px solid rgba(200,155,74,0.12)',
        boxShadow: 'inset 0 0 50px rgba(200,155,74,0.04), 0 0 30px rgba(0,0,0,0.3)',
      }} />
      <div style={{ position: 'absolute', inset: '27%', borderRadius: '50%', border: '1px solid rgba(200,155,74,0.05)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: '32%', borderRadius: '50%', border: '1px solid rgba(200,155,74,0.03)', pointerEvents: 'none' }} />

      <TableCenter phase={phase} round={round} />
      {isVoting && <VoteLines seats={seats} votes={votes} />}
      {isNight && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
          background: 'radial-gradient(ellipse, transparent 25%, rgba(60,20,90,0.12) 100%)',
        }} />
      )}

      <AnimatePresence>
        {seats.map(({ player, x, y }, i) => {
          const isMe = player.id === myPlayerId;
          const isDead = player.status === 'dead';
          const isSelected = selectedId === player.id;
          const canTarget = targets.includes(player.id);
          const isMafiaTeammate = !isMe && teammates.includes(player.username);
          const voteCount = counts[player.id] || 0;
          const isHighestVoted = voteCount > 0 && voteCount === max;
          const myVoteTarget = votes[myPlayerId] === player.id;
          const role = player.roleId && (isDead || isMe || isMafiaTeammate) ? roleDef(t, player.roleId as MafiaRole) : null;
          const avatarSize = size - 8;

          return (
            <motion.div
              key={player.id}
              layout
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: isDead ? 0.4 : 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{ delay: i * 0.045, type: 'spring', stiffness: 280, damping: 22 }}
              whileHover={canTarget ? { scale: 1.14 } : {}}
              onClick={() => canTarget && onSelect?.(player.id)}
              role={canTarget ? 'button' : undefined}
              tabIndex={canTarget ? 0 : undefined}
              onKeyDown={(e) => { if (canTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect?.(player.id); } }}
              style={{
                position: 'absolute', left: `${x}%`, top: `${y}%`, x: '-50%', y: '-50%',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                cursor: canTarget ? 'pointer' : 'default', zIndex: isSelected ? 20 : 10,
              }}
            >
              <div style={{ position: 'relative' }}>
                <motion.div
                  style={{
                    width: size, height: size, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isSelected ? 'rgba(192,57,43,0.3)'
                      : isMafiaTeammate ? 'rgba(160,25,15,0.35)'
                        : isMe ? 'rgba(200,155,74,0.12)' : 'rgba(10,10,15,0.75)',
                    border: isSelected ? '3px solid rgba(192,57,43,0.9)'
                      : isMafiaTeammate ? '2px solid rgba(231,76,60,0.75)'
                        : isMe ? '2px solid rgba(200,155,74,0.5)'
                          : isDead ? '2px dashed rgba(255,255,255,0.15)'
                            : canTarget ? '2px solid rgba(200,155,74,0.45)'
                              : '2px solid rgba(200,155,74,0.2)',
                    overflow: 'hidden',
                    transition: 'border 0.15s, box-shadow 0.15s',
                  }}
                  animate={isSelected && isNight
                    ? { boxShadow: ['0 0 15px rgba(192,57,43,0.5)', '0 0 30px rgba(192,57,43,0.8)', '0 0 15px rgba(192,57,43,0.5)'] }
                    : {
                      boxShadow: isSelected ? '0 0 20px rgba(192,57,43,0.6), 0 0 40px rgba(192,57,43,0.2)'
                        : isMafiaTeammate ? '0 0 15px rgba(192,57,43,0.4)'
                          : isMe ? '0 0 12px rgba(200,155,74,0.15)' : '0 4px 12px rgba(0,0,0,0.5)',
                    }}
                  transition={isSelected && isNight ? { duration: 1.2, repeat: Infinity } : { duration: 0.3 }}
                >
                  <AvatarImg avatar={player.avatar} size={avatarSize} />
                </motion.div>

                {isDead && (
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)' }}>
                    <Skull size={size * 0.35} style={{ color: '#c0392b' }} />
                  </div>
                )}
                {player.isSilenced && (
                  <div style={{ position: 'absolute', top: -2, left: -2 }}>
                    <MicOff size={12} style={{ color: '#8e44ad' }} />
                  </div>
                )}
                {myVoteTarget && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} style={{
                    position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: '50%', background: '#e74c3c',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid rgba(10,10,15,0.8)',
                  }}>
                    <Vote size={9} style={{ color: '#fff' }} />
                  </motion.div>
                )}
                {isMafiaTeammate && (
                  <motion.div animate={{ opacity: [0.8, 1, 0.8] }} transition={{ duration: 1.8, repeat: Infinity }} style={{
                    position: 'absolute', bottom: -2, right: -8, padding: '1px 5px', borderRadius: 4,
                    fontSize: 7, fontWeight: 700, color: '#fff', background: 'rgba(192,57,43,0.9)',
                    border: '1px solid rgba(255,100,80,0.8)', fontFamily: "'JetBrains Mono', monospace",
                    letterSpacing: '0.05em', boxShadow: '0 0 8px rgba(231,76,60,0.6)', textTransform: 'uppercase',
                  }}>
                    {t.maf.ui.ally}
                  </motion.div>
                )}
                {isVoting && voteCount > 0 && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} style={{
                    position: 'absolute', bottom: -6, left: '50%', x: '-50%',
                    minWidth: 18, height: 18, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isHighestVoted ? '#e74c3c' : 'rgba(243,156,18,0.9)', border: '2px solid rgba(10,10,15,0.8)',
                    fontSize: 9, fontWeight: 700, color: '#fff', fontFamily: "'JetBrains Mono', monospace", padding: '0 4px',
                  }}>
                    {voteCount}
                  </motion.div>
                )}
              </div>

              <div style={{
                fontFamily: "'Cinzel', serif", fontSize: 9, fontWeight: 700,
                color: isMe ? '#e9c97a' : isDead ? '#555' : '#e8e8f0',
                textAlign: 'center', maxWidth: size + 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textShadow: '0 1px 4px rgba(0,0,0,0.9)',
              }}>
                {player.username}{isMe ? ' ★' : ''}
              </div>
              {role && (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: role.color, whiteSpace: 'nowrap' }}>
                  {role.icon} {role.name}
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
