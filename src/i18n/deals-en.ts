import type { ContractEnd } from '../game/types';

/* ------------------------------------------------------------------ *
 * Deal Maker, in English - and the shape the other languages fill in.
 *
 * Contract terms are written without a subject ("Rent-free on Boardwalk")
 * and the parties are drawn beside them as avatars. That keeps "You" from
 * ever needing a verb to agree with it, in any language.
 * ------------------------------------------------------------------ */

const s = (n: number): string => (n === 1 ? '' : 's');

export const dealsEn = {
  /** Lobby: the rule switch and its explanation. */
  rule: ['Contracts in trades', 'Deal Maker. Trades can carry rent passes, revenue shares and loans, and the table enforces them.'] as [string, string],
  chip: 'Contracts on',
  presetBadge: 'Advanced',

  kinds: { pass: 'Rent pass', share: 'Revenue share', loan: 'Loan' },
  /** One line under each "add" button: what the contract is for. */
  kindHints: {
    pass: 'Stay on their deeds for less, or free',
    share: 'Take a cut of every rent a deed earns',
    loan: 'Cash now, paid back with interest',
  },

  /* ----------------------------- trade panel ----------------------------- */
  section: 'Contracts',
  sectionHint: 'Promises that come with this trade. Once accepted, the table enforces them automatically - nobody has to remember.',
  add: 'Add',
  remove: 'Remove contract',
  full: 'An offer can carry up to four contracts.',
  /** Who gives the pass or share, and who lends. */
  grantedBy: 'Given by',
  lentBy: 'Lent by',
  onDeeds: 'On',
  pickDeeds: 'Pick at least one deed.',
  noDeeds: (name: string) => `${name} holds no deeds to put this on.`,
  discount: 'Discount',
  free: 'Free',
  off: (pct: number) => `${pct}% off`,
  uses: 'Stays',
  times: (n: number) => `${n}×`,
  pct: 'Cut of rent',
  duration: 'Lasts',
  rounds: (n: number) => `${n} rounds`,
  wholeGame: 'Whole game',
  amount: 'Amount',
  rate: 'Interest',
  due: 'Repaid in',
  repays: (x: string) => `${x} back`,
  unsound: 'A contract cannot be signed as it stands: its deeds must belong to the side giving it once the swap is done, and no square can give away more than all of its rent.',
  sharedBadge: (pct: number) => `${pct}% shared`,

  /* ---------------------- a contract, subject-free ----------------------- */
  term: {
    pass: (deeds: string, pct: number) => (pct >= 100 ? `Rent-free on ${deeds}` : `${pct}% off rent on ${deeds}`),
    passMeta: (uses: number) => `${uses} stay${s(uses)}`,
    share: (deeds: string, pct: number) => `${pct}% of the rent on ${deeds}`,
    shareMeta: (rounds: number | null) => (rounds === null ? 'for the whole game' : `for ${rounds} round${s(rounds)}`),
    loan: (principal: string, repay: string) => `${principal} now, ${repay} back`,
    loanMeta: (rounds: number) => `in ${rounds} round${s(rounds)}`,
    /** Under the parties: which way the value flows. */
    grants: 'grants',
    lends: 'lends to',
  },

  /* ------------------------------ the ledger ----------------------------- */
  ledger: {
    button: (n: number) => `Contracts${n > 0 ? ` (${n})` : ''}`,
    title: 'Contracts in force',
    yours: 'Yours',
    others: 'Between other players',
    empty: 'Nothing signed yet. Open a trade and add a rent pass, a revenue share or a loan to it - the deal is written here once it is accepted.',
    usesLeft: (n: number) => `${n} stay${s(n)} left`,
    endsIn: (n: number) => (n <= 1 ? 'ends after this round' : `${n} rounds left`),
    forever: 'whole game',
    dueIn: (n: number) => (n <= 0 ? 'due on their next turn' : `due in ${n} round${s(n)}`),
    repay: (x: string) => `Repay ${x} now`,
    release: 'Release',
    releaseTitle: 'Tear this contract up. It favours you, so it is yours to give away.',
    onDeed: 'Contracts on this deed',
    owes: (x: string) => `Owes ${x}`,
    owesTitle: 'Still to repay on loans',
  },

  /* -------------------------------- log ---------------------------------- */
  log: {
    pass: (grantor: string, holder: string, deeds: string) => `${grantor} gave ${holder} a rent pass on ${deeds}.`,
    share: (grantor: string, holder: string, pct: number, deeds: string) => `${grantor} signed over ${pct}% of the rent on ${deeds} to ${holder}.`,
    loan: (lender: string, borrower: string, principal: string, repay: string, round: number) =>
      `${lender} lent ${borrower} ${principal}; ${repay} is due in round ${round}.`,
    passUsed: (p: string, space: string, saved: string) => `${p} used a rent pass on ${space} and kept ${saved}.`,
    sharePaid: (p: string, x: string, space: string) => `${p} took a ${x} cut of the rent on ${space}.`,
    repaid: (borrower: string, lender: string, x: string, early: boolean) =>
      `${borrower} repaid ${lender} ${x}${early ? ' early' : ''}.`,
    ended: (kind: 'pass' | 'share' | 'loan', holder: string, reason: ContractEnd) => {
      const what = { pass: 'rent pass', share: 'revenue share', loan: 'loan' }[kind];
      const why = {
        used: 'is used up',
        expired: 'has run its course',
        released: 'was released',
        void: 'is void',
      }[reason];
      return `${holder}'s ${what} ${why}.`;
    },
  },

  help: {
    heading: 'Deal Maker contracts',
    rows: [
      ['Rent pass', 'The holder pays less rent, or none, on the named deeds for a number of stays'],
      ['Revenue share', 'The holder takes a cut of every rent the named deeds collect, for a set time'],
      ['Loan', 'Cash now; repaid automatically when the borrower’s turn comes round, or raised like any debt'],
      ['With the deed', 'Passes and shares stay on a deed when it changes hands'],
      ['Bankruptcy', 'A creditor inherits the contracts that favoured the bankrupt; debts owed by them die with the estate'],
    ] as [string, string][],
  },
};

export type DealsDict = typeof dealsEn;
