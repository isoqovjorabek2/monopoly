import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CLASSIC, PRESETS, TOKENS } from '../game/settings';
import type { BotLevel, GameSettings } from '../game/types';
import { roomLink } from '../net/protocol';
import { useStore } from '../store/store';
import { Avatar, Panel, Segmented, Slider, Toggle, fmt } from './bits';

type Tab = 'seats' | 'rules' | 'economy' | 'pace';

export function Lobby() {
  const room = useStore((s) => s.room);
  const role = useStore((s) => s.role);
  const me = useStore((s) => s.me);
  const netStatus = useStore((s) => s.netStatus);
  const netError = useStore((s) => s.netError);
  const leave = useStore((s) => s.leave);
  const addBot = useStore((s) => s.addBot);
  const removeSeat = useStore((s) => s.removeSeat);
  const updateSettings = useStore((s) => s.updateSettings);
  const startGame = useStore((s) => s.startGame);

  const [tab, setTab] = useState<Tab>('seats');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const isHost = room ? room.hostId === me.playerId : false;
  const isLocal = role === 'local';

  if (!room) {
    return (
      <div className="lobby lobby--waiting">
        <div className="card connecting">
          <div className="spinner" aria-hidden />
          <h2 className="section__title">
            {netStatus === 'error' ? 'Could not join' : 'Connecting to the table...'}
          </h2>
          <p className="muted">{netError ?? 'Opening a direct connection to the host.'}</p>
          <button type="button" className="btn btn--ghost" onClick={leave}>Back</button>
        </div>
      </div>
    );
  }

  const s = room.settings;
  const set = (patch: Partial<GameSettings>) => updateSettings(patch);
  const canEdit = isHost || isLocal;
  const enoughPlayers = room.seats.length >= 2 || s.fillWithBots;

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
      try { await navigator.share({ title: 'Monopoly Royale', text: `Join my game: ${room.roomId}`, url }); return; }
      catch { /* user dismissed the sheet */ }
    }
    void copy('link');
  };

  const deviations = useMemo(() => countDeviations(s), [s]);

  return (
    <div className="lobby">
      <header className="lobby__head">
        <button type="button" className="btn btn--ghost btn--sm" onClick={leave}>Leave</button>
        <div className="spacer" />
        <span className="chip" data-tone={netStatus === 'online' ? 'good' : undefined}>
          {isLocal ? 'Local game' : netStatus === 'online' ? 'Room open' : netStatus}
        </span>
      </header>

      {netError && <div className="banner banner--bad" role="alert">{netError}</div>}

      <div className="lobby__grid">
        {/* --------------------------- invite -------------------------- */}
        {!isLocal && (
          <section className="card invite">
            <p className="overline">Room code</p>
            <div className="invite__code num">{room.roomId}</div>
            <p className="muted small">
              Anyone with this code or link can take a seat until the game starts.
            </p>
            <div className="invite__actions">
              <button type="button" className="btn btn--sm" onClick={() => copy('code')}>
                {copied === 'code' ? 'Copied' : 'Copy code'}
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={share}>
                {copied === 'link' ? 'Link copied' : 'Share link'}
              </button>
            </div>
            <div className="invite__link num truncate" title={roomLink(room.roomId)}>
              {roomLink(room.roomId)}
            </div>
          </section>
        )}

        {/* --------------------------- seats --------------------------- */}
        <Panel
          title={`Seats (${room.seats.length}/${s.maxPlayers})`}
          action={canEdit && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={addBot}
              disabled={room.seats.length >= s.maxPlayers}
              title={room.seats.length >= s.maxPlayers ? 'The table is full' : undefined}
            >
              Add bot
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
                      {seat.isHost && <span className="chip">Host</span>}
                      {seat.isBot && <span className="chip">Bot - {seat.botLevel}</span>}
                      {seat.playerId === me.playerId && <span className="chip">You</span>}
                      {!seat.connected && <span className="chip" data-tone="bad">Reconnecting</span>}
                    </span>
                  </span>
                  {canEdit && !seat.isHost && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => removeSeat(seat.playerId)}
                      aria-label={`Remove ${seat.name}`}
                    >
                      Remove
                    </button>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
            {Array.from({ length: Math.max(0, Math.min(s.maxPlayers, 8) - room.seats.length) }, (_, i) => (
              <li key={`empty${i}`} className="seat seat--empty">
                <span className="seat__slot" aria-hidden />
                <span className="seat__info"><span className="muted small">Empty seat</span></span>
              </li>
            ))}
          </ul>
        </Panel>

        {/* -------------------------- settings ------------------------- */}
        <section className="card lobby__rules">
          <header className="tabs" role="tablist" aria-label="Room settings">
            {(['seats', 'rules', 'economy', 'pace'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className="tabs__item"
                data-on={tab === t || undefined}
                onClick={() => setTab(t)}
              >
                {{ seats: 'Presets', rules: 'Rules', economy: 'Economy', pace: 'Pace & bots' }[t]}
              </button>
            ))}
          </header>

          <fieldset className="settings" disabled={!canEdit}>
            {!canEdit && (
              <p className="muted small settings__lock">
                Only the host can change the rules. You will see updates live.
              </p>
            )}

            {tab === 'seats' && (
              <div className="presets">
                {PRESETS.map((p) => {
                  const on = matchesPreset(s, p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className="preset"
                      data-on={on || undefined}
                      onClick={() => set({ ...CLASSIC, ...p.patch, seed: s.seed, maxPlayers: s.maxPlayers })}
                    >
                      <span className="preset__name">{p.name}</span>
                      <span className="preset__time num">{p.minutes}</span>
                      <span className="preset__blurb">{p.blurb}</span>
                    </button>
                  );
                })}
                <p className="muted small">
                  {deviations === 0
                    ? 'Currently playing the official rules exactly as printed.'
                    : `${deviations} house rule${deviations === 1 ? '' : 's'} active.`}
                </p>
              </div>
            )}

            {tab === 'rules' && (
              <div className="settings__cols">
                <Toggle
                  label="Auctions on declined purchases"
                  hint="Official. Declining sends the deed to auction instead of leaving it unowned."
                  checked={s.auctionsEnabled}
                  onChange={(v) => set({ auctionsEnabled: v })}
                />
                <Toggle
                  label="Double rent on a full colour set"
                  hint="Official. Only while every deed in the set is unmortgaged."
                  checked={s.doubleRentOnMonopoly}
                  onChange={(v) => set({ doubleRentOnMonopoly: v })}
                />
                <Toggle
                  label="Limited houses and hotels"
                  hint="Official. 32 houses and 12 hotels exist. Running the bank dry is a real tactic."
                  checked={s.buildingShortage}
                  onChange={(v) => set({ buildingShortage: v })}
                />
                <Toggle
                  label="Need the full set to build"
                  hint="Official. Off means you can build on any deed you own."
                  checked={s.requireFullSetToBuild}
                  onChange={(v) => set({ requireFullSetToBuild: v })}
                />
                <Toggle
                  label="Buying allowed while in jail"
                  hint="House rule. Official rules say no purchases from the bank while jailed."
                  checked={s.canBuyInJail}
                  onChange={(v) => set({ canBuyInJail: v })}
                />
                <Toggle
                  label="Must complete a lap before buying"
                  hint="House rule. Slows the opening land-grab right down."
                  checked={s.mustLapBeforeBuying}
                  onChange={(v) => set({ mustLapBeforeBuying: v })}
                />
                <Toggle
                  label="No rent while the owner is in jail"
                  hint="House rule. Makes jail a genuine setback."
                  checked={s.noRentInJail}
                  onChange={(v) => set({ noRentInJail: v })}
                />
                <Toggle
                  label="Trading between players"
                  checked={s.allowTrades}
                  onChange={(v) => set({ allowTrades: v })}
                />
              </div>
            )}

            {tab === 'economy' && (
              <div className="settings__cols">
                <Slider
                  label="Starting cash" min={500} max={5000} step={100}
                  value={s.startingCash} format={fmt}
                  onChange={(v) => set({ startingCash: v })}
                />
                <Slider
                  label="Salary for passing GO" min={0} max={800} step={50}
                  value={s.goSalary} format={fmt}
                  onChange={(v) => set({ goSalary: v })}
                />
                <Slider
                  label="Jail fine" min={0} max={300} step={10}
                  value={s.jailFine} format={fmt}
                  onChange={(v) => set({ jailFine: v })}
                />
                <Slider
                  label="Mortgage interest" min={0} max={30} step={1}
                  value={s.mortgageInterestPct} format={(v) => `${v}%`}
                  onChange={(v) => set({ mortgageInterestPct: v })}
                />
                <Toggle
                  label="Double salary for landing exactly on GO"
                  hint="House rule."
                  checked={s.doubleOnGo}
                  onChange={(v) => set({ doubleOnGo: v })}
                />
                <Toggle
                  label="Free Parking jackpot"
                  hint="House rule. Taxes and fines pile up and go to whoever lands there."
                  checked={s.freeParkingJackpot}
                  onChange={(v) => set({ freeParkingJackpot: v })}
                />
                {s.freeParkingJackpot && (
                  <Slider
                    label="Jackpot starts at" min={0} max={2000} step={100}
                    value={s.freeParkingSeed} format={fmt}
                    onChange={(v) => set({ freeParkingSeed: v })}
                  />
                )}
                <Slider
                  label="Snake eyes bonus" min={0} max={500} step={25}
                  value={s.snakeEyesBonus} format={(v) => (v === 0 ? 'Off' : fmt(v))}
                  onChange={(v) => set({ snakeEyesBonus: v })}
                />
              </div>
            )}

            {tab === 'pace' && (
              <div className="settings__cols">
                <div className="labelled">
                  <span className="switch__label">How the game ends</span>
                  <Segmented
                    label="Win condition"
                    value={s.winCondition}
                    onChange={(v) => set({ winCondition: v })}
                    options={[
                      { value: 'last-standing', label: 'Last standing' },
                      { value: 'turn-limit', label: 'Turn limit' },
                      { value: 'networth', label: 'Net worth' },
                    ]}
                  />
                  <p className="muted small">
                    {{
                      'last-standing': 'The classic marathon. Play until only one player is solvent.',
                      'turn-limit': 'Everyone plays a fixed number of turns; richest wins. Best for one sitting.',
                      networth: 'First to hit the target total value wins outright.',
                    }[s.winCondition]}
                  </p>
                </div>

                {s.winCondition === 'turn-limit' && (
                  <Slider
                    label="Turn limit" min={10} max={200} step={5}
                    value={s.turnLimit} onChange={(v) => set({ turnLimit: v })}
                  />
                )}
                {s.winCondition === 'networth' && (
                  <Slider
                    label="Net worth target" min={2000} max={25000} step={500}
                    value={s.netWorthTarget} format={fmt}
                    onChange={(v) => set({ netWorthTarget: v })}
                  />
                )}

                <Slider
                  label="Table size" min={2} max={8} step={1}
                  value={s.maxPlayers} format={(v) => `${v} players`}
                  onChange={(v) => set({ maxPlayers: v })}
                />
                <Slider
                  label="Turn timer" min={0} max={180} step={5}
                  value={s.turnTimer}
                  format={(v) => (v === 0 ? 'Off' : `${v}s`)}
                  onChange={(v) => set({ turnTimer: v })}
                />
                <Slider
                  label="Auction bid time" min={5} max={60} step={5}
                  value={s.auctionBidSeconds} format={(v) => `${v}s`}
                  onChange={(v) => set({ auctionBidSeconds: v })}
                />
                <Slider
                  label="Animation speed" min={0.5} max={2.5} step={0.1}
                  value={s.animationSpeed} format={(v) => `${v.toFixed(1)}x`}
                  onChange={(v) => set({ animationSpeed: v })}
                />

                <div className="labelled">
                  <span className="switch__label">Bot difficulty</span>
                  <Segmented
                    label="Bot difficulty"
                    value={s.botLevel}
                    onChange={(v) => set({ botLevel: v as BotLevel })}
                    options={[
                      { value: 'easy', label: 'Easy' },
                      { value: 'normal', label: 'Normal' },
                      { value: 'hard', label: 'Hard' },
                    ]}
                  />
                  <p className="muted small">
                    Difficulty changes judgement only. Bots never see hidden information
                    and never get better dice.
                  </p>
                </div>
                <Toggle
                  label="Fill empty seats with bots at start"
                  checked={s.fillWithBots}
                  onChange={(v) => set({ fillWithBots: v })}
                />
              </div>
            )}
          </fieldset>
        </section>
      </div>

      <footer className="lobby__foot">
        <div className="lobby__summary">
          <span className="chip num">{fmt(s.startingCash)} start</span>
          <span className="chip num">{fmt(s.goSalary)} on GO</span>
          <span className="chip">{s.auctionsEnabled ? 'Auctions on' : 'No auctions'}</span>
          <span className="chip">
            {s.winCondition === 'turn-limit' ? `${s.turnLimit} turns`
              : s.winCondition === 'networth' ? `${fmt(s.netWorthTarget)} target`
                : 'Last standing'}
          </span>
        </div>
        <div className="spacer" />
        {canEdit ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={startGame}
            disabled={!enoughPlayers}
            title={enoughPlayers ? undefined : 'You need at least two players, or turn on bot fill'}
          >
            Start the game
          </button>
        ) : (
          <span className="muted small">Waiting for the host to start...</span>
        )}
      </footer>
    </div>
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
