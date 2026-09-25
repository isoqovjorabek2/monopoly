import { useState } from 'react';
import type { GameAction, GameState } from '../game/types';
import { END_VOTE_FROM_ROUND, canVoteEnd, endVoters } from '../game/rules';
import { useT } from '../i18n';

/* ------------------------------------------------------------------ *
 * Calling the game. A long game is the one people walk away from, so the
 * table can agree to stop: once every human still playing says yes, the
 * richest player still in wins - the same count a turn limit uses.
 *
 * One button asks (it confirms first: alone with bots, asking is ending),
 * and a banner shows everyone else the question with the two answers.
 * "Keep playing" only hides it here; the vote stands until its owner
 * takes it back, and a new yes brings the banner back.
 * ------------------------------------------------------------------ */

export function useEndVote(state: GameState | null, myId: string) {
  const [asking, setAsking] = useState(false);
  const [hiddenFor, setHiddenFor] = useState('');
  const voters = state ? endVoters(state) : [];
  const votes = (state?.endVotes ?? []).filter((id) => voters.includes(id));
  return {
    asking, setAsking, votes, voters,
    canVote: state ? canVoteEnd(state, myId) : false,
    iVoted: votes.includes(myId),
    hidden: hiddenFor === votes.join(','),
    hide: () => setHiddenFor(votes.join(',')),
  };
}

type EndVote = ReturnType<typeof useEndVote>;

/** The header's button: desktop only, the phone gets it in its menu. */
export function EndVoteButton({ vote, state, myId }: { vote: EndVote; state: GameState; myId: string }) {
  const t = useT();
  const E = t.game.endVote;
  // Watchers and the bankrupt have no say, and no button.
  if (state.phase === 'game_over' || vote.iVoted || !state.players[myId] || state.players[myId].bankrupt) return null;
  const early = state.round < END_VOTE_FROM_ROUND;
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      data-hdr="wide"
      disabled={!vote.canVote}
      onClick={() => vote.setAsking(true)}
      title={early ? E.soon(END_VOTE_FROM_ROUND) : E.title}
    >
      <span className="btn__label">{E.button}</span>
    </button>
  );
}

/** The phone menu's row for the same thing. */
export function EndVoteMenuRow({ vote, state, myId }: { vote: EndVote; state: GameState; myId: string }) {
  const t = useT();
  const E = t.game.endVote;
  if (state.phase === 'game_over' || vote.iVoted || !state.players[myId] || state.players[myId].bankrupt) return null;
  const early = state.round < END_VOTE_FROM_ROUND;
  return (
    <button type="button" className="tmenu__row" disabled={!vote.canVote} onClick={() => vote.setAsking(true)}>
      <span className="tmenu__label">
        {E.menu}
        <small>{early ? E.soon(END_VOTE_FROM_ROUND) : E.menuHint}</small>
      </span>
    </button>
  );
}

export function EndVoteBanner({ vote, state, myId, dispatch }: {
  vote: EndVote;
  state: GameState;
  myId: string;
  dispatch: (a: GameAction) => void;
}) {
  const t = useT();
  const E = t.game.endVote;
  if (state.phase === 'game_over') return null;
  const cast = (on: boolean) => dispatch({ type: 'VOTE_END', playerId: myId, on });

  if (vote.asking && !vote.iVoted) {
    return (
      <div className="banner endVote" role="alertdialog" aria-label={E.title}>
        <span className="endVote__text">{E.title}</span>
        <span className="endVote__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => { cast(true); vote.setAsking(false); }}>
            {E.button}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => vote.setAsking(false)}>
            {E.keep}
          </button>
        </span>
      </div>
    );
  }

  if (vote.votes.length === 0) return null;
  const yes = vote.votes.length;
  const of = vote.voters.length;

  if (vote.iVoted) {
    return (
      <div className="banner endVote" role="status">
        <span className="endVote__text">{E.mine(yes, of)}</span>
        <span className="endVote__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => cast(false)}>{E.takeBack}</button>
        </span>
      </div>
    );
  }

  if (vote.hidden) return null;
  const names = vote.votes.map((id) => state.players[id]?.name ?? t.defaults.someone).join(', ');
  return (
    <div className="banner endVote" role="status">
      <span className="endVote__text">{E.banner(names, yes, of)}</span>
      {vote.canVote && (
        <span className="endVote__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => cast(true)}>{E.agree}</button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={vote.hide}>{E.keep}</button>
        </span>
      )}
    </div>
  );
}
