import { useEffect, useState } from 'react';
import '../styles/ads.css';
import { useT } from '../i18n';
import { bannerSlotId, playBreak, playRewarded, showBanner, useShowAds, type BannerSlot } from '../net/ads';
import { tablePlus } from '../net/plus';
import type { RoomSnapshot } from '../net/protocol';
import { useStore } from '../store/store';
import { PlusSheet } from './Plus';

/* ------------------------------------------------------------------ *
 * A display banner. Its box is reserved at the unit's size before the ad
 * arrives, so nothing on the page jumps when it does; it is labelled as an
 * advertisement, and says how to be rid of it.
 * ------------------------------------------------------------------ */

export function AdBanner({ slot, className = '' }: { slot: BannerSlot; className?: string }) {
  const t = useT();
  const A = t.account.plus.ads;
  const show = useShowAds();
  const [offer, setOffer] = useState(false);

  useEffect(() => (show ? showBanner(slot) : undefined), [show, slot]);

  if (!show) return null;
  return (
    <aside className={`adBanner adBanner--${slot} ${className}`.trim()} aria-label={A.label}>
      <span className="adBanner__head">
        <span className="adBanner__label">{A.label}</span>
        <button type="button" className="adBanner__plus" onClick={() => setOffer(true)}>{A.noAds}</button>
      </span>
      <div className="adBanner__unit" id={bannerSlotId(slot)} />
      <PlusSheet open={offer} onClose={() => setOffer(false)} />
    </aside>
  );
}

/**
 * Wraps "leave the finished game" so a player who sees ads gets the
 * between-games video first. Only on the way out: never on a rematch, which
 * would hold up the whole table on one player's ad.
 */
export function useBreakBefore(fn: () => void): () => void {
  const show = useShowAds();
  return () => {
    if (!show) { fn(); return; }
    void playBreak().finally(fn);
  };
}

/**
 * The lobby's rewarded offer: the host watches one video, and the Plus
 * boards open for the table's next game. Shown only where it can pay off -
 * a table with no Plus player, to whoever can pick the board.
 */
export function RewardedBoards({ room, canEdit }: { room: RoomSnapshot; canEdit: boolean }) {
  const t = useT();
  const A = t.account.plus.ads;
  const show = useShowAds();
  const openBoards = useStore((s) => s.openBoardsForAGame);
  const [state, setState] = useState<'idle' | 'watching' | 'skipped' | 'unavailable'>('idle');

  if (room.kind !== 'monopoly' || tablePlus(room)) return null;
  if (room.themeTrial) return <p className="muted small adOffer__note">{A.trialOn}</p>;
  if (!show || !canEdit) return null;

  const watch = async () => {
    setState('watching');
    const r = await playRewarded();
    if (r === 'granted') { openBoards(); setState('idle'); } else setState(r === 'skipped' ? 'skipped' : 'unavailable');
  };

  return (
    <div className="adOffer">
      <button type="button" className="btn btn--sm" onClick={() => { void watch(); }} disabled={state === 'watching'}>
        {state === 'watching' ? A.watching : A.watch}
      </button>
      {(state === 'unavailable' || state === 'skipped') && (
        <p className="muted small adOffer__note">{A[state]}</p>
      )}
    </div>
  );
}
