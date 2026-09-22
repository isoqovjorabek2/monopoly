import { describe, expect, it } from 'vitest';
import type { SeatSpec } from '../game/engine';
import { dealRoles } from './data';
import { MAF_DEFAULTS, botifySeat, createMafia, handOverSeat, reduce } from './engine';
import { clockKey, clockSeconds, nightPendingFor, privateFor, waitingOn } from './rules';
import type {
  MafiaAction, MafiaEvent, MafiaRole, MafiaSettings, MafiaState,
} from './types';

const seats = (n: number, bots = false): SeatSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, token: 'camel' as const, color: '#fff', isBot: bots,
  }));

const settings = (seed: number, patch: Partial<MafiaSettings> = {}): MafiaSettings =>
  ({ ...MAF_DEFAULTS, seed, ...patch });

/** Roles are out, the table looking at them. */
function started(seed: number, n = 6, patch: Partial<MafiaSettings> = {}): MafiaState {
  let s = createMafia(settings(seed, patch), seats(n));
  s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
  return s;
}

/** Past the reveal, round 1, night fallen. */
function nighted(seed: number, n = 6, patch: Partial<MafiaSettings> = {}): MafiaState {
  let s = started(seed, n, patch);
  for (const id of s.seats) s = reduce(s, { type: 'ACK_ROLE', playerId: id }).state;
  return s;
}

const edit = (s: MafiaState, fn: (s: MafiaState) => void): MafiaState => {
  const c = JSON.parse(JSON.stringify(s)) as MafiaState;
  fn(c);
  return c;
};

const byRole = (s: MafiaState, role: MafiaRole): string =>
  s.seats.find((id) => s.secret!.roles[id] === role)!;

const villagers = (s: MafiaState): string[] =>
  s.seats.filter((id) => s.secret!.roles[id] === 'villager');

const act = (s: MafiaState, a: MafiaAction): MafiaState => {
  const r = reduce(s, a);
  expect(r.state.version).toBe(s.version + 1);
  return r.state;
};

/** Everyone still waited on times out: nulls all round, the night passes. */
function passNight(s: MafiaState): MafiaState {
  for (let guard = 0; guard < 40 && s.phase === 'night'; guard++) {
    const [pid] = waitingOn(s);
    if (!pid) break;
    s = reduce(s, { type: 'TIME_OUT', playerId: pid }).state;
  }
  return s;
}

/** Night passed, discussion closed on somebody's clock: the vote is open. */
function voting(seed: number, n = 6, patch: Partial<MafiaSettings> = {}): MafiaState {
  let s = passNight(nighted(seed, n, patch));
  expect(s.phase).toBe('day');
  s = act(s, { type: 'TIME_OUT', playerId: s.seats.find((id) => s.players[id].alive)! });
  expect(s.phase).toBe('vote');
  return s;
}

function castVotes(s: MafiaState, votes: Record<string, string | null>): { state: MafiaState; events: MafiaEvent[] } {
  let state = s;
  let events: MafiaEvent[] = [];
  for (const [pid, target] of Object.entries(votes)) {
    const r = reduce(state, { type: 'VOTE', playerId: pid, target });
    expect(r.state.version).toBe(state.version + 1);
    state = r.state;
    events = r.events;
  }
  return { state, events };
}

/* ------------------------------ the deal ----------------------------- */

describe('the deal', () => {
  it('creates a lobby with everyone alive and no secret', () => {
    const s = createMafia(settings(1), seats(6));
    expect(s.phase).toBe('lobby');
    expect(s.secret).toBeNull();
    expect(s.round).toBe(0);
    for (const id of s.seats) expect(s.players[id].alive).toBe(true);
    expect(privateFor(s, 'p0')).toBeNull();
  });

  it('refuses to start with too few players', () => {
    const s = createMafia(settings(1), seats(4));
    expect(reduce(s, { type: 'START_GAME', playerId: 'p0' }).state).toBe(s);
  });

  it('deals the same roles from the same seed, and the full cast', () => {
    const a = started(42);
    const b = started(42);
    expect(a.secret!.roles).toEqual(b.secret!.roles);
    expect([...Object.values(a.secret!.roles)].sort()).toEqual([...dealRoles(6)].sort());
    expect(a.phase).toBe('reveal');
  });
});

