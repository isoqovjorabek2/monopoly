import { describe, expect, it } from 'vitest';
import { HostNet } from './net';
import { redactForGuests, wrap, type RoomSnapshot, type Up } from './protocol';
import { createGame, reduce } from '../game/engine';
import { CLASSIC } from '../game/settings';

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
});

describe('snapshots sent to guests', () => {
  it('carry no seed and no undrawn decks', () => {
    const game = reduce(
      createGame({ ...CLASSIC, seed: 424242 }, [
        { id: 'p0', name: 'p0', token: 'topper', color: '#fff', isBot: false },
        { id: 'p1', name: 'p1', token: 'boot', color: '#fff', isBot: false },
      ]),
      { type: 'START_GAME', playerId: 'p0' },
    ).state;
    const snapshot: RoomSnapshot = {
      roomId: 'ROOM', hostId: 'p0',
      seats: [], settings: game.settings, game, rev: 3,
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
});
