import type { Dict } from '../../i18n/en';
import { ROLE_MAX, ROLE_TEAM } from '../../mafia/data';
import { isFamily } from '../../mafia/rules';
import type { MafiaPrivate, MafiaRole, MafiaState } from '../../mafia/types';
import type { RoomSnapshot } from '../../net/protocol';

/* ------------------------------------------------------------------ *
 * The Mafia app's screens speak its own data model: a player list with
 * usernames and avatars, role definitions with a colour, a gradient and
 * an emoji. This adapter builds that view from Omertà's state and the
 * seat's own private slice - so the ported screens stay as they were
 * written, and never see more than this seat may know.
 * ------------------------------------------------------------------ */

export type Faction = 'town' | 'mafia' | 'neutral';

export interface RoleDef {
  id: MafiaRole;
  name: string;
  faction: Faction;
  description: string;
  ability: string;
  abilityDescription: string;
  icon: string;
  color: string;
  glowColor: string;
  gradient: string;
  maxCount: number;
  nightAction: boolean;
}

/** The app's look for each role: its colour, glow, gradient and emoji. */
const LOOK: Record<MafiaRole, Pick<RoleDef, 'icon' | 'color' | 'glowColor' | 'gradient' | 'nightAction'>> = {
  mafia: { icon: '🔫', color: '#e74c3c', glowColor: 'rgba(231, 76, 60, 0.5)', gradient: 'linear-gradient(135deg, #c0392b, #922b21)', nightAction: true },
  godfather: { icon: '👑', color: '#c0392b', glowColor: 'rgba(192, 57, 43, 0.6)', gradient: 'linear-gradient(135deg, #922b21, #6e2222)', nightAction: true },
  doctor: { icon: '💊', color: '#1abc9c', glowColor: 'rgba(26, 188, 156, 0.5)', gradient: 'linear-gradient(135deg, #148f77, #0e6655)', nightAction: true },
  detective: { icon: '🔍', color: '#3498db', glowColor: 'rgba(52, 152, 219, 0.5)', gradient: 'linear-gradient(135deg, #2471a3, #1a5276)', nightAction: true },
  villager: { icon: '🏘️', color: '#f39c12', glowColor: 'rgba(243, 156, 18, 0.4)', gradient: 'linear-gradient(135deg, #d68910, #b7770d)', nightAction: false },
  sniper: { icon: '🎯', color: '#8e44ad', glowColor: 'rgba(142, 68, 173, 0.5)', gradient: 'linear-gradient(135deg, #7d3c98, #6c3483)', nightAction: false },
  jester: { icon: '🃏', color: '#f39c12', glowColor: 'rgba(243, 156, 18, 0.6)', gradient: 'linear-gradient(135deg, #e67e22, #ca6f1e)', nightAction: false },
  bodyguard: { icon: '🛡️', color: '#2980b9', glowColor: 'rgba(41, 128, 185, 0.5)', gradient: 'linear-gradient(135deg, #1f618d, #1a5276)', nightAction: true },
  silencer: { icon: '🤫', color: '#884ea0', glowColor: 'rgba(136, 78, 160, 0.5)', gradient: 'linear-gradient(135deg, #7d3c98, #6c3483)', nightAction: true },
};

const FACTION: Record<string, Faction> = { mafia: 'mafia', village: 'town', jester: 'neutral' };

export const factionOf = (role: MafiaRole): Faction => FACTION[ROLE_TEAM[role]];

export function roleDef(t: Dict, role: MafiaRole): RoleDef {
  const r = t.maf.roles[role];
  return {
    id: role,
    name: r.name,
    faction: factionOf(role),
    description: r.brief,
    ability: r.ability,
    abilityDescription: r.power,
    maxCount: ROLE_MAX[role],
    ...LOOK[role],
  };
}

export interface ViewPlayer {
  id: string;
  username: string;
  avatar: string;
  roleId?: MafiaRole;
  status: 'alive' | 'dead';
  isHost: boolean;
  isConnected: boolean;
  isSilenced: boolean;
}

/** Every seat as the app draws it, with only the roles this seat may know. */
export function viewPlayers(m: MafiaState, room: RoomSnapshot, myId: string, priv: MafiaPrivate | null): ViewPlayer[] {
  const family = new Map((priv?.teammates ?? []).map((x) => [x.id, x.role]));
  return m.seats.map((id) => {
    const p = m.players[id];
    const seat = room.seats.find((s) => s.playerId === id);
    const roleId = m.finalRoles?.[id]
      ?? m.revealed?.[id]
      ?? (id === myId ? priv?.role : undefined)
      ?? family.get(id);
    return {
      id,
      username: p.name,
      avatar: p.name,
      roleId,
      status: p.alive ? 'alive' : 'dead',
      isHost: room.hostId === id,
      isConnected: p.isBot || seat?.connected !== false,
      isSilenced: p.alive && m.silencedToday.includes(id),
    };
  });
}

/** The family's names, as the app keeps them. */
export const teammateNames = (m: MafiaState, priv: MafiaPrivate | null, myId: string): string[] =>
  (priv?.teammates ?? []).filter((x) => x.id !== myId).map((x) => m.players[x.id]?.name ?? '');

export const isMafiaRole = (role: MafiaRole | undefined): boolean => isFamily(role);

/** The app's avatars: a DiceBear adventurer portrait seeded by name. */
export const avatarUrl = (seed: string): string =>
  `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(seed || '?')}&backgroundColor=transparent`;

export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};
