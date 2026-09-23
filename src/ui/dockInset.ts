import { useEffect, type RefObject } from 'react';

/**
 * On an upright phone the turn controls are docked over the bottom of the
 * table (see the phones block at the end of app.css). The board has to be
 * framed above them, and how tall they are changes with the phase - a roll
 * is one button, a purchase or an auction is several - so the dock's
 * height is measured and handed to CSS as --dock-h on the table's root.
 * Anywhere the column is not a dock the variable is simply unused.
 */
export function useDockInset(root: RefObject<HTMLElement>, selector: string, ready: boolean): void {
  useEffect(() => {
    const host = root.current;
    const dock = host?.querySelector<HTMLElement>(selector);
    if (!host || !dock || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      host.style.setProperty('--dock-h', `${Math.round(dock.getBoundingClientRect().height)}px`);
    });
    ro.observe(dock);
    return () => ro.disconnect();
  }, [root, selector, ready]);
}
