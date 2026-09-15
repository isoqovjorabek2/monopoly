/* Around the table, in English - and the shape the others fill in:
 * counter-offers, turn alerts, rematches, and tables you can join mid-game. */

const s = (n: number): string => (n === 1 ? '' : 's');

export const tableEn = {
  counter: {
    button: 'Counter',
    title: (name: string) => `Counter ${name}'s offer`,
    note: (name: string) => `Change anything and send it back. ${name}'s original offer is withdrawn when you do.`,
    send: 'Send counter-offer',
    badge: 'counter-offer',
  },

  alerts: {
    on: 'Alerts on',
    off: 'Alerts off',
    title: 'Tell me when the table needs me, even from another tab',
    blocked: 'Notifications are blocked for this site in your browser settings.',
    yourTurn: 'Your turn',
    needed: 'The table is waiting on you',
    offer: (name: string) => `${name} sent you an offer`,
    request: (name: string) => `${name} wants to take a seat`,
  },

  rematch: {
    again: 'Play again at this table',
    note: 'Everyone stays seated, and you can change the rules before the first roll.',
    waiting: 'Waiting for the host to start another game…',
  },

  live: {
    inProgress: (round: number) => `In progress · round ${round}`,
    openSeats: (n: number) => `${n} bot seat${s(n)} to take`,
    watch: 'Watch & join',
    watchTitle: 'Sign in, watch, and take over a bot',
  },

  log: {
    countered: (by: string, from: string) => `${by} countered ${from}'s offer.`,
  },

  mod: {
    coowner: 'co-owner',
    coownerTitle: 'Elected by the table while the owner is away; can remove players',
    kickTitle: (name: string) => `Remove ${name} from the table - a bot takes their seat`,
    kickSure: 'Sure?',
    awayTitle: 'The table owner is away',
    awayBody: (name: string, voters: number) =>
      `${name} has been gone a while. Endorse a co-owner to keep order; a strict majority of ${voters} elects.`,
    votes: (n: number) => `${n} endorsement${s(n)}`,
    endorse: 'Endorse',
    endorsed: 'Endorsed',
  },
};

export type TableDict = typeof tableEn;
