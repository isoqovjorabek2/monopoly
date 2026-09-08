import {
  BOARD, BOARD_SIZE, GROUPS, JAIL_POSITION,
  OWNABLE_IDS, RAILROAD_IDS, UTILITY_IDS,
} from './board';
import { CHANCE, CHEST, cardById } from './cards';
import { rollDice, shuffle } from './rng';
import {
  buildingSellValue, calculateRent, canBuildHouse, canMortgage, canSellHouse,
  canUnmortgage, currentPlayerId, isLegal, maxRaisable, netWorth, ownedBy,
  unmortgageCost,
} from './rules';
import type {
  Card, GameAction, GameEvent, GameSettings, GameState, Player,
  PropertyState, Reduction, TradeOffer,
} from './types';

/* ------------------------------------------------------------------ *
 * The reducer. Pure: no Date.now(), no Math.random(), no mutation of
 * the argument. reduce(state, action) -> { state, events }.
 * ------------------------------------------------------------------ */

export interface SeatSpec {
  id: string;
  name: string;
  token: Player['token'];
  color: string;
  isBot: boolean;
  botLevel?: Player['botLevel'];
}

export function createGame(settings: GameSettings, seats: SeatSpec[]): GameState {
  const players: Record<string, Player> = {};
  for (const s of seats) {
    players[s.id] = {
      id: s.id,
      name: s.name,
      token: s.token,
      color: s.color,
      cash: settings.startingCash,
      position: 0,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      isBot: s.isBot,
      botLevel: s.botLevel ?? settings.botLevel,
      connected: true,
      lapsCompleted: 0,
    };
  }

  const properties: Record<number, PropertyState> = {};
  for (const id of OWNABLE_IDS) properties[id] = { owner: null, houses: 0, mortgaged: false };

  return {
    version: 0,
    phase: 'lobby',
    settings,
    players,
    seats: seats.map((s) => s.id),
    seatIndex: 0,
    properties,
    rngCursor: 0,
    chanceOrder: shuffle(CHANCE.map((c) => c.id), settings.seed, 1000),
    chestOrder: shuffle(CHEST.map((c) => c.id), settings.seed, 2000),
    chanceCursor: 0,
    chestCursor: 0,
    dice: null,
    doublesCount: 0,
    jailedThisTurn: false,
    pendingUtilityMultiplier: null,
    resolved: true,
    housesRemaining: 32,
    hotelsRemaining: 12,
    freeParkingPot: settings.freeParkingJackpot ? settings.freeParkingSeed : 0,
    auction: null,
    debt: null,
    trades: [],
    activeCard: null,
    turnNumber: 0,
    winnerId: null,
    startedAt: 0,
  };
}

/** Structural clone. State is plain JSON by construction, so this is safe
 *  and it guarantees the reducer never mutates its argument. */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function reduce(prev: GameState, action: GameAction): Reduction {
  const events: GameEvent[] = [];

  if (prev.phase === 'game_over') return { state: prev, events };
  if (!isLegal(prev, action)) return { state: prev, events };

  const s = clone(prev);
  s.version = prev.version + 1;

  switch (action.type) {
    case 'START_GAME':      startGame(s, events); break;
    case 'ROLL':            doRoll(s, events); break;
    case 'BUY_PROPERTY':    doBuy(s, events, action.playerId); break;
    case 'DECLINE_PROPERTY':doDecline(s, events, action.playerId); break;
    case 'BID':             doBid(s, events, action.playerId, action.amount); break;
    case 'PASS_BID':        doPassBid(s, events, action.playerId); break;
    case 'BUILD_HOUSE':     doBuild(s, events, action.playerId, action.spaceId); break;
    case 'SELL_HOUSE':      doSellHouse(s, events, action.playerId, action.spaceId); break;
    case 'MORTGAGE':        doMortgage(s, events, action.playerId, action.spaceId); break;
    case 'UNMORTGAGE':      doUnmortgage(s, events, action.playerId, action.spaceId); break;
    case 'PAY_JAIL_FINE':   doPayFine(s, events, action.playerId); break;
    case 'USE_JAIL_CARD':   doUseJailCard(s, events, action.playerId); break;
    case 'DECLARE_BANKRUPTCY': doBankrupt(s, events, action.playerId, s.debt?.to ?? null); break;
    case 'PROPOSE_TRADE':   doProposeTrade(s, events, action.offer); break;
    case 'ACCEPT_TRADE':    doAcceptTrade(s, events, action.playerId, action.tradeId); break;
    case 'DECLINE_TRADE':   doDeclineTrade(s, events, action.playerId, action.tradeId); break;
    case 'END_TURN':        doEndTurn(s, events); break;
    case 'DISMISS_CARD':    s.activeCard = null; break;
  }

  // Any action that raised enough cash settles an outstanding debt.
  if (s.phase === 'must_raise' && s.debt && s.players[s.debt.from].cash >= s.debt.amount) {
    settleDebt(s, events);
  }

  checkWinCondition(s, events);
  return { state: s, events };
}

