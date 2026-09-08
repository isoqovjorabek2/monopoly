import { BOARD, GROUPS } from './board';
import { rand } from './rng';
import {
  countRailroads, hasUnmortgagedMonopoly, legalActions, netWorth, ownedBy, ownsFullGroup,
} from './rules';
import type { BotLevel, ColorGroup, GameAction, GameState } from './types';

/* ------------------------------------------------------------------ *
 * Bots choose from legalActions() and nothing else. They read only
 * what a human at the table can see, and difficulty changes judgement
 * quality - never legality, never information.
 * ------------------------------------------------------------------ */

/** Relative landing frequency per square over a long game (jail exits and
 *  the Chance/Chest movement cards skew this a long way from uniform).
 *  Orange and red are the real estate that wins games. */
const LANDING_WEIGHT: Record<ColorGroup, number> = {
  brown: 0.72,
  lightblue: 1.02,
  pink: 1.08,
  orange: 1.30,
  red: 1.24,
  yellow: 1.10,
  green: 1.02,
  darkblue: 0.86,
};

const TEMP: Record<BotLevel, number> = { easy: 1.15, normal: 0.45, hard: 0.12 };

/** Cash a bot wants to keep in hand, scaled by how dangerous the board is. */
function cashFloor(s: GameState, pid: string, level: BotLevel): number {
  let worstRent = 0;
  for (const id of Object.keys(s.properties).map(Number)) {
    const st = s.properties[id];
    if (!st.owner || st.owner === pid || st.mortgaged) continue;
    const space = BOARD[id];
    if (space.rent) worstRent = Math.max(worstRent, space.rent[st.houses]);
  }
  const base = { easy: 60, normal: 160, hard: 260 }[level];
  return base + worstRent * (level === 'hard' ? 0.9 : 0.5);
}

/** How much this deed is worth to this player right now. */
function strategicValue(s: GameState, pid: string, spaceId: number): number {
  const space = BOARD[spaceId];
  const price = space.price ?? 0;
  let v = price;

  if (space.kind === 'railroad') {
    const owned = countRailroads(s, pid);
    v *= 1 + owned * 0.35;
    return v;
  }
  if (space.kind === 'utility') return price * 0.55;

  if (space.group) {
    const group = GROUPS[space.group];
    v *= LANDING_WEIGHT[space.group];

    const mine = group.filter((id) => s.properties[id].owner === pid).length;
    const unowned = group.filter((id) => !s.properties[id].owner).length;
    if (mine === group.length - 1) v *= 2.4;        // completes the set
    else if (mine > 0) v *= 1.5;

    // Denying an opponent who is one deed short is worth real money.
    for (const other of s.seats) {
      if (other === pid || s.players[other].bankrupt) continue;
      const theirs = group.filter((id) => s.properties[id].owner === other).length;
      if (theirs === group.length - 1 && unowned > 0) v *= 1.8;
    }
  }
  return v;
}

function scoreAction(s: GameState, pid: string, a: GameAction, level: BotLevel): number {
  const me = s.players[pid];
  const floor = cashFloor(s, pid, level);

  switch (a.type) {
    case 'ROLL':
      return 100;

    case 'DISMISS_CARD':
      return 200;

    case 'END_TURN':
      return 1;

    case 'BUY_PROPERTY': {
      const price = BOARD[me.position].price ?? 0;
      const value = strategicValue(s, pid, me.position);
      const after = me.cash - price;
      // Early on, buy almost everything: board control compounds.
      const earlyBias = me.lapsCompleted < 2 ? 1.35 : 1;
      let sc = (value / Math.max(price, 1)) * 60 * earlyBias;
      if (after < floor) sc -= (floor - after) * 0.35;
      if (after < 0) return -1000;
      return sc;
    }

    case 'DECLINE_PROPERTY':
      return 22;

    case 'BID': {
      const value = strategicValue(s, pid, s.auction?.spaceId ?? 0);
      const ceiling = value * ({ easy: 0.7, normal: 0.95, hard: 1.15 }[level]);
      const affordable = me.cash - floor * 0.5;
      if (a.amount > ceiling || a.amount > affordable) return -50;
      return 40 + (ceiling - a.amount) / 10;
    }

    case 'PASS_BID':
      return 20;

    case 'BUILD_HOUSE': {
      const space = BOARD[a.spaceId];
      const cost = space.houseCost ?? 0;
      const st = s.properties[a.spaceId];
      if (me.cash - cost < floor) return -20;
      // Rent per dollar spent peaks going from two houses to three.
      const tierBonus = [1, 1.15, 1.55, 1.25, 1.0][st.houses] ?? 1;
      const weight = space.group ? LANDING_WEIGHT[space.group] : 1;
      return 55 * tierBonus * weight;
    }

    case 'SELL_HOUSE':
      // Only ever as a last resort - handled by the must_raise branch below.
      return s.phase === 'must_raise' ? 30 : -100;

    case 'MORTGAGE':
      return s.phase === 'must_raise' ? 45 : -100;

    case 'UNMORTGAGE': {
      const space = BOARD[a.spaceId];
      const cost = Math.ceil((space.mortgage ?? 0) * 1.1);
      if (me.cash - cost < floor * 1.4) return -30;
      const completes = space.group && ownsFullGroup(s, pid, space.group);
      return completes ? 48 : 18;
    }

    case 'PAY_JAIL_FINE': {
      // Early game you want to be moving; late game jail is a free hotel dodge.
      const early = s.turnNumber < 24;
      if (me.cash < floor) return -10;
      return early ? 70 : 15;
    }

    case 'USE_JAIL_CARD':
      return s.turnNumber < 24 ? 85 : 20;

    case 'DECLARE_BANKRUPTCY':
      return -500;

    case 'ACCEPT_TRADE': {
      const t = s.trades.find((x) => x.id === a.tradeId);
      if (!t) return -100;
      const gain =
        t.giveProperties.reduce((n, id) => n + strategicValue(s, pid, id), 0)
        + t.giveCash
        - t.wantProperties.reduce((n, id) => n + strategicValue(s, pid, id), 0)
        - t.wantCash;
      const demand = { easy: 0, normal: 40, hard: 120 }[level];
      return gain > demand ? 90 : -60;
    }

    case 'DECLINE_TRADE':
      return 25;

    default:
      return 0;
  }
}

