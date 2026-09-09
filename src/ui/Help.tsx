import { useEffect } from 'react';
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
        const btn = document.querySelector<HTMLButtonElement>(
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

const RENT_RULES: [string, string][] = [
  ['Colour set, no houses', 'Double rent once you hold every deed in the set'],
  ['Railroads', '$25 / $50 / $100 / $200 for 1, 2, 3 or 4 held'],
  ['Utilities', '4x the dice for one, 10x the dice for both'],
  ['Mortgaged deeds', 'Pay no rent, and cannot be built on'],
];

const BUILD_RULES: [string, string][] = [
  ['Before building', 'Hold the whole colour set, unmortgaged'],
  ['Even build', 'Houses go up and come down evenly across the set'],
  ['Hotel', 'Replaces four houses and returns them to the bank'],
  ['Bank stock', 'Houses and hotels are finite - the header shows what is left'],
];

const JAIL_RULES: [string, string][] = [
  ['Getting out', 'Roll doubles, pay the fine, or use a Get Out of Jail Free card'],
  ['Three turns', 'On the third failed roll you pay the fine and move'],
  ['Still in play', 'You collect rent and can trade normally while in jail'],
];

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="How to play">
      <div className="help">
        <section className="help__block">
          <h3 className="help__heading">Keyboard</h3>
          <dl className="help__keys">
            <div><dt><kbd className="kbd">space</kbd></dt><dd>Roll, continue, or end your turn</dd></div>
            <div><dt><kbd className="kbd">esc</kbd></dt><dd>Close whatever is open</dd></div>
            <div><dt><kbd className="kbd">?</kbd></dt><dd>This reference</dd></div>
          </dl>
          <p className="muted small">
            Space only ever takes the turn forward. Buying, bidding and bankruptcy
            stay on the mouse so nothing costly happens by accident.
          </p>
        </section>

        <section className="help__block">
          <h3 className="help__heading">Getting around</h3>
          <ul className="help__list">
            <li>Click any square to read its title deed - rent, build costs, who owns it.</li>
            <li>Click a player to see everything they hold and what it is worth.</li>
            <li>Your own deeds are actionable: mortgage, unmortgage, build and sell from the card.</li>
          </ul>
        </section>

        <section className="help__block">
          <h3 className="help__heading">What rent costs</h3>
          <Rules rows={RENT_RULES} />
        </section>

        <section className="help__block">
          <h3 className="help__heading">Building</h3>
          <Rules rows={BUILD_RULES} />
        </section>

        <section className="help__block">
          <h3 className="help__heading">Jail</h3>
          <Rules rows={JAIL_RULES} />
        </section>

        <p className="muted small">
          House rules the host switched on - free parking jackpot, auctions, turn
          limits - are listed in the lobby and can change what any of this does.
        </p>
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
