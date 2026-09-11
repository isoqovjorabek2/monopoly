import { rand } from '../game/rng';
import type { BotLevel } from '../game/types';
import { DREAM_IDS, FAST_BOARD, FAST_SIZE, LOAN_UNIT } from './data';
import {
  charityCost, currentId, dreamPrice, legalActions, maxLoan, progress,
  settlement, tableCard, totalExpenses,
} from './rules';
import type { CFAction, CFPlayer, CFState } from './types';

/* ------------------------------------------------------------------ *
 * Cashflow bots. Same rules as the Monopoly ones: they choose from
 * legalActions() and nothing else, they read only what is face-up on
 * the table, and difficulty changes judgement - never information.
 *
 * The game is mostly arithmetic, so these are rules rather than a
 * scoring search: buy what pays for itself, never borrow into a deal the
 * loan payment would eat, sell into a buyer who doubles your money.
 * ------------------------------------------------------------------ */

/** Cash a bot keeps back beyond a quarter of its monthly expenses. */
const KEEP: Record<BotLevel, number> = { easy: 200, normal: 600, hard: 1200 };

/** Annual cash-on-cash return a deal has to clear. */
const MIN_ROI: Record<BotLevel, number> = { easy: 0.05, normal: 0.12, hard: 0.2 };

/** A fixed cushion under a purchase. Fixed, so that taking a loan to reach
 *  it can never raise it and send the bot back for another loan. */
const BUY_CUSHION: Record<BotLevel, number> = { easy: 0, normal: 100, hard: 300 };

const coin = (s: CFState, salt: number): number =>
  rand(s.settings.seed, s.rngCursor * 31 + s.version * 7 + salt);

const keepFor = (p: CFPlayer): number => KEEP[p.botLevel] + Math.round(totalExpenses(p) * 0.25);

export function botDecide(s: CFState, pid: string): CFAction | null {
  const me = s.players[pid];
  if (!me || !me.isBot || me.out) return null;
  const legal = legalActions(s, pid);
  if (legal.length === 0) return null;

  if (s.phase === 'dreams') return pickDream(s, me, legal);

  // Selling into a card someone turned over is open on or off turn.
  const sale = saleDecision(s, me, legal);
  if (sale) return sale;

  if (currentId(s) !== pid) return null;
  if (me.track === 'fast') return fastDecision(s, me, legal);

  switch (s.phase) {
    case 'roll':
      return housekeeping(me, legal) ?? rollMost(legal);
    case 'choose_deal':
      return chooseDeck(s, me, legal);
    case 'turn_end':
      return dealDecision(s, me, legal) ?? charityDecision(s, me, legal) ?? find(legal, 'END_TURN');
    default:
      return null;
  }
}

const find = <T extends CFAction['type']>(legal: CFAction[], type: T): Extract<CFAction, { type: T }> | null =>
  (legal.find((a) => a.type === type) as Extract<CFAction, { type: T }> | undefined) ?? null;

/* ------------------------------ dreams ------------------------------ */

/** The cheapest dream wins soonest; one nobody else wants cannot be made
 *  dearer by a rival sitting on it. An easy bot just picks one it likes. */
function pickDream(s: CFState, me: CFPlayer, legal: CFAction[]): CFAction | null {
  const options = legal.filter((a): a is Extract<CFAction, { type: 'CHOOSE_DREAM' }> => a.type === 'CHOOSE_DREAM');
  if (options.length === 0) return null;
  if (me.botLevel === 'easy') {
    return options[Math.floor(coin(s, 11) * options.length) % options.length];
  }
  const taken = new Set(s.seats.map((id) => s.players[id].dream).filter((d) => d != null));
  let best = options[0];
  let bestScore = Infinity;
  for (const o of options) {
    const score = (FAST_BOARD[o.spaceId].cost ?? 0) + (taken.has(o.spaceId) ? 60000 : 0) + coin(s, o.spaceId) * 20000;
    if (score < bestScore) { bestScore = score; best = o; }
  }
  return best;
}

/* ----------------------------- selling ------------------------------ */

