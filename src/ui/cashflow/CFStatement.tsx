import { cfDreamArt, cfJobArt } from '../../art/art';
import { DEBT_KEYS, FAST_BOARD, LOAN_UNIT } from '../../cashflow/data';
import { fastName } from '../../cashflow/describe';
import {
  childExpenses, currentId, dividendIncome, dreamPrice, holdingIncome, loanPayment, maxLoan,
  monthlyCashflow, passiveIncome, totalExpenses, totalIncome,
} from '../../cashflow/rules';
import type { CFAction, CFPlayer, CFState } from '../../cashflow/types';
import { money } from '../../game/describe';
import { cap, useT } from '../../i18n';
import { Money, fmt } from '../bits';

/**
 * The game card: income statement above, balance sheet below. This is the
 * thing Cashflow is actually about, so it is always on screen - the board
 * decides what happens to you, and this shows what it did.
 */
export function CFStatement({
  s, p, interactive, dispatch,
}: { s: CFState; p: CFPlayer; interactive: boolean; dispatch: (a: CFAction) => void }) {
  const t = useT();
  const S = t.cf.statement;
  return (
    <section className="cfStatement" aria-label={S.title}>
      <header className="cfStatement__head">
        <img className="cfStatement__portrait" src={cfJobArt(p.profession)} alt="" width={52} height={52} />
        <span className="cfStatement__who">
          <span className="cfStatement__job">{t.cf.professions[p.profession]}</span>
          <span className="cfStatement__title">{p.track === 'rat' ? S.title : S.fastTitle}</span>
        </span>
        <span className="cfStatement__cash">
          <span className="cfStatement__cashLabel">{S.cash}</span>
          <Money value={p.cash} />
        </span>
      </header>
      {p.track === 'rat'
        ? <RatSheet s={s} p={p} interactive={interactive} dispatch={dispatch} />
        : <FastSheet s={s} p={p} />}
    </section>
  );
}

const Row = ({ label, value, strong, neg }: { label: string; value: string; strong?: boolean; neg?: boolean }) => (
  <div className="cfRow" data-strong={strong || undefined} data-neg={neg || undefined}>
    <dt>{label}</dt>
    <dd className="num">{value}</dd>
  </div>
);

