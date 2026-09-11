import { LANGS, dictFor, useLang, useSetLang, useT } from '../i18n';

/**
 * EN · RU · UZ, always in reach.
 *
 * Three letters rather than a dropdown: the whole choice fits in the space a
 * select would take closed, and it can be changed mid-game in one click
 * without opening anything over the board. Each option carries its own
 * language's name as a tooltip, in that language, so it is readable to the
 * person looking for it rather than to whoever set the current one.
 */
export function LangSwitch({ className = '' }: { className?: string }) {
  const lang = useLang();
  const setLang = useSetLang();
  const t = useT();

  return (
    <div className={`langSwitch ${className}`} role="radiogroup" aria-label={t.common.language}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          aria-checked={lang === l.id}
          className="langSwitch__item"
          data-on={lang === l.id || undefined}
          lang={l.id}
          title={dictFor(l.id).langName}
          onClick={() => setLang(l.id)}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
