import { describe, expect, it } from 'vitest';
import type { SeatSpec } from '../game/engine';
import { chatBlock, routeMafChat } from './chat';
import { MAF_DEFAULTS, createMafia, reduce, spendLastWords } from './engine';
import type { MafiaState, RoleCount } from './types';

const CAST: RoleCount[] = [
  { role: 'godfather', count: 1 }, { role: 'silencer', count: 1 }, { role: 'doctor', count: 1 },
  { role: 'detective', count: 1 }, { role: 'villager', count: 2 },
];

const seats: SeatSpec[] = ['Ann Lee', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'].map((name, i) => ({
  id: `p${i}`, name, token: 'camel' as const, color: '#fff', isBot: false,
}));

function night(): MafiaState {
  const s = createMafia({ ...MAF_DEFAULTS, seed: 3, roles: CAST }, seats);
  return reduce(s, { type: 'START_GAME', playerId: 'p0' }).state;
}
const byRole = (s: MafiaState, role: string) => s.seats.find((id) => s.secret!.roles[id] === role)!;
const day = (s: MafiaState) => reduce(s, { type: 'ADVANCE', playerId: 'p0' }).state;

describe('Omertà chat', () => {
  it('lets only the family talk at night, and only the family hear', () => {
    const s = night();
    const god = byRole(s, 'godfather');
    const doc = byRole(s, 'doctor');
    expect(chatBlock(s, doc)).toBe('night');
    expect(routeMafChat(s, doc, 'hello')).toBeNull();
    const r = routeMafChat(s, god, 'the doctor')!;
    expect(r.channel).toBe('family');
    expect(r.to!.sort()).toEqual([god, byRole(s, 'silencer')].sort());
  });

  it('keeps the silenced quiet through the talk', () => {
    let s = night();
    const sil = byRole(s, 'silencer');
    const doc = byRole(s, 'doctor');
    s = reduce(s, { type: 'NIGHT_MOVE', playerId: sil, kind: 'silence', target: doc }).state;
    s = day(s);
    expect(chatBlock(s, doc)).toBe('silenced');
    expect(routeMafChat(s, doc, 'but')).toBeNull();
    expect(routeMafChat(s, byRole(s, 'detective'), 'hm')?.to).toBeNull();
  });

  it('whispers to one player by their handle', () => {
    const s = day(night());
    const r = routeMafChat(s, 'p1', '@AnnLee meet me later')!;
    expect(r.channel).toBe('whisper');
    expect(r.to).toEqual(['p1', 'p0']);
    expect(r.text).toBe('meet me later');
    expect(routeMafChat(s, 'p1', '@Nobody hi')?.channel).toBeNull();
  });

  it('gives the dead exactly one last word', () => {
    let s = day(night());
    s = { ...s, players: { ...s.players, p5: { ...s.players.p5, alive: false } } };
    const r = routeMafChat(s, 'p5', 'it was Bo')!;
    expect(r.lastWords).toBe(true);
    expect(r.to).toBeNull();
    s = spendLastWords(s, 'p5');
    // After it, the dead talk among themselves - and only they hear it.
    s = { ...s, players: { ...s.players, p4: { ...s.players.p4, alive: false } } };
    expect(chatBlock(s, 'p5')).toBeNull();
    const ghost = routeMafChat(s, 'p5', 'it really was Bo')!;
    expect(ghost.channel).toBe('dead');
    expect(ghost.lastWords).toBe(false);
    expect(ghost.to!.sort()).toEqual(['p4', 'p5']);
  });

  it("keeps the dead's talk from the living, and from watchers", () => {
    let s = day(night());
    s = { ...s, players: { ...s.players, p5: { ...s.players.p5, alive: false } } };
    s = spendLastWords(s, 'p5');
    const r = routeMafChat(s, 'p5', 'psst')!;
    expect(r.to).toEqual(['p5']);
    expect(r.to).not.toContain('p0');
  });
});
