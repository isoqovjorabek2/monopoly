import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CLASSIC, PRESETS, TOKENS } from '../game/settings';
import type { BotLevel, GameSettings } from '../game/types';
import type { CFRules } from '../cashflow/types';
import { useT } from '../i18n';
import { hasDirectory } from '../net/directory';
import { roomLink, type RoomSnapshot } from '../net/protocol';
import { CF_MAX_SEATS, seatLimit, useStore } from '../store/store';
import { Avatar, Panel, Segmented, Slider, Toggle, fmt } from './bits';
import { LangSwitch } from './LangSwitch';

type Tab = 'seats' | 'rules' | 'economy' | 'pace';

export function Lobby() {
  const t = useT();
  const room = useStore((s) => s.room);
  const role = useStore((s) => s.role);
  const me = useStore((s) => s.me);
  const netStatus = useStore((s) => s.netStatus);
  const netError = useStore((s) => s.netError);
  const leave = useStore((s) => s.leave);
  const addBot = useStore((s) => s.addBot);
  const removeSeat = useStore((s) => s.removeSeat);
  const updateSettings = useStore((s) => s.updateSettings);
  const updateCfRules = useStore((s) => s.updateCfRules);
  const startGame = useStore((s) => s.startGame);
  const listed = useStore((s) => s.listed);
  const setListed = useStore((s) => s.setListed);

  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const isHost = room ? room.hostId === me.playerId : false;
  const isLocal = role === 'local';
  const L = t.lobby;

  if (!room) {
    return (
      <div className="lobby lobby--waiting">
        <div className="card connecting">
          <div className="spinner" aria-hidden />
          <h2 className="section__title">
            {netStatus === 'error' ? L.couldNotJoin : L.connecting}
          </h2>
          <p className="muted">{netError ?? L.opening}</p>
          <button type="button" className="btn btn--ghost" onClick={leave}>{t.common.back}</button>
        </div>
      </div>
    );
  }

  const s = room.settings;
  const cashflow = room.kind === 'cashflow';
  const limit = seatLimit(room);
  const canEdit = isHost || isLocal;
  const enoughPlayers = room.seats.length >= 2 || s.fillWithBots;
  const gameName = cashflow ? t.cf.name : 'Monopoly Royale';

  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? room.roomId : roomLink(room.roomId);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard is blocked in some embedded browsers; the value is on
      // screen and selectable, so this is a soft failure.
      setCopied(null);
    }
  };

  const share = async () => {
    const url = roomLink(room.roomId);
    if (navigator.share) {
      try { await navigator.share({ title: gameName, text: L.shareText(room.roomId), url }); return; }
      catch { /* user dismissed the sheet */ }
    }
    void copy('link');
  };

  return (
    <div className="lobby">
      <header className="lobby__head">
        <button type="button" className="btn btn--ghost btn--sm" onClick={leave}>{t.common.leave}</button>
        <span className="chip">{gameName}</span>
        <div className="spacer" />
        <LangSwitch />
        <span className="chip" data-tone={netStatus === 'online' ? 'good' : undefined}>
          {isLocal ? L.localGame : netStatus === 'online' ? L.roomOpen : t.status[netStatus]}
        </span>
      </header>

      {netError && <div className="banner banner--bad" role="alert">{netError}</div>}

      <div className="lobby__grid">
        {/* --------------------------- invite -------------------------- */}
        {!isLocal && (
          <section className="card invite">
            <p className="overline">{L.roomCode}</p>
            <div className="invite__code num">{room.roomId}</div>
            <p className="muted small">{L.anyoneCanSit}</p>
            <div className="invite__actions">
              <button type="button" className="btn btn--sm" onClick={() => copy('code')}>
                {copied === 'code' ? L.copied : L.copyCode}
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={share}>
                {copied === 'link' ? L.linkCopied : L.shareLink}
              </button>
            </div>
            <div className="invite__link num truncate" title={roomLink(room.roomId)}>
              {roomLink(room.roomId)}
            </div>

            {isHost && hasDirectory && !cashflow && (
              <label className="invite__public">
                <input
                  type="checkbox"
                  checked={listed}
                  onChange={(e) => setListed(e.target.checked)}
                />
                <span>
                  <span className="switch__label">{L.listPublicly}</span>
                  <span className="switch__hint">{listed ? L.listedOn : L.listedOff}</span>
                </span>
              </label>
            )}
            {isHost && cashflow && <p className="muted small">{t.cf.lobby.inviteOnly}</p>}
          </section>
        )}

        {/* --------------------------- seats --------------------------- */}
        <Panel
          title={L.seats(room.seats.length, limit)}
          action={canEdit && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={addBot}
              disabled={room.seats.length >= limit}
              title={room.seats.length >= limit ? L.tableFull : undefined}
            >
              {L.addBot}
            </button>
          )}
          className="lobby__seats"
        >
          <ul className="seatList">
            <AnimatePresence initial={false}>
              {room.seats.map((seat, i) => (
                <motion.li
                  key={seat.playerId}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34, delay: i * 0.03 }}
                  className="seat"
                >
                  <Avatar color={seat.color} token={seat.token} size={34} dim={!seat.connected} />
                  <span className="seat__info">
                    <span className="seat__name truncate" title={seat.name}>{seat.name}</span>
                    <span className="seat__meta">
                      {seat.isHost && <span className="chip">{t.common.host}</span>}
                      {seat.isBot && <span className="chip">{L.botChip(L.levels[seat.botLevel])}</span>}
                      {seat.playerId === me.playerId && <span className="chip">{t.common.you}</span>}
                      {!seat.connected && <span className="chip" data-tone="bad">{L.reconnecting}</span>}
                    </span>
                  </span>
                  {canEdit && !seat.isHost && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => removeSeat(seat.playerId)}
                      aria-label={L.removeAria(seat.name)}
                    >
                      {L.remove}
                    </button>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
            {Array.from({ length: Math.max(0, Math.min(limit, 8) - room.seats.length) }, (_, i) => (
              <li key={`empty${i}`} className="seat seat--empty">
                <span className="seat__slot" aria-hidden />
                <span className="seat__info"><span className="muted small">{L.emptySeat}</span></span>
              </li>
            ))}
          </ul>
        </Panel>

        {/* -------------------------- settings ------------------------- */}
        {cashflow
          ? <CashflowSettings room={room} canEdit={canEdit} set={updateSettings} setRules={updateCfRules} />
          : <MonopolySettings room={room} canEdit={canEdit} set={updateSettings} />}
      </div>

      <footer className="lobby__foot">
        <div className="lobby__summary">
          {cashflow ? (
            <>
              <span className="chip num">{t.cf.lobby.chipGoal(fmt(room.cfRules.fastGoal))}</span>
              <span className="chip">{room.cfRules.strictLoans ? t.cf.lobby.strict : t.cf.lobby.open}</span>
              <span className="chip">
                {room.cfRules.turnLimit > 0 ? t.cf.lobby.chipRounds(room.cfRules.turnLimit) : t.cf.lobby.noLimit}
              </span>
            </>
          ) : (
            <>
              <span className="chip num">{L.chipStart(fmt(s.startingCash))}</span>
              <span className="chip num">{L.chipGo(fmt(s.goSalary))}</span>
              <span className="chip">{s.auctionsEnabled ? L.auctionsOn : L.noAuctions}</span>
              <span className="chip">
                {s.winCondition === 'turn-limit' ? L.chipTurns(s.turnLimit)
                  : s.winCondition === 'networth' ? L.chipTarget(fmt(s.netWorthTarget))
                    : L.lastStanding}
              </span>
            </>
          )}
        </div>
        <div className="spacer" />
        {canEdit ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={startGame}
            disabled={!enoughPlayers}
            title={enoughPlayers ? undefined : L.needPlayers}
          >
            {L.start}
          </button>
        ) : (
          <span className="muted small">{L.waiting}</span>
        )}
      </footer>
    </div>
  );
}

