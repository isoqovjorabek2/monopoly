import {
  BOARD, BOARD_SIZE, GROUPS, JAIL_POSITION,
  OWNABLE_IDS, RAILROAD_IDS, UTILITY_IDS,
} from './board';
import { CHANCE, CHEST, cardById } from './cards';
import {
  activePass, beneficiary, cleanTerms, contractsOf, sharesOn, sideId,
} from './deals';
import { rollDice, shuffle } from './rng';
import {
  autopilotAction, buildingSellValue, calculateRent, canBuildHouse, canMortgage,
  canSellHouse, canTrade, canUnmortgage, currentPlayerId, isLegal, maxRaisable,
  netWorth, ownedBy, tradeKey, transferFee, unmortgageCost, waitingOn,
} from './rules';
import type {
  Card, Contract, ContractEnd, GameAction, GameEvent, GameSettings, GameState, Player,
  PropertyState, Reduction, RentCut, TradeBody, TradeOffer,
} from './types';

/** Turns an unanswered offer stays on the table before it lapses. */
const TRADE_TTL = 6;

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
    auctionQueue: [],
    debt: null,
    trades: [],
    tradeCooldowns: {},
    contracts: [],
    activeCard: null,
    turnNumber: 0,
    round: 0,
    history: [],
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
  if (action.type === 'TIME_OUT') return timeOut(prev, action.playerId);
  if (!isLegal(prev, action)) return { state: prev, events };

  const s = clone(prev);
  s.version = prev.version + 1;
  // A save from before Deal Maker existed has no ledger at all.
  if (!s.contracts) s.contracts = [];

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
    case 'DECLARE_BANKRUPTCY': declareBankruptcy(s, events, action.playerId); break;
    case 'PROPOSE_TRADE':   doProposeTrade(s, events, action.offer); break;
    case 'ACCEPT_TRADE':    doAcceptTrade(s, events, action.playerId, action.tradeId); break;
    case 'DECLINE_TRADE':   doDeclineTrade(s, events, action.playerId, action.tradeId); break;
    case 'END_TURN':        doEndTurn(s, events); break;
    case 'DISMISS_CARD':    s.activeCard = null; break;
    case 'REPAY_LOAN':      doRepayLoan(s, events, action.playerId, action.contractId); break;
    case 'RELEASE_CONTRACT':doReleaseContract(s, events, action.playerId, action.contractId); break;
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
  s.round = 1;
  recordHistory(s);
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
      if (s.phase === 'must_raise') {
        // Short of the fine: the roll is still owed its move, made once the
        // money is raised (settleDebt) - or never, if they fold.
        if (s.debt) s.debt.resume = 'move';
        return;
      }
      movePlayer(s, events, pid, total, false);
      resolveLanding(s, events, pid, total);
      finishResolution(s, events, false);
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

  const from = s.seatIndex;
  let guard = 0;
  do {
    s.seatIndex = (s.seatIndex + 1) % s.seats.length;
    guard += 1;
  } while (s.players[s.seats[s.seatIndex]].bankrupt && guard <= s.seats.length);

  s.turnNumber += 1;
  // Coming back round the table starts a new round - the unit a turn limit
  // counts in, so that every player gets the same number of turns.
  if (s.seatIndex <= from) {
    s.round += 1;
    recordHistory(s);
    expireShares(s, events);
  }
  expireTrades(s, events);
  // A turn limit ends the game here, before anyone starts a turn past it.
  checkWinCondition(s, events);
  if (s.phase === 'game_over') return;
  const pid = currentPlayerId(s);
  events.push({ type: 'TURN_STARTED', playerId: pid, turnNumber: s.turnNumber });
  // A bankrupt estate's deeds are about to be auctioned. Loans wait for the
  // auctions to finish, which begin this turn over again.
  if (s.auctionQueue.length > 0) {
    s.phase = s.players[pid].inJail ? 'jailed_choice' : 'preroll';
    return;
  }
  beginTurn(s, events);
}

/** Put the current player at the start of their turn - and, in Deal Maker,
 *  collect any loan of theirs that has fallen due before they roll. */
