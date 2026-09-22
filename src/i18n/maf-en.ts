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
      brief: 'You lead the family and have the final say on each night\'s victim. The detective reads you as a villager.',
    },
    mafia: {
      name: 'Mafia',
      brief: 'One of the family. Each night, name a victim with your people - and blend in by day.',
    },
    silencer: {
      name: 'Silencer',
      brief: 'One of the family. Each night you gag one player: they cannot speak during the next day\'s talk.',
    },
    doctor: {
      name: 'Doctor',
      brief: 'Each night, protect one player - yourself included. Not the same one two nights running.',
    },
    detective: {
      name: 'Detective',
      brief: 'Each night, investigate a player to learn their role - or shoot a suspect. Your shot gets past the doctor.',
    },
    bodyguard: {
      name: 'Bodyguard',
      brief: 'Each night, guard one player. If they are attacked, you die in their place.',
    },
    sniper: {
      name: 'Sniper',
      brief: 'One bullet for the whole game, fired by day. Make it count.',
    },
    jester: {
      name: 'Jester',
      brief: 'You answer to no one. Get the town to hang you - or the sniper to shoot you - and you alone win.',
    },
    villager: {
      name: 'Villager',
      brief: 'No night business. Watch, listen, and vote the family out by day.',
    },
  } satisfies Record<MafiaRole, { name: string; brief: string }>,

  home: {
    lead: 'A family hides among the town. Each night they choose a victim; each day the town talks, points fingers and hangs somebody. The doctor, the detective and the rest work in the dark - nobody knows who is who until it is over.',
    note: 'Four to fifteen at the table, bots filling any empty chair. One of you hosts, the rest connect straight to that tab. No signup, no install.',
    cast: ['godfather', 'detective', 'doctor'] as MafiaRole[],
  },

  lobby: {
    castTitle: 'The cast',
    auto: 'Balanced',
    autoNote: 'The cast is balanced to the number at the table.',
    custom: 'Custom',
    presets: {
      small: ['Classic small', '4-6 players. Clean and simple.'],
      medium: ['Classic', '7-10 players. The standard game.'],
      large: ['Classic large', '11-15 players, with special roles.'],
      chaos: ['Chaos', '8-15 players. Special roles everywhere.'],
    } as Record<'small' | 'medium' | 'large' | 'chaos', [string, string]>,
    total: (cast: number, table: number): string => `${cast} roles for ${table} players`,
    problems: {
      size: 'The cast has to match the number of players.',
      no_mafia: 'The cast needs at least one of the family.',
      no_town: 'The cast needs at least one townsperson.',
      mafia_heavy: 'The family would match the town from the start.',
    } as Record<'size' | 'no_mafia' | 'no_town' | 'mafia_heavy', string>,
    fallback: 'If it still does not fit when the game starts, the table deals a balanced cast instead.',
    timers: 'Phase clocks',
    night: 'Night',
    day: 'Day talk',
    vote: 'Vote',
    seconds: (n: number): string => `${n}s`,
    revealRoles: 'Reveal roles of the dead',
    revealRolesNote: 'Off keeps the town guessing who it buried.',
    tableSize: 'Players at the table',
    needPlayers: (n: number): string => `Omertà needs at least ${n} players - add bots, or let bots fill the table.`,
    fillNote: 'Empty chairs up to four are filled with bots when the game starts.',
    publicSoon: 'Omertà tables are invite-only for now: share the link.',
  },

  reveal: {
    title: 'The town takes its seats',
    lead: 'Your role is yours alone. Say nothing.',
    yourRole: 'You are',
    teammatesTitle: 'The family',
    ack: 'Take my seat',
  },

  night: {
    title: (round: number): string => `Night ${round}`,
    lead: 'The town sleeps. The night people go about their business.',
    asleep: 'You have no night business. Wait for dawn - and keep your eyes shut.',
    choose: {
      kill: 'Choose the family\'s victim',
      silence: 'Choose who cannot speak tomorrow',
      protect: 'Choose who to protect tonight',
      investigate: 'Choose who to investigate',
      shoot: 'Choose a suspect to shoot',
      guard: 'Choose who to guard tonight',
    },
    confirm: {
      kill: 'Mark them',
      silence: 'Silence them',
      protect: 'Protect them',
      investigate: 'Investigate',
      shoot: 'Shoot',
      guard: 'Guard them',
    },
    modes: { kill: 'Kill', silence: 'Silence', protect: 'Protect', investigate: 'Investigate', shoot: 'Shoot', guard: 'Guard' },
    investigateNote: 'Learn this player\'s role. The Godfather reads as a villager.',
    shootNote: 'Kill this player tonight. The doctor cannot stop it; a bodyguard can.',
    noRepeat: 'You protected them last night.',
    boss: (name: string): string => `${name} has the final say tonight. Your pick is advice.`,
    youAreBoss: 'You have the family\'s final say tonight.',
    crew: 'Your family - never a target',
    picks: 'The family\'s picks',
    submitted: 'Your business is done. Wait for dawn.',
    waiting: 'The night is not over yet…',
  },

  dawn: {
    title: 'Dawn',
    quiet: 'The night passed quietly. Nobody died.',
    died: (name: string): string => `${name} was found dead - the family has claimed a victim.`,
    guarded: (name: string, saved: string): string => `${name} gave their life to protect ${saved}.`,
    shot: (name: string): string => `The detective shot ${name}.`,
    sniped: (name: string): string => `A shot rings out - ${name} has been sniped.`,
    saved: (name: string): string => `${name} was attacked, but the doctor saved them.`,
    roleWas: (role: string): string => `They were the ${role}.`,
  },

  day: {
    title: (round: number): string => `Day ${round}`,
    lead: 'The town talks. Somebody here is family.',
    silenced: (name: string): string => `${name} has been silenced and cannot speak today.`,
    silencedYou: 'You have been silenced. You cannot speak until the vote.',
    snipe: {
      title: 'Your one bullet',
      note: 'Fire now and it lands at once, in front of everyone.',
      confirm: 'Fire',
      spent: 'Your bullet is spent.',
    },
  },

  vote: {
    title: 'The vote',
    lead: 'Point a finger. The town\'s choice is hanged; a tie hangs nobody.',
    youVoted: (name: string): string => `You pointed at ${name}.`,
    retract: 'Take it back',
    change: 'Change',
    waiting: (n: number): string => `Waiting on ${n} vote${n === 1 ? '' : 's'}…`,
    lynched: (name: string): string => `The town hanged ${name}.`,
    roleWas: (role: string): string => `They were the ${role}.`,
    tie: 'The vote was tied. Nobody is hanged.',
    noVotes: 'Nobody voted. Nobody is hanged.',
  },

  over: {
    title: 'The dust settles',
    mafiaWins: 'The family owns the town.',
    villageWins: 'The town ran the family out.',
    jesterWins: (name: string): string => `${name} played you all. The Jester wins alone.`,
    abandoned: 'The night ledger was lost with the host. The match ends here.',
  },

  end: {
    rolesTitle: 'Who was who',
    youWon: 'Your side won.',
    youLost: 'Your side lost.',
    spectated: 'You watched this one.',
    mvp: 'MVP',
    mvpYou: 'You are the MVP',
    stat: {
      kills: (n: number): string => `${n} kill${n === 1 ? '' : 's'}`,
      saves: (n: number): string => `${n} save${n === 1 ? '' : 's'}`,
      reads: (n: number): string => `${n} good read${n === 1 ? '' : 's'}`,
      finds: (n: number): string => `${n} investigation${n === 1 ? '' : 's'}`,
      survived: 'survived',
      clutch: 'clutch play',
    },
    nearMiss: {
      survive: 'One vote from surviving.',
      town: 'The town was one hanging from cleaning house.',
      family: 'The family was one move from the win.',
    },
  },

  table: {
    alive: (n: number, total: number): string => `${n} of ${total} alive`,
    counts: (town: number, family: number, jester: number): string =>
      `Town ${town} · Family ${family}${jester > 0 ? ` · Jester ${jester}` : ''}`,
    you: 'You',
    dead: 'Dead',
    silenced: 'Silenced',
    away: 'Away',
    family: 'Family',
    boss: 'Boss',
    votes: (n: number): string => `${n} vote${n === 1 ? '' : 's'}`,
    skip: 'Skip to the next phase',
    deadNote: 'You are dead. Watch the rest of the game - you have one last word in the chat.',
    pick: 'Tap a player to choose.',
    confirm: 'Confirm',
    youChose: (name: string): string => `Your choice: ${name}.`,
    nobody: 'nobody',
    self: '(you)',
    checksTitle: 'Your investigations',
    tabs: { stage: 'Table', chat: 'Chat', log: 'Log' },
    layout: { label: 'Seating', grid: 'Grid', round: 'Round table' },
    music: 'Music',
  },

  chat: {
    placeholder: 'Say something, or @name to whisper…',
    familyPlaceholder: 'Talk to your family…',
    lastWordsPlaceholder: 'Your last words…',
    nightQuiet: 'Only the family speaks at night.',
    silenced: 'You are silenced until the vote.',
    lastWordsUsed: 'The dead have had their last word.',
    familyTag: 'Family',
    lastWordsTag: 'Last words',
    whisperTo: (name: string): string => `Whisper to ${name}`,
    whisperFrom: (name: string): string => `Whisper from ${name}`,
    empty: 'Nothing said yet.',
    send: 'Send',
    aria: 'Table chat',
  },

  result: {
    guilty: 'family',
    innocent: 'not family',
    checked: (name: string, role: string, verdict: string): string => `${name}: ${role} - ${verdict}.`,
  },

  help: {
    title: 'How Omertà works',
    lines: [
      'Everyone is dealt a secret role. The family (Godfather, Mafia, Silencer) knows each other; nobody else knows anything.',
      'At night the family marks a victim - the Godfather, or whoever leads them now, has the final say. The Doctor protects someone, the Bodyguard guards someone and dies in their place, the Detective investigates or shoots, and the Silencer gags someone for the next day.',
      'At dawn the town learns what happened. It talks until the day\'s clock runs out, then votes: the most-voted player is hanged, and a tie hangs nobody. The Sniper may fire their one bullet at any point in the day.',
      'The town wins when the family is gone. The family wins when it matches the rest of the town. The Jester wins alone by being hanged or shot.',
      'At night only the family can talk. The silenced cannot talk by day. The dead get one last word. Start a message with @name to whisper.',
    ],
  },
};

export type MafDict = typeof mafEn;
