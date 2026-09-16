import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import '../styles/account.css';
import '../styles/plus.css';
import { TOKENS } from '../game/settings';
import type { TokenId } from '../game/types';
import { useLang, useT } from '../i18n';
import { hasPlus, refreshPass, signIn, signOut, useAccount } from '../net/account';
import { checkoutReady, onPurchase, openCheckout } from '../net/checkout';
import { cleanSkin, SKINS } from '../net/plus';
import { PLANS, YEARLY_SAVING, usd, type PlanId } from '../net/pricing';
import { useStore } from '../store/store';
import { Avatar } from './bits';
import { LangSwitch } from './LangSwitch';
import { LegalLinks, PlusBadge } from './Plus';
import { StatsPanel } from './Stats';
import { YourGames } from './Entry';

/* ==================================================================== *
 * The account, in one place: who you are at a table, your language, your
 * subscription, your games and your stats.
 *
 * It is a screen rather than a modal because it holds everything a player
 * might come looking for, and because a subscription deserves a page it
 * can be linked to (#/account) rather than a popup over a board.
 * ==================================================================== */

export function AccountPage() {
  const t = useT();
  const A = t.account.page;
  const account = useAccount((s) => s.account);
  const closeAccount = useStore((s) => s.closeAccount);
  const plus = hasPlus(account);

  return (
    <div className="accountPage">
      <header className="accountPage__head">
        <button type="button" className="btn btn--ghost btn--sm" onClick={closeAccount}>{A.back}</button>
        <h1 className="accountPage__title">{A.title}</h1>
        <div className="spacer" />
        {plus && <PlusBadge />}
        <LangSwitch />
      </header>

      <motion.div
        className="accountPage__body"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        <YouCard />
        <PlusCard />
        <section className="accountCard accountCard--wide">
          <h2 className="accountCard__title">{A.gamesTitle}</h2>
          <StatsPanel />
        </section>
        <section className="accountCard accountCard--wide">
          <h2 className="accountCard__title">{A.savedTitle}</h2>
          {account
            ? <YourGames onResume={(code, epoch) => { closeAccount(); useStore.getState().resumeTable(code, epoch); }} empty={A.savedEmpty} />
            : <p className="muted small">{A.savedSignedOut}</p>}
        </section>
        <LegalLinks className="accountPage__legal" />
      </motion.div>
    </div>
  );
}

/* ------------------------------- you -------------------------------- */

