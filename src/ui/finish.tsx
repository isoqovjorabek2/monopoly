import { useMemo } from 'react';
import type { SkinId, TokenId } from '../game/types';
import { useStore } from '../store/store';
import { Avatar } from './bits';

/* ------------------------------------------------------------------ *
 * Who wears which finish at this table (Party Hall Plus). Read from the
 * seats, where the host only ever puts a finish on a seat whose pass it
 * verified as Plus - so a board draws what the host allowed, nothing else.
 * ------------------------------------------------------------------ */

/** Player id -> finish, for every seat showing one other than classic. */
export function useSkins(): Record<string, SkinId> {
  const seats = useStore((s) => s.room?.seats);
  return useMemo(() => {
    const out: Record<string, SkinId> = {};
    for (const seat of seats ?? []) {
      if (seat.plus && seat.skin && seat.skin !== 'classic') out[seat.playerId] = seat.skin;
    }
    return out;
  }, [seats]);
}

/** An avatar in the finish its player chose. */
export function SkinnedAvatar({ pid, ...rest }: {
  pid: string; color: string; token: TokenId; size?: number; active?: boolean; dim?: boolean;
}) {
  const skins = useSkins();
  return <Avatar {...rest} finish={skins[pid]} />;
}
