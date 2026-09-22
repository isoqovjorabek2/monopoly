import { MAF_MIN_PLAYERS, ROLE_TEAM } from './data';
import type {
  MafiaAction, MafiaPrivate, MafiaRole, MafiaState, NightDuty,
} from './types';

/* ------------------------------------------------------------------ *
 * Pure queries. The reducer, the UI and the host's clock all read who
 * the table waits on and what each player may see from here, so there
 * is one definition of each.
 * ------------------------------------------------------------------ */

export type { NightDuty } from './types';

const DUTY_FOR_ROLE: Partial<Record<MafiaRole, NightDuty>> = {
  silencer: 'silence',
  doctor: 'save',
  detective: 'check',
  bodyguard: 'guard',
  sniper: 'shoot',
};

/** What the night still expects from one player, submitted or not. The
 *  sniper's duty lapses once the single bullet is spent. */
export function nightDuties(s: MafiaState, playerId: string): NightDuty[] {
  const sec = s.secret;
  if (!sec) return [];
  const role = sec.roles[playerId];
  if (!role) return [];
  const out: NightDuty[] = [];
  if (ROLE_TEAM[role] === 'mafia') out.push('kill');
  const duty = DUTY_FOR_ROLE[role];
  if (duty && !(role === 'sniper' && sec.sniperUsed[playerId])) out.push(duty);
  return out;
}

/** True while the night is still waiting on a submission from this seat. */
export function nightPendingFor(s: MafiaState, playerId: string): boolean {
  const sec = s.secret;
  if (!sec || s.phase !== 'night') return false;
  const p = s.players[playerId];
  if (!p || !p.alive) return false;
  return nightDuties(s, playerId).some((k) => !(k in sec.night));
}

/** Who the table is waiting on right now - the only players a timer or a
 *  dropped connection can hold the game up for. A guest copy holds no
 *  secret, so the night answers empty there. */
export function waitingOn(s: MafiaState): string[] {
  const alive = s.seats.filter((id) => Boolean(s.players[id]) && s.players[id].alive);
  switch (s.phase) {
    case 'reveal':
      return alive.filter((id) => !s.acks.includes(id));
    case 'night':
      return s.secret ? alive.filter((id) => nightPendingFor(s, id)) : [];
    case 'day':
      return alive;
    case 'vote':
      return alive.filter((id) => !s.silencedToday.includes(id) && !(id in s.votes));
    default:
      return [];
  }
}

/** What the clock is timing. The host's timeout and every player's
 *  on-screen countdown restart together whenever this changes. */
export const clockKey = (s: MafiaState): string =>
  `${s.phase}:${s.round}:${waitingOn(s).length}`;

/** Seconds on the clock for the decision in front of the table. 0 = none. */
export function clockSeconds(s: MafiaState): number {
  switch (s.phase) {
    case 'day':
      return s.settings.discussionSeconds || s.settings.turnTimer;
    case 'reveal':
    case 'night':
    case 'vote':
      return s.settings.turnTimer;
    default:
      return 0;
  }
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

  const me = s.players[a.playerId];
  if (!me || !me.alive) return false;
  const sec = s.secret;
  const aliveOther = (t: unknown): t is string =>
    typeof t === 'string' && t !== a.playerId && Boolean(s.players[t]) && s.players[t].alive;

  switch (a.type) {
    case 'ACK_ROLE':
      return s.phase === 'reveal' && !s.acks.includes(a.playerId);

    case 'NIGHT_KILL': {
      if (s.phase !== 'night' || !sec) return false;
      if (ROLE_TEAM[sec.roles[a.playerId]] !== 'mafia') return false;
      if (a.target === null) return true;
      return aliveOther(a.target) && ROLE_TEAM[sec.roles[a.target]] !== 'mafia';
    }
    case 'NIGHT_SILENCE':
      return s.phase === 'night' && !!sec && sec.roles[a.playerId] === 'silencer'
        && (a.target === null || aliveOther(a.target));
    case 'NIGHT_SAVE':
      return s.phase === 'night' && !!sec && sec.roles[a.playerId] === 'doctor'
        && (a.target === null || (typeof a.target === 'string' && Boolean(s.players[a.target]) && s.players[a.target].alive));
    case 'NIGHT_CHECK':
      return s.phase === 'night' && !!sec && sec.roles[a.playerId] === 'detective'
        && (a.target === null || aliveOther(a.target));
    case 'NIGHT_GUARD':
      return s.phase === 'night' && !!sec && sec.roles[a.playerId] === 'bodyguard'
        && (a.target === null || aliveOther(a.target));
    case 'NIGHT_SHOOT': {
      if (s.phase !== 'night' || !sec || sec.roles[a.playerId] !== 'sniper') return false;
      if (a.target === null) return true;
      return !sec.sniperUsed[a.playerId] && aliveOther(a.target);
    }

    case 'VOTE': {
      if (s.phase !== 'vote' || s.silencedToday.includes(a.playerId)) return false;
      return a.target === null || aliveOther(a.target);
    }
    default:
      return false;
  }
}

/* --------------------------- the private slice -------------------------- */

/**
 * One player's view of the hidden ledger, pushed over a direct host ->
 * guest message and never inside the broadcast snapshot. The mafia see
 * their team and the night's kill choice; the detective sees every check;
 * the sniper sees whether the bullet is still chambered.
 */
export function privateFor(s: MafiaState, playerId: string): MafiaPrivate | null {
  const sec = s.secret;
  if (!sec) return null;
  const role = sec.roles[playerId];
  if (!role) return null;
  const mafiaSide = ROLE_TEAM[role] === 'mafia';
  return {
    role,
    teammates: mafiaSide
      ? s.seats
        .filter((id) => ROLE_TEAM[sec.roles[id]] === 'mafia')
        .map((id) => ({ id, role: sec.roles[id] }))
      : [],
    sniperShotsLeft: sec.sniperUsed[playerId] ? 0 : 1,
    checks: sec.checks[playerId] ?? [],
    nightKill: mafiaSide && s.phase === 'night'
      ? { by: sec.night.killBy ?? null, target: sec.night.kill ?? null }
      : null,
    pending: s.phase === 'night' && s.players[playerId]?.alive
      ? nightDuties(s, playerId).filter((k) => !(k in sec.night))
      : [],
    chosen: s.phase === 'night'
      ? Object.fromEntries(
        nightDuties(s, playerId)
          .filter((k) => k !== 'kill' && k in sec.night)
          .map((k) => [k, sec.night[k] ?? null]),
      )
      : {},
  };
}
