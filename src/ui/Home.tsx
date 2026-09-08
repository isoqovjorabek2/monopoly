import { useEffect, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { ART } from '../art/art';
import { TOKENS } from '../game/settings';
import type { TokenId } from '../game/types';
import { useStore } from '../store/store';
import { normaliseCode } from '../net/protocol';
import { Avatar } from './bits';

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

  return (
    // The backdrop is set as a variable rather than in the stylesheet
    // because its path depends on the deploy base and on which version is
    // selected; CSS owns the scrim that keeps the type readable over it.
    <div className="home" style={{ '--hero-img': `url("${ART.hero}")` } as CSSProperties}>
      <motion.div
        className="home__inner"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <header className="hero">
          <p className="overline">A private table for you and your friends</p>
          <h1 className="hero__title">
            Monopoly<span className="hero__title-accent">Royale</span>
          </h1>
          <p className="hero__lead">
            The full rules, the ones nobody plays, and the ones everybody actually plays -
            all switchable. Share a link and start. No signup, no server, no install.
          </p>
        </header>

        {netError && (
          <div className="banner banner--bad" role="alert">{netError}</div>
        )}

        <div className="home__grid">
          <section className="card home__identity">
            <h2 className="section__title">Your table identity</h2>

            <label className="labelled">
              <span className="switch__label">Display name</span>
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
                  Pick a name and the three buttons on the right come alive.
                </span>
              )}
            </label>

            <div className="labelled">
              <span className="switch__label">Playing piece</span>
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
          </section>

          <div className="home__actions">
            <section className="card action-card action-card--hero">
              <h2 className="section__title">Host a table</h2>
              <p className="muted">
                You get a shareable room code and full control of the rules. Your browser
                runs the game - everyone else connects straight to you.
              </p>
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={!nameOk}
                title={nameOk ? undefined : 'Pick a display name first'}
                onClick={() => go(() => hostRoom())}
              >
                Create a room
              </button>
            </section>

            <section className="card action-card">
              <h2 className="section__title">Join a friend</h2>
              <form
                onSubmit={(e) => { e.preventDefault(); if (code.trim()) go(() => joinRoom(code)); }}
              >
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
                    title={nameOk ? undefined : 'Pick a display name first'}
                  >
                    Join
                  </button>
                </div>
              </form>
              {urlCode && (
                <p className="muted small">
                  You followed an invite to <strong className="num">{urlCode}</strong>.
                </p>
              )}
            </section>

            <section className="card action-card">
              <h2 className="section__title">Play solo</h2>
              <p className="muted">
                Learn the board against bots. Three difficulties, same rules, no cheating.
              </p>
              <button
                type="button"
                className="btn btn--block"
                disabled={!nameOk}
                onClick={() => go(playSolo)}
              >
                Start a practice game
              </button>
            </section>
          </div>
        </div>

        <footer className="home__foot">
          <span className="chip">Peer to peer</span>
          <span className="chip">Official rules included</span>
          <span className="chip">Auctions, trades, mortgages</span>
          <span className="chip">Works on phones</span>
        </footer>
      </motion.div>
    </div>
  );
}
