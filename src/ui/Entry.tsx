import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import '../styles/entry.css';
import { TOKENS } from '../game/settings';
import { cleanSkin } from '../net/plus';
import type { TokenId } from '../game/types';
import { useT } from '../i18n';
import { hasPlus, signIn, useAccount } from '../net/account';
import { normaliseCode, type GameKind } from '../net/protocol';
import { useStore } from '../store/store';
import { Avatar } from './bits';
import { PlusBadge, PlusSheet } from './Plus';
import { PublicRooms } from './PublicRooms';
import { forgetTable, listTables, type SavedTable } from '../net/saves';
import { MAF_MIN_PLAYERS } from '../mafia/data';

/* ==================================================================== *
 * The front door's card.
 *
 * It used to be one column in which a name field, a piece picker, "open a
 * table", a code box, a list of public tables and "play against bots" all
 * sat at the same volume - and whether a table you opened was public was
 * not asked at all until you were already in its lobby. People could not
 * tell which of those they wanted, or what each would do.
 *
 * So it asks the three questions in order, one at a time:
 *
 *   1. Who are you?  Google, or a guest name - and a piece.
 *   2. What are you doing?  Hosting, joining, or practising: three tabs,
 *      each with exactly one button that says what it will do.
 *   3. (Hosting only) Who can join?  Private or public, chosen before the
 *      table exists, and named again on the button.
 * ==================================================================== */

type Mode = 'host' | 'join' | 'practice';

/** A pasted invite link is as good as its code. */
function codeFrom(input: string): string {
  const link = /#\/join\/([A-Za-z0-9-]+)/.exec(input);
  return normaliseCode(link ? link[1] : input);
}

/** App-shortcut deep links: `?do=host|join|solo` opens the matching tab.
 *  Read once, on mount; an invite code in the URL still wins over it. */
function modeFromUrl(): Mode | null {
  try {
    const doParam = new URLSearchParams(window.location.search).get('do');
    if (doParam === 'host' || doParam === 'join') return doParam;
    if (doParam === 'solo') return 'practice';
  } catch { /* no window (test render) */ }
  return null;
}

