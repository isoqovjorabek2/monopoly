import type { BotLevel, TokenId } from '../game/types';

/* ------------------------------------------------------------------ *
 * Omertà: the third game at the table. 1920s noir mafia.
 *
 * Same contract as the other two engines: plain JSON state, a pure
 * reducer, and a seeded deal. The one thing this game has that the
 * others do not is hidden information: roles and the night's moves live
 * in `secret`, which redactForGuests strips before a snapshot leaves the
 * host, and each player is pushed only their own slice (MafiaPrivate)
 * over a direct host -> guest message. A guest tab never holds another
 * player's role.
 *
 * The rules are the Mafia app's: night, a timed day of talk, a timed
 * vote; the detective may investigate or shoot, the bodyguard dies in the
 * place of whoever they guard, the sniper fires once, by day.
 * ------------------------------------------------------------------ */

export type MafiaRole =
  | 'godfather' | 'mafia' | 'silencer'
  | 'doctor' | 'detective' | 'bodyguard' | 'sniper'
  | 'jester' | 'villager';

/** Godfather, mafia and silencer are the family; the jester plays alone. */
export type MafiaTeam = 'mafia' | 'village' | 'jester';

export type MafiaPhase =
  | 'lobby'
  | 'night'
  /** The town talks, for daySeconds. */
  | 'day'
  | 'vote'
  | 'game_over';

/** How many of one role a table deals. */
export interface RoleCount { role: MafiaRole; count: number }

export interface MafiaSettings {
  seed: number;
  maxPlayers: number;
  botLevel: BotLevel;
  fillWithBots: boolean;
  nightSeconds: number;
  daySeconds: number;
  voteSeconds: number;
  /** Show the dead player's role; off keeps the town guessing. */
  revealRolesOnDeath: boolean;
  /** The cast the host chose, or null to balance it by table size. A cast
   *  that does not fit the table when the game starts is balanced too. */
  roles: RoleCount[] | null;
}

/** The part of the settings the lobby shows as Omertà's own rules. */
export type MafiaRules = Pick<
  MafiaSettings,
  'nightSeconds' | 'daySeconds' | 'voteSeconds' | 'revealRolesOnDeath' | 'roles'
>;

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

/** How somebody died - the town is told, like at a real table. */
export type DeathCause = 'mafia' | 'detective' | 'bodyguard' | 'vote' | 'sniper';

export interface MafiaDeath {
  id: string;
  /** null when the table plays with hidden roles. */
  role: MafiaRole | null;
  cause: DeathCause;
  /** For a bodyguard: whose life they bought with theirs. */
  saved?: string;
}

/** A move made at night. Each role has its own; the detective has two. */
export type NightKind = 'kill' | 'silence' | 'protect' | 'investigate' | 'shoot' | 'guard';

export interface NightMove { kind: NightKind; target: string }

export interface MafiaCheck {
  round: number;
  target: string;
  /** The role as the investigation shows it: the Godfather reads as a
   *  villager. */
  seen: MafiaRole;
  guilty: boolean;
}

/** One player's part in the match, for the MVP. */
export interface MatchStats { kills: number; saves: number; finds: number; reads: number }

/** The night ledger. Never leaves the host's tab inside a snapshot. */
export interface MafiaSecret {
  roles: Record<string, MafiaRole>;
  /** Tonight's moves, one per player; final once made. */
  night: Record<string, NightMove>;
  /** Doctor id -> who they protected last night; not the same one twice. */
  lastProtect: Record<string, string>;
  /** Snipers who have fired their one shot. */
  sniperUsed: string[];
  /** Detective id -> every result they have been given. */
  checks: Record<string, MafiaCheck[]>;
  stats: Record<string, MatchStats>;
}

/** One day's vote, as the table saw it close. */
export interface VoteRecord {
  round: number;
  /** Voter -> target. */
  votes: Record<string, string>;
  /** Who it hanged, or null for a tie or an empty vote. */
  hanged: string | null;
}

