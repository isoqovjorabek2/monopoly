import { useEffect, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { ART } from '../art/art';
import { BOARD, GROUP_COLOR } from '../game/board';
import { TOKENS } from '../game/settings';
import type { TokenId } from '../game/types';
import { useStore } from '../store/store';
import { normaliseCode } from '../net/protocol';
import { Avatar, fmt } from './bits';

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
  const me = useStore((s) => s.me);
  const netError = useStore((s) => s.netError);
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

  /* The backdrop is set as a variable rather than in the stylesheet
   * because its path depends on the deploy base and on which version is
   * selected; CSS owns the scrim that keeps the type readable over it. */
  return (
    <div className="home" style={{ '--hero-img': `url("${ART.hero}")` } as CSSProperties}>
      <motion.div
        className="home__inner"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <div className="home__spread">
          <motion.header
            className="masthead"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          >
            <h1 className="masthead__title">
              <span className="masthead__word">Monopoly</span>
              <span className="masthead__sub">Royale</span>
            </h1>

            <p className="masthead__lead">
              The whole game, not the half everybody plays. Auctions on every declined
              purchase, mortgages and the interest on them, even building, and the
              thirty-two houses the bank actually owns &mdash; so a housing shortage is a
              strategy again.
            </p>
            <p className="masthead__note">
              It runs in the browsers of the people playing it. One of you hosts, the rest
              connect straight to that tab. Nothing to install, nothing to sign up for, and
              nowhere else your game is kept.
            </p>
          </motion.header>

          <motion.div
            className="deedWrap"
            initial={{ opacity: 0, y: 26, rotate: -7 }}
            animate={{ opacity: 1, y: 0, rotate: -3.2 }}
            transition={{ duration: 0.7, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          >
            <TitleDeed />
          </motion.div>

          <motion.section
            className="seat"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          >
            <h2 className="seat__title">Take a seat</h2>

            {netError && <div className="banner banner--bad" role="alert">{netError}</div>}

            <label className="labelled">
              <span className="switch__label">Your name at the table</span>
              <input
                className="field"
                value={name}
                maxLength={18}
                placeholder="What should we call you?"
                onChange={(e) => setName(e.target.value)}
                onBlur={commit}
                autoComplete="nickname"
                aria-describedby={nameOk ? undefined : 'name-hint'}
              />
              {!nameOk && (
                <span id="name-hint" className="hint">
                  A name is all it takes to start.
                </span>
              )}
            </label>

            <div className="labelled">
              <span className="switch__label">Your piece</span>
              <div className="tokenPicker" role="radiogroup" aria-label="Playing piece">
                {TOKENS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={token === t.id}
                    className="tokenPicker__item"
                    data-on={token === t.id || undefined}
                    onClick={() => { setToken(t.id); setProfile(name, t.id); }}
                    title={t.label}
                  >
                    <Avatar color="#e8b448" token={t.id} size={26} />
                    <span className="tokenPicker__label">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <hr className="seat__rule" />

            {/* One primary way in. Hosting, joining and solo used to sit in
                three identical cards, which turned an invitation into a menu
                and left the player deciding which box to read first. */}
            <button
              type="button"
              className="btn btn--primary btn--block btn--lg"
              disabled={!nameOk}
              title={nameOk ? undefined : 'Pick a name first'}
              onClick={() => go(() => hostRoom())}
            >
              Open a table
            </button>
            <p className="seat__under">
              You get a code to share and the whole rulebook to set.
            </p>

            <form
              className="seat__join"
              onSubmit={(e) => { e.preventDefault(); if (code.trim()) go(() => joinRoom(code)); }}
            >
              <span className="switch__label">Been invited?</span>
              <div className="joinRow">
                <input
                  className="field num joinRow__code"
                  value={code}
                  placeholder="GOLD-FALCON-42"
                  onChange={(e) => setCode(normaliseCode(e.target.value))}
                  aria-label="Room code"
                  spellCheck={false}
                  autoCapitalize="characters"
                />
                <button
                  type="submit"
                  className="btn"
                  disabled={!nameOk || code.trim().length < 3}
                  title={nameOk ? undefined : 'Pick a name first'}
                >
                  Join
                </button>
              </div>
              {urlCode && (
                <p className="muted small">
                  You followed an invite to <strong className="num">{urlCode}</strong>.
                </p>
              )}
            </form>

            <button
              type="button"
              className="seat__solo"
              disabled={!nameOk}
              onClick={() => go(playSolo)}
            >
              Or learn the board against bots
            </button>
          </motion.section>
        </div>
      </motion.div>
    </div>
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
function TitleDeed() {
  const space = BOARD[39];
  const rent = space.rent ?? [];
  const rows: [string, number][] = [
    ['Rent', rent[0] ?? 0],
    ['With one house', rent[1] ?? 0],
    ['With three houses', rent[3] ?? 0],
    ['With a hotel', rent[5] ?? 0],
  ];

  return (
    <article className="deedPlate" aria-label={`Title deed for ${space.name}`}>
      <div className="deedPlate__head" style={{ background: GROUP_COLOR.darkblue }}>
        <span className="deedPlate__kicker">Title Deed</span>
        <span className="deedPlate__name">{space.name}</span>
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
        Houses <span className="num">{fmt(space.houseCost ?? 0)}</span> each
        <span aria-hidden> &middot; </span>
        Mortgage <span className="num">{fmt(space.mortgage ?? 0)}</span>
      </p>
    </article>
  );
}
