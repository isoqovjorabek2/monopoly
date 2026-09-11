import { describe, expect, it } from 'vitest';
import { HostNet } from './net';
import { redactForGuests, wrap, type RoomSnapshot, type Up } from './protocol';
import { createGame, reduce } from '../game/engine';
import { CLASSIC } from '../game/settings';
import { CF_DEFAULTS, createCashflow, reduce as cfReduce } from '../cashflow/engine';

/** A stand-in for a PeerJS DataConnection, enough to drive HostNet. */
class FakeConn {
  open = true;
  sent: { t: string; snapshot?: RoomSnapshot }[] = [];
  private handlers: Record<string, ((x: unknown) => void)[]> = {};
  on(ev: string, fn: (x: unknown) => void) { (this.handlers[ev] ??= []).push(fn); }
  emit(ev: string, x?: unknown) { this.handlers[ev]?.forEach((f) => f(x)); }
  // The host sends every message wrapped in an envelope; unwrap so tests can
  // read the message type directly.
  send(m: unknown) { this.sent.push((m as { body: { t: string } }).body); }
  close() { this.open = false; }
}

const hello = (playerId: string, secret: string): Up =>
  ({ t: 'HELLO', playerId, name: playerId, token: 'topper', secret });

const attachTo = (host: HostNet, conn: FakeConn) =>
  (host as unknown as { attach: (c: FakeConn) => void }).attach(conn);

const seats = [
  { id: 'p0', name: 'p0', token: 'topper' as const, color: '#fff', isBot: false },
  { id: 'p1', name: 'p1', token: 'boot' as const, color: '#fff', isBot: false },
];

describe('seat security', () => {
  it('turns away a second connection that claims a seat with the wrong secret', () => {
    const seen: string[] = [];
    const host = new HostNet('ROOM', { onUp: (from) => seen.push(from), onPresence: () => {}, onStatus: () => {} });

    const owner = new FakeConn();
    attachTo(host, owner);
    owner.emit('data', wrap(hello('p_victim', 'secret-owner')));

    const thief = new FakeConn();
    attachTo(host, thief);
    thief.emit('data', wrap(hello('p_victim', 'guessed-id-no-secret')));

    // The thief is kicked, and a message the host sends to the seat still
    // reaches the real owner, not the thief.
    expect(thief.sent.some((m) => m.t === 'BYE')).toBe(true);
    expect(thief.open).toBe(false);
    host.send('p_victim', { t: 'PING', seq: 1 });
    expect(owner.sent.some((m) => m.t === 'PING')).toBe(true);
    expect(thief.sent.some((m) => m.t === 'PING')).toBe(false);
    // Only the owner's HELLO was ever accepted as input.
    expect(seen).toEqual(['p_victim']);
  });

  it('lets the real owner reconnect with the right secret', () => {
    const host = new HostNet('ROOM', { onUp: () => {}, onPresence: () => {}, onStatus: () => {} });
    const first = new FakeConn();
    attachTo(host, first);
    first.emit('data', wrap(hello('p_a', 'mine')));
    first.emit('close');                      // dropped
    const again = new FakeConn();
    attachTo(host, again);
    again.emit('data', wrap(hello('p_a', 'mine')));
    host.send('p_a', { t: 'PING', seq: 2 });
    expect(again.sent.some((m) => m.t === 'PING')).toBe(true);
  });

  it('never lets anyone connect as the host or as a bot', () => {
    // Neither seat ever says HELLO, so there is no secret on file for either;
    // before reserve() the first connection to claim one simply got it, and
    // every INTENT it sent after was applied as the host or as the bot.
    const seen: string[] = [];
    const host = new HostNet('ROOM', { onUp: (from) => seen.push(from), onPresence: () => {}, onStatus: () => {} });
    host.reserve('p_host');
    host.reserve('bot_abc');
    for (const id of ['p_host', 'bot_abc']) {
      const c = new FakeConn();
      attachTo(host, c);
      c.emit('data', wrap(hello(id, 'anything')));
      c.emit('data', wrap({ t: 'INTENT', playerId: id, action: { type: 'ROLL', playerId: id } }));
      expect(c.sent.some((m) => m.t === 'BYE'), id).toBe(true);
      expect(c.open, id).toBe(false);
    }
    expect(seen).toEqual([]);
  });
});

describe('snapshots sent to guests', () => {
  it('carry no seed and no undrawn decks (Monopoly)', () => {
    const game = reduce(createGame({ ...CLASSIC, seed: 424242 }, seats), { type: 'START_GAME', playerId: 'p0' }).state;
    const snapshot: RoomSnapshot = {
      roomId: 'ROOM', hostId: 'p0', kind: 'monopoly', seats: [],
      settings: game.settings, cfRules: { strictLoans: true, turnLimit: 0, fastGoal: 50000 },
      game, cf: null, rev: 3,
    };

    const redacted = redactForGuests(snapshot);
    expect(redacted.game!.settings.seed).toBe(0);
    expect(redacted.game!.chanceOrder).toEqual([]);
    expect(redacted.game!.chestOrder).toEqual([]);
    // The real snapshot is untouched, so the host still holds the full game.
    expect(snapshot.game!.settings.seed).toBe(424242);
    expect(snapshot.game!.chanceOrder.length).toBeGreaterThan(0);
    // Everything a guest needs to render is still there.
    expect(Object.keys(redacted.game!.players)).toEqual(['p0', 'p1']);
    expect(redacted.game!.phase).toBe(game.phase);
  });

  it('carry no seed and no undrawn decks (Cashflow)', () => {
    const cf = cfReduce(createCashflow({ ...CF_DEFAULTS, seed: 515151 }, seats), { type: 'START_GAME', playerId: 'p0' }).state;
    const snapshot: RoomSnapshot = {
      roomId: 'ROOM', hostId: 'p0', kind: 'cashflow', seats: [],
      settings: { ...CLASSIC, seed: 515151 }, cfRules: { strictLoans: true, turnLimit: 0, fastGoal: 50000 },
      game: null, cf, rev: 3,
    };
    const redacted = redactForGuests(snapshot);
    expect(redacted.settings.seed).toBe(0);
    expect(redacted.cf!.settings.seed).toBe(0);
    for (const deck of Object.values(redacted.cf!.decks)) expect(deck).toEqual([]);
    expect(snapshot.cf!.decks.small.length).toBeGreaterThan(0);
    expect(redacted.cf!.players.p0.profession).toBe(cf.players.p0.profession);
  });
});
