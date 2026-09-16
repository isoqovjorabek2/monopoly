import type { BoardTheme, SkinId } from '../game/types';
import type { RoomSnapshot } from './protocol';

/* ------------------------------------------------------------------ *
 * What a table unlocks when someone at it holds Party Hall Plus.
 *
 * Which seats hold Plus is decided by the host, from passes it verified
 * (see SeatInfo.plus); these only read that. One human Plus seat is enough
 * for the whole table.
 * ------------------------------------------------------------------ */

/** Whether any person at the table holds Plus. Bots never do. */
export const tablePlus = (room: RoomSnapshot | null | undefined): boolean =>
  Boolean(room?.seats.some((s) => s.plus && !s.isBot));

/**
 * The board this table shows. In the lobby a theme needs a Plus player at
 * the table, so one who leaves takes it with them; once the game starts the
 * board is fixed for that game, whoever comes and goes.
 */
export function roomTheme(room: RoomSnapshot | null | undefined): BoardTheme {
  if (!room || room.kind !== 'monopoly') return 'silk';
  const chosen = room.settings.boardTheme ?? 'silk';
  if (room.game) return chosen;
  return tablePlus(room) ? chosen : 'silk';
}

/** The finishes a Plus player can give their piece and dice. */
export const SKINS: readonly SkinId[] = ['classic', 'mirror', 'glass', 'neon', 'gilded'];

/** Anything off the wire or out of storage, as a finish this build can draw. */
export const cleanSkin = (v: unknown): SkinId =>
  (SKINS as readonly unknown[]).includes(v) ? (v as SkinId) : 'classic';
