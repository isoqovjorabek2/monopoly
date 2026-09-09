import {
  BOARD, GROUPS, RAILROAD_IDS, RAILROAD_RENT, UTILITY_IDS,
  OWNABLE_IDS,
} from './board';
import type { GameAction, GameState, Player, Space, TradeBody } from './types';

/* ------------------------------------------------------------------ *
 * Pure queries. Nothing here mutates. The reducer, the UI and the bots
 * all read from this file so there is exactly one definition of what
 * is legal and what things cost.
 * ------------------------------------------------------------------ */

export const currentPlayerId = (s: GameState): string => s.seats[s.seatIndex];
export const currentPlayer = (s: GameState): Player => s.players[currentPlayerId(s)];

export const ownedBy = (s: GameState, playerId: string): number[] =>
  OWNABLE_IDS.filter((id) => s.properties[id]?.owner === playerId);

export const activePlayers = (s: GameState): Player[] =>
  s.seats.map((id) => s.players[id]).filter((p) => p && !p.bankrupt);

/** True when one player owns every deed in the colour group. */
export function ownsFullGroup(s: GameState, playerId: string, group: keyof typeof GROUPS): boolean {
  return GROUPS[group].every((id) => s.properties[id]?.owner === playerId);
}

/** A monopoly only pays double while every deed in the set is unmortgaged. */
export function hasUnmortgagedMonopoly(s: GameState, playerId: string, group: keyof typeof GROUPS): boolean {
  return GROUPS[group].every(
    (id) => s.properties[id]?.owner === playerId && !s.properties[id].mortgaged,
  );
}

export const countRailroads = (s: GameState, playerId: string): number =>
  RAILROAD_IDS.filter((id) => s.properties[id]?.owner === playerId).length;

export const countUtilities = (s: GameState, playerId: string): number =>
  UTILITY_IDS.filter((id) => s.properties[id]?.owner === playerId).length;

/**
 * Rent owed for landing on `spaceId`.
 * `diceTotal` is only consulted for utilities.
 * `forceUtilityMultiplier` implements the Chance card that charges 10x
 * regardless of how many utilities the owner holds.
 * `railroadMultiplier` implements the Chance card that charges double.
 */
export function calculateRent(
  s: GameState,
  spaceId: number,
  diceTotal: number,
  opts: { forceUtilityMultiplier?: number | null; railroadMultiplier?: number } = {},
): number {
  const space = BOARD[spaceId];
  const st = s.properties[spaceId];
  if (!st || !st.owner || st.mortgaged) return 0;

  const owner = s.players[st.owner];
  if (!owner || owner.bankrupt) return 0;
  // House rule: an owner sitting in jail collects nothing.
  if (s.settings.noRentInJail && owner.inJail) return 0;

  if (space.kind === 'railroad') {
    const n = countRailroads(s, st.owner);
    return RAILROAD_RENT[n] * (opts.railroadMultiplier ?? 1);
  }

  if (space.kind === 'utility') {
    const forced = opts.forceUtilityMultiplier;
    if (forced != null) return diceTotal * forced;
    return diceTotal * (countUtilities(s, st.owner) === 2 ? 10 : 4);
  }

  if (space.kind === 'property' && space.rent && space.group) {
    if (st.houses > 0) return space.rent[st.houses];
    const doubled =
      s.settings.doubleRentOnMonopoly && hasUnmortgagedMonopoly(s, st.owner, space.group);
    return space.rent[0] * (doubled ? 2 : 1);
  }

  return 0;
}

export const unmortgageCost = (s: GameState, spaceId: number): number =>
  Math.ceil((BOARD[spaceId].mortgage ?? 0) * (1 + s.settings.mortgageInterestPct / 100));

/** Half the house cost, as printed on the deed. */
export const buildingSellValue = (spaceId: number): number =>
  Math.floor((BOARD[spaceId].houseCost ?? 0) / 2);

/* ---------------------------- building ---------------------------- */

export interface BuildCheck { ok: boolean; reason?: string }

