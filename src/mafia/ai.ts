import { rand } from '../game/rng';
import type { BotLevel } from '../game/types';
import { actingBoss, isFamily, isLegal, nightKindsFor } from './rules';
import type { MafiaAction, MafiaRole, MafiaState, NightKind } from './types';

/* ------------------------------------------------------------------ *
 * Omertà bots. Same house rules as the other two games: a bot decides
 * from what its seat can see, difficulty never buys information, and
 * every pick is a pure function of its inputs - the state, and the talk
 * the table has heard - so the same table always gets the same choices.
 *
 * What a seat can see, and so all a bot reasons from:
 *   - the votes, today's and every closed one (voteHistory), and the
 *     roles of the dead when the table shows them;
 *   - the talk: who named whom, who claimed to be the detective. Family
 *     talk at night only reaches the family's own bots;
 *   - its own role's knowledge: a detective's results, the family's
 *     names for a family bot.
 *
 * From that each bot keeps a heat map - how guilty everyone looks - and
 * acts on it: town bots hang and investigate the hottest, family bots
 * blend in with the town's heat and knife whoever threatens them. The
 * same map gives the bots something to say (mfBotLine), so a table of
 * bots argues rather than voting in silence.
 *
 * One decision per call; a bot with nothing to do returns null.
 * ------------------------------------------------------------------ */

/** One thing said at the table that named a player. Kept by the host from
 *  the chat it routes; never part of the game state. */
export interface TalkLine {
  round: number;
  phase: 'night' | 'day' | 'vote';
  /** The seat that spoke. */
  from: string;
  /** The seat named. */
  target: string;
  /** accuse: "it's X"; claim: "I'm the detective, X is guilty";
   *  clear: "I checked X, clean"; mention: a name in free talk. */
  kind: 'accuse' | 'claim' | 'clear' | 'mention';
  /** Said on the family's night channel: only the family heard it. */
  family?: boolean;
}

/** Something a bot says, as a key the chat renders in each reader's own
 *  language, and a variant so the same bot does not repeat itself. */
export interface BotLine {
  k: 'claim' | 'clear' | 'accuse' | 'defend' | 'unsure' | 'dare' | 'plan' | 'vote';
  target?: string;
  v: number;
}

const seatIndex = (s: MafiaState, pid: string): number => Math.max(0, s.seats.indexOf(pid));

/** A deterministic roll in [0, 1) for one bot's one decision. */
const coin = (s: MafiaState, pid: string, salt: number): number =>
  rand(s.settings.seed, s.version * 131 + s.round * 17 + seatIndex(s, pid) * 7 + salt);

/** Like coin, but steady for the whole phase: a bot keeps its mind (and its
 *  noise) while the votes around it move. */
const phaseCoin = (s: MafiaState, pid: string, salt: number): number =>
  rand(s.settings.seed, s.round * 977 + s.phase.length * 61 + seatIndex(s, pid) * 7 + salt);

const pick = <T,>(s: MafiaState, pid: string, salt: number, options: readonly T[]): T | null =>
  options.length === 0 ? null : options[Math.floor(coin(s, pid, salt) * options.length) % options.length];

const living = (s: MafiaState): string[] => s.seats.filter((id) => s.players[id]?.alive);

/** What this bot's detective found guilty and is still walking about. */
const knownGuilty = (s: MafiaState, pid: string): string[] =>
  (s.secret?.checks[pid] ?? []).filter((c) => c.guilty && s.players[c.target]?.alive).map((c) => c.target);

const knownInnocent = (s: MafiaState, pid: string): string[] =>
  (s.secret?.checks[pid] ?? []).filter((c) => !c.guilty && s.players[c.target]?.alive).map((c) => c.target);

/** How much a bot's judgement wobbles. Easy bots mostly follow their gut;
 *  hard ones weigh the evidence. The evidence is the same for all three. */
const NOISE: Record<BotLevel, number> = { easy: 4, normal: 1.6, hard: 0.6 };
const levelOf = (s: MafiaState, pid: string): BotLevel => s.players[pid]?.botLevel ?? s.settings.botLevel;

/* ------------------------------ the heat ----------------------------- */

/**
 * How guilty each living player looks from `pov`'s chair, on public
 * evidence only (plus family talk, for a family bot). Higher is worse.
 */