/* ------------------------------ the reveal ---------------------------- */

describe('the reveal', () => {
  it('waits on every seat until all have acknowledged, then night falls', () => {
    let s = started(7);
    expect(waitingOn(s)).toEqual(s.seats);
    for (const id of s.seats.slice(0, -1)) s = act(s, { type: 'ACK_ROLE', playerId: id });
    expect(s.phase).toBe('reveal');
    const last = s.seats[s.seats.length - 1];
    const r = reduce(s, { type: 'ACK_ROLE', playerId: last });
    expect(r.state.phase).toBe('night');
    expect(r.state.round).toBe(1);
    expect(r.events).toEqual([{ type: 'NIGHT_FALLS', round: 1 }]);
  });

  it('rejects a second acknowledgement without a version bump', () => {
    let s = started(7);
    s = act(s, { type: 'ACK_ROLE', playerId: 'p0' });
    expect(reduce(s, { type: 'ACK_ROLE', playerId: 'p0' }).state).toBe(s);
  });

  it('acknowledges for a player whose clock runs out', () => {
    let s = started(7);
    const r = reduce(s, { type: 'TIME_OUT', playerId: 'p1' });
    expect(r.events[0]).toEqual({ type: 'TIMED_OUT', playerId: 'p1' });
    expect(r.state.acks).toContain('p1');
    s = r.state;
    for (const id of s.seats) {
      if (!s.acks.includes(id)) s = act(s, { type: 'ACK_ROLE', playerId: id });
    }
    expect(s.phase).toBe('night');
  });
});

/* ------------------------------- the night ---------------------------- */

