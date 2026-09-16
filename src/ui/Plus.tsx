import { useEffect, useState } from 'react';
import '../styles/plus.css';
import { useLang, useT } from '../i18n';
import { hasPlus, refreshPass, useAccount } from '../net/account';
import { checkoutReady, onPurchase, openCheckout } from '../net/checkout';
import { PLANS, YEARLY_SAVING, usd, type PlanId } from '../net/pricing';
import { Modal } from './bits';

/* ------------------------------------------------------------------ *
 * Party Hall Plus: what it gives, whether this player has it, and how to
 * buy it. Plus itself is decided by the server and arrives inside the pass;
 * nothing here can grant it.
 * ------------------------------------------------------------------ */

export function PlusBadge({ small = false }: { small?: boolean }) {
  const t = useT();
  return <span className={`plusBadge${small ? ' plusBadge--sm' : ''}`}>{t.account.plus.badge}</span>;
}

/** Pricing, terms, privacy and refunds: static pages beside the game. */
export function LegalLinks({ className = '' }: { className?: string }) {
  const t = useT();
  const L = t.account.plus.legal;
  const base = import.meta.env.BASE_URL;
  const pages: [Exclude<keyof typeof L, 'aria'>, string][] = [
    ['pricing', 'pricing'], ['terms', 'terms'], ['privacy', 'privacy'], ['refunds', 'refund'],
  ];
  return (
    <nav className={`legalLinks ${className}`.trim()} aria-label={L.aria}>
      {pages.map(([key, file]) => (
        <a key={key} href={`${base}legal/${file}.html`} target="_blank" rel="noopener">{L[key]}</a>
      ))}
    </nav>
  );
}

export function PlusSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const P = t.account.plus;
  const lang = useLang();
  const account = useAccount((s) => s.account);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [opening, setOpening] = useState<PlanId | null>(null);
  const [failed, setFailed] = useState(false);
  const [thanks, setThanks] = useState(false);
  const active = hasPlus(account);
  const ready = checkoutReady();

  useEffect(() => onPurchase(() => setThanks(true)), []);

  let until = '';
  if (account?.plus) {
    try {
      until = new Date(account.plus * 1000).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      until = new Date(account.plus * 1000).toISOString().slice(0, 10);
    }
  }

  const copyId = async () => {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account.uid);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* blocked clipboard: the id is on screen and selectable */ }
  };

  const check = async () => {
    setChecking(true);
    await refreshPass(true);
    setChecking(false);
  };

  const buy = async (plan: PlanId) => {
    setFailed(false);
    setOpening(plan);
    const ok = await openCheckout(plan, lang);
    setOpening(null);
    if (!ok) setFailed(true);
  };

  return (
    <Modal open={open} onClose={onClose} title={P.title}>
      <div className="plusSheet">
        <p className="plusSheet__lead">{P.lead}</p>
        <ul className="plusSheet__perks">
          {P.perks.map(([name, hint]) => (
            <li key={name} className="plusSheet__perk">
              <span className="plusSheet__tick" aria-hidden>✦</span>
              <span>
                <span className="plusSheet__perkName">{name}</span>
                <span className="plusSheet__perkHint">{hint}</span>
              </span>
            </li>
          ))}
        </ul>

        {!account ? (
          <p className="plusSheet__note">{P.signInFirst}</p>
        ) : active ? (
          <>
            <p className="plusSheet__active"><PlusBadge /> {P.activeUntil(until)}</p>
            {ready && <p className="plusSheet__note">{P.manage}</p>}
          </>
        ) : ready ? (
          <div className="plusSheet__get">
            {thanks ? (
              <p className="plusSheet__active">{P.thanks}</p>
            ) : (
              <div className="plans">
                {(['yearly', 'monthly'] as const).map((plan) => (
                  <button
                    key={plan}
                    type="button"
                    className="plan"
                    data-best={plan === 'yearly' || undefined}
                    onClick={() => { void buy(plan); }}
                    disabled={opening !== null}
                  >
                    <span className="plan__name">{P.plans[plan]}</span>
                    <span className="plan__price num">
                      {usd(PLANS[plan].usd)}
                      <span className="plan__per">{P.per[plan]}</span>
                    </span>
                    {plan === 'yearly' && <span className="plan__save">{P.save(YEARLY_SAVING)}</span>}
                    {opening === plan && <span className="plan__opening">{P.opening}</span>}
                  </button>
                ))}
              </div>
            )}
            <p className="plusSheet__note">{failed ? P.checkoutFailed : P.checkoutNote}</p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={check} disabled={checking}>
              {checking ? P.checking : P.refresh}
            </button>
          </div>
        ) : (
          <div className="plusSheet__get">
            <p className="plusSheet__note">{P.checkoutSoon}</p>
            <div className="plusSheet__id">
              <span className="switch__label">{P.yourId}</span>
              <code className="plusSheet__uid num">{account.uid}</code>
              <button type="button" className="btn btn--sm" onClick={copyId}>{copied ? P.copied : P.copy}</button>
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={check} disabled={checking}>
              {checking ? P.checking : P.refresh}
            </button>
          </div>
        )}

        <LegalLinks />
      </div>
    </Modal>
  );
}
