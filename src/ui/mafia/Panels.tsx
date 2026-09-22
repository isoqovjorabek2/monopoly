import { AnimatePresence, motion } from 'framer-motion';
import { Check, Target, Vote, X } from 'lucide-react';
import { useT } from '../../i18n';
import type { MafiaPrivate, NightKind } from '../../mafia/types';
import { playSFX, TRACKS } from './audio';
import { AvatarImg } from './Hud';
import { isMafiaRole, type RoleDef, type ViewPlayer } from './model';

const mono = "'JetBrains Mono', monospace";
const cinzel = "'Cinzel', serif";
const crimson = "'Crimson Text', serif";

/* ═══════════════════════════ night ═══════════════════════════ */

export function NightPanel({
  role, players, myPlayerId, priv, kind, setKind, onAction, selectedTarget, setSelectedTarget, bossName,
}: {
  role: RoleDef;
  players: ViewPlayer[];
  myPlayerId: string;
  priv: MafiaPrivate;
  kind: NightKind | null;
  setKind: (k: NightKind) => void;
  onAction: (kind: NightKind, targetId: string) => void;
  selectedTarget: string | null;
  setSelectedTarget: (id: string | null) => void;
  bossName: string;
}) {
  const t = useT();
  const N = t.maf.ui.night;
  const kinds = priv.kinds;
  const isMafia = isMafiaRole(role.id);
  const isDoctorMove = kind === 'protect';
  const family = new Set(priv.teammates.map((x) => x.id));
  const isActingBoss = !isMafia || priv.boss === myPlayerId;
  const advisory = isMafia && kind === 'kill' && !isActingBoss;

  if (kinds.length === 0 || !kind) {
    return (
      <div className="glass tw:rounded-lg tw:p-6 tw:text-center">
        <div className="tw:text-4xl tw:mb-3">🌙</div>
        <p className="tw:text-sm tw:text-[#8888aa]" style={{ fontFamily: crimson, fontSize: '1rem' }}>
          {N.asleep(role.name).split(role.name)[0]}<span style={{ color: role.color }}>{role.name}</span>{N.asleep(role.name).split(role.name)[1]}
        </p>
      </div>
    );
  }

  if (priv.move) {
    const target = players.find((p) => p.id === priv.move!.target);
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass tw:rounded-lg tw:p-6 tw:text-center"
        style={{ border: `1px solid ${role.color}33` }}
      >
        <motion.div
          className="tw:w-12 tw:h-12 tw:rounded-full tw:mx-auto tw:mb-3 tw:flex tw:items-center tw:justify-center"
          style={{ background: `${role.color}20`, border: `2px solid ${role.color}` }}
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <Check size={20} style={{ color: role.color }} />
        </motion.div>
        <p className="tw:font-bold tw:mb-1" style={{ fontFamily: cinzel, color: role.color }}>{N.submitted}</p>
        {target && <p className="tw:text-sm tw:text-[#e8e8f0] tw:mb-1" style={{ fontFamily: cinzel }}>{t.maf.table.youChose(target.username)}</p>}
        <p className="tw:text-xs tw:text-[#8888aa]" style={{ fontFamily: mono }}>{N.waiting}</p>
      </motion.div>
    );
  }

  const choices = players
    .filter((p) => p.status === 'alive' && (p.id !== myPlayerId || isDoctorMove))
    .filter((p) => !(kind === 'kill' && family.has(p.id)));
  const crew = isMafia ? players.filter((p) => p.status === 'alive' && family.has(p.id) && p.id !== myPlayerId) : [];
  const danger = kind === 'shoot' || kind === 'kill';
  const confirmColor = kind === 'shoot' ? 'linear-gradient(135deg, #c0392b, #922b21)' : role.gradient;
  const confirmBorder = kind === 'shoot' ? 'rgba(192,57,43,0.6)' : `${role.color}66`;
  const label = advisory ? N.suggest(bossName) : N.choose[kind];
  const confirmLabel = advisory ? N.suggestConfirm : N.confirm[kind];

  const confirm = () => {
    if (!selectedTarget) return;
    playSFX(TRACKS.click, 0.5);
    onAction(kind, selectedTarget);
  };

  return (
    <div className="glass tw:rounded-lg tw:p-4">
      <div className="tw:flex tw:items-center tw:gap-2 tw:mb-4">
        <span className="tw:text-2xl">{role.icon}</span>
        <div>
          <p className="tw:text-xs tw:font-bold" style={{ color: role.color, fontFamily: cinzel }}>{N.header(role.name)}</p>
          <p className="tw:text-xs tw:text-[#8888aa]">{label}</p>
        </div>
      </div>

      {kinds.length > 1 && (
        <div className="tw:flex tw:gap-2 tw:mb-4">
          {kinds.map((k) => {
            const on = kind === k;
            const red = k === 'shoot' || k === 'kill';
            return (
              <button
                key={k}
                type="button"
                onClick={() => { setKind(k); setSelectedTarget(null); }}
                className="tw:flex-1 tw:py-2 tw:rounded-lg tw:text-xs tw:font-bold tw:transition-all"
                style={{
                  fontFamily: cinzel,
                  background: on ? (red ? 'rgba(192,57,43,0.25)' : 'rgba(52,152,219,0.25)') : 'rgba(26,26,46,0.6)',
                  border: on ? (red ? '1px solid rgba(192,57,43,0.6)' : '1px solid rgba(52,152,219,0.6)') : '1px solid rgba(255,255,255,0.08)',
                  color: on ? (red ? '#e74c3c' : '#3498db') : '#8888aa',
                }}
              >
                {N.modes[k]}
              </button>
            );
          })}
        </div>
      )}

      {(kind === 'investigate' || kind === 'shoot') && (
        <AnimatePresence mode="wait">
          <motion.div
            key={kind}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="tw:text-[11px] tw:text-center tw:mb-3 tw:px-2 tw:py-1.5 tw:rounded"
            style={{
              fontFamily: mono,
              background: kind === 'shoot' ? 'rgba(192,57,43,0.1)' : 'rgba(52,152,219,0.1)',
              border: kind === 'shoot' ? '1px solid rgba(192,57,43,0.2)' : '1px solid rgba(52,152,219,0.2)',
              color: kind === 'shoot' ? '#e88' : '#8bc',
            }}
          >
            {kind === 'investigate' ? N.investigateNote : N.shootNote}
          </motion.div>
        </AnimatePresence>
      )}

      {advisory && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="tw:mb-3 tw:px-3 tw:py-2 tw:rounded-lg tw:text-center"
          style={{ background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.25)' }}
        >
          <span className="tw:text-[11px]" style={{ color: '#e74c3c', fontFamily: mono }}>👑 {N.bossNote(bossName)}</span>
        </motion.div>
      )}

      {crew.length > 0 && (
        <div className="tw:mb-4 tw:p-3 tw:rounded-lg" style={{ background: 'rgba(160,25,15,0.25)', border: '1px solid rgba(231,76,60,0.4)' }}>
          <p className="tw:text-[10px] tw:font-bold tw:tracking-widest tw:text-[#e74c3c] tw:mb-2 tw:uppercase" style={{ fontFamily: mono }}>
            {N.crew}
          </p>
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            {crew.map((p) => (
              <div key={p.id} className="tw:flex tw:items-center tw:gap-2 tw:px-2 tw:py-1.5 tw:rounded"
                style={{ background: 'rgba(192,57,43,0.2)', border: '1px solid rgba(231,76,60,0.35)' }}>
                <AvatarImg avatar={p.avatar} size={28} style={{ borderRadius: '50%' }} />
                <span className="tw:text-xs tw:text-[#ff8080]" style={{ fontFamily: cinzel }}>{p.username}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tw:grid tw:grid-cols-2 tw:gap-2 tw:mb-4">
        {choices.map((player) => {
          const isSelected = selectedTarget === player.id;
          const isLastProtected = isDoctorMove && priv.noProtect === player.id;
          const highlight = danger && kind === 'shoot' ? '#e74c3c' : role.color;
          const isMe = player.id === myPlayerId;
          return (
            <motion.button
              key={player.id}
              type="button"
              whileHover={isLastProtected ? {} : { scale: 1.03 }}
              whileTap={isLastProtected ? {} : { scale: 0.97 }}
              onClick={() => !isLastProtected && setSelectedTarget(isSelected ? null : player.id)}
              disabled={isLastProtected}
              className="tw:flex tw:items-center tw:gap-2 tw:p-3 tw:rounded-lg tw:text-left tw:transition-all"
              style={{
                minHeight: 52,
                background: isLastProtected ? 'rgba(26,26,46,0.3)' : isSelected ? `${highlight}25` : 'rgba(26,26,46,0.6)',
                border: isLastProtected ? '1px solid rgba(255,255,255,0.04)' : isSelected ? `1px solid ${highlight}66` : '1px solid rgba(255,215,0,0.08)',
                opacity: isLastProtected ? 0.5 : 1,
              }}
            >
              <AvatarImg avatar={player.avatar} size={36} />
              <div className="tw:flex tw:flex-col tw:min-w-0">
                <span className="tw:text-sm tw:font-medium tw:text-white tw:truncate" style={{ fontFamily: cinzel }}>
                  {player.username}{isMe ? ` ${t.maf.ui.you}` : ''}
                </span>
                {isLastProtected && (
                  <span className="tw:text-[10px] tw:text-[#1abc9c]" style={{ fontFamily: mono }}>{N.lastProtected}</span>
                )}
              </div>
              {isSelected && !isLastProtected && <Check size={12} className="tw:ml-auto tw:flex-shrink-0" style={{ color: highlight }} />}
            </motion.button>
          );
        })}
      </div>

      <motion.button
        type="button"
        whileHover={selectedTarget ? { scale: 1.02 } : {}}
        whileTap={selectedTarget ? { scale: 0.98 } : {}}
        onClick={confirm}
        disabled={!selectedTarget}
        className="tw:w-full tw:py-3.5 tw:rounded-lg tw:text-base tw:font-bold tw:transition-all tw:disabled:opacity-40"
        style={{
          minHeight: 48,
          fontFamily: cinzel,
          background: selectedTarget ? confirmColor : 'rgba(26,26,46,0.6)',
          border: `1px solid ${selectedTarget ? confirmBorder : 'rgba(255,255,255,0.08)'}`,
          color: '#fff',
        }}
      >
        {selectedTarget ? confirmLabel : N.select}
      </motion.button>
    </div>
  );
}

/* ═══════════════════════════ sniper ═══════════════════════════ */

export function SniperPanel({
  players, myPlayerId, onSnipe, shotLeft, selectedTarget, setSelectedTarget,
}: {
  players: ViewPlayer[];
  myPlayerId: string;
  onSnipe: (targetId: string) => void;
  shotLeft: boolean;
  selectedTarget: string | null;
  setSelectedTarget: (id: string | null) => void;
}) {
  const t = useT();
  const S = t.maf.ui.sniper;
  const alive = players.filter((p) => p.status === 'alive' && p.id !== myPlayerId);

  if (!shotLeft) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="glass tw:rounded-lg tw:p-6 tw:text-center" style={{ border: '1px solid rgba(142,68,173,0.3)' }}>
        <div className="tw:w-12 tw:h-12 tw:rounded-full tw:mx-auto tw:mb-3 tw:flex tw:items-center tw:justify-center"
          style={{ background: 'rgba(142,68,173,0.2)', border: '2px solid #8e44ad' }}>
          <Check size={20} style={{ color: '#8e44ad' }} />
        </div>
        <p className="tw:font-bold tw:mb-1" style={{ color: '#8e44ad', fontFamily: cinzel }}>{S.used}</p>
        <p className="tw:text-xs tw:text-[#8888aa]" style={{ fontFamily: mono }}>{S.usedNote}</p>
      </motion.div>
    );
  }

  return (
    <div className="glass tw:rounded-lg tw:p-4" style={{ border: '1px solid rgba(142,68,173,0.25)' }}>
      <div className="tw:flex tw:items-center tw:gap-2 tw:mb-4">
        <Target size={16} style={{ color: '#8e44ad' }} />
        <div>
          <p className="tw:text-xs tw:font-bold" style={{ color: '#8e44ad', fontFamily: cinzel }}>{S.title}</p>
          <p className="tw:text-xs tw:text-[#8888aa]">{S.note}</p>
        </div>
      </div>
      <div className="tw:grid tw:grid-cols-2 tw:gap-2 tw:mb-4">
        {alive.map((player) => (
          <motion.button
            key={player.id}
            type="button"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setSelectedTarget(selectedTarget === player.id ? null : player.id)}
            className="tw:flex tw:items-center tw:gap-2 tw:p-2 tw:rounded-lg tw:text-left tw:transition-all"
            style={{
              background: selectedTarget === player.id ? 'rgba(142,68,173,0.25)' : 'rgba(26,26,46,0.6)',
              border: selectedTarget === player.id ? '1px solid rgba(142,68,173,0.6)' : '1px solid rgba(255,215,0,0.08)',
            }}
          >
            <AvatarImg avatar={player.avatar} size={28} />
            <span className="tw:text-xs tw:font-medium tw:text-white tw:truncate" style={{ fontFamily: cinzel }}>{player.username}</span>
            {selectedTarget === player.id && <Target size={12} className="tw:ml-auto tw:flex-shrink-0" style={{ color: '#8e44ad' }} />}
          </motion.button>
        ))}
      </div>
      <motion.button
        type="button"
        whileHover={selectedTarget ? { scale: 1.02 } : {}}
        whileTap={selectedTarget ? { scale: 0.98 } : {}}
        onClick={() => { if (selectedTarget) { playSFX(TRACKS.click, 0.5); onSnipe(selectedTarget); } }}
        disabled={!selectedTarget}
        className="tw:w-full tw:py-2 tw:rounded-lg tw:text-sm tw:font-bold tw:transition-all tw:disabled:opacity-40"
        style={{
          fontFamily: cinzel,
          background: selectedTarget ? 'linear-gradient(135deg, #7d3c98, #6c3483)' : 'rgba(26,26,46,0.6)',
          border: `1px solid ${selectedTarget ? 'rgba(142,68,173,0.66)' : 'rgba(255,255,255,0.08)'}`,
          color: '#fff',
        }}
      >
        {selectedTarget ? S.fire : t.maf.ui.night.select}
      </motion.button>
    </div>
  );
}

/* ═══════════════════════════ vote ═══════════════════════════ */

export function VotingPanel({
  players, myPlayerId, votes, onVote, onCancelVote, isDead,
}: {
  players: ViewPlayer[];
  myPlayerId: string;
  votes: Record<string, string>;
  onVote: (targetId: string) => void;
  onCancelVote: () => void;
  isDead: boolean;
}) {
  const t = useT();
  const V = t.maf.ui.vote;
  const alive = players.filter((p) => p.status === 'alive');
  const myVote = votes[myPlayerId] ?? null;
  const counts: Record<string, number> = {};
  for (const target of Object.values(votes)) counts[target] = (counts[target] || 0) + 1;
  const total = Object.keys(votes).length;
  const max = Math.max(0, ...Object.values(counts));

  if (isDead) {
    return (
      <div className="glass tw:rounded-lg tw:p-6 tw:text-center">
        <p className="tw:text-4xl tw:mb-3">👻</p>
        <p className="tw:text-sm tw:text-[#8888aa]" style={{ fontFamily: crimson, fontSize: '1rem' }}>{V.dead}</p>
      </div>
    );
  }

  return (
    <div className="glass tw:rounded-lg tw:p-4">
      <div className="tw:flex tw:items-center tw:gap-2 tw:mb-4">
        <Vote size={16} className="tw:text-[#e74c3c]" />
        <div>
          <p className="tw:text-xs tw:font-bold tw:text-white" style={{ fontFamily: cinzel }}>{V.title}</p>
          <p className="tw:text-xs tw:text-[#8888aa]">{V.cast(total, alive.length)}</p>
        </div>
        {myVote && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.05 }}
            onClick={onCancelVote}
            className="tw:ml-auto tw:flex tw:items-center tw:gap-1 tw:px-3 tw:py-2 tw:rounded tw:text-xs tw:text-[#e74c3c]"
            style={{ background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.3)', minHeight: 36 }}
          >
            <X size={10} /> {V.cancel}
          </motion.button>
        )}
      </div>

      <div className="tw:space-y-2">
        {alive.map((player) => {
          if (player.id === myPlayerId) return null;
          const count = counts[player.id] || 0;
          const pct = alive.length > 1 ? (count / (alive.length - 1)) * 100 : 0;
          const isMyTarget = myVote === player.id;
          const isLeading = count > 0 && count === max;
          return (
            <motion.button
              key={player.id}
              type="button"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => { playSFX(TRACKS.click, 0.4); if (!isMyTarget) onVote(player.id); else onCancelVote(); }}
              className="tw:w-full tw:flex tw:items-center tw:gap-3 tw:p-3 tw:rounded-lg tw:text-left tw:relative tw:overflow-hidden tw:transition-all"
              style={{
                minHeight: 48,
                background: isMyTarget ? 'rgba(192,57,43,0.2)' : isLeading ? 'rgba(231,76,60,0.1)' : 'rgba(26,26,46,0.6)',
                border: isMyTarget ? '1px solid rgba(192,57,43,0.6)' : isLeading ? '1px solid rgba(231,76,60,0.3)' : '1px solid rgba(255,215,0,0.08)',
              }}
            >
              <motion.div
                className="tw:absolute tw:left-0 tw:top-0 tw:bottom-0"
                style={{ background: isLeading ? 'rgba(231,76,60,0.08)' : 'rgba(243,156,18,0.06)' }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.5 }}
              />
              <AvatarImg avatar={player.avatar} size={36} style={{ position: 'relative', zIndex: 10 }} />
              <span className="tw:text-sm tw:font-medium tw:text-white tw:relative tw:z-10 tw:flex-1 tw:truncate" style={{ fontFamily: cinzel }}>
                {player.username}
              </span>
              <div className="tw:flex tw:items-center tw:gap-2 tw:relative tw:z-10">
                {count > 0 && (
                  <span className="tw:text-xs tw:font-bold tw:px-1.5 tw:py-0.5 tw:rounded" style={{
                    background: isLeading ? 'rgba(231,76,60,0.3)' : 'rgba(26,26,46,0.8)',
                    color: isLeading ? '#e74c3c' : '#8888aa', fontFamily: mono,
                  }}>
                    {count}
                  </span>
                )}
                {isMyTarget && (
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="tw:w-5 tw:h-5 tw:rounded-full tw:bg-[#e74c3c] tw:flex tw:items-center tw:justify-center">
                    <Vote size={10} className="tw:text-white" />
                  </motion.div>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
