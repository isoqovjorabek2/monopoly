import { describe, expect, it } from 'vitest';
import type { SeatSpec } from '../game/engine';
import {
  heatMap, mentionsIn, mfBotDecide, mfBotLine, talkKind, type TalkLine,
} from './ai';
import { MAF_DEFAULTS, createMafia, reduce } from './engine';
import { isFamily } from './rules';
import type { MafiaAction, MafiaRole, MafiaSettings, MafiaState, RoleCount } from './types';

const seats = (n: number, bots = true): SeatSpec[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, token: 'camel' as const, color: '#fff', isBot: bots,
  }));

const CAST: RoleCount[] = [
  { role: 'godfather', count: 1 }, { role: 'mafia', count: 1 },
  { role: 'doctor', count: 1 }, { role: 'detective', count: 1 }, { role: 'villager', count: 4 },
];

const settings = (seed: number, patch: Partial<MafiaSettings> = {}): MafiaSettings =>
  ({ ...MAF_DEFAULTS, seed, roles: CAST, botLevel: 'hard', ...patch });

function started(seed: number, n = 8, patch: Partial<MafiaSettings> = {}, bots = true): MafiaState {
  return reduce(createMafia(settings(seed, patch), seats(n, bots)), { type: 'START_GAME', playerId: 'p0' }).state;
}

const edit = (s: MafiaState, fn: (s: MafiaState) => void): MafiaState => {
  const c = JSON.parse(JSON.stringify(s)) as MafiaState;
  fn(c);
  return c;
};
const byRole = (s: MafiaState, role: MafiaRole): string => s.seats.find((id) => s.secret!.roles[id] === role)!;
const townOf = (s: MafiaState): string[] => s.seats.filter((id) => !isFamily(s.secret!.roles[id]));
const act = (s: MafiaState, a: MafiaAction): MafiaState => reduce(s, a).state;

/** Straight to the vote of round 1, nobody dead. */
const atVote = (s: MafiaState): MafiaState => edit(s, (x) => { x.phase = 'vote'; x.votes = {}; });

describe('the vote history', () => {
  it('keeps every closed vote, with whom it hanged', () => {
    let s = atVote(started(3));
    const [a, b, c] = townOf(s);
    s = act(s, { type: 'VOTE', playerId: a, target: b });
    s = act(s, { type: 'VOTE', playerId: c, target: b });
    s = act(s, { type: 'ADVANCE', playerId: 'p0' });
    expect(s.voteHistory).toHaveLength(1);
    expect(s.voteHistory![0]).toEqual({ round: 1, votes: { [a]: b, [c]: b }, hanged: b });
  });
});

describe('the heat', () => {
  it('marks whoever helped hang a townsperson, once the role is shown', () => {
    let s = started(5);
    const [victim, voter, bystander] = townOf(s);
    s = edit(s, (x) => {
      x.players[victim].alive = false;
      x.revealed[victim] = x.secret!.roles[victim];
      x.voteHistory = [{ round: 1, votes: { [voter]: victim }, hanged: victim }];
      x.round = 2;
    });
    const heat = heatMap(s, bystander);
    expect(heat[voter]).toBeGreaterThan(0);
  });

  it('believes a detective claim - and turns on the claimer the dead prove a liar', () => {
    let s = started(7);
    const [claimer, named, listener] = townOf(s);
    const talk: TalkLine[] = [{ round: 1, phase: 'day', from: claimer, target: named, kind: 'claim' }];
    expect(heatMap(s, listener, talk)[named]).toBeGreaterThanOrEqual(3);
    s = edit(s, (x) => {
      x.players[named].alive = false;
      x.revealed[named] = 'villager';
    });
    expect(heatMap(s, listener, talk)[claimer]).toBeGreaterThanOrEqual(4);
  });

  it('keeps the family\'s night talk from the town', () => {
    const s = started(9);
    const mafioso = byRole(s, 'mafia');
    const [target, listener] = townOf(s);
    const talk: TalkLine[] = [{ round: 1, phase: 'night', from: mafioso, target, kind: 'mention', family: true }];
    expect(heatMap(s, listener, talk)[target]).toBe(0);
  });
});

describe('the votes', () => {
  it('hangs whoever a believed detective named', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = atVote(started(seed));
      const [claimer, named, ...rest] = townOf(s);
      const talk: TalkLine[] = [{ round: 1, phase: 'day', from: claimer, target: named, kind: 'claim' }];
      const voter = rest.find((id) => id !== claimer)!;
      const a = mfBotDecide(s, voter, talk);
      expect(a, `seed ${seed}`).toEqual({ type: 'VOTE', playerId: voter, target: named });
    }
  });

  it('lets the detective hang what it found', () => {
    const s0 = started(11);
    const det = byRole(s0, 'detective');
    const gf = byRole(s0, 'mafia');
    const s = atVote(edit(s0, (x) => {
      x.secret!.checks[det] = [{ round: 1, target: gf, seen: 'mafia', guilty: true }];
    }));
    expect(mfBotDecide(s, det)).toEqual({ type: 'VOTE', playerId: det, target: gf });
  });

  it('never has the family vote its own while anyone else stands', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = atVote(started(seed));
      for (const id of s.seats.filter((x) => isFamily(s.secret!.roles[x]))) {
        const a = mfBotDecide(s, id);
        expect(a?.type).toBe('VOTE');
        expect(isFamily(s.secret!.roles[(a as { target: string }).target])).toBe(false);
      }
    }
  });
});

