import { useEffect, useState } from 'react';
import { hasPlus, useAccount } from './account';

/* ------------------------------------------------------------------ *
 * Advertising, through AdinPlay.
 *
 * Three kinds, all optional and all switched off for a Plus player:
 *   - display banners on the front door and in the lobby;
 *   - a video between games, when a player walks away from the result;
 *   - a rewarded video the host can choose to watch, which opens the
 *     Plus boards for the table's next game.
 *
 * The network's tag is loaded only when an ad is actually wanted, so a
 * Plus player, or a build with no publisher configured, never fetches a
 * byte of it. Everything here fails closed: no tag, a blocker, an empty
 * auction - the game carries on as if ads did not exist.
 * ------------------------------------------------------------------ */

const PUB = import.meta.env.VITE_ADINPLAY_PUB || '';
const SITE = import.meta.env.VITE_ADINPLAY_SITE || '';

/** Whether this build was given a publisher to show ads for. */
export const adsConfigured = (): boolean => Boolean(PUB && SITE);

/** Banner placements, as AdinPlay names them: `<site>_<size>` unless the
 *  build overrides one. */
export type BannerSlot = 'home' | 'lobby';

const SLOT_ID: Record<BannerSlot, string> = {
  home: import.meta.env.VITE_ADINPLAY_SLOT_HOME || `${SITE}_300x250`,
  lobby: import.meta.env.VITE_ADINPLAY_SLOT_LOBBY || `${SITE}_728x90`,
};

export const bannerSlotId = (slot: BannerSlot): string => SLOT_ID[slot];

/* ------------------------------ the tag ------------------------------ */

/** How AdinPlay's player reports the end of a video. */
type AipState =
  | 'timeout' | 'empty' | 'unsupported' | 'error' | 'manual_canceled'
  | 'user_canceled' | 'closed' | 'released' | 'viewed' | 'granted';

interface AipPlayer {
  startVideoAd(): void;
  startRewardedAd(options?: { preload?: boolean; showLoading?: boolean }): void;
}

interface AipTag {
  cmd: { display: (() => void)[]; player: (() => void)[] };
  adplayer?: AipPlayer;
  consented?: boolean;
}

declare global {
  interface Window {
    aiptag?: AipTag;
    aipDisplayTag?: { display(id: string): void; destroy(id: string): void };
    aipPlayer?: new (options: Record<string, unknown>) => AipPlayer;
  }
}

/** Whoever is waiting on the video that is playing now. One at a time. */
let settle: ((s: AipState) => void) | null = null;
let granted = false;

let loading: Promise<boolean> | null = null;

function loadTag(): Promise<boolean> {
  if (!adsConfigured()) return Promise.resolve(false);
  if (loading) return loading;
  const tag: AipTag = window.aiptag ?? { cmd: { display: [], player: [] } };
  tag.cmd = tag.cmd ?? { display: [], player: [] };
  tag.cmd.display = tag.cmd.display ?? [];
  tag.cmd.player = tag.cmd.player ?? [];
  window.aiptag = tag;
  // The player is made once, and routes every outcome to whoever asked.
  tag.cmd.player.push(() => {
    if (!window.aipPlayer) return;
    tag.adplayer = new window.aipPlayer({
      AD_WIDTH: 960,
      AD_HEIGHT: 540,
      AD_DISPLAY: 'fullscreen',
      LOADING_TEXT: 'loading advertisement',
      PREROLL_ELEM: () => document.getElementById('aip-preroll'),
      AIP_REWARDEDGRANTED: () => { granted = true; },
      AIP_REWARDEDCOMPLETE: (state: AipState) => finish(granted ? 'granted' : state),
      AIP_COMPLETE: (state: AipState) => finish(state),
      AIP_REMOVE: () => { /* the network tidies its own overlay */ },
    });
  });
  loading = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = `https://api.adinplay.com/libs/aiptag/pub/${PUB}/${SITE}/tag.min.js`;
    script.async = true;
    script.onload = () => resolve(true);
    // A blocker, or no network: forget the attempt so a later one may retry.
    script.onerror = () => { loading = null; resolve(false); };
    document.head.appendChild(script);
  });
  return loading;
}

function finish(state: AipState): void {
  const fn = settle;
  settle = null;
  granted = false;
  fn?.(state);
}

/* ------------------------------ banners ------------------------------ */

/** Fill a banner container that is already in the page. Returns the undo. */
export function showBanner(slot: BannerSlot): () => void {
  const id = SLOT_ID[slot];
  let live = true;
  void loadTag().then((ok) => {
    if (!ok || !live) return;
    window.aiptag?.cmd.display.push(() => { if (live) window.aipDisplayTag?.display(id); });
  });
  return () => {
    live = false;
    try { window.aipDisplayTag?.destroy(id); } catch { /* already gone */ }
  };
}

/* ------------------------------- videos ------------------------------ */

/** What a video came to. `unavailable` covers blockers, no fill and errors. */
export type VideoResult = 'granted' | 'watched' | 'skipped' | 'unavailable';

// A video never holds the game hostage: past this, whatever the network is
// doing, the caller gets its answer and moves on.
const VIDEO_TIMEOUT_MS = 90_000;

function playVideo(rewarded: boolean): Promise<VideoResult> {
  if (settle) return Promise.resolve('unavailable');
  return new Promise((resolve) => {
    let done = false;
    const answer = (r: VideoResult) => { if (!done) { done = true; resolve(r); } };
    const timer = window.setTimeout(() => { settle = null; answer('unavailable'); }, VIDEO_TIMEOUT_MS);
    settle = (state) => {
      window.clearTimeout(timer);
      if (state === 'granted') answer('granted');
      else if (state === 'viewed' || state === 'closed' || state === 'released') answer(rewarded ? 'skipped' : 'watched');
      else if (state === 'user_canceled' || state === 'manual_canceled') answer('skipped');
      else answer('unavailable');
    };
    void loadTag().then((ok) => {
      if (!ok) { window.clearTimeout(timer); settle = null; answer('unavailable'); return; }
      window.aiptag?.cmd.player.push(() => {
        const player = window.aiptag?.adplayer;
        if (!player) { finish('unsupported'); return; }
        granted = false;
        if (rewarded) player.startRewardedAd({ preload: false, showLoading: true });
        else player.startVideoAd();
      });
    });
  });
}

/**
 * A video between games. Capped, so a player who plays short games back to
 * back sees one every few minutes rather than one every result.
 */
const BREAK_GAP_MS = 4 * 60_000;
let lastBreak = 0;

export async function playBreak(): Promise<void> {
  if (!adsConfigured() || Date.now() - lastBreak < BREAK_GAP_MS) return;
  lastBreak = Date.now();
  await playVideo(false);
}

/** A video the player chose to watch for a reward; `granted` when earned. */
export async function playRewarded(): Promise<VideoResult> {
  if (!adsConfigured()) return 'unavailable';
  const r = await playVideo(true);
  // A break straight after a rewarded video would feel like a trick.
  if (r === 'granted') lastBreak = Date.now();
  return r;
}

/* ----------------------------- who sees them ------------------------- */

/** Whether this player should see ads: a configured build, and no Plus. */
export function useShowAds(): boolean {
  const account = useAccount((s) => s.account);
  // Plus lapses on the clock, not on an event; a minute is fine-grained enough.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return adsConfigured() && !hasPlus(account);
}
