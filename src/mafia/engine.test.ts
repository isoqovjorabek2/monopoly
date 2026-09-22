import { describe, expect, it } from 'vitest';
import type { SeatSpec } from '../game/engine';
import { mfBotDecide } from './ai';
import { autoRoles, castProblem, dealRoles } from './data';
import { MAF_DEFAULTS, botifySeat, createMafia, handOverSeat, reduce, spendLastWords } from './engine';
import { actingBoss, clockKey, clockSeconds, privateFor, waitingOn } from './rules';
import type {
  MafiaAction, MafiaRole, MafiaSettings, MafiaState, NightKind, RoleCount,
} from './types';

const seats = (n: number, bots = false): SeatSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, token: 'camel' as const, color: '#fff', isBot: bots,
  }));

/** One of every role: three of the family, the jester, five of the town. */
const FULL: RoleCount[] = [
  { role: 'godfather', count: 1 }, { role: 'mafia', count: 1 }, { role: 'silencer', count: 1 },
  { role: 'doctor', count: 1 }, { role: 'detective', count: 1 }, { role: 'bodyguard', count: 1 },
  { role: 'sniper', count: 1 }, { role: 'jester', count: 1 }, { role: 'villager', count: 2 },
];

const settings = (seed: number, patch: Partial<MafiaSettings> = {}): MafiaSettings =>
  ({ ...MAF_DEFAULTS, seed, roles: FULL, ...patch });

/** Roles dealt, night one fallen. */
function started(seed: number, n = 10, patch: Partial<MafiaSettings> = {}): MafiaState {
  const s = createMafia(settings(seed, patch), seats(n));
  return reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
}

const edit = (s: MafiaState, fn: (s: MafiaState) => void): MafiaState => {
  const c = JSON.parse(JSON.stringify(s)) as MafiaState;
  fn(c);
  return c;
};

const byRole = (s: MafiaState, role: MafiaRole): string => s.seats.find((id) => s.secret!.roles[id] === role)!;
const villagers = (s: MafiaState): string[] => s.seats.filter((id) => s.secret!.roles[id] === 'villager');

const act = (s: MafiaState, a: MafiaAction): MafiaState => {
  const r = reduce(s, a);
  expect(r.state.version, `${a.type} refused`).toBe(s.version + 1);
  return r.state;
};
const move = (s: MafiaState, by: string, kind: NightKind, target: string): MafiaState =>
  act(s, { type: 'NIGHT_MOVE', playerId: by, kind, target });
const advance = (s: MafiaState): MafiaState => act(s, { type: 'ADVANCE', playerId: 'p0' });

/** Everyone who still owes the night a move makes a harmless one. */
function quietNight(s: MafiaState, except: string[] = []): MafiaState {
  for (const id of waitingOn(s)) {
    if (except.includes(id)) continue;
    const role = s.secret!.roles[id];
    if (role === 'mafia' || role === 'godfather') continue; // no kill unless asked
    // Moves that touch nobody the tests aim at: the doctor keeps to
    // themselves, the rest look at the sniper.
    const kind: NightKind = role === 'silencer' ? 'silence' : role === 'doctor' ? 'protect'
      : role === 'detective' ? 'investigate' : 'guard';
    s = move(s, id, kind, kind === 'protect' ? id : byRole(s, 'sniper'));
  }
  return s;
}

/* -------------------------------- dealing -------------------------------- */

describe('dealing', () => {
  it('deals the host\'s cast when it fits, and a balanced one when it does not', () => {
    expect(dealRoles(FULL, 10).sort()).toEqual(FULL.flatMap((r) => Array(r.count).fill(r.role)).sort());
    expect(dealRoles(FULL, 7).sort()).toEqual(autoRoles(7).flatMap((r) => Array(r.count).fill(r.role)).sort());
    expect(dealRoles(null, 5)).toHaveLength(5);
  });

  it('refuses casts that cannot be played', () => {
    expect(castProblem(FULL, 10)).toBeNull();
    expect(castProblem(FULL, 9)).toBe('size');
    expect(castProblem([{ role: 'villager', count: 4 }], 4)).toBe('no_mafia');
    expect(castProblem([{ role: 'mafia', count: 2 }, { role: 'villager', count: 2 }], 4)).toBe('mafia_heavy');
  });

  it('opens on the first night with every role dealt, and tells nobody else\'s', () => {
    const s = started(1);
    expect(s.phase).toBe('night');
    expect(s.round).toBe(1);
    const god = byRole(s, 'godfather');
    const doc = byRole(s, 'doctor');
    expect(privateFor(s, god)!.teammates.map((x) => x.role).sort()).toEqual(['godfather', 'mafia', 'silencer']);
    expect(privateFor(s, god)!.boss).toBe(god);
    expect(privateFor(s, doc)!.teammates).toEqual([]);
    expect(privateFor(s, doc)!.boss).toBeNull();
  });

  it('needs four at the table', () => {
    const s = createMafia(settings(1), seats(3));
    expect(reduce(s, { type: 'START_GAME', playerId: 'p0' }).state).toBe(s);
  });
});

