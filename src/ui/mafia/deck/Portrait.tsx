import { useState } from 'react';
import { AvatarImg, sized, usePhoto } from '../Hud';

/**
 * The face in a card's window. A Google picture comes in two layers - the
 * same picture blurred behind, the sharp one feathered over it - so a
 * square photo and one already cut round both fill the window; a player
 * without one gets the drawn adventurer, standing in it as a bust.
 */
export function Portrait({ playerId, avatar, size }: { playerId: string; avatar: string; size: number }) {
  const photo = usePhoto(playerId);
  const [broken, setBroken] = useState<string | null>(null);
  if (!photo || broken === photo) return <AvatarImg avatar={avatar} size={size} />;
  const src = sized(photo, size);
  return (
    <span className="dk-portrait" aria-hidden>
      <img className="dk-portrait__bg" src={sized(photo, 64)} alt="" draggable={false} referrerPolicy="no-referrer" />
      <img className="dk-portrait__fg" src={src} alt="" draggable={false} referrerPolicy="no-referrer" loading="lazy"
        onError={() => setBroken(photo)} />
    </span>
  );
}
