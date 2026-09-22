import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageCircle, Send } from 'lucide-react';
import { useT } from '../../i18n';
import { whisperHandle } from '../../mafia/chat';
import { playSFX, TRACKS } from './audio';
import { AvatarImg } from './Hud';
import type { ViewPlayer } from './model';

const mono = "'JetBrains Mono', monospace";
const cinzel = "'Cinzel', serif";
const crimson = "'Crimson Text', serif";

/** One line in the table's talk, in the app's shape. */
export interface ChatItem {
  id: string;
  at: number;
  type: 'player' | 'system' | 'mafia' | 'last_words';
  playerId: string;
  username: string;
  avatar: string;
  content: string;
  /** A private line: a whisper between two, or a note only this seat sees. */
  isWhisper?: boolean;
  whisperTargetName?: string;
}

function ChatBubble({ msg, isMe }: { msg: ChatItem; isMe: boolean }) {
  const t = useT();
  const C = t.maf.ui.chat;
  const isSystem = msg.type === 'system';
  const isMafia = msg.type === 'mafia';

  if (isSystem && msg.isWhisper) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="tw:text-center tw:py-1">
        <span className="tw:text-xs tw:px-3 tw:py-1.5 tw:rounded-lg tw:inline-block tw:text-left tw:max-w-[90%]"
          style={{ background: 'rgba(142,68,173,0.15)', border: '1px solid rgba(142,68,173,0.4)', color: '#c39bd3', fontFamily: mono }}>
          🔒 {msg.avatar} {msg.content}
        </span>
      </motion.div>
    );
  }

  if (isSystem) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="tw:text-center tw:py-1">
        <span className="tw:text-xs tw:px-3 tw:py-1 tw:rounded-full tw:inline-block tw:max-w-[95%]"
          style={{ background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.2)', color: '#f1c40f', fontFamily: mono }}>
          {msg.avatar} {msg.content}
        </span>
      </motion.div>
    );
  }

  if (msg.type === 'last_words') {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="tw:text-center tw:py-2">
        <div className="tw:inline-flex tw:flex-col tw:items-center tw:gap-1 tw:px-4 tw:py-2 tw:rounded-lg tw:max-w-[90%]"
          style={{ background: 'rgba(20,15,5,0.7)', border: '1px solid rgba(255,215,0,0.35)', boxShadow: '0 0 16px rgba(255,215,0,0.08)' }}>
          <span className="tw:text-[10px] tw:tracking-widest" style={{ color: 'rgba(255,215,0,0.5)', fontFamily: mono }}>
            {C.lastWordsTag(msg.username)}
          </span>
          <p className="tw:text-sm tw:leading-relaxed" style={{ color: 'rgba(255,235,180,0.85)', fontFamily: crimson, fontStyle: 'italic', fontSize: '0.95rem' }}>
            “{msg.content}”
          </p>
        </div>
      </motion.div>
    );
  }

  if (msg.isWhisper) {
    return (
      <motion.div initial={{ opacity: 0, y: 8, x: isMe ? 8 : -8 }} animate={{ opacity: 1, y: 0, x: 0 }}
        className={`tw:flex tw:gap-2 ${isMe ? 'tw:flex-row-reverse' : 'tw:flex-row'}`}>
        <div className="tw:w-7 tw:h-7 tw:rounded-full tw:flex-shrink-0 tw:mt-1 tw:overflow-hidden"
          style={{ border: '1px solid rgba(142,68,173,0.5)', background: 'rgba(142,68,173,0.15)' }}>
          <AvatarImg avatar={msg.avatar} size={28} />
        </div>
        <div className={`tw:flex tw:flex-col tw:gap-0.5 tw:max-w-[75%] ${isMe ? 'tw:items-end' : 'tw:items-start'}`}>
          <span className="tw:text-[10px]" style={{ color: '#9b59b6', fontFamily: mono }}>
            {isMe ? C.dmTo(msg.whisperTargetName ?? '') : C.dmFrom(msg.username)}
          </span>
          <div className="tw:px-3 tw:py-2 tw:rounded-lg tw:text-sm tw:leading-relaxed"
            style={{ background: 'rgba(142,68,173,0.18)', border: '1px solid rgba(142,68,173,0.45)', color: '#d7bde2', fontFamily: crimson, fontSize: '0.9rem' }}>
            {msg.content}
          </div>
        </div>
      </motion.div>
    );
  }

  const bubbleBg = isMe
    ? isMafia ? 'linear-gradient(135deg, rgba(192,57,43,0.45), rgba(142,30,30,0.35))' : 'linear-gradient(135deg, rgba(192,57,43,0.25), rgba(142,68,173,0.2))'
    : isMafia ? 'rgba(140,20,20,0.35)' : 'rgba(26,26,46,0.8)';
  const bubbleBorder = isMe
    ? isMafia ? '1px solid rgba(231,76,60,0.5)' : '1px solid rgba(192,57,43,0.3)'
    : isMafia ? '1px solid rgba(192,57,43,0.35)' : '1px solid rgba(255,215,0,0.08)';

  return (
    <motion.div initial={{ opacity: 0, y: 8, x: isMe ? 8 : -8 }} animate={{ opacity: 1, y: 0, x: 0 }}
      className={`tw:flex tw:gap-2 ${isMe ? 'tw:flex-row-reverse' : 'tw:flex-row'}`}>
      <div className="tw:w-7 tw:h-7 tw:rounded-full tw:flex tw:items-center tw:justify-center tw:flex-shrink-0 tw:mt-1 tw:overflow-hidden"
        style={{
          background: isMafia ? 'rgba(192,57,43,0.25)' : 'rgba(26,26,46,0.8)',
          border: isMafia ? '1px solid rgba(231,76,60,0.4)' : '1px solid rgba(255,215,0,0.1)',
        }}>
        <AvatarImg avatar={msg.avatar} size={28} />
      </div>
      <div className={`tw:flex tw:flex-col tw:gap-0.5 tw:max-w-[75%] ${isMe ? 'tw:items-end' : 'tw:items-start'}`}>
        <span className="tw:text-[11px] tw:text-[#8888aa]" style={{ fontFamily: mono }}>
          {isMafia ? '🔫 ' : ''}{msg.username}
        </span>
        <div className="tw:px-3 tw:py-2 tw:rounded-lg tw:text-sm tw:leading-relaxed tw:break-words"
          style={{
            background: bubbleBg, border: bubbleBorder,
            color: isMafia ? 'rgba(255,200,200,0.92)' : '#e8e8f0',
            fontFamily: crimson, fontSize: '0.9rem',
          }}>
          {msg.content}
        </div>
      </div>
    </motion.div>
  );
}