/* ------------------------------- flow ------------------------------ */

function startGame(s: GameState, events: GameEvent[]): void {
  s.phase = 'preroll';
  s.turnNumber = 1;
  s.startedAt = 0;
  events.push({ type: 'GAME_STARTED' });
  events.push({ type: 'TURN_STARTED', playerId: currentPlayerId(s), turnNumber: 1 });
}

function doRoll(s: GameState, events: GameEvent[]): void {
  const pid = currentPlayerId(s);
  const me = s.players[pid];

  const r = rollDice(s.settings.seed, s.rngCursor);
  s.rngCursor = r.cursor;
  s.dice = r.dice;
  s.resolved = false;
  s.activeCard = null;
  const [d1, d2] = r.dice;
  const isDouble = d1 === d2;
  const total = d1 + d2;
  events.push({ type: 'DICE_ROLLED', playerId: pid, dice: r.dice, isDouble });

  /* --- rolling from inside the cell --- */
  if (me.inJail) {
    if (isDouble) {
      me.inJail = false;
      me.jailTurns = 0;
      events.push({ type: 'LEFT_JAIL', playerId: pid, how: 'rolled doubles' });
      // Doubles out of jail move you, but do NOT grant another turn.
      movePlayer(s, events, pid, total, false);
      resolveLanding(s, events, pid, total);
      finishResolution(s, events, false);
      return;
    }
    me.jailTurns += 1;
    if (me.jailTurns >= s.settings.maxJailTurns) {
      // Third failure: pay the fine (liquidating if necessary) and move.
      chargePlayer(s, events, pid, s.settings.jailFine, 'jail fine', null);
      me.inJail = false;
      me.jailTurns = 0;
      events.push({ type: 'LEFT_JAIL', playerId: pid, how: 'paid the fine' });
      if (s.phase !== 'must_raise') {
        movePlayer(s, events, pid, total, false);
        resolveLanding(s, events, pid, total);
        finishResolution(s, events, false);
      }
      return;
    }
    s.resolved = true;
    s.phase = 'turn_end';
    return;
  }

  /* --- three doubles in a row is a trip to jail, and the move never happens --- */
  if (isDouble) {
    s.doublesCount += 1;
    if (s.doublesCount >= 3) {
      sendToJail(s, events, pid, 'rolled three doubles');
      s.resolved = true;
      finishResolution(s, events, false);
      return;
    }
  } else {
    s.doublesCount = 0;
  }

  if (s.settings.snakeEyesBonus > 0 && d1 === 1 && d2 === 1) {
    credit(s, events, pid, s.settings.snakeEyesBonus, 'snake eyes bonus');
  }

  movePlayer(s, events, pid, total, false);
  resolveLanding(s, events, pid, total);
  finishResolution(s, events, isDouble);
}

/** Decide where the turn goes once the landing square is fully resolved. */
function finishResolution(s: GameState, _events: GameEvent[], grantAnotherRoll: boolean): void {
  if (s.phase === 'awaiting_buy' || s.phase === 'auction' || s.phase === 'must_raise') return;
  s.resolved = true;
  if (grantAnotherRoll && !s.jailedThisTurn && !s.players[currentPlayerId(s)].bankrupt) {
    s.phase = 'preroll';
    return;
  }
  s.phase = 'turn_end';
}

