import { shuffle } from '../game/rng';
import type { SeatSpec } from '../game/engine';
import { ROLE_TEAM, dealRoles } from './data';
import { isLegal, nightDuties, waitingOn } from './rules';
import type {
  MafiaAction, MafiaEvent, MafiaPlayer, MafiaReduction, MafiaRole, MafiaRules,
  MafiaSettings, MafiaState, MafiaTeam,
} from './types';

/* ------------------------------------------------------------------ *
 * The reducer. Pure: no Date.now(), no Math.random(), no mutation of
 * the argument. reduce(state, action) -> { state, events }.
 * ------------------------------------------------------------------ */

export const MAF_DEFAULTS: Omit<MafiaSettings, 'seed'> = {
  maxPlayers: 9,
  botLevel: 'normal',
  fillWithBots: false,
  turnTimer: 0,
  discussionSeconds: 60,
  revealRolesOnDeath: true,
};

export const MAF_RULES_DEFAULT: MafiaRules = {
  discussionSeconds: MAF_DEFAULTS.discussionSeconds,
  revealRolesOnDeath: MAF_DEFAULTS.revealRolesOnDeath,
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
    acks: [],
    votes: {},
    silencedToday: [],
    lastDeaths: [],
    winner: null,
    winnerId: null,
    revealed: {},
    finalRoles: null,
    secret: null,
  };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

type NightAction = Extract<MafiaAction, { type:
  'NIGHT_KILL' | 'NIGHT_SILENCE' | 'NIGHT_SAVE' | 'NIGHT_CHECK' | 'NIGHT_GUARD' | 'NIGHT_SHOOT' }>;

export function reduce(prev: MafiaState, action: MafiaAction): MafiaReduction {
  const events: MafiaEvent[] = [];
  if (prev.phase === 'game_over') return { state: prev, events };
  if (action?.type === 'TIME_OUT') return timeOut(prev, action.playerId);
  if (!isLegal(prev, action)) return { state: prev, events };

  const s = clone(prev);
  s.version = prev.version + 1;

  switch (action.type) {
    case 'START_GAME': startGame(s, events); break;
    case 'ACK_ROLE': ackRole(s, events, action.playerId); break;
    case 'NIGHT_KILL':
    case 'NIGHT_SILENCE':
    case 'NIGHT_SAVE':
    case 'NIGHT_CHECK':
    case 'NIGHT_GUARD':
    case 'NIGHT_SHOOT': nightMove(s, events, action); break;
    case 'VOTE': castVote(s, events, action.playerId, action.target); break;
  }
  return { state: s, events };
}

/* ------------------------------- flow ------------------------------ */

function startGame(s: MafiaState, events: MafiaEvent[]): void {
  const roles = shuffle(dealRoles(s.seats.length), s.settings.seed, 9000);
  const assigned: Record<string, MafiaRole> = {};
  s.seats.forEach((id, i) => { assigned[id] = roles[i]; });
  s.secret = { roles: assigned, sniperUsed: {}, night: {}, checks: {} };
  s.phase = 'reveal';
  events.push({ type: 'GAME_STARTED' });
}

function ackRole(s: MafiaState, events: MafiaEvent[], pid: string): void {
  s.acks.push(pid);
  const alive = s.seats.filter((id) => s.players[id].alive);
  if (!alive.every((id) => s.acks.includes(id))) return;
  s.phase = 'night';
  s.round = 1;
  s.secret!.night = {};
  events.push({ type: 'NIGHT_FALLS', round: 1 });
}

/** A night move lands. Any submission may be revised while the night is
 *  young; the moment nobody is waited on, the night resolves. */
function nightMove(s: MafiaState, events: MafiaEvent[], a: NightAction): void {
  const night = s.secret!.night;
  switch (a.type) {
    case 'NIGHT_KILL': night.killBy = a.playerId; night.kill = a.target; break;
    case 'NIGHT_SILENCE': night.silence = a.target; break;
    case 'NIGHT_SAVE': night.save = a.target; break;
    case 'NIGHT_CHECK': night.check = a.target; break;
    case 'NIGHT_GUARD': night.guard = a.target; break;
    case 'NIGHT_SHOOT': night.shoot = a.target; break;
  }
  events.push({ type: 'ACTED', playerId: a.playerId });
  if (waitingOn(s).length === 0) resolveNight(s, events);
}

function resolveNight(s: MafiaState, events: MafiaEvent[]): void {
  const sec = s.secret!;
  const night = sec.night;
  const round = s.round;

  // The doctor's hand and the bodyguard's post cover the knife and the bullet alike.
  const protectedIds = new Set<string>();
  if (night.save != null) protectedIds.add(night.save);
  if (night.guard != null) protectedIds.add(night.guard);

  const dead = new Set<string>();
  if (night.kill != null && !protectedIds.has(night.kill)) dead.add(night.kill);
  if (night.shoot != null) {
    const sniper = s.seats.find((id) => sec.roles[id] === 'sniper');
    if (sniper) sec.sniperUsed[sniper] = true;
    if (!protectedIds.has(night.shoot)) dead.add(night.shoot);
  }

  if (night.check != null) {
    const detective = s.seats.find((id) => sec.roles[id] === 'detective');
    if (detective) {
      const role = sec.roles[night.check];
      (sec.checks[detective] ??= []).push({
        round,
        target: night.check,
        guilty: ROLE_TEAM[role] === 'mafia' && role !== 'godfather',
      });
    }
  }

  const reveal = s.settings.revealRolesOnDeath;
  s.lastDeaths = s.seats.filter((id) => dead.has(id)).map((id) => {
    s.players[id].alive = false;
    if (reveal) s.revealed = { ...(s.revealed ?? {}), [id]: sec.roles[id] };
    return { id, role: reveal ? sec.roles[id] : null };
  });
  s.silencedToday = night.silence != null && s.players[night.silence].alive ? [night.silence] : [];

  events.push({ type: 'DAWN', round, deaths: s.lastDeaths });
  for (const id of s.silencedToday) events.push({ type: 'SILENCED', playerId: id });

  if (checkWin(s, events)) return;
  s.phase = 'day';
  s.votes = {};
  events.push({ type: 'DAY_STARTED', round });
}