describe('the night', () => {
  it('resolves a full night: the save beats the kill, the detective learns', () => {
    let s = nighted(11);
    const [god, maf, doc, det] = ['godfather', 'mafia', 'doctor', 'detective']
      .map((r) => byRole(s, r as MafiaRole));
    const [v1, v2] = villagers(s);

    expect(waitingOn(s).sort()).toEqual([god, maf, doc, det].sort());

    const bad = reduce(s, { type: 'NIGHT_KILL', playerId: v1, target: god });
    expect(bad.state).toBe(s);
    expect(bad.events).toEqual([]);

    s = act(s, { type: 'NIGHT_KILL', playerId: god, target: v1 });
    expect(s.secret!.night.killBy).toBe(god);
    expect(privateFor(s, maf)!.nightKill).toEqual({ by: god, target: v1 });
    expect(privateFor(s, v1)!.nightKill).toBeNull();

    // The team may revise its choice while the night is young.
    s = act(s, { type: 'NIGHT_KILL', playerId: maf, target: v2 });
    expect(s.secret!.night).toMatchObject({ killBy: maf, kill: v2 });

    s = act(s, { type: 'NIGHT_SAVE', playerId: doc, target: v2 });
    expect(s.phase).toBe('night');
    const r = reduce(s, { type: 'NIGHT_CHECK', playerId: det, target: maf });
    s = r.state;
    expect(r.events.map((e) => e.type)).toEqual(['ACTED', 'DAWN', 'DAY_STARTED']);
    expect(s.phase).toBe('day');
    expect(s.lastDeaths).toEqual([]);
    for (const id of s.seats) expect(s.players[id].alive).toBe(true);
    expect(privateFor(s, det)!.checks).toEqual([{ round: 1, target: maf, guilty: true }]);

    // The godfather reads innocent.
    s = act(s, { type: 'TIME_OUT', playerId: v1 });
    const abstain: Record<string, string | null> = {};
    for (const id of s.seats) abstain[id] = null;
    let out = castVotes(s, abstain);
    expect(out.events.some((e) => e.type === 'NO_LYNCH')).toBe(true);
    s = out.state;
    expect(s.phase).toBe('night');
    expect(s.round).toBe(2);

    s = act(s, { type: 'NIGHT_KILL', playerId: god, target: v2 });
    s = act(s, { type: 'NIGHT_SAVE', playerId: doc, target: doc });
    out = { state: act(s, { type: 'NIGHT_CHECK', playerId: det, target: god }), events: [] };
    s = out.state;
    expect(s.phase).toBe('day');
    expect(s.lastDeaths).toEqual([{ id: v2, role: 'villager' }]);
    expect(s.players[v2].alive).toBe(false);
    expect(privateFor(s, det)!.checks).toEqual([
      { round: 1, target: maf, guilty: true },
      { round: 2, target: god, guilty: false },
    ]);
  });

  it('spends the sniper\'s only bullet and refuses a second', () => {
    let s = nighted(21, 11);
    const [god, doc, det, bg, snp, sil] = ['godfather', 'doctor', 'detective', 'bodyguard', 'sniper', 'silencer']
      .map((r) => byRole(s, r as MafiaRole));
    const [v1] = villagers(s);

    expect(nightPendingFor(s, snp)).toBe(true);
    s = act(s, { type: 'NIGHT_KILL', playerId: god, target: v1 });
    s = act(s, { type: 'NIGHT_SILENCE', playerId: sil, target: null });
    s = act(s, { type: 'NIGHT_SAVE', playerId: doc, target: v1 });
    s = act(s, { type: 'NIGHT_CHECK', playerId: det, target: null });
    s = act(s, { type: 'NIGHT_GUARD', playerId: bg, target: null });
    const r = reduce(s, { type: 'NIGHT_SHOOT', playerId: snp, target: god });
    s = r.state;
    expect(r.events.find((e) => e.type === 'DAWN')).toEqual({
      type: 'DAWN', round: 1, deaths: [{ id: god, role: 'godfather' }],
    });
    expect(s.players[god].alive).toBe(false);
    expect(s.secret!.sniperUsed[snp]).toBe(true);
    expect(privateFor(s, snp)!.sniperShotsLeft).toBe(0);

    // Night 2: the sniper holds no duty and no second bullet.
    s = passNight(s);
    s = act(s, { type: 'TIME_OUT', playerId: v1 });
    const abstain: Record<string, string | null> = {};
    for (const id of s.seats) if (s.players[id].alive && !s.silencedToday.includes(id)) abstain[id] = null;
    s = castVotes(s, abstain).state;
    expect(s.phase).toBe('night');
    expect(nightPendingFor(s, snp)).toBe(false);
    const again = reduce(s, { type: 'NIGHT_SHOOT', playerId: snp, target: byRole(s, 'mafia') });
    expect(again.state).toBe(s);
    expect(s.secret!.sniperUsed[snp]).toBe(true);
  });

  it('silences a player out of the next day\'s vote', () => {
    let s = nighted(33, 11);
    const sil = byRole(s, 'silencer');
    const [v1] = villagers(s);
    s = act(s, { type: 'NIGHT_SILENCE', playerId: sil, target: v1 });
    s = passNight(s);
    expect(s.phase).toBe('day');
    expect(s.silencedToday).toEqual([v1]);

    s = act(s, { type: 'TIME_OUT', playerId: sil });
    expect(s.phase).toBe('vote');
    expect(waitingOn(s)).not.toContain(v1);
    expect(reduce(s, { type: 'VOTE', playerId: v1, target: null }).state).toBe(s);
    expect(reduce(s, { type: 'TIME_OUT', playerId: v1 }).state).toBe(s);

    const abstain: Record<string, string | null> = {};
    for (const id of s.seats) if (s.players[id].alive && id !== v1) abstain[id] = null;
    s = castVotes(s, abstain).state;
    expect(s.phase).toBe('night');
    expect(s.silencedToday).toEqual([]);
  });
});

/* -------------------------------- the vote ----------------------------- */

