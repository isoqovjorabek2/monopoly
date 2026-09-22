/* ------------------------------------------------------------------ *
 * Omertà's sound, as the Mafia app plays it: the original tracks, a
 * loop per phase faded in and out, and one-shot effects. One switch
 * silences both, and it is remembered. Everything fails quietly - a
 * blocked autoplay or a missing file never touches the game.
 * ------------------------------------------------------------------ */

export const TRACKS = {
  lobby: 'lobby.mp3',
  night: 'night.mp3',
  day: 'day.mp3',
  voting: 'voting.mp3',
  elim: 'elim.mp3',
  reveal: 'reveal.mp3',
  notif: 'notif.mp3',
  click: 'click.mp3',
  defeat: 'defeat.mp3',
  victory: 'Victory.mp3',
  chatNotif: 'ChatNotification.mp3',
} as const;

const url = (track: string): string => `${import.meta.env.BASE_URL}audio/mafia/${track}`;

const AUDIO_KEY = 'mply.mafAudio';
let audioEnabled = (() => {
  try { return localStorage.getItem(AUDIO_KEY) !== '0'; } catch { return true; }
})();

const listeners = new Set<(on: boolean) => void>();

export function isAudioEnabled(): boolean {
  return audioEnabled;
}

/** Enable or silence all of Omertà's sound, and remember it. */
export function setAudioEnabled(enabled: boolean): void {
  audioEnabled = enabled;
  try { localStorage.setItem(AUDIO_KEY, enabled ? '1' : '0'); } catch { /* private mode */ }
  if (!enabled) stopAmbient();
  listeners.forEach((fn) => fn(enabled));
}

export function onAudioChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

let ambientEl: HTMLAudioElement | null = null;
let currentTrack: string | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;

function fadeOut(el: HTMLAudioElement): void {
  let v = el.volume;
  const out = setInterval(() => {
    v = Math.max(v - 0.03, 0);
    el.volume = v;
    if (v <= 0) { el.pause(); clearInterval(out); }
  }, 40);
}

export function playAmbient(track: string, targetVolume = 0.3): void {
  if (!audioEnabled) return;
  if (currentTrack === track && ambientEl && !ambientEl.paused) return;
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
  if (ambientEl) fadeOut(ambientEl);

  currentTrack = track;
  try {
    const audio = new Audio(url(track));
    audio.loop = true;
    audio.volume = 0;
    ambientEl = audio;
    const start = () => {
      let v = 0;
      fadeTimer = setInterval(() => {
        v = Math.min(v + 0.02, targetVolume);
        audio.volume = v;
        if (v >= targetVolume && fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
      }, 50);
    };
    audio.play().then(start).catch(() => {
      // Autoplay was refused: the first tap anywhere lets the music in.
      window.addEventListener('pointerdown', () => {
        if (ambientEl === audio) audio.play().then(start).catch(() => {});
      }, { once: true });
    });
  } catch { /* no audio here */ }
}

export function stopAmbient(): void {
  if (!ambientEl) return;
  if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; }
  const el = ambientEl;
  ambientEl = null;
  currentTrack = null;
  fadeOut(el);
}

export function playSFX(track: string, volume = 0.55): void {
  if (!audioEnabled) return;
  try {
    const audio = new Audio(url(track));
    audio.volume = volume;
    void audio.play().catch(() => {});
  } catch { /* no audio here */ }
}
