import type { Dict } from '../i18n/en';
import type { MafiaDeath, MafiaEvent, MafiaRole, MafiaState } from './types';

/**
 * One line of the Omertà table log. Kept as the event, like the Cashflow
 * log, so switching language rewrites history instead of freezing it.
 */
export interface MFLogLine {
  id: string;
  event: MafiaEvent;
  actor: string | null;
  tone: 'info' | 'good' | 'bad' | 'big';
  /** When it happened here, so the table's talk and its news interleave. */
  at: number;
}

export function mafLogLine(e: MafiaEvent, seq: number): MFLogLine | null {
  const line = (actor: string | null, tone: MFLogLine['tone'] = 'info'): MFLogLine =>
    ({ id: `${seq}`, event: e, actor, tone, at: Date.now() });

  switch (e.type) {
    // Night business stays secret, and the tally is on the table itself.
    case 'ACTED': return null;
    case 'VOTED': return null;
    case 'GAME_STARTED': return line(null, 'big');
    case 'NIGHT_FALLS': return line(null);
    case 'DAWN': return line(null, e.deaths.length > 0 ? 'bad' : e.saved.length > 0 ? 'good' : 'info');
    case 'DAY_STARTED': return line(null);
    case 'VOTE_OPENED': return line(null);
    case 'LYNCHED': return line(e.playerId, 'bad');
    case 'NO_LYNCH': return line(null);
    case 'SNIPED': return line(e.playerId, 'bad');
    case 'SEAT_TAKEN': return line(e.playerId, 'big');
    case 'GAME_OVER': return line(e.winnerId, 'big');
  }
}

/** How one death reads in the announcement. */
export function deathLine(s: MafiaState, d: MafiaDeath, t: Dict): string {
  const M = t.maf;
  const name = (id: string | undefined): string => (id && s.players[id]?.name) || t.defaults.someone;
  const head = d.cause === 'bodyguard' ? M.dawn.guarded(name(d.id), name(d.saved))
    : d.cause === 'detective' ? M.dawn.shot(name(d.id))
      : d.cause === 'sniper' ? M.dawn.sniped(name(d.id))
        : d.cause === 'vote' ? M.vote.lynched(name(d.id))
          : M.dawn.died(name(d.id));
  return d.role ? `${head} ${M.dawn.roleWas(M.roles[d.role].name)}` : head;
}

/** The words for one event, in the reader's language. */
export function mafDescribe(s: MafiaState, e: MafiaEvent, t: Dict): string {
  const name = (id: string | null): string => (id && s.players[id]?.name) || t.defaults.someone;
  const roleName = (r: MafiaRole): string => t.maf.roles[r].name;
  const M = t.maf;

  switch (e.type) {
    case 'ACTED':
    case 'VOTED': return '';
    case 'GAME_STARTED': return M.reveal.title;
    case 'NIGHT_FALLS': return M.night.title(e.round);
    case 'DAWN': {
      const parts = [
        ...e.deaths.map((d) => deathLine(s, d, t)),
        ...e.saved.map((id) => M.dawn.saved(name(id))),
        ...e.silenced.map((id) => M.day.silenced(name(id))),
      ];
      return parts.length > 0 ? parts.join(' ') : M.dawn.quiet;
    }
    case 'DAY_STARTED': return M.day.title(e.round);
    case 'VOTE_OPENED': return M.vote.title;
    case 'LYNCHED':
      return e.role ? `${M.vote.lynched(name(e.playerId))} ${M.vote.roleWas(roleName(e.role))}` : M.vote.lynched(name(e.playerId));
    case 'NO_LYNCH': return e.tie ? M.vote.tie : M.vote.noVotes;
    case 'SNIPED':
      return e.role ? `${M.dawn.sniped(name(e.playerId))} ${M.dawn.roleWas(roleName(e.role))}` : M.dawn.sniped(name(e.playerId));
    case 'SEAT_TAKEN': return t.account.log.seatTaken(e.name, e.previous);
    case 'GAME_OVER':
      switch (e.winner) {
        case 'mafia': return M.over.mafiaWins;
        case 'village': return M.over.villageWins;
        case 'jester': return M.over.jesterWins(name(e.winnerId));
        default: return M.over.abandoned;
      }
  }
}
