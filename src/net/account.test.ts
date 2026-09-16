import { describe, expect, it } from 'vitest';
import fixture from './account.fixture.json';
import { isAccountId, verifyPass, type PassClaims } from './account';
import { HostNet } from './net';
import { proofMessage, type PublicPoint } from './deviceKey';
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
  it('accepts a pass the server signed, with the browser key it names', async () => {
    const claims = await verifyPass(fixture.pass, fixture.jwk, at);
    expect(claims).toEqual({
      sub: 'u_fixture0000000000000', name: 'Fixture', exp: expect.any(Number), plus: 0, cnf: fixture.point,
    });
  });

  it('reads the Plus paid-until date the server stamped into a pass', async () => {
    const claims = await verifyPass(fixture.plusPass, fixture.jwk, at);
    expect(claims?.plus).toBe(fixture.plusUntil);
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

/* Every account in these tests holds a real browser key, and a pass is
 * "pass:<uid>". The pass check is faked - it is tested above - but the
 * challenge each browser has to answer is real ECDSA. */
const keys = new Map<string, { pair: CryptoKeyPair; point: PublicPoint }>();
async function keyFor(uid: string) {
  let k = keys.get(uid);
  if (!k) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    k = { pair, point: { x: jwk.x!, y: jwk.y! } };
    keys.set(uid, k);
  }
  return k;
}
const fakeVerify = async (pass: unknown): Promise<PassClaims | null> => {
  if (typeof pass !== 'string' || !pass.startsWith('pass:')) return null;
  const uid = pass.slice(5);
  return { sub: uid, name: 'X', exp: 9e9, plus: uid.startsWith('u_plus') ? 9e9 : 0, cnf: (await keyFor(uid)).point };
};

const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const b64u = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Answer the host's challenge as `signer`'s browser would, for `room`. */
async function answer(conn: FakeConn, signer: string, room = 'ROOM', epoch = 0) {
  for (let i = 0; i < 50 && !conn.sent.some((m) => m.t === 'CHALLENGE'); i++) await settle(5);
  const ch = conn.sent.find((m) => m.t === 'CHALLENGE') as { nonce?: string } | undefined;
  if (!ch?.nonce) throw new Error('no challenge');
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, (await keyFor(signer)).pair.privateKey,
    new TextEncoder().encode(proofMessage(room, epoch, ch.nonce)),
  );
  conn.emit('data', wrap({ t: 'PROOF', playerId: 'x', sig: b64u(sig) }));
  for (let i = 0; i < 20; i++) await settle(5);
}

/** Show a pass for `uid` and answer the challenge with its own key. */
async function signInOn(conn: FakeConn, uid: string, playerId = uid) {
  conn.emit('data', wrap(hello(playerId, { auth: `pass:${uid}` })));
  await answer(conn, uid);
}

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
  ({ t: 'HELLO', playerId, name: 'n', token: 'camel', secret: 's', ...extra });

describe('the host, with passes', () => {
  it('passes on the Plus date of a verified pass, and never one a peer claims', async () => {
    const { host, ups } = makeHost();
    const member = new FakeConn();
    attachTo(host, member);
    await signInOn(member, 'u_plus_player');
    const bound = ups.find((u) => u.from === 'u_plus_player')?.msg as Extract<Up, { t: 'HELLO' }> | undefined;
    expect(bound?.verifiedPlus).toBe(9e9);
    const liar = new FakeConn();
    attachTo(host, liar);
    liar.emit('data', wrap(hello('p_liar', { verifiedPlus: 9e9 })));
    const unverified = ups.find((u) => u.from === 'p_liar')?.msg as Extract<Up, { t: 'HELLO' }> | undefined;
    expect(unverified).toBeDefined();
    expect(unverified?.verifiedPlus).toBeUndefined();
  });

  it('binds a signed-in player to the seat their account plays, whatever id they send', async () => {
    const { host, ups } = makeHost((uid) => (uid === 'u_asil' ? 'bot_ada' : uid));
    host.reserve('bot_ada');
    host.setOwner('bot_ada', 'u_asil');
    const c = new FakeConn();
    attachTo(host, c);
    await signInOn(c, 'u_asil', 'whatever');
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

  it('binds nothing on a valid pass until the browser proves it holds the key', async () => {
    const { host, ups } = makeHost();
    const c = new FakeConn();
    attachTo(host, c);
    c.emit('data', wrap(hello('u_asil', { auth: 'pass:u_asil' })));
    await settle(20);
    expect(c.sent.some((m) => m.t === 'CHALLENGE')).toBe(true);
    expect(ups).toHaveLength(0);
    expect(host.accountOf('u_asil')).toBeUndefined();
  });

  it('refuses a copied pass: the thief cannot sign for the key it names', async () => {
    const { host, ups } = makeHost();
    const thief = new FakeConn();
    attachTo(host, thief);
    thief.emit('data', wrap(hello('u_victim', { auth: 'pass:u_victim' })));
    await answer(thief, 'u_thief');
    expect(thief.sent.some((m) => m.reason === 'auth_invalid')).toBe(true);
    expect(thief.open).toBe(false);
    expect(ups).toHaveLength(0);
  });

  it('refuses a proof made for another table', async () => {
    const { host, ups } = makeHost();
    const c = new FakeConn();
    attachTo(host, c);
    c.emit('data', wrap(hello('u_asil', { auth: 'pass:u_asil' })));
    await answer(c, 'u_asil', 'SOME-OTHER-ROOM');
    expect(c.sent.some((m) => m.reason === 'auth_invalid')).toBe(true);
    expect(ups).toHaveLength(0);
  });

  it('refuses a proof made for an earlier host of this table', async () => {
    const { host, ups } = makeHost();
    const c = new FakeConn();
    attachTo(host, c);
    c.emit('data', wrap(hello('u_asil', { auth: 'pass:u_asil' })));
    await answer(c, 'u_asil', 'ROOM', 3);
    expect(c.sent.some((m) => m.reason === 'auth_invalid')).toBe(true);
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
    await signInOn(phone, 'u_asil');
    const laptop = new FakeConn();
    attachTo(host, laptop);
    await signInOn(laptop, 'u_asil');
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
      await signInOn(c, uid);
      expect(c.sent.some((m) => m.reason === 'seat_taken'), uid).toBe(true);
    }
    expect(ups).toHaveLength(0);
  });

  it('moves a watcher onto the seat they took', async () => {
    const { host } = makeHost();
    const c = new FakeConn();
    attachTo(host, c);
    await signInOn(c, 'u_asil');
    host.rebind('u_asil', 'bot_ada');
    host.send('bot_ada', { t: 'PING', seq: 1 });
    expect(c.sent.some((m) => m.t === 'PING')).toBe(true);
    expect(host.accountOf('bot_ada')).toBe('u_asil');
    expect(host.accountOf('u_asil')).toBeUndefined();
  });
});

/* ------------------------ the seat changing hands ------------------------ */

const seats = [
  { id: 'p0', name: 'Host', token: 'camel' as const, color: '#fff', isBot: false },
  { id: 'bot_ada', name: 'Ada', token: 'lamp' as const, color: '#fff', isBot: true },
];

describe('taking over a bot', () => {
  it('hands a signed-in player the bot and everything it holds (Bazaar Barons)', () => {
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
