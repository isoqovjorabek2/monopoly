import { BOARD, GROUPS, GROUP_COLOR, GROUP_LABEL, RAILROAD_RENT } from '../game/board';
import {
  buildingSellValue, canBuildHouse, canMortgage, canSellHouse, canUnmortgage,
  hasUnmortgagedMonopoly, unmortgageCost,
} from '../game/rules';
import type { GameAction, GameState } from '../game/types';
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
  if (spaceId == null) return null;
  const space = BOARD[spaceId];
  const st = state.properties[spaceId];
  const owner = st?.owner ? state.players[st.owner] : null;
  const mine = st?.owner === myId;
  const group = space.group;

  const body = (() => {
    if (!st) {
      return (
        <div className="deed deed--plain">
          <p className="muted">
            {space.kind === 'tax' && `Pay ${fmt(space.taxAmount ?? 0)} to the bank when you land here.`}
            {space.kind === 'go' && `Collect ${fmt(state.settings.goSalary)} every time you pass or land here.`}
            {space.kind === 'jail' && 'Just visiting, unless you were sent here. Three turns or a $50 fine.'}
            {space.kind === 'freeparking' && (state.settings.freeParkingJackpot
              ? `House rule is on: the pot currently holds ${fmt(state.freeParkingPot)}.`
              : 'Nothing happens here. The jackpot is a house rule, and it is currently off.')}
            {space.kind === 'gotojail' && 'Straight to jail. Do not pass GO.'}
            {space.kind === 'chance' && 'Draw a Chance card and do what it says.'}
            {space.kind === 'chest' && 'Draw a Community Chest card and do what it says.'}
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
            {group ? GROUP_LABEL[group] : space.kind === 'railroad' ? 'Railroad' : 'Utility'}
          </span>
          <span className="deed__name">{space.name}</span>
        </header>

        <div className="deed__body">
          {space.kind === 'property' && space.rent && (
            <table className="rentTable">
              <caption className="sr-only">Rent for {space.name}</caption>
              <tbody>
                <tr data-on={st.houses === 0 || undefined}>
                  <th scope="row">Rent</th>
                  <td className="num">{fmt(space.rent[0])}</td>
                </tr>
                {[1, 2, 3, 4].map((n) => (
                  <tr key={n} data-on={st.houses === n || undefined}>
                    <th scope="row">With {n} house{n > 1 ? 's' : ''}</th>
                    <td className="num">{fmt(space.rent![n])}</td>
                  </tr>
                ))}
                <tr data-on={st.houses === 5 || undefined}>
                  <th scope="row">With hotel</th>
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
                    <th scope="row">{n} railroad{n > 1 ? 's' : ''}</th>
                    <td className="num">{fmt(RAILROAD_RENT[n])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {space.kind === 'utility' && (
            <table className="rentTable">
              <tbody>
                <tr><th scope="row">One utility</th><td className="num">4x the dice</td></tr>
                <tr><th scope="row">Both utilities</th><td className="num">10x the dice</td></tr>
              </tbody>
            </table>
          )}

          <dl className="deed__facts">
            <div><dt>Price</dt><dd className="num">{fmt(space.price ?? 0)}</dd></div>
            <div><dt>Mortgage</dt><dd className="num">{fmt(space.mortgage ?? 0)}</dd></div>
            {space.houseCost != null && (
              <div><dt>Houses cost</dt><dd className="num">{fmt(space.houseCost)} each</dd></div>
            )}
            <div>
              <dt>Owner</dt>
              <dd style={{ color: owner?.color }}>{owner ? owner.name : 'The bank'}</dd>
            </div>
          </dl>

          {group && state.settings.doubleRentOnMonopoly && (
            <p className="muted small">
              {owner && hasUnmortgagedMonopoly(state, owner.id, group)
                ? 'Full set held: base rent is doubled.'
                : GROUPS[group].length === 2
                  ? 'Holding both deeds doubles the base rent.'
                  : `Holding all ${GROUPS[group].length} deeds doubles the base rent.`}
            </p>
          )}
          {st.mortgaged && (
            <p className="banner banner--bad small">
              Mortgaged. Collects no rent, and breaks the set bonus.
              Lift it for {fmt(unmortgageCost(state, spaceId))}.
            </p>
          )}
        </div>

        {mine && <DeedActions state={state} spaceId={spaceId} myId={myId} dispatch={dispatch} />}
      </div>
    );
  })();

  return (
    <Modal open onClose={onClose} title={space.name}>
      {body}
    </Modal>
  );
}

function DeedActions({
  state, spaceId, myId, dispatch,
}: { state: GameState; spaceId: number; myId: string; dispatch: (a: GameAction) => void }) {
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
        disabled={!build.ok} title={build.reason}
        onClick={() => dispatch({ type: 'BUILD_HOUSE', playerId: myId, spaceId })}
      >
        {st.houses === 4 ? `Build hotel ${fmt(houseCost)}` : `Build house ${fmt(houseCost)}`}
      </button>
      <button
        type="button" className="btn btn--sm"
        disabled={!sell.ok} title={sell.reason}
        onClick={() => dispatch({ type: 'SELL_HOUSE', playerId: myId, spaceId })}
      >
        Sell building +{fmt(buildingSellValue(spaceId))}
      </button>
      {st.mortgaged ? (
        <button
          type="button" className="btn btn--sm"
          disabled={!unmort.ok} title={unmort.reason}
          onClick={() => dispatch({ type: 'UNMORTGAGE', playerId: myId, spaceId })}
        >
          Lift mortgage {fmt(unmortgageCost(state, spaceId))}
        </button>
      ) : (
        <button
          type="button" className="btn btn--sm"
          disabled={!mort.ok} title={mort.reason}
          onClick={() => dispatch({ type: 'MORTGAGE', playerId: myId, spaceId })}
        >
          Mortgage +{fmt(BOARD[spaceId].mortgage ?? 0)}
        </button>
      )}
    </footer>
  );
}
