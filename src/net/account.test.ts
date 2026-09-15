import { describe, expect, it } from 'vitest';
import fixture from './account.fixture.json';
import { isAccountId, verifyPass, type PassClaims } from './account';
import { HostNet } from './net';
import { wrap, type Up } from './protocol';
import { createGame, handOverSeat, reduce } from '../game/engine';
import { CLASSIC } from '../game/settings';
import { CF_DEFAULTS, createCashflow, handOverSeat as cfHandOverSeat, reduce as cfReduce } from '../cashflow/engine';
import type { GameAction } from '../game/types';

/* ------------------------------------------------------------------ *
 * Accounts. The pass checked here was signed by ops/accounts.py itself
 * (`python ops/test_accounts.py --fixture`), so this proves the browser
 * and the server agree on the format - not a re-creation of it.
 * ------------------------------------------------------------------ */

const at = fixture.mintedAt + 60;

describe('passes', () => {
  it('accepts a pass the server signed', async () => {
    const claims = await verifyPass(fixture.pass, fixture.jwk, at);
    expect(claims).toEqual({ sub: 'u_fixture0000000000000', name: 'Fixture', exp: expect.any(Number) });
  });

  it('refuses it under any other key', async () => {
    expect(await verifyPass(fixture.pass, fixture.otherJwk, at)).toBeNull();
  });

  it('refuses it once expired', async () => {
    expect(await verifyPass(fixture.pass, fixture.jwk, fixture.mintedAt + 31 * 24 * 3600)).toBeNull();
  });

  it('refuses a pass whose player id was changed', async () => {
    const [head, body, sig] = fixture.pass.split('.');
    const claims = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    claims.sub = 'u_somebodyelse00000000';
    const forged = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifyPass(`${head}.${forged}.${sig}`, fixture.jwk, at)).toBeNull();
  });

  it('refuses alg:none, garbage, and things that are not strings', async () => {
    const [, body] = fixture.pass.split('.');
    const none = btoa(JSON.stringify({ alg: 'none' })).replace(/=+$/, '');
    for (const bad of [`${none}.${body}.`, 'a.b.c', '', 42, null, { pass: fixture.pass }, 'x'.repeat(5000)]) {
      expect(await verifyPass(bad, fixture.jwk, at)).toBeNull();
    }
  });

  it('only calls u_ ids account ids', () => {
    expect(isAccountId('u_abc')).toBe(true);
    expect(isAccountId('p_abc')).toBe(false);
    expect(isAccountId('bot_abc')).toBe(false);
  });
});

/* --------------------------- the host's door --------------------------- */

class FakeConn {
  open = true;
  sent: { t: string; reason?: string }[] = [];
  private handlers: Record<string, ((x: unknown) => void)[]> = {};
  on(ev: string, fn: (x: unknown) => void) { (this.handlers[ev] ??= []).push(fn); }
  emit(ev: string, x?: unknown) { this.handlers[ev]?.forEach((f) => f(x)); }
  send(m: unknown) { this.sent.push((m as { body: { t: string; reason?: string } }).body); }
  close() { this.open = false; }
}

const attachTo = (host: HostNet, conn: FakeConn) =>
  (host as unknown as { attach: (c: FakeConn) => void }).attach(conn);

/** Passes are "pass:<uid>"; anything else fails. Keeps these tests about the
 *  door, not about cryptography, which is tested above. */
const fakeVerify = async (pass: unknown): Promise<PassClaims | null> =>
  (typeof pass === 'string' && pass.startsWith('pass:') ? { sub: pass.slice(5), name: 'X', exp: 9e9 } : null);

const settle = () => new Promise((r) => setTimeout(r, 0));

function makeHost(seatFor: (uid: string) => string = (uid) => uid) {
  const ups: { from: string; msg: Up }[] = [];
  const host = new HostNet('ROOM', {
    onUp: (from, msg) => ups.push({ from, msg }),
    onPresence: () => {},
    onStatus: () => {},
    seatFor,
  }, { verify: fakeVerify });
  return { host, ups };
}

const hello = (playerId: string, extra: Partial<Extract<Up, { t: 'HELLO' }>> = {}): Up =>
  ({ t: 'HELLO', playerId, name: 'n', token: 'topper', secret: 's', ...extra });