function saleDecision(s: CFState, me: CFPlayer, legal: CFAction[]): CFAction | null {
  const card = tableCard(s);
  if (!card) return null;

  const stockSale = find(legal, 'SELL_STOCK');
  if (stockSale && card.deck !== 'market' && card.deck !== 'doodad' && card.kind === 'stock') {
    const lot = me.stocks.find((l) => l.symbol === card.symbol);
    // Dividend payers are held for the income; the rest are a trade.
    if (lot && lot.dividend === 0) {
      const gain = card.price / Math.max(lot.cost, 0.01);
      const target = me.botLevel === 'hard' ? 4 : me.botLevel === 'normal' ? 3 : 2;
      if (gain >= target || (card.price >= 30 && card.price > lot.cost)) return stockSale;
    }
  }

  if (card.deck === 'market' && card.kind === 'offer') {
    const close = progress(s, me) > 0.7;
    for (const a of legal) {
      if (a.type !== 'SELL_HOLDING') continue;
      const h = me.holdings.find((x) => x.id === a.holdingId);
      if (!h) continue;
      const net = settlement(card, h);
      if (net <= 0) continue;
      // Dead weight goes at any profit. Something that earns only goes for
      // a real multiple - and not at all when it is what gets you out.
      if (h.cashflow <= 0 && net >= h.down) return a;
      const multiple = close ? 3 : me.botLevel === 'easy' ? 1.5 : 2;
      if (net >= h.down * multiple) return a;
    }
  }
  return null;
}

/* ----------------------------- the Rat Race ------------------------- */

/** Before rolling: clear the 10%-a-month bank loan, and (hard bots) the
 *  consumer debts that cost the most per dollar owed. */
function housekeeping(me: CFPlayer, legal: CFAction[]): CFAction | null {
  const keep = keepFor(me);
  if (find(legal, 'REPAY_LOAN') && me.bankLoan > 0) {
    const units = Math.floor((me.cash - keep) / LOAN_UNIT);
    const amount = Math.min(me.bankLoan, units * LOAN_UNIT);
    if (amount >= LOAN_UNIT) return { type: 'REPAY_LOAN', playerId: me.id, amount };
  }
  if (me.botLevel === 'hard') {
    for (const a of legal) {
      if (a.type !== 'PAY_OFF') continue;
      const d = me.debts[a.debt];
      if (d.payment / d.balance >= 0.025 && me.cash - d.balance >= keep) return a;
    }
  }
  return null;
}

function rollMost(legal: CFAction[]): CFAction | null {
  const rolls = legal.filter((a): a is Extract<CFAction, { type: 'ROLL' }> => a.type === 'ROLL');
  if (rolls.length === 0) return null;
  return rolls.reduce((a, b) => ((b.dice ?? 1) > (a.dice ?? 1) ? b : a));
}

function chooseDeck(s: CFState, me: CFPlayer, legal: CFAction[]): CFAction | null {
  const reach = me.cash + maxLoan(s, me);
  const wantBig = me.botLevel === 'easy'
    ? coin(s, 23) < 0.35 && me.cash >= 6000
    : reach >= 6000 + KEEP[me.botLevel] && me.cash >= 3000;
  return legal.find((a) => a.type === 'DRAW_DEAL' && a.deck === (wantBig ? 'big' : 'small')) ?? null;
}

function dealDecision(s: CFState, me: CFPlayer, legal: CFAction[]): CFAction | null {
  const card = tableCard(s);
  if (!card || !s.card || s.card.by !== me.id) return null;
  if (card.deck === 'market' || card.deck === 'doodad') return null;
  const level = me.botLevel;

  if (card.kind === 'stock') {
    const buy = find(legal, 'BUY_STOCK');
    if (!buy) return null;
    const spare = me.cash - keepFor(me);
    if (spare < card.price) return null;
    if (card.dividend > 0) {
      const yearly = (card.dividend * 12) / card.price;
      if (yearly < MIN_ROI[level] / 2) return null;
      return { type: 'BUY_STOCK', playerId: me.id, shares: Math.floor(spare / card.price) };
    }
    // Speculation: only at the bottom of the range, and only with part of
    // the spare cash - a stock that pays nothing does not get you out.
    const cheap = card.price <= card.range[0] || (level === 'easy' && card.price <= 10);
    if (!cheap) return null;
    const shares = Math.floor((spare * (level === 'hard' ? 0.6 : 0.4)) / card.price);
    return shares > 0 ? { type: 'BUY_STOCK', playerId: me.id, shares } : null;
  }

  if (card.kind !== 'holding' || s.card.used) return null;
  if (card.cashflow < 0) return null;

  const roi = (card.cashflow * 12) / Math.max(card.down, 1);
  const earning = card.cashflow > 0 && roi >= MIN_ROI[level];
  const speculative = card.cashflow === 0 && level !== 'easy'
    && card.down <= 5000 && me.cash - card.down >= keepFor(me);
  if (!earning && !speculative) return null;

  const cushion = BUY_CUSHION[level];
  if (me.cash >= card.down + cushion) return find(legal, 'BUY_DEAL');

  // Borrow the difference only when the deal out-earns the loan payment.
  if (!earning) return null;
  const loan = Math.ceil((card.down + cushion - me.cash) / LOAN_UNIT) * LOAN_UNIT;
  if (loan > maxLoan(s, me) || card.cashflow <= loan / 10) return null;
  return { type: 'TAKE_LOAN', playerId: me.id, amount: loan };
}

