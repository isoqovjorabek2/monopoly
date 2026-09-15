import { AnimatePresence, motion } from 'framer-motion';
import { BOARD, GROUP_COLOR } from '../game/board';
import {
  LOAN_RATES, LOAN_ROUNDS, MAX_TERMS, MAX_TERM_SPACES, PASS_DISCOUNTS, PASS_USES, SHARE_ROUNDS,
  contractsOf, involves, repayAt, roundsLeft, sideId,
} from '../game/deals';
import { legalActions, ownedBy } from '../game/rules';
import type {
  Contract, DealTerm, GameAction, GameState, TradeBody, TradeSide,
} from '../game/types';
import { type Dict, spaceShort, useT } from '../i18n';
import { Avatar, Empty, Modal, Segmented, Slider, fmt } from './bits';

/* ==================================================================== *
 * Deal Maker, on screen.
 *
 * A contract is drawn the same way wherever it appears - in the offer
 * you are composing, in an offer somebody sent you, in the ledger, and on
 * the deed it binds - so a player learns to read one once. Each is a
 * small engraved slip: a brass glyph for its kind, the two parties as
 * their pieces with the value flowing left to right, then the terms in
 * a plain phrase with no subject for "You" to disagree with.
 * ==================================================================== */

type Kind = DealTerm['kind'];

/** The kind's mark. Drawn, not lettered, so it reads at chip size and in
 *  every language: a ticket stub, a slice of the pie, a stack of coins. */