/** Softmax sample, seeded off the game's own PRNG so bots are replayable. */
function pick(scored: { a: GameAction; score: number }[], temp: number, seed: number, cursor: number): GameAction {
  if (scored.length === 1) return scored[0].a;
  const max = Math.max(...scored.map((x) => x.score));
  const weights = scored.map((x) => Math.exp((x.score - max) / Math.max(temp * 40, 1e-6)));
  const total = weights.reduce((n, w) => n + w, 0);
  let r = rand(seed, cursor) * total;
  for (let i = 0; i < scored.length; i++) {
    r -= weights[i];
    if (r <= 0) return scored[i].a;
  }
  return scored[scored.length - 1].a;
}

/**
 * Decide one action for a bot. Returns null when the bot has nothing to do
 * (which is normal - it is usually someone else's turn).
 */
export function botDecide(s: GameState, pid: string): GameAction | null {
  const me = s.players[pid];
  if (!me || !me.isBot || me.bankrupt) return null;

  let options = legalActions(s, pid);
  if (options.length === 0) return null;

  const level = me.botLevel;

  /* --- raising money is a sequence, not a preference --- */
  if (s.phase === 'must_raise' && s.debt?.from === pid) {
    const need = s.debt.amount - me.cash;
    const mortgages = options.filter((a) => a.type === 'MORTGAGE');
    const sells = options.filter((a) => a.type === 'SELL_HOUSE');
    // Mortgage the least useful deed first, then break buildings, then fold.
    if (mortgages.length > 0) {
      mortgages.sort(
        (x, y) => strategicValue(s, pid, (x as { spaceId: number }).spaceId)
          - strategicValue(s, pid, (y as { spaceId: number }).spaceId),
      );
      return mortgages[0];
    }
    if (sells.length > 0) return sells[0];
    if (need > 0) return { type: 'DECLARE_BANKRUPTCY', playerId: pid };
  }

  // Off-turn a bot only reacts to offers - it does not idly restructure its
  // portfolio. Auctions and debts are the exception: those genuinely need an
  // answer from a player whose turn it is not, and filtering them out here
  // deadlocks the whole table.
  const isCurrent = s.seats[s.seatIndex] === pid;
  if (!isCurrent && (s.phase === 'preroll' || s.phase === 'turn_end')) {
    options = options.filter((a) => a.type === 'ACCEPT_TRADE' || a.type === 'DECLINE_TRADE');
    if (options.length === 0) return null;
  }

  // Bids are offered by legalActions at the minimum increment only; let the
  // bot consider a couple of realistic raises too.
  if (s.phase === 'auction' && s.auction) {
    const base = s.auction.currentBid;
    const extra: GameAction[] = [];
    for (const step of [10, 30, 60]) {
      const amount = base + step;
      if (amount <= me.cash) extra.push({ type: 'BID', playerId: pid, amount });
    }
    options = [...options.filter((a) => a.type !== 'BID'), ...extra];
  }

  const scored = options.map((a) => ({ a, score: scoreAction(s, pid, a, level) }));
  const best = Math.max(...scored.map((x) => x.score));
  // Never sample from actions that are clearly self-destructive.
  const viable = scored.filter((x) => x.score > Math.min(best - 120, -40));
  return pick(viable.length > 0 ? viable : scored, TEMP[level], s.settings.seed, s.rngCursor + s.version);
}

/** A short, human-readable justification for the log. */
export function botCommentary(s: GameState, pid: string, a: GameAction): string | null {
  const name = s.players[pid].name;
  switch (a.type) {
    case 'BUY_PROPERTY': {
      const space = BOARD[s.players[pid].position];
      if (space.group && ownsFullGroup(s, pid, space.group)) return `${name} completed the ${space.group} set`;
      return null;
    }
    case 'BUILD_HOUSE': {
      const space = BOARD[a.spaceId];
      if (space.group && hasUnmortgagedMonopoly(s, pid, space.group)) return null;
      return null;
    }
    case 'DECLARE_BANKRUPTCY':
      return `${name} is out with $${netWorth(s, pid)} on the table`;
    default:
      return null;
  }
}

/** Human-feeling delay before a bot acts, in milliseconds. */
export function botDelay(s: GameState, pid: string): number {
  const base = s.phase === 'auction' ? 900 : 700;
  const jitter = rand(s.settings.seed, s.rngCursor + s.version + 7) * 600;
  const owned = ownedBy(s, pid).length;
  return (base + jitter + Math.min(owned * 20, 200)) / Math.max(s.settings.animationSpeed, 0.25);
}