/* -------------------------------- the night ------------------------------ */

describe('the night', () => {
  it('lets the boss decide the kill, whatever the others pick', () => {
    let s = started(2);
    const god = byRole(s, 'godfather');
    const maf = byRole(s, 'mafia');
    const [v1, v2] = villagers(s);
    s = move(s, maf, 'kill', v2);
    expect(privateFor(s, god)!.familyPicks).toEqual({ [maf]: v2 });
    s = move(s, god, 'kill', v1);
    s = quietNight(s);
    expect(s.phase).toBe('day');
    expect(s.players[v1].alive).toBe(false);
    expect(s.players[v2].alive).toBe(true);
    expect(s.lastDeaths).toEqual([{ id: v1, role: 'villager', cause: 'mafia' }]);
  });

  it('falls back to the family\'s most-named target when the boss is silent', () => {
    let s = started(3);
    const maf = byRole(s, 'mafia');
    const [v1] = villagers(s);
    s = move(s, maf, 'kill', v1);
    s = quietNight(s);
    s = advance(s); // the godfather never moved: the clock ends the night
    expect(s.players[v1].alive).toBe(false);
  });

  it('never lets the family mark its own, or anyone move twice', () => {
    const s = started(4);
    const god = byRole(s, 'godfather');
    const maf = byRole(s, 'mafia');
    expect(reduce(s, { type: 'NIGHT_MOVE', playerId: god, kind: 'kill', target: maf }).state).toBe(s);
    const once = move(s, god, 'kill', villagers(s)[0]);
    expect(reduce(once, { type: 'NIGHT_MOVE', playerId: god, kind: 'kill', target: villagers(s)[1] }).state).toBe(once);
  });

  it('lets the doctor save, and not the same patient twice running', () => {
    let s = started(5);
    const god = byRole(s, 'godfather');
    const doc = byRole(s, 'doctor');
    const [v1] = villagers(s);
    s = move(s, god, 'kill', v1);
    s = move(s, doc, 'protect', v1);
    const r = reduce(quietNight(s, [doc]), { type: 'ADVANCE', playerId: 'p0' });
    s = r.state;
    expect(s.players[v1].alive).toBe(true);
    expect(s.lastSaved).toEqual([v1]);
    expect(r.events.find((e) => e.type === 'DAWN')).toMatchObject({ saved: [v1], deaths: [] });
    // Through the day and the vote, to the next night.
    s = advance(advance(s));
    expect(s.phase).toBe('night');
    expect(privateFor(s, doc)!.noProtect).toBe(v1);
    expect(reduce(s, { type: 'NIGHT_MOVE', playerId: doc, kind: 'protect', target: v1 }).state).toBe(s);
  });

  it('puts the bodyguard in the grave in place of the one they guard', () => {
    let s = started(6);
    const god = byRole(s, 'godfather');
    const bg = byRole(s, 'bodyguard');
    const [v1] = villagers(s);
    s = move(s, god, 'kill', v1);
    s = move(s, bg, 'guard', v1);
    s = advance(quietNight(s, [bg]));
    expect(s.players[v1].alive).toBe(true);
    expect(s.players[bg].alive).toBe(false);
    expect(s.lastDeaths).toEqual([{ id: bg, role: 'bodyguard', cause: 'bodyguard', saved: v1 }]);
  });

  it('shows the detective a role at once, the godfather as a villager', () => {
    let s = started(7);
    const det = byRole(s, 'detective');
    const god = byRole(s, 'godfather');
    s = move(s, det, 'investigate', god);
    expect(privateFor(s, det)!.checks).toEqual([{ round: 1, target: god, seen: 'villager', guilty: false }]);
  });

  it('lets the detective shoot past the doctor, but not past a bodyguard', () => {
    let s = started(8);
    const det = byRole(s, 'detective');
    const doc = byRole(s, 'doctor');
    const maf = byRole(s, 'mafia');
    s = move(s, det, 'shoot', maf);
    s = move(s, doc, 'protect', maf);
    s = advance(quietNight(s, [det, doc]));
    expect(s.players[maf].alive).toBe(false);
    expect(s.lastDeaths[0]).toMatchObject({ id: maf, cause: 'detective' });

    let t = started(8);
    const bg = byRole(t, 'bodyguard');
    t = move(t, byRole(t, 'detective'), 'shoot', byRole(t, 'mafia'));
    t = move(t, bg, 'guard', byRole(t, 'mafia'));
    t = advance(quietNight(t, [byRole(t, 'detective'), bg]));
    expect(t.players[byRole(t, 'mafia')].alive).toBe(true);
    expect(t.players[bg].alive).toBe(false);
  });

  it('gags the silenced through the talk, and gives them back the vote', () => {
    let s = started(9);
    const sil = byRole(s, 'silencer');
    const [v1] = villagers(s);
    s = move(s, sil, 'silence', v1);
    s = advance(quietNight(s, [sil]));
    expect(s.silencedToday).toEqual([v1]);
    s = advance(s);
    expect(s.phase).toBe('vote');
    expect(s.silencedToday).toEqual([]);
    expect(reduce(s, { type: 'VOTE', playerId: v1, target: sil }).state.votes[v1]).toBe(sil);
  });

  it('ends the night the moment the last night role moves', () => {
    let s = started(10);
    s = move(s, byRole(s, 'godfather'), 'kill', villagers(s)[0]);
    s = move(s, byRole(s, 'mafia'), 'kill', villagers(s)[0]);
    s = quietNight(s);
    expect(s.phase).toBe('day');
  });
});