export function heatMap(s: MafiaState, pov: string, talk: readonly TalkLine[] = []): Record<string, number> {
  const heat: Record<string, number> = {};
  for (const id of living(s)) if (id !== pov) heat[id] = 0;
  const add = (id: string, n: number) => { if (id in heat) heat[id] += n; };
  const shown = (id: string): MafiaRole | undefined => s.revealed[id];
  const iAmFamily = Boolean(s.secret && isFamily(s.secret.roles[pov]));

  // Closed votes, read back through the roles the dead turned out to be.
  for (const rec of s.voteHistory ?? []) {
    const role = rec.hanged ? shown(rec.hanged) : undefined;
    if (!rec.hanged || !role) continue;
    const bad = isFamily(role);
    for (const [voter, target] of Object.entries(rec.votes)) {
      if (target === rec.hanged) add(voter, bad ? -1.5 : 1.2);
      // Voting elsewhere while the family's own went up is a tell too.
      else if (bad) add(voter, 0.6);
    }
  }

  // Today's vote, as it stands: people follow a crowd.
  if (s.phase === 'vote') for (const target of Object.values(s.votes)) add(target, 0.7);

  // The talk of the last two rounds.
  const claims = new Map<string, string[]>();
  for (const t of talk) {
    if (t.family && !iAmFamily) continue;
    if (t.round < s.round - 1) continue;
    const w = t.round === s.round ? 1 : 0.5;
    if (t.kind === 'claim') {
      claims.set(t.from, [...(claims.get(t.from) ?? []), t.target]);
      add(t.target, 3 * w);
    } else if (t.kind === 'clear') add(t.target, -2 * w);
    else add(t.target, (t.kind === 'accuse' ? 0.9 : 0.5) * w);
  }
  // A detective claim the dead proved wrong marks the claimer a liar; one
  // proved right makes them believable. Two claimers: one of them lies.
  for (const [claimer, targets] of claims) {
    for (const target of targets) {
      const role = shown(target);
      if (role) add(claimer, isFamily(role) ? -3 : 4);
    }
    if (claims.size > 1) add(claimer, 1.5);
  }
  return heat;
}

/** Players who have claimed the detective, most recent last. */
const claimers = (s: MafiaState, talk: readonly TalkLine[]): string[] =>
  [...new Set(talk.filter((t) => t.kind === 'claim' && !t.family && s.players[t.from]?.alive).map((t) => t.from))];

/** The best-scoring option, after this bot's noise. */
function best(s: MafiaState, pid: string, salt: number, options: readonly string[],
  score: (id: string) => number): string | null {
  if (options.length === 0) return null;
  const noise = NOISE[levelOf(s, pid)];
  let top: string | null = null;
  let topScore = -Infinity;
  options.forEach((id, i) => {
    const v = score(id) + phaseCoin(s, pid, salt + i * 3) * noise;
    if (v > topScore) { topScore = v; top = id; }
  });
  return top;
}

/** A town bot's read: the heat, sharpened by what its own role knows. */
function townScore(s: MafiaState, pid: string, heat: Record<string, number>, talk: readonly TalkLine[]) {
  const guilty = new Set(knownGuilty(s, pid));
  const clean = new Set(knownInnocent(s, pid));
  // Whoever points at this bot is, to this bot, a little suspicious.
  const accusers = new Set(talk.filter((t) => t.round === s.round && t.target === pid && !t.family).map((t) => t.from));
  return (id: string): number =>
    (heat[id] ?? 0) + (guilty.has(id) ? 100 : 0) - (clean.has(id) ? 50 : 0) + (accusers.has(id) ? 1 : 0);
}

/** How dangerous a townsperson is to the family. */
function threat(s: MafiaState, talk: readonly TalkLine[], heat: Record<string, number>) {
  const family = (id: string) => Boolean(s.secret && isFamily(s.secret.roles[id]));
  const claimed = new Set(claimers(s, talk));
  return (id: string): number => {
    let n = claimed.has(id) ? 4 : 0;
    n += talk.filter((t) => t.from === id && family(t.target) && !t.family).length * 1.5;
    // The trusted are worth more dead than the suspected: the town will
    // hang the suspected for free.
    return n - 0.4 * (heat[id] ?? 0);
  };
}

/* ------------------------------ decisions ----------------------------- */

export function mfBotDecide(state: MafiaState, pid: string, talk: readonly TalkLine[] = []): MafiaAction | null {
  const me = state.players[pid];
  const sec = state.secret;
  if (!me || !me.isBot || !me.alive || !sec) return null;
  const role = sec.roles[pid];
  if (!role) return null;
  const action = decide(state, pid, role, talk);
  // Never hand the host something it would refuse.
  return action && isLegal(state, action) ? action : null;
}