describe('the host, with passes', () => {
  it('binds a signed-in player to the seat their account plays, whatever id they send', async () => {
    const { host, ups } = makeHost((uid) => (uid === 'u_asil' ? 'bot_ada' : uid));
    host.reserve('bot_ada');
    host.setOwner('bot_ada', 'u_asil');
    const c = new FakeConn();
    attachTo(host, c);
    c.emit('data', wrap(hello('whatever', { auth: 'pass:u_asil' })));
    await settle();
    expect(ups).toHaveLength(1);
    expect(ups[0].from).toBe('bot_ada');
    expect(ups[0].msg).toMatchObject({ t: 'HELLO', playerId: 'bot_ada', verified: 'u_asil' });
    expect(host.accountOf('bot_ada')).toBe('u_asil');
  });

  it('never believes a "verified" field a peer sent', () => {
    const { host, ups } = makeHost();
    const c = new FakeConn();
    attachTo(host, c);
    c.emit('data', wrap(hello('p_guest', { verified: 'u_victim' })));
    expect(ups).toHaveLength(1);
    expect((ups[0].msg as { verified?: string }).verified).toBeUndefined();
    expect(host.accountOf('p_guest')).toBeUndefined();
  });

  it('refuses an account id claimed without a pass', () => {
    const { host, ups } = makeHost();
    const c = new FakeConn();
    attachTo(host, c);
    c.emit('data', wrap(hello('u_victim')));
    expect(c.sent.some((m) => m.t === 'BYE' && m.reason === 'auth_invalid')).toBe(true);
    expect(c.open).toBe(false);
    expect(ups).toHaveLength(0);
  });

  it('refuses a pass that does not check out', async () => {
    const { host, ups } = makeHost();
    const c = new FakeConn();
    attachTo(host, c);
    c.emit('data', wrap(hello('u_victim', { auth: 'forged' })));
    await settle();
    expect(c.sent.some((m) => m.reason === 'auth_invalid')).toBe(true);
    expect(ups).toHaveLength(0);
  });

  it('moves the seat to a second device, and tells the first why', async () => {
    const { host } = makeHost();
    const phone = new FakeConn();
    attachTo(host, phone);
    phone.emit('data', wrap(hello('u_asil', { auth: 'pass:u_asil' })));
    await settle();
    const laptop = new FakeConn();
    attachTo(host, laptop);
    laptop.emit('data', wrap(hello('u_asil', { auth: 'pass:u_asil' })));
    await settle();
    expect(phone.sent.some((m) => m.reason === 'elsewhere')).toBe(true);
    expect(phone.open).toBe(false);
    host.send('u_asil', { t: 'PING', seq: 9 });
    expect(laptop.sent.some((m) => m.t === 'PING')).toBe(true);
  });

  it('keeps the host seat and unowned bots out of reach, pass or no pass', async () => {
    const { host, ups } = makeHost((uid) => (uid === 'u_hostacct' ? 'u_hostacct' : 'bot_ada'));
    host.reserve('u_hostacct');
    host.reserve('bot_ada');
    for (const uid of ['u_hostacct', 'u_stranger']) {
      const c = new FakeConn();
      attachTo(host, c);
      c.emit('data', wrap(hello(uid, { auth: `pass:${uid}` })));
      await settle();
      expect(c.sent.some((m) => m.reason === 'seat_taken'), uid).toBe(true);
    }
    expect(ups).toHaveLength(0);
  });

  it('moves a watcher onto the seat they took', async () => {
    const { host } = makeHost();
    const c = new FakeConn();
    attachTo(host, c);
    c.emit('data', wrap(hello('u_asil', { auth: 'pass:u_asil' })));
    await settle();
    host.rebind('u_asil', 'bot_ada');
    host.send('bot_ada', { t: 'PING', seq: 1 });
    expect(c.sent.some((m) => m.t === 'PING')).toBe(true);
    expect(host.accountOf('bot_ada')).toBe('u_asil');
    expect(host.accountOf('u_asil')).toBeUndefined();
  });
});

/* ------------------------ the seat changing hands ------------------------ */

const seats = [
  { id: 'p0', name: 'Host', token: 'topper' as const, color: '#fff', isBot: false },
  { id: 'bot_ada', name: 'Ada', token: 'boot' as const, color: '#fff', isBot: true },
];

describe('taking over a bot', () => {
  it('hands a signed-in player the bot and everything it holds (Monopoly)', () => {
    const s = reduce(createGame({ ...CLASSIC, seed: 3 }, seats), { type: 'START_GAME', playerId: 'p0' }).state;
    s.players.bot_ada.cash = 777;
    s.properties[39].owner = 'bot_ada';
    const { state, events } = handOverSeat(s, 'bot_ada', 'Asil');
    expect(state.players.bot_ada).toMatchObject({ isBot: false, name: 'Asil', cash: 777 });
    expect(state.properties[39].owner).toBe('bot_ada');
    expect(events).toEqual([{ type: 'SEAT_TAKEN', playerId: 'bot_ada', name: 'Asil', previous: 'Ada' }]);
    expect(state.version).toBe(s.version + 1);
    // The original is untouched.
    expect(s.players.bot_ada.isBot).toBe(true);
  });

  it('will not take a human seat, a bankrupt bot, or a finished game', () => {
    const s = reduce(createGame({ ...CLASSIC, seed: 3 }, seats), { type: 'START_GAME', playerId: 'p0' }).state;
    expect(handOverSeat(s, 'p0', 'Asil').state).toBe(s);
    expect(handOverSeat(s, 'nobody', 'Asil').state).toBe(s);
    const broke = { ...s, players: { ...s.players, bot_ada: { ...s.players.bot_ada, bankrupt: true } } };
    expect(handOverSeat(broke, 'bot_ada', 'Asil').state).toBe(broke);
    expect(handOverSeat({ ...s, phase: 'game_over' }, 'bot_ada', 'Asil').events).toEqual([]);
  });

  it('cannot be asked for through the reducer', () => {
    const s = reduce(createGame({ ...CLASSIC, seed: 3 }, seats), { type: 'START_GAME', playerId: 'p0' }).state;
    const sneaky = { type: 'SEAT_TAKEN', playerId: 'bot_ada', name: 'Asil' } as unknown as GameAction;
    expect(reduce(s, sneaky).state).toBe(s);
  });

  it('works the same way in Cashflow', () => {
    const cf = cfReduce(createCashflow({ ...CF_DEFAULTS, seed: 9 }, seats), { type: 'START_GAME', playerId: 'p0' }).state;
    const { state, events } = cfHandOverSeat(cf, 'bot_ada', 'Asil');
    expect(state.players.bot_ada).toMatchObject({ isBot: false, name: 'Asil' });
    expect(state.players.bot_ada.profession).toBe(cf.players.bot_ada.profession);
    expect(events[0]).toMatchObject({ type: 'SEAT_TAKEN', previous: 'Ada' });
    expect(cfHandOverSeat(cf, 'p0', 'Asil').state).toBe(cf);
  });
});