describe('the vote', () => {
  it('closes the discussion on anybody\'s clock and only theirs if seated', () => {
    let s = passNight(nighted(5));
    expect(s.phase).toBe('day');
    expect(clockSeconds(edit(s, (x) => { x.settings.discussionSeconds = 90; x.settings.turnTimer = 30; }))).toBe(90);
    expect(reduce(s, { type: 'TIME_OUT', playerId: 'ghost' }).state).toBe(s);
    const r = reduce(s, { type: 'TIME_OUT', playerId: s.seats[0] });
    expect(r.events).toEqual([{ type: 'TIMED_OUT', playerId: s.seats[0] }]);
    expect(r.state.phase).toBe('vote');
  });

  it('lynches on a strict plurality and lets voters change their mind', () => {
    let s = voting(13);
    const [v1, v2] = villagers(s);
    const god = byRole(s, 'godfather');
    const doc = byRole(s, 'doctor');
    const det = byRole(s, 'detective');
    const maf = byRole(s, 'mafia');

    s = act(s, { type: 'VOTE', playerId: doc, target: v2 });
    s = act(s, { type: 'VOTE', playerId: doc, target: v1 });
    expect(s.votes[doc]).toBe(v1);
    const { state, events } = castVotes(s, { [det]: v1, [god]: v2, [maf]: null, [v1]: null, [v2]: null });
    expect(events).toContainEqual({ type: 'LYNCHED', playerId: v1, role: 'villager' });
    expect(state.players[v1].alive).toBe(false);
    expect(events.some((e) => e.type === 'NIGHT_FALLS' && e.round === 2)).toBe(true);
    expect(state.phase).toBe('night');
    expect(state.lastDeaths).toEqual([]);
  });

  it('hangs nobody on a tie or on all abstentions', () => {
    let s = voting(14);
    const [v1, v2] = villagers(s);
    const god = byRole(s, 'godfather');
    const maf = byRole(s, 'mafia');
    const doc = byRole(s, 'doctor');
    const det = byRole(s, 'detective');

    const tied = castVotes(s, { [god]: v1, [maf]: v2, [doc]: null, [det]: null, [v1]: null, [v2]: null });
    expect(tied.events.some((e) => e.type === 'NO_LYNCH')).toBe(true);
    for (const id of tied.state.seats) expect(tied.state.players[id].alive).toBe(true);
    expect(tied.state.phase).toBe('night');
    expect(tied.state.votes).toEqual({});

    s = voting(14);
    const abstain: Record<string, string | null> = {};
    for (const id of s.seats) abstain[id] = null;
    const none = castVotes(s, abstain);
    expect(none.events.some((e) => e.type === 'NO_LYNCH')).toBe(true);
    expect(none.state.phase).toBe('night');
  });

  it('rejects votes from the dead, the self and the wrong phase', () => {
    let s = voting(15);
    const [v1] = villagers(s);
    const dead = byRole(s, 'detective');
    s = edit(s, (x) => { x.players[dead].alive = false; });
    expect(reduce(s, { type: 'VOTE', playerId: dead, target: v1 }).state).toBe(s);
    expect(reduce(s, { type: 'VOTE', playerId: v1, target: v1 }).state).toBe(s);
    expect(reduce(s, { type: 'VOTE', playerId: 'ghost', target: v1 }).state).toBe(s);
    const day = passNight(nighted(15));
    expect(reduce(day, { type: 'VOTE', playerId: v1, target: null }).state).toBe(day);
  });

  it('abstains for a voter whose clock runs out', () => {
    const s = voting(16);
    const [pid] = waitingOn(s);
    const r = reduce(s, { type: 'TIME_OUT', playerId: pid });
    expect(r.events.slice(0, 2)).toEqual([
      { type: 'TIMED_OUT', playerId: pid },
      { type: 'VOTED', playerId: pid, target: null },
    ]);
    expect(r.state.votes[pid]).toBeNull();
    expect(reduce(r.state, { type: 'TIME_OUT', playerId: pid }).state).toBe(r.state);
  });
});

/* ------------------------------ the endings ---------------------------- */