function beginTurn(s: GameState, events: GameEvent[]): void {
  const pid = currentPlayerId(s);
  s.phase = s.players[pid].inJail ? 'jailed_choice' : 'preroll';
  collectDueLoans(s, events, pid);
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
    credit(s, events, pid, amount, 'passing Start');
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
    credit(s, events, pid, s.settings.goSalary, 'passing Start');
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
      payRent(s, events, pid, me.position, rent, st.owner);
      return;
    }

    case 'tax': {
      const amount = space.taxAmount ?? 0;
      chargePlayer(s, events, pid, amount, space.name, null);
      events.push({ type: 'TAX_PAID', playerId: pid, amount, label: space.name });
      return;
    }

    case 'gotojail':
      sendToJail(s, events, pid, 'ordered to the Zindan');
      return;

    case 'freeparking':
      if (s.settings.freeParkingJackpot && s.freeParkingPot > 0) {
        const amount = s.freeParkingPot;
        s.freeParkingPot = 0;
        credit(s, events, pid, amount, 'the Caravanserai pot');
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
      else chargePlayer(s, events, pid, -e.amount, card.text, null);
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
      if (total <= 0) return;
      if (me.cash >= total) {
        for (const other of others) chargePlayer(s, events, pid, e.amount, card.text, other);
        return;
      }
      // Short: one debt for the whole sum, owed to everyone in equal shares.
      // Charging them one at a time let each failed payment overwrite the
      // last, so only the final player was ever owed anything.
      s.debt = { from: pid, to: null, amount: total, reason: card.text, split: others };
      s.phase = 'must_raise';
      events.push({ type: 'DEBT_INCURRED', playerId: pid, amount: total, reason: card.text });
      return;
    }

    case 'repairs': {
      let owed = 0;
      for (const id of ownedBy(s, pid)) {
        const st = s.properties[id];
        if (st.houses === 5) owed += e.perHotel;
        else owed += st.houses * e.perHouse;
      }
      if (owed > 0) chargePlayer(s, events, pid, owed, card.text, null);
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

      // The utility card charges ten times a fresh throw of the dice, however
      // many utilities the owner holds; the railroad card charges double.
      let rent: number;
      if (e.target === 'utility') {
        const r = rollDice(s.settings.seed, s.rngCursor);
        s.rngCursor = r.cursor;
        s.dice = r.dice;
        // A throw for the card, not a move: it never counts as doubles.
        events.push({ type: 'DICE_ROLLED', playerId: pid, dice: r.dice, isDouble: false });
        rent = calculateRent(s, best, r.dice[0] + r.dice[1], { forceUtilityMultiplier: 10 });
      } else {
        rent = calculateRent(s, best, diceTotal, { railroadMultiplier: 2 });
      }
      payRent(s, events, pid, best, rent, st.owner);
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
 *
 * `cuts` are Deal Maker revenue shares: parts of the amount that reach a
 * shareholder instead of the creditor. They travel with a debt, so rent
 * raised by mortgaging is split exactly as rent paid on the spot would be.
 */
function chargePlayer(
  s: GameState, events: GameEvent[], pid: string,
  amount: number, reason: string, creditorId: string | null, cuts?: RentCut[],
): void {
  if (amount <= 0) return;
  const me = s.players[pid];

  if (me.cash >= amount) {
    me.cash -= amount;
    events.push({ type: 'MONEY', playerId: pid, delta: -amount, reason });
    payOut(s, events, me.name, creditorId, amount, cuts);
    return;
  }

  if (pid === currentPlayerId(s)) {
    s.debt = { from: pid, to: creditorId, amount, reason };
    if (cuts && cuts.length > 0 && creditorId) s.debt.cuts = cuts;
    s.phase = 'must_raise';
    events.push({ type: 'DEBT_INCURRED', playerId: pid, amount, reason });
    return;
  }

  autoLiquidate(s, events, pid, amount);
  if (s.players[pid].cash >= amount) {
    me.cash -= amount;
    events.push({ type: 'MONEY', playerId: pid, delta: -amount, reason });
    payOut(s, events, me.name, creditorId, amount, cuts);
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

/** Hand a paid amount to its creditor, less any shareholder cuts, or to the
 *  bank when there is no creditor. */
function payOut(
  s: GameState, events: GameEvent[], payerName: string,
  creditorId: string | null, amount: number, cuts?: RentCut[],
): void {
  if (!creditorId) { paidToBank(s, amount); return; }
  let rest = amount;
  for (const cut of cuts ?? []) {
    const holder = s.players[cut.to];
    const take = Math.min(cut.amount, rest);
    // A shareholder who has since gone bust leaves their slice with the owner.
    if (!holder || holder.bankrupt || take <= 0) continue;
    rest -= take;
    credit(s, events, cut.to, take, 'revenue share');
    events.push({ type: 'SHARE_PAID', from: creditorId, to: cut.to, amount: take, spaceId: cut.spaceId });
  }
  credit(s, events, creditorId, rest, `from ${payerName}`);
}

/**
 * Rent, as Deal Maker contracts reshape it. A pass the payer holds shaves
 * the bill first and uses itself up; revenue shares then take their slices
 * of whatever is actually paid. With no contracts on the table this is
 * exactly the classic charge.
 */
function payRent(
  s: GameState, events: GameEvent[], pid: string,
  spaceId: number, rent: number, ownerId: string,
): void {
  if (rent <= 0) return;
  let due = rent;

  const pass = activePass(s, pid, spaceId);
  if (pass) {
    const saved = Math.floor((due * pass.discountPct) / 100);
    due -= saved;
    pass.usesLeft -= 1;
    events.push({
      type: 'PASS_USED', playerId: pid, ownerId, spaceId, saved, usesLeft: pass.usesLeft,
    });
    if (pass.usesLeft <= 0) endContract(s, events, pass.id, 'used');
  }
  if (due <= 0) return;

  const cuts: RentCut[] = sharesOn(s, spaceId)
    .filter((c) => c.holder !== ownerId)
    .map((c) => ({ to: c.holder, amount: Math.floor((due * c.pct) / 100), spaceId }))
    .filter((c) => c.amount > 0);

  chargePlayer(s, events, pid, due, `rent on ${BOARD[spaceId].name}`, ownerId, cuts);
  events.push({ type: 'RENT_PAID', from: pid, to: ownerId, amount: due, spaceId });
}

/** Money paid to the bank. Under the Free Parking house rule it piles up on
 *  the square instead - counted here, once, when it is actually paid. */
function paidToBank(s: GameState, amount: number): void {
  if (s.settings.freeParkingJackpot) s.freeParkingPot += amount;
}

function settleDebt(s: GameState, events: GameEvent[]): void {
  const d = s.debt;
  if (!d) return;
  const me = s.players[d.from];
  me.cash -= d.amount;
  events.push({ type: 'MONEY', playerId: d.from, delta: -d.amount, reason: d.reason });
  if (d.split) {
    // Whole by construction: the debt is the per-player sum times the count.
    const share = d.amount / d.split.length;
    for (const id of d.split) credit(s, events, id, share, `from ${me.name}`);
  } else {
    payOut(s, events, me.name, d.to, d.amount, d.cuts);
  }
  s.debt = null;
  s.phase = 'resolving';

  if (d.resume === 'turn') {
    // A loan that fell due as the turn began: the turn itself is still to
    // come - and so, perhaps, is another loan.
    if (d.to) {
      events.push({ type: 'LOAN_REPAID', borrower: d.from, lender: d.to, amount: d.amount, early: false });
    }
    beginTurn(s, events);
    return;
  }

  if (d.resume === 'move' && s.dice) {
    const total = s.dice[0] + s.dice[1];
    movePlayer(s, events, d.from, total, false);
    resolveLanding(s, events, d.from, total);
    finishResolution(s, events, false);
    return;
  }
  finishResolution(s, events, s.doublesCount > 0);
}

function declareBankruptcy(s: GameState, events: GameEvent[], pid: string): void {
  /* Declaring bankruptcy is a surrender to the bank, not a settlement with
   * whoever is owed: the whole estate - cash, deeds, buildings, contracts -
   * goes back to the bank, which auctions the deeds on, and no creditor is
   * paid from it. Only a charge that busts a player outright still pays the
   * creditor (see chargePlayer). */
  doBankrupt(s, events, pid, null);
}

/**
 * A player whose clock ran out, or who has left the table, has their
 * pending decisions made for them - the least committal legal move each
 * time - until the table stops waiting on them. The host only says when;
 * the engine decides what it means, so every client logs the same thing.
 */
function timeOut(prev: GameState, pid: string): Reduction {
  if (!waitingOn(prev).includes(pid)) return { state: prev, events: [] };
  let state = prev;
  const events: GameEvent[] = [{ type: 'TIMED_OUT', playerId: pid }];
  for (let guard = 0; guard < 100 && waitingOn(state).includes(pid); guard++) {
    const a = autopilotAction(state, pid);
    if (!a) break;
    const r = reduce(state, a);
    if (r.state.version === state.version) break;
    state = r.state;
    events.push(...r.events);
  }
  if (state === prev) return { state: prev, events: [] };
  return { state, events };
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
  // The card that brought them here is finished with. Left up, it would sit
  // over the auction and hide the bid controls from the whole table.
  s.activeCard = null;
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

  const origin = a.origin;
  s.auction = null;
  if (origin === 'bankruptcy') {
    // A bankrupt estate's deeds go one after another; then the turn that was
    // just starting when the bank took them picks up where it was.
    if (startQueuedAuction(s, events)) return;
    beginTurn(s, events);
    return;
  }
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
  if (st.houses === 5 && s.settings.buildingShortage && s.housesRemaining < 4) {
    sellSetDown(s, events, pid, spaceId);
    return;
  }
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

/**
 * Breaking a hotel takes four houses back from the bank. When the bank is
 * short, the printed rule is that the hotel is sold down to what the bank
 * can supply - and the rest of the set comes down with it, so the set stays
 * even. Picks the highest level the bank can still furnish; level 0 always
 * can be, since it takes no houses at all.
 */
function sellSetDown(s: GameState, events: GameEvent[], pid: string, spaceId: number): void {
  const group = GROUPS[BOARD[spaceId].group!];
  const target = (h: number, level: number): number => (h === 5 ? level : Math.min(h, level));
  const need = (level: number): number =>
    group.reduce((n, id) => {
      const h = s.properties[id].houses;
      return n + (h === 5 ? level : target(h, level) - h);
    }, 0);
  let level = 4;
  while (level > 0 && need(level) > s.housesRemaining) level -= 1;

  s.housesRemaining -= need(level);
  for (const id of group) {
    const st = s.properties[id];
    const next = target(st.houses, level);
    const sold = st.houses - next; // a hotel counts as five
    if (sold <= 0) continue;
    if (st.houses === 5) s.hotelsRemaining += 1;
    st.houses = next;
    const amount = sold * buildingSellValue(id);
    s.players[pid].cash += amount;
    events.push({ type: 'MONEY', playerId: pid, delta: amount, reason: `sold buildings on ${BOARD[id].name}` });
    events.push({ type: 'SOLD_BUILDING', playerId: pid, spaceId: id, houses: next });
  }
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
  paidToBank(s, s.settings.jailFine);
  s.phase = 'preroll';
}

function doUseJailCard(s: GameState, events: GameEvent[], pid: string): void {
  const me = s.players[pid];
  me.getOutOfJailCards -= 1;
  me.inJail = false;
  me.jailTurns = 0;
  returnJailCard(s);
  events.push({ type: 'LEFT_JAIL', playerId: pid, how: 'used a Royal Pardon card' });
  s.phase = 'preroll';
}

/**
 * A Get Out of Jail Free card that is used, or surrendered to the bank, goes
 * to the bottom of whichever deck is missing its copy. The two cards are
 * identical, so which one a player happened to draw needs no remembering.
 */
function returnJailCard(s: GameState): void {
  if (!s.chanceOrder.includes('ch08')) s.chanceCursor = toBottom(s.chanceOrder, s.chanceCursor, 'ch08');
  else if (!s.chestOrder.includes('cc05')) s.chestCursor = toBottom(s.chestOrder, s.chestCursor, 'cc05');
}

/** A deck is read round from its cursor, so its bottom is the slot just
 *  before it. Returns the cursor, moved past the inserted card. */
function toBottom(order: string[], cursor: number, id: string): number {
  const at = order.length === 0 ? 0 : cursor % order.length;
  order.splice(at, 0, id);
  return at + 1;
}

/* ------------------------------- trades ----------------------------- */

/** An offer nobody answered lapses at a turn boundary. Without this a
 *  proposal left hanging pins its author out of trading for good: the
 *  recipient keeps a modal they never asked for, and a bot that always has
 *  one outstanding never composes another. */
function expireTrades(s: GameState, events: GameEvent[]): void {
  const stale = s.trades.filter((t) => s.turnNumber - t.createdAt > TRADE_TTL);
  if (stale.length === 0) return;
  const dead = new Set(stale.map((t) => t.id));
  s.trades = s.trades.filter((t) => !dead.has(t.id));
  for (const offer of stale) {
    s.tradeCooldowns[tradeKey(offer.from, offer.to)] = s.turnNumber;
    events.push({ type: 'TRADE_EXPIRED', offer });
  }
}

function doProposeTrade(
  s: GameState, events: GameEvent[], o: TradeBody,
): void {
  if (!canTrade(s, o)) return;
  // Copied field by field: whatever else a client sent along stays out of
  // the state every other client is sent.
  const offer: TradeOffer = {
    from: o.from,
    to: o.to,
    giveCash: o.giveCash,
    giveProperties: [...o.giveProperties],
    giveJailCards: o.giveJailCards,
    wantCash: o.wantCash,
    wantProperties: [...o.wantProperties],
    wantJailCards: o.wantJailCards,
    id: `t${s.version}-${o.from}-${o.to}`,
    createdAt: s.turnNumber,
  };
  const terms = cleanTerms(o.terms);
  if (terms) offer.terms = terms;
  // A counter-offer answers one particular offer from the other side, and
  // takes its place: that offer is withdrawn, with no cooldown, because the
  // two players are still talking.
  const original = typeof o.counterTo === 'string'
    ? s.trades.find((t) => t.id === o.counterTo && t.from === o.to && t.to === o.from)
    : undefined;
  s.trades = s.trades.filter((t) => !(t.from === o.from && t.to === o.to) && t !== original);
  if (original) offer.counterTo = original.id;
  s.trades.push(offer);
  events.push(original
    ? { type: 'TRADE_COUNTERED', offer: original, counter: offer }
    : { type: 'TRADE_PROPOSED', offer });
}

function doAcceptTrade(s: GameState, events: GameEvent[], pid: string, tradeId: string): void {
  const offer = s.trades.find((t) => t.id === tradeId);
  if (!offer || offer.to !== pid) return;
  // Re-validate at acceptance: the world moved since the offer was made.
  if (!canTrade(s, offer)) {
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
  signTerms(s, events, offer);
  chargeTransferFees(s, events, offer.to, offer.giveProperties);
  chargeTransferFees(s, events, offer.from, offer.wantProperties);

  s.trades = s.trades.filter(
    (t) => t.id !== tradeId
      && ![t.from, t.to].some((p) => p === offer.from || p === offer.to),
  );
  events.push({ type: 'TRADE_ACCEPTED', offer });
}

/** Turn an accepted offer's terms into contracts, and move loan principal.
 *  canTrade has already checked the lender holds it. */
function signTerms(s: GameState, events: GameEvent[], offer: TradeOffer): void {
  (offer.terms ?? []).forEach((t, i) => {
    const id = `c${s.version}-${i}`;
    let c: Contract;
    switch (t.kind) {
      case 'pass': {
        const grantor = sideId(offer, t.grantor);
        c = {
          id, kind: 'pass', grantor, holder: grantor === offer.from ? offer.to : offer.from,
          spaces: [...t.spaces], discountPct: t.discountPct, usesLeft: t.uses,
        };
        break;
      }
      case 'share': {
        const grantor = sideId(offer, t.grantor);
        c = {
          id, kind: 'share', grantor, holder: grantor === offer.from ? offer.to : offer.from,
          spaces: [...t.spaces], pct: t.pct, endsRound: t.rounds === 0 ? null : s.round + t.rounds,
        };
        break;
      }
      case 'loan': {
        const lender = sideId(offer, t.lender);
        const borrower = lender === offer.from ? offer.to : offer.from;
        s.players[lender].cash -= t.principal;
        s.players[borrower].cash += t.principal;
        events.push({ type: 'MONEY', playerId: lender, delta: -t.principal, reason: 'loan' });
        events.push({ type: 'MONEY', playerId: borrower, delta: t.principal, reason: 'loan' });
        c = {
          id, kind: 'loan', lender, borrower,
          principal: t.principal, repay: t.repay, dueRound: s.round + t.rounds,
        };
        break;
      }
    }
    s.contracts.push(c);
    events.push({ type: 'CONTRACT_SIGNED', contract: c });
  });
}

/* ------------------------------ contracts ---------------------------- */

function endContract(s: GameState, events: GameEvent[], id: string, reason: ContractEnd): void {
  const c = s.contracts.find((x) => x.id === id);
  if (!c) return;
  s.contracts = s.contracts.filter((x) => x.id !== id);
  events.push({ type: 'CONTRACT_ENDED', contract: c, reason });
}

/** A share signed for a number of rounds lapses as its last round ends. */
function expireShares(s: GameState, events: GameEvent[]): void {
  for (const c of [...contractsOf(s)]) {
    if (c.kind === 'share' && c.endsRound !== null && s.round >= c.endsRound) {
      endContract(s, events, c.id, 'expired');
    }
  }
}

/**
 * Loans are collected at the start of the borrower's turn once their round
 * has come. Short of the money, the borrower raises it like any other debt
 * - and folding hands the estate to the lender, who is the creditor.
 */
function collectDueLoans(s: GameState, events: GameEvent[], pid: string): void {
  for (let guard = 0; guard < 50; guard++) {
    const loan = contractsOf(s).find(
      (c): c is Extract<Contract, { kind: 'loan' }> =>
        c.kind === 'loan' && c.borrower === pid && s.round >= c.dueRound,
    );
    if (!loan) return;
    s.contracts = s.contracts.filter((c) => c.id !== loan.id);
    const lender = s.players[loan.lender];
    if (!lender || lender.bankrupt) continue;
    chargePlayer(s, events, pid, loan.repay, 'loan repayment', loan.lender);
    if (s.phase === 'must_raise') {
      if (s.debt) s.debt.resume = 'turn';
      return;
    }
    events.push({ type: 'LOAN_REPAID', borrower: pid, lender: loan.lender, amount: loan.repay, early: false });
  }
}

function doRepayLoan(s: GameState, events: GameEvent[], pid: string, contractId: string): void {
  const loan = s.contracts.find((c) => c.id === contractId);
  if (!loan || loan.kind !== 'loan' || loan.borrower !== pid) return;
  const me = s.players[pid];
  if (me.cash < loan.repay) return;
  s.contracts = s.contracts.filter((c) => c.id !== contractId);
  me.cash -= loan.repay;
  events.push({ type: 'MONEY', playerId: pid, delta: -loan.repay, reason: 'loan repayment' });
  credit(s, events, loan.lender, loan.repay, `from ${me.name}`);
  events.push({ type: 'LOAN_REPAID', borrower: pid, lender: loan.lender, amount: loan.repay, early: true });
}

function doReleaseContract(s: GameState, events: GameEvent[], pid: string, contractId: string): void {
  const c = s.contracts.find((x) => x.id === contractId);
  if (!c || beneficiary(c) !== pid) return;
  endContract(s, events, contractId, 'released');
}

/**
 * What a bankruptcy does to the ledger. Rights pass to a player creditor
 * along with everything else; obligations die with the estate. Passes and
 * shares ride on deeds, so they survive while a deed goes to a creditor and
 * end when it goes back to the bank. Called before any deed changes hands.
 */
function settleContractsOnBankruptcy(
  s: GameState, events: GameEvent[], pid: string, heir: string | null, deeds: number[],
): void {
  const ownerAfter = (id: number): string | null =>
    (deeds.includes(id) ? heir : s.properties[id].owner);
  for (const c of [...contractsOf(s)]) {
    if (c.kind === 'loan') {
      if (c.borrower === pid) endContract(s, events, c.id, 'void');
      else if (c.lender === pid) {
        if (heir && heir !== c.borrower) c.lender = heir;
        else endContract(s, events, c.id, 'void');
      }
      continue;
    }
    if (c.holder === pid) {
      if (!heir) { endContract(s, events, c.id, 'void'); continue; }
      c.holder = heir;
    }
    // The grantor's promise rides with the deeds: it passes to the creditor
    // along with them, or dies with the estate. To the creditor who already
    // holds it, it binds nobody.
    if (c.grantor === pid) {
      if (!heir || heir === c.holder) { endContract(s, events, c.id, 'void'); continue; }
      c.grantor = heir;
    }
    if (!heir && c.spaces.some((id) => deeds.includes(id))) {
      c.spaces = c.spaces.filter((id) => !deeds.includes(id));
      if (c.spaces.length === 0) { endContract(s, events, c.id, 'void'); continue; }
    }
    // Inherited by the very player it is levied for, it binds nobody.
    if (c.spaces.every((id) => ownerAfter(id) === c.holder)) endContract(s, events, c.id, 'void');
  }
}

/** Deeds that arrive mortgaged cost their new owner the interest up front
 *  (standard rule). canTrade has already checked it can be paid. */
function chargeTransferFees(s: GameState, events: GameEvent[], pid: string, ids: number[]): void {
  const fee = ids.reduce((n, id) => n + (s.properties[id].mortgaged ? transferFee(s, id) : 0), 0);
  if (fee <= 0) return;
  s.players[pid].cash -= fee;
  events.push({ type: 'MONEY', playerId: pid, delta: -fee, reason: 'mortgage interest' });
}

function doDeclineTrade(s: GameState, events: GameEvent[], pid: string, tradeId: string): void {
  const offer = s.trades.find((t) => t.id === tradeId);
  if (!offer || offer.to !== pid) return;
  s.trades = s.trades.filter((t) => t.id !== tradeId);
  s.tradeCooldowns[tradeKey(offer.from, offer.to)] = s.turnNumber;
  events.push({ type: 'TRADE_DECLINED', offer });
}

/* ----------------------------- bankruptcy --------------------------- */

function doBankrupt(
  s: GameState, events: GameEvent[], pid: string, creditorId: string | null,
): void {
  const me = s.players[pid];
  const owned = ownedBy(s, pid);

  if (contractsOf(s).length > 0) {
    const heir = creditorId && s.players[creditorId] && !s.players[creditorId].bankrupt ? creditorId : null;
    settleContractsOnBankruptcy(s, events, pid, heir, owned);
  }

  if (creditorId && s.players[creditorId] && !s.players[creditorId].bankrupt) {
    // Everything transfers, mortgages and all.
    credit(s, events, creditorId, me.cash, `from ${me.name}'s estate`);
    let interest = 0;
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
      if (st.mortgaged) interest += transferFee(s, id);
    }
    s.players[creditorId].getOutOfJailCards += me.getOutOfJailCards;
    // Taking over a mortgaged deed costs the interest up front - paid out of
    // what the estate has just handed over, never into debt.
    const creditor = s.players[creditorId];
    const pay = Math.min(interest, creditor.cash);
    if (pay > 0) {
      creditor.cash -= pay;
      events.push({ type: 'MONEY', playerId: creditorId, delta: -pay, reason: 'mortgage interest' });
    }
  } else {
    // To the bank: the deeds come back unimproved and unmortgaged, and the
    // bank sells them on at auction (standard rule).
    for (const id of owned) {
      const st = s.properties[id];
      if (st.houses === 5) s.hotelsRemaining += 1;
      else s.housesRemaining += st.houses;
      st.owner = null;
      st.houses = 0;
      st.mortgaged = false;
    }
    for (let i = 0; i < me.getOutOfJailCards; i++) returnJailCard(s);
    if (s.settings.auctionsEnabled) s.auctionQueue.push(...owned);
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
  startQueuedAuction(s, events);
}

/** Put the next deed the bank took from a bankrupt estate up for auction.
 *  False when there is nothing to sell, or nobody left to sell it to. */
function startQueuedAuction(s: GameState, events: GameEvent[]): boolean {
  if (s.phase === 'game_over' || s.auction || s.auctionQueue.length === 0) return false;
  const bidders = s.seats.filter((id) => !s.players[id].bankrupt);
  if (bidders.length < 2) {
    s.auctionQueue = [];
    return false;
  }
  const spaceId = s.auctionQueue.shift()!;
  s.auction = {
    spaceId,
    currentBid: 0,
    highBidder: null,
    active: bidders,
    turn: 0,
    origin: 'bankruptcy',
  };
  s.phase = 'auction';
  events.push({ type: 'AUCTION_STARTED', spaceId });
  return true;
}

/* ---------------------------- win condition ------------------------- */

function checkWinCondition(s: GameState, events: GameEvent[]): void {
  if (s.phase === 'lobby' || s.phase === 'game_over') return;
  const alive = s.seats.filter((id) => !s.players[id].bankrupt);

  if (alive.length <= 1) {
    finishGame(s, events, alive[0] ?? null);
    return;
  }

  if (s.settings.winCondition === 'turn-limit' && s.round > s.settings.turnLimit) {
    finishGame(s, events, leaderByNetWorth(s, alive));
    return;
  }

  if (s.settings.winCondition === 'networth') {
    const reached = alive.filter((id) => netWorth(s, id) >= s.settings.netWorthTarget);
    if (reached.length > 0) finishGame(s, events, leaderByNetWorth(s, reached));
  }
}

function finishGame(s: GameState, events: GameEvent[], winnerId: string | null): void {
  s.winnerId = winnerId;
  recordHistory(s);
  s.phase = 'game_over';
  events.push({ type: 'GAME_OVER', winnerId });
}

/** One point on the closing chart. A second point for the same round (the
 *  game ending part-way through one) replaces the first. */
function recordHistory(s: GameState): void {
  const worth: Record<string, number> = {};
  for (const id of s.seats) worth[id] = s.players[id].bankrupt ? 0 : netWorth(s, id);
  const last = s.history[s.history.length - 1];
  if (last && last.round === s.round) s.history.pop();
  s.history.push({ round: s.round, worth });
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

/* --------------------------- seat hand-over -------------------------- */

/**
 * A signed-in player takes over a bot's seat in a game in progress, and
 * everything the bot held with it: cash, deeds, position, contracts.
 *
 * Deliberately not a GameAction. Nobody can ask for this through the
 * reducer, so nobody can talk the reducer into it: the host applies it
 * directly, and only after the player's pass has checked out. Pure all the
 * same - it returns a new state and says what happened.
 */
export function handOverSeat(prev: GameState, playerId: string, name: string): Reduction {
  const p = prev.players[playerId];
  if (!p || !p.isBot || p.bankrupt || prev.phase === 'game_over' || prev.phase === 'lobby') {
    return { state: prev, events: [] };
  }
  const s = clone(prev);
  s.version = prev.version + 1;
  const seat = s.players[playerId];
  seat.isBot = false;
  seat.connected = true;
  seat.name = name;
  return { state: s, events: [{ type: 'SEAT_TAKEN', playerId, name, previous: p.name }] };
}

/**
 * The reverse of a hand-over: a removed player's seat plays on as a bot,
 * keeping everything it held. Host-side only, like the hand-over - nobody
 * can talk the reducer into it. Nothing is announced: the room snapshot
 * already shows the seat turn into a bot.
 */
export function botifySeat(prev: GameState, playerId: string): Reduction {
  const p = prev.players[playerId];
  if (!p || p.isBot || prev.phase === 'game_over' || prev.phase === 'lobby') {
    return { state: prev, events: [] };
  }
  const s = clone(prev);
  s.version = prev.version + 1;
  s.players[playerId].isBot = true;
  s.players[playerId].connected = false;
  return { state: s, events: [] };
}

/* ------------------------- exported helpers ------------------------- */

export { netWorth, maxRaisable, currentPlayerId };
