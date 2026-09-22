import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { whisperHandle } from '../../mafia/chat';
import type { MafiaPrivate, MafiaState } from '../../mafia/types';
import type { ChatMessage } from '../../net/protocol';
import type { FeedLine } from '../Panels';

export type ChatBlockReason = 'night' | 'silenced' | 'spent';

/** Why this seat's chat box is closed, from what the seat can see. The host
 *  decides for real (mafia/chat.ts); this only explains it. */
export function myChatBlock(m: MafiaState, myId: string, priv: MafiaPrivate | null): ChatBlockReason | null {
  if (m.phase === 'lobby' || m.phase === 'game_over') return null;
  const p = m.players[myId];
  if (!p) return m.phase === 'night' ? 'night' : null;
  if (!p.alive) return m.lastWords.includes(myId) ? 'spent' : null;
  if (m.phase === 'night' && !(priv && priv.teammates.length > 0)) return 'night';
  if (m.phase === 'day' && m.silencedToday.includes(myId)) return 'silenced';
  return null;
}

/**
 * The table's talk and its log, one tab each. The chat is the Mafia app's:
 * the family's night channel in red, whispers marked for the two who share
 * them, the dead's last word set apart.
 */
export function MafiaFeed({
  m, myId, priv, chat, lines, onSend,
}: {
  m: MafiaState;
  myId: string;
  priv: MafiaPrivate | null;
  chat: ChatMessage[];
  lines: FeedLine[];
  onSend: (text: string) => void;
}) {
  const t = useT();
  const C = t.maf.chat;
  const [tab, setTab] = useState<'chat' | 'log'>('chat');
  const [draft, setDraft] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const block = myChatBlock(m, myId, priv);
  const dead = Boolean(m.players[myId] && !m.players[myId].alive);
  const family = m.phase === 'night' && Boolean(priv && priv.teammates.length > 0);

  // Keep the newest line in view.
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, lines.length, tab]);

  // "@" at the start of the box offers the living, by their handle.
  const suggestions = useMemo(() => {
    if (!draft.startsWith('@') || draft.includes(' ') || m.phase === 'night') return [];
    const q = draft.slice(1).toLowerCase();
    return m.seats
      .filter((id) => id !== myId && m.players[id].alive)
      .map((id) => whisperHandle(m.players[id].name))
      .filter((h) => h.toLowerCase().startsWith(q))
      .slice(0, 6);
  }, [draft, m, myId]);

  const send = () => {
    const text = draft.trim();
    if (!text || block) return;
    onSend(text);
    setDraft('');
  };

  const placeholder = dead ? C.lastWordsPlaceholder : family ? C.familyPlaceholder : C.placeholder;
  const blockText = block === 'night' ? C.nightQuiet : block === 'silenced' ? C.silenced : block === 'spent' ? C.lastWordsUsed : '';

  return (
    <section className="mfFeed" aria-label={C.aria}>
      <header className="tabs mfFeed__tabs" role="tablist">
        {(['chat', 'log'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className="tabs__item"
            data-on={tab === k || undefined} onClick={() => setTab(k)}>
            {t.maf.table.tabs[k]}
          </button>
        ))}
      </header>

      <div className="mfFeed__box" ref={boxRef}>
        {tab === 'log' ? (
          lines.map((l) => (
            <p key={l.id} className="mfLog" data-tone={l.tone} style={l.color ? { borderLeftColor: l.color } : undefined}>{l.text}</p>
          ))
        ) : chat.length === 0 ? (
          <p className="muted small mfFeed__empty">{C.empty}</p>
        ) : (
          chat.map((c) => {
            const mine = c.from === myId;
            const tag = c.channel === 'family' ? C.familyTag
              : c.channel === 'last' ? C.lastWordsTag
                : c.channel === 'whisper' ? (mine ? C.whisperTo(c.toName ?? '') : C.whisperFrom(c.name))
                  : null;
            return (
              <p key={c.id} className="mfMsg" data-channel={c.channel} data-mine={mine || undefined}>
                {tag && <span className="mfMsg__tag">{tag}</span>}
                <span className="mfMsg__name" style={{ color: c.color }}>{c.name}</span>
                <span className="mfMsg__text">{c.text}</span>
              </p>
            );
          })
        )}
      </div>

      {tab === 'chat' && (
        <form className="mfFeed__form" onSubmit={(e) => { e.preventDefault(); send(); }}>
          {suggestions.length > 0 && (
            <ul className="mfMention">
              {suggestions.map((h) => (
                <li key={h}>
                  <button type="button" onClick={() => setDraft(`@${h} `)}>@{h}</button>
                </li>
              ))}
            </ul>
          )}
          {block ? (
            <p className="muted small mfFeed__closed">{blockText}</p>
          ) : (
            <>
              <input
                className="field mfFeed__input"
                value={draft}
                maxLength={220}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={placeholder}
                data-channel={dead ? 'last' : family ? 'family' : undefined}
                aria-label={placeholder}
              />
              <button type="submit" className="btn btn--sm" disabled={!draft.trim()}>{C.send}</button>
            </>
          )}
        </form>
      )}
    </section>
  );
}
