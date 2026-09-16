import { useState } from 'react';
import { create } from 'zustand';
import { registerSW } from 'virtual:pwa-register';
import { useT } from '../i18n';
import { Modal } from './bits';

/* ------------------------------------------------------------------ *
 * The installed-app layer: service-worker updates, and the install
 * prompt.
 *
 * Two rules follow from the game living in the host's tab:
 *
 * - Nothing may reload the page on its own. A new service worker waits
 *   until the player taps "refresh" - a forced reload mid-game would
 *   take the whole table's state with it.
 * - The install prompt is captured, never auto-shown. The browser's own
 *   mini-infobar is a distraction; the front door offers install when
 *   the player is actually looking at it.
 * ------------------------------------------------------------------ */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let applyUpdate: (reload?: boolean) => Promise<void> = async () => {};

interface PwaState {
  /** A new service worker is waiting; the update toast is showing. */
  updateReady: boolean;
  dismissUpdate: () => void;
  /** The browser has offered an install prompt we can open on demand. */
  canInstall: boolean;
  /** Installed (or running standalone) - the front door stays quiet. */
  installed: boolean;
  promptInstall: () => Promise<boolean>;
}

export const isStandalone = (): boolean => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || Boolean((navigator as { standalone?: boolean }).standalone);
  } catch {
    return false;
  }
};

/** iPhone and iPad, where there is no install prompt event to capture. */
export const isIos = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export const usePwa = create<PwaState>((set) => ({
  updateReady: false,
  dismissUpdate: () => set({ updateReady: false }),
  canInstall: false,
  installed: isStandalone(),
  promptInstall: async () => {
    if (!deferredPrompt) return false;
    const e = deferredPrompt;
    deferredPrompt = null;
    set({ canInstall: false });
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === 'accepted') set({ installed: true });
    return outcome === 'accepted';
  },
}));

/* These two listeners have to be in place before the events fire, which can
 * be earlier than the first render - so they live at module scope. */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    usePwa.setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    usePwa.setState({ installed: true, canInstall: false });
  });
}

/**
 * Register the service worker (production builds only). A fresh worker
 * becomes `updateReady`; applying it is the player's call, per above.
 */
export function initPwa(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  applyUpdate = registerSW({
    onNeedRefresh() {
      usePwa.setState({ updateReady: true });
    },
    onOfflineReady() {
      // The shell is cached: practice mode now works with no network at all.
    },
  });
}

/** Reload onto the waiting worker. Only ever called from the toast. */
function applyPendingUpdate(): void {
  usePwa.setState({ updateReady: false });
  void applyUpdate(true);
}

/* ------------------------------------------------------------------ *
 * The two visible pieces of the layer:
 *
 *  UpdateToast - a new version is waiting. It says so and offers to
 *  apply it, and otherwise sits quietly at the bottom of the screen.
 *
 *  InstallRow - the front door's "install" offer. On browsers that fire
 *  beforeinstallprompt it opens the real prompt; on iOS it shows the
 *  three steps, because that is the only way in there.
 * ------------------------------------------------------------------ */

export function UpdateToast() {
  const t = useT();
  const updateReady = usePwa((s) => s.updateReady);
  const dismissUpdate = usePwa((s) => s.dismissUpdate);
  if (!updateReady) return null;
  return (
    <div className="pwaToast" role="status">
      <span className="pwaToast__text">{t.pwa.update}</span>
      <button type="button" className="btn btn--ghost btn--sm" onClick={dismissUpdate}>
        {t.pwa.later}
      </button>
      <button type="button" className="btn btn--primary btn--sm" onClick={applyPendingUpdate}>
        {t.pwa.refresh}
      </button>
    </div>
  );
}

export function InstallRow() {
  const t = useT();
  const canInstall = usePwa((s) => s.canInstall);
  const installed = usePwa((s) => s.installed);
  const promptInstall = usePwa((s) => s.promptInstall);
  const [iosOpen, setIosOpen] = useState(false);

  // Nothing to offer: already installed, or a browser with no install path
  // at all (desktop Firefox, say). The row simply does not appear.
  if (installed || (!canInstall && !isIos())) return null;

  return (
    <div className="installRow">
      <button
        type="button"
        className="installRow__btn"
        onClick={() => { if (canInstall) void promptInstall(); else setIosOpen(true); }}
      >
        <InstallMark />
        <span className="installRow__text">
          <span className="installRow__title">{t.pwa.install}</span>
          <span className="installRow__hint">{t.pwa.installHint}</span>
        </span>
      </button>
      <Modal open={iosOpen} onClose={() => setIosOpen(false)} title={t.pwa.iosTitle}>
        <ol className="installSteps">
          {t.pwa.iosSteps.map((step) => <li key={step}>{step}</li>)}
        </ol>
        <p className="muted small">{t.pwa.iosNote}</p>
      </Modal>
    </div>
  );
}

/** A phone with an arrow into it - the glyph the platforms use for this. */
function InstallMark() {
  return (
    <svg
      viewBox="0 0 24 24" width={22} height={22} aria-hidden
      fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
    >
      <rect x="7" y="2.5" width="10" height="19" rx="2.4" />
      <path d="M12 8v6M9.6 11.6 12 14l2.4-2.4" />
      <path d="M10.4 18h3.2" />
    </svg>
  );
}