describe('the endings', () => {
  it('crowns the jester the moment the town hangs him', () => {
    const s = voting(17, 9);
    const jes = byRole(s, 'jester');
    const votes: Record<string, string | null> = {};
    const backers = s.seats.filter((id) => id !== jes).slice(0, 3);
    for (const id of s.seats) votes[id] = backers.includes(id) ? jes : null;
    const { state, events } = castVotes(s, votes);
    expect(events).toContainEqual({ type: 'LYNCHED', playerId: jes, role: 'jester' });
    expect(events).toContainEqual({ type: 'GAME_OVER', winner: 'jester', winnerId: jes });
    expect(state.phase).toBe('game_over');
    expect(state.winner).toBe('jester');
    expect(state.winnerId).toBe(jes);
    expect(reduce(state, { type: 'VOTE', playerId: backers[0], target: null }).state).toBe(state);
  });

  it('pays the mafia when they reach parity', () => {
    let s = nighted(18);
    const det = byRole(s, 'detective');
    const [v1, v2] = villagers(s);
    s = edit(s, (x) => { x.players[det].alive = false; x.players[v2].alive = false; });
    const god = byRole(s, 'godfather');
    const doc = byRole(s, 'doctor');
    s = act(s, { type: 'NIGHT_KILL', playerId: god, target: v1 });
    const r = reduce(s, { type: 'NIGHT_SAVE', playerId: doc, target: doc });
    expect(r.events.map((e) => e.type)).toEqual(['ACTED', 'DAWN', 'GAME_OVER']);
    expect(r.events).toContainEqual({ type: 'GAME_OVER', winner: 'mafia', winnerId: null });
    expect(r.state.phase).toBe('game_over');
    expect(r.state.winner).toBe('mafia');
  });

  it('frees the village when the last mafioso swings', () => {
    let s = nighted(19);
    const maf = byRole(s, 'mafia');
    s = edit(s, (x) => { x.players[maf].alive = false; });
    s = passNight(s);
    s = act(s, { type: 'TIME_OUT', playerId: villagers(s)[0] });
    const god = byRole(s, 'godfather');
    const doc = byRole(s, 'doctor');
    const det = byRole(s, 'detective');
    const [v1, v2] = villagers(s);
    const { state, events } = castVotes(s, { [doc]: god, [det]: god, [v1]: god, [v2]: null, [god]: null });
    expect(events).toContainEqual({ type: 'LYNCHED', playerId: god, role: 'godfather' });
    expect(events).toContainEqual({ type: 'GAME_OVER', winner: 'village', winnerId: null });
    expect(state.winner).toBe('village');
  });
});

/* --------------------------- the clock and rules ------------------------ */

describe('the clock and the rules', () => {
  it('times each phase from the settings', () => {
    const patch = { turnTimer: 30, discussionSeconds: 90 };
    expect(clockSeconds(started(3, 6, patch))).toBe(30);
    expect(clockSeconds(nighted(3, 6, patch))).toBe(30);
    expect(clockSeconds(voting(3, 6, patch))).toBe(30);
    expect(clockSeconds(passNight(nighted(3, 6, patch)))).toBe(90);
    expect(clockSeconds(passNight(nighted(3, 6, { turnTimer: 30, discussionSeconds: 0 })))).toBe(30);
    expect(clockSeconds(createMafia(settings(3, patch), seats(6)))).toBe(0);
  });

  it('keys the clock on phase, round and headcount', () => {
    const s = nighted(4);
    expect(clockKey(s)).toBe(`night:1:${waitingOn(s).length}`);
    const r = reduce(s, { type: 'NIGHT_SAVE', playerId: byRole(s, 'doctor'), target: null });
    expect(clockKey(r.state)).toBe(`night:1:${waitingOn(r.state).length}`);
    expect(clockKey(r.state)).not.toBe(clockKey(s));
  });

  it('shows the mafia their team and nobody else', () => {
    const s = nighted(6);
    const god = byRole(s, 'godfather');
    const maf = byRole(s, 'mafia');
    const [v1] = villagers(s);
    expect(privateFor(s, god)!.teammates).toEqual([
      { id: god, role: 'godfather' },
      { id: maf, role: 'mafia' },
    ].sort((a, b) => s.seats.indexOf(a.id) - s.seats.indexOf(b.id)));
    expect(privateFor(s, v1)!.teammates).toEqual([]);
    expect(privateFor(s, v1)!.role).toBe('villager');
  });
});

/* -------------------------------- seats -------------------------------- */

