import { useEffect, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import '../styles/picker.css';
import '../styles/hall.css';
import { ART, GAME_COVER, MAF_ART, cfJobArt, mafRoleCard, themedMedal } from '../art/art';
import { professionById } from '../cashflow/data';
import { BOARD, GROUP_COLOR } from '../game/board';
import { spaceName, useT } from '../i18n';
import { BOARD_THEMES } from '../i18n/themes';
import { forgetSave, readSave, useStore } from '../store/store';
import { normaliseCode, type GameKind } from '../net/protocol';
import { fmt } from './bits';
import { ROLE_TEAM } from '../mafia/data';
import type { MafiaRole } from '../mafia/types';
import { LangSwitch } from './LangSwitch';
import { EntryCard } from './Entry';
import { InstallRow } from './Pwa';
import { LegalLinks, PlusBadge } from './Plus';
import { AdBanner } from './Ads';

/** Reads a #/join/CODE deep link once on mount. */
function useJoinCodeFromUrl(): string {
  const [code, setCode] = useState('');
  useEffect(() => {
    const read = () => {
      const m = window.location.hash.match(/#\/join\/([A-Za-z0-9-]+)/);
      if (m) setCode(normaliseCode(m[1]));
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  return code;
}

export function Home() {
  const t = useT();
  const netError = useStore((s) => s.netError);
  const pick = useStore((s) => s.pick);
  const setPick = useStore((s) => s.setPick);

  const resumeSaved = useStore((s) => s.resumeSaved);
  const [saved, setSaved] = useState(readSave);

  const urlCode = useJoinCodeFromUrl();

  const cashflow = pick === 'cashflow';
  const mafia = pick === 'mafia';
  const P = t.cf.picker;

  /* The backdrop is set as a variable rather than in the stylesheet
   * because its path depends on the deploy base and on which game is
   * picked; CSS owns the scrim that keeps the type readable over it. */
  const hero = mafia ? MAF_ART.hero : cashflow ? GAME_COVER.cashflow : ART.hero;

  const fan = (mafia
    ? t.maf.home.cast.map((id, i) => ({ id, cls: ['deedFan__back', 'deedFan__mid', 'deedFan__front'][i] }))
    : cashflow
      ? [{ id: 'janitor', cls: 'deedFan__back' }, { id: 'teacher', cls: 'deedFan__mid' }, { id: 'doctor', cls: 'deedFan__front' }]
      : [{ id: '5', cls: 'deedFan__back' }, { id: '24', cls: 'deedFan__mid' }, { id: '39', cls: 'deedFan__front' }]);

  return (
    <div className="home hall" data-game={pick} style={{ '--hero-img': `url("${hero}")` } as CSSProperties}>
      {/* The hall: the name of the place, the three tables you can walk
          over to, the language. One bar, the full width of the window. */}
      <header className="hall__bar">
        <span className="hall__brand" aria-hidden>Party Hall</span>
        <GamePicker pick={pick} onPick={setPick} />
        <LangSwitch className="hall__lang" />
      </header>

      <div className="hall__body">
        {/* The table you picked, lit: its name and its argument on the left,
            the thing itself - deeds, dealt jobs, dealt roles - on the right,
            and what it runs on along the foot. The rows are sized to fill
            the window, so nothing is left floating in empty felt. */}
        <main className="hall__stage">
          <motion.header
            key={pick}
            className="masthead hall__copy"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="hall__meta num">{P[pick].meta}</p>
            {/* The names are brands, so they stay as they are in every language. */}
            <h1 className="masthead__title">
              <span className="masthead__word">{P[pick].name}</span>
              <span className="masthead__sub">{P[pick].sub}</span>
            </h1>
            <p className="masthead__lead">{mafia ? t.maf.home.lead : cashflow ? P.lead : t.home.lead}</p>
          </motion.header>

          <div className="deedWrap hall__art" key={`fan-${pick}`}>
            {fan.map((d, i) => (
              <motion.div
                key={d.id}
                className={`deedFan ${d.cls}`}
                initial={{ opacity: 0, y: 30 - i * 4, rotate: -4 + i * 3 }}
                animate={{ opacity: 1, y: 0, rotate: [-20, -1, 18][i] }}
                transition={{ duration: 0.72, delay: 0.1 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
              >
                {mafia
                  ? <RoleCard role={d.id as MafiaRole} />
                  : cashflow ? <JobCard id={d.id} /> : <TitleDeed id={Number(d.id)} />}
              </motion.div>
            ))}
          </div>

          <footer className="hall__foot">
            <p className="masthead__note">{mafia ? t.maf.home.note : cashflow ? P.note : t.home.note}</p>
            {/* The boards the game is played on, medallion and name. The two
                beyond the Silk Road carry the Plus badge right on the front
                door: the subscription is easiest to want when you can see it. */}
            {pick === 'monopoly' && (
              <section className="boardStrip" aria-label={t.home.boardsTitle}>
                <p className="overline boardStrip__title">{t.home.boardsTitle}</p>
                <div className="boardStrip__row">
                  {BOARD_THEMES.map((id) => (
                    <span key={id} className="boardStrip__board">
                      <img
                        className="boardStrip__medal"
                        src={themedMedal(id)}
                        alt=""
                        width={52}
                        height={52}
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="boardStrip__name">
                        {t.account.plus.themeNames[id]}
                        {id !== 'silk' && <PlusBadge small />}
                      </span>
                    </span>
                  ))}
                </div>
              </section>
            )}
          </footer>
        </main>

        <motion.section
          className="joinCard hall__seat"
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        >
          <h2 className="joinCard__title">{t.home.takeSeat}</h2>

          {netError && <div className="banner banner--bad" role="alert">{netError}</div>}

          {saved && (
            <div className="banner resumeBanner" role="status">
              <span>{t.home.resumeNote(saved.code)}</span>
              <span className="spacer" />
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => { forgetSave(); setSaved(null); }}
              >
                {t.home.forget}
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => resumeSaved()}>
                {t.home.resume}
              </button>
            </div>
          )}

          <EntryCard pick={pick} urlCode={urlCode} />
          <InstallRow />
          <AdBanner slot="home" className="joinCard__ad" />
          <LegalLinks />
        </motion.section>
      </div>
    </div>
  );
}

/**
 * The choice of game. Two photographs of two tables in the same room, so
 * picking one reads as walking over to it rather than filling in a form.
 */
function GamePicker({ pick, onPick }: { pick: GameKind; onPick: (k: GameKind) => void }) {
  const t = useT();
  const P = t.cf.picker;
  return (
    <section className="picker" aria-label={P.aria}>
      <p className="picker__title overline">{P.title}</p>
      <div className="picker__row" role="radiogroup" aria-label={P.aria}>
        {(['monopoly', 'cashflow', 'mafia'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={pick === k}
            className="picker__card"
            data-on={pick === k || undefined}
            onClick={() => onPick(k)}
          >
            <img className="picker__cover" src={GAME_COVER[k]} alt="" width={600} height={343} decoding="async" />
            <span className="picker__text">
              <span className="picker__name">
                {P[k].name}
                <span className="picker__sub">{P[k].sub}</span>
              </span>
              <span className="picker__pitch">{P[k].pitch}</span>
              <span className="picker__meta num">{P[k].meta}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * The artefact, rather than a description of it.
 *
 * A landing page for a board game that shows only type is a landing page
 * for anything. This is a real title deed, built from the same board data
 * the game is played with - the rent ladder on it is the rent you will
 * actually pay - propped at an angle as an object lying on the table
 * rather than squared up as a card in a grid.
 */
function TitleDeed({ id = 39, className = '' }: { id?: number; className?: string }) {
  const t = useT();
  const d = t.home.deed;
  const space = BOARD[id];
  const name = spaceName(t, id);
  const rent = space.rent ?? [];
  const rows: [string, number][] = [
    [d.rent, rent[0] ?? 0],
    [d.oneHouse, rent[1] ?? 0],
    [d.threeHouses, rent[3] ?? 0],
    [d.hotel, rent[5] ?? 0],
  ];
  const [eachBefore, eachAfter] = d.housesEach;

  return (
    <article className={`deedPlate ${className}`} aria-label={d.aria(name)}>
      <div
        className="deedPlate__head"
        style={{ background: space.group ? GROUP_COLOR[space.group] : GROUP_COLOR.darkblue }}
      >
        <span className="deedPlate__kicker">{d.kicker}</span>
        <span className="deedPlate__name">{name}</span>
      </div>
      <dl className="deedPlate__rows">
        {rows.map(([label, value]) => (
          <div key={label} className="deedPlate__row">
            <dt>{label}</dt>
            <dd className="num">{fmt(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="deedPlate__foot">
        {eachBefore}<span className="num">{fmt(space.houseCost ?? 0)}</span>{eachAfter}
        <span aria-hidden> &middot; </span>
        {d.mortgage} <span className="num">{fmt(space.mortgage ?? 0)}</span>
      </p>
    </article>
  );
}

/** Cashflow's artefact: a dealt profession, with the pay cheque and the
 *  bills printed from the same table the game deals from. */
function JobCard({ id }: { id: string }) {
  const t = useT();
  const S = t.cf.statement;
  const p = professionById(id);
  const payments = Object.values(p.debts).reduce((n, d) => n + d.payment, 0);
  const expenses = p.taxes + p.other + payments;
  return (
    <article className="deedPlate jobPlate" aria-label={t.cf.professions[id]}>
      <div className="jobPlate__head">
        <img className="jobPlate__art" src={cfJobArt(id)} alt="" width={96} height={96} decoding="async" />
        <span className="deedPlate__kicker">{t.cf.name}</span>
        <span className="deedPlate__name">{t.cf.professions[id]}</span>
      </div>
      <dl className="deedPlate__rows">
        <div className="deedPlate__row"><dt>{S.salary}</dt><dd className="num">{fmt(p.salary)}</dd></div>
        <div className="deedPlate__row"><dt>{S.totalExpenses}</dt><dd className="num">{fmt(expenses)}</dd></div>
        <div className="deedPlate__row"><dt>{S.payCheck}</dt><dd className="num">{fmt(p.salary - expenses)}</dd></div>
      </dl>
      <p className="deedPlate__foot">{S.escapeGoal}</p>
    </article>
  );
}

/** Omertà's artefact: a dealt role card, face up for once - the emblem the
 *  reveal shows, and the brief the player reads under it. */
function RoleCard({ role }: { role: MafiaRole }) {
  const t = useT();
  const r = t.maf.roles[role];
  return (
    <article className="deedPlate rolePlate" data-team={ROLE_TEAM[role]} aria-label={r.name}>
      <div className="rolePlate__head">
        <img className="rolePlate__art" src={mafRoleCard(role)} alt={r.name} width={283} height={265} decoding="async" />
      </div>
      <p className="rolePlate__brief">{r.brief}</p>
    </article>
  );
}