function RatSheet({
  s, p, interactive, dispatch,
}: { s: CFState; p: CFPlayer; interactive: boolean; dispatch: (a: CFAction) => void }) {
  const t = useT();
  const S = t.cf.statement;
  const passive = passiveIncome(p);
  const expenses = totalExpenses(p);
  const cf = monthlyCashflow(p);
  const pct = Math.min(100, Math.round((passive / Math.max(expenses, 1)) * 100));
  const myTurn = interactive && currentId(s) === p.id && !p.out
    && (s.phase === 'roll' || s.phase === 'choose_deal' || s.phase === 'turn_end');
  const cap_ = maxLoan(s, p);

  return (
    <>
      <div className="cfProgress" title={S.escapeGoal}>
        <div className="cfProgress__bar"><span style={{ width: `${Math.max(0, pct)}%` }} /></div>
        <p className="cfProgress__label">
          <span>{S.passive}</span>
          <span className="num">{S.of(fmt(passive), fmt(expenses))}</span>
        </p>
      </div>

      <dl className="cfSheet">
        <p className="cfSheet__head">{S.income}</p>
        <Row label={S.salary} value={fmt(p.salary)} />
        {dividendIncome(p) !== 0 && <Row label={S.dividends} value={fmt(dividendIncome(p))} />}
        {holdingIncome(p) !== 0 && <Row label={S.rentals} value={money(holdingIncome(p))} neg={holdingIncome(p) < 0} />}
        <Row label={S.totalIncome} value={fmt(totalIncome(p))} strong />

        <p className="cfSheet__head">{S.expenses}</p>
        <Row label={S.taxes} value={fmt(p.taxes)} />
        {DEBT_KEYS.filter((k) => p.debts[k].payment > 0).map((k) => (
          <Row key={k} label={t.cf.debts[k]} value={fmt(p.debts[k].payment)} />
        ))}
        <Row label={S.other} value={fmt(p.other)} />
        {p.children > 0 && <Row label={S.children(p.children)} value={fmt(childExpenses(p))} />}
        {p.bankLoan > 0 && <Row label={S.loanPayment} value={fmt(loanPayment(p))} />}
        <Row label={S.totalExpenses} value={fmt(expenses)} strong />

        <div className="cfRow cfRow--pay" data-neg={cf < 0 || undefined}>
          <dt>{S.payCheck}</dt>
          <dd className="num">{money(cf)}</dd>
        </div>
      </dl>

      <dl className="cfSheet">
        <p className="cfSheet__head">{S.assets}</p>
        {p.stocks.length === 0 && p.holdings.length === 0 && <p className="muted small">{S.noAssets}</p>}
        {p.stocks.map((l) => (
          <Row
            key={l.symbol}
            label={`${l.symbol} · ${S.shares(l.shares)} · ${S.avg(fmt(l.cost))}`}
            value={l.dividend > 0 ? `+${fmt(l.dividend * l.shares)}` : fmt(l.shares * l.cost)}
          />
        ))}
        {p.holdings.map((h) => (
          <Row
            key={h.id}
            label={`${cap(t.cf.tags[h.tag])}${h.units > 1 || h.tag === 'land' ? ` · ${t.cf.units(h.tag, h.units)}` : ''}`}
            value={`${money(h.cashflow)}/mo`}
            neg={h.cashflow < 0}
          />
        ))}
      </dl>

      <dl className="cfSheet">
        <p className="cfSheet__head">{S.liabilities}</p>
        {DEBT_KEYS.filter((k) => p.debts[k].balance > 0).map((k) => {
          const d = p.debts[k];
          return (
            <div key={k} className="cfRow cfRow--debt">
              <dt>{t.cf.debts[k]}</dt>
              <dd className="num">{fmt(d.balance)}</dd>
              {myTurn && (
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  disabled={p.cash < d.balance}
                  title={p.cash < d.balance ? t.common.notEnoughCash : undefined}
                  onClick={() => dispatch({ type: 'PAY_OFF', playerId: p.id, debt: k })}
                >
                  {S.payOff(fmt(d.balance))}
                </button>
              )}
            </div>
          );
        })}
        {p.holdings.filter((h) => h.mortgage > 0).map((h) => (
          <Row key={`m${h.id}`} label={`${cap(t.cf.tags[h.tag])} · ${t.cf.card.mortgage}`} value={fmt(h.mortgage)} />
        ))}
        <div className="cfRow cfRow--debt">
          <dt>{S.bankLoan}</dt>
          <dd className="num">{fmt(p.bankLoan)}</dd>
        </div>
        {myTurn ? (
          <div className="cfLoan">
            <div className="actions__row">
              <button
                type="button" className="btn btn--sm"
                disabled={cap_ < LOAN_UNIT}
                onClick={() => dispatch({ type: 'TAKE_LOAN', playerId: p.id, amount: LOAN_UNIT })}
              >
                {S.borrow(fmt(LOAN_UNIT))}
              </button>
              <button
                type="button" className="btn btn--sm"
                disabled={p.bankLoan < LOAN_UNIT || p.cash < LOAN_UNIT}
                onClick={() => dispatch({ type: 'REPAY_LOAN', playerId: p.id, amount: LOAN_UNIT })}
              >
                {S.repay(fmt(LOAN_UNIT))}
              </button>
            </div>
            <p className="muted small">
              {S.loanNote} {cap_ >= LOAN_UNIT ? S.loanCap(fmt(cap_)) : S.noLoan}
            </p>
          </div>
        ) : interactive && !p.out ? <p className="muted small">{S.onlyOnTurn}</p> : null}
      </dl>
    </>
  );
}

function FastSheet({ s, p }: { s: CFState; p: CFPlayer }) {
  const t = useT();
  const S = t.cf.statement;
  const start = p.fastGoal - s.settings.fastGoal;
  const pct = Math.min(100, Math.round(((p.fastIncome - start) / Math.max(s.settings.fastGoal, 1)) * 100));
  const owned = Object.entries(s.fastOwners)
    .filter(([, owner]) => owner === p.id)
    .map(([id]) => Number(id))
    .filter((id) => FAST_BOARD[id].kind === 'business' || FAST_BOARD[id].kind === 'venture');
  const dream = p.dream != null ? FAST_BOARD[p.dream] : null;

  return (
    <>
      <div className="cfProgress">
        <div className="cfProgress__bar cfProgress__bar--fast"><span style={{ width: `${Math.max(0, pct)}%` }} /></div>
        <p className="cfProgress__label">
          <span>{S.dayIncome}</span>
          <span className="num">{S.of(fmt(p.fastIncome), fmt(p.fastGoal))}</span>
        </p>
      </div>
      <dl className="cfSheet">
        <Row label={S.dayIncome} value={fmt(p.fastIncome)} strong />
        <Row label={S.goal} value={fmt(p.fastGoal)} />
        <p className="cfSheet__head">{S.businesses}</p>
        {owned.length === 0 && <p className="muted small">—</p>}
        {owned.map((id) => (
          <Row key={id} label={fastName(t, id)} value={`+${fmt(FAST_BOARD[id].cashflow ?? 0)}`} />
        ))}
      </dl>
      {dream && dream.key && (
        <figure className="cfDream">
          <img className="cfDream__art" src={cfDreamArt(dream.key)} alt="" width={72} height={72} />
          <figcaption>
            <span className="cfSheet__head">{S.dream}</span>
            <span className="cfDream__name">{fastName(t, dream.id)}</span>
            <span className="num">{S.dreamPrice}: {fmt(dreamPrice(p))}</span>
            {p.dreamMarks > 0 && <span className="muted small">{S.marks(p.dreamMarks)}</span>}
          </figcaption>
        </figure>
      )}
    </>
  );
}
