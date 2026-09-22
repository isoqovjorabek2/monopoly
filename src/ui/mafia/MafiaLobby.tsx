import { memo, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, Bot, Check, ChevronDown, ChevronUp, Crown, Link2, LogOut, Minus, Play, Plus, Settings2, Users, Wifi, WifiOff, X,
} from 'lucide-react';
import './omerta.css';
import { useT } from '../../i18n';
import type { BotLevel } from '../../game/types';
import {
  ALL_ROLES, MAF_MAX_SEATS, MAF_MIN_PLAYERS, MAF_PRESETS, ROLE_MAX, autoRoles, castProblem, castSize,
} from '../../mafia/data';
import type { MafiaRole, RoleCount } from '../../mafia/types';
import { roomLink, type SeatInfo } from '../../net/protocol';
import { seatLimit, useStore } from '../../store/store';
import { AdBanner } from '../Ads';
import { LangSwitch } from '../LangSwitch';
import { isAudioEnabled, onAudioChange, playAmbient, stopAmbient, TRACKS } from './audio';
import { AvatarImg } from './Hud';
import { roleDef } from './model';

const mono = "'JetBrains Mono', monospace";
const cinzel = "'Cinzel', serif";
const crimson = "'Crimson Text', serif";

/* ─────────────────────────── player card ─────────────────────────── */

const PlayerCard = memo(function PlayerCard({ seat, isMe, isHost, index, canKick, onKick }: {
  seat: SeatInfo; isMe: boolean; isHost: boolean; index: number; canKick: boolean; onKick: (id: string) => void;
}) {
  const t = useT();
  const L = t.maf.ui.lobby;
  const variant = isMe ? 'me' : 'default';
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8, y: -20 }}
      transition={{ delay: index * 0.05, type: 'spring', stiffness: 300, damping: 25 }}
      className="tw:relative tw:flex tw:flex-col tw:items-center tw:gap-2 tw:p-3 tw:rounded-lg"
      style={variant === 'me'
        ? { background: 'linear-gradient(145deg, rgba(192,57,43,0.2), rgba(142,68,173,0.1))', border: '1px solid rgba(192,57,43,0.5)', boxShadow: '0 0 20px rgba(192,57,43,0.2)' }
        : { background: 'rgba(26,26,46,0.6)', border: '1px solid rgba(255,215,0,0.1)' }}
    >
      <div className="tw:absolute tw:top-2 tw:right-2 tw:flex tw:items-center tw:gap-1">
        {seat.isBot ? <Bot size={10} className="tw:text-[#8888aa]" />
          : seat.connected ? <Wifi size={10} className="tw:text-[#1abc9c]" /> : <WifiOff size={10} className="tw:text-[#e74c3c]" />}
        {canKick && (
          <motion.button type="button" whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.9 }}
            onClick={(e) => { e.stopPropagation(); onKick(seat.playerId); }}
            title={L.kick(seat.name)} aria-label={L.kick(seat.name)}
            className="tw:ml-0.5 tw:w-4 tw:h-4 tw:rounded-full tw:flex tw:items-center tw:justify-center"
            style={{ background: 'rgba(192,57,43,0.25)', border: '1px solid rgba(192,57,43,0.5)' }}>
            <X size={8} className="tw:text-[#e74c3c]" />
          </motion.button>
        )}
      </div>
      {isHost && (
        <motion.div className="tw:absolute tw:-top-3 tw:left-1/2 tw:-translate-x-1/2" animate={{ y: [0, -2, 0] }} transition={{ duration: 2, repeat: Infinity }}>
          <Crown size={14} className="tw:text-[#f1c40f]" fill="#f1c40f" />
        </motion.div>
      )}
      <div className="tw:w-12 tw:h-12 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:overflow-hidden"
        style={{
          background: 'rgba(10,10,15,0.6)',
          border: variant === 'me' ? '2px solid rgba(192,57,43,0.6)' : '2px solid rgba(255,215,0,0.15)',
          boxShadow: variant === 'me' ? '0 0 12px rgba(192,57,43,0.3)' : 'none',
        }}>
        <AvatarImg avatar={seat.name} size={48} />
      </div>
      <div className="tw:text-center">
        <p className="tw:text-xs tw:font-semibold tw:truncate tw:max-w-[72px]" style={{ color: isMe ? '#f1c40f' : '#e8e8f0', fontFamily: cinzel }}>
          {seat.name}
        </p>
        {isMe && <p className="tw:text-[11px] tw:text-[#8888aa]" style={{ fontFamily: mono }}>{t.maf.table.you}</p>}
        {isHost && <p className="tw:text-[11px] tw:text-[#f1c40f]" style={{ fontFamily: mono }}>{L.host}</p>}
        {seat.isBot && !isHost && <p className="tw:text-[11px] tw:text-[#8888aa]" style={{ fontFamily: mono }}>{L.bot}</p>}
      </div>
    </motion.div>
  );
});

