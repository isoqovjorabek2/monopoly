import type { BoardTheme, SkinId } from '../game/types';

/* Player accounts, in English - and the shape the other languages fill in. */

export const accountEn = {
  signIn: 'Sign in with Google',
  signingIn: 'Finish signing in in the Google window…',
  signOut: 'Sign out',
  errors: {
    cancelled: 'Sign-in was cancelled.',
    failed: 'Google did not confirm the sign-in. Try again.',
    unavailable: 'Sign-in is not available right now.',
    invalid: 'That sign-in could not be verified. Try again.',
    popup: 'The sign-in window was blocked.',
  } as Record<'cancelled' | 'failed' | 'unavailable' | 'invalid' | 'popup', string>,
  /** Home, after being turned away from a game in progress. */
  joinAfterSignIn: (code: string) => `Sign in to join ${code}`,

  /* ---------------------------- watching ---------------------------- */
  watching: 'Watching',
  watchingNote: 'This game started before you arrived. Take over a bot and play on from where it is - its cash, deeds and turn become yours.',
  takeSeat: (name: string) => `Play as ${name}`,
  seatSummary: (cash: string, deeds: number) => `${cash} · ${deeds} deed${deeds === 1 ? '' : 's'}`,
  noSeats: 'Every seat is played by a person. You can watch until the game ends.',
  watchers: (names: string) => `Watching: ${names}`,

  /* ------------------------ the host decides ------------------------ */
  policy: {
    label: 'Joining a game in progress',
    hint: 'Signed-in players can take over a bot once the game has started.',
    ask: 'Ask me',
    anyone: 'Anyone signed in',
    off: 'No one',
  },
  askNote: 'The host is asked before you sit down.',
  asked: 'Asked the host…',
  waitingHost: (bot: string) => `Waiting for the host to let you take over ${bot}.`,
  closed: 'The host is not letting anyone take over a bot in this game. You can watch.',
  seatDenied: 'The host kept that seat for the bot.',
  request: (name: string, bot: string) => `${name} wants to take over ${bot}`,
  allow: 'Let them in',
  deny: 'No',

  log: {
    seatTaken: (name: string, bot: string) => `${name} took over ${bot}'s seat.`,
  },

  /* ------------------------- Party Hall Plus ------------------------ */
  plus: {
    badge: 'Plus',
    get: 'Get Plus',
    title: 'Party Hall Plus',
    lead: 'One Plus player unlocks the extras for everyone at their table.',
    perks: [
      ['Board themes', 'Play Bazaar Barons on a Tashkent or a Europe board.'],
      ['Piece & dice finishes', 'Mirror, glass, neon or gilded - the whole table sees them.'],
      ['Game history & stats', 'Every game you finish, your wins and your records.'],
      ['Saved games for 90 days', 'Instead of 14, with room for 100 tables.'],
    ] as [string, string][],
    activeUntil: (date: string) => `Plus is active until ${date}.`,
    checkoutSoon: 'Checkout is on its way. To get Plus now, send us your player id.',
    yourId: 'Your player id',
    copy: 'Copy',
    copied: 'Copied',
    refresh: 'Already bought Plus? Check again',
    checking: 'Checking…',
    signInFirst: 'Sign in with Google to get Plus.',
    close: 'Close',
    tableUnlocked: 'Plus table: the extras are unlocked for everyone.',
    themeLabel: 'Board',
    themeNames: { silk: 'Silk Road', tashkent: 'Tashkent', europe: 'Europe' } as Record<BoardTheme, string>,
    themeHint: 'Everyone at the table plays on the board you pick. The rules stay the same.',
    themeLocked: 'The Tashkent and Europe boards unlock when a Plus player sits at the table.',
    finishLabel: 'Finish',
    plans: { monthly: 'Monthly', yearly: 'Yearly' } as Record<'monthly' | 'yearly', string>,
    per: { monthly: '/month', yearly: '/year' } as Record<'monthly' | 'yearly', string>,
    save: (percent: number) => `Save ${percent}%`,
    opening: 'Opening checkout…',
    checkoutNote: 'Secure checkout by Paddle. Cancel anytime - Plus lasts to the end of what you paid for.',
    checkoutFailed: 'The checkout could not open. Check your connection and try again.',
    thanks: 'Thank you! Your Plus is being switched on - it takes a few seconds.',
    manage: 'To cancel or change your plan, use the link in your Paddle receipt email.',
    legal: { aria: 'Pricing and policies', pricing: 'Pricing', terms: 'Terms', privacy: 'Privacy', refunds: 'Refunds' },
    stats: 'Stats',
    statsTitle: 'Your games',
    loading: 'Loading…',
    statsUnavailable: 'Your stats could not be loaded right now.',
    played: 'Played',
    wins: 'Wins',
    winRate: 'Win rate',
    kindLine: (played: number, wins: number) => `${played} played · ${wins} won`,
    best: (x: string) => `Best: ${x}`,
    recent: 'Recent games',
    historyLocked: 'Your game-by-game history is a Plus perk. Every game you finish is already being kept, so it is all there when you upgrade.',
    noGames: 'Finish a game while signed in and it shows up here.',
    won: 'Won',
    place: (n: number) => `#${n}`,
    rounds: (n: number) => `${n} round${n === 1 ? '' : 's'}`,
    finishNames: { classic: 'Classic', mirror: 'Mirror', glass: 'Glass', neon: 'Neon', gilded: 'Gilded' } as Record<SkinId, string>,
  },
};

export type AccountDict = typeof accountEn;