function charityDecision(s: CFState, me: CFPlayer, legal: CFAction[]): CFAction | null {
  const give = find(legal, 'DONATE');
  if (!give) return null;
  if (me.botLevel === 'easy' && coin(s, 41) < 0.5) return null;
  return me.cash - charityCost(me) >= keepFor(me) ? give : null;
}

/* ---------------------------- the Fast Track ------------------------ */

function fastDecision(s: CFState, me: CFPlayer, legal: CFAction[]): CFAction | null {
  if (s.phase === 'roll') return fastRoll(me, legal);
  if (s.phase !== 'turn_end') return null;

  const dreamBuy = find(legal, 'BUY_DREAM');
  if (dreamBuy) return dreamBuy;

  const reserve = me.botLevel === 'easy' ? 0 : dreamPrice(me) * 0.5;
  const sp = FAST_BOARD[me.position];

  const business = find(legal, 'BUY_BUSINESS');
  if (business && me.cash - (sp.cost ?? 0) >= reserve) return business;

  const venture = find(legal, 'TRY_VENTURE');
  if (venture && me.cash - (sp.cost ?? 0) >= reserve) {
    const odds = (sp.win?.length ?? 0) / 6;
    // A monthly payout is worth roughly a year of CASHFLOW Days to a bot.
    const worth = odds * ((sp.payout ?? 0) + (sp.cfPayout ?? 0) * 12);
    if (worth > (sp.cost ?? 0)) return venture;
  }

  const give = find(legal, 'DONATE');
  if (give && me.botLevel !== 'easy' && me.cash - charityCost(me) >= reserve) return give;

  return find(legal, 'END_TURN');
}

/** Probability of rolling exactly `target` with `n` dice. */
function exactOdds(n: number, target: number): number {
  let dist = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(dist.length + 6).fill(0);
    dist.forEach((p, sum) => { for (let f = 1; f <= 6; f++) next[sum + f] += p / 6; });
    dist = next;
  }
  return dist[target] ?? 0;
}

/** With a choice of dice, aim for the dream once it is affordable;
 *  otherwise go as far as possible, which means more CASHFLOW Days. */
function fastRoll(me: CFPlayer, legal: CFAction[]): CFAction | null {
  const rolls = legal.filter((a): a is Extract<CFAction, { type: 'ROLL' }> => a.type === 'ROLL');
  if (rolls.length <= 1 || me.botLevel === 'easy') return rolls[0] ?? null;
  if (me.dream != null && me.cash >= dreamPrice(me)) {
    const dist = (me.dream - me.position + FAST_SIZE) % FAST_SIZE;
    let best = rolls[0];
    let bestOdds = -1;
    for (const r of rolls) {
      const odds = exactOdds(r.dice ?? 2, dist);
      if (odds > bestOdds) { bestOdds = odds; best = r; }
    }
    if (bestOdds > 0) return best;
  }
  return rollMost(legal);
}

/* ------------------------------ pacing ------------------------------ */

/** Human-feeling delay. A card a bot turned over stays up long enough to
 *  read - and long enough to sell into, when a human at the table can. */
export function botDelay(s: CFState, pid: string): number {
  let base = s.phase === 'dreams' ? 450 : 750;
  if (s.card && s.phase === 'turn_end' && currentId(s) === pid) {
    const humanCanSell = s.seats.some((id) => id !== pid && !s.players[id].isBot
      && legalActions(s, id).some((a) => a.type === 'SELL_STOCK' || a.type === 'SELL_HOLDING'));
    base = humanCanSell ? 5200 : 1500;
  }
  return base + coin(s, 7) * 500;
}

export { DREAM_IDS };
