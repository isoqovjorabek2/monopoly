import { create } from 'zustand';
import { ACCOUNT_KEY } from './accountKey';

/* ------------------------------------------------------------------ *
 * Player accounts.
 *
 * Signing in gets this browser a *pass* from aytingchi.uz: a statement,
 * signed with a key only that server holds, that it belongs to player
 * u_xxxx. The public half of the key is compiled in below, so any browser
 * at the table - in practice the host's - checks a pass itself, offline.
 * There is no request to a server on the way into a room, which is what
 * keeps the game playable on a static host.
 *
 * A pass is what lets a player back into their seat from any tab or device,
 * and into a bot's seat in a game that has already started. Everything
 * else about the game is unchanged, and a guest without one plays exactly
 * as before.
 * ------------------------------------------------------------------ */

export const AUTH_BASE = (import.meta.env.VITE_AUTH_URL ?? 'https://aytingchi.uz/auth').replace(/\/$/, '');
const ISSUER = 'https://aytingchi.uz/auth';
const AUDIENCE = 'monopoly';
const STORE_KEY = 'mply.account';
/** Where a redirect-based sign-in remembers what the address bar said. */
const RETURN_HASH_KEY = 'mply.authReturn';

export interface Account {
  /** The player id this account plays as. Opaque; always starts with u_. */
  uid: string;
  /** The Google account's name, trimmed to what a table allows. */
  name: string;
  /** The pass itself, presented to a host on every connect. */
  pass: string;
  /** Seconds since the epoch. */
  exp: number;
  /** Who is signed in, for this player's own screen only: full name,
   *  address and picture. Unsigned and never sent to anyone - hosts see the
   *  pass, and the pass does not carry it. */
  profile?: AccountProfile;
}

export interface AccountProfile {
  name: string;
  email: string;
  picture: string;
}

/** The profile blob from the fragment, kept only if it is plainly shaped. */
function readProfile(raw: string | undefined): AccountProfile | undefined {
  if (!raw) return undefined;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64uBytes(raw))) as Partial<AccountProfile>;
    const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
    const picture = str(p.picture, 400);
    return {
      name: str(p.name, 60),
      email: str(p.email, 120),
      picture: /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(picture) ? picture : '',
    };
  } catch {
    return undefined;
  }
}

export interface PassClaims {
  sub: string;
  name: string;
  exp: number;
}

/** Account ids are u_ ids. Nothing else is, so a guest id can never be
 *  mistaken for one - and claiming one without a pass is refused. */
export const isAccountId = (id: string): boolean => typeof id === 'string' && id.startsWith('u_');

/* --------------------------- verification -------------------------- */

const b64uBytes = (text: string): Uint8Array<ArrayBuffer> => {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const importCache = new Map<string, Promise<CryptoKey>>();
const importKey = (jwk: JsonWebKey): Promise<CryptoKey> => {
  const id = `${jwk.x}.${jwk.y}`;
  let p = importCache.get(id);
  if (!p) {
    p = crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    importCache.set(id, p);
  }
  return p;
};

/**
 * Check a pass. Never throws; anything that is not a valid, unexpired pass
 * for this game comes back null. `jwk` and `now` are parameters for the
 * tests - the game always uses the compiled-in key and the real clock.
 */
export async function verifyPass(
  pass: unknown,
  jwk: JsonWebKey = ACCOUNT_KEY,
  now: number = Date.now() / 1000,
): Promise<PassClaims | null> {
  try {
    if (typeof pass !== 'string' || pass.length > 2048) return null;
    const parts = pass.split('.');
    if (parts.length !== 3) return null;
    const [head, body, sig] = parts;
    const header = JSON.parse(new TextDecoder().decode(b64uBytes(head))) as { alg?: string };
    if (header.alg !== 'ES256') return null;
    const signature = b64uBytes(sig);
    if (signature.length !== 64) return null;
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await importKey(jwk),
      signature,
      new TextEncoder().encode(`${head}.${body}`),
    );
    if (!ok) return null;
    const c = JSON.parse(new TextDecoder().decode(b64uBytes(body))) as Record<string, unknown>;
    if (c.iss !== ISSUER || c.aud !== AUDIENCE) return null;
    if (typeof c.exp !== 'number' || c.exp <= now) return null;
    if (typeof c.sub !== 'string' || !isAccountId(c.sub) || c.sub.length > 40) return null;
    const name = typeof c.name === 'string' ? c.name.slice(0, 18) : '';
    return { sub: c.sub, name, exp: c.exp };
  } catch {
    return null;
  }
}

/* ------------------------------ storage ----------------------------- */

function readStored(): Account | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Account;
    if (!a || !isAccountId(a.uid) || typeof a.pass !== 'string') return null;
    // Expired passes are dropped here; a forged one would be refused by
    // every host, so there is nothing to gain checking the signature twice.
    if (typeof a.exp !== 'number' || a.exp <= Date.now() / 1000) return null;
    return a;
  } catch {
    return null;
  }
}

interface AccountStore {
  account: Account | null;
  /** Set while a sign-in popup is open, so the button can say so. */
  pending: boolean;
  /** Why the last sign-in did not finish, if it did not. */
  error: 'cancelled' | 'failed' | 'unavailable' | 'invalid' | 'popup' | null;
}