export interface MafiaMvp { id: string; stats: MatchStats; survived: boolean }

export interface MafiaState {
  kind: 'mafia';
  version: number;
  phase: MafiaPhase;
  settings: MafiaSettings;

  players: Record<string, MafiaPlayer>;
  seats: string[];

  /** Night number, from 1; the day after a night shares its number. */
  round: number;
  /** Vote phase: voter -> target. Public, as at a real table. A player
   *  who takes their vote back is simply absent. */
  votes: Record<string, string>;
  /** Gagged for today's talk. */
  silencedToday: string[];
  /** The latest deaths, for the announcement. */
  lastDeaths: MafiaDeath[];
  /** Who the doctor pulled back from the edge last night. */
  lastSaved: string[];
  /** The dead whose roles the table has been shown. */
  revealed: Record<string, MafiaRole>;
  /** The dead who have spoken their one line. */
  lastWords: string[];
  /** Living headcount by side, public only when roles are shown on death -
   *  otherwise it would give the family's number away. */
  aliveCounts: { village: number; mafia: number; jester: number } | null;

  winner: MafiaTeam | null;
  /** Set only for the jester's solo win. */
  winnerId: string | null;
  /** Every seat's role, made public once the game is over. */
  finalRoles: Record<string, MafiaRole> | null;
  mvp: MafiaMvp | null;
  /** The last hanging's margin over the runner-up, and who it took. */
  lastVoteMargin: number | null;
  finalEliminatedId: string | null;
  /** Every closed vote, oldest first: public, as the votes were. What the
   *  bots (and a sharp player) read suspicion from. Absent in a match
   *  saved before it existed. */
  voteHistory?: VoteRecord[];

  /** Host-only; null in every guest copy. */
  secret: MafiaSecret | null;
}

export type MafiaAction =
  | { type: 'START_GAME'; playerId: string }
  | { type: 'NIGHT_MOVE'; playerId: string; kind: NightKind; target: string }
  | { type: 'SNIPE'; playerId: string; target: string }
  /** A vote, or null to take one back. */
  | { type: 'VOTE'; playerId: string; target: string | null }
  /** The phase is over: its clock ran out, or the host skipped it. Sent by
   *  the host only, never accepted from a guest. */
  | { type: 'ADVANCE'; playerId: string };

export type MafiaEvent =
  | { type: 'GAME_STARTED' }
  | { type: 'NIGHT_FALLS'; round: number }
  /** A night move landed - who moved, never what they chose. Stays on
   *  the host (see publicMafEvents). */
  | { type: 'ACTED'; playerId: string }
  | { type: 'DAWN'; round: number; deaths: MafiaDeath[]; saved: string[]; silenced: string[] }
  | { type: 'DAY_STARTED'; round: number }
  | { type: 'VOTE_OPENED'; round: number }
  | { type: 'VOTED'; playerId: string; target: string | null }
  | { type: 'LYNCHED'; playerId: string; role: MafiaRole | null }
  | { type: 'NO_LYNCH'; tie: boolean }
  | { type: 'SNIPED'; playerId: string; role: MafiaRole | null }
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
  /** The family sees the whole family; everyone else an empty list. */
  teammates: { id: string; role: MafiaRole }[];
  /** Who has the family's final say tonight. */
  boss: string | null;
  /** The night moves this player may make; empty for those who sleep. */
  kinds: NightKind[];
  /** This player's own move tonight, once made. */
  move: NightMove | null;
  /** The family's kill picks so far tonight: member -> target. */
  familyPicks: Record<string, string>;
  /** Doctor: the one player they may not protect tonight. */
  noProtect: string | null;
  /** Sniper: whether the one shot is still there. */
  shotLeft: boolean;
  /** Detective: every result so far, oldest first. */
  checks: MafiaCheck[];
}
