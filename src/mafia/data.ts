import type { MafiaRole, MafiaTeam } from './types';

/* The cast, and how many of each take a seat as the table grows. */

export const MAF_MIN_PLAYERS = 5;
export const MAF_MAX_SEATS = 12;

export const ROLE_TEAM: Record<MafiaRole, MafiaTeam> = {
  godfather: 'mafia',
  mafia: 'mafia',
  silencer: 'mafia',
  doctor: 'village',
  detective: 'village',
  bodyguard: 'village',
  sniper: 'village',
  jester: 'jester',
  villager: 'village',
};

/** Mafia-aligned roles, for the private teammates list and win checks. */
export const MAFIA_SIDE: MafiaRole[] = ['godfather', 'mafia', 'silencer'];

/**
 * The deal for each table size: roughly a third of the town is mafia,
 * the special village roles arrive as the table grows, and the godfather
 * always sits at the head. Index by exact player count.
 */
export const ROLE_DEAL: Record<number, MafiaRole[]> = {
  5: ['godfather', 'doctor', 'detective', 'villager', 'villager'],
  6: ['godfather', 'mafia', 'doctor', 'detective', 'villager', 'villager'],
  7: ['godfather', 'mafia', 'doctor', 'detective', 'bodyguard', 'villager', 'villager'],
  8: ['godfather', 'mafia', 'silencer', 'doctor', 'detective', 'bodyguard', 'villager', 'villager'],
  9: ['godfather', 'mafia', 'silencer', 'doctor', 'detective', 'bodyguard', 'jester', 'villager', 'villager'],
  10: ['godfather', 'mafia', 'silencer', 'doctor', 'detective', 'bodyguard', 'jester', 'villager', 'villager', 'villager'],
  11: ['godfather', 'mafia', 'silencer', 'doctor', 'detective', 'bodyguard', 'sniper', 'jester', 'villager', 'villager', 'villager'],
  12: ['godfather', 'mafia', 'mafia', 'silencer', 'doctor', 'detective', 'bodyguard', 'sniper', 'jester', 'villager', 'villager', 'villager'],
};

/** The roles dealt to a table of n players, before the shuffle. */
export const dealRoles = (n: number): MafiaRole[] =>
  ROLE_DEAL[Math.max(MAF_MIN_PLAYERS, Math.min(MAF_MAX_SEATS, n))].slice();
