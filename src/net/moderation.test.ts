import { describe, expect, it } from 'vitest';
import type { RoomSnapshot, SeatInfo } from './protocol';
import {
  OWNER_GRACE_MS, canKick, elected, eligibleVoters, isCoowner, ownerOf, tally, voteOpen,
} from './moderation';

/* The table's moderation rules: who may remove whom, and how an absent
 * owner's table elects a co-owner. */

const seat = (id: string, over: Partial<SeatInfo> = {}): SeatInfo => ({
  playerId: id,
  name: id,
  token: 'topper',
  color: '#fff',
  isBot: false,
  botLevel: 'normal',
  isHost: false,
  connected: true,
  ping: 0,
  ...over,
});

const room = (over: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  roomId: 'TEST-ROOM-1',
  hostId: 'p0',
  ownerId: 'p0',
  kind: 'monopoly',
  seats: [seat('p0', { isHost: true }), seat('p1'), seat('p2'), seat('bot_1', { isBot: true })],
  settings: {} as RoomSnapshot['settings'],
  cfRules: {} as RoomSnapshot['cfRules'],
  game: null,
  cf: null,
  epoch: 0,
  rev: 0,
  ...over,
});

describe('removing a player', () => {
  it('lets the owner remove any human but themselves', () => {
    const r = room();
    expect(canKick(r, 'p0', r.seats[1])).toBe(true);
    expect(canKick(r, 'p0', r.seats[0])).toBe(false);
  });

  it('never lets a bot seat be removed this way', () => {
    const r = room();
    expect(canKick(r, 'p0', r.seats[3])).toBe(false);
  });

  it('lets a co-owner remove plain players, but not the owner or another co-owner', () => {
    const r = room({ coowners: ['p1', 'p2'] });
    expect(isCoowner(r, 'p1')).toBe(true);
    expect(canKick(r, 'p1', room({}).seats[0])).toBe(false); // the owner
    expect(canKick(r, 'p1', r.seats[2])).toBe(false);        // fellow co-owner
    const r2 = room({ coowners: ['p1'] });
    expect(canKick(r2, 'p1', r2.seats[2])).toBe(true);       // plain player
  });

  it('lets nobody else remove anyone', () => {
    const r = room();
    expect(canKick(r, 'p1', r.seats[2])).toBe(false);
    expect(canKick(r, 'p1', undefined)).toBe(false);
  });

  it('treats rooms saved before owners existed as host-owned', () => {
    const r = room();
    delete r.ownerId;
    expect(ownerOf(r)).toBe('p0');
  });
});

describe('electing a co-owner', () => {
  const away = (over: Partial<RoomSnapshot> = {}): RoomSnapshot => room({
    ownerAwayAt: 1_000_000,
    seats: [
      seat('p0', { isHost: true, connected: false }),
      seat('p1'), seat('p2'), seat('bot_1', { isBot: true }),
    ],
    ...over,
  });

  it('opens only after the owner has been gone a while', () => {
    const r = away();
    expect(voteOpen(r, 1_000_000 + OWNER_GRACE_MS - 1)).toBe(false);
    expect(voteOpen(r, 1_000_000 + OWNER_GRACE_MS)).toBe(true);
    expect(voteOpen(room(), 1_000_000 + OWNER_GRACE_MS * 2)).toBe(false);
  });

  it('counts votes only from connected humans, bots and the absent owner excluded', () => {
    const r = away();
    expect(eligibleVoters(r)).toEqual(['p1', 'p2']);
  });

  it('ignores endorsements from voters or for candidates no longer eligible', () => {
    const r = away({
      coownerVotes: { p0: 'p1', bot_1: 'p1', p1: 'p2' },
      seats: [seat('p0', { connected: false }), seat('p1'), seat('p2'), seat('bot_1', { isBot: true })],
    });
    expect(tally(r)).toEqual({ p2: 1 });
  });

  it('seats a candidate only on a strict majority', () => {
    const three = away({ seats: [seat('p0', { connected: false }), seat('p1'), seat('p2'), seat('p3')] });
    expect(elected({ ...three, coownerVotes: { p1: 'p2' } })).toBeNull();       // 1 of 3
    expect(elected({ ...three, coownerVotes: { p1: 'p2', p3: 'p2' } })).toBe('p2'); // 2 of 3

    const four = away({
      seats: [seat('p0', { connected: false }), seat('p1'), seat('p2'), seat('p3'), seat('p4')],
    });
    expect(elected({ ...four, coownerVotes: { p1: 'p2', p3: 'p2' } })).toBeNull(); // 2 of 4
    expect(elected({ ...four, coownerVotes: { p1: 'p2', p3: 'p2', p4: 'p2' } })).toBe('p2');
  });

  it('lets the last player at the table carry the vote alone', () => {
    const r = away({ seats: [seat('p0', { connected: false }), seat('p1')] });
    expect(elected({ ...r, coownerVotes: { p1: 'p1' } })).toBe('p1');
  });
});
