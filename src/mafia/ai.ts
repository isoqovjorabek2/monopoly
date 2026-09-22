import { rand } from '../game/rng';
import { actingBoss, isFamily, isLegal, nightKindsFor } from './rules';
import type { MafiaAction, MafiaRole, MafiaState, NightKind } from './types';

/* ------------------------------------------------------------------ *
 * Omertà bots. Same house rules as the other two games: a bot decides
 * from what its seat can see, difficulty never buys information, and
 * every pick is a pure function of the state - the host applies these,
 * so a replay of (seed, actions) lands on the same choices.
 *
 * One decision per call; a bot with nothing to do returns null.
 * ------------------------------------------------------------------ */

const seatIndex = (s: MafiaState, pid: string): number => Math.max(0, s.seats.indexOf(pid));

/** A deterministic roll in [0, 1) for one bot's one decision. */
const coin = (s: MafiaState, pid: string, salt: number): number =>
  rand(s.settings.seed, s.version * 131 + s.round * 17 + seatIndex(s, pid) * 7 + salt);

const pick = <T,>(s: MafiaState, pid: string, salt: number, options: readonly T[]): T | null =>
  options.length === 0 ? null : options[Math.floor(coin(s, pid, salt) * options.length) % options.length];

const living = (s: MafiaState): string[] => s.seats.filter((id) => s.players[id]?.alive);

/** What this bot's detective found guilty and is still walking about. */
const knownGuilty = (s: MafiaState, pid: string): string[] =>
  (s.secret?.checks[pid] ?? []).filter((c) => c.guilty && s.players[c.target]?.alive).map((c) => c.target);

export function mfBotDecide(state: MafiaState, pid: string): MafiaAction | null {
  const me = state.players[pid];
  const sec = state.secret;
  if (!me || !me.isBot || !me.alive || !sec) return null;
  const role = sec.roles[pid];
  if (!role) return null;
  const action = decide(state, pid, role);
  // Never hand the host something it would refuse.
  return action && isLegal(state, action) ? action : null;
}

function decide(s: MafiaState, pid: string, role: MafiaRole): MafiaAction | null {
  const sec = s.secret!;
  const others = living(s).filter((id) => id !== pid);
  const town = others.filter((id) => !isFamily(sec.roles[id]));

  switch (s.phase) {
    case 'night': {
      if (pid in sec.night || nightKindsFor(s, pid).length === 0) return null;
      const move = (kind: NightKind, target: string | null): MafiaAction | null =>
        target ? { type: 'NIGHT_MOVE', playerId: pid, kind, target } : null;
      switch (role) {
        case 'mafia':
        case 'godfather': {
          // A bot that is not the boss backs the boss's pick when there is one.
          const boss = actingBoss(s);
          const bossPick = boss && boss !== pid ? sec.night[boss]?.target : undefined;
          return move('kill', bossPick && town.includes(bossPick) ? bossPick : pick(s, pid, 3, town));
        }
        case 'silencer':
          // The last of the family takes up the knife.
          if (nightKindsFor(s, pid).includes('kill')) return move('kill', pick(s, pid, 3, town));
          return move('silence', pick(s, pid, 5, town));
        case 'doctor': {
          const options = living(s).filter((id) => id !== sec.lastProtect[pid]);
          return move('protect', pick(s, pid, 7, options));
        }
        case 'detective': {
          const guilty = knownGuilty(s, pid);
          if (guilty.length > 0) return move('shoot', guilty[0]);
          const seen = new Set((sec.checks[pid] ?? []).map((c) => c.target));
          const fresh = others.filter((id) => !seen.has(id));
          return move('investigate', pick(s, pid, 11, fresh.length > 0 ? fresh : others));
        }
        case 'bodyguard':
          return move('guard', pick(s, pid, 13, others));
        default:
          return null;
      }
    }

    case 'day': {
      // The sniper holds the one bullet for a while, then spends it.
      if (role !== 'sniper' || sec.sniperUsed.includes(pid) || s.round < 2) return null;
      if (coin(s, pid, 17) > 0.35) return null;
      const target = pick(s, pid, 19, others);
      return target ? { type: 'SNIPE', playerId: pid, target } : null;
    }

    case 'vote': {
      if (pid in s.votes) return null;
      let pool = others;
      if (isFamily(role)) pool = town.length > 0 ? town : others;
      else if (role === 'detective' && knownGuilty(s, pid).length > 0) pool = knownGuilty(s, pid);
      else if (role === 'jester') pool = others;
      const target = pick(s, pid, 23, pool);
      return target ? { type: 'VOTE', playerId: pid, target } : null;
    }

    default:
      return null;
  }
}

/* ------------------------------ pacing ------------------------------ */

/** Human-feeling delay; the jitter is seeded like the other games, so
 *  pacing never leaks into the decision log. */
export function mfBotDelay(state: MafiaState, pid: string): number {
  const base = state.phase === 'night' ? 1600 : state.phase === 'vote' ? 1400 : 4000;
  const jitter = rand(state.settings.seed, state.version * 13 + state.round * 5 + seatIndex(state, pid) + 3) * 1800;
  return base + jitter;
}