/* ------------------------- Monopoly's rulebook ----------------------- */

function MonopolySettings({
  room, canEdit, set,
}: { room: RoomSnapshot; canEdit: boolean; set: (patch: Partial<GameSettings>) => void }) {
  const t = useT();
  const L = t.lobby;
  const s = room.settings;
  const [tab, setTab] = useState<Tab>('seats');
  const deviations = useMemo(() => countDeviations(s), [s]);
  const rule = (key: string) => L.rules[key] ?? ['', ''];

  return (
    <section className="card lobby__rules">
      <header className="tabs" role="tablist" aria-label={L.settingsAria}>
        {(['seats', 'rules', 'economy', 'pace'] as Tab[]).map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            aria-selected={tab === tb}
            className="tabs__item"
            data-on={tab === tb || undefined}
            onClick={() => setTab(tb)}
          >
            {L.tabs[tb]}
          </button>
        ))}
      </header>

      <fieldset className="settings" disabled={!canEdit}>
        {!canEdit && (
          <p className="muted small settings__lock">{L.hostOnly}</p>
        )}

        {tab === 'seats' && (
          <div className="presets">
            {PRESETS.map((p) => {
              const on = matchesPreset(s, p.id);
              const copyOf = t.presets[p.id] ?? p;
              return (
                <button
                  key={p.id}
                  type="button"
                  className="preset"
                  data-on={on || undefined}
                  onClick={() => set({ ...CLASSIC, ...p.patch, seed: s.seed, maxPlayers: s.maxPlayers })}
                >
                  <span className="preset__name">{copyOf.name}</span>
                  <span className="preset__time num">{copyOf.minutes}</span>
                  <span className="preset__blurb">{copyOf.blurb}</span>
                </button>
              );
            })}
            <p className="muted small presets__note">
              {deviations === 0 ? L.official : L.houseRulesActive(deviations)}
            </p>
          </div>
        )}

        {tab === 'rules' && (
          <div className="settings__cols">
            <Toggle label={rule('auctions')[0]} hint={rule('auctions')[1]} checked={s.auctionsEnabled} onChange={(v) => set({ auctionsEnabled: v })} />
            <Toggle label={rule('doubleRent')[0]} hint={rule('doubleRent')[1]} checked={s.doubleRentOnMonopoly} onChange={(v) => set({ doubleRentOnMonopoly: v })} />
            <Toggle label={rule('shortage')[0]} hint={rule('shortage')[1]} checked={s.buildingShortage} onChange={(v) => set({ buildingShortage: v })} />
            <Toggle label={rule('fullSet')[0]} hint={rule('fullSet')[1]} checked={s.requireFullSetToBuild} onChange={(v) => set({ requireFullSetToBuild: v })} />
            <Toggle label={rule('buyInJail')[0]} hint={rule('buyInJail')[1]} checked={s.canBuyInJail} onChange={(v) => set({ canBuyInJail: v })} />
            <Toggle label={rule('lap')[0]} hint={rule('lap')[1]} checked={s.mustLapBeforeBuying} onChange={(v) => set({ mustLapBeforeBuying: v })} />
            <Toggle label={rule('noRentInJail')[0]} hint={rule('noRentInJail')[1]} checked={s.noRentInJail} onChange={(v) => set({ noRentInJail: v })} />
            <Toggle label={rule('trades')[0]} checked={s.allowTrades} onChange={(v) => set({ allowTrades: v })} />
          </div>
        )}

        {tab === 'economy' && (
          <div className="settings__cols">
            <Slider label={L.startingCash} min={500} max={5000} step={100} value={s.startingCash} format={fmt} onChange={(v) => set({ startingCash: v })} />
            <Slider label={L.goSalary} min={0} max={800} step={50} value={s.goSalary} format={fmt} onChange={(v) => set({ goSalary: v })} />
            <Slider label={L.jailFine} min={0} max={300} step={10} value={s.jailFine} format={fmt} onChange={(v) => set({ jailFine: v })} />
            <Slider label={L.interest} min={0} max={30} step={1} value={s.mortgageInterestPct} format={t.common.percent} onChange={(v) => set({ mortgageInterestPct: v })} />
            <Toggle label={L.doubleOnGo} hint={L.houseRule} checked={s.doubleOnGo} onChange={(v) => set({ doubleOnGo: v })} />
            <Toggle label={L.jackpot} hint={L.jackpotHint} checked={s.freeParkingJackpot} onChange={(v) => set({ freeParkingJackpot: v })} />
            {s.freeParkingJackpot && (
              <Slider label={L.jackpotSeed} min={0} max={2000} step={100} value={s.freeParkingSeed} format={fmt} onChange={(v) => set({ freeParkingSeed: v })} />
            )}
            <Slider label={L.snakeEyes} min={0} max={500} step={25} value={s.snakeEyesBonus} format={(v) => (v === 0 ? t.common.off : fmt(v))} onChange={(v) => set({ snakeEyesBonus: v })} />
          </div>
        )}

        {tab === 'pace' && (
          <div className="settings__cols">
            <div className="labelled">
              <span className="switch__label">{L.howEnds}</span>
              <Segmented
                label={L.winCondition}
                value={s.winCondition}
                onChange={(v) => set({ winCondition: v })}
                options={(['last-standing', 'turn-limit', 'networth'] as const).map((w) => ({
                  value: w, label: L.win[w][0],
                }))}
              />
              <p className="muted small">{L.win[s.winCondition][1]}</p>
            </div>

            {s.winCondition === 'turn-limit' && (
              <Slider label={L.turnLimit} min={10} max={200} step={5} value={s.turnLimit} onChange={(v) => set({ turnLimit: v })} />
            )}
            {s.winCondition === 'networth' && (
              <Slider label={L.netWorthTarget} min={2000} max={25000} step={500} value={s.netWorthTarget} format={fmt} onChange={(v) => set({ netWorthTarget: v })} />
            )}

            <Slider label={L.tableSize} min={2} max={8} step={1} value={s.maxPlayers} format={L.players} onChange={(v) => set({ maxPlayers: v })} />
            <Slider label={L.turnTimer} min={0} max={180} step={5} value={s.turnTimer} format={(v) => (v === 0 ? t.common.off : t.common.seconds(v))} onChange={(v) => set({ turnTimer: v })} />
            <Slider label={L.auctionTime} min={5} max={60} step={5} value={s.auctionBidSeconds} format={t.common.seconds} onChange={(v) => set({ auctionBidSeconds: v })} />
            <Slider label={L.animation} min={0.5} max={2.5} step={0.1} value={s.animationSpeed} format={(v) => t.common.times(v.toFixed(1))} onChange={(v) => set({ animationSpeed: v })} />

            <BotSettings s={s} set={set} />
          </div>
        )}
      </fieldset>
    </section>
  );
}