function decide(s: MafiaState, pid: string, role: MafiaRole, talk: readonly TalkLine[]): MafiaAction | null {
  const sec = s.secret!;
  const others = living(s).filter((id) => id !== pid);
  const town = others.filter((id) => !isFamily(sec.roles[id]));
  const heat = heatMap(s, pid, talk);

  switch (s.phase) {
    case 'night': {
      if (pid in sec.night || nightKindsFor(s, pid).length === 0) return null;
      const move = (kind: NightKind, target: string | null): MafiaAction | null =>
        target ? { type: 'NIGHT_MOVE', playerId: pid, kind, target } : null;
      switch (role) {
        case 'mafia':
        case 'godfather':
          return move('kill', familyKill(s, pid, town, heat, talk));
        case 'silencer':
          // The last of the family takes up the knife.
          if (nightKindsFor(s, pid).includes('kill')) return move('kill', familyKill(s, pid, town, heat, talk));
          return move('silence', best(s, pid, 5, town, threat(s, talk, heat)));
        case 'doctor': {
          const options = living(s).filter((id) => id !== sec.lastProtect[pid]);
          // A detective who has spoken up is the one the family wants dead.
          const claimed = claimers(s, talk).filter((id) => options.includes(id));
          if (claimed.length > 0 && coin(s, pid, 7) < 0.7) return move('protect', claimed[claimed.length - 1]);
          return move('protect', best(s, pid, 7, options, (id) => -(heat[id] ?? 0) + (id === pid ? 0.5 : 0)));
        }
        case 'detective': {
          const guilty = knownGuilty(s, pid);
          if (guilty.length > 0) return move('shoot', guilty[0]);
          const seen = new Set((sec.checks[pid] ?? []).map((c) => c.target));
          const fresh = others.filter((id) => !seen.has(id));
          return move('investigate', best(s, pid, 11, fresh.length > 0 ? fresh : others, (id) => heat[id] ?? 0));
        }
        case 'bodyguard': {
          const claimed = claimers(s, talk).filter((id) => others.includes(id));
          if (claimed.length > 0 && coin(s, pid, 13) < 0.6) return move('guard', claimed[claimed.length - 1]);
          return move('guard', best(s, pid, 13, others, (id) => -(heat[id] ?? 0)));
        }
        default:
          return null;
      }
    }

    case 'day': {
      // The sniper holds the one bullet for a real suspect, and spends it
      // on a hunch only late, when holding it has stopped helping.
      if (role !== 'sniper' || sec.sniperUsed.includes(pid) || s.round < 2) return null;
      const score = townScore(s, pid, heat, talk);
      const target = best(s, pid, 19, others, score);
      if (!target) return null;
      const sure = score(target) >= 3.5;
      if (!sure && (s.round < 4 || coin(s, pid, 17) > 0.25)) return null;
      return { type: 'SNIPE', playerId: pid, target };
    }

    case 'vote': {
      if (pid in s.votes) return null;
      let target: string | null;
      if (isFamily(role)) {
        // Blend in: ride the town's own suspicion, and push it onto whoever
        // is dangerous. Never onto the family while there is anyone else.
        const danger = threat(s, talk, heat);
        target = best(s, pid, 23, town.length > 0 ? town : others,
          (id) => (heat[id] ?? 0) + Math.max(0, danger(id)) * 0.6);
      } else if (role === 'jester') {
        target = pick(s, pid, 23, others);
      } else {
        target = best(s, pid, 23, others, townScore(s, pid, heat, talk));
      }
      return target ? { type: 'VOTE', playerId: pid, target } : null;
    }

    default:
      return null;
  }
}

/** The family's knife: the boss's word, then a human teammate's, then its
 *  own read of who threatens the family most. */
function familyKill(s: MafiaState, pid: string, town: string[], heat: Record<string, number>,
  talk: readonly TalkLine[]): string | null {
  const sec = s.secret!;
  const boss = actingBoss(s);
  const bossPick = boss && boss !== pid ? sec.night[boss]?.target : undefined;
  if (bossPick && town.includes(bossPick)) return bossPick;
  const said = talk.filter((t) => t.family && t.round === s.round && t.phase === 'night'
    && t.from !== pid && !s.players[t.from]?.isBot && town.includes(t.target));
  if (said.length > 0) return said[said.length - 1].target;
  return best(s, pid, 3, town, threat(s, talk, heat));
}

/* -------------------------------- talk -------------------------------- */

/**
 * What a bot says this phase, if anything. The host asks once per bot per
 * phase (and, in the vote, again until the bot has voted). Deterministic,
 * like the moves.
 */