export function ChatPanel({
  items, players, myPlayerId, phase, isDead, lastWordsUsed, isSilenced, isFamily, onSend,
}: {
  items: ChatItem[];
  players: ViewPlayer[];
  myPlayerId: string;
  phase: string;
  isDead: boolean;
  lastWordsUsed: boolean;
  isSilenced: boolean;
  isFamily: boolean;
  onSend: (text: string) => void;
}) {
  const t = useT();
  const C = t.maf.ui.chat;
  const [input, setInput] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const running = phase !== 'lobby' && phase !== 'game_over';
  const isNight = phase === 'night';
  const nightSilent = running && isNight && !isFamily && !isDead;
  const canSpeakLastWords = running && isDead && !lastWordsUsed;
  const canChat = !isSilenced && !nightSilent && (!isDead || !running);

  const prevCount = useRef(items.length);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const last = items[items.length - 1];
    if (items.length > prevCount.current && last && last.playerId !== myPlayerId && last.type !== 'system') {
      playSFX(TRACKS.chatNotif, 0.4);
    }
    prevCount.current = items.length;
  }, [items, myPlayerId]);

  const onChange = (val: string) => {
    setInput(val);
    if (val.startsWith('@') && !val.includes(' ') && !isNight) {
      const partial = val.slice(1).toLowerCase();
      setMentions(players
        .filter((p) => p.status === 'alive' && p.id !== myPlayerId)
        .map((p) => whisperHandle(p.username))
        .filter((h) => h.toLowerCase().startsWith(partial))
        .slice(0, 5));
    } else {
      setMentions([]);
    }
  };

  const send = () => {
    const msg = input.trim();
    if (!msg) return;
    if (!canSpeakLastWords && !canChat) return;
    onSend(msg);
    setInput('');
    setMentions([]);
  };

  const headerLabel = isDead && running ? C.deadTitle : isNight && isFamily ? C.mafiaTitle : C.title;
  const headerColor = isNight && isFamily ? '#e74c3c' : '#f1c40f';

  return (
    <div className="tw:flex tw:flex-col tw:h-full" style={{ maxHeight: '100%' }}>
      <div className="tw:flex tw:items-center tw:gap-2 tw:px-4 tw:py-3 tw:border-b"
        style={{ borderColor: 'rgba(255,215,0,0.08)', background: isNight && isFamily ? 'linear-gradient(90deg, rgba(192,57,43,0.18), transparent)' : undefined }}>
        <MessageCircle size={14} style={{ color: headerColor }} />
        <h3 className="tw:text-xs tw:font-bold tw:flex-1" style={{ fontFamily: cinzel, color: headerColor }}>{headerLabel}</h3>
        {isSilenced && (
          <span className="tw:text-xs tw:text-[#8e44ad] tw:px-2 tw:py-0.5 tw:rounded" style={{ background: 'rgba(142,68,173,0.2)', fontFamily: mono }}>
            {C.silenced}
          </span>
        )}
        {isNight && isFamily && (
          <span className="tw:text-[10px] tw:px-2 tw:py-0.5 tw:rounded"
            style={{ background: 'rgba(192,57,43,0.2)', border: '1px solid rgba(192,57,43,0.35)', color: '#e74c3c', fontFamily: mono, letterSpacing: '0.05em' }}>
            {C.private}
          </span>
        )}
      </div>

      <div className="tw:flex-1 tw:overflow-y-auto tw:px-3 tw:py-3 tw:space-y-2 tw:min-h-0">
        {items.length === 0 && !nightSilent && (
          <div className="tw:text-center tw:py-8">
            <p className="tw:text-xs tw:text-[#555]" style={{ fontFamily: mono }}>{C.empty}</p>
          </div>
        )}
        {nightSilent && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="tw:flex tw:flex-col tw:items-center tw:justify-center tw:py-8 tw:gap-3">
            <div className="tw:text-4xl">🌙</div>
            <p className="tw:text-xs tw:text-center tw:text-[#8888aa] tw:max-w-[180px]" style={{ fontFamily: crimson, fontStyle: 'italic', lineHeight: 1.6 }}>
              {C.nightSilent}
            </p>
            <div className="tw:text-[10px] tw:text-[#555] tw:text-center tw:mt-1" style={{ fontFamily: mono }}>{C.nightSub}</div>
          </motion.div>
        )}
        <AnimatePresence initial={false}>
          {items.map((msg) => <ChatBubble key={msg.id} msg={msg} isMe={msg.playerId === myPlayerId} />)}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      <div className="tw:px-3 tw:py-3 tw:border-t tw:relative" style={{ borderColor: isNight && isFamily ? 'rgba(192,57,43,0.2)' : 'rgba(255,215,0,0.08)' }}>
        <AnimatePresence>
          {mentions.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
              className="tw:absolute tw:bottom-full tw:left-3 tw:right-3 tw:mb-1 tw:rounded-lg tw:overflow-hidden tw:z-20"
              style={{ background: 'rgba(12,12,22,0.98)', border: '1px solid rgba(142,68,173,0.5)', boxShadow: '0 -4px 20px rgba(0,0,0,0.5)' }}>
              <div className="tw:px-2 tw:py-1 tw:border-b" style={{ borderColor: 'rgba(142,68,173,0.2)' }}>
                <span className="tw:text-[10px] tw:tracking-widest" style={{ color: '#9b59b6', fontFamily: mono }}>{C.dmHeader}</span>
              </div>
              {mentions.map((handle) => {
                const p = players.find((pl) => whisperHandle(pl.username) === handle);
                return (
                  <button
                    key={handle}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); setInput(`@${handle} `); setMentions([]); inputRef.current?.focus(); }}
                    className="tw:w-full tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:text-left tw:hover:bg-[rgba(142,68,173,0.2)]"
                  >
                    {p && <AvatarImg avatar={p.avatar} size={22} style={{ borderRadius: '50%' }} />}
                    <span style={{ fontFamily: cinzel, fontSize: 12, color: '#e8e8f0', flex: 1 }}>{p?.username ?? handle}</span>
                    <span style={{ fontFamily: mono, fontSize: 9, color: '#9b59b6' }}>{C.dm}</span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {canSpeakLastWords && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="tw:flex tw:flex-col tw:gap-2">
            <p className="tw:text-[10px] tw:text-center tw:tracking-widest" style={{ color: 'rgba(255,215,0,0.45)', fontFamily: mono }}>{C.lastWordsCall}</p>
            <div className="tw:flex tw:gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()}
                maxLength={200}
                placeholder={C.lastWordsPlaceholder}
                aria-label={C.lastWordsPlaceholder}
                className="tw:flex-1 tw:min-w-0 tw:rounded-lg tw:px-3 tw:py-2.5 tw:text-sm tw:text-white tw:focus:outline-none"
                style={{ fontFamily: crimson, fontStyle: 'italic', fontSize: '1rem', background: 'rgba(15,10,5,0.85)', border: '1px solid rgba(255,215,0,0.3)' }}
              />
              <motion.button type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={send} disabled={!input.trim()}
                className="tw:w-11 tw:h-11 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:disabled:opacity-40 tw:flex-shrink-0"
                style={{ background: input.trim() ? 'linear-gradient(135deg, rgba(180,140,20,0.6), rgba(120,90,10,0.5))' : 'rgba(26,26,46,0.6)', border: '1px solid rgba(255,215,0,0.25)' }}
                aria-label={t.maf.chat.send}>
                <Send size={14} className="tw:text-[#f1c40f]" />
              </motion.button>
            </div>
          </motion.div>
        )}

        {running && isDead && lastWordsUsed && (
          <div className="tw:text-center tw:py-2">
            <p className="tw:text-xs tw:text-[#8888aa]" style={{ fontFamily: crimson, fontStyle: 'italic' }}>{C.faded}</p>
          </div>
        )}

        {!canSpeakLastWords && !(running && isDead) && !canChat && (
          <div className="tw:text-center tw:py-2">
            <p className="tw:text-xs tw:text-[#8888aa]" style={{ fontFamily: mono }}>
              {isSilenced ? C.silencedNote : nightSilent ? C.nightNote : ''}
            </p>
          </div>
        )}

        {canChat && (
          <div className="tw:flex tw:gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } if (e.key === 'Escape') setMentions([]); }}
              maxLength={220}
              placeholder={isNight && isFamily ? C.mafiaPlaceholder : C.placeholder}
              aria-label={isNight && isFamily ? C.mafiaPlaceholder : C.placeholder}
              className="tw:flex-1 tw:min-w-0 tw:rounded-lg tw:px-3 tw:py-2.5 tw:text-sm tw:text-white tw:focus:outline-none"
              style={{
                fontFamily: crimson, fontSize: '1rem',
                background: isNight && isFamily ? 'rgba(80,10,10,0.5)' : 'rgba(10,10,15,0.8)',
                border: isNight && isFamily ? '1px solid rgba(192,57,43,0.35)' : '1px solid rgba(255,215,0,0.1)',
              }}
            />
            <motion.button type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={send} disabled={!input.trim()}
              className="tw:w-11 tw:h-11 tw:rounded-lg tw:flex tw:items-center tw:justify-center tw:disabled:opacity-40 tw:flex-shrink-0"
              style={{
                background: input.trim()
                  ? isNight && isFamily ? 'linear-gradient(135deg, #c0392b, #922b21)' : 'linear-gradient(135deg, #c0392b, #8e44ad)'
                  : 'rgba(26,26,46,0.6)',
                border: isNight && isFamily ? '1px solid rgba(192,57,43,0.4)' : '1px solid rgba(255,215,0,0.1)',
              }}
              aria-label={t.maf.chat.send}>
              <Send size={14} className="tw:text-white" />
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );
}
