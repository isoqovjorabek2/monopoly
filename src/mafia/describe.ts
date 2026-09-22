import type { Dict } from '../i18n/en';
import type { MafiaEvent, MafiaRole, MafiaState } from './types';

/**
 * One line of the Omertà table log. Kept as the event, like the Cashflow
 * log, so switching language rewrites history instead of freezing it.
 */
export interface MFLogLine {
  id: string;
  event: MafiaEvent;
  actor: string | null;
  tone: 'info' | 'good' | 'bad' | 'big';
}

export function mafLogLine(e: MafiaEvent, seq: number): MFLogLine | null {
  const line = (actor: string | null, tone: MFLogLine['tone'] = 'info'): MFLogLine =>
    ({ id: `${seq}`, event: e, actor, tone });

  switch (e.type) {
    // Night business stays secret - who moved is whispered, never logged.
    case 'ACTED': return null;
    // The tally is on the table itself, like movement on the board.
    case 'VOTED': return null;
    case 'GAME_STARTED': return line(null, 'big');
    case 'NIGHT_FALLS': return line(null);
    case 'DAWN': return line(null, e.deaths.length > 0 ? 'bad' : 'info');
    case 'SILENCED': return line(e.playerId, 'bad');
    case 'DAY_STARTED': return line(null);
    case 'LYNCHED': return line(e.playerId, 'bad');
    case 'NO_LYNCH': return line(null);
    case 'TIMED_OUT': return line(e.playerId, 'bad');
    case 'SEAT_TAKEN': return line(e.playerId, 'big');
    case 'GAME_OVER': return line(e.winnerId, 'big');
  }
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
    case 'DAWN':
      return e.deaths.length === 0
        ? M.dawn.quiet
        : e.deaths.map((d) => (d.role
            ? `${M.dawn.died(name(d.id))} ${M.dawn.roleWas(roleName(d.role))}`
            : M.dawn.died(name(d.id))
          )).join(' ');
    case 'SILENCED': return M.day.silenced(name(e.playerId));
    case 'DAY_STARTED': return M.day.title(e.round);
    case 'LYNCHED':
      return e.role
        ? `${M.vote.lynched(name(e.playerId))} ${M.vote.roleWas(roleName(e.role))}`
        : M.vote.lynched(name(e.playerId));
    case 'NO_LYNCH': return M.vote.noLynch;
    case 'TIMED_OUT': return t.log.timedOut(name(e.playerId));
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