/* ------------------------------ the day ------------------------------ */

function toDay(seed: number, patch: Partial<MafiaSettings> = {}): MafiaState {
  return advance(started(seed, 10, patch));
}

describe('the day and the vote', () => {
  it('lets the sniper fire once, by day, and it lands at once', () => {
    let s = toDay(11);
    const sn = byRole(s, 'sniper');
    const maf = byRole(s, 'mafia');
    const r = reduce(s, { type: 'SNIPE', playerId: sn, target: maf });
    s = r.state;
    expect(s.players[maf].alive).toBe(false);
    expect(r.events).toContainEqual({ type: 'SNIPED', playerId: maf, role: 'mafia' });
    expect(privateFor(s, sn)!.shotLeft).toBe(false);
    expect(reduce(s, { type: 'SNIPE', playerId: sn, target: byRole(s, 'godfather') }).state).toBe(s);
  });

  it('crowns the jester when the sniper shoots him', () => {
    const s = toDay(12);
    const r = reduce(s, { type: 'SNIPE', playerId: byRole(s, 'sniper'), target: byRole(s, 'jester') });
    expect(r.state.winner).toBe('jester');
  });

  it('hangs the most-voted, spares everyone on a tie, and lets a vote be taken back', () => {
    let s = advance(toDay(13));
    const [v1, v2] = villagers(s);
    const maf = byRole(s, 'mafia');
    s = act(s, { type: 'VOTE', playerId: v1, target: maf });
    s = act(s, { type: 'VOTE', playerId: v1, target: null });
    expect(s.votes).toEqual({});
    s = act(s, { type: 'VOTE', playerId: v1, target: maf });
    s = act(s, { type: 'VOTE', playerId: v2, target: maf });
    s = advance(s);
    expect(s.players[maf].alive).toBe(false);
    expect(s.lastVoteMargin).toBe(2);
    expect(s.phase).toBe('night');
    expect(s.round).toBe(2);

    let t = advance(toDay(13));
    t = act(t, { type: 'VOTE', playerId: v1, target: v2 });
    t = act(t, { type: 'VOTE', playerId: v2, target: v1 });
    const r = reduce(t, { type: 'ADVANCE', playerId: 'p0' });
    expect(r.events).toContainEqual({ type: 'NO_LYNCH', tie: true });
  });

  it('closes the vote as soon as the last of the living has voted', () => {
    let s = advance(toDay(14));
    const target = byRole(s, 'mafia');
    for (const id of s.seats.filter((x) => s.players[x].alive)) {
      s = act(s, { type: 'VOTE', playerId: id, target: id === target ? villagers(s)[0] : target });
    }
    expect(s.phase === 'night' || s.phase === 'game_over').toBe(true);
  });

  it('crowns the jester the town hangs', () => {
    let s = advance(toDay(15));
    const jes = byRole(s, 'jester');
    s = act(s, { type: 'VOTE', playerId: villagers(s)[0], target: jes });
    s = advance(s);
    expect(s.winner).toBe('jester');
    expect(s.winnerId).toBe(jes);
    expect(s.finalRoles).toEqual(s.secret!.roles);
  });
});