export function mfBotLine(s: MafiaState, pid: string, talk: readonly TalkLine[] = []): BotLine | null {
  const me = s.players[pid];
  const sec = s.secret;
  if (!me || !me.isBot || !me.alive || !sec) return null;
  const role = sec.roles[pid];
  const level = levelOf(s, pid);
  const others = living(s).filter((id) => id !== pid);
  const town = others.filter((id) => !isFamily(sec.roles[id]));
  const heat = heatMap(s, pid, talk);
  const v = Math.floor(phaseCoin(s, pid, 101) * 3);
  const roll = (salt: number) => phaseCoin(s, pid, salt);

  if (s.phase === 'night') {
    // A family bot tells a human teammate its plan, so the two can agree.
    if (!isFamily(role) || !nightKindsFor(s, pid).includes('kill')) return null;
    const humanKin = s.seats.some((id) => id !== pid && s.players[id]?.alive && !s.players[id].isBot && isFamily(sec.roles[id]));
    if (!humanKin) return null;
    const target = familyKill(s, pid, town, heat, talk);
    return target ? { k: 'plan', target, v } : null;
  }

  if (s.phase === 'vote') {
    const target = s.votes[pid];
    if (!target || roll(103) > 0.45) return null;
    return { k: 'vote', target, v };
  }

  if (s.phase !== 'day') return null;
  const today = talk.filter((t) => t.round === s.round && !t.family);

  // Named today: answer it, and point somewhere else.
  const accused = today.some((t) => t.target === pid && t.kind !== 'clear');
  if (accused && roll(107) < 0.8) {
    const pool = isFamily(role) ? town : others;
    // Pointing back at the accuser reads as spite; point at the next-hottest.
    const elsewhere = pool.filter((id) => !today.some((t) => t.from === id && t.target === pid));
    const target = best(s, pid, 109, elsewhere.length > 0 ? elsewhere : pool, (id) => heat[id] ?? 0);
    return { k: 'defend', target: target ?? undefined, v };
  }

  if (role === 'detective') {
    const guilty = knownGuilty(s, pid);
    // Claiming paints a target on the claimer; an easy bot is shyer.
    if (guilty.length > 0 && (level !== 'easy' || roll(111) < 0.5)) return { k: 'claim', target: guilty[0], v };
    const clean = knownInnocent(s, pid);
    if (clean.length > 0 && s.round >= 2 && roll(113) < 0.35) return { k: 'clear', target: clean[clean.length - 1], v };
  }

  if (isFamily(role) && s.round >= 2 && level !== 'easy') {
    // The bluff: claim the detective and name a townsperson, while nobody
    // else has claimed today.
    const chance = level === 'hard' ? 0.3 : 0.12;
    if (!today.some((t) => t.kind === 'claim') && roll(117) < chance) {
      const target = best(s, pid, 119, town, (id) => heat[id] ?? 0);
      if (target) return { k: 'claim', target, v };
    }
  }

  if (role === 'jester') {
    if (roll(121) < 0.5) return { k: 'dare', v };
    const target = pick(s, pid, 123, others);
    return target ? { k: 'accuse', target, v } : null;
  }

  const pool = isFamily(role) ? town : others;
  const score = isFamily(role) ? (id: string) => heat[id] ?? 0 : townScore(s, pid, heat, talk);
  const target = best(s, pid, 125, pool, score);
  if (target && (score(target) >= 1 || (s.round >= 2 && roll(127) < 0.6))) return { k: 'accuse', target, v };
  if (s.round === 1 && roll(129) < 0.4) return { k: 'unsure', v };
  return null;
}

/** What a line counts as, once said, for everyone's heat. */
export function talkKind(line: BotLine): TalkLine['kind'] | null {
  switch (line.k) {
    case 'claim': return 'claim';
    case 'clear': return 'clear';
    case 'accuse': case 'defend': case 'vote': return 'accuse';
    case 'plan': return 'mention';
    default: return null;
  }
}

/**
 * The names in a human's message, as talk: any living player named by a
 * whole word. Crude - "not Bob" still names Bob - but at a Mafia table a
 * name said out loud is suspicion more often than not.
 */
export function mentionsIn(s: MafiaState, from: string | null, text: string): string[] {
  const low = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  return living(s).filter((id) => {
    if (id === from) return false;
    const name = s.players[id].name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return name.length >= 2 && low.includes(` ${name} `);
  });
}

/* ------------------------------ pacing ------------------------------ */

/** Human-feeling delay; the jitter is seeded like the other games, so
 *  pacing never leaks into the decision log. */
export function mfBotDelay(state: MafiaState, pid: string): number {
  const base = state.phase === 'night' ? 1600 : state.phase === 'vote' ? 1400 : 4000;
  const jitter = rand(state.settings.seed, state.version * 13 + state.round * 5 + seatIndex(state, pid) + 3) * 1800;
  return base + jitter;
}

/** When a bot speaks up in a phase: spread over its first half, so the
 *  table does not all talk at once and a human has room to answer. */
export function mfBotTalkDelay(state: MafiaState, pid: string): number {
  const window = state.phase === 'night' ? 6000 : state.phase === 'vote' ? 3000 : 14000;
  return 2500 + rand(state.settings.seed, state.round * 29 + seatIndex(state, pid) * 11 + 7) * window;
}
