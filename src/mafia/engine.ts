import { shuffle } from '../game/rng';
import type { SeatSpec } from '../game/engine';
import { ROLE_TEAM, dealRoles } from './data';
import { actingBoss, isFamily, isLegal, waitingOn } from './rules';
import type {
  MafiaAction, MafiaDeath, MafiaEvent, MafiaMvp, MafiaPlayer, MafiaReduction, MafiaRules,
  MafiaSettings, MafiaState, MafiaTeam, MatchStats,
} from './types';

/* ------------------------------------------------------------------ *
 * The reducer. Pure: no Date.now(), no Math.random(), no mutation of
 * the argument. reduce(state, action) -> { state, events }.
 *
 * Night -> day -> vote -> night. The night ends the moment every night
 * role has moved (or its clock runs out); the day only ever ends on the
 * clock or the host's word; the vote ends when all the living have voted.
 * ------------------------------------------------------------------ */

export const MAF_DEFAULTS: Omit<MafiaSettings, 'seed'> = {
  maxPlayers: 10,
  botLevel: 'normal',
  fillWithBots: false,
  nightSeconds: 60,
  daySeconds: 120,
  voteSeconds: 60,
  revealRolesOnDeath: true,
  roles: null,
};

export const MAF_RULES_DEFAULT: MafiaRules = {
  nightSeconds: MAF_DEFAULTS.nightSeconds,
  daySeconds: MAF_DEFAULTS.daySeconds,
  voteSeconds: MAF_DEFAULTS.voteSeconds,
  revealRolesOnDeath: MAF_DEFAULTS.revealRolesOnDeath,
  roles: MAF_DEFAULTS.roles,
};

