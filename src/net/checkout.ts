import { currentAccount, refreshPass } from './account';
import { PLANS, type PlanId } from './pricing';

/* ------------------------------------------------------------------ *
 * Buying Plus, through Paddle's overlay checkout.
 *
 * Paddle is the merchant of record. The checkout carries only this
 * player's opaque id; when the payment completes, Paddle tells the account
 * server by signed webhook, the server grants Plus, and this browser picks
 * it up by asking for a fresh pass. Nothing on this side can grant Plus -
 * a checkout that "completes" here without Paddle's webhook changes nothing.
 * ------------------------------------------------------------------ */

const TOKEN = import.meta.env.VITE_PADDLE_CLIENT_TOKEN || undefined;
const SANDBOX = import.meta.env.VITE_PADDLE_ENV === 'sandbox';

interface PaddleJs {
  Environment: { set(env: 'sandbox' | 'production'): void };
  Initialize(options: { token: string; eventCallback?: (event: { name?: string }) => void }): void;
  Checkout: { open(options: Record<string, unknown>): void };
}

declare global {
  interface Window { Paddle?: PaddleJs }
}

/** Whether this build was given what a checkout needs. */
export const checkoutReady = (): boolean => Boolean(TOKEN && PLANS.monthly.priceId && PLANS.yearly.priceId);

const listeners = new Set<() => void>();

/** Hear about a completed purchase in this tab. Returns the unsubscribe. */
export function onPurchase(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function purchased(): void {
  // The webhook usually lands within seconds; ask for the new pass a few
  // times rather than once, so a slow one still shows up without a reload.
  for (const ms of [2000, 5000, 10000, 20000, 40000, 80000]) {
    window.setTimeout(() => { void refreshPass(true); }, ms);
  }
  listeners.forEach((fn) => fn());
}

let loading: Promise<PaddleJs | null> | null = null;

function loadPaddle(): Promise<PaddleJs | null> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
    script.async = true;
    script.onload = () => {
      const paddle = window.Paddle;
      if (!paddle || !TOKEN) { resolve(null); return; }
      if (SANDBOX) paddle.Environment.set('sandbox');
      paddle.Initialize({
        token: TOKEN,
        eventCallback: (event) => { if (event?.name === 'checkout.completed') purchased(); },
      });
      resolve(paddle);
    };
    script.onerror = () => { loading = null; resolve(null); };
    document.head.appendChild(script);
  });
  return loading;
}

/** Open the checkout for a plan. False when there is no account or no checkout. */
export async function openCheckout(plan: PlanId, lang: string): Promise<boolean> {
  const account = currentAccount();
  const priceId = PLANS[plan].priceId;
  if (!account || !priceId || !checkoutReady()) return false;
  const paddle = await loadPaddle();
  if (!paddle) return false;
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customData: { uid: account.uid },
    ...(account.profile?.email ? { customer: { email: account.profile.email } } : {}),
    settings: { displayMode: 'overlay', theme: 'dark', locale: lang === 'ru' ? 'ru' : 'en' },
  });
  return true;
}
