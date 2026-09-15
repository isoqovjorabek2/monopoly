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

  log: {
    seatTaken: (name: string, bot: string) => `${name} took over ${bot}'s seat.`,
  },
};

export type AccountDict = typeof accountEn;