function doEndTurn(s: GameState, events: GameEvent[]): void {
  s.doublesCount = 0;
  s.jailedThisTurn = false;
  s.dice = null;
  s.activeCard = null;
  s.pendingUtilityMultiplier = null;

  const alive = s.seats.filter((id) => !s.players[id].bankrupt);
  if (alive.length <= 1) { checkWinCondition(s, events); return; }

  let guard = 0;
  do {
    s.seatIndex = (s.seatIndex + 1) % s.seats.length;
    guard += 1;
  } while (s.players[s.seats[s.seatIndex]].bankrupt && guard <= s.seats.length);

  s.turnNumber += 1;
  const pid = currentPlayerId(s);
  s.phase = s.players[pid].inJail ? 'jailed_choice' : 'preroll';
  events.push({ type: 'TURN_STARTED', playerId: pid, turnNumber: s.turnNumber });
}

/* ----------------------------- movement ---------------------------- */

function movePlayer(
  s: GameState, events: GameEvent[], pid: string, steps: number, direct: boolean,
): void {
  const me = s.players[pid];
  const from = me.position;
  const to = ((from + steps) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
  me.position = to;
  events.push({ type: 'MOVED', playerId: pid, from, to, steps, direct });

  // Passing GO is a property of moving forward past index 0 - never of a
  // backwards move, and never of a jump that the card says does not pay.
  if (steps > 0 && from + steps >= BOARD_SIZE) {
    me.lapsCompleted += 1;
    const landedExactlyOnGo = to === 0;
    const amount = s.settings.goSalary * (landedExactlyOnGo && s.settings.doubleOnGo ? 2 : 1);
    credit(s, events, pid, amount, 'passing GO');
    events.push({ type: 'PASSED_GO', playerId: pid, amount });
  }
}

/** Jump straight to a square (cards). Pays GO only if the card says so. */
function teleport(
  s: GameState, events: GameEvent[], pid: string, to: number, passGoPays: boolean,
): void {
  const me = s.players[pid];
  const from = me.position;
  const forwardSteps = ((to - from) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
  me.position = to;
  events.push({ type: 'MOVED', playerId: pid, from, to, steps: forwardSteps, direct: true });
  if (passGoPays && to !== from && from + forwardSteps >= BOARD_SIZE) {
    me.lapsCompleted += 1;
    credit(s, events, pid, s.settings.goSalary, 'passing GO');
    events.push({ type: 'PASSED_GO', playerId: pid, amount: s.settings.goSalary });
  }
}

function sendToJail(s: GameState, events: GameEvent[], pid: string, reason: string): void {
  const me = s.players[pid];
  me.position = JAIL_POSITION;
  me.inJail = true;
  me.jailTurns = 0;
  s.jailedThisTurn = true;
  s.doublesCount = 0;
  events.push({ type: 'JAILED', playerId: pid, reason });
}

/* --------------------------- landing logic -------------------------- */

function resolveLanding(
  s: GameState, events: GameEvent[], pid: string, diceTotal: number,
): void {
  const me = s.players[pid];
  const space = BOARD[me.position];

  switch (space.kind) {
    case 'property':
    case 'railroad':
    case 'utility': {
      const st = s.properties[me.position];
      if (!st.owner) {
        s.phase = 'awaiting_buy';
        return;
      }
      if (st.owner === pid) return;
      const rent = calculateRent(s, me.position, diceTotal, {
        forceUtilityMultiplier: s.pendingUtilityMultiplier,
      });
      s.pendingUtilityMultiplier = null;
      if (rent > 0) {
        chargePlayer(s, events, pid, rent, `rent on ${space.name}`, st.owner);
        events.push({ type: 'RENT_PAID', from: pid, to: st.owner, amount: rent, spaceId: me.position });
      }
      return;
    }

    case 'tax': {
      const amount = space.taxAmount ?? 0;
      chargePlayer(s, events, pid, amount, space.name, null);
      events.push({ type: 'TAX_PAID', playerId: pid, amount, label: space.name });
      if (s.settings.freeParkingJackpot) s.freeParkingPot += amount;
      return;
    }

    case 'gotojail':
      sendToJail(s, events, pid, 'landed on Go To Jail');
      return;

    case 'freeparking':
      if (s.settings.freeParkingJackpot && s.freeParkingPot > 0) {
        const amount = s.freeParkingPot;
        s.freeParkingPot = 0;
        credit(s, events, pid, amount, 'the Free Parking pot');
        events.push({ type: 'FREE_PARKING', playerId: pid, amount });
      }
      return;

    case 'chance':
    case 'chest':
      drawAndApply(s, events, pid, space.kind === 'chance' ? 'chance' : 'chest', diceTotal);
      return;

    default:
      return;
  }
}

/* ------------------------------- cards ------------------------------ */

function drawAndApply(
  s: GameState, events: GameEvent[], pid: string,
  deck: 'chance' | 'chest', diceTotal: number,
): void {
  const isChance = deck === 'chance';
  const order = isChance ? s.chanceOrder : s.chestOrder;
  if (order.length === 0) return;
  const idx = (isChance ? s.chanceCursor : s.chestCursor) % order.length;
  const card = cardById(order[idx]);

  if (card.effect.kind === 'getOutFree') {
    // Retained by the player, so it leaves the deck until it is used.
    order.splice(idx, 1);
  } else {
    const next = (idx + 1) % order.length;
    if (isChance) s.chanceCursor = next; else s.chestCursor = next;
  }

  s.activeCard = card;
  events.push({ type: 'CARD_DRAWN', playerId: pid, card });
  applyCard(s, events, pid, card, diceTotal);
}

function applyCard(
  s: GameState, events: GameEvent[], pid: string, card: Card, diceTotal: number,
): void {
  const me = s.players[pid];
  const e = card.effect;

  switch (e.kind) {
    case 'money':
      if (e.amount >= 0) credit(s, events, pid, e.amount, card.text);
      else {
        chargePlayer(s, events, pid, -e.amount, card.text, null);
        if (s.settings.freeParkingJackpot) s.freeParkingPot += -e.amount;
      }
      return;

    case 'moneyFromEach': {
      for (const other of s.seats) {
        if (other === pid || s.players[other].bankrupt) continue;
        chargePlayer(s, events, other, e.amount, 'birthday gift', pid);
      }
      return;
    }

    case 'moneyToEach': {
      const others = s.seats.filter((id) => id !== pid && !s.players[id].bankrupt);
      const total = others.length * e.amount;
      // Raise the whole sum first, so a short payer cannot leave half the
      // table unpaid while a single debt sits against one of them.
      if (me.cash < total) autoLiquidate(s, events, pid, total);
      for (const other of others) {
        if (s.players[pid].bankrupt) break;
        chargePlayer(s, events, pid, e.amount, card.text, other);
      }
      return;
    }

    case 'repairs': {
      let owed = 0;
      for (const id of ownedBy(s, pid)) {
        const st = s.properties[id];
        if (st.houses === 5) owed += e.perHotel;
        else owed += st.houses * e.perHouse;
      }
      if (owed > 0) {
        chargePlayer(s, events, pid, owed, card.text, null);
        if (s.settings.freeParkingJackpot) s.freeParkingPot += owed;
      }
      return;
    }

    case 'getOutFree':
      me.getOutOfJailCards += 1;
      return;

    case 'jail':
      sendToJail(s, events, pid, card.text);
      return;

    case 'move':
      teleport(s, events, pid, e.to, e.passGoPays);
      resolveLanding(s, events, pid, diceTotal);
      return;

    case 'moveRelative': {
      // "Go back 3 spaces" never pays GO, even going backwards past it.
      const to = ((me.position + e.delta) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
      const from = me.position;
      me.position = to;
      events.push({ type: 'MOVED', playerId: pid, from, to, steps: e.delta, direct: false });
      resolveLanding(s, events, pid, diceTotal);
      return;
    }

    case 'nearest': {
      const targets: readonly number[] = e.target === 'railroad' ? RAILROAD_IDS : UTILITY_IDS;
      let best = targets[0];
      let bestDist = BOARD_SIZE + 1;
      for (const t of targets) {
        const d = ((t - me.position) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
        const dist = d === 0 ? BOARD_SIZE : d;
        if (dist < bestDist) { bestDist = dist; best = t; }
      }
      teleport(s, events, pid, best, true);

      const st = s.properties[best];
      if (!st.owner) { s.phase = 'awaiting_buy'; return; }
      if (st.owner === pid) return;

      // The utility card charges 10x the roll regardless of how many the
      // owner holds; the railroad card charges double the normal rent.
      const rent = e.target === 'utility'
        ? calculateRent(s, best, diceTotal, { forceUtilityMultiplier: 10 })
        : calculateRent(s, best, diceTotal, { railroadMultiplier: 2 });
      if (rent > 0) {
        chargePlayer(s, events, pid, rent, `rent on ${BOARD[best].name}`, st.owner);
        events.push({ type: 'RENT_PAID', from: pid, to: st.owner, amount: rent, spaceId: best });
      }
      return;
    }
  }
}

/* ------------------------------- money ------------------------------ */

function credit(s: GameState, events: GameEvent[], pid: string, amount: number, reason: string): void {
  if (amount === 0) return;
  s.players[pid].cash += amount;
  events.push({ type: 'MONEY', playerId: pid, delta: amount, reason });
}

/**
 * Take money from a player. The current player gets agency (must_raise);
 * anyone else is auto-liquidated so the turn never blocks on someone
 * whose turn it is not.
 */
function chargePlayer(
  s: GameState, events: GameEvent[], pid: string,
  amount: number, reason: string, creditorId: string | null,
): void {
  if (amount <= 0) return;
  const me = s.players[pid];

  if (me.cash >= amount) {
    me.cash -= amount;
    events.push({ type: 'MONEY', playerId: pid, delta: -amount, reason });
    if (creditorId) credit(s, events, creditorId, amount, `from ${me.name}`);
    return;
  }

  if (pid === currentPlayerId(s)) {
    s.debt = { from: pid, to: creditorId, amount, reason };
    s.phase = 'must_raise';
    events.push({ type: 'DEBT_INCURRED', playerId: pid, amount, reason });
    return;
  }

  autoLiquidate(s, events, pid, amount);
  if (s.players[pid].cash >= amount) {
    me.cash -= amount;
    events.push({ type: 'MONEY', playerId: pid, delta: -amount, reason });
    if (creditorId) credit(s, events, creditorId, amount, `from ${me.name}`);
  } else {
    if (creditorId) credit(s, events, creditorId, me.cash, `from ${me.name}`);
    me.cash = 0;
    doBankrupt(s, events, pid, creditorId);
  }
}

/** Sell buildings then mortgage, cheapest-impact first, until solvent. */
function autoLiquidate(s: GameState, events: GameEvent[], pid: string, target: number): void {
  const owned = ownedBy(s, pid);
  // Buildings first, highest-count first so the even-build rule stays satisfied.
  let guard = 0;
  while (s.players[pid].cash < target && guard++ < 200) {
    const sellable = owned.filter((id) => canSellHouse(s, pid, id).ok);
    if (sellable.length === 0) break;
    sellable.sort((a, b) => s.properties[b].houses - s.properties[a].houses);
    applySellHouse(s, events, pid, sellable[0]);
  }
  guard = 0;
  while (s.players[pid].cash < target && guard++ < 200) {
    const mortgageable = owned.filter((id) => canMortgage(s, pid, id).ok);
    if (mortgageable.length === 0) break;
    mortgageable.sort((a, b) => (BOARD[a].mortgage ?? 0) - (BOARD[b].mortgage ?? 0));
    applyMortgage(s, events, pid, mortgageable[0]);
  }
}

function settleDebt(s: GameState, events: GameEvent[]): void {
  const d = s.debt;
  if (!d) return;
  const me = s.players[d.from];
  me.cash -= d.amount;
  events.push({ type: 'MONEY', playerId: d.from, delta: -d.amount, reason: d.reason });
  if (d.to) credit(s, events, d.to, d.amount, `from ${me.name}`);
  else if (s.settings.freeParkingJackpot) s.freeParkingPot += d.amount;
  s.debt = null;
  s.phase = 'resolving';
  finishResolution(s, events, s.doublesCount > 0);
}

/* ---------------------------- transactions -------------------------- */

function doBuy(s: GameState, events: GameEvent[], pid: string): void {
  const me = s.players[pid];
  const spaceId = me.position;
  const price = BOARD[spaceId].price ?? 0;
  me.cash -= price;
  s.properties[spaceId].owner = pid;
  events.push({ type: 'BOUGHT', playerId: pid, spaceId, price });
  events.push({ type: 'MONEY', playerId: pid, delta: -price, reason: `bought ${BOARD[spaceId].name}` });
  s.phase = 'resolving';
  finishResolution(s, events, s.doublesCount > 0);
}

function doDecline(s: GameState, events: GameEvent[], pid: string): void {
  const spaceId = s.players[pid].position;
  if (!s.settings.auctionsEnabled) {
    s.phase = 'resolving';
    finishResolution(s, events, s.doublesCount > 0);
    return;
  }
  const bidders = s.seats.filter((id) => !s.players[id].bankrupt);
  if (bidders.length === 0) {
    s.phase = 'resolving';
    finishResolution(s, events, s.doublesCount > 0);
    return;
  }
  s.auction = {
    spaceId,
    currentBid: 0,
    highBidder: null,
    active: bidders,
    turn: 0,
    origin: 'declined',
  };
  s.phase = 'auction';
  events.push({ type: 'AUCTION_STARTED', spaceId });
}

function doBid(s: GameState, events: GameEvent[], pid: string, amount: number): void {
  const a = s.auction;
  if (!a) return;
  a.currentBid = amount;
  a.highBidder = pid;
  events.push({ type: 'AUCTION_BID', playerId: pid, amount });
  closeAuctionIfDone(s, events);
}

function doPassBid(s: GameState, events: GameEvent[], pid: string): void {
  const a = s.auction;
  if (!a) return;
  a.active = a.active.filter((id) => id !== pid);
  events.push({ type: 'AUCTION_PASSED', playerId: pid });
  closeAuctionIfDone(s, events);
}

function closeAuctionIfDone(s: GameState, events: GameEvent[]): void {
  const a = s.auction;
  if (!a) return;
  // Still open while two or more can raise, or while the sole remaining
  // bidder has not yet actually bid.
  if (a.active.length > 1) return;
  if (a.active.length === 1 && a.highBidder !== a.active[0]) return;

  if (a.highBidder && a.currentBid > 0) {
    const winner = s.players[a.highBidder];
    winner.cash -= a.currentBid;
    s.properties[a.spaceId].owner = a.highBidder;
    events.push({ type: 'AUCTION_WON', playerId: a.highBidder, spaceId: a.spaceId, amount: a.currentBid });
    events.push({ type: 'MONEY', playerId: a.highBidder, delta: -a.currentBid, reason: `won ${BOARD[a.spaceId].name} at auction` });
  } else {
    events.push({ type: 'AUCTION_NOBODY', spaceId: a.spaceId });
  }

  s.auction = null;
  s.phase = 'resolving';
  finishResolution(s, events, s.doublesCount > 0);
}

function doBuild(s: GameState, events: GameEvent[], pid: string, spaceId: number): void {
  if (!canBuildHouse(s, pid, spaceId).ok) return;
  const cost = BOARD[spaceId].houseCost ?? 0;
  const st = s.properties[spaceId];
  s.players[pid].cash -= cost;
  if (st.houses === 4) {
    st.houses = 5;
    s.hotelsRemaining -= 1;
    s.housesRemaining += 4; // the four houses go back in the box
  } else {
    st.houses += 1;
    s.housesRemaining -= 1;
  }
  events.push({ type: 'BUILT', playerId: pid, spaceId, houses: st.houses });
  events.push({ type: 'MONEY', playerId: pid, delta: -cost, reason: `built on ${BOARD[spaceId].name}` });
}

function applySellHouse(s: GameState, events: GameEvent[], pid: string, spaceId: number): void {
  const st = s.properties[spaceId];
  const refund = buildingSellValue(spaceId);
  if (st.houses === 5) {
    st.houses = 4;
    s.hotelsRemaining += 1;
    s.housesRemaining -= 4;
    s.players[pid].cash += refund * 5;
    events.push({ type: 'MONEY', playerId: pid, delta: refund * 5, reason: `sold hotel on ${BOARD[spaceId].name}` });
  } else {
    st.houses -= 1;
    s.housesRemaining += 1;
    s.players[pid].cash += refund;
    events.push({ type: 'MONEY', playerId: pid, delta: refund, reason: `sold house on ${BOARD[spaceId].name}` });
  }
  events.push({ type: 'SOLD_BUILDING', playerId: pid, spaceId, houses: st.houses });
}

function doSellHouse(s: GameState, events: GameEvent[], pid: string, spaceId: number): void {
  if (!canSellHouse(s, pid, spaceId).ok) return;
  applySellHouse(s, events, pid, spaceId);
}

function applyMortgage(s: GameState, events: GameEvent[], pid: string, spaceId: number): void {
  const amount = BOARD[spaceId].mortgage ?? 0;
  s.properties[spaceId].mortgaged = true;
  s.players[pid].cash += amount;
  events.push({ type: 'MORTGAGED', playerId: pid, spaceId, amount });
  events.push({ type: 'MONEY', playerId: pid, delta: amount, reason: `mortgaged ${BOARD[spaceId].name}` });
}

function doMortgage(s: GameState, events: GameEvent[], pid: string, spaceId: number): void {
  if (!canMortgage(s, pid, spaceId).ok) return;
  applyMortgage(s, events, pid, spaceId);
}

function doUnmortgage(s: GameState, events: GameEvent[], pid: string, spaceId: number): void {
  if (!canUnmortgage(s, pid, spaceId).ok) return;
  const cost = unmortgageCost(s, spaceId);
  s.properties[spaceId].mortgaged = false;
  s.players[pid].cash -= cost;
  events.push({ type: 'UNMORTGAGED', playerId: pid, spaceId, amount: cost });
  events.push({ type: 'MONEY', playerId: pid, delta: -cost, reason: `lifted mortgage on ${BOARD[spaceId].name}` });
}

/* -------------------------------- jail ------------------------------ */

function doPayFine(s: GameState, events: GameEvent[], pid: string): void {
  const me = s.players[pid];
  me.cash -= s.settings.jailFine;
  me.inJail = false;
  me.jailTurns = 0;
  events.push({ type: 'MONEY', playerId: pid, delta: -s.settings.jailFine, reason: 'jail fine' });
  events.push({ type: 'LEFT_JAIL', playerId: pid, how: 'paid the fine' });
  if (s.settings.freeParkingJackpot) s.freeParkingPot += s.settings.jailFine;
  s.phase = 'preroll';
}

function doUseJailCard(s: GameState, events: GameEvent[], pid: string): void {
  const me = s.players[pid];
  me.getOutOfJailCards -= 1;
  me.inJail = false;
  me.jailTurns = 0;
  // The card goes back to the bottom of its deck.
  s.chanceOrder.push('ch08');
  events.push({ type: 'LEFT_JAIL', playerId: pid, how: 'used a Get Out of Jail Free card' });
  s.phase = 'preroll';
}

/* ------------------------------- trades ----------------------------- */

function tradeIsValid(s: GameState, o: Omit<TradeOffer, 'id' | 'createdAt'>): boolean {
  const from = s.players[o.from];
  const to = s.players[o.to];
  if (!from || !to || from.bankrupt || to.bankrupt || o.from === o.to) return false;
  if (o.giveCash < 0 || o.wantCash < 0) return false;
  if (from.cash < o.giveCash || to.cash < o.wantCash) return false;
  if (from.getOutOfJailCards < o.giveJailCards || to.getOutOfJailCards < o.wantJailCards) return false;

  const check = (ids: number[], ownerId: string) => ids.every((id) => {
    const st = s.properties[id];
    if (!st || st.owner !== ownerId) return false;
    // Buildings must be sold before a deed can change hands.
    const g = BOARD[id].group;
    if (g && GROUPS[g].some((x) => s.properties[x].houses > 0)) return false;
    return true;
  });
  return check(o.giveProperties, o.from) && check(o.wantProperties, o.to);
}

function doProposeTrade(
  s: GameState, events: GameEvent[], o: Omit<TradeOffer, 'id' | 'createdAt'>,
): void {
  if (!tradeIsValid(s, o)) return;
  const offer: TradeOffer = {
    ...o,
    id: `t${s.version}-${o.from}-${o.to}`,
    createdAt: s.turnNumber,
  };
  s.trades = s.trades.filter((t) => !(t.from === o.from && t.to === o.to));
  s.trades.push(offer);
  events.push({ type: 'TRADE_PROPOSED', offer });
}

function doAcceptTrade(s: GameState, events: GameEvent[], pid: string, tradeId: string): void {
  const offer = s.trades.find((t) => t.id === tradeId);
  if (!offer || offer.to !== pid) return;
  // Re-validate at acceptance: the world moved since the offer was made.
  if (!tradeIsValid(s, offer)) {
    s.trades = s.trades.filter((t) => t.id !== tradeId);
    return;
  }

  const from = s.players[offer.from];
  const to = s.players[offer.to];
  from.cash += offer.wantCash - offer.giveCash;
  to.cash += offer.giveCash - offer.wantCash;
  from.getOutOfJailCards += offer.wantJailCards - offer.giveJailCards;
  to.getOutOfJailCards += offer.giveJailCards - offer.wantJailCards;
  for (const id of offer.giveProperties) s.properties[id].owner = offer.to;
  for (const id of offer.wantProperties) s.properties[id].owner = offer.from;

  s.trades = s.trades.filter(
    (t) => t.id !== tradeId
      && ![t.from, t.to].some((p) => p === offer.from || p === offer.to),
  );
  events.push({ type: 'TRADE_ACCEPTED', offer });
}

function doDeclineTrade(s: GameState, events: GameEvent[], pid: string, tradeId: string): void {
  const offer = s.trades.find((t) => t.id === tradeId);
  if (!offer || offer.to !== pid) return;
  s.trades = s.trades.filter((t) => t.id !== tradeId);
  events.push({ type: 'TRADE_DECLINED', offer });
}

/* ----------------------------- bankruptcy --------------------------- */

function doBankrupt(
  s: GameState, events: GameEvent[], pid: string, creditorId: string | null,
): void {
  const me = s.players[pid];
  const owned = ownedBy(s, pid);

  if (creditorId && s.players[creditorId] && !s.players[creditorId].bankrupt) {
    // Everything transfers, mortgages and all.
    credit(s, events, creditorId, me.cash, `from ${me.name}'s estate`);
    for (const id of owned) {
      const st = s.properties[id];
      // Buildings are returned to the bank at half value, paid to the creditor.
      if (st.houses > 0) {
        const refund = st.houses * buildingSellValue(id);
        if (st.houses === 5) { s.hotelsRemaining += 1; }
        else { s.housesRemaining += st.houses; }
        st.houses = 0;
        credit(s, events, creditorId, refund, 'liquidated buildings');
      }
      st.owner = creditorId;
    }
    s.players[creditorId].getOutOfJailCards += me.getOutOfJailCards;
  } else {
    // To the bank: the deeds go back on the market, unimproved and unmortgaged.
    for (const id of owned) {
      const st = s.properties[id];
      if (st.houses === 5) s.hotelsRemaining += 1;
      else s.housesRemaining += st.houses;
      st.owner = null;
      st.houses = 0;
      st.mortgaged = false;
    }
  }

  me.cash = 0;
  me.getOutOfJailCards = 0;
  me.bankrupt = true;
  me.inJail = false;
  s.debt = null;
  s.trades = s.trades.filter((t) => t.from !== pid && t.to !== pid);
  if (s.auction) s.auction.active = s.auction.active.filter((id) => id !== pid);
  events.push({ type: 'BANKRUPT', playerId: pid, creditorId });

  if (s.auction) closeAuctionIfDone(s, events);

  if (currentPlayerId(s) === pid) {
    // The bankrupt player can no longer act, so the turn has to move on
    // by itself or the whole game stalls waiting for them.
    s.doublesCount = 0;
    s.jailedThisTurn = false;
    doEndTurn(s, events);
  }
}

/* ---------------------------- win condition ------------------------- */

function checkWinCondition(s: GameState, events: GameEvent[]): void {
  if (s.phase === 'lobby' || s.phase === 'game_over') return;
  const alive = s.seats.filter((id) => !s.players[id].bankrupt);

  if (alive.length <= 1) {
    s.winnerId = alive[0] ?? null;
    s.phase = 'game_over';
    events.push({ type: 'GAME_OVER', winnerId: s.winnerId });
    return;
  }

  if (s.settings.winCondition === 'turn-limit' && s.turnNumber > s.settings.turnLimit) {
    s.winnerId = leaderByNetWorth(s, alive);
    s.phase = 'game_over';
    events.push({ type: 'GAME_OVER', winnerId: s.winnerId });
    return;
  }

  if (s.settings.winCondition === 'networth') {
    const reached = alive.filter((id) => netWorth(s, id) >= s.settings.netWorthTarget);
    if (reached.length > 0) {
      s.winnerId = leaderByNetWorth(s, reached);
      s.phase = 'game_over';
      events.push({ type: 'GAME_OVER', winnerId: s.winnerId });
    }
  }
}

function leaderByNetWorth(s: GameState, ids: string[]): string | null {
  let best: string | null = null;
  let bestVal = -Infinity;
  for (const id of ids) {
    const v = netWorth(s, id);
    if (v > bestVal) { bestVal = v; best = id; }
  }
  return best;
}

/* ------------------------- exported helpers ------------------------- */

export { netWorth, maxRaisable, currentPlayerId };