/* ------------------------------ the endings ------------------------------ */

describe('the endings', () => {
  it('frees the town when the last of the family is gone, and names an MVP', () => {
    let s = toDay(16);
    s = edit(s, (x) => {
      for (const id of x.seats) if (['godfather', 'silencer'].includes(x.secret!.roles[id])) x.players[id].alive = false;
    });
    s = advance(s);
    const maf = byRole(s, 'mafia');
    for (const v of villagers(s)) s = act(s, { type: 'VOTE', playerId: v, target: maf });
    s = advance(s);
    expect(s.winner).toBe('village');
    expect(s.mvp).not.toBeNull();
    expect(s.secret!.stats[villagers(s)[0]].reads).toBe(1);
  });

  it('hands the family the town once it matches the rest', () => {
    let s = started(17, 6, { roles: [{ role: 'mafia', count: 2 }, { role: 'villager', count: 4 }] });
    const [m1] = s.seats.filter((id) => s.secret!.roles[id] === 'mafia');
    const vs = villagers(s);
    s = edit(s, (x) => { x.players[vs[0]].alive = false; });
    s = move(s, m1, 'kill', vs[1]);
    s = advance(s);
    expect(s.winner).toBe('mafia');
  });

  it('keeps the family\'s number secret when roles stay hidden', () => {
    expect(started(18).aliveCounts).toEqual({ village: 6, mafia: 3, jester: 1 });
    expect(started(18, 10, { revealRolesOnDeath: false }).aliveCounts).toBeNull();
  });
});

/* --------------------------- clock and seats --------------------------- */

describe('the clock and the seats', () => {
  it('times each phase from its own setting, once per phase', () => {
    const s = started(19, 10, { nightSeconds: 45, daySeconds: 90, voteSeconds: 30 });
    expect(clockSeconds(s)).toBe(45);
    expect(clockKey(s)).toBe('night:1');
    const day = advance(s);
    expect(clockSeconds(day)).toBe(90);
    expect(clockSeconds(advance(day))).toBe(30);
  });

  it('hands a lone silencer the knife', () => {
    let s = started(23);
    const sil = byRole(s, 'silencer');
    expect(privateFor(s, sil)!.kinds).toEqual(['silence']);
    s = edit(s, (x) => { for (const id of x.seats) if (['godfather', 'mafia'].includes(x.secret!.roles[id])) x.players[id].alive = false; });
    expect(privateFor(s, sil)!.kinds).toEqual(['kill', 'silence']);
    const [v1] = villagers(s);
    s = move(s, sil, 'kill', v1);
    s = advance(s);
    expect(s.players[v1].alive).toBe(false);
  });

  it('passes the family\'s say down when the godfather falls', () => {
    const s = started(20);
    const next = edit(s, (x) => { x.players[byRole(s, 'godfather')].alive = false; });
    expect(actingBoss(next)).toBe(byRole(s, 'silencer'));
  });

  it('hands a bot\'s seat to a signed-in player and back', () => {
    let s = createMafia(settings(21), seats(10, true));
    s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
    const taken = handOverSeat(s, 'p1', 'Ada');
    expect(taken.state.players.p1).toMatchObject({ name: 'Ada', isBot: false });
    expect(botifySeat(taken.state, 'p1').state.players.p1.isBot).toBe(true);
  });

  it('gives each of the dead one last word', () => {
    const s = started(22);
    const once = spendLastWords(s, 'p1');
    expect(once.lastWords).toEqual(['p1']);
    expect(spendLastWords(once, 'p1')).toBe(once);
  });
});

/* --------------------------------- fuzz --------------------------------- */

describe('fuzz', () => {
  it('plays 300 bot tables of every size and cast to an ending', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const n = 4 + (seed % 12);
      const roles = seed % 3 === 0 ? FULL : null;
      let s = createMafia(settings(seed * 7919, { roles }), seats(n, true));
      s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
      for (let step = 0; step < 3000 && s.phase !== 'game_over'; step++) {
        const mover = s.seats.map((id) => mfBotDecide(s, id)).find((a) => a);
        // Whatever the bots leave undone, the clock finishes.
        s = mover ? act(s, mover) : advance(s);
        if (s.secret) {
          for (const id of s.seats) {
            if (!s.players[id].alive) expect(s.revealed[id] ?? null).toBe(s.secret.roles[id]);
          }
        }
      }
      expect(s.phase, `seed ${seed}`).toBe('game_over');
      expect(['mafia', 'village', 'jester']).toContain(s.winner);
      expect(s.mvp).not.toBeNull();
    }
  });
});
