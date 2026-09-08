import { type ReactNode, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { TOKENS } from '../game/settings';
import type { TokenId } from '../game/types';
import { Piece } from './Pieces';

export const fmt = (n: number): string =>
  `$${Math.round(n).toLocaleString('en-US')}`;

/** Money that counts to its new value instead of snapping - the delta is
 *  the information, and a snapping number throws it away. */
export function Money({ value, className = '' }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const raf = useRef<number>(0);
  const from = useRef(value);

  useEffect(() => {
    if (value === shown) return;
    from.current = shown;
    const start = performance.now();
    const delta = value - from.current;
    const dur = Math.min(700, 220 + Math.abs(delta) * 0.25);

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(from.current + delta * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span className={`num ${className}`}>{fmt(shown)}</span>;
}

export const tokenLabel = (id: TokenId): string =>
  TOKENS.find((t) => t.id === id)?.label ?? 'Token';

export function Avatar({
  color, token, size = 30, active = false, dim = false,
}: { color: string; token: TokenId; size?: number; active?: boolean; dim?: boolean }) {
  return (
    <span
      aria-hidden
      className="avatar"
      style={{
        '--tc': color,
        width: size,
        height: size,
        opacity: dim ? 0.45 : 1,
      } as React.CSSProperties}
      data-active={active || undefined}
    >
      <Piece token={token} className="avatar__piece" />
    </span>
  );
}

export function Panel({
  title, action, children, className = '',
}: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel__head">
          <h3 className="panel__title">{title}</h3>
          <div className="spacer" />
          {action}
        </header>
      )}
      <div className="panel__body">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** A button that explains itself when disabled - a dead control with no
 *  reason is the top source of "the game is broken". */
export function Action({
  label, hint, onClick, disabled, reason, variant = 'ghost', wide,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  reason?: string;
  variant?: 'primary' | 'ghost' | 'danger';
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      className={`btn btn--${variant}${wide ? ' btn--block' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? reason : hint}
      aria-label={disabled && reason ? `${label} - ${reason}` : label}
    >
      {label}
      {hint && !disabled && <span className="btn__hint num">{hint}</span>}
    </button>
  );
}

export function Modal({
  open, onClose, title, children, wide = false, dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
  dismissable?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onClose();
      if (e.key !== 'Tab' || !ref.current) return;
      // Trap focus: a modal you can tab out of is not a modal.
      const items = ref.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => {
      ref.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus();
    }, 40);
    return () => { document.removeEventListener('keydown', onKey); window.clearTimeout(t); };
  }, [open, onClose, dismissable]);

  if (!open) return null;

  return (
    <div className="scrim" onMouseDown={dismissable ? onClose : undefined}>
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal${wide ? ' modal--wide' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 340, damping: 28 }}
      >
        {title && (
          <header className="modal__head">
            <h2 className="modal__title">{title}</h2>
            {dismissable && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">
                Close
              </button>
            )}
          </header>
        )}
        <div className="modal__body">{children}</div>
      </motion.div>
    </div>
  );
}

export function Toggle({
  checked, onChange, label, hint,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" />
      <span className="switch__text">
        <span className="switch__label">{label}</span>
        {hint && <span className="switch__hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Slider({
  value, onChange, min, max, step = 1, label, format,
}: {
  value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number;
  label: string; format?: (v: number) => string;
}) {
  const id = `sl-${label.replace(/\W+/g, '')}`;
  return (
    <div className="slider">
      <div className="slider__head">
        <label htmlFor={id} className="switch__label">{label}</label>
        <span className="num slider__value">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Segmented<T extends string>({
  value, onChange, options, label,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className="segmented__item"
          data-on={value === o.value || undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
