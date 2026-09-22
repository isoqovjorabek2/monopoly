import type { BotLevel, TokenId } from '../game/types';

/* ------------------------------------------------------------------ *
 * Omertà: the third game at the table. 1920s noir mafia.
 *
 * Same contract as the other two engines: plain JSON state, a pure
 * reducer, and a seeded deal. The one thing this game has that the
 * others do not is hidden information: roles live in `secret`, which
 * redactForGuests strips before a snapshot leaves the host, and each
 * player is pushed only their own slice (MafiaPrivate) over a direct
 * host -> guest message. A guest tab never holds another player's role.
 * ------------------------------------------------------------------ */

export type MafiaRole =
  | 'godfather' | 'mafia' | 'silencer'
  | 'doctor' | 'detective' | 'bodyguard' | 'sniper'
  | 'jester' | 'villager';

/** The night ledger keys a role is responsible for. The kill belongs to
 *  the whole mafia team; killBy records who set it, it is not a duty. */
export type NightDuty = 'kill' | 'silence' | 'save' | 'check' | 'guard' | 'shoot';

/** Godfather, mafia and silencer are one team; the jester plays alone. */
export type MafiaTeam = 'mafia' | 'village' | 'jester';

export type MafiaPhase =
  | 'lobby'
  /** Roles are out; everyone acknowledges theirs before the first night. */
  | 'reveal'
  | 'night'
  /** Discussion, for discussionSeconds. */
  | 'day'
  | 'vote'
  | 'game_over';

export interface MafiaSettings {
  seed: number;
  maxPlayers: number;
  botLevel: BotLevel;
  fillWithBots: boolean;
  /** Seconds for each decision before the host plays it. 0 = no clock. */
  turnTimer: number;
  /** Seconds the town discusses before the vote opens. */
  discussionSeconds: number;
  /** Show the dead player's role; off keeps the town guessing. */
  revealRolesOnDeath: boolean;
}

/** The part of the settings the lobby shows as Omertà's own rules. */
export type MafiaRules = Pick<MafiaSettings, 'discussionSeconds' | 'revealRolesOnDeath'>;

export interface MafiaPlayer {
  id: string;
  name: string;
  token: TokenId;
  color: string;
  isBot: boolean;
  botLevel: BotLevel;
  connected: boolean;
  alive: boolean;
}

export interface MafiaDeath {
  id: string;
  /** null when the table plays with hidden roles. */
  role: MafiaRole | null;
}

/**
 * One night's business. A key is absent until that actor has submitted;
 * the mafia kill may be revised by the team while the night is young, so
 * killBy records who set the current choice. The sniper's null means
 * "holding fire" - an explicit submission, not an absent one.
 */
export interface MafiaNight {
  killBy?: string;
  kill?: string | null;
  silence?: string | null;
  save?: string | null;
  check?: string | null;
  guard?: string | null;
  shoot?: string | null;
}

export interface MafiaCheck {
  round: number;
  target: string;
  guilty: boolean;
}

/** The night ledger. Never leaves the host's tab inside a snapshot. */
export interface MafiaSecret {
  roles: Record<string, MafiaRole>;
  /** The sniper carries a single bullet for the whole game. */
  sniperUsed: Record<string, boolean>;
  night: MafiaNight;
  /** Detective id -> every result they have been given. */
  checks: Record<string, MafiaCheck[]>;
}

export interface MafiaState {
  kind: 'mafia';
  version: number;
  phase: MafiaPhase;
  settings: MafiaSettings;

  players: Record<string, MafiaPlayer>;
  seats: string[];

  /** Night/day number, from 1. */
  round: number;
  /** Reveal phase: who has seen their role. */
  acks: string[];
  /** Vote phase: voter -> target, null an abstention. Public, as at a
   *  real table. */
  votes: Record<string, string | null>;
  silencedToday: string[];
  /** The most recent announcement (dawn deaths or a lynching). */
  lastDeaths: MafiaDeath[];

  winner: MafiaTeam | null;
  /** Set only for the jester's solo win. */
  winnerId: string | null;
  /** The dead whose roles the table has been shown, as the game goes -
   *  empty when the table plays with hidden roles. Absent in old saves. */
  revealed?: Record<string, MafiaRole>;
  /** Every seat's role, made public once the game is over - the table
   *  finally learns who was who. Null until then. */
  finalRoles: Record<string, MafiaRole> | null;

  /** Host-only; null in every guest copy. */
  secret: MafiaSecret | null;
}

export type MafiaAction =
  | { type: 'START_GAME'; playerId: string }
  | { type: 'ACK_ROLE'; playerId: string }
  | { type: 'NIGHT_KILL'; playerId: string; target: string | null }
  | { type: 'NIGHT_SILENCE'; playerId: string; target: string | null }
  | { type: 'NIGHT_SAVE'; playerId: string; target: string | null }
  | { type: 'NIGHT_CHECK'; playerId: string; target: string | null }
  | { type: 'NIGHT_GUARD'; playerId: string; target: string | null }
  | { type: 'NIGHT_SHOOT'; playerId: string; target: string | null }
  | { type: 'VOTE'; playerId: string; target: string | null }
  /** Sent by the host when a player's clock runs out: the engine makes
   *  their pending decision for them (an abstention, a held bullet, a
   *  passed night). In the day phase it closes the discussion. */
  | { type: 'TIME_OUT'; playerId: string };

export type MafiaEvent =
  | { type: 'GAME_STARTED' }
  | { type: 'NIGHT_FALLS'; round: number }
  /** A night move landed - who moved, never what they chose. */
  | { type: 'ACTED'; playerId: string }
  | { type: 'DAWN'; round: number; deaths: MafiaDeath[] }
  | { type: 'SILENCED'; playerId: string }
  | { type: 'DAY_STARTED'; round: number }
  | { type: 'VOTED'; playerId: string; target: string | null }
  | { type: 'LYNCHED'; playerId: string; role: MafiaRole | null }
  | { type: 'NO_LYNCH' }
  | { type: 'TIMED_OUT'; playerId: string }
  /** A signed-in player took over a bot's seat mid-game. */
  | { type: 'SEAT_TAKEN'; playerId: string; name: string; previous: string }
  | { type: 'GAME_OVER'; winner: MafiaTeam | null; winnerId: string | null };

export interface MafiaReduction {
  state: MafiaState;
  events: MafiaEvent[];
}

/**
 * The private slice the host pushes to one player only, over a direct
 * message - never inside the broadcast snapshot. Recomputed after every
 * publish; the guest replaces its copy wholesale.
 */
export interface MafiaPrivate {
  role: MafiaRole;
  /** Mafia-aligned seats see the whole team; everyone else an empty list. */
  teammates: { id: string; role: MafiaRole }[];
  /** The sniper's remaining bullets: 1 until spent. */
  sniperShotsLeft: number;
  /** The detective's results so far, oldest first. */
  checks: MafiaCheck[];
  /** The team's kill choice so far this night; null for the village. */
  nightKill: { by: string | null; target: string | null } | null;
  /** What the night still waits on from this player; empty by day, once
   *  they have moved, or when they have no night business at all. */
  pending: NightDuty[];
  /** This player's own night moves so far (the team kill is nightKill). */
  chosen: Partial<Record<NightDuty, string | null>>;
}
