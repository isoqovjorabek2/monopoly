import { MAFIA_SIDE, MAF_MIN_PLAYERS, NIGHT_KINDS, ROLE_TEAM } from './data';
import type {
  MafiaAction, MafiaPrivate, MafiaRole, MafiaState, NightKind,
} from './types';

/* ------------------------------------------------------------------ *
 * Pure queries. The reducer, the UI and the host's clock all read who
 * the table waits on and what each player may see from here, so there
 * is one definition of each.
 * ------------------------------------------------------------------ */

export const isFamily = (role: MafiaRole | undefined): boolean => role != null && MAFIA_SIDE.includes(role);

/** The moves a role may make at night; empty for those who sleep. */
export const nightKinds = (role: MafiaRole | undefined): NightKind[] => (role ? NIGHT_KINDS[role] ?? [] : []);

/**
 * The moves one seat may make tonight. A Silencer left as the last of the
 * family inherits the knife, or the family could never kill again: they
 * choose between the gag and the kill, one move a night like everyone.
 */
export function nightKindsFor(s: MafiaState, playerId: string): NightKind[] {
  const sec = s.secret;
  const role = sec?.roles[playerId];
  if (!sec || !role) return [];
  if (role === 'silencer') {
    const killers = s.seats.some((id) => s.players[id]?.alive && (sec.roles[id] === 'mafia' || sec.roles[id] === 'godfather'));
    if (!killers) return ['kill', 'silence'];
  }
  return nightKinds(role);
}

/** True while the night still waits on this seat's move. */
export function nightPendingFor(s: MafiaState, playerId: string): boolean {
  const sec = s.secret;
  if (!sec || s.phase !== 'night') return false;
  const p = s.players[playerId];
  if (!p?.alive) return false;
  return nightKindsFor(s, playerId).length > 0 && !(playerId in sec.night);
}

/** Who the table is waiting on right now. The day waits on nobody - it
 *  runs on the clock. A guest copy holds no secret, so the night answers
 *  empty there. */
export function waitingOn(s: MafiaState): string[] {
  const alive = s.seats.filter((id) => s.players[id]?.alive);
  switch (s.phase) {
    case 'night':
      return s.secret ? alive.filter((id) => nightPendingFor(s, id)) : [];
    case 'vote':
      return alive.filter((id) => !(id in s.votes));
    default:
      return [];
  }
}

/** What the clock is timing: one clock per phase, never restarted. */
export const clockKey = (s: MafiaState): string => `${s.phase}:${s.round}`;

/** Seconds on the clock for the phase in front of the table. */
export function clockSeconds(s: MafiaState): number {
  switch (s.phase) {
    case 'night': return s.settings.nightSeconds;
    case 'day': return s.settings.daySeconds;
    case 'vote': return s.settings.voteSeconds;
    default: return 0;
  }
}

/**
 * Who has the family's final say tonight: the Godfather while he lives,
 * then the Silencer, then the first of the rest at the table.
 */
export function actingBoss(s: MafiaState): string | null {
  const sec = s.secret;
  if (!sec) return null;
  const family = s.seats.filter((id) => s.players[id]?.alive && isFamily(sec.roles[id]));
  return family.find((id) => sec.roles[id] === 'godfather')
    ?? family.find((id) => sec.roles[id] === 'silencer')
    ?? family[0]
    ?? null;
}

/* ---------------------------- legal actions ---------------------------- *
 * The one authority. A guest's intent arrives as parsed JSON and is
 * trusted for nothing: not its shape, not its targets.
 * ---------------------------------------------------------------------- */

export function isLegal(s: MafiaState, a: MafiaAction): boolean {
  if (!a || typeof a !== 'object' || typeof a.type !== 'string' || typeof a.playerId !== 'string') return false;
  if (a.type === 'START_GAME') {
    return s.phase === 'lobby' && s.seats.includes(a.playerId) && s.seats.length >= MAF_MIN_PLAYERS;
  }
  if (a.type === 'ADVANCE') return s.phase === 'night' || s.phase === 'day' || s.phase === 'vote';

  const me = s.players[a.playerId];
  if (!me || !me.alive) return false;
  const sec = s.secret;
  const aliveOther = (t: unknown): t is string =>
    typeof t === 'string' && t !== a.playerId && Boolean(s.players[t]?.alive);

  switch (a.type) {
    case 'NIGHT_MOVE': {
      if (s.phase !== 'night' || !sec || a.playerId in sec.night) return false;
      if (!nightKindsFor(s, a.playerId).includes(a.kind)) return false;
      if (a.kind === 'protect') {
        // The doctor may keep themselves alive, but not the same patient twice running.
        return typeof a.target === 'string' && Boolean(s.players[a.target]?.alive)
          && sec.lastProtect[a.playerId] !== a.target;
      }
      if (!aliveOther(a.target)) return false;
      // The family never marks its own.
      if (a.kind === 'kill') return !isFamily(sec.roles[a.target]);
      return true;
    }
    case 'SNIPE':
      return s.phase === 'day' && !!sec && sec.roles[a.playerId] === 'sniper'
        && !sec.sniperUsed.includes(a.playerId) && aliveOther(a.target);
    case 'VOTE':
      if (s.phase !== 'vote') return false;
      return a.target === null ? a.playerId in s.votes : aliveOther(a.target);
    default:
      return false;
  }
}

/* --------------------------- the private slice -------------------------- */

/**
 * One player's view of the hidden ledger, pushed over a direct host ->
 * guest message and never inside the broadcast snapshot.
 */
export function privateFor(s: MafiaState, playerId: string): MafiaPrivate | null {
  const sec = s.secret;
  if (!sec) return null;
  const role = sec.roles[playerId];
  if (!role) return null;
  const family = isFamily(role);
  const picks: Record<string, string> = {};
  if (family && s.phase === 'night') {
    for (const [id, m] of Object.entries(sec.night)) if (m.kind === 'kill') picks[id] = m.target;
  }
  return {
    role,
    teammates: family
      ? s.seats.filter((id) => isFamily(sec.roles[id])).map((id) => ({ id, role: sec.roles[id] }))
      : [],
    boss: family ? actingBoss(s) : null,
    kinds: s.players[playerId]?.alive ? nightKindsFor(s, playerId) : [],
    move: s.phase === 'night' ? sec.night[playerId] ?? null : null,
    familyPicks: picks,
    noProtect: role === 'doctor' ? sec.lastProtect[playerId] ?? null : null,
    shotLeft: role === 'sniper' && !sec.sniperUsed.includes(playerId),
    checks: sec.checks[playerId] ?? [],
  };
}

/** The side a role wins with. */
export const teamOf = (role: MafiaRole): 'mafia' | 'village' | 'jester' => ROLE_TEAM[role];
