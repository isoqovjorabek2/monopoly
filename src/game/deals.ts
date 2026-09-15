import { BOARD } from './board';
import type { Contract, DealTerm, GameState, TradeBody, TradeSide } from './types';

/* ------------------------------------------------------------------ *
 * Deal Maker: pure queries over contracts. The reducer, the rules, the
 * bots and the trade panel all read these, so there is one definition of
 * what a term may say and who a contract binds.
 * ------------------------------------------------------------------ */

/** Terms one offer may carry. Enough for "a pass, a share and a loan"; any
 *  more is a contract nobody at the table will read. */
export const MAX_TERMS = 4;
/** Squares one pass or share may cover - the largest set plus change. */
export const MAX_TERM_SPACES = 6;

export const PASS_DISCOUNTS = [25, 50, 75, 100] as const;
export const PASS_USES = [1, 2, 3, 5] as const;
export const SHARE_ROUNDS = [5, 10, 20, 0] as const;
export const LOAN_RATES = [0, 10, 20, 35, 50] as const;
export const LOAN_ROUNDS = [3, 5, 8, 12] as const;

/** Contracts of older saves, which predate the field. */
export const contractsOf = (s: GameState): Contract[] => s.contracts ?? [];

export const sideId = (o: Pick<TradeBody, 'from' | 'to'>, side: TradeSide): string =>
  (side === 'from' ? o.from : o.to);
export const otherSide = (side: TradeSide): TradeSide => (side === 'from' ? 'to' : 'from');

/** The player a contract favours - the only one who may release it. */
export const beneficiary = (c: Contract): string => (c.kind === 'loan' ? c.lender : c.holder);
/** The player a contract binds. For passes and shares that is really the
 *  deed, but this names who signed. */
export const obligor = (c: Contract): string => (c.kind === 'loan' ? c.borrower : c.grantor);

export const involves = (c: Contract, pid: string): boolean =>
  beneficiary(c) === pid || obligor(c) === pid;

/** The pass `pid` would use on `spaceId` right now, if any. */
export function activePass(s: GameState, pid: string, spaceId: number) {
  for (const c of contractsOf(s)) {
    if (c.kind === 'pass' && c.holder === pid && c.usesLeft > 0 && c.spaces.includes(spaceId)) return c;
  }
  return null;
}

/** Revenue shares standing on a square. */
export const sharesOn = (s: GameState, spaceId: number) =>
  contractsOf(s).filter(
    (c): c is Extract<Contract, { kind: 'share' }> => c.kind === 'share' && c.spaces.includes(spaceId),
  );

/** Percent of a square's rent already promised away. */
export const sharedPct = (s: GameState, spaceId: number): number =>
  sharesOn(s, spaceId).reduce((n, c) => n + c.pct, 0);

/** What `pid` is owed on loans, minus what they owe. Counted in net worth:
 *  cash borrowed is not wealth. */
export function loanBalance(s: GameState, pid: string): number {
  let n = 0;
  for (const c of contractsOf(s)) {
    if (c.kind !== 'loan') continue;
    if (c.lender === pid) n += c.repay;
    if (c.borrower === pid) n -= c.repay;
  }
  return n;
}

/** Total `pid` owes on loans. */
export const loanDebt = (s: GameState, pid: string): number =>
  contractsOf(s).reduce((n, c) => n + (c.kind === 'loan' && c.borrower === pid ? c.repay : 0), 0);

/** Cash a side hands over as loan principal under these terms. */
export const principalOut = (terms: DealTerm[] | undefined, side: TradeSide): number =>
  (terms ?? []).reduce((n, t) => n + (t.kind === 'loan' && t.lender === side ? t.principal : 0), 0);

const int = (v: unknown, lo: number, hi: number): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** What a loan repays at a rate, rounded to the nearest $10 upward. */
export const repayAt = (principal: number, ratePct: number): number =>
  Math.ceil((principal * (100 + ratePct)) / 1000) * 10;

/**
 * Whether an offer's terms can be signed as they stand. Assumes the rest of
 * the offer has already been checked by `canTrade`, which calls this.
 *
 * Deeds are checked against who holds them *after* the swap, which is what
 * makes the most natural deal of all expressible: "I sell you Boardwalk,
 * and keep a quarter of its rent for ten rounds."
 */
export function termsValid(s: GameState, o: TradeBody): boolean {
  const terms = o.terms;
  if (terms === undefined) return true;
  if (!Array.isArray(terms)) return false;
  if (terms.length === 0) return true;
  if (!s.settings.dealsEnabled || terms.length > MAX_TERMS) return false;

  const ownerAfter = (id: number): string | null => {
    if (o.giveProperties.includes(id)) return o.to;
    if (o.wantProperties.includes(id)) return o.from;
    return s.properties[id]?.owner ?? null;
  };
  const added: Record<number, number> = {};

  for (const t of terms as unknown[]) {
    if (!t || typeof t !== 'object') return false;
    const term = t as DealTerm;
    if (term.kind === 'pass' || term.kind === 'share') {
      if (term.grantor !== 'from' && term.grantor !== 'to') return false;
      const grantor = sideId(o, term.grantor);
      const ids = term.spaces;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_TERM_SPACES) return false;
      if (new Set(ids).size !== ids.length) return false;
      for (const id of ids) {
        if (!int(id, 0, BOARD.length - 1) || !s.properties[id]) return false;
        if (ownerAfter(id) !== grantor) return false;
      }
      if (term.kind === 'pass') {
        if (!int(term.discountPct, 10, 100) || !int(term.uses, 1, 10)) return false;
      } else {
        if (!int(term.pct, 5, 100) || !int(term.rounds, 0, 50)) return false;
        for (const id of ids) added[id] = (added[id] ?? 0) + term.pct;
      }
    } else if (term.kind === 'loan') {
      if (term.lender !== 'from' && term.lender !== 'to') return false;
      if (!int(term.principal, 10, 100000)) return false;
      if (!int(term.repay, term.principal, term.principal * 3)) return false;
      if (!int(term.rounds, 1, 50)) return false;
    } else {
      return false;
    }
  }

  // Nobody can promise away more than all of a square's rent.
  for (const [id, pct] of Object.entries(added)) {
    if (sharedPct(s, Number(id)) + pct > 100) return false;
  }
  return true;
}

/** A clean copy of terms that passed `termsValid`: only the fields the
 *  engine reads, so a hostile client cannot park junk in shared state. */
export function cleanTerms(terms: DealTerm[] | undefined): DealTerm[] | undefined {
  if (!terms || terms.length === 0) return undefined;
  return terms.map((t): DealTerm => {
    switch (t.kind) {
      case 'pass': return { kind: 'pass', grantor: t.grantor, spaces: [...t.spaces], discountPct: t.discountPct, uses: t.uses };
      case 'share': return { kind: 'share', grantor: t.grantor, spaces: [...t.spaces], pct: t.pct, rounds: t.rounds };
      case 'loan': return { kind: 'loan', lender: t.lender, principal: t.principal, repay: t.repay, rounds: t.rounds };
    }
  });
}

/** Round a loan falls due, a share ends, counted from now. */
export const roundsLeft = (s: GameState, until: number | null): number | null =>
  (until === null ? null : Math.max(0, until - s.round));