export function canBuildHouse(s: GameState, playerId: string, spaceId: number): BuildCheck {
  const space = BOARD[spaceId];
  const st = s.properties[spaceId];
  if (space.kind !== 'property' || !space.group) return { ok: false, reason: 'Not a buildable property' };
  if (!st || st.owner !== playerId) return { ok: false, reason: 'You do not own this' };
  if (st.mortgaged) return { ok: false, reason: 'Mortgaged - lift the mortgage first' };
  if (st.houses >= 5) return { ok: false, reason: 'Already has a hotel' };

  const group = GROUPS[space.group];
  if (s.settings.requireFullSetToBuild && !ownsFullGroup(s, playerId, space.group))
    return { ok: false, reason: 'You need the full colour set' };
  if (group.some((id) => s.properties[id].mortgaged))
    return { ok: false, reason: 'Another property in the set is mortgaged' };

  // Even build: never more than one house above the lowest in the set.
  const lowest = Math.min(...group.map((id) => s.properties[id].houses));
  if (st.houses > lowest) return { ok: false, reason: 'Build evenly across the set first' };

  if (s.settings.buildingShortage) {
    // A hotel returns its four houses to the bank, so it only needs a hotel.
    if (st.houses === 4) {
      if (s.hotelsRemaining < 1) return { ok: false, reason: 'The bank has no hotels left' };
    } else if (s.housesRemaining < 1) {
      return { ok: false, reason: 'The bank has no houses left' };
    }
  }

  const cost = space.houseCost ?? 0;
  if (s.players[playerId].cash < cost) return { ok: false, reason: `You need $${cost}` };
  return { ok: true };
}

export function canSellHouse(s: GameState, playerId: string, spaceId: number): BuildCheck {
  const space = BOARD[spaceId];
  const st = s.properties[spaceId];
  if (space.kind !== 'property' || !space.group) return { ok: false, reason: 'Not a property' };
  if (!st || st.owner !== playerId) return { ok: false, reason: 'You do not own this' };
  if (st.houses <= 0) return { ok: false, reason: 'Nothing built here' };

  const group = GROUPS[space.group];
  const highest = Math.max(...group.map((id) => s.properties[id].houses));
  if (st.houses < highest) return { ok: false, reason: 'Sell evenly across the set' };

  // Breaking a hotel needs four houses back from the bank.
  if (s.settings.buildingShortage && st.houses === 5 && s.housesRemaining < 4)
    return { ok: false, reason: 'Not enough houses in the bank to break the hotel' };
  return { ok: true };
}

export function canMortgage(s: GameState, playerId: string, spaceId: number): BuildCheck {
  const st = s.properties[spaceId];
  if (!st || st.owner !== playerId) return { ok: false, reason: 'You do not own this' };
  if (st.mortgaged) return { ok: false, reason: 'Already mortgaged' };
  const space = BOARD[spaceId];
  if (space.group) {
    const anyBuilt = GROUPS[space.group].some((id) => s.properties[id].houses > 0);
    if (anyBuilt) return { ok: false, reason: 'Sell the buildings on this set first' };
  }
  return { ok: true };
}

export function canUnmortgage(s: GameState, playerId: string, spaceId: number): BuildCheck {
  const st = s.properties[spaceId];
  if (!st || st.owner !== playerId) return { ok: false, reason: 'You do not own this' };
  if (!st.mortgaged) return { ok: false, reason: 'Not mortgaged' };
  const cost = unmortgageCost(s, spaceId);
  if (s.players[playerId].cash < cost) return { ok: false, reason: `You need $${cost}` };
  return { ok: true };
}

/* ---------------------------- solvency ---------------------------- */

/** Everything a player could turn into cash without trading. */
export function maxRaisable(s: GameState, playerId: string): number {
  let total = s.players[playerId].cash;
  for (const id of ownedBy(s, playerId)) {
    const st = s.properties[id];
    if (st.houses > 0) total += st.houses * buildingSellValue(id);
    if (!st.mortgaged) total += BOARD[id].mortgage ?? 0;
  }
  return total;
}

