import { GROUPS } from '../game/board';
import { currentPlayerId, ownsFullGroup } from '../game/rules';
import type { GameState } from '../game/types';
import type { Dict } from '../i18n/en';
import type { MafiaPrivate, MafiaState } from '../mafia/types';

/* When each first-game tip is due (see Coach.tsx). Pure reads of the state
 * every seat already has, kept apart from the component so they test
 * without a browser. */

export type TipId = keyof Dict['coach']['tips'];

/** Bazaar Barons: the tips this moment calls for, most pressing first. */
export function monopolyTips(s: GameState | null, me: string): TipId[] {
  const p = s?.players[me];
  if (!s || !p || p.bankrupt || s.phase === 'game_over' || s.phase === 'lobby') return [];
  const mine = currentPlayerId(s) === me;
  const out: TipId[] = [];
  if (s.phase === 'must_raise' && s.debt?.from === me) out.push('monoRaise');
  if (s.trades.some((tr) => tr.to === me)) out.push('monoTrade');
  if (mine && s.phase === 'awaiting_buy') out.push('monoBuy');
  if (mine && p.inJail) out.push('monoJail');
  if ((Object.keys(GROUPS) as (keyof typeof GROUPS)[]).some((g) => ownsFullGroup(s, me, g))) out.push('monoSet');
  if (mine && s.phase === 'preroll') out.push('monoRoll');
  return out;
}

/** Omertà: the same, for the phase this seat is in. */
export function mafiaTips(s: MafiaState | null, me: string, priv: MafiaPrivate | null): TipId[] {
  const p = s?.players[me];
  if (!s || !p || s.phase === 'game_over' || s.phase === 'lobby') return [];
  if (!p.alive) return ['mafDead'];
  if (s.phase === 'night') return priv && priv.kinds.length > 0 ? ['mafNight'] : ['mafSleep'];
  if (s.phase === 'day') return ['mafDay'];
  if (s.phase === 'vote') return ['mafVote'];
  return [];
}

