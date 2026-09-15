import type { RoomSnapshot, SeatInfo } from './protocol';

/* ------------------------------------------------------------------ *
 * Who may remove whom, and how a table without its owner gets a
 * co-owner.
 *
 * The owner (the seat that opened the room) can remove any player,
 * in the lobby or mid-game. When the owner has been gone long enough
 * that they are clearly not coming right back, the remaining players
 * elect a co-owner by endorsement: everyone has one endorsement, the
 * latest one counts, and a strict majority of the table appoints. A
 * co-owner can remove players too - but never the owner or another
 * co-owner.
 *
 * Everything here is pure; the host applies the answers, so the rules
 * are testable without a table.
 * ------------------------------------------------------------------ */

/** How long the owner must be away before the table may elect a
 *  co-owner. Longer than the turn clock's patience, shorter than a
 *  round of apologies. */
export const OWNER_GRACE_MS = 60_000;

type ModerationRoom = Pick<RoomSnapshot, 'hostId' | 'ownerId' | 'seats' | 'coowners' | 'coownerVotes' | 'ownerAwayAt'>;

/** The seat the table belongs to. Rooms saved before co-owners existed
 *  know only their host, who at that point was the owner anyway. */
export const ownerOf = (room: ModerationRoom): string => room.ownerId ?? room.hostId;

export const isOwner = (room: ModerationRoom, seatId: string): boolean => seatId === ownerOf(room);

export const isCoowner = (room: ModerationRoom, seatId: string): boolean =>
  (room.coowners ?? []).includes(seatId);

/** May the player in `actor` remove the player in `target`? The owner may
 *  remove anyone but themselves; a co-owner anyone but the owner, another
 *  co-owner, or themselves. Bots are never "removed" this way - in the
 *  lobby the owner simply deletes the seat, and in a game a bot has to
 *  stay or the turn cycle has a hole in it. */
export function canKick(room: ModerationRoom, actor: string, target: SeatInfo | undefined): boolean {
  if (!target || target.isBot || target.playerId === actor) return false;
  if (isOwner(room, actor)) return true;
  if (!isCoowner(room, actor)) return false;
  return !isOwner(room, target.playerId) && !isCoowner(room, target.playerId);
}

/** Is the table without its owner long enough to vote? */
export function voteOpen(room: ModerationRoom, now: number): boolean {
  return room.ownerAwayAt != null && now - room.ownerAwayAt >= OWNER_GRACE_MS;
}

/** Who gets a say: connected humans, except the absent owner. The owner's
 *  seat is away by definition; bots never vote. */
export function eligibleVoters(room: ModerationRoom): string[] {
  const owner = ownerOf(room);
  return room.seats
    .filter((s) => !s.isBot && s.connected && s.playerId !== owner)
    .map((s) => s.playerId);
}

/** Who may be elected: the same pool. */
export const eligibleCandidates = eligibleVoters;

/** Current standings, counting only endorsements from voters who still
 *  have a say, for candidates still eligible. Stale votes left by players
 *  who have since left simply stop counting. */
export function tally(room: ModerationRoom): Record<string, number> {
  const voters = new Set(eligibleVoters(room));
  const candidates = new Set(eligibleCandidates(room));
  const out: Record<string, number> = {};
  for (const [voter, candidate] of Object.entries(room.coownerVotes ?? {})) {
    if (!voters.has(voter) || !candidates.has(candidate)) continue;
    out[candidate] = (out[candidate] ?? 0) + 1;
  }
  return out;
}

/** The elected seat, if any holds a strict majority of the current
 *  voters. With one voter left at the table, their vote alone carries. */
export function elected(room: ModerationRoom): string | null {
  const voters = eligibleVoters(room);
  if (voters.length === 0) return null;
  const counts = tally(room);
  for (const [candidate, n] of Object.entries(counts)) {
    if (n * 2 > voters.length) return candidate;
  }
  return null;
}
