import { useEffect, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Bot, Check, Link2, LogOut, Minus, Plus, X } from 'lucide-react';
import './omerta.css';
import './deck/deck.css';
import './deck/lobby.css';
import { useT } from '../../i18n';
import type { BotLevel } from '../../game/types';
import {
  ALL_ROLES, MAF_MAX_SEATS, MAF_MIN_PLAYERS, MAF_PRESETS, ROLE_MAX, autoRoles, castProblem, castSize,
} from '../../mafia/data';
import type { MafiaRole, RoleCount } from '../../mafia/types';
import { roomLink } from '../../net/protocol';
import { seatLimit, useStore } from '../../store/store';
import { AdBanner } from '../Ads';
import { LangSwitch } from '../LangSwitch';
import { isAudioEnabled, onAudioChange, playAmbient, playSFX, stopAmbient, TRACKS } from './audio';
import { SuspectCard } from './deck/SuspectCard';
import { roleDef } from './model';

/* ------------------------------------------------------------------ *
 * The back room, before the deal - in the same case file as the game.
 * Whoever has sat down is already a card on the table; the empty chairs
 * are outlines (the host's tap seats a bot in one, a guest's copies the
 * invite). The cast is the deck about to be dealt, a tile per role, and
 * the house rules are a sheet of rows. One brass button deals.
 * ------------------------------------------------------------------ */

function Stepper({ value, min, max, step = 1, label, format = String, onChange }: {
  value: number; min: number; max: number; step?: number; label: string;
  format?: (v: number) => string; onChange: (v: number) => void;
}) {
  const t = useT();
  const L = t.maf.ui.lobby;
  const go = (d: number) => { playSFX(TRACKS.click, 0.25); onChange(Math.max(min, Math.min(max, value + d))); };
  return (
    <span className="lb-step">
      <button type="button" onClick={() => go(-step)} disabled={value <= min} aria-label={L.less(label)}><Minus size={14} /></button>
      <output aria-live="polite" aria-label={label}>{format(value)}</output>
      <button type="button" onClick={() => go(step)} disabled={value >= max} aria-label={L.more(label)}><Plus size={14} /></button>
    </span>
  );
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="lb-switch"
      onClick={() => { playSFX(TRACKS.click, 0.25); onChange(!on); }} />
  );
}

/* ─────────────────────────── the deck ─────────────────────────── */