function YouCard() {
  const t = useT();
  const A = t.account.page;
  const account = useAccount((s) => s.account);
  const me = useStore((s) => s.me);
  const setProfile = useStore((s) => s.setProfile);
  const setSkin = useStore((s) => s.setSkin);
  const plus = hasPlus(account);
  const [name, setName] = useState(me.name);
  const finish = plus ? cleanSkin(me.skin) : 'classic';

  useEffect(() => { setName(me.name); }, [me.name]);

  return (
    <section className="accountCard">
      <h2 className="accountCard__title">{A.youTitle}</h2>

      {account ? (
        <div className="whoami whoami--plain">
          {account.profile?.picture ? (
            <img className="whoami__pic" src={account.profile.picture} alt="" width={40} height={40} referrerPolicy="no-referrer" />
          ) : (
            <span className="whoami__pic whoami__pic--initial" aria-hidden>
              {(account.profile?.name || account.name).charAt(0).toUpperCase()}
            </span>
          )}
          <span className="whoami__text">
            <span className="whoami__name truncate">{account.profile?.name || account.name}</span>
            {account.profile?.email && <span className="whoami__email truncate">{account.profile.email}</span>}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={signOut}>{t.account.signOut}</button>
        </div>
      ) : (
        <div className="accountCard__signin">
          <p className="muted small">{A.signedOutNote}</p>
          <button type="button" className="btn btn--primary btn--sm" onClick={signIn}>{t.account.signIn}</button>
        </div>
      )}

      <label className="labelled">
        <span className="switch__label">{t.home.nameLabel}</span>
        <input
          className="field"
          value={name}
          maxLength={18}
          placeholder={t.home.namePlaceholder}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setProfile(name, me.token)}
          autoComplete="nickname"
        />
      </label>

      <div className="labelled">
        <span className="switch__label">
          {t.home.piece}
          <span className="entry__pieceName"> · {t.tokens[me.token]}</span>
        </span>
        <div className="pieceRow" role="radiogroup" aria-label={t.home.pieceAria}>
          {TOKENS.map((tk) => (
            <button
              key={tk.id}
              type="button"
              role="radio"
              aria-checked={me.token === tk.id}
              aria-label={t.tokens[tk.id]}
              title={t.tokens[tk.id]}
              className="pieceRow__item"
              data-on={me.token === tk.id || undefined}
              onClick={() => setProfile(name, tk.id as TokenId)}
            >
              <Avatar color="#e8b448" token={tk.id} size={26} finish={finish} />
            </button>
          ))}
        </div>
      </div>

      <div className="labelled">
        <span className="switch__label finishRow__label">
          {t.account.plus.finishLabel}
          <span className="entry__pieceName"> · {t.account.plus.finishNames[finish]}</span>
          {!plus && <PlusBadge small />}
        </span>
        <div className="finishRow" role="radiogroup" aria-label={t.account.plus.finishLabel}>
          {SKINS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={finish === f}
              aria-label={t.account.plus.finishNames[f]}
              title={t.account.plus.finishNames[f]}
              className="pieceRow__item finishRow__item"
              data-on={finish === f || undefined}
              disabled={f !== 'classic' && !plus}
              onClick={() => setSkin(f)}
            >
              <Avatar color="#e8b448" token={me.token} size={26} finish={f} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- plus ------------------------------- */

/**
 * The offer, or the status. One card either way: a player who pays should
 * see what they have and how to change it, and a player who does not should
 * see what it costs and what it gives - once, in one place, not as a banner
 * following them around the game.
 */
function PlusCard() {
  const t = useT();
  const P = t.account.plus;
  const A = t.account.page;
  const lang = useLang();
  const account = useAccount((s) => s.account);
  const plus = hasPlus(account);
  const ready = checkoutReady();
  const [opening, setOpening] = useState<PlanId | null>(null);
  const [failed, setFailed] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const off = onPurchase(() => setThanks(true));
    return () => { off(); };
  }, []);

  let until = '';
  if (account?.plus) {
    try {
      until = new Date(account.plus * 1000).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      until = new Date(account.plus * 1000).toISOString().slice(0, 10);
    }
  }

  const buy = async (plan: PlanId) => {
    setFailed(false);
    setOpening(plan);
    const ok = await openCheckout(plan, lang);
    setOpening(null);
    if (!ok) setFailed(true);
  };

  const check = async () => {
    setChecking(true);
    await refreshPass(true);
    setChecking(false);
  };

  const copyId = async () => {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account.uid);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* blocked clipboard: the id is on screen and selectable */ }
  };

  const perMonth = usd(Math.round((PLANS.yearly.usd / 12) * 100) / 100);

  return (
    <section className={`accountCard plusCard${plus ? ' plusCard--active' : ''}`}>
      <h2 className="accountCard__title">
        {P.title}
        {plus && <PlusBadge small />}
      </h2>

      {plus ? (
        <>
          <p className="plusCard__lead">{P.activeUntil(until)}</p>
          <ul className="plusSheet__perks plusCard__perks">
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
          {ready && <p className="plusSheet__note">{P.manage}</p>}
        </>
      ) : (
        <>
          <p className="plusCard__lead">{P.lead}</p>

          {!account ? (
            <p className="plusSheet__note">{P.signInFirst}</p>
          ) : thanks ? (
            <p className="plusSheet__active">{P.thanks}</p>
          ) : ready ? (
            <div className="plans plusCard__plans">
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
                  <span className="plan__price">
                    {plan === 'yearly' ? perMonth : usd(PLANS[plan].usd)}
                    <span className="plan__per">{P.per.monthly}</span>
                  </span>
                  <span className="plan__billed">
                    {plan === 'yearly' ? A.billedYearly(usd(PLANS.yearly.usd)) : A.billedMonthly}
                  </span>
                  {plan === 'yearly' && <span className="plan__save">{P.save(YEARLY_SAVING)}</span>}
                  {opening === plan && <span className="plan__opening">{P.opening}</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="plusSheet__get">
              <p className="plusSheet__note">{P.checkoutSoon}</p>
              <div className="plusSheet__id">
                <span className="switch__label">{P.yourId}</span>
                <code className="plusSheet__uid num">{account.uid}</code>
                <button type="button" className="btn btn--sm" onClick={copyId}>{copied ? P.copied : P.copy}</button>
              </div>
            </div>
          )}

          <ul className="plusSheet__perks plusCard__perks">
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

          {account && (
            <p className="plusSheet__note">
              {failed ? P.checkoutFailed : ready ? P.checkoutNote : ''}
            </p>
          )}
          {account && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={check} disabled={checking}>
              {checking ? P.checking : P.refresh}
            </button>
          )}
        </>
      )}
    </section>
  );
}
