import { useEffect, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import '../styles/picker.css';
import { ART, GAME_COVER, cfJobArt } from '../art/art';
import { professionById } from '../cashflow/data';
import { BOARD, GROUP_COLOR } from '../game/board';
import { TOKENS } from '../game/settings';
import type { TokenId } from '../game/types';
import { spaceName, useT } from '../i18n';
import { useStore } from '../store/store';
import { normaliseCode, type GameKind } from '../net/protocol';
import { Avatar, fmt } from './bits';
import { LangSwitch } from './LangSwitch';
import { PublicRooms } from './PublicRooms';

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
  const me = useStore((s) => s.me);
  const netError = useStore((s) => s.netError);
  const pick = useStore((s) => s.pick);
  const setPick = useStore((s) => s.setPick);
  const setProfile = useStore((s) => s.setProfile);
  const hostRoom = useStore((s) => s.hostRoom);
  const joinRoom = useStore((s) => s.joinRoom);
  const playSolo = useStore((s) => s.playSolo);

  const urlCode = useJoinCodeFromUrl();
  const [name, setName] = useState(me.name);
  const [token, setToken] = useState<TokenId>(me.token);
  const [code, setCode] = useState('');

  useEffect(() => { if (urlCode) setCode(urlCode); }, [urlCode]);

  const commit = () => setProfile(name, token);
  const nameOk = name.trim().length > 0;

  const go = (fn: () => void) => { commit(); fn(); };

  const [inviteBefore, inviteAfter] = t.home.followedInvite;
  const cashflow = pick === 'cashflow';
  const P = t.cf.picker;

  /* The backdrop is set as a variable rather than in the stylesheet
   * because its path depends on the deploy base and on which game is
   * picked; CSS owns the scrim that keeps the type readable over it. */
  const hero = cashflow ? GAME_COVER.cashflow : ART.hero;

  return (
    <div className="home" data-game={pick} style={{ '--hero-img': `url("${hero}")` } as CSSProperties}>
      <LangSwitch className="home__lang" />
      <motion.div
        className="home__inner"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <div className="home__spread home__spread--pick">
          <GamePicker pick={pick} onPick={setPick} />

          <motion.header
            key={pick}
            className="masthead"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* The names are brands, so they stay as they are in every language. */}
            <h1 className="masthead__title">
              <span className="masthead__word">{cashflow ? P.cashflow.name : P.monopoly.name}</span>
              <span className="masthead__sub">{cashflow ? P.cashflow.sub : P.monopoly.sub}</span>
            </h1>

            <p className="masthead__lead">{cashflow ? P.lead : t.home.lead}</p>
            <p className="masthead__note">{cashflow ? P.note : t.home.note}</p>
          </motion.header>

          {/* The artefact for whichever game is picked: three title deeds for
              Monopoly, three dealt professions for Cashflow - each built from
              the same data the game is played with. */}
          <div className="deedWrap" key={`fan-${pick}`}>
            {(cashflow
              ? [{ id: 'janitor', cls: 'deedFan__back' }, { id: 'teacher', cls: 'deedFan__mid' }, { id: 'doctor', cls: 'deedFan__front' }]
              : [{ id: '5', cls: 'deedFan__back' }, { id: '24', cls: 'deedFan__mid' }, { id: '39', cls: 'deedFan__front' }]
            ).map((d, i) => (
              <motion.div
                key={d.id}
                className={`deedFan ${d.cls}`}
                initial={{ opacity: 0, y: 30 - i * 4, rotate: -4 + i * 3 }}
                animate={{ opacity: 1, y: 0, rotate: [-20, -1, 18][i] }}
                transition={{ duration: 0.72, delay: 0.1 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
              >
                {cashflow ? <JobCard id={d.id} /> : <TitleDeed id={Number(d.id)} />}
              </motion.div>
            ))}
          </div>

          <motion.section
            className="joinCard"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          >
            <h2 className="joinCard__title">{t.home.takeSeat}</h2>

            {netError && <div className="banner banner--bad" role="alert">{netError}</div>}

            <label className="labelled">
              <span className="switch__label">{t.home.nameLabel}</span>
              <input
                className="field"
                value={name}
                maxLength={18}
                placeholder={t.home.namePlaceholder}
                onChange={(e) => setName(e.target.value)}
                onBlur={commit}
                autoComplete="nickname"
                aria-describedby={nameOk ? undefined : 'name-hint'}
              />
              {!nameOk && (
                <span id="name-hint" className="hint">
                  {t.home.nameHint}
                </span>
              )}
            </label>

            <div className="labelled">
              <span className="switch__label">{t.home.piece}</span>
              <div className="tokenPicker" role="radiogroup" aria-label={t.home.pieceAria}>
                {TOKENS.map((tk) => (
                  <button
                    key={tk.id}
                    type="button"
                    role="radio"
                    aria-checked={token === tk.id}
                    className="tokenPicker__item"
                    data-on={token === tk.id || undefined}
                    onClick={() => { setToken(tk.id); setProfile(name, tk.id); }}
                    title={t.tokens[tk.id]}
                  >
                    <Avatar color="#e8b448" token={tk.id} size={26} />
                    <span className="tokenPicker__label">{t.tokens[tk.id]}</span>
                  </button>
                ))}
              </div>
            </div>

            <hr className="joinCard__rule" />

            {/* One primary way in. It opens a table for whichever game is
                picked above; a code joins whatever game its host is playing. */}
            <button
              type="button"
              className="btn btn--primary btn--block btn--lg"
              disabled={!nameOk}
              title={nameOk ? undefined : t.home.pickName}
              onClick={() => go(() => hostRoom(undefined, pick))}
            >
              {t.home.open} · {cashflow ? P.cashflow.name : P.monopoly.name}
            </button>
            <p className="joinCard__under">{cashflow ? P.cashflow.meta : t.home.openUnder}</p>

            <form
              className="joinCard__form"
              onSubmit={(e) => { e.preventDefault(); if (code.trim()) go(() => joinRoom(code)); }}
            >
              <span className="switch__label">{t.home.invited}</span>
              <div className="joinRow">
                <input
                  className="field num joinRow__code"
                  value={code}
                  placeholder="GOLD-FALCON-42"
                  onChange={(e) => setCode(normaliseCode(e.target.value))}
                  aria-label={t.home.codeAria}
                  spellCheck={false}
                  autoCapitalize="characters"
                />
                <button
                  type="submit"
                  className="btn"
                  disabled={!nameOk || code.trim().length < 3}
                  title={nameOk ? undefined : t.home.pickName}
                >
                  {t.common.join}
                </button>
              </div>
              {urlCode && (
                <p className="muted small">
                  {inviteBefore}<strong className="num">{urlCode}</strong>{inviteAfter}
                </p>
              )}
            </form>

            {!cashflow && <PublicRooms onJoin={(id) => go(() => joinRoom(id))} />}

            <button
              type="button"
              className="joinCard__solo"
              disabled={!nameOk}
              onClick={() => go(() => playSolo(pick))}
            >
              {t.home.solo}
            </button>
          </motion.section>
        </div>
      </motion.div>
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
        {(['monopoly', 'cashflow'] as const).map((k) => (
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