/** Cash + resale value of everything held. Used for standings and endgame. */
export function netWorth(s: GameState, playerId: string): number {
  let total = s.players[playerId].cash;
  for (const id of ownedBy(s, playerId)) {
    const st = s.properties[id];
    total += st.mortgaged ? (BOARD[id].mortgage ?? 0) : (BOARD[id].price ?? 0);
    total += st.houses * buildingSellValue(id);
  }
  return total;
}

export function canAffordAnything(s: GameState, playerId: string, amount: number): boolean {
  return maxRaisable(s, playerId) >= amount;
}

/* --------------------------- legal actions ------------------------ *
 * The one authority. The UI enables buttons from this, the bots pick
 * from this, and the reducer re-checks against it before applying.
 * ------------------------------------------------------------------ */

export function legalActions(s: GameState, playerId: string): GameAction[] {
  const out: GameAction[] = [];
  const me = s.players[playerId];
  if (!me || me.bankrupt || s.phase === 'game_over' || s.phase === 'lobby') return out;

  const isCurrent = currentPlayerId(s) === playerId;

  /* --- auction: open to every solvent player, including the decliner --- */
  if (s.phase === 'auction' && s.auction) {
    if (s.auction.active.includes(playerId)) {
      const next = s.auction.currentBid + 10;
      if (me.cash >= next) out.push({ type: 'BID', playerId, amount: next });
      out.push({ type: 'PASS_BID', playerId });
    }
    return out;
  }

  /* --- settling a debt: only ways to raise money are legal --- */
  if (s.phase === 'must_raise' && s.debt?.from === playerId) {
    pushAssetActions(s, playerId, out, { allowUnmortgage: false, allowBuild: false });
    out.push({ type: 'DECLARE_BANKRUPTCY', playerId });
    return out;
  }

  /* --- a drawn card can be dismissed at any point by whoever drew it --- */
  if (s.activeCard && isCurrent) out.push({ type: 'DISMISS_CARD', playerId });

  /* --- trades can be answered at any time by the recipient --- */
  if (s.settings.allowTrades) {
    for (const t of s.trades) {
      if (t.to === playerId) {
        out.push({ type: 'ACCEPT_TRADE', playerId, tradeId: t.id });
        out.push({ type: 'DECLINE_TRADE', playerId, tradeId: t.id });
      }
    }
  }

  /* --- off-turn: manage your portfolio, that's all --- */
  if (!isCurrent) {
    if (s.phase === 'preroll' || s.phase === 'turn_end') {
      pushAssetActions(s, playerId, out, { allowUnmortgage: true, allowBuild: true });
    }
    return out;
  }

  /* --- your turn --- */
  switch (s.phase) {
    case 'jailed_choice':
      if (me.getOutOfJailCards > 0) out.push({ type: 'USE_JAIL_CARD', playerId });
      if (me.cash >= s.settings.jailFine) out.push({ type: 'PAY_JAIL_FINE', playerId });
      out.push({ type: 'ROLL', playerId });
      pushAssetActions(s, playerId, out, { allowUnmortgage: true, allowBuild: true });
      break;

    case 'preroll':
      out.push({ type: 'ROLL', playerId });
      pushAssetActions(s, playerId, out, { allowUnmortgage: true, allowBuild: true });
      break;

    case 'awaiting_buy': {
      const space = BOARD[me.position];
      const price = space.price ?? 0;
      const blockedByLap = s.settings.mustLapBeforeBuying && me.lapsCompleted < 1;
      const blockedByJail = !s.settings.canBuyInJail && me.inJail;
      if (me.cash >= price && !blockedByLap && !blockedByJail) {
        out.push({ type: 'BUY_PROPERTY', playerId });
      }
      out.push({ type: 'DECLINE_PROPERTY', playerId });
      break;
    }

    case 'turn_end':
      out.push({ type: 'END_TURN', playerId });
      pushAssetActions(s, playerId, out, { allowUnmortgage: true, allowBuild: true });
      break;

    default:
      break;
  }

  return out;
}

