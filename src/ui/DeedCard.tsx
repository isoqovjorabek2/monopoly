import { BOARD, GROUPS, GROUP_COLOR, RAILROAD_RENT } from '../game/board';
import {
  buildingSellValue, canBuildHouse, canMortgage, canSellHouse, canUnmortgage,
  hasUnmortgagedMonopoly, unmortgageCost,
} from '../game/rules';
import type { GameAction, GameState } from '../game/types';
import { spaceName, trReason, useT } from '../i18n';
import { Modal, fmt } from './bits';

/** The title deed, rendered like the card in the box. Read-only for
 *  anything you do not own; actionable for anything you do. */
export function DeedCard({
  state, spaceId, myId, onClose, dispatch,
}: {
  state: GameState;
  spaceId: number | null;
  myId: string;
  onClose: () => void;
  dispatch: (a: GameAction) => void;
}) {
  const t = useT();
  if (spaceId == null) return null;
  const d = t.deed;
  const space = BOARD[spaceId];
  const name = spaceName(t, spaceId);
  const st = state.properties[spaceId];
  const owner = st?.owner ? state.players[st.owner] : null;
  const mine = st?.owner === myId;
  const group = space.group;

  const body = (() => {
    if (!st) {
      return (
        <div className="deed deed--plain">
          <p className="muted">
            {space.kind === 'tax' && d.tax(fmt(space.taxAmount ?? 0))}
            {space.kind === 'go' && d.go(fmt(state.settings.goSalary))}
            {space.kind === 'jail' && d.jail(fmt(state.settings.jailFine))}
            {space.kind === 'freeparking' && (state.settings.freeParkingJackpot
              ? d.parkingOn(fmt(state.freeParkingPot))
              : d.parkingOff)}
            {space.kind === 'gotojail' && d.gotojail}
            {space.kind === 'chance' && d.chance}
            {space.kind === 'chest' && d.chest}
          </p>
        </div>
      );
    }

    return (
      <div className="deed">
        <header
          className="deed__head"
          style={{ background: group ? GROUP_COLOR[group] : 'var(--brass-600)' }}
        >
          <span className="deed__kicker">
            {group ? t.groups[group] : space.kind === 'railroad' ? d.railroad : d.utility}
          </span>
          <span className="deed__name">{name}</span>
        </header>

        <div className="deed__body">
          {space.kind === 'property' && space.rent && (
            <table className="rentTable">
              <caption className="sr-only">{d.rentFor(name)}</caption>
              <tbody>
                <tr data-on={st.houses === 0 || undefined}>
                  <th scope="row">{t.common.rent}</th>
                  <td className="num">{fmt(space.rent[0])}</td>
                </tr>
                {[1, 2, 3, 4].map((n) => (
                  <tr key={n} data-on={st.houses === n || undefined}>
                    <th scope="row">{d.withHouses(n)}</th>
                    <td className="num">{fmt(space.rent![n])}</td>
                  </tr>
                ))}
                <tr data-on={st.houses === 5 || undefined}>
                  <th scope="row">{d.withHotel}</th>
                  <td className="num">{fmt(space.rent[5])}</td>
                </tr>
              </tbody>
            </table>
          )}

          {space.kind === 'railroad' && (
            <table className="rentTable">
              <tbody>
                {[1, 2, 3, 4].map((n) => (
                  <tr key={n}>
                    <th scope="row">{d.railroads(n)}</th>
                    <td className="num">{fmt(RAILROAD_RENT[n])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {space.kind === 'utility' && (
            <table className="rentTable">
              <tbody>
                <tr><th scope="row">{d.oneUtility}</th><td className="num">{d.diceTimes(4)}</td></tr>
                <tr><th scope="row">{d.bothUtilities}</th><td className="num">{d.diceTimes(10)}</td></tr>
              </tbody>
            </table>
          )}

          <dl className="deed__facts">
            <div><dt>{d.price}</dt><dd className="num">{fmt(space.price ?? 0)}</dd></div>
            <div><dt>{d.mortgage}</dt><dd className="num">{fmt(space.mortgage ?? 0)}</dd></div>
            {space.houseCost != null && (
              <div><dt>{d.housesCost}</dt><dd className="num">{d.each(fmt(space.houseCost))}</dd></div>
            )}
            <div>
              <dt>{d.owner}</dt>
              <dd style={{ color: owner?.color }}>{owner ? owner.name : d.bank}</dd>
            </div>
          </dl>

          {group && state.settings.doubleRentOnMonopoly && (
            <p className="muted small">
              {/* The doubling only applies to an unimproved set - once houses
                  are up the ladder replaces it, so saying otherwise here
                  would misprice the square in the reader's head. */}
              {st.houses > 0
                ? d.byBuildings
                : owner && hasUnmortgagedMonopoly(state, owner.id, group)
                  ? d.setHeld
                  : GROUPS[group].length === 2
                    ? d.both
                    : d.all(GROUPS[group].length)}
            </p>
          )}
          {st.mortgaged && (
            <p className="banner banner--bad small">
              {d.mortgagedNote(fmt(unmortgageCost(state, spaceId)))}
            </p>
          )}
        </div>

        {mine && group && (
          <SetBuilder state={state} group={group} myId={myId} dispatch={dispatch} />
        )}
        {mine && <DeedActions state={state} spaceId={spaceId} myId={myId} dispatch={dispatch} />}
      </div>
    );
  })();

  return (
    <Modal open onClose={onClose} title={name}>
      {body}
    </Modal>
  );
}

/**
 * Build on the whole colour set from wherever you opened it.
 *
 * Even building means a set is raised a house at a time, moving across the
 * properties in turn - and the deed card only ever showed one of them, so
 * getting a set to hotels meant opening and closing three cards a dozen
 * times. The set is one thing, so it is edited as one thing.
 *
 * Every button asks `canBuildHouse` / `canSellHouse` - the same functions the
 * reducer re-validates against and the bots choose from - so this cannot
 * offer a move the rules forbid, and a disabled button says why.
 */
function SetBuilder({
  state, group, myId, dispatch,
}: {
  state: GameState;
  group: NonNullable<(typeof BOARD)[number]['group']>;
  myId: string;
  dispatch: (a: GameAction) => void;
}) {
  const t = useT();
  const d = t.deed;
  const ids = GROUPS[group];
  // Only worth showing once the set is yours: until then no building is legal
  // on any of it, and a column of dead buttons explains nothing.
  const allMine = ids.every((id) => state.properties[id].owner === myId);
  if (!allMine || ids.length === 0) return null;

  // Deliberately shown even when nothing is buildable or sellable right now.
  // Owning the whole set and finding no build controls at all - which is what
  // happens when a deed in the set is mortgaged, as one inherited from a
  // bankruptcy is - reads as the game being broken. The panel stays, and says
  // why instead.
  const mortgagedInSet = ids.filter((id) => state.properties[id].mortgaged);

  return (
    <section className="setBuild">
      <header className="setBuild__head">
        <span className="setBuild__title">{d.setTitle(t.groups[group])}</span>
        <span className="setBuild__cash num">{fmt(state.players[myId].cash)}</span>
      </header>

      <ul className="setBuild__list">
        {ids.map((id) => {
          const st = state.properties[id];
          const build = canBuildHouse(state, myId, id);
          const sell = canSellHouse(state, myId, id);
          const cost = BOARD[id].houseCost ?? 0;
          const name = spaceName(t, id);
          return (
            <li key={id} className="setBuild__row">
              <span className="setBuild__name truncate" title={name}>
                {name}
              </span>
              <span className="setBuild__level" aria-label={
                st.houses === 5 ? d.levelHotel : d.levelHouses(st.houses)
              }>
                {st.houses === 5
                  ? <span className="setBuild__hotel" title={t.common.hotel} />
                  : Array.from({ length: 4 }, (_, i) => (
                    <span key={i} className="setBuild__pip" data-on={i < st.houses || undefined} />
                  ))}
              </span>
              <button
                type="button"
                className="btn btn--sm setBuild__btn setBuild__btn--sell"
                disabled={!sell.ok}
                title={sell.ok ? d.sellFor(fmt(buildingSellValue(id))) : trReason(t, sell.reason)}
                aria-label={d.sellAria(name)}
                onClick={() => dispatch({ type: 'SELL_HOUSE', playerId: myId, spaceId: id })}
              >
                −
              </button>
              <button
                type="button"
                className="btn btn--sm setBuild__btn setBuild__btn--build"
                disabled={!build.ok}
                title={build.ok ? d.buildFor(st.houses === 4, fmt(cost)) : trReason(t, build.reason)}
                aria-label={d.buildAria(name)}
                onClick={() => dispatch({ type: 'BUILD_HOUSE', playerId: myId, spaceId: id })}
              >
                +
              </button>
            </li>
          );
        })}
      </ul>

      {mortgagedInSet.length > 0 && (
        <p className="setBuild__stock muted small">
          {d.blockedByMortgage(mortgagedInSet.map((id) => spaceName(t, id)).join(', '))}
        </p>
      )}

      {state.settings.buildingShortage && (
        <p className="setBuild__stock muted small">
          {d.bankStock(state.housesRemaining, state.hotelsRemaining)}
        </p>
      )}
    </section>
  );
}

function DeedActions({
  state, spaceId, myId, dispatch,
}: { state: GameState; spaceId: number; myId: string; dispatch: (a: GameAction) => void }) {
  const t = useT();
  const d = t.deed;
  const st = state.properties[spaceId];
  const build = canBuildHouse(state, myId, spaceId);
  const sell = canSellHouse(state, myId, spaceId);
  const mort = canMortgage(state, myId, spaceId);
  const unmort = canUnmortgage(state, myId, spaceId);
  const houseCost = BOARD[spaceId].houseCost ?? 0;

  return (
    <footer className="deed__actions">
      <button
        type="button" className="btn btn--primary btn--sm"
        disabled={!build.ok} title={trReason(t, build.reason)}
        onClick={() => dispatch({ type: 'BUILD_HOUSE', playerId: myId, spaceId })}
      >
        {st.houses === 4 ? d.buildHotel(fmt(houseCost)) : d.buildHouse(fmt(houseCost))}
      </button>
      <button
        type="button" className="btn btn--sm"
        disabled={!sell.ok} title={trReason(t, sell.reason)}
        onClick={() => dispatch({ type: 'SELL_HOUSE', playerId: myId, spaceId })}
      >
        {d.sellBuilding(fmt(buildingSellValue(spaceId)))}
      </button>
      {st.mortgaged ? (
        <button
          type="button" className="btn btn--sm"
          disabled={!unmort.ok} title={trReason(t, unmort.reason)}
          onClick={() => dispatch({ type: 'UNMORTGAGE', playerId: myId, spaceId })}
        >
          {d.liftMortgage(fmt(unmortgageCost(state, spaceId)))}
        </button>
      ) : (
        <button
          type="button" className="btn btn--sm"
          disabled={!mort.ok} title={trReason(t, mort.reason)}
          onClick={() => dispatch({ type: 'MORTGAGE', playerId: myId, spaceId })}
        >
          {d.mortgageFor(fmt(BOARD[spaceId].mortgage ?? 0))}
        </button>
      )}
    </footer>
  );
}
