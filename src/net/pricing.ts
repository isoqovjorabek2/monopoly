/* ------------------------------------------------------------------ *
 * Party Hall Plus prices. Shown in USD here and on /legal/pricing.html;
 * Paddle converts and adds local tax at checkout. The price ids are
 * Paddle's, set per build (see .env.example) - without them there is no
 * checkout and the Plus sheet says so.
 * ------------------------------------------------------------------ */

export type PlanId = 'monthly' | 'yearly';

export const PLANS: Record<PlanId, { usd: number; priceId: string | undefined }> = {
  monthly: { usd: 2.99, priceId: import.meta.env.VITE_PADDLE_PRICE_MONTHLY || undefined },
  yearly: { usd: 19.99, priceId: import.meta.env.VITE_PADDLE_PRICE_YEARLY || undefined },
};

/** How much cheaper a year is than twelve months, in whole percent. */
export const YEARLY_SAVING = Math.round((1 - PLANS.yearly.usd / (PLANS.monthly.usd * 12)) * 100);

export const usd = (amount: number): string => `$${amount.toFixed(2)}`;