function pushAssetActions(
  s: GameState,
  playerId: string,
  out: GameAction[],
  o: { allowUnmortgage: boolean; allowBuild: boolean },
): void {
  for (const id of ownedBy(s, playerId)) {
    if (o.allowBuild && canBuildHouse(s, playerId, id).ok)
      out.push({ type: 'BUILD_HOUSE', playerId, spaceId: id });
    if (canSellHouse(s, playerId, id).ok)
      out.push({ type: 'SELL_HOUSE', playerId, spaceId: id });
    if (canMortgage(s, playerId, id).ok)
      out.push({ type: 'MORTGAGE', playerId, spaceId: id });
    if (o.allowUnmortgage && canUnmortgage(s, playerId, id).ok)
      out.push({ type: 'UNMORTGAGE', playerId, spaceId: id });
  }
}

/** Key for `state.tradeCooldowns`. Directional: A refusing B says nothing
 *  about whether B would refuse A. */
export const tradeKey = (from: string, to: string): string => `${from}>${to}`;

/**
 * Everything that has to hold for an offer to be transferable: both sides
 * present and solvent, every deed actually owned by the side offering it,
 * and no buildings standing anywhere in a traded deed's colour group.
 *
 * The reducer checks this when an offer is made and again when it is
 * accepted, because the board moves in between. The bots check it before
 * proposing, so a bot can never burn its turn on an offer the engine will
 * silently drop.
 */
export function canTrade(s: GameState, o: TradeBody): boolean {
  const from = s.players[o.from];
  const to = s.players[o.to];
  if (!from || !to || from.bankrupt || to.bankrupt || o.from === o.to) return false;
  if (!Number.isInteger(o.giveCash) || !Number.isInteger(o.wantCash)) return false;
  if (o.giveCash < 0 || o.wantCash < 0) return false;
  if (from.cash < o.giveCash || to.cash < o.wantCash) return false;
  if (o.giveJailCards < 0 || o.wantJailCards < 0) return false;
  if (from.getOutOfJailCards < o.giveJailCards || to.getOutOfJailCards < o.wantJailCards) return false;

  const check = (ids: number[], ownerId: string) => ids.every((id) => {
    const st = s.properties[id];
    if (!st || st.owner !== ownerId) return false;
    // Buildings must come off before a deed can change hands.
    const g = BOARD[id].group;
    if (g && GROUPS[g].some((x) => s.properties[x].houses > 0)) return false;
    return true;
  });
  return check(o.giveProperties, o.from) && check(o.wantProperties, o.to);
}

/** Cheap membership test used by the reducer to reject spoofed intents. */
export function isLegal(s: GameState, action: GameAction): boolean {
  // Trades are validated in depth by the reducer; proposing is always allowed
  // for a solvent player when trading is on.
  if (action.type === 'PROPOSE_TRADE') {
    return s.settings.allowTrades && !s.players[action.playerId]?.bankrupt;
  }
  if (action.type === 'START_GAME') return s.phase === 'lobby';

  const legal = legalActions(s, action.playerId);
  return legal.some((a) => {
    if (a.type !== action.type) return false;
    if ('spaceId' in a && 'spaceId' in action) return a.spaceId === action.spaceId;
    if ('tradeId' in a && 'tradeId' in action) return a.tradeId === action.tradeId;
    // Bids: legalActions only offers the minimum, but any affordable higher
    // bid is legal too.
    if (a.type === 'BID' && action.type === 'BID') {
      const bid = action.amount;
      return (
        Number.isInteger(bid) &&
        bid > (s.auction?.currentBid ?? 0) &&
        bid <= s.players[action.playerId].cash
      );
    }
    return true;
  });
}

/* ---------------------------- presentation ------------------------ */

export function spaceLabel(space: Space): string {
  return space.short;
}

export function ownerOf(s: GameState, spaceId: number): Player | null {
  const o = s.properties[spaceId]?.owner;
  return o ? s.players[o] ?? null : null;
}