export function ContractGlyph({ kind, size = 18 }: { kind: Kind; size?: number }) {
  const common = {
    viewBox: '0 0 20 20', width: size, height: size, 'aria-hidden': true,
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  if (kind === 'pass') {
    return (
      <svg {...common}>
        <path d="M3 6.2A1.2 1.2 0 0 1 4.2 5h11.6A1.2 1.2 0 0 1 17 6.2V8a2 2 0 0 0 0 4v1.8a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 13.8V12a2 2 0 0 0 0-4z" />
        <path d="M12.5 5.5v9" strokeDasharray="1.4 1.6" />
      </svg>
    );
  }
  if (kind === 'share') {
    return (
      <svg {...common}>
        <path d="M10 3.2a6.8 6.8 0 1 0 6.8 6.8H10z" />
        <path d="M12.2 1.8a6.4 6.4 0 0 1 6 6h-6z" fill="currentColor" fillOpacity="0.35" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <ellipse cx="10" cy="5.5" rx="5.5" ry="2.2" />
      <path d="M4.5 5.5v3.2c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V5.5" />
      <path d="M4.5 8.7v3.2c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V8.7" />
      <path d="M4.5 11.9v2.6c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2v-2.6" />
    </svg>
  );
}

/* ---------------------------- one slip ------------------------------ */

interface SlipView {
  kind: Kind;
  /** Who gives the pass or share, or lends. */
  giver: string;
  /** Who holds it, or borrows. */
  taker: string;
  text: string;
  meta: string;
}

/** A term still waiting on its deeds shows a gap, not a dangling "on". */
const deedList = (t: Dict, ids: number[]): string =>
  (ids.length === 0 ? '…' : ids.map((id) => spaceShort(t, id)).join(', '));

function termView(t: Dict, o: Pick<TradeBody, 'from' | 'to'>, term: DealTerm): SlipView {
  const D = t.deals.term;
  if (term.kind === 'loan') {
    const giver = sideId(o, term.lender);
    return {
      kind: 'loan', giver, taker: giver === o.from ? o.to : o.from,
      text: D.loan(fmt(term.principal), fmt(term.repay)), meta: D.loanMeta(term.rounds),
    };
  }
  const giver = sideId(o, term.grantor);
  const taker = giver === o.from ? o.to : o.from;
  return term.kind === 'pass'
    ? { kind: 'pass', giver, taker, text: D.pass(deedList(t, term.spaces), term.discountPct), meta: D.passMeta(term.uses) }
    : { kind: 'share', giver, taker, text: D.share(deedList(t, term.spaces), term.pct), meta: D.shareMeta(term.rounds || null) };
}

function contractView(t: Dict, s: GameState, c: Contract): SlipView {
  const D = t.deals;
  switch (c.kind) {
    case 'pass':
      return { kind: 'pass', giver: c.grantor, taker: c.holder, text: D.term.pass(deedList(t, c.spaces), c.discountPct), meta: D.ledger.usesLeft(c.usesLeft) };
    case 'share': {
      const left = roundsLeft(s, c.endsRound);
      return { kind: 'share', giver: c.grantor, taker: c.holder, text: D.term.share(deedList(t, c.spaces), c.pct), meta: left === null ? D.ledger.forever : D.ledger.endsIn(left) };
    }
    case 'loan':
      return { kind: 'loan', giver: c.lender, taker: c.borrower, text: D.term.loan(fmt(c.principal), fmt(c.repay)), meta: D.ledger.dueIn(c.dueRound - s.round) };
  }
}

function Slip({
  state, view, viewerId, children, compact = false,
}: {
  state: GameState;
  view: SlipView;
  viewerId: string;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  const t = useT();
  const who = (id: string) => (id === viewerId ? t.common.you : state.players[id]?.name ?? t.defaults.someone);
  const giver = state.players[view.giver];
  const taker = state.players[view.taker];
  // Tinted for the reader: a slip that pays you glows, one that costs you
  // is edged in warning. Neutral when it is between two other players. A
  // loan reads the other way round: it is the lender who is owed.
  const favoured = view.kind === 'loan' ? view.giver : view.taker;
  const bound = view.kind === 'loan' ? view.taker : view.giver;
  const tone = favoured === viewerId ? 'up' : bound === viewerId ? 'down' : undefined;
  return (
    <div className="slip" data-kind={view.kind} data-tone={tone} data-compact={compact || undefined}>
      <span className="slip__glyph"><ContractGlyph kind={view.kind} /></span>
      <div className="slip__main">
        <div className="slip__head">
          <span className="slip__kind">{t.deals.kinds[view.kind]}</span>
          <span className="slip__meta num">{view.meta}</span>
        </div>
        <p className="slip__text">{view.text}</p>
        <div
          className="slip__parties"
          aria-label={`${who(view.giver)} ${view.kind === 'loan' ? t.deals.term.lends : t.deals.term.grants} ${who(view.taker)}`}
        >
          {giver && <Avatar color={giver.color} token={giver.token} size={18} />}
          <span className="truncate">{who(view.giver)}</span>
          <svg className="slip__arrow" viewBox="0 0 16 8" width="16" height="8" aria-hidden="true">
            <path d="M1 4h13M10.5 1 14 4l-3.5 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {taker && <Avatar color={taker.color} token={taker.token} size={18} />}
          <span className="truncate">{who(view.taker)}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The contracts an offer carries, as the recipient reads them. */
export function OfferTerms({ state, offer, viewerId }: { state: GameState; offer: TradeBody; viewerId: string }) {
  const t = useT();
  const terms = offer.terms ?? [];
  if (terms.length === 0) return null;
  return (
    <div className="offer__side offer__side--terms">
      <span className="overline">{t.deals.section}</span>
      <div className="slipStack">
        {terms.map((term, i) => (
          <Slip key={i} state={state} view={termView(t, offer, term)} viewerId={viewerId} compact />
        ))}
      </div>
    </div>
  );
}

/* ============================ the composer ============================ *
 * The third column of a trade. Adding a contract drops in a slip with
 * sensible defaults already filled, so the fastest path is one click and a
 * glance; every control on it is a choice of a few presets rather than a
 * number box, because nobody negotiates a 17% share.
 * ==================================================================== */

/** Deeds a side will hold once the swap is done - the only deeds it can put
 *  a pass or share on. */
export function deedsAfter(state: GameState, o: TradeBody, side: TradeSide): number[] {
  const pid = sideId(o, side);
  const leaving = side === 'from' ? o.giveProperties : o.wantProperties;
  const arriving = side === 'from' ? o.wantProperties : o.giveProperties;
  return [...ownedBy(state, pid).filter((id) => !leaving.includes(id)), ...arriving]
    .sort((a, b) => a - b);
}

/** Terms with any deed that is no longer eligible dropped - the swap above
 *  them can change after they were picked. */
export function pruneTerms(state: GameState, o: TradeBody, terms: DealTerm[]): DealTerm[] {
  return terms.map((term) => {
    if (term.kind === 'loan') return term;
    const ok = deedsAfter(state, o, term.grantor);
    return { ...term, spaces: term.spaces.filter((id) => ok.includes(id)) };
  });
}

function defaultTerm(state: GameState, o: TradeBody, kind: Kind): DealTerm {
  // Ask the other side for it when they have something to give; it is the
  // more common deal, and the player can flip it with one tap.
  const theirDeeds = deedsAfter(state, o, 'to').length > 0;
  switch (kind) {
    case 'pass':
      return { kind, grantor: theirDeeds ? 'to' : 'from', spaces: [], discountPct: 100, uses: 2 };
    case 'share':
      return { kind, grantor: theirDeeds ? 'to' : 'from', spaces: [], pct: 20, rounds: 10 };
    case 'loan': {
      const lender: TradeSide = state.players[o.to].cash >= 100 ? 'to' : 'from';
      const cash = state.players[sideId(o, lender)].cash;
      const principal = Math.max(50, Math.min(300, Math.floor(cash / 10) * 10));
      return { kind, lender, principal, repay: repayAt(principal, 20), rounds: 5 };
    }
  }
}

export function TermsComposer({
  state, offer, terms, onChange,
}: {
  state: GameState;
  /** The offer as composed so far, without its terms. */
  offer: TradeBody;
  terms: DealTerm[];
  onChange: (terms: DealTerm[]) => void;
}) {
  const t = useT();
  const D = t.deals;
  const full = terms.length >= MAX_TERMS;
  const set = (i: number, term: DealTerm) => onChange(terms.map((x, j) => (j === i ? term : x)));

  return (
    <section className="terms" aria-label={D.section}>
      <header className="terms__head">
        <h4 className="section__title">{D.section}</h4>
        <p className="muted small">{D.sectionHint}</p>
      </header>

      <div className="terms__adders" role="group" aria-label={D.add}>
        {(['pass', 'share', 'loan'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className="termAdder"
            data-kind={kind}
            disabled={full}
            title={full ? D.full : undefined}
            onClick={() => onChange([...terms, defaultTerm(state, offer, kind)])}
          >
            <span className="termAdder__glyph"><ContractGlyph kind={kind} size={20} /></span>
            <span className="termAdder__text">
              <span className="termAdder__kind">+ {D.kinds[kind]}</span>
              <span className="termAdder__hint">{D.kindHints[kind]}</span>
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {terms.map((term, i) => (
          <motion.div
            key={i}
            layout
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <TermEditor
              state={state}
              offer={offer}
              term={term}
              onChange={(next) => set(i, next)}
              onRemove={() => onChange(terms.filter((_, j) => j !== i))}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
}

function TermEditor({
  state, offer, term, onChange, onRemove,
}: {
  state: GameState;
  offer: TradeBody;
  term: DealTerm;
  onChange: (term: DealTerm) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const D = t.deals;
  const them = state.players[offer.to];
  const sideOptions = [
    { value: 'from' as TradeSide, label: t.common.you },
    { value: 'to' as TradeSide, label: them?.name ?? '' },
  ];
  const view = termView(t, offer, term);

  return (
    <article className="termEditor" data-kind={term.kind}>
      <header className="termEditor__head">
        <span className="slip__glyph"><ContractGlyph kind={term.kind} /></span>
        <span className="termEditor__title">{D.kinds[term.kind]}</span>
        <span className="termEditor__summary truncate" title={`${view.text} · ${view.meta}`}>
          {view.text} · {view.meta}
        </span>
        <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={onRemove} aria-label={D.remove} title={D.remove}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>

      <div className="termEditor__body">
        {term.kind === 'loan' ? (
          <LoanFields state={state} offer={offer} term={term} sideOptions={sideOptions} onChange={onChange} />
        ) : (
          <>
            <div className="labelled">
              <span className="switch__label">{D.grantedBy}</span>
              <Segmented
                label={D.grantedBy}
                value={term.grantor}
                options={sideOptions}
                onChange={(g) => onChange({ ...term, grantor: g, spaces: [] })}
              />
            </div>
            <DeedPicker state={state} offer={offer} term={term} onChange={onChange} />
            {term.kind === 'pass' ? (
              <div className="termEditor__pair">
                <div className="labelled">
                  <span className="switch__label">{D.discount}</span>
                  <Segmented
                    label={D.discount}
                    value={String(term.discountPct)}
                    options={PASS_DISCOUNTS.map((p) => ({ value: String(p), label: p === 100 ? D.free : D.off(p) }))}
                    onChange={(v) => onChange({ ...term, discountPct: Number(v) })}
                  />
                </div>
                <div className="labelled">
                  <span className="switch__label">{D.uses}</span>
                  <Segmented
                    label={D.uses}
                    value={String(term.uses)}
                    options={PASS_USES.map((n) => ({ value: String(n), label: D.times(n) }))}
                    onChange={(v) => onChange({ ...term, uses: Number(v) })}
                  />
                </div>
              </div>
            ) : (
              <div className="termEditor__pair">
                <Slider
                  label={D.pct}
                  min={5} max={100} step={5}
                  value={term.pct}
                  format={t.common.percent}
                  onChange={(v) => onChange({ ...term, pct: v })}
                />
                <div className="labelled">
                  <span className="switch__label">{D.duration}</span>
                  <Segmented
                    label={D.duration}
                    value={String(term.rounds)}
                    options={SHARE_ROUNDS.map((n) => ({ value: String(n), label: n === 0 ? D.wholeGame : D.rounds(n) }))}
                    onChange={(v) => onChange({ ...term, rounds: Number(v) })}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function DeedPicker({
  state, offer, term, onChange,
}: {
  state: GameState;
  offer: TradeBody;
  term: Extract<DealTerm, { kind: 'pass' | 'share' }>;
  onChange: (term: DealTerm) => void;
}) {
  const t = useT();
  const D = t.deals;
  const deeds = deedsAfter(state, offer, term.grantor);
  const grantorName = term.grantor === 'from' ? t.common.you : state.players[offer.to]?.name ?? '';
  const toggle = (id: number) => onChange({
    ...term,
    spaces: term.spaces.includes(id) ? term.spaces.filter((x) => x !== id) : [...term.spaces, id].slice(0, MAX_TERM_SPACES),
  });

  return (
    <div className="labelled">
      <span className="switch__label">{D.onDeeds}</span>
      {deeds.length === 0 ? (
        <p className="muted small">{D.noDeeds(grantorName)}</p>
      ) : (
        <div className="deedPicks" role="group" aria-label={D.onDeeds}>
          {deeds.map((id) => {
            const g = BOARD[id].group;
            return (
              <button
                key={id}
                type="button"
                className="deedPick"
                aria-pressed={term.spaces.includes(id)}
                data-on={term.spaces.includes(id) || undefined}
                style={{ ['--dc' as string]: g ? GROUP_COLOR[g] : 'var(--brass-500)' } as React.CSSProperties}
                onClick={() => toggle(id)}
              >
                {spaceShort(t, id)}
              </button>
            );
          })}
        </div>
      )}
      {deeds.length > 0 && term.spaces.length === 0 && (
        <p className="terms__warn small">{D.pickDeeds}</p>
      )}
    </div>
  );
}

function LoanFields({
  state, offer, term, sideOptions, onChange,
}: {
  state: GameState;
  offer: TradeBody;
  term: Extract<DealTerm, { kind: 'loan' }>;
  sideOptions: { value: TradeSide; label: string }[];
  onChange: (term: DealTerm) => void;
}) {
  const t = useT();
  const D = t.deals;
  const lenderCash = state.players[sideId(offer, term.lender)]?.cash ?? 0;
  const max = Math.max(50, Math.floor(lenderCash / 10) * 10);
  // The deal stores what is repaid; the control speaks in rates.
  const rate = LOAN_RATES.reduce((best, r) =>
    (Math.abs(repayAt(term.principal, r) - term.repay) < Math.abs(repayAt(term.principal, best) - term.repay) ? r : best), 0 as number);

  return (
    <>
      <div className="labelled">
        <span className="switch__label">{D.lentBy}</span>
        <Segmented
          label={D.lentBy}
          value={term.lender}
          options={sideOptions}
          onChange={(lender) => {
            const cash = state.players[sideId(offer, lender)]?.cash ?? 0;
            const principal = Math.max(50, Math.min(term.principal, Math.floor(cash / 10) * 10));
            onChange({ ...term, lender, principal, repay: repayAt(principal, rate) });
          }}
        />
      </div>
      <Slider
        label={D.amount}
        min={50} max={max} step={10}
        value={Math.min(term.principal, max)}
        format={fmt}
        onChange={(v) => onChange({ ...term, principal: v, repay: repayAt(v, rate) })}
      />
      <div className="termEditor__pair">
        <div className="labelled">
          <span className="switch__label">{D.rate}</span>
          <Segmented
            label={D.rate}
            value={String(rate)}
            options={LOAN_RATES.map((r) => ({ value: String(r), label: t.common.percent(r) }))}
            onChange={(v) => onChange({ ...term, repay: repayAt(term.principal, Number(v)) })}
          />
          <p className="muted small num">{D.repays(fmt(term.repay))}</p>
        </div>
        <div className="labelled">
          <span className="switch__label">{D.due}</span>
          <Segmented
            label={D.due}
            value={String(term.rounds)}
            options={LOAN_ROUNDS.map((n) => ({ value: String(n), label: D.rounds(n) }))}
            onChange={(v) => onChange({ ...term, rounds: Number(v) })}
          />
        </div>
      </div>
    </>
  );
}

/* ============================== the ledger ============================ */

export const myContractCount = (s: GameState, pid: string): number =>
  contractsOf(s).filter((c) => involves(c, pid)).length;

export function ContractsModal({
  state, myId, open, onClose, dispatch,
}: {
  state: GameState;
  myId: string;
  open: boolean;
  onClose: () => void;
  dispatch: (a: GameAction) => void;
}) {
  const t = useT();
  const D = t.deals;
  if (!open) return null;
  const all = contractsOf(state);
  const mine = all.filter((c) => involves(c, myId));
  const others = all.filter((c) => !involves(c, myId));
  const legal = legalActions(state, myId);
  const can = (type: GameAction['type'], id: string) =>
    legal.some((a) => a.type === type && 'contractId' in a && a.contractId === id);

  const row = (c: Contract) => {
    const repay = c.kind === 'loan' && c.borrower === myId;
    const release = can('RELEASE_CONTRACT', c.id);
    return (
      <li key={c.id}>
        <Slip state={state} view={contractView(t, state, c)} viewerId={myId}>
          {(repay || release) && (
            <div className="slip__actions">
              {repay && c.kind === 'loan' && (
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  disabled={!can('REPAY_LOAN', c.id)}
                  title={can('REPAY_LOAN', c.id) ? undefined : t.deed.notNow}
                  onClick={() => dispatch({ type: 'REPAY_LOAN', playerId: myId, contractId: c.id })}
                >
                  {D.ledger.repay(fmt(c.repay))}
                </button>
              )}
              {release && (
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  title={D.ledger.releaseTitle}
                  onClick={() => dispatch({ type: 'RELEASE_CONTRACT', playerId: myId, contractId: c.id })}
                >
                  {D.ledger.release}
                </button>
              )}
            </div>
          )}
        </Slip>
      </li>
    );
  };

  return (
    <Modal open onClose={onClose} title={D.ledger.title}>
      <div className="ledger">
        {all.length === 0 ? <Empty>{D.ledger.empty}</Empty> : (
          <>
            {mine.length > 0 && (
              <section>
                <h4 className="overline ledger__heading">{D.ledger.yours}</h4>
                <ul className="slipStack">{mine.map(row)}</ul>
              </section>
            )}
            {others.length > 0 && (
              <section>
                <h4 className="overline ledger__heading">{D.ledger.others}</h4>
                <ul className="slipStack">{others.map(row)}</ul>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** What stands on one deed: passes held on it and shares taken from it. */
export function DeedContracts({ state, spaceId, viewerId }: { state: GameState; spaceId: number; viewerId: string }) {
  const t = useT();
  const on = contractsOf(state).filter((c) => c.kind !== 'loan' && c.spaces.includes(spaceId));
  if (on.length === 0) return null;
  return (
    <section className="deed__contracts">
      <span className="overline">{t.deals.ledger.onDeed}</span>
      <div className="slipStack">
        {on.map((c) => <Slip key={c.id} state={state} view={contractView(t, state, c)} viewerId={viewerId} compact />)}
      </div>
    </section>
  );
}