export const useAccount = create<AccountStore>(() => ({
  account: readStored(),
  pending: false,
  error: null,
}));

export const currentAccount = (): Account | null => {
  const a = useAccount.getState().account;
  if (a && a.exp <= Date.now() / 1000) {
    useAccount.setState({ account: null });
    return null;
  }
  return a;
};

async function adopt(pass: string, profile?: AccountProfile): Promise<boolean> {
  const claims = await verifyPass(pass);
  if (!claims) {
    useAccount.setState({ pending: false, error: 'invalid' });
    return false;
  }
  const account: Account = { uid: claims.sub, name: claims.name, pass, exp: claims.exp, profile };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(account)); } catch { /* private mode */ }
  useAccount.setState({ account, pending: false, error: null });
  return true;
}

export function signOut(): void {
  try { localStorage.removeItem(STORE_KEY); } catch { /* private mode */ }
  useAccount.setState({ account: null, error: null });
}

/* ------------------------------ sign-in ----------------------------- */

const returnAddress = (mode: 'popup' | 'page'): string =>
  `${window.location.origin}${window.location.pathname}${mode === 'popup' ? '?signin=popup' : ''}`;
const startUrl = (mode: 'popup' | 'page'): string =>
  `${AUTH_BASE}/google/start?return=${encodeURIComponent(returnAddress(mode))}`;

/* The popup cannot be relied on to reach the page that opened it: Google's
 * sign-in pages sever `window.opener` on the way through. Both windows share
 * this origin's storage, though, so the popup stores the pass and this page
 * hears about it - through a BroadcastChannel where there is one, and the
 * storage event where there is not. */
const CHANNEL = 'mply-auth';

/**
 * Sign in. A popup, so the page - and any table it is holding - never
 * navigates away. Where popups are blocked (some in-app browsers) it falls
 * back to a full redirect, and the address bar is put back afterwards.
 */
export function signIn(): void {
  useAccount.setState({ pending: true, error: null });
  const w = 480;
  const h = 640;
  const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
  const popup = window.open(startUrl('popup'), 'mply-signin', `popup,width=${w},height=${h},left=${left},top=${top}`);
  if (!popup) {
    try { sessionStorage.setItem(RETURN_HASH_KEY, window.location.hash); } catch { /* private mode */ }
    window.location.assign(startUrl('page'));
    return;
  }
  const watch = window.setInterval(() => {
    let closed = true;
    try { closed = popup.closed; } catch { /* severed: poll the store instead */ }
    if (!closed && !useAccount.getState().account) return;
    window.clearInterval(watch);
    if (useAccount.getState().pending) useAccount.setState({ pending: false });
  }, 700);
}

type AuthNote = { mplyAuth: 'done' } | { mplyAuthError: AccountStore['error'] };

function hear(note: AuthNote | null): void {
  if (!note || typeof note !== 'object') return;
  if ('mplyAuth' in note) {
    // Re-read rather than trust the message: the popup verified the pass
    // before storing it, and storage is the one thing only this origin writes.
    useAccount.setState({ account: readStored(), pending: false, error: null });
  } else if ('mplyAuthError' in note) {
    useAccount.setState({ pending: false, error: note.mplyAuthError ?? 'failed' });
  }
}

if (typeof window !== 'undefined') {
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e: MessageEvent) => hear(e.data as AuthNote);
  } catch { /* no BroadcastChannel: the storage event covers it */ }
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === STORE_KEY) useAccount.setState({ account: readStored(), pending: false });
  });
}

function announce(note: AuthNote): void {
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage(note);
    bc.close();
  } catch { /* storage event carries it */ }
}

/**
 * Run before the app renders. The auth server sends the browser back with
 * the pass in the fragment. In the popup, store it, tell the page that
 * opened it, and close; after a full redirect, keep it and restore the old
 * address. Returns true when this window is the popup, so the caller renders
 * a one-line note instead of a second copy of the game.
 */
export async function consumeAuthReturn(): Promise<boolean> {
  const m = /^#auth(_error)?=([^&]*)(?:&profile=([^&]*))?$/.exec(window.location.hash);
  const isPopup = new URLSearchParams(window.location.search).get('signin') === 'popup';
  if (!m) return isPopup;
  const value = decodeURIComponent(m[2]);
  const isError = Boolean(m[1]);
  const profile = readProfile(m[3] ? decodeURIComponent(m[3]) : undefined);

  if (isPopup) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    if (isError) announce({ mplyAuthError: (value as AccountStore['error']) ?? 'failed' });
    else if (await adopt(value, profile)) announce({ mplyAuth: 'done' });
    else announce({ mplyAuthError: 'invalid' });
    window.setTimeout(() => window.close(), 150);
    return true;
  }

  let back = '';
  try {
    back = sessionStorage.getItem(RETURN_HASH_KEY) ?? '';
    sessionStorage.removeItem(RETURN_HASH_KEY);
  } catch { /* private mode */ }
  window.history.replaceState(null, '', `${window.location.pathname}${back}`);
  if (isError) useAccount.setState({ error: (value as AccountStore['error']) ?? 'failed' });
  else await adopt(value, profile);
  return false;
}