/* ------------------------- Cashflow's rulebook ----------------------- */

function CashflowSettings({
  room, canEdit, set, setRules,
}: {
  room: RoomSnapshot;
  canEdit: boolean;
  set: (patch: Partial<GameSettings>) => void;
  setRules: (patch: Partial<CFRules>) => void;
}) {
  const t = useT();
  const L = t.lobby;
  const C = t.cf.lobby;
  const s = room.settings;
  const r = room.cfRules;

  return (
    <section className="card lobby__rules">
      <fieldset className="settings" disabled={!canEdit}>
        {!canEdit && <p className="muted small settings__lock">{L.hostOnly}</p>}
        <p className="muted small">{C.about}</p>
        <div className="settings__cols">
          <Toggle
            label={C.strictLoans[0]}
            hint={C.strictLoans[1]}
            checked={r.strictLoans}
            onChange={(v) => setRules({ strictLoans: v })}
          />
          <div className="labelled">
            <Slider
              label={C.fastGoal}
              min={25000} max={150000} step={5000}
              value={r.fastGoal} format={fmt}
              onChange={(v) => setRules({ fastGoal: v })}
            />
            <p className="muted small">{C.fastGoalHint}</p>
          </div>
          <Slider
            label={C.roundLimit}
            min={0} max={60} step={5}
            value={r.turnLimit}
            format={(v) => (v === 0 ? C.noLimit : C.chipRounds(v))}
            onChange={(v) => setRules({ turnLimit: v })}
          />
          <Slider
            label={L.tableSize}
            min={2} max={CF_MAX_SEATS} step={1}
            value={Math.min(s.maxPlayers, CF_MAX_SEATS)} format={L.players}
            onChange={(v) => set({ maxPlayers: v })}
          />
          <BotSettings s={s} set={set} />
        </div>
      </fieldset>
    </section>
  );
}

