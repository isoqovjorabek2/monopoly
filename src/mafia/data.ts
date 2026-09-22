import type { MafiaRole, MafiaTeam, NightKind, RoleCount } from './types';

/* The cast, the presets, and how a table is balanced as it grows. */

export const MAF_MIN_PLAYERS = 4;
export const MAF_MAX_SEATS = 15;
/** Bots a practice table seats beside you: seven at the table deals a
 *  doctor and a detective beside two of the family. */
export const MAF_PRACTICE_BOTS = 6;

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

/** The family, for the private teammates list and win checks. */
export const MAFIA_SIDE: MafiaRole[] = ['godfather', 'mafia', 'silencer'];

/** Every role, in the order the lobby lists them. */
export const ALL_ROLES: MafiaRole[] = [
  'mafia', 'godfather', 'silencer', 'doctor', 'detective', 'bodyguard', 'sniper', 'jester', 'villager',
];

/** The most of one role a table may deal. */
export const ROLE_MAX: Record<MafiaRole, number> = {
  mafia: 4, godfather: 1, silencer: 1, doctor: 2, detective: 2, bodyguard: 2, sniper: 1, jester: 1, villager: 10,
};

/** What each role may do at night. The sniper's shot is a daytime one. */
export const NIGHT_KINDS: Partial<Record<MafiaRole, NightKind[]>> = {
  mafia: ['kill'],
  godfather: ['kill'],
  silencer: ['silence'],
  doctor: ['protect'],
  detective: ['investigate', 'shoot'],
  bodyguard: ['guard'],
};

export interface MafiaPreset { id: string; min: number; max: number; roles: RoleCount[] }

export const MAF_PRESETS: MafiaPreset[] = [
  {
    id: 'small', min: 4, max: 6,
    roles: [{ role: 'mafia', count: 1 }, { role: 'detective', count: 1 }, { role: 'villager', count: 4 }],
  },
  {
    id: 'medium', min: 7, max: 10,
    roles: [
      { role: 'mafia', count: 2 }, { role: 'doctor', count: 1 }, { role: 'detective', count: 1 },
      { role: 'villager', count: 6 },
    ],
  },
  {
    id: 'large', min: 11, max: 15,
    roles: [
      { role: 'mafia', count: 3 }, { role: 'godfather', count: 1 }, { role: 'doctor', count: 1 },
      { role: 'detective', count: 1 }, { role: 'bodyguard', count: 1 }, { role: 'sniper', count: 1 },
      { role: 'villager', count: 7 },
    ],
  },
  {
    id: 'chaos', min: 8, max: 15,
    roles: [
      { role: 'mafia', count: 2 }, { role: 'godfather', count: 1 }, { role: 'silencer', count: 1 },
      { role: 'doctor', count: 1 }, { role: 'detective', count: 1 }, { role: 'bodyguard', count: 1 },
      { role: 'sniper', count: 1 }, { role: 'jester', count: 1 }, { role: 'villager', count: 5 },
    ],
  },
];

/** The cast for a table of n, balanced by size. */
export function autoRoles(n: number): RoleCount[] {
  if (n <= 3) return [{ role: 'mafia', count: 1 }, { role: 'villager', count: Math.max(n - 1, 0) }];
  if (n <= 6) return [{ role: 'mafia', count: 1 }, { role: 'detective', count: 1 }, { role: 'villager', count: n - 2 }];
  if (n <= 10) {
    return [
      { role: 'mafia', count: 2 }, { role: 'doctor', count: 1 }, { role: 'detective', count: 1 },
      { role: 'villager', count: n - 4 },
    ];
  }
  return [
    { role: 'mafia', count: 3 }, { role: 'godfather', count: 1 }, { role: 'doctor', count: 1 },
    { role: 'detective', count: 1 }, { role: 'bodyguard', count: 1 }, { role: 'sniper', count: 1 },
    { role: 'jester', count: 1 }, { role: 'villager', count: Math.max(n - 9, 2) },
  ];
}

export const castSize = (roles: RoleCount[]): number => roles.reduce((n, r) => n + Math.max(0, r.count), 0);

export type CastProblem = 'size' | 'no_mafia' | 'no_town' | 'mafia_heavy';

/** Why a cast cannot be dealt to n players, or null when it can. */
export function castProblem(roles: RoleCount[], n: number): CastProblem | null {
  const total = castSize(roles);
  const mafia = roles.filter((r) => MAFIA_SIDE.includes(r.role)).reduce((s, r) => s + r.count, 0);
  const town = total - mafia;
  if (total !== n) return 'size';
  if (mafia === 0) return 'no_mafia';
  if (town === 0) return 'no_town';
  if (mafia >= town) return 'mafia_heavy';
  return null;
}

/** The roles a table of n actually deals: the host's cast when it fits,
 *  the balanced one otherwise. Before the shuffle. */
export function dealRoles(chosen: RoleCount[] | null, n: number): MafiaRole[] {
  const cast = chosen && castProblem(chosen, n) === null ? chosen : autoRoles(n);
  const out: MafiaRole[] = [];
  for (const r of cast) for (let i = 0; i < r.count; i++) out.push(r.role);
  while (out.length < n) out.push('villager');
  return out.slice(0, n);
}