/* ─────────────────────────── role selector ─────────────────────────── */

function RoleSelector({ roles, playerCount, onUpdate, onAuto, disabled }: {
  roles: RoleCount[] | null;
  playerCount: number;
  onUpdate: (roles: RoleCount[]) => void;
  onAuto: () => void;
  disabled: boolean;
}) {
  const t = useT();
  const L = t.maf.ui.lobby;
  const P = t.maf.lobby;
  const [expanded, setExpanded] = useState(true);
  const [activePreset, setActivePreset] = useState<string | null>(roles ? null : 'auto');
  useEffect(() => { if (!roles) setActivePreset('auto'); }, [roles]);

  const cast = roles ?? autoRoles(playerCount);
  const countOf = (role: MafiaRole): number => cast.find((x) => x.role === role)?.count ?? 0;
  const total = castSize(cast);
  const problem = castProblem(cast, playerCount);

  const apply = (next: { role: MafiaRole; count: number }[]) => {
    onUpdate(next.filter((x) => x.count > 0));
    setActivePreset(null);
  };
  const toggle = (role: MafiaRole) => apply(ALL_ROLES.map((r) => ({ role: r, count: r === role ? (countOf(r) > 0 ? 0 : 1) : countOf(r) })));
  const adjust = (role: MafiaRole, d: number) =>
    apply(ALL_ROLES.map((r) => ({ role: r, count: r === role ? Math.max(1, Math.min(ROLE_MAX[r], countOf(r) + d)) : countOf(r) })));

  const chip = (on: boolean) => ({
    background: on ? 'rgba(192,57,43,0.3)' : 'rgba(26,26,46,0.6)',
    border: `1px solid ${on ? 'rgba(192,57,43,0.6)' : 'rgba(255,215,0,0.15)'}`,
    color: on ? '#f1c40f' : '#8888aa',
  });

  return (
    <div className="glass tw:rounded-lg tw:overflow-hidden">
      <button type="button" onClick={() => setExpanded((e) => !e)}
        className="tw:w-full tw:flex tw:items-center tw:justify-between tw:p-4 tw:hover:bg-white/5 tw:transition-colors">
        <div className="tw:flex tw:items-center tw:gap-3">
          <span className="tw:text-xl">🎴</span>
          <div className="tw:text-left">
            <h3 className="tw:text-sm tw:font-bold tw:text-white" style={{ fontFamily: cinzel }}>{L.roleSetup}</h3>
            <p className="tw:text-xs tw:text-[#8888aa]">{L.assigned(total, playerCount)}</p>
          </div>
        </div>
        <div className="tw:flex tw:items-center tw:gap-2">
          {problem ? <AlertTriangle size={14} className="tw:text-[#f39c12]" /> : <Check size={14} className="tw:text-[#1abc9c]" />}
          {expanded ? <ChevronUp size={16} className="tw:text-[#8888aa]" /> : <ChevronDown size={16} className="tw:text-[#8888aa]" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }} className="tw:overflow-hidden">
            <div className="tw:p-4 tw:pt-0 tw:space-y-4">
              {problem && (
                <div className="tw:flex tw:items-start tw:gap-2 tw:p-2 tw:rounded tw:text-xs tw:text-[#f39c12]"
                  style={{ background: 'rgba(243,156,18,0.1)', border: '1px solid rgba(243,156,18,0.3)' }}>
                  <AlertTriangle size={12} className="tw:mt-0.5 tw:flex-shrink-0" />
                  <span>{P.problems[problem]} {P.fallback}</span>
                </div>
              )}
              <div>
                <p className="tw:text-xs tw:tracking-wider tw:uppercase tw:text-[#8888aa] tw:mb-2" style={{ fontFamily: mono }}>{L.presets}</p>
                <div className="tw:flex tw:flex-wrap tw:gap-2">
                  <button type="button" disabled={disabled}
                    onClick={() => { onAuto(); setActivePreset('auto'); }}
                    className="tw:px-3 tw:py-1 tw:rounded tw:text-xs tw:font-semibold tw:transition-all tw:disabled:opacity-50"
                    style={chip(activePreset === 'auto')}>
                    {L.autoBalance}
                  </button>
                  {MAF_PRESETS.map((p) => (
                    <button key={p.id} type="button" disabled={disabled}
                      onClick={() => { onUpdate(p.roles); setActivePreset(p.id); }}
                      title={P.presets[p.id as keyof typeof P.presets][1]}
                      className="tw:px-3 tw:py-1 tw:rounded tw:text-xs tw:font-semibold tw:transition-all tw:disabled:opacity-50"
                      style={chip(activePreset === p.id)}>
                      {P.presets[p.id as keyof typeof P.presets][0]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="tw:space-y-2">
                {ALL_ROLES.map((r) => {
                  const def = roleDef(t, r);
                  const count = countOf(r);
                  const enabled = count > 0;
                  return (
                    <div key={r} className={`tw:flex tw:items-center tw:gap-3 tw:p-2 tw:rounded-lg tw:transition-all ${enabled ? 'tw:opacity-100' : 'tw:opacity-40'}`}
                      style={{ background: enabled ? `${def.color}11` : 'rgba(26,26,46,0.4)', border: enabled ? `1px solid ${def.color}33` : '1px solid rgba(255,255,255,0.05)' }}>
                      <button type="button" onClick={() => toggle(r)} disabled={disabled} role="switch" aria-checked={enabled} aria-label={def.name}
                        className="tw:w-8 tw:h-5 tw:rounded-full tw:relative tw:transition-all tw:flex-shrink-0"
                        style={{ background: enabled ? def.color : 'rgba(26,26,46,0.8)', border: `1px solid ${enabled ? def.color : 'rgba(255,255,255,0.1)'}` }}>
                        <motion.div animate={{ x: enabled ? 14 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          className="tw:absolute tw:top-0.5 tw:left-0 tw:w-3.5 tw:h-3.5 tw:rounded-full tw:bg-white" />
                      </button>
                      <span className="tw:text-lg tw:flex-shrink-0">{def.icon}</span>
                      <div className="tw:flex-1 tw:min-w-0">
                        <p className="tw:text-xs tw:font-bold tw:truncate" style={{ color: def.color, fontFamily: cinzel }}>{def.name}</p>
                        <p className="tw:text-[11px] tw:text-[#8888aa] tw:truncate" style={{ fontFamily: mono }}>
                          {t.maf.ui.faction[def.faction].toUpperCase()} · {def.ability}
                        </p>
                      </div>
                      {enabled && (
                        <div className="tw:flex tw:items-center tw:gap-1 tw:flex-shrink-0">
                          <button type="button" onClick={() => adjust(r, -1)} disabled={disabled || count <= 1} aria-label={`- ${def.name}`}
                            className="tw:w-6 tw:h-6 tw:rounded tw:flex tw:items-center tw:justify-center tw:hover:bg-white/10 tw:disabled:opacity-30">
                            <Minus size={10} />
                          </button>
                          <span className="tw:w-5 tw:text-center tw:text-xs tw:font-bold tw:text-white">{count}</span>
                          <button type="button" onClick={() => adjust(r, 1)} disabled={disabled || count >= def.maxCount} aria-label={`+ ${def.name}`}
                            className="tw:w-6 tw:h-6 tw:rounded tw:flex tw:items-center tw:justify-center tw:hover:bg-white/10 tw:disabled:opacity-30">
                            <Plus size={10} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TimerSlider({ label, value, min, max, step, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void;
}) {
  return (
    <div>
      <label className="tw:flex tw:justify-between tw:text-xs tw:text-[#8888aa] tw:mb-1">
        <span style={{ fontFamily: mono }}>{label}</span>
        <span className="tw:text-[#f1c40f]" style={{ fontFamily: mono }}>{value}s</span>
      </label>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={(e) => onCommit(parseInt(e.target.value, 10))}
        className="tw:w-full tw:accent-[#c0392b] tw:h-2 tw:cursor-pointer" />
    </div>
  );
}

/* ─────────────────────────── the lobby ─────────────────────────── */

export default function MafiaLobby() {
  const t = useT();
  const L = t.maf.ui.lobby;
  const room = useStore((s) => s.room);
  const role = useStore((s) => s.role);
  const me = useStore((s) => s.me);
  const netError = useStore((s) => s.netError);
  const leave = useStore((s) => s.leave);
  const addBot = useStore((s) => s.addBot);
  const removeSeat = useStore((s) => s.removeSeat);
  const updateSettings = useStore((s) => s.updateSettings);
  const updateMafRules = useStore((s) => s.updateMafRules);
  const startGame = useStore((s) => s.startGame);
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(true);

  /* The lobby has its own music, like the app's waiting room. */
  const [audioOn, setAudioOn] = useState(isAudioEnabled);
  useEffect(() => onAudioChange(setAudioOn), []);
  useEffect(() => {
    if (audioOn) playAmbient(TRACKS.lobby, 0.2); else stopAmbient();
    return () => stopAmbient();
  }, [audioOn]);

  if (!room) return null;
  const isHost = room.hostId === me.playerId || role === 'local';
  const s = room.settings;
  const r = room.mafRules;
  const seats = room.seats;
  const limit = seatLimit(room);
  const n = Math.max(seats.length, s.fillWithBots ? MAF_MIN_PLAYERS : seats.length);
  const canStart = isHost && (seats.length >= MAF_MIN_PLAYERS || s.fillWithBots);
  const code = room.roomId;
  const cast = r.roles ?? autoRoles(Math.max(n, MAF_MIN_PLAYERS));

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomLink(code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* blocked clipboard: the code is on screen */ }
  };

  return (
    <div className="om tw:min-h-screen tw:relative tw:overflow-hidden">
      <div className="tw:fixed tw:inset-0 tw:pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at 30% 20%, rgba(192,57,43,0.08) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(142,68,173,0.06) 0%, transparent 60%)' }} />
      <div className="tw:relative tw:z-10 tw:max-w-6xl tw:mx-auto tw:px-4 tw:py-8">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
          className="tw:flex tw:items-center tw:justify-between tw:mb-8 tw:flex-wrap tw:gap-4">
          <div>
            <h1 className="tw:text-3xl tw:font-bold"
              style={{ fontFamily: cinzel, background: 'linear-gradient(135deg, #f1c40f, #c0392b)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              {L.title}
            </h1>
            <p className="tw:text-[#8888aa] tw:text-sm tw:mt-1" style={{ fontFamily: mono }}>
              {role === 'local' ? t.lobby.localGame : L.sub}
            </p>
          </div>
          <div className="tw:flex tw:items-center tw:gap-3">
            <LangSwitch />
            {role !== 'local' && (
              <motion.button type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }} onClick={copyLink}
                className="tw:flex tw:items-center tw:gap-2 tw:px-4 tw:py-3 tw:rounded-lg"
                style={{
                  background: copied ? 'rgba(26,188,156,0.15)' : 'rgba(26,26,46,0.8)',
                  border: copied ? '1px solid rgba(26,188,156,0.4)' : '1px solid rgba(255,215,0,0.2)', transition: 'all 0.2s',
                }}>
                {copied ? <Check size={16} className="tw:text-[#1abc9c]" /> : <Link2 size={16} className="tw:text-[#8888aa]" />}
                <span className="tw:text-xs tw:font-bold tw:tracking-wider tw:uppercase" style={{ fontFamily: mono, color: copied ? '#1abc9c' : '#8888aa' }}>
                  {copied ? L.copied : `${L.link} · ${code}`}
                </span>
              </motion.button>
            )}
            <motion.button type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }} onClick={leave} aria-label={L.leave} title={L.leave}
              className="tw:w-11 tw:h-11 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:text-[#8888aa] tw:hover:text-[#e74c3c] tw:transition-colors"
              style={{ background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <LogOut size={16} />
            </motion.button>
          </div>
        </motion.div>

        {netError && (
          <div className="tw:mb-4 tw:p-3 tw:rounded tw:text-xs" role="alert"
            style={{ background: 'rgba(192,57,43,0.15)', border: '1px solid rgba(192,57,43,0.4)', color: '#f0b8b8', fontFamily: mono }}>
            {netError}
          </div>
        )}

        <div className="tw:grid tw:grid-cols-1 tw:lg:grid-cols-3 tw:gap-6">
          <div className="tw:lg:col-span-2 tw:space-y-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass tw:rounded-lg tw:p-6">
              <div className="tw:flex tw:items-center tw:gap-2 tw:mb-5">
                <Users size={16} className="tw:text-[#f1c40f]" />
                <h2 className="tw:text-sm tw:font-bold tw:text-white" style={{ fontFamily: cinzel }}>{t.maf.ui.players}</h2>
                <span className="tw:ml-auto tw:text-xs tw:text-[#8888aa]" style={{ fontFamily: mono }}>{seats.length} / {limit}</span>
                {isHost && seats.length < limit && (
                  <motion.button type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={addBot}
                    className="tw:flex tw:items-center tw:gap-1.5 tw:px-3 tw:py-1.5 tw:rounded tw:text-xs"
                    style={{ background: 'rgba(26,26,46,0.8)', border: '1px solid rgba(255,215,0,0.2)', color: '#f1c40f', fontFamily: mono }}>
                    <Bot size={12} /> {L.addBot}
                  </motion.button>
                )}
              </div>
              <div className="tw:grid tw:grid-cols-3 tw:sm:grid-cols-4 tw:md:grid-cols-6 tw:gap-3">
                <AnimatePresence>
                  {seats.map((seat, i) => (
                    <PlayerCard
                      key={seat.playerId}
                      seat={seat}
                      index={i}
                      isMe={seat.playerId === me.playerId}
                      isHost={seat.playerId === room.hostId}
                      canKick={isHost && seat.playerId !== me.playerId && seat.playerId !== room.hostId}
                      onKick={removeSeat}
                    />
                  ))}
                </AnimatePresence>
                {Array.from({ length: Math.max(0, Math.min(6, limit - seats.length)) }).map((_, i) => (
                  <motion.div key={`e-${i}`} initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} transition={{ delay: 0.5 + i * 0.05 }}
                    className="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:p-3 tw:rounded-lg"
                    style={{ background: 'rgba(26,26,46,0.3)', border: '1px dashed rgba(255,255,255,0.06)' }}>
                    <div className="tw:w-12 tw:h-12 tw:rounded-full tw:flex tw:items-center tw:justify-center"
                      style={{ background: 'rgba(10,10,15,0.4)', border: '2px dashed rgba(255,255,255,0.06)', color: 'rgba(255,215,0,0.15)' }}>
                      <span style={{ fontSize: 20 }}>+</span>
                    </div>
                    <p className="tw:text-[9px] tw:tracking-widest" style={{ fontFamily: mono, color: '#444' }}>{L.waitingSlot}</p>
                  </motion.div>
                ))}
              </div>
              {seats.length < MAF_MIN_PLAYERS && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="tw:mt-4 tw:flex tw:items-center tw:gap-2 tw:p-3 tw:rounded tw:text-xs tw:text-[#f39c12]"
                  style={{ background: 'rgba(243,156,18,0.08)', border: '1px solid rgba(243,156,18,0.2)' }}>
                  <span>⏳</span>
                  <span>{L.waitingFor(seats.length, MAF_MIN_PLAYERS, code)}</span>
                </motion.div>
              )}
            </motion.div>

            <AdBanner slot="lobby" />

            {!isHost && (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass tw:rounded-lg tw:p-6">
                <h2 className="tw:text-sm tw:font-bold tw:text-white tw:mb-4" style={{ fontFamily: cinzel }}>{L.rolesIn}</h2>
                <div className="tw:flex tw:flex-wrap tw:gap-2">
                  {cast.flatMap((rc) => Array.from({ length: rc.count }, (_, i) => ({ def: roleDef(t, rc.role), key: `${rc.role}-${i}` })))
                    .map(({ def, key }, index) => (
                      <motion.div key={key} initial={{ opacity: 0, scale: 0.8, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ delay: index * 0.05, type: 'spring', stiffness: 300, damping: 25 }}
                        className="tw:flex tw:items-center tw:gap-1 tw:px-2 tw:py-1 tw:rounded tw:text-xs"
                        style={{ background: `${def.color}15`, border: `1px solid ${def.color}33`, color: def.color }}>
                        <span>{def.icon}</span>
                        <span style={{ fontFamily: cinzel }}>{def.name}</span>
                      </motion.div>
                    ))}
                </div>
              </motion.div>
            )}
          </div>

          <div className="tw:space-y-4">
            {isHost && (
              <>
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
                  <RoleSelector
                    roles={r.roles}
                    playerCount={Math.max(n, MAF_MIN_PLAYERS)}
                    onUpdate={(roles) => updateMafRules({ roles })}
                    onAuto={() => updateMafRules({ roles: null })}
                    disabled={false}
                  />
                </motion.div>
                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }} className="glass tw:rounded-lg">
                  <button type="button" onClick={() => setShowSettings((v) => !v)}
                    className="tw:w-full tw:flex tw:items-center tw:gap-3 tw:p-4 tw:hover:bg-white/5 tw:transition-colors">
                    <Settings2 size={16} className="tw:text-[#f1c40f]" />
                    <span className="tw:text-sm tw:font-bold tw:text-white tw:flex-1 tw:text-left" style={{ fontFamily: cinzel }}>{L.timers}</span>
                    <span className="tw:text-[#8888aa] tw:text-xs">{showSettings ? '▲' : '▼'}</span>
                  </button>
                  <AnimatePresence>
                    {showSettings && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="tw:overflow-hidden">
                        <div className="tw:p-4 tw:pt-0 tw:space-y-3">
                          <TimerSlider label={L.dayPhase} value={r.daySeconds} min={30} max={300} step={15} onCommit={(v) => updateMafRules({ daySeconds: v })} />
                          <TimerSlider label={L.nightPhase} value={r.nightSeconds} min={20} max={180} step={10} onCommit={(v) => updateMafRules({ nightSeconds: v })} />
                          <TimerSlider label={L.votePhase} value={r.voteSeconds} min={20} max={180} step={10} onCommit={(v) => updateMafRules({ voteSeconds: v })} />
                          <label className="tw:flex tw:items-center tw:gap-2 tw:cursor-pointer tw:text-xs tw:text-[#8888aa]">
                            <input type="checkbox" checked={r.revealRolesOnDeath} onChange={(e) => updateMafRules({ revealRolesOnDeath: e.target.checked })}
                              className="tw:accent-[#c0392b]" />
                            <span style={{ fontFamily: mono }}>{L.reveal}</span>
                          </label>
                          <div className="tw:pt-3 tw:border-t" style={{ borderColor: 'rgba(255,215,0,0.08)' }}>
                            <p className="tw:text-xs tw:font-bold tw:text-white tw:mb-3" style={{ fontFamily: cinzel }}>{L.tableTitle}</p>
                            <label className="tw:flex tw:justify-between tw:text-xs tw:text-[#8888aa] tw:mb-1">
                              <span style={{ fontFamily: mono }}>{L.maxPlayers}</span>
                              <span className="tw:text-[#f1c40f]" style={{ fontFamily: mono }}>{Math.max(MAF_MIN_PLAYERS, Math.min(s.maxPlayers, MAF_MAX_SEATS))}</span>
                            </label>
                            <input type="range" min={MAF_MIN_PLAYERS} max={MAF_MAX_SEATS} step={1} aria-label={L.maxPlayers}
                              value={Math.max(MAF_MIN_PLAYERS, Math.min(s.maxPlayers, MAF_MAX_SEATS))}
                              onChange={(e) => updateSettings({ maxPlayers: parseInt(e.target.value, 10) })}
                              className="tw:w-full tw:accent-[#c0392b] tw:h-2 tw:cursor-pointer tw:mb-3" />
                            <label className="tw:flex tw:items-center tw:gap-2 tw:cursor-pointer tw:text-xs tw:text-[#8888aa] tw:mb-3">
                              <input type="checkbox" checked={s.fillWithBots} onChange={(e) => updateSettings({ fillWithBots: e.target.checked })}
                                className="tw:accent-[#c0392b]" />
                              <span style={{ fontFamily: mono }}>{L.fillBots}</span>
                            </label>
                            <p className="tw:text-xs tw:text-[#8888aa] tw:mb-1" style={{ fontFamily: mono }}>{L.botLevel}</p>
                            <div className="tw:flex tw:gap-2">
                              {(['easy', 'normal', 'hard'] as BotLevel[]).map((lv) => (
                                <button key={lv} type="button" onClick={() => updateSettings({ botLevel: lv })}
                                  className="tw:flex-1 tw:py-1.5 tw:rounded tw:text-xs tw:font-semibold"
                                  style={{
                                    background: s.botLevel === lv ? 'rgba(192,57,43,0.3)' : 'rgba(26,26,46,0.6)',
                                    border: `1px solid ${s.botLevel === lv ? 'rgba(192,57,43,0.6)' : 'rgba(255,215,0,0.15)'}`,
                                    color: s.botLevel === lv ? '#f1c40f' : '#8888aa', fontFamily: mono,
                                  }}>
                                  {t.lobby.levels[lv]}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </>
            )}

            {isHost ? (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                <motion.button type="button" whileHover={canStart ? { scale: 1.02 } : {}} whileTap={canStart ? { scale: 0.98 } : {}}
                  onClick={() => canStart && startGame()} disabled={!canStart}
                  className="tw:w-full tw:py-4 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:gap-3 tw:font-bold tw:text-base tw:relative tw:overflow-hidden tw:disabled:opacity-50"
                  style={{
                    fontFamily: cinzel, color: '#fff',
                    background: canStart ? 'linear-gradient(135deg, #c0392b, #8e44ad)' : 'rgba(26,26,46,0.6)',
                    border: canStart ? '1px solid rgba(255,215,0,0.3)' : '1px solid rgba(255,255,255,0.1)',
                    boxShadow: canStart ? '0 0 30px rgba(192,57,43,0.3)' : 'none',
                  }}>
                  {canStart && (
                    <motion.div className="tw:absolute tw:inset-0" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)' }}
                      animate={{ x: ['-100%', '100%'] }} transition={{ duration: 2, repeat: Infinity }} />
                  )}
                  <Play size={18} fill="white" /> {L.start}
                </motion.button>
                {!canStart && (
                  <p className="tw:text-center tw:text-xs tw:text-[#8888aa] tw:mt-2" style={{ fontFamily: mono }}>
                    {L.needMore(MAF_MIN_PLAYERS - seats.length)}
                  </p>
                )}
                {role !== 'local' && (
                  <p className="tw:text-center tw:text-[10px] tw:text-[#555] tw:mt-2" style={{ fontFamily: mono }}>{L.inviteOnly}</p>
                )}
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass tw:rounded-lg tw:p-6 tw:text-center">
                <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 2, repeat: Infinity }} className="tw:text-4xl tw:mb-3">⏳</motion.div>
                <p className="tw:text-sm tw:text-[#8888aa]" style={{ fontFamily: crimson, fontSize: '1rem' }}>{L.waitStart}</p>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