function BotSettings({ s, set }: { s: GameSettings; set: (patch: Partial<GameSettings>) => void }) {
  const t = useT();
  const L = t.lobby;
  return (
    <>
      <div className="labelled">
        <span className="switch__label">{L.botDifficulty}</span>
        <Segmented
          label={L.botDifficulty}
          value={s.botLevel}
          onChange={(v) => set({ botLevel: v as BotLevel })}
          options={(['easy', 'normal', 'hard'] as const).map((lv) => ({
            value: lv, label: L.levels[lv],
          }))}
        />
        <p className="muted small">{L.difficultyNote}</p>
      </div>
      <Toggle label={L.fillBots} checked={s.fillWithBots} onChange={(v) => set({ fillWithBots: v })} />
    </>
  );
}

/* ---------------------------- helpers ------------------------------- */

const RULE_KEYS: (keyof GameSettings)[] = [
  'startingCash', 'goSalary', 'doubleOnGo', 'freeParkingJackpot', 'snakeEyesBonus',
  'auctionsEnabled', 'doubleRentOnMonopoly', 'buildingShortage', 'requireFullSetToBuild',
  'mustLapBeforeBuying', 'noRentInJail', 'mortgageInterestPct', 'jailFine', 'canBuyInJail',
];

function countDeviations(s: GameSettings): number {
  return RULE_KEYS.filter((k) => s[k] !== CLASSIC[k]).length;
}

function matchesPreset(s: GameSettings, presetId: string): boolean {
  const p = PRESETS.find((x) => x.id === presetId);
  if (!p) return false;
  const target = { ...CLASSIC, ...p.patch };
  return RULE_KEYS.every((k) => s[k] === target[k]) && s.winCondition === target.winCondition;
}

export const TOKEN_COUNT = TOKENS.length;
