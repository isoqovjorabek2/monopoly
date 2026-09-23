import { useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { useStore } from '../store/store';
import { Modal } from './bits';
import { LangSwitch } from './LangSwitch';

/* ------------------------------------------------------------------ *
 * A phone's table header has room for what you use every turn - leaving,
 * the rules - and not for five toggles you set once a session. Those
 * live here, behind one button, as rows a thumb can hit. The desktop
 * header keeps them inline and never shows this button (.hdr-phone).
 * ------------------------------------------------------------------ */

export interface MenuRow {
  key: string;
  label: string;
  hint?: string;
  on: boolean;
  onToggle: () => void;
}

function Row({ label, hint, on, onToggle }: Omit<MenuRow, 'key'>) {
  return (
    <button type="button" className="tmenu__row" role="switch" aria-checked={on} onClick={onToggle}>
      <span className="tmenu__label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className="tmenu__switch" aria-hidden />
    </button>
  );
}

export function TableMenu({ alerts, extra = [], footer }: {
  alerts: { on: boolean; blocked: boolean; toggle: () => void };
  /** Game-specific rows (the 3D board), shown first. */
  extra?: MenuRow[];
  footer?: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const soundOn = useStore((s) => s.soundOn);
  const hapticsOn = useStore((s) => s.hapticsOn);
  const toggleSound = useStore((s) => s.toggleSound);
  const toggleHaptics = useStore((s) => s.toggleHaptics);

  const rows: MenuRow[] = [
    ...extra,
    { key: 'sound', label: t.game.sound, on: soundOn, onToggle: toggleSound },
    { key: 'haptics', label: t.game.haptics, on: hapticsOn, onToggle: toggleHaptics },
    {
      key: 'alerts', label: t.game.alertsLabel,
      hint: alerts.blocked ? t.table.alerts.blocked : t.table.alerts.title, on: alerts.on, onToggle: alerts.toggle,
    },
  ];

  return (
    <>
      <button type="button" className="btn btn--ghost btn--sm hdr-phone tmenu__open"
        onClick={() => setOpen(true)} aria-label={t.game.menu} title={t.game.menu} aria-haspopup="dialog">
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden fill="currentColor">
          <circle cx="3" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="13" cy="8" r="1.5" />
        </svg>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t.game.menu}>
        <div className="tmenu">
          {rows.map(({ key, ...r }) => <Row key={key} {...r} />)}
          <div className="tmenu__row tmenu__row--static">
            <span className="tmenu__label">{t.game.language}</span>
            <LangSwitch />
          </div>
          {footer}
        </div>
      </Modal>
    </>
  );
}