function castVote(s: MafiaState, events: MafiaEvent[], pid: string, target: string | null): void {
  s.votes[pid] = target;
  events.push({ type: 'VOTED', playerId: pid, target });
  if (waitingOn(s).length === 0) resolveVote(s, events);
}

function resolveVote(s: MafiaState, events: MafiaEvent[]): void {
  const tally = new Map<string, number>();
  for (const target of Object.values(s.votes)) {
    if (target != null) tally.set(target, (tally.get(target) ?? 0) + 1);
  }
  let top: string | null = null;
  let topVotes = 0;
  let tied = false;
  for (const [id, n] of tally) {
    if (n > topVotes) { top = id; topVotes = n; tied = false; }
    else if (n === topVotes) tied = true;
  }

  if (top && !tied) {
    const sec = s.secret;
    const role = sec ? sec.roles[top] : undefined;
    const shown = s.settings.revealRolesOnDeath && role ? role : null;
    s.players[top].alive = false;
    if (shown) s.revealed = { ...(s.revealed ?? {}), [top]: shown };
    s.lastDeaths = [{ id: top, role: shown }];
    events.push({ type: 'LYNCHED', playerId: top, role: shown });
    if (role === 'jester') {
      s.phase = 'game_over';
      s.winner = 'jester';
      s.winnerId = top;
      s.finalRoles = { ...sec!.roles };
      events.push({ type: 'GAME_OVER', winner: 'jester', winnerId: top });
      return;
    }
  } else {
    events.push({ type: 'NO_LYNCH' });
  }

  if (checkWin(s, events)) return;
  s.round += 1;
  s.phase = 'night';
  if (s.secret) s.secret.night = {};
  s.votes = {};
  s.silencedToday = [];
  s.lastDeaths = [];
  events.push({ type: 'NIGHT_FALLS', round: s.round });
}

/* ---------------------------- win condition -------------------------- */

function checkWin(s: MafiaState, events: MafiaEvent[]): boolean {
  const sec = s.secret;
  if (!sec) return false;
  const alive = s.seats.filter((id) => s.players[id].alive);
  const mafiaAlive = alive.filter((id) => ROLE_TEAM[sec.roles[id]] === 'mafia').length;
  const villageAlive = alive.filter((id) => ROLE_TEAM[sec.roles[id]] === 'village').length;
  let winner: MafiaTeam | null = null;
  if (mafiaAlive === 0) winner = 'village';
  else if (mafiaAlive >= villageAlive) winner = 'mafia';
  if (!winner) return false;
  s.phase = 'game_over';
  s.winner = winner;
  s.winnerId = null;
  s.finalRoles = { ...sec.roles };
  events.push({ type: 'GAME_OVER', winner, winnerId: null });
  return true;
}

/**
 * A player whose clock ran out has their pending decision made for them:
 * the reveal is acknowledged, the night is passed, the vote abstained.
 * In the day phase anyone's clock closing ends the discussion and opens
 * the vote. The host says when; the engine decides what that means.
 */
function timeOut(prev: MafiaState, pid: string): MafiaReduction {
  const p = prev.players[pid];
  if (!p || !p.alive) return { state: prev, events: [] };

  switch (prev.phase) {
    case 'reveal': {
      if (prev.acks.includes(pid)) return { state: prev, events: [] };
      const s = clone(prev);
      s.version = prev.version + 1;
      const events: MafiaEvent[] = [{ type: 'TIMED_OUT', playerId: pid }];
      ackRole(s, events, pid);
      return { state: s, events };
    }
    case 'night': {
      const sec = prev.secret;
      if (!sec) return { state: prev, events: [] };
      const pending = nightDuties(prev, pid).filter((k) => !(k in sec.night));
      if (pending.length === 0) return { state: prev, events: [] };
      const s = clone(prev);
      s.version = prev.version + 1;
      const events: MafiaEvent[] = [{ type: 'TIMED_OUT', playerId: pid }];
      const night = s.secret!.night;
      for (const k of pending) {
        if (k === 'kill') { night.killBy = pid; night.kill = null; }
        else night[k] = null;
      }
      if (waitingOn(s).length === 0) resolveNight(s, events);
      return { state: s, events };
    }
    case 'day': {
      const s = clone(prev);
      s.version = prev.version + 1;
      s.phase = 'vote';
      s.votes = {};
      return { state: s, events: [{ type: 'TIMED_OUT', playerId: pid }] };
    }
    case 'vote': {
      if (prev.silencedToday.includes(pid) || pid in prev.votes) return { state: prev, events: [] };
      const s = clone(prev);
      s.version = prev.version + 1;
      const events: MafiaEvent[] = [{ type: 'TIMED_OUT', playerId: pid }];
      s.votes[pid] = null;
      events.push({ type: 'VOTED', playerId: pid, target: null });
      if (waitingOn(s).length === 0) resolveVote(s, events);
      return { state: s, events };
    }
    default:
      return { state: prev, events: [] };
  }
}

/**
 * A signed-in player takes over a bot's seat in a game in progress. Not a
 * MafiaAction, for the same reason as Monopoly's: the host applies it after
 * the player's pass has checked out, and the reducer never can.
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

/** The reverse of a hand-over: a removed player's seat plays on as a bot.
 *  Host-side only, like the hand-over. */
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
