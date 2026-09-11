import { useEffect } from 'react';
import { useT } from '../i18n';
import { Modal } from './bits';

/* ------------------------------------------------------------------ *
 * Keyboard control and the in-game reference.
 *
 * Two usability gaps this closes. First, every turn needed a mouse trip
 * to the same button; space now advances the turn from anywhere. Second,
 * the rules only existed in the lobby's settings screen, so mid-game
 * questions - what does a railroad pay, how much is a hotel - sent you
 * out of the game to look them up. Recognition over recall: put the
 * numbers on screen, one key away.
 * ------------------------------------------------------------------ */

/** True when the key should go to what the player is typing in, not to us. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useGameKeys(onHelp: () => void, onFocusMode?: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        onHelp();
        return;
      }

      if ((e.key === 'f' || e.key === 'F') && onFocusMode) {
        e.preventDefault();
        onFocusMode();
        return;
      }

      // Enter on a focused control already activates that control. Without
      // this, arrowing to a board tile and pressing Enter would inspect the
      // tile AND advance the turn.
      if (e.key === 'Enter' && document.activeElement instanceof HTMLElement
        && document.activeElement.matches('button, a, [role="button"]')) {
        return;
      }

      if (e.key === ' ' || e.key === 'Enter') {
        // Only ever the turn-advancing action. Buying, bidding and
        // bankruptcy stay mouse-only on purpose: a stray space bar should
        // never spend money.
        // The topmost open dialog owns the key: with a card up, Space means
        // that card's Continue - not the Roll or End turn button hidden
        // underneath it. A dialog without an advance button takes nothing.
        const scrims = document.querySelectorAll<HTMLElement>('.scrim');
        const scope: ParentNode = scrims.length > 0 ? scrims[scrims.length - 1] : document;
        const btn = scope.querySelector<HTMLButtonElement>(
          'button[data-hotkey="advance"]:not(:disabled)',
        );
        if (btn) {
          e.preventDefault();
          btn.click();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onHelp, onFocusMode]);
}

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  if (!open) return null;
  const h = t.help;

  return (
    <Modal open onClose={onClose} title={h.title}>
      <div className="help">
        <section className="help__block">
          <h3 className="help__heading">{h.keyboard}</h3>
          <dl className="help__keys">
            <div><dt><kbd className="kbd">{t.common.keySpace}</kbd></dt><dd>{h.keySpace}</dd></div>
            <div><dt><kbd className="kbd">esc</kbd></dt><dd>{h.keyEsc}</dd></div>
            <div><dt><kbd className="kbd">?</kbd></dt><dd>{h.keyHelp}</dd></div>
          </dl>
          <p className="muted small">{h.keyNote}</p>
        </section>

        <section className="help__block">
          <h3 className="help__heading">{h.around}</h3>
          <ul className="help__list">
            {h.aroundList.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section className="help__block">
          <h3 className="help__heading">{h.rentHeading}</h3>
          <Rules rows={h.rent} />
        </section>

        <section className="help__block">
          <h3 className="help__heading">{h.buildHeading}</h3>
          <Rules rows={h.build} />
        </section>

        <section className="help__block">
          <h3 className="help__heading">{h.jailHeading}</h3>
          <Rules rows={h.jail} />
        </section>

        <p className="muted small">{h.footnote}</p>
      </div>
    </Modal>
  );
}

function Rules({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="help__rules">
      {rows.map(([term, detail]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{detail}</dd>
        </div>
      ))}
    </dl>
  );
}