function TheDeck({ roles, playerCount, editable, onUpdate, onAuto }: {
  roles: RoleCount[] | null;
  playerCount: number;
  editable: boolean;
  onUpdate: (roles: RoleCount[]) => void;
  onAuto: () => void;
}) {
  const t = useT();
  const L = t.maf.ui.lobby;
  const P = t.maf.lobby;
  const [preset, setPreset] = useState<string | null>(roles ? null : 'auto');
  useEffect(() => { if (!roles) setPreset('auto'); }, [roles]);

  const cast = roles ?? autoRoles(playerCount);
  const countOf = (role: MafiaRole): number => cast.find((x) => x.role === role)?.count ?? 0;
  const total = castSize(cast);
  const problem = castProblem(cast, playerCount);
  const set = (role: MafiaRole, n: number) => {
    onUpdate(ALL_ROLES.map((r) => ({ role: r, count: r === role ? n : countOf(r) })).filter((x) => x.count > 0));
    setPreset(null);
  };
  const shown = editable ? ALL_ROLES : ALL_ROLES.filter((r) => countOf(r) > 0);

  return (
    <section className="lb-sec" aria-labelledby="lb-deck">
      <div className="lb-sec__head">
        <h2 id="lb-deck" className="lb-sec__title">{L.deck}</h2>
        <span className="lb-sec__meta">{L.deckSub(total, playerCount)}</span>
      </div>
      {editable && (
        <div className="lb-presets" role="group" aria-label={L.presets}>
          <button type="button" className="lb-pill" aria-pressed={preset === 'auto'}
            onClick={() => { playSFX(TRACKS.click, 0.3); onAuto(); setPreset('auto'); }}>
            {L.autoBalance}
          </button>
          {MAF_PRESETS.map((p) => (
            <button key={p.id} type="button" className="lb-pill" aria-pressed={preset === p.id}
              title={P.presets[p.id as keyof typeof P.presets][1]}
              onClick={() => { playSFX(TRACKS.click, 0.3); onUpdate(p.roles); setPreset(p.id); }}>
              {P.presets[p.id as keyof typeof P.presets][0]}
            </button>
          ))}
        </div>
      )}
      {editable && problem && (
        <div className="lb-warn" role="status">
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{P.problems[problem]} {P.fallback}</span>
        </div>
      )}
      <div className="lb-roles">
        {shown.map((r, i) => {
          const def = roleDef(t, r);
          const n = countOf(r);
          return (
            <motion.div key={r} className="lb-role" data-off={n === 0} style={{ '--c': def.color } as CSSProperties}
              initial={{ opacity: 0, y: 14 }} animate={{ opacity: n === 0 ? 0.45 : 1, y: 0 }}
              transition={{ delay: i * 0.03, type: 'spring', stiffness: 320, damping: 28 }}>
              <div className="lb-role__top">
                <span className="lb-role__icon" aria-hidden>{def.icon}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="lb-role__name">{def.name}</span>
                  <span className="lb-role__side">{t.maf.ui.faction[def.faction]}</span>
                </span>
                {!editable && <span className="lb-role__count">×{n}</span>}
              </div>
              <p className="lb-role__ability">{def.ability}</p>
              {editable && (
                <Stepper value={n} min={0} max={ROLE_MAX[r]} label={def.name} format={(v) => `×${v}`} onChange={(v) => set(r, v)} />
              )}
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────────────────────── the lobby ─────────────────────────── */

export default function MafiaLobby() {
  const t = useT();
  const L = t.maf.ui.lobby;
  const D = t.maf.ui.deck;
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

  /* The lobby has its own music, like the app's waiting room. */
  const [audioOn, setAudioOn] = useState(isAudioEnabled);
  useEffect(() => onAudioChange(setAudioOn), []);
  useEffect(() => {
    if (audioOn) playAmbient(TRACKS.lobby, 0.2); else stopAmbient();
    return () => stopAmbient();
  }, [audioOn]);

  if (!room) return null;
  const local = role === 'local';
  const isHost = room.hostId === me.playerId || local;
  const s = room.settings;
  const r = room.mafRules;
  const seats = room.seats;
  const limit = seatLimit(room);
  const players = Math.max(MAF_MIN_PLAYERS, seats.length);
  const canStart = isHost && (seats.length >= MAF_MIN_PLAYERS || s.fillWithBots);
  const code = room.roomId;
  const cast = (r.roles ?? autoRoles(players)).filter((x) => x.count > 0);
  const open = Math.max(0, limit - seats.length);
  const maxSeats = Math.max(MAF_MIN_PLAYERS, Math.min(s.maxPlayers, MAF_MAX_SEATS));

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomLink(code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* blocked clipboard: the code is on screen */ }
  };
  const onOpenChair = () => {
    playSFX(TRACKS.click, 0.35);
    if (isHost) addBot(); else void copyLink();
  };

  const rows = [
    { key: 'night', label: L.nightPhase, node: <Stepper value={r.nightSeconds} min={20} max={180} step={10} label={L.nightPhase} format={L.seconds} onChange={(v) => updateMafRules({ nightSeconds: v })} />, value: L.seconds(r.nightSeconds) },
    { key: 'day', label: L.dayPhase, node: <Stepper value={r.daySeconds} min={30} max={300} step={15} label={L.dayPhase} format={L.seconds} onChange={(v) => updateMafRules({ daySeconds: v })} />, value: L.seconds(r.daySeconds) },
    { key: 'vote', label: L.votePhase, node: <Stepper value={r.voteSeconds} min={20} max={180} step={10} label={L.votePhase} format={L.seconds} onChange={(v) => updateMafRules({ voteSeconds: v })} />, value: L.seconds(r.voteSeconds) },
    { key: 'reveal', label: L.reveal, node: <Switch on={r.revealRolesOnDeath} label={L.reveal} onChange={(v) => updateMafRules({ revealRolesOnDeath: v })} />, value: r.revealRolesOnDeath ? '✓' : '—' },
    { key: 'max', label: L.maxPlayers, node: <Stepper value={maxSeats} min={MAF_MIN_PLAYERS} max={MAF_MAX_SEATS} label={L.maxPlayers} onChange={(v) => updateSettings({ maxPlayers: v })} />, value: String(maxSeats) },
    { key: 'fill', label: L.fillBots, node: <Switch on={s.fillWithBots} label={L.fillBots} onChange={(v) => updateSettings({ fillWithBots: v })} />, value: s.fillWithBots ? '✓' : '—' },
    {
      key: 'level', label: L.botLevel,
      node: (
        <span className="lb-seg" role="group" aria-label={L.botLevel}>
          {(['easy', 'normal', 'hard'] as BotLevel[]).map((lv) => (
            <button key={lv} type="button" aria-pressed={s.botLevel === lv} onClick={() => { playSFX(TRACKS.click, 0.25); updateSettings({ botLevel: lv }); }}>
              {t.lobby.levels[lv]}
            </button>
          ))}
        </span>
      ),
      value: t.lobby.levels[s.botLevel],
    },
  ];

  return (
    <div className="om">
     <div className="lb">
      <div className="lb__wrap">
        <header className="lb-head">
          <div className="lb-brand">
            <h1 className="lb-brand__mark">OMERTÀ</h1>
            <span className="lb-brand__sub">{local ? t.lobby.localGame : L.sub}</span>
          </div>
          {!local && (
            <div className="lb-code">
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="lb-code__label">{L.code}</span>
                <span className="lb-code__value">{code}</span>
              </span>
              <button type="button" className="lb-icon" data-done={copied} onClick={copyLink}
                aria-label={copied ? L.copied : L.copyLink} title={copied ? L.copied : L.copyLink}>
                {copied ? <Check size={16} /> : <Link2 size={16} />}
              </button>
            </div>
          )}
          <LangSwitch />
          <button type="button" className="lb-icon" onClick={leave} aria-label={L.leave} title={L.leave}>
            <LogOut size={16} />
          </button>
        </header>

        {netError && <div className="lb-alert" role="alert">{netError}</div>}

        <section className="lb-sec" aria-labelledby="lb-table">
          <div className="lb-sec__head">
            <h2 id="lb-table" className="lb-sec__title">{L.tableTitle2}</h2>
            <span className="lb-sec__meta">{L.seats(seats.length, limit)}</span>
            {isHost && open > 0 && (
              <span className="lb-sec__tools">
                <button type="button" className="lb-pill" onClick={() => { playSFX(TRACKS.click, 0.35); addBot(); }}>
                  <Bot size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6 }} />{L.addBot}
                </button>
              </span>
            )}
          </div>
          <div className="lb-table">
            <AnimatePresence>
              {seats.map((seat, i) => {
                const mine = seat.playerId === me.playerId;
                const hostSeat = seat.playerId === room.hostId;
                const canKick = isHost && !mine && !hostSeat;
                return (
                  <SuspectCard
                    key={seat.playerId}
                    player={{
                      id: seat.playerId, username: seat.name, avatar: seat.name, status: 'alive',
                      isHost: hostSeat, isConnected: seat.isBot || seat.connected, isSilenced: false,
                    }}
                    seatNo={i + 1}
                    index={i}
                    role={null}
                    isMe={mine}
                    isAlly={false}
                    tappable={false}
                    selected={false}
                    dim={false}
                    stamp={null}
                    voters={[]}
                    leading={false}
                    knives={[]}
                    check={null}
                    note={null}
                    onNote={null}
                    onTap={() => {}}
                    seal={hostSeat ? `♛ ${L.host}` : undefined}
                    sub={mine ? D.you : seat.isBot ? L.bot : ' '}
                    corner={canKick ? (
                      <button type="button" className="lb-kick" onClick={() => removeSeat(seat.playerId)}
                        aria-label={L.kick(seat.name)} title={L.kick(seat.name)}>
                        <X size={12} />
                      </button>
                    ) : undefined}
                  />
                );
              })}
            </AnimatePresence>
            {open > 0 && (() => {
              // One outline stands for every empty chair: the count says how many.
              const tappable = isHost || !local;
              const inner = (
                <>
                  <span className="lb-open__plus" aria-hidden><Plus size={18} /></span>
                  <span className="lb-open__name">{L.openSeat}</span>
                  {tappable && <span className="lb-open__hint">{isHost ? L.tapBot : L.tapInvite}</span>}
                  {open > 1 && <span className="lb-open__count" aria-hidden>×{open}</span>}
                </>
              );
              return tappable ? (
                <motion.button key="open" type="button" className="lb-open" onClick={onOpenChair}
                  aria-label={`${L.openSeat} ×${open} · ${isHost ? L.tapBot : L.tapInvite}`}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
                  {inner}
                </motion.button>
              ) : (
                <div key="open" className="lb-open">{inner}</div>
              );
            })()}
          </div>
          {seats.length < MAF_MIN_PLAYERS && !s.fillWithBots && (
            <p className="lb-note">⏳ {L.waitingFor(seats.length, MAF_MIN_PLAYERS, code)}</p>
          )}
        </section>

        <AdBanner slot="lobby" />

        <div className="lb-lower">
          <TheDeck
            roles={r.roles}
            playerCount={players}
            editable={isHost}
            onUpdate={(roles) => updateMafRules({ roles })}
            onAuto={() => updateMafRules({ roles: null })}
          />
          <section className="lb-sec" aria-labelledby="lb-rules">
            <div className="lb-sec__head">
              <h2 id="lb-rules" className="lb-sec__title">{L.rules}</h2>
            </div>
            <div className="lb-rules">
              {rows.map((row) => (
                <div key={row.key} className="lb-row">
                  <span className="lb-row__label">{row.label}</span>
                  {isHost ? row.node : <span className="lb-row__value">{row.value}</span>}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="lb-bar">
          <div className="lb-bar__cast">
            <div className="lb-bar__line" aria-label={L.deck}>
              {cast.map((rc) => {
                const def = roleDef(t, rc.role);
                return <span key={rc.role} title={def.name}>{def.icon} <b style={{ color: def.color }}>×{rc.count}</b></span>;
              })}
            </div>
            {isHost && (!canStart || !local) && (
              <p className="lb-bar__hint">{!canStart ? L.needMore(MAF_MIN_PLAYERS - seats.length) : L.inviteOnly}</p>
            )}
          </div>
          {isHost ? (
            <button type="button" className="lb-deal" disabled={!canStart} onClick={() => canStart && startGame()}>
              🂠 {L.deal}
            </button>
          ) : (
            <span className="lb-wait"><span className="lb-wait__dot" aria-hidden /> {L.waitStart}</span>
          )}
        </div>
      </div>
     </div>
    </div>
  );
}