export function createMafia(settings: MafiaSettings, seats: SeatSpec[]): MafiaState {
  const players: Record<string, MafiaPlayer> = {};
  for (const seat of seats) {
    players[seat.id] = {
      id: seat.id,
      name: seat.name,
      token: seat.token,
      color: seat.color,
      isBot: seat.isBot,
      botLevel: seat.botLevel ?? settings.botLevel,
      connected: true,
      alive: true,
    };
  }
  return {
    kind: 'mafia',
    version: 0,
    phase: 'lobby',
    settings,
    players,
    seats: seats.map((s) => s.id),
    round: 0,
    votes: {},
    silencedToday: [],
    lastDeaths: [],
    lastSaved: [],
    revealed: {},
    lastWords: [],
    aliveCounts: null,
    winner: null,
    winnerId: null,
    finalRoles: null,
    mvp: null,
    lastVoteMargin: null,
    finalEliminatedId: null,
    voteHistory: [],
    secret: null,
  };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function reduce(prev: MafiaState, action: MafiaAction): MafiaReduction {
  const events: MafiaEvent[] = [];
  if (prev.phase === 'game_over') return { state: prev, events };
  if (!isLegal(prev, action)) return { state: prev, events };

  const s = clone(prev);
  s.version = prev.version + 1;

  switch (action.type) {
    case 'START_GAME': startGame(s, events); break;
    case 'NIGHT_MOVE':
      s.secret!.night[action.playerId] = { kind: action.kind, target: action.target };
      if (action.kind === 'investigate') investigate(s, action.playerId, action.target);
      events.push({ type: 'ACTED', playerId: action.playerId });
      if (waitingOn(s).length === 0) resolveNight(s, events);
      break;
    case 'SNIPE': snipe(s, events, action.playerId, action.target); break;
    case 'VOTE':
      if (action.target === null) delete s.votes[action.playerId];
      else s.votes[action.playerId] = action.target;
      events.push({ type: 'VOTED', playerId: action.playerId, target: action.target });
      if (action.target !== null && waitingOn(s).length === 0) resolveVote(s, events);
      break;
    case 'ADVANCE':
      if (s.phase === 'night') resolveNight(s, events);
      else if (s.phase === 'day') openVote(s, events);
      else resolveVote(s, events);
      break;
  }
  return { state: s, events };
}

/* ------------------------------- flow ------------------------------ */

const zeroStats = (): MatchStats => ({ kills: 0, saves: 0, finds: 0, reads: 0 });

function bump(s: MafiaState, id: string | undefined, key: keyof MatchStats): void {
  if (!id || !s.secret) return;
  (s.secret.stats[id] ??= zeroStats())[key] += 1;
}

function startGame(s: MafiaState, events: MafiaEvent[]): void {
  const roles = shuffle(dealRoles(s.settings.roles, s.seats.length), s.settings.seed, 9000);
  const assigned: Record<string, (typeof roles)[number]> = {};
  const stats: Record<string, MatchStats> = {};
  s.seats.forEach((id, i) => { assigned[id] = roles[i]; stats[id] = zeroStats(); });
  s.secret = { roles: assigned, night: {}, lastProtect: {}, sniperUsed: [], checks: {}, stats };
  s.phase = 'night';
  s.round = 1;
  refreshCounts(s);
  events.push({ type: 'GAME_STARTED' }, { type: 'NIGHT_FALLS', round: 1 });
}

/** The detective learns at once, as the app did; the Godfather reads as a
 *  plain villager. */
function investigate(s: MafiaState, detective: string, target: string): void {
  const sec = s.secret!;
  const real = sec.roles[target];
  const seen = real === 'godfather' ? 'villager' : real;
  (sec.checks[detective] ??= []).push({ round: s.round, target, seen, guilty: isFamily(seen) });
  bump(s, detective, 'finds');
}

function kill(s: MafiaState, id: string, cause: MafiaDeath['cause'], saved?: string): MafiaDeath {
  const sec = s.secret!;
  s.players[id].alive = false;
  const role = s.settings.revealRolesOnDeath ? sec.roles[id] : null;
  if (role) s.revealed[id] = role;
  return saved ? { id, role, cause, saved } : { id, role, cause };
}

function resolveNight(s: MafiaState, events: MafiaEvent[]): void {
  const sec = s.secret!;
  const moves = Object.entries(sec.night);
  const alive = (id: string) => Boolean(s.players[id]?.alive);

  const protectedBy = new Map<string, string>();
  const guardedBy = new Map<string, string>();
  for (const [by, m] of moves) {
    if (m.kind === 'protect') protectedBy.set(m.target, by);
    if (m.kind === 'guard') guardedBy.set(m.target, by);
  }

  // The family's kill: the boss's word, or else the most-named target,
  // ties going to whoever was named first at the table.
  const picks = moves.filter(([, m]) => m.kind === 'kill');
  const boss = actingBoss(s);
  let victim: string | null = picks.find(([by]) => by === boss)?.[1].target ?? null;
  let killer: string | undefined = boss ?? undefined;
  if (!victim && picks.length > 0) {
    const tally = new Map<string, number>();
    for (const [, m] of picks) tally.set(m.target, (tally.get(m.target) ?? 0) + 1);
    const best = Math.max(...tally.values());
    victim = s.seats.find((id) => tally.get(id) === best) ?? null;
    killer = picks.find(([, m]) => m.target === victim)?.[0];
  }

  const deaths: MafiaDeath[] = [];
  const saved: string[] = [];
  const dead = new Set<string>();
  const take = (id: string, cause: MafiaDeath['cause'], by?: string, savedId?: string) => {
    if (dead.has(id) || !alive(id)) return;
    dead.add(id);
    deaths.push(kill(s, id, cause, savedId));
    if (by) bump(s, by, cause === 'bodyguard' ? 'saves' : 'kills');
  };

  // The knife: the doctor stops it; failing that the bodyguard takes it.
  if (victim && alive(victim)) {
    if (protectedBy.has(victim)) {
      saved.push(victim);
      bump(s, protectedBy.get(victim), 'saves');
    } else if (guardedBy.has(victim) && alive(guardedBy.get(victim)!)) {
      const guard = guardedBy.get(victim)!;
      take(guard, 'bodyguard', guard, victim);
    } else {
      take(victim, 'mafia', killer);
    }
  }

  // The detective's shot goes past the doctor, but not past a bodyguard.
  // It was fired in the night, so it lands even if the detective did not
  // live to see the dawn.
  for (const [by, m] of moves) {
    if (m.kind !== 'shoot') continue;
    const guard = guardedBy.get(m.target);
    if (guard && alive(guard)) take(guard, 'bodyguard', guard, m.target);
    else take(m.target, 'detective', by);
  }

  const silenced = moves
    .filter(([, m]) => m.kind === 'silence')
    .map(([, m]) => m.target)
    .filter((id) => alive(id));

  // The doctor may not repeat tonight's patient tomorrow.
  sec.lastProtect = {};
  for (const [by, m] of moves) if (m.kind === 'protect') sec.lastProtect[by] = m.target;
  sec.night = {};

  s.lastDeaths = deaths;
  s.lastSaved = saved;
  s.silencedToday = silenced;
  refreshCounts(s);
  events.push({ type: 'DAWN', round: s.round, deaths, saved, silenced });

  if (checkWin(s, events)) return;
  s.phase = 'day';
  s.votes = {};
  events.push({ type: 'DAY_STARTED', round: s.round });
}

function openVote(s: MafiaState, events: MafiaEvent[]): void {
  s.phase = 'vote';
  s.votes = {};
  // The gag lasts for the talk; the vote is everyone's.
  s.silencedToday = [];
  events.push({ type: 'VOTE_OPENED', round: s.round });
}

/** The sniper's one shot, by day. It lands at once. */
function snipe(s: MafiaState, events: MafiaEvent[], sniper: string, target: string): void {
  const sec = s.secret!;
  sec.sniperUsed.push(sniper);
  const role = sec.roles[target];
  const death = kill(s, target, 'sniper');
  bump(s, sniper, 'kills');
  // Added to the day's news, not in place of the night's.
  s.lastDeaths = [...s.lastDeaths, death];
  refreshCounts(s);
  events.push({ type: 'SNIPED', playerId: target, role: death.role });
  if (role === 'jester') { jesterWins(s, events, target); return; }
  checkWin(s, events);
}

function resolveVote(s: MafiaState, events: MafiaEvent[]): void {
  const tally = new Map<string, number>();
  for (const target of Object.values(s.votes)) tally.set(target, (tally.get(target) ?? 0) + 1);
  const counts = [...tally.values()].sort((a, b) => b - a);
  const top = counts[0] ?? 0;
  const leaders = [...tally.entries()].filter(([, n]) => n === top).map(([id]) => id);
  s.voteHistory = [
    ...(s.voteHistory ?? []),
    { round: s.round, votes: { ...s.votes }, hanged: leaders.length === 1 ? leaders[0] : null },
  ];

  if (leaders.length === 1) {
    const hanged = leaders[0];
    const sec = s.secret!;
    const role = sec.roles[hanged];
    s.lastVoteMargin = top - (counts[1] ?? 0);
    s.finalEliminatedId = hanged;
    // A town vote that lands on the family is a good read.
    if (isFamily(role)) {
      for (const [voter, target] of Object.entries(s.votes)) {
        if (target === hanged && ROLE_TEAM[sec.roles[voter]] === 'village') bump(s, voter, 'reads');
      }
    }
    const death = kill(s, hanged, 'vote');
    s.lastDeaths = [death];
    refreshCounts(s);
    events.push({ type: 'LYNCHED', playerId: hanged, role: death.role });
    if (role === 'jester') { jesterWins(s, events, hanged); return; }
  } else {
    s.lastDeaths = [];
    events.push({ type: 'NO_LYNCH', tie: leaders.length > 1 });
  }

  if (checkWin(s, events)) return;
  s.round += 1;
  s.phase = 'night';
  s.votes = {};
  s.lastSaved = [];
  events.push({ type: 'NIGHT_FALLS', round: s.round });
}

/* ---------------------------- the ending ----------------------------- */

function refreshCounts(s: MafiaState): void {
  const sec = s.secret;
  if (!sec || !s.settings.revealRolesOnDeath) { s.aliveCounts = null; return; }
  const counts = { village: 0, mafia: 0, jester: 0 };
  for (const id of s.seats) if (s.players[id].alive) counts[ROLE_TEAM[sec.roles[id]]] += 1;
  s.aliveCounts = counts;
}

function jesterWins(s: MafiaState, events: MafiaEvent[], id: string): void {
  finish(s, 'jester', id);
  events.push({ type: 'GAME_OVER', winner: 'jester', winnerId: id });
}

function checkWin(s: MafiaState, events: MafiaEvent[]): boolean {
  const sec = s.secret;
  if (!sec) return false;
  const alive = s.seats.filter((id) => s.players[id].alive);
  const mafia = alive.filter((id) => ROLE_TEAM[sec.roles[id]] === 'mafia').length;
  const town = alive.filter((id) => ROLE_TEAM[sec.roles[id]] === 'village').length;
  let winner: MafiaTeam | null = null;
  if (mafia === 0) winner = 'village';
  else if (mafia >= town) winner = 'mafia';
  if (!winner) return false;
  finish(s, winner, null);
  events.push({ type: 'GAME_OVER', winner, winnerId: null });
  return true;
}

function finish(s: MafiaState, winner: MafiaTeam, winnerId: string | null): void {
  const sec = s.secret!;
  s.phase = 'game_over';
  s.winner = winner;
  s.winnerId = winnerId;
  s.finalRoles = { ...sec.roles };
  s.mvp = pickMvp(s, winner, winnerId);
}

/** The most decisive player of the match: kills and saves weigh most,
 *  then good reads, then investigations; surviving and winning tip it. */
function pickMvp(s: MafiaState, winner: MafiaTeam, winnerId: string | null): MafiaMvp | null {
  const sec = s.secret!;
  let best: MafiaMvp | null = null;
  let bestScore = -1;
  for (const id of s.seats) {
    const st = sec.stats[id] ?? zeroStats();
    const survived = s.players[id].alive;
    const won = winner === 'jester' ? id === winnerId : ROLE_TEAM[sec.roles[id]] === winner;
    const score = st.kills * 3 + st.saves * 3 + st.reads * 2 + st.finds + (survived ? 1 : 0) + (won ? 2 : 0);
    if (score > bestScore) { bestScore = score; best = { id, stats: st, survived }; }
  }
  return best;
}

/* ---------------------------- seats ----------------------------- */

/**
 * A signed-in player takes over a bot's seat in a game in progress. Not a
 * MafiaAction: the host applies it after the player's pass has checked
 * out, and the reducer never can.
 */
export function handOverSeat(prev: MafiaState, playerId: string, name: string): MafiaReduction {
  const p = prev.players[playerId];
  if (!p || !p.isBot || prev.phase === 'game_over' || prev.phase === 'lobby') {
    return { state: prev, events: [] };
  }
  const s = clone(prev);
  s.version = prev.version + 1;
  const seat = s.players[playerId];
  seat.isBot = false;
  seat.connected = true;
  seat.name = name;
  return { state: s, events: [{ type: 'SEAT_TAKEN', playerId, name, previous: p.name }] };
}

/** The reverse of a hand-over: a removed player's seat plays on as a bot. */
export function botifySeat(prev: MafiaState, playerId: string): MafiaReduction {
  const p = prev.players[playerId];
  if (!p || p.isBot || prev.phase === 'game_over' || prev.phase === 'lobby') {
    return { state: prev, events: [] };
  }
  const s = clone(prev);
  s.version = prev.version + 1;
  s.players[playerId].isBot = true;
  s.players[playerId].connected = false;
  return { state: s, events: [] };
}

/** A dead player's one last line has been spoken. Host-side, like the
 *  chat it guards. */
export function spendLastWords(prev: MafiaState, playerId: string): MafiaState {
  if (prev.lastWords.includes(playerId)) return prev;
  return { ...prev, version: prev.version + 1, lastWords: [...prev.lastWords, playerId] };
}
