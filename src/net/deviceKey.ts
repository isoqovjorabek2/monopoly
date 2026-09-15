/* ------------------------------------------------------------------ *
 * This browser's own key.
 *
 * A pass alone is a bearer token: whoever holds the string is the player.
 * And a pass is handed to every host the player joins - so a dishonest host
 * could keep it and sit down at other tables as them.
 *
 * So each browser makes an ECDSA P-256 key pair once, and the private half
 * is created non-extractable: the page can sign with it, but no script -
 * this one included - can ever read it out. Sign-in writes the public half
 * into the pass. A host then asks the browser to sign a fresh challenge for
 * this room, and a copied pass with no key behind it answers nothing.
 *
 * The key lives in IndexedDB, which stores a CryptoKey as the object itself
 * rather than as bytes, so it survives reloads without ever being exported.
 * ------------------------------------------------------------------ */

export interface PublicPoint { x: string; y: string }

const DB = 'mply';
const STORE = 'keys';
const ID = 'device';

const b64u = (bytes: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64u = (text: string): Uint8Array<ArrayBuffer> => {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

interface Stored { privateKey: CryptoKey; publicKey: PublicPoint }

let cached: PublicPoint | null = null;
let loading: Promise<Stored | null> | null = null;

async function loadOrCreate(): Promise<Stored | null> {
  try {
    const found = await idb<Stored | undefined>('readonly', (s) => s.get(ID));
    if (found?.privateKey && found.publicKey) return found;
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, // the private key can never be exported
      ['sign', 'verify'],
    );
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const stored: Stored = { privateKey: pair.privateKey, publicKey: { x: jwk.x!, y: jwk.y! } };
    await idb('readwrite', (s) => s.put(stored, ID));
    return stored;
  } catch {
    // No IndexedDB (some private modes): this browser simply cannot sign in.
    return null;
  }
}

/** The key, made the first time it is asked for. */
export function deviceKey(): Promise<Stored | null> {
  if (!loading) {
    loading = loadOrCreate().then((k) => { cached = k?.publicKey ?? null; return k; });
  }
  return loading;
}

/** The public half if it is already loaded - for a click handler that has
 *  to open a window before it may wait on anything. */
export const devicePublicKeyNow = (): PublicPoint | null => cached;

/** What a host asks a player to sign: bound to this room and this host
 *  generation, so an answer given to one table is worthless at any other. */
export const proofMessage = (code: string, epoch: number, nonce: string): string =>
  `mply-proof|${code}|${epoch}|${nonce}`;

export async function signProof(message: string): Promise<string | null> {
  const k = await deviceKey();
  if (!k) return null;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, k.privateKey, new TextEncoder().encode(message),
  );
  return b64u(sig);
}

export async function verifyProof(point: PublicPoint, message: string, sig: unknown): Promise<boolean> {
  try {
    if (typeof sig !== 'string' || sig.length > 200) return false;
    const key = await crypto.subtle.importKey(
      'jwk', { kty: 'EC', crv: 'P-256', x: point.x, y: point.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    );
    const raw = unb64u(sig);
    if (raw.length !== 64) return false;
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, new TextEncoder().encode(message));
  } catch {
    return false;
  }
}

/** A fresh challenge. */
export function makeNonce(): string {
  const bytes = new Uint8Array(new ArrayBuffer(18));
  crypto.getRandomValues(bytes);
  return b64u(bytes.buffer);
}

/** A public point as the auth server takes it: `x.y`, both base64url. */
export const encodePoint = (p: PublicPoint): string => `${p.x}.${p.y}`;

export const isPoint = (v: unknown): v is PublicPoint =>
  !!v && typeof v === 'object'
  && typeof (v as PublicPoint).x === 'string' && /^[A-Za-z0-9_-]{43}$/.test((v as PublicPoint).x)
  && typeof (v as PublicPoint).y === 'string' && /^[A-Za-z0-9_-]{43}$/.test((v as PublicPoint).y);
