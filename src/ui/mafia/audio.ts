/* ------------------------------------------------------------------ *
 * Omertà's score: a loop for each phase, and a handful of stings. The
 * tracks are the Mafia app's, re-encoded small; they stream lazily from
 * /audio/mafia/ and the service worker keeps them once heard. Everything
 * here fails quietly - a blocked autoplay or a missing file never
 * touches the game.
 * ------------------------------------------------------------------ */

export type MafTrack = 'lobby' | 'night' | 'day' | 'voting';
export type MafSting = 'elim' | 'reveal' | 'victory' | 'defeat' | 'notif';

const url = (name: string): string => `${import.meta.env.BASE_URL}audio/mafia/${name}.mp3`;

const MUSIC_KEY = 'mply.mafMusic';
const MUSIC_VOLUME = 0.28;
const FADE_MS = 900;

let current: { track: MafTrack; el: HTMLAudioElement } | null = null;

export function readMusicOn(): boolean {
  try { return localStorage.getItem(MUSIC_KEY) !== 'off'; } catch { return true; }
}

export function saveMusicOn(on: boolean): void {
  try { localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
}

function fade(el: HTMLAudioElement, to: number, then?: () => void): void {
  const from = el.volume;
  const start = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / FADE_MS);
    el.volume = from + (to - from) * k;
    if (k < 1) requestAnimationFrame(step);
    else then?.();
  };
  requestAnimationFrame(step);
}

/** Crossfade to a phase's loop; null lets the music die away. */
export function playTrack(track: MafTrack | null): void {
  if (current?.track === track) return;
  const old = current;
  current = null;
  if (old) fade(old.el, 0, () => old.el.pause());
  if (!track) return;
  try {
    const el = new Audio(url(track));
    el.loop = true;
    el.volume = 0;
    current = { track, el };
    void el.play().then(() => fade(el, MUSIC_VOLUME)).catch(() => {
      // Autoplay was refused: the first tap anywhere lets it in.
      const retry = () => {
        if (current?.el === el) void el.play().then(() => fade(el, MUSIC_VOLUME)).catch(() => {});
      };
      window.addEventListener('pointerdown', retry, { once: true });
    });
  } catch { /* no audio here */ }
}

export function playSting(name: MafSting, volume = 0.6): void {
  try {
    const el = new Audio(url(name));
    el.volume = volume;
    void el.play().catch(() => {});
  } catch { /* no audio here */ }
}
