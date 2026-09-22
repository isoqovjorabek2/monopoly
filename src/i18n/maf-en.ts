import type { MafiaRole } from '../mafia/types';

/* ------------------------------------------------------------------ *
 * Omertà's words, English. Every other language fills in this exact
 * shape (i18n.test.ts checks it).
 * ------------------------------------------------------------------ */

export const mafEn = {
  name: 'Omertà',

  roles: {
    godfather: {
      name: 'Godfather',
      brief: 'You lead the family. The detective reads you as innocent. Settle on a victim with your people each night.',
    },
    mafia: {
      name: 'Mafia',
      brief: 'One of the family. Settle on a victim with your people each night, and blend in by day.',
    },
    silencer: {
      name: 'Silencer',
      brief: 'One of the family. Each night you gag one player: they cannot vote the next day.',
    },
    doctor: {
      name: 'Doctor',
      brief: 'Each night choose one player to save. If the family comes for them, they live.',
    },
    detective: {
      name: 'Detective',
      brief: 'Each night choose one player to investigate. You learn whether they are family - though the Godfather reads clean.',
    },
    bodyguard: {
      name: 'Bodyguard',
      brief: 'Each night choose one player to guard. If the family comes for them, they live.',
    },
    sniper: {
      name: 'Sniper',
      brief: 'You carry a single bullet for the whole game. Spend it on the right night.',
    },
    jester: {
      name: 'Jester',
      brief: 'You answer to no one. Get yourself voted out by the town and you alone win.',
    },
    villager: {
      name: 'Villager',
      brief: 'No night business. Watch, listen, and vote the family out by day.',
    },
  } satisfies Record<MafiaRole, { name: string; brief: string }>,

  lobby: {
    settingsTitle: 'House rules',
    discussion: 'Day discussion',
    discussionNote: 'How long the town talks before the vote opens.',
    revealRoles: 'Reveal roles of the dead',
    revealRolesNote: 'Off keeps the town guessing who it buried.',
    castTitle: 'The cast tonight',
    seconds: (n: number): string => `${n} seconds`,
  },

  reveal: {
    title: 'The town takes its seats',
    lead: 'Your role is yours alone. Say nothing.',
    yourRole: 'You are',
    teammatesTitle: 'The family',
    ack: 'Understood',
    waiting: (n: number): string => `Waiting on ${n} player${n === 1 ? '' : 's'}…`,
  },

  night: {
    title: (round: number): string => `Night ${round}`,
    lead: 'The town sleeps. The night people go about their business.',
    asleep: 'You have no night business. Wait for dawn.',
    chooseVictim: 'Choose the family’s victim',
    chooseSilence: 'Choose who cannot speak tomorrow',
    chooseSave: 'Choose who to save tonight',
    chooseCheck: 'Choose who to investigate',
    chooseGuard: 'Choose who to guard tonight',
    chooseShoot: 'Spend your bullet, or hold fire',
    holdFire: 'Hold fire',
    submit: 'Done',
    submitted: 'Your business is done. Wait for dawn.',
    teamChose: (name: string, target: string): string => `${name} marked ${target}`,
    waiting: 'The night is not over yet…',
  },

  dawn: {
    title: 'Dawn',
    quiet: 'The night passed quietly. Nobody died.',
    died: (name: string): string => `${name} was found dead.`,
    roleWas: (role: string): string => `They were the ${role}.`,
  },

  day: {
    title: (round: number): string => `Day ${round}`,
    lead: 'The town talks. Somebody here is family.',
    silenced: (name: string): string => `${name} has been silenced and cannot vote today.`,
    silencedYou: 'You have been silenced. You cannot vote today.',
  },

  vote: {
    title: 'The vote',
    lead: 'Point a finger. The town’s choice is hanged.',
    abstain: 'Abstain',
    youVoted: (name: string): string => `You pointed at ${name}.`,
    youAbstained: 'You abstained.',
    change: 'Change',
    waiting: (n: number): string => `Waiting on ${n} vote${n === 1 ? '' : 's'}…`,
    lynched: (name: string): string => `The town hanged ${name}.`,
    roleWas: (role: string): string => `They were the ${role}.`,
    noLynch: 'No clear choice. Nobody is hanged.',
  },

  over: {
    title: 'The dust settles',
    mafiaWins: 'The family owns the town.',
    villageWins: 'The town ran the family out.',
    jesterWins: (name: string): string => `${name} played you all. The Jester wins alone.`,
    abandoned: 'The night ledger was lost with the host. The match ends here.',
    again: 'Back to the lobby',
  },

  home: {
    lead: 'A family hides among the town. Each night they choose a victim; each day the town talks, points fingers and hangs somebody. The doctor, the detective and the rest work in the dark - nobody knows who is who until it is over.',
    note: 'Five to twelve at the table, bots filling any empty chair. One of you hosts, the rest connect straight to that tab. No signup, no install.',
    cast: ['godfather', 'detective', 'doctor'] as MafiaRole[],
  },

  setup: {
    tableSize: 'Players at the table',
    needPlayers: (n: number): string => `Omertà needs at least ${n} players - add bots, or let bots fill the table.`,
    fillNote: 'Empty chairs up to five are filled with bots when the game starts.',
    publicSoon: 'Omertà tables are invite-only for now: share the link.',
  },

  table: {
    alive: (n: number, total: number): string => `${n} of ${total} alive`,
    you: 'You',
    dead: 'Dead',
    silenced: 'Silenced',
    away: 'Away',
    family: 'Family',
    votes: (n: number): string => `${n} vote${n === 1 ? '' : 's'}`,
    openVote: 'Open the vote now',
    deadNote: 'You are dead. Watch the rest of the game in silence.',
    deadChat: 'The dead do not speak.',
    pick: 'Tap a player to choose.',
    confirm: 'Confirm',
    skip: 'Skip tonight',
    youChose: (name: string): string => `You chose ${name}.`,
    youSkipped: 'You let the night pass.',
    nobody: 'nobody',
    checksTitle: 'Your investigations',
    bulletLeft: 'One bullet left',
    bulletSpent: 'Bullet spent',
    self: '(you)',
    tabs: { players: 'Town', stage: 'Table', log: 'Log & chat' },
  },

  end: {
    rolesTitle: 'Who was who',
    youWon: 'Your side won.',
    youLost: 'Your side lost.',
    spectated: 'You watched this one.',
  },

  help: {
    title: 'How Omertà works',
    lines: [
      'Everyone is dealt a secret role. The family (Godfather, Mafia, Silencer) knows each other; nobody else knows anything.',
      'At night the family picks a victim. The Doctor saves someone, the Bodyguard guards someone, the Detective investigates someone, the Silencer gags someone, and the Sniper may spend a single bullet.',
      'At dawn the town learns who died. By day it talks, then votes: the most-voted player is hanged. A tie hangs nobody.',
      'The town wins when the family is gone. The family wins when it matches the rest of the town. The Jester wins alone by getting hanged.',
      'The dead do not speak. The Godfather reads as innocent to the Detective.',
    ],
  },

  result: {
    guilty: 'family',
    innocent: 'not family',
    checked: (name: string, verdict: string): string => `${name} is ${verdict}.`,
  },
};

export type MafDict = typeof mafEn;