describe('the night', () => {
  it('has a family bot take the kill a human teammate named', () => {
    // p0 is human; find a seed that deals p0 into the family.
    for (let seed = 1; seed <= 200; seed++) {
      const s = started(seed, 8, {}, false);
      const sec = s.secret!;
      if (!isFamily(sec.roles.p0)) continue;
      const bot = s.seats.find((id) => id !== 'p0' && isFamily(sec.roles[id]))!;
      const withBots = edit(s, (x) => { for (const id of x.seats) if (id !== 'p0') x.players[id].isBot = true; });
      const target = townOf(s)[2];
      const talk: TalkLine[] = [{ round: 1, phase: 'night', from: 'p0', target, kind: 'mention', family: true }];
      const a = mfBotDecide(withBots, bot, talk);
      // The boss's own pick outranks a teammate's word; p0 hasn't moved.
      expect(a).toEqual({ type: 'NIGHT_MOVE', playerId: bot, kind: 'kill', target });
      expect(mfBotLine(withBots, bot, talk)?.k).toBe('plan');
      return;
    }
    throw new Error('no seed dealt p0 into the family');
  });
});

describe('the talk', () => {
  it('has a detective who found the family say so', () => {
    const s0 = started(13);
    const det = byRole(s0, 'detective');
    const gf = byRole(s0, 'godfather');
    const s = edit(s0, (x) => {
      x.phase = 'day';
      x.secret!.checks[det] = [{ round: 1, target: byRole(s0, 'mafia'), seen: 'mafia', guilty: true }];
    });
    const line = mfBotLine(s, det);
    expect(line?.k).toBe('claim');
    expect(line?.target).toBe(byRole(s0, 'mafia'));
    expect(line?.target).not.toBe(gf);
  });

  it('answers an accusation', () => {
    const s = edit(started(15), (x) => { x.phase = 'day'; });
    const [accused, accuser] = townOf(s);
    const talk: TalkLine[] = [{ round: 1, phase: 'day', from: accuser, target: accused, kind: 'accuse' }];
    const seen = new Set<string | undefined>();
    // A few different tables: the reply is usually a defence, and never
    // points straight back at the accuser.
    for (let seed = 15; seed < 25; seed++) {
      const t = edit(started(seed), (x) => { x.phase = 'day'; });
      const [acc, from] = townOf(t);
      const line = mfBotLine(t, acc, [{ ...talk[0], target: acc, from }]);
      if (line?.k === 'defend') expect(line.target).not.toBe(from);
      seen.add(line?.k);
    }
    expect(seen.has('defend')).toBe(true);
  });

  it('picks the names out of what a human says', () => {
    const s = started(17);
    expect(mentionsIn(s, 'p0', 'I think p3 is lying, and so is P4!')).toEqual(['p3', 'p4']);
    expect(mentionsIn(s, 'p0', 'p0 is me')).toEqual([]);
    expect(mentionsIn(s, 'p0', 'nobody here')).toEqual([]);
  });
});

describe('fuzz, with the talk', () => {
  it('plays 200 all-bot tables that argue, always legally, to an ending', () => {
    let town = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const n = 5 + (seed % 9);
      let s = createMafia(settings(seed * 7919, { roles: null, botLevel: (['easy', 'normal', 'hard'] as const)[seed % 3] }), seats(n));
      s = reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
      const talk: TalkLine[] = [];
      const spoken = new Set<string>();
      for (let step = 0; step < 3000 && s.phase !== 'game_over'; step++) {
        // Everyone who has something to say says it first, as the host does.
        for (const id of s.seats) {
          const key = `${s.round}|${s.phase}|${id}`;
          if (spoken.has(key) || (s.phase === 'vote' && !(id in s.votes))) continue;
          spoken.add(key);
          const line = mfBotLine(s, id, talk);
          const kind = line && talkKind(line);
          if (line && kind && line.target) {
            expect(s.players[line.target]?.alive).toBe(true);
            talk.push({ round: s.round, phase: s.phase as TalkLine['phase'], from: id, target: line.target, kind, family: s.phase === 'night' || undefined });
          }
        }
        const mover = s.seats.map((id) => mfBotDecide(s, id, talk)).find((a) => a);
        const r = reduce(s, mover ?? { type: 'ADVANCE', playerId: 'p0' });
        expect(r.state.version, `seed ${seed}: ${JSON.stringify(mover)} refused`).toBe(s.version + 1);
        s = r.state;
      }
      expect(s.phase, `seed ${seed}`).toBe('game_over');
      if (s.winner === 'village') town++;
    }
    // Random bots hand the family most tables; bots that read the room
    // should give the town a real share of them.
    expect(town).toBeGreaterThan(40);
  });
});
