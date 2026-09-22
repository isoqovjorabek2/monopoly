/* The front door's ways in, in English - and the shape the others fill in.
 *
 * Three separate questions used to share one column: who you are, whether
 * you are starting a table or joining one, and whether a table you start is
 * open to strangers. Each now has its own words, asked in that order. */

export const entryEn = {
  you: 'You',
  orGuest: 'or play as a guest',
  howAria: 'How do you want to play?',
  tabs: {
    host: 'Host a table',
    join: 'Join a table',
    practice: 'Practice',
  },

  host: {
    who: 'Who can join?',
    private: ['Private', 'Only people you send the link or code to'] as [string, string],
    public: ['Public', 'Anyone can find it on this page and take a seat until it starts'] as [string, string],
    publicCashflow: 'Nest Egg tables are invite-only for now.',
    create: (visibility: 'private' | 'public', game: string) =>
      `Create a ${visibility} ${game} table`,
    after: 'You get a link to share, and set the rules before anyone rolls.',
  },

  join: {
    code: 'Have a code or an invite link?',
    codeHint: 'You join whichever game that table is playing.',
    paste: 'Paste a code or link',
    invited: (code: string) => `You were invited to ${code}. Press Join when you are ready.`,
    publicTitle: 'Open public tables',
    yourGames: 'Your games',
    yourGamesHint: 'Saved on our server while they are played. Resume rejoins the table, or restarts it from the save if nobody is hosting.',
    resume: 'Resume',
    forget: 'Remove',
    savedMeta: (game: string, round: number, names: string) => `${game} · round ${round} · ${names}`,
  },

  practice: {
    body: (game: string, bots = 2) => `Learn ${game} against ${bots === 2 ? 'two' : bots} bots. Nobody else can join, and nothing is shared.`,
    start: (game: string) => `Start practising ${game}`,
  },

  needName: 'Sign in, or type a name, to take a seat.',
  signedOutNote: 'Signing in keeps your seat on any device and lets you join games already in progress.',
};

export type EntryDict = typeof entryEn;