export function EntryCard({ pick, urlCode }: { pick: GameKind; urlCode: string }) {
  const t = useT();
  const E = t.entry;
  const me = useStore((s) => s.me);
  const setProfile = useStore((s) => s.setProfile);
  const openAccount = useStore((s) => s.openAccount);
  const mySkin = useStore((s) => s.me.skin);
  const hostRoom = useStore((s) => s.hostRoom);
  const joinRoom = useStore((s) => s.joinRoom);
  const playSolo = useStore((s) => s.playSolo);
  const resumeTable = useStore((s) => s.resumeTable);
  const account = useAccount((s) => s.account);

  const [name, setName] = useState(me.name);
  const [token, setToken] = useState<TokenId>(me.token);
  const [mode, setMode] = useState<Mode>(urlCode ? 'join' : modeFromUrl() ?? 'host');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [code, setCode] = useState(urlCode);
  const [plusOpen, setPlusOpen] = useState(false);
  const plus = hasPlus(account);
  // Without Plus every piece is classic, whatever was picked before.
  const myFinish = plus ? cleanSkin(mySkin) : 'classic';

  // An invite link opens straight onto Join, with the code already in.
  useEffect(() => { if (urlCode) { setCode(urlCode); setMode('join'); } }, [urlCode]);
  // Signing in names you after your Google account; the field stays yours.
  useEffect(() => { setName(me.name); }, [me.name]);

  const gameName = t.cf.picker[pick].name;
  const publicOk = pick === 'monopoly';
  // Only Bazaar Barons tables can be listed, so for the others the choice is made.
  const chosen = publicOk ? visibility : 'private';
  const listed = chosen === 'public';

  const nameOk = name.trim().length > 0;
  const commit = () => setProfile(name, token);
  const go = (fn: () => void) => { if (!nameOk) return; commit(); fn(); };

  const tabsId = useId();

  return (
    <div className="entry">
      {/* ------------------------------ you ----------------------------- */}
      <section className="entry__you" aria-label={E.you}>
        {account ? (
          <div className="whoami">
            {account.profile?.picture ? (
              <img
                className="whoami__pic"
                src={account.profile.picture}
                alt=""
                width={40}
                height={40}
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="whoami__pic whoami__pic--initial" aria-hidden>
                {(account.profile?.name || account.name).charAt(0).toUpperCase()}
              </span>
            )}
            <span className="whoami__text">
              <span className="whoami__name truncate">{account.profile?.name || account.name}</span>
              {account.profile?.email && <span className="whoami__email truncate">{account.profile.email}</span>}
            </span>
            {hasPlus(account) ? (
              <PlusBadge />
            ) : (
              <button type="button" className="whoami__plusHint" onClick={openAccount}>
                {t.account.plus.badge}
              </button>
            )}
            <button type="button" className="btn btn--ghost btn--sm" onClick={openAccount}>
              {t.account.page.title}
            </button>
          </div>
        ) : (
          <GoogleSignIn />
        )}

        {!account && <div className="entry__or"><span>{E.orGuest}</span></div>}

        <div className="entry__identity">
          <label className="labelled entry__name">
            <span className="switch__label">{t.home.nameLabel}</span>
            <input
              className="field"
              value={name}
              maxLength={18}
              placeholder={t.home.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              autoComplete="nickname"
            />
          </label>
          <div className="labelled">
            <span className="switch__label">
              {t.home.piece}
              <span className="entry__pieceName"> · {t.tokens[token]}</span>
            </span>
            <div className="pieceRow" role="radiogroup" aria-label={t.home.pieceAria}>
              {TOKENS.map((tk) => (
                <button
                  key={tk.id}
                  type="button"
                  role="radio"
                  aria-checked={token === tk.id}
                  aria-label={t.tokens[tk.id]}
                  title={t.tokens[tk.id]}
                  className="pieceRow__item"
                  data-on={token === tk.id || undefined}
                  onClick={() => { setToken(tk.id); setProfile(name, tk.id); }}
                >
                  <Avatar color="#e8b448" token={tk.id} size={26} finish={myFinish} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ----------------------------- modes ---------------------------- */}
      <div className="modeTabs" role="tablist" aria-label={E.howAria}>
        {(['host', 'join', 'practice'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            id={`${tabsId}-${m}`}
            aria-selected={mode === m}
            aria-controls={`${tabsId}-${m}-panel`}
            className="modeTabs__tab"
            data-on={mode === m || undefined}
            onClick={() => setMode(m)}
          >
            <ModeIcon mode={m} />
            <span>{E.tabs[m]}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="popLayout" initial={false}>
        <motion.section
          key={mode}
          role="tabpanel"
          id={`${tabsId}-${mode}-panel`}
          aria-labelledby={`${tabsId}-${mode}`}
          className="modePanel"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          {mode === 'host' && (
            <>
              <span className="switch__label">{E.host.who}</span>
              <div className="visibility" role="radiogroup" aria-label={E.host.who}>
                {(['private', 'public'] as const).map((v) => {
                  const disabled = v === 'public' && !publicOk;
                  const [label, hint] = E.host[v];
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={chosen === v}
                      disabled={disabled}
                      className="visibility__option"
                      data-on={chosen === v || undefined}
                      onClick={() => setVisibility(v)}
                    >
                      <span className="visibility__head">
                        <VisibilityIcon kind={v} />
                        <span className="visibility__label">{label}</span>
                        <span className="visibility__dot" aria-hidden />
                      </span>
                      <span className="visibility__hint">{disabled ? (pick === 'mafia' ? t.maf.setup.publicSoon : E.host.publicCashflow) : hint}</span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="btn btn--primary btn--block btn--lg"
                disabled={!nameOk}
                onClick={() => go(() => hostRoom(undefined, pick, { listed }))}
              >
                {E.host.create(listed ? 'public' : 'private', gameName)}
              </button>
              <p className="modePanel__under">{nameOk ? E.host.after : E.needName}</p>
            </>
          )}

          {mode === 'join' && (
            <>
              <form
                className="labelled"
                onSubmit={(e) => { e.preventDefault(); if (code.length >= 3) go(() => joinRoom(code)); }}
              >
                <span className="switch__label">{E.join.code}</span>
                <div className="joinRow">
                  <input
                    className="field num joinRow__code"
                    value={code}
                    placeholder="GOLD-FALCON-42"
                    onChange={(e) => setCode(codeFrom(e.target.value))}
                    aria-label={E.join.paste}
                    spellCheck={false}
                    autoCapitalize="characters"
                  />
                  <button type="submit" className="btn btn--primary" disabled={!nameOk || code.length < 3}>
                    {t.common.join}
                  </button>
                </div>
                <span className="modePanel__under modePanel__under--left">
                  {!nameOk ? E.needName : urlCode ? E.join.invited(urlCode) : E.join.codeHint}
                </span>
              </form>
              {account && <YourGames onResume={(code, epoch) => go(() => resumeTable(code, epoch))} />}
              <PublicRooms onJoin={(id) => go(() => joinRoom(id))} />
            </>
          )}

          {mode === 'practice' && (
            <>
              <p className="modePanel__body">{E.practice.body(gameName, pick === 'mafia' ? MAF_MIN_PLAYERS + 1 : 2)}</p>
              <button
                type="button"
                className="btn btn--primary btn--block btn--lg"
                disabled={!nameOk}
                onClick={() => go(() => playSolo(pick))}
              >
                {E.practice.start(gameName)}
              </button>
              {!nameOk && <p className="modePanel__under">{E.needName}</p>}
            </>
          )}
        </motion.section>
      </AnimatePresence>
      <PlusSheet open={plusOpen} onClose={() => setPlusOpen(false)} />
    </div>
  );
}

/** The signed-in player's saved tables, newest first. */
export function YourGames({ onResume, empty }: { onResume: (code: string, epoch: number) => void; empty?: string }) {
  const t = useT();
  const E = t.entry.join;
  const uid = useAccount((s) => s.account?.uid);
  const [tables, setTables] = useState<SavedTable[] | null>(null);

  useEffect(() => {
    let live = true;
    setTables(null);
    void listTables().then((list) => { if (live) setTables(list); });
    return () => { live = false; };
  }, [uid]);

  if (!tables) return null;
  if (tables.length === 0) return empty ? <p className="muted small">{empty}</p> : null;
  const game = (k: SavedTable['kind']) => (k === 'cashflow' ? t.cf.picker.cashflow.name : t.cf.picker.monopoly.name);

  return (
    <section className="rooms yourGames" aria-labelledby="your-games">
      <header className="rooms__head">
        <h2 className="rooms__title" id="your-games">{E.yourGames}</h2>
      </header>
      <p className="rooms__empty">{E.yourGamesHint}</p>
      <ul className="rooms__list">
        {tables.map((g) => {
          const age = Math.max(0, Math.floor(Date.now() / 1000 - g.updatedAt));
          const ago = age < 60 ? t.rooms.justOpened : age < 3600 ? t.rooms.minAgo(Math.floor(age / 60)) : t.rooms.hoursAgo(Math.floor(age / 3600));
          return (
            <li key={g.code} className="roomRow">
              <span className="roomRow__who">
                <span className="roomRow__host num truncate">{g.code}</span>
                <span className="roomRow__meta truncate">
                  {E.savedMeta(game(g.kind), g.round, g.names.join(', '))} · {ago}
                </span>
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => { void forgetTable(g.code); setTables((list) => (list ?? []).filter((x) => x.code !== g.code)); }}
              >
                {E.forget}
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => onResume(g.code, g.epoch)}>
                {E.resume}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function GoogleSignIn() {
  const t = useT();
  const pending = useAccount((s) => s.pending);
  const error = useAccount((s) => s.error);
  const retryCode = useStore((s) => s.retryCode);
  return (
    <div className="entry__signin">
      <button
        type="button"
        className={`btn btn--block googleBtn${retryCode ? ' googleBtn--urgent' : ''}`}
        onClick={signIn}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        <GoogleMark />
        <span>{pending ? t.account.signingIn : retryCode ? t.account.joinAfterSignIn(retryCode) : t.account.signIn}</span>
      </button>
      <p className="entry__note">{error ? t.account.errors[error] : t.entry.signedOutNote}</p>
    </div>
  );
}

/** Google's mark, as its sign-in guidelines ask a Google button to carry. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/* Drawn marks for the three ways in: a table with a chair pulled out, an
   arrow through a door, and a pair of dice. */
function ModeIcon({ mode }: { mode: Mode }) {
  const p = {
    viewBox: '0 0 20 20', width: 18, height: 18, 'aria-hidden': true, fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  if (mode === 'host') {
    return <svg {...p}><path d="M3 8h14M5 8v8M15 8v8M10 3v5" /><path d="M7.5 3h5" /></svg>;
  }
  if (mode === 'join') {
    return <svg {...p}><path d="M11 3h5v14h-5" /><path d="M3 10h9M9 7l3 3-3 3" /></svg>;
  }
  return (
    <svg {...p}>
      <rect x="2.5" y="6.5" width="8" height="8" rx="1.6" transform="rotate(-10 6.5 10.5)" />
      <rect x="9.5" y="4" width="8" height="8" rx="1.6" transform="rotate(12 13.5 8)" />
      <circle cx="6.4" cy="10.6" r=".6" fill="currentColor" />
      <circle cx="12" cy="6.6" r=".6" fill="currentColor" />
      <circle cx="15" cy="9.4" r=".6" fill="currentColor" />
    </svg>
  );
}

function VisibilityIcon({ kind }: { kind: 'private' | 'public' }) {
  const p = {
    viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': true, fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  return kind === 'private' ? (
    <svg {...p}><rect x="4" y="9" width="12" height="8" rx="1.8" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></svg>
  ) : (
    <svg {...p}><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2.2 2.1 2.2 11.9 0 14M10 3c-2.2 2.1-2.2 11.9 0 14" /></svg>
  );
}