describe('seats', () => {
  it('hands a bot\'s seat to a signed-in player and back', () => {
    let s = createMafia(settings(8), seats(6, true));
    s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
    const taken = handOverSeat(s, 'p1', 'Ada');
    expect(taken.events).toEqual([{ type: 'SEAT_TAKEN', playerId: 'p1', name: 'Ada', previous: 'P1' }]);
    expect(taken.state.players.p1).toMatchObject({ name: 'Ada', isBot: false });
    expect(handOverSeat(taken.state, 'p1', 'Bob').state).toBe(taken.state);
    const botted = botifySeat(taken.state, 'p1');
    expect(botted.events).toEqual([]);
    expect(botted.state.players.p1.isBot).toBe(true);
    expect(botted.state.version).toBe(taken.state.version + 1);
  });

  it('never hands over a seat in the lobby', () => {
    const s = createMafia(settings(8), seats(6, true));
    expect(handOverSeat(s, 'p1', 'Ada').state).toBe(s);
    expect(botifySeat(s, 'p1').state).toBe(s);
  });
});

/* ------------------------- what the table learns ------------------------- */

describe('what the table learns', () => {
  it('keeps every role hidden until the end, then shows them all', () => {
    let s = nighted(19);
    expect(s.finalRoles).toBeNull();
    const maf = byRole(s, 'mafia');
    s = edit(s, (x) => { x.players[maf].alive = false; });
    s = passNight(s);
    s = act(s, { type: 'TIME_OUT', playerId: villagers(s)[0] });
    const god = byRole(s, 'godfather');
    const doc = byRole(s, 'doctor');
    const det = byRole(s, 'detective');
    const [v1, v2] = villagers(s);
    const { state } = castVotes(s, { [doc]: god, [det]: god, [v1]: god, [v2]: null, [god]: null });
    expect(state.finalRoles).toEqual(state.secret!.roles);
    expect(state.revealed?.[god]).toBe('godfather');
  });

  it('records a shown death, and nothing when roles stay hidden', () => {
    const shown = nighted(5);
    const hidden = nighted(5, 6, { revealRolesOnDeath: false });
    for (const s0 of [shown, hidden]) {
      const god = byRole(s0, 'godfather');
      const [v1] = villagers(s0);
      let s = act(s0, { type: 'NIGHT_KILL', playerId: god, target: v1 });
      s = passNight(s);
      expect(s.players[v1].alive).toBe(false);
      expect(s.revealed?.[v1]).toBe(s0 === shown ? 'villager' : undefined);
    }
  });

  it('tells each player what the night still wants from them, and what they chose', () => {
    const s = nighted(6);
    const doc = byRole(s, 'doctor');
    const [v1] = villagers(s);
    expect(privateFor(s, doc)!.pending).toEqual(['save']);
    expect(privateFor(s, v1)!.pending).toEqual([]);
    const after = act(s, { type: 'NIGHT_SAVE', playerId: doc, target: v1 });
    expect(privateFor(after, doc)!.pending).toEqual([]);
    expect(privateFor(after, doc)!.chosen).toEqual({ save: v1 });
  });
});

/* --------------------------------- fuzz --------------------------------- */

describe('fuzz', () => {
  it('plays 200 bot tables of every size to an ending', async () => {
    const { mfBotDecide } = await import('./ai');
    for (let seed = 1; seed <= 200; seed++) {
      const n = 5 + (seed % 8);
      let s = createMafia(settings(seed * 7919), seats(n, true));
      s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
      for (let step = 0; step < 2000 && s.phase !== 'game_over'; step++) {
        // The day runs on the clock alone: close it straight away.
        if (s.phase === 'day') {
          const first = s.seats.find((id) => s.players[id].alive)!;
          s = act(s, { type: 'TIME_OUT', playerId: first });
          continue;
        }
        const mover = s.seats.map((id) => mfBotDecide(s, id)).find((a) => a);
        expect(mover, `seed ${seed} stalled in ${s.phase}`).toBeTruthy();
        s = act(s, mover!);
        // Somebody is always left standing to end it.
        const alive = s.seats.filter((id) => s.players[id].alive);
        expect(alive.length).toBeGreaterThan(0);
      }
      expect(s.phase, `seed ${seed}`).toBe('game_over');
      expect(s.finalRoles).not.toBeNull();
      expect(['mafia', 'village', 'jester']).toContain(s.winner);
    }
  });
});
