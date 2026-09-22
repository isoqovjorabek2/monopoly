import { rand } from '../game/rng';
import { MAFIA_SIDE } from './data';
import type { MafiaAction, MafiaRole, MafiaState } from './types';

/* ------------------------------------------------------------------ *
 * Omertà bots. Same house rules as the other two games: a bot decides
 * from what its seat can see, difficulty never buys information, and
 * every pick is a pure function of the state - the host applies these,
 * so a replay of (seed, actions) must land on the same choices.
 *
 * One decision per call. The mafia's silencer, for instance, first sets
 * the family kill and only gags on the next pass, once the kill is in.
 * ------------------------------------------------------------------ */

const seatIndex = (s: MafiaState, pid: string): number => Math.max(0, s.seats.indexOf(pid));

/** A deterministic roll in [0, 1) for one bot's one decision. */
const coin = (s: MafiaState, pid: string, salt: number): number =>
  rand(s.settings.seed, s.version * 131 + s.round * 17 + seatIndex(s, pid) * 7 + salt);

const pick = <T,>(s: MafiaState, pid: string, salt: number, options: readonly T[]): T | null =>
  options.length === 0 ? null : options[Math.floor(coin(s, pid, salt) * options.length) % options.length];

const alive = (s: MafiaState): string[] => s.seats.filter((id) => s.players[id]?.alive);

const isFamily = (s: MafiaState, id: string): boolean => {
  const role = s.secret?.roles[id];
  return role != null && MAFIA_SIDE.includes(role);
};

export function mfBotDecide(state: MafiaState, pid: string): MafiaAction | null {
  const me = state.players[pid];
  const secret = state.secret;
  if (!me || !me.isBot || !me.alive || !secret) return null;
  const role = secret.roles[pid];
  if (!role) return null;

  switch (state.phase) {
    case 'reveal':
      return state.acks.includes(pid) ? null : { type: 'ACK_ROLE', playerId: pid };
    case 'night':
      return nightMove(state, pid, role);
    case 'vote':
      return voteMove(state, pid, role);
    default:
      return null;
  }
}

/* ------------------------------- night ------------------------------ */

function nightMove(s: MafiaState, pid: string, role: MafiaRole): MafiaAction | null {
  const night = s.secret!.night;
  const others = alive(s).filter((id) => id !== pid);
  const town = alive(s).filter((id) => !isFamily(s, id));

  // The family settles on a victim together; any of them may set or
  // revise the choice while the night is young. A bot sets it once.
  if (MAFIA_SIDE.includes(role) && !('kill' in night)) {
    return { type: 'NIGHT_KILL', playerId: pid, target: pick(s, pid, 3, town) };
  }

  switch (role) {
    case 'silencer':
      if ('silence' in night) return null;
      return { type: 'NIGHT_SILENCE', playerId: pid, target: pick(s, pid, 5, town.filter((id) => id !== pid)) };
    case 'doctor':
      if ('save' in night) return null;
      return { type: 'NIGHT_SAVE', playerId: pid, target: pick(s, pid, 7, alive(s)) };
    case 'detective': {
      if ('check' in night) return null;
      const seen = new Set((s.secret!.checks[pid] ?? []).map((c) => c.target));
      const fresh = others.filter((id) => !seen.has(id));
      return { type: 'NIGHT_CHECK', playerId: pid, target: pick(s, pid, 11, fresh.length > 0 ? fresh : others) };
    }
    case 'bodyguard':
      if ('guard' in night) return null;
      return { type: 'NIGHT_GUARD', playerId: pid, target: pick(s, pid, 13, others) };
    case 'sniper': {
      if (s.secret!.sniperUsed[pid] || 'shoot' in night) return null;
      // One bullet for the whole game: the bot holds fire early, and from
      // the second night on spends it on even turns of the ledger.
      const shoot = s.round >= 2 && (s.version + s.round) % 2 === 0;
      const target = shoot ? pick(s, pid, 17, others) : null;
      return { type: 'NIGHT_SHOOT', playerId: pid, target };
    }
    default:
      return null;
  }
}

/* ------------------------------- vote ------------------------------- */

function voteMove(s: MafiaState, pid: string, role: MafiaRole): MafiaAction | null {
  if (s.silencedToday.includes(pid) || pid in s.votes) return null;

  const abstain = { type: 'VOTE', playerId: pid, target: null } as const;
  if (coin(s, pid, 19) < 0.25) return abstain;

  const others = alive(s).filter((id) => id !== pid);
  let pool: string[];
  if (MAFIA_SIDE.includes(role)) {
    pool = others.filter((id) => !isFamily(s, id));
  } else if (role === 'detective') {
    // A guilty reading from an earlier night is the one sure finger the
    // detective has to point; the Godfather never shows up in it.
    const guilty = (s.secret!.checks[pid] ?? []).filter((c) => c.guilty && s.players[c.target]?.alive);
    if (guilty.length > 0) return { type: 'VOTE', playerId: pid, target: guilty[guilty.length - 1].target };
    pool = others;
  } else {
    pool = others;
  }
  return { type: 'VOTE', playerId: pid, target: pick(s, pid, 23, pool) };
}

/* ------------------------------ pacing ------------------------------ */

/** Human-feeling delay. Night business and a hanging vote get a longer
 *  pause than acknowledging a role; the jitter is seeded like the other
 *  games, so pacing never leaks into the decision log. */
export function mfBotDelay(state: MafiaState, pid: string): number {
  const base = state.phase === 'night' ? 1100 : state.phase === 'vote' ? 950 : 600;
  const jitter = rand(state.settings.seed, state.version * 13 + state.round * 5 + seatIndex(state, pid) + 3) * 600;
  return base + jitter;
}
