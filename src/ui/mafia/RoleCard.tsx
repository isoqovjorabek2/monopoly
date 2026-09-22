import { useRef, type CSSProperties, type FC } from 'react';
import { useT } from '../../i18n';
import type { RoleDef } from './model';

/* ------------------------------------------------------------------ *
 * The Mafia app's role card, ported as it was: an engraved frame, a
 * drawn scene for each role, the faction medallion. Only the words come
 * from Omertà's dictionaries, so the card reads in every language.
 * ------------------------------------------------------------------ */

/* ─── Per-role colour tokens (tuned for dark card backgrounds) ─── */
export const ROLE_COLORS: Record<string, { c: string; glow: string }> = {
  mafia:     { c: "#e94e3a", glow: "rgba(233,78,58,0.55)" },
  godfather: { c: "#c0392b", glow: "rgba(192,57,43,0.55)" },
  silencer:  { c: "#a978d6", glow: "rgba(169,120,214,0.5)" },
  detective: { c: "#4ea0e9", glow: "rgba(78,160,233,0.5)" },
  doctor:    { c: "#6dc28a", glow: "rgba(109,194,138,0.5)" },
  bodyguard: { c: "#5fb3d4", glow: "rgba(95,179,212,0.45)" },
  sniper:    { c: "#e9c97a", glow: "rgba(233,201,122,0.5)" },
  villager:  { c: "#c89b4a", glow: "rgba(200,155,74,0.4)" },
  jester:    { c: "#a978d6", glow: "rgba(169,120,214,0.5)" },
  cover:     { c: "#c89b4a", glow: "rgba(233,201,122,0.55)" },
};

/* ═══════════════════════════════════════════════════════════════
   SVG ART COMPONENTS  (viewBox 240×150)
   uid = role.id keeps gradient IDs unique across multiple cards
   ═══════════════════════════════════════════════════════════════ */

function Backlight({ uid, color }: { uid: string; color: string }) {
  return (
    <>
      <defs>
        <radialGradient id={`bl-${uid}`} cx="50%" cy="58%" r="50%">
          <stop offset="0%"   stopColor={color} stopOpacity="0.7" />
          <stop offset="40%"  stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="240" height="150" fill={`url(#bl-${uid})`} />
    </>
  );
}

function ArtMafia({ color, uid }: { color: string; glow: string; uid: string }) {
  return (
    <svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
      <Backlight uid={uid} color={color} />
      {/* blood moon */}
      <circle cx="120" cy="78" r="72" fill={color} opacity="0.22" />
      <circle cx="120" cy="78" r="72" fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="0.8" />
      <circle cx="120" cy="78" r="60" fill="none" stroke={color} strokeOpacity="0.18" />
      {/* city */}
      <path d="M0,150 L0,114 L14,114 L14,104 L26,104 L26,118 L40,118 L40,98 L52,98 L52,112 L68,112 L68,100 L82,100 L82,116 L98,116 L98,108 L114,108 L114,118 L128,118 L128,104 L142,104 L142,114 L156,114 L156,102 L172,102 L172,116 L186,116 L186,108 L200,108 L200,118 L216,118 L216,112 L230,112 L230,118 L240,118 L240,150 Z"
        fill="#000" opacity="0.92" />
      {/* hooded figure */}
      <g transform="translate(120,75)">
        <path d="M-58,75 L-58,46 Q-38,28 -16,24 L-14,8 L14,8 L16,24 Q38,28 58,46 L58,75 Z" fill="#020203" />
        <path d="M-14,8 L-22,-12 Q-22,-30 -16,-34 L-32,-40 L-34,-50 Q-30,-66 0,-70 Q30,-66 34,-50 L32,-40 L16,-34 Q22,-30 22,-12 L14,8 Z" fill="#000" />
        <ellipse cx="0" cy="-40" rx="46" ry="3.5" fill="#000" />
        <path d="M-30,-42 Q-30,-60 0,-66 Q30,-60 30,-42 Z" fill="#000" />
        <path d="M-28,-50 Q-12,-48 0,-48 Q12,-48 28,-50 L28,-46 Q12,-44 0,-44 Q-12,-44 -28,-46 Z" fill="#0e0608" />
        <path d="M-2,8 L2,8 L4,42 L-4,42 Z" fill={color} opacity="0.65" />
        <ellipse cx="0" cy="-22" rx="14" ry="4" fill={color} opacity="0.12" />
        <circle cx="16" cy="-12" r="1.6" fill="#ff8033">
          <animate attributeName="opacity" values="0.5;1;0.6;1" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="16" cy="-12" r="5" fill="#ff5020" opacity="0.35" />
      </g>
    </svg>
  );
}

function ArtGodfather({ color, glow, uid }: { color: string; glow: string; uid: string }) {
  return (
    <svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
      <Backlight uid={uid} color={color} />
      {/* throne */}
      <path d="M40,150 L40,28 Q40,8 70,6 L82,6 L82,150 Z" fill="#080407" />
      <path d="M200,150 L200,28 Q200,8 170,6 L158,6 L158,150 Z" fill="#080407" />
      <path d="M80,150 L80,18 Q80,4 100,2 L140,2 Q160,4 160,18 L160,150 Z" fill="#0c0608" />
      <g stroke={color} strokeOpacity="0.32" strokeWidth="0.6">
        <line x1="86" y1="30" x2="154" y2="30" /><line x1="86" y1="50" x2="154" y2="50" />
        <line x1="86" y1="70" x2="154" y2="70" /><line x1="86" y1="92" x2="154" y2="92" />
      </g>
      <path d="M84,16 L156,16" stroke={color} strokeOpacity="0.7" strokeWidth="0.8" />
      <circle cx="86" cy="16" r="2" fill={color} /><circle cx="154" cy="16" r="2" fill={color} />
      {/* crown */}
      <g transform="translate(120,6)">
        <path d="M-18,12 L-14,-2 L-8,8 L-4,-8 L0,4 L4,-8 L8,8 L14,-2 L18,12 Z" fill={color} stroke={color} strokeWidth="0.8" />
        <circle cx="-14" cy="-2" r="2" fill={glow} /><circle cx="0" cy="-8" r="2.5" fill={glow} /><circle cx="14" cy="-2" r="2" fill={glow} />
        <rect x="-18" y="11" width="36" height="3" fill={color} />
      </g>
      {/* figure */}
      <g transform="translate(120,80)">
        <ellipse cx="0" cy="-28" rx="22" ry="2.5" fill="#000" />
        <path d="M-18,-28 Q-18,-44 0,-46 Q18,-44 18,-28 Z" fill="#000" />
        <path d="M-10,-26 L-12,-12 Q-12,-4 -8,0 L8,0 Q12,-4 12,-12 L10,-26 Z" fill="#000" />
        <path d="M-40,70 L-40,18 Q-32,4 -8,2 L-6,8 L6,8 L8,2 Q32,4 40,18 L40,70 Z" fill="#020203" />
        <path d="M-16,8 L0,38 L16,8 L16,12 L0,46 L-16,12 Z" fill="#000" />
        <path d="M-3,38 L3,38 L4,70 L-4,70 Z" fill={color} opacity="0.7" />
        <g transform="translate(-44,38)"><ellipse rx="6" ry="3" fill="#000" /><circle r="1.6" fill={color} /></g>
        <g transform="translate(36,28)" stroke={color} strokeOpacity="0.85" strokeWidth="0.8" fill="none">
          <path d="M-5,-12 L-5,-2 Q-5,4 0,4 Q5,4 5,-2 L5,-12 Z" />
          <path d="M-5,-12 L5,-12 L3,-8 Q0,-7 -3,-8 Z" fill={color} fillOpacity="0.65" stroke="none" />
          <line x1="0" y1="4" x2="0" y2="14" /><line x1="-4" y1="14" x2="4" y2="14" />
        </g>
      </g>
    </svg>
  );
}

function ArtSilencer({ color, uid }: { color: string; glow: string; uid: string }) {
  return (
    <svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
      <Backlight uid={uid} color={color} />
      <g stroke={color} strokeOpacity="0.4" strokeWidth="1.4" fill="none">
        <path d="M178,46 Q188,75 178,104" /><path d="M196,32 Q214,75 196,118" /><path d="M214,18 Q240,75 214,132" />
        <path d="M62,46 Q52,75 62,104" /><path d="M44,32 Q26,75 44,118" />
      </g>
      <g transform="translate(110,75)">
        <path d="M-30,75 L-30,30 Q-30,4 -10,-8 L-10,-22 Q-6,-42 22,-44 Q44,-42 44,-22 L44,-10 Q56,4 56,30 L56,75 Z" fill="#040406" />
        <path d="M-8,-8 Q-4,-12 0,-10 L4,-2 Q4,4 6,8 L14,8 L18,16 L14,22 L10,22 L8,30 Q4,40 -8,42 Q-16,38 -16,28 L-16,0 Q-12,-4 -8,-8 Z" fill="#1a0d0a" />
        <path d="M14,8 L18,16 L14,22" stroke="#000" strokeWidth="0.6" fill="none" />
        <path d="M-2,4 L6,4" stroke={color} strokeOpacity="0.45" strokeWidth="0.8" />
        <path d="M2,28 L12,28" stroke="#000" strokeWidth="1.2" />
        <path d="M-22,-22 Q-22,-38 18,-42 Q44,-38 44,-22 L44,-18 L-22,-18 Z" fill="#000" />
        <ellipse cx="10" cy="-20" rx="30" ry="2" fill="#000" />
        <g transform="translate(18,18)">
          <path d="M0,18 Q-4,18 -4,12 L-4,-22 Q-4,-28 2,-28 Q8,-28 8,-22 L8,12 Q8,18 4,18 Z" fill={color} stroke="#1a0d0a" strokeWidth="0.8" />
          <ellipse cx="2" cy="-22" rx="3" ry="1.5" fill="#fff" opacity="0.4" />
          <path d="M-4,0 L8,0" stroke="#1a0d0a" strokeOpacity="0.5" />
        </g>
      </g>
      <g stroke="#fff" strokeWidth="2.2" opacity="0.85">
        <line x1="192" y1="48" x2="222" y2="100" /><line x1="222" y1="48" x2="192" y2="100" />
      </g>
    </svg>
  );
}

function ArtSniper({ color, glow, uid }: { color: string; glow: string; uid: string }) {
  return (
    <svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
      <Backlight uid={uid} color={color} />
      <circle cx="120" cy="75" r="60" fill="#020205" stroke={color} strokeOpacity="0.7" strokeWidth="1.5" />
      <circle cx="120" cy="75" r="56" fill="none" stroke={color} strokeOpacity="0.25" />
      <circle cx="120" cy="75" r="42" fill="none" stroke={color} strokeOpacity="0.35" strokeDasharray="2 4" />
      <line x1="60" y1="75" x2="180" y2="75" stroke={color} strokeOpacity="0.9" strokeWidth="0.8" />
      <line x1="120" y1="15" x2="120" y2="135" stroke={color} strokeOpacity="0.9" strokeWidth="0.8" />
      <circle cx="120" cy="75" r="4" fill="none" stroke={color} strokeWidth="0.8" />
      <circle cx="120" cy="75" r="1.4" fill={color} />
      <g stroke={color} strokeOpacity="0.6" strokeWidth="0.6">
        <line x1="74" y1="72" x2="74" y2="78" /><line x1="90" y1="72" x2="90" y2="78" />
        <line x1="150" y1="72" x2="150" y2="78" /><line x1="166" y1="72" x2="166" y2="78" />
        <line x1="117" y1="50" x2="123" y2="50" /><line x1="117" y1="100" x2="123" y2="100" />
      </g>
      <g opacity="0.95">
        <circle cx="120" cy="68" r="3" fill="#0a0608" stroke={color} strokeWidth="0.5" />
        <path d="M120,71 L120,86 M120,76 L114,82 M120,76 L126,82 M120,86 L114,94 M120,86 L126,94" stroke="#0a0608" strokeWidth="1.6" fill="none" />
      </g>
      <g transform="translate(20,128)">
        <path d="M0,0 L20,0 L24,4 L20,8 L0,8 Z" fill={color} opacity="0.75" />
        <path d="M20,0 L24,4 L20,8 Z" fill={glow} />
      </g>
      <text x="120" y="142" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="6" fill={color} opacity="0.7" letterSpacing="0.2em">450m · WIND 03</text>
    </svg>
  );
}

function ArtDetective({ color, uid }: { color: string; glow: string; uid: string }) {
  return (
    <svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
      <Backlight uid={uid} color={color} />
      <path d="M150,28 Q150,12 188,10 Q224,12 224,30 L232,38 L226,40 L156,40 L148,36 Z" fill="#000" opacity="0.85" />
      <g transform="translate(78,40)">
        <circle cx="40" cy="40" r="42" fill="none" stroke={color} strokeWidth="2.5" />
        <circle cx="40" cy="40" r="38" fill="#02030a" />
        <g stroke={color} strokeOpacity="0.85" strokeWidth="0.8" fill="none">
          <path d="M20,42 Q22,28 40,28 Q58,28 60,42" />
          <path d="M24,46 Q26,32 40,32 Q54,32 56,46" />
          <path d="M28,50 Q30,38 40,38 Q50,38 52,50" />
          <path d="M32,52 Q34,42 40,42 Q46,42 48,52" />
          <path d="M36,54 Q38,46 40,46 Q42,46 44,54" />
          <path d="M40,42 L44,50" /><path d="M28,44 L22,42" />
        </g>
        <path d="M16,28 Q22,18 32,16" stroke="white" strokeOpacity="0.18" strokeWidth="3" fill="none" />
        <path d="M70,70 L110,110 L102,118 L62,78 Z" fill={color} opacity="0.9" />
        <path d="M104,112 L122,124 Q126,126 124,130 L120,134 Q116,136 114,134 L100,118 Z" fill={color} />
      </g>
      <g stroke={color} strokeOpacity="0.18" strokeWidth="0.6" fill="none">
        <path d="M30,130 Q34,110 24,90" /><path d="M40,130 Q50,110 38,90 Q34,80 42,68" />
      </g>
    </svg>
  );
}

function ArtDoctor({ color, uid }: { color: string; glow: string; uid: string }) {
  return (
    <svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
      <Backlight uid={uid} color={color} />
      <rect x="170" y="20" width="50" height="60" fill="#02050a" />
      <line x1="195" y1="20" x2="195" y2="80" stroke={color} strokeOpacity="0.15" />
      <line x1="170" y1="50" x2="220" y2="50" stroke={color} strokeOpacity="0.15" />
      <path d="M170,80 L220,80 L226,150 L164,150 Z" fill={color} opacity="0.08" />
      <rect x="20" y="120" width="200" height="6" fill="#0c0608" />
      <g transform="translate(70,52)">
        <rect x="0" y="20" width="100" height="50" rx="4" fill="#0d0d12" stroke={color} strokeOpacity="0.5" strokeWidth="1" />
        <path d="M0,32 Q0,18 24,16 L76,16 Q100,18 100,32" fill="none" stroke={color} strokeOpacity="0.4" strokeWidth="1" />
        <rect x="46" y="14" width="8" height="6" fill={color} />
        <path d="M28,16 Q28,4 50,4 Q72,4 72,16" fill="none" stroke="#0a0a0e" strokeWidth="2.5" />
        <path d="M28,16 Q28,4 50,4 Q72,4 72,16" fill="none" stroke={color} strokeOpacity="0.5" strokeWidth="1" />
        <rect x="44" y="38" width="12" height="20" fill={color} />
        <rect x="38" y="44" width="24" height="8" fill={color} />
        <path d="M4,40 L96,40" stroke={color} strokeOpacity="0.25" strokeDasharray="2 2" />
      </g>
      <g transform="translate(180,80)">
        <rect x="0" y="0" width="8" height="40" rx="1" fill="#0a0a0e" stroke={color} strokeOpacity="0.5" />
        <rect x="0" y="20" width="8" height="20" rx="1" fill={color} opacity="0.7" />
        <rect x="12" y="6" width="8" height="34" rx="1" fill="#0a0a0e" stroke={color} strokeOpacity="0.4" />
        <rect x="12" y="22" width="8" height="18" rx="1" fill={color} opacity="0.4" />
      </g>
      <g transform="translate(28,108)">
        <rect width="36" height="12" fill="#e0d4ad" opacity="0.7" />
        <line x1="2" y1="4" x2="34" y2="4" stroke="#000" strokeOpacity="0.4" />
        <line x1="2" y1="7" x2="28" y2="7" stroke="#000" strokeOpacity="0.4" />
      </g>
    </svg>
  );
}

function ArtBodyguard({ color, glow, uid }: { color: string; glow: string; uid: string }) {
  return (
    <svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
      <Backlight uid={uid} color={color} />
      <g opacity="0.7">
        <path d="M40,150 L40,118 Q70,98 100,96 L104,84 L136,84 L140,96 Q170,98 200,118 L200,150 Z" fill="#020202" />
        <path d="M108,88 L102,72 Q102,54 120,52 Q138,54 138,72 L132,88 Z" fill="#010101" />
      </g>
      <g transform="translate(120,82)">
        <defs>
          <linearGradient id={`shield-${uid}`} x1="0" y1="-50" x2="0" y2="50" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor={color} stopOpacity="0.32" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d="M0,-46 L42,-32 L42,8 Q42,38 0,56 Q-42,38 -42,8 L-42,-32 Z" fill={`url(#shield-${uid})`} stroke={color} strokeWidth="2.2" />
        <path d="M0,-40 L36,-28 L36,6 Q36,32 0,48 Q-36,32 -36,6 L-36,-28 Z" fill="none" stroke={color} strokeOpacity="0.45" strokeWidth="0.8" strokeDasharray="2 3" />
        <rect x="-3.5" y="-22" width="7" height="38" fill={color} />
        <rect x="-18" y="-6" width="36" height="7" fill={color} />
        <circle cx="0" cy="-2.5" r="4.5" fill="#1a0d0a" stroke={color} strokeWidth="1" />
        <circle cx="0" cy="-2.5" r="1.6" fill={glow} />
        <path d="M-22,-30 Q-30,-20 -22,-12 Q-26,-22 -18,-26 Z" fill={color} opacity="0.6" />
        <path d="M22,-30 Q30,-20 22,-12 Q26,-22 18,-26 Z" fill={color} opacity="0.6" />
        <circle cx="-36" cy="-28" r="1.6" fill={color} /><circle cx="36" cy="-28" r="1.6" fill={color} />
        <circle cx="-36" cy="-2" r="1.6" fill={color} /><circle cx="36" cy="-2" r="1.6" fill={color} />
      </g>
      <g transform="translate(80,38)">
        <path d="M0,0 L-10,-6 M0,0 L-12,2 M0,0 L-8,8 M0,0 L4,-10 M0,0 L10,4" stroke="#fff" strokeWidth="1" opacity="0.85" />
        <circle r="3" fill="#fff" opacity="0.9" />
      </g>
      <g transform="translate(174,32) rotate(-22)">
        <path d="M-30,0 L0,0" stroke="#888" strokeOpacity="0.7" strokeDasharray="2 3" />
        <path d="M0,0 L8,-1.6 L11,0 L8,1.6 L0,1.6 Z" fill="#aaa" />
        <path d="M8,-1.6 L11,0 L8,1.6 Z" fill={color} />
      </g>
    </svg>
  );
}

function ArtVillager({ color, uid }: { color: string; glow: string; uid: string }) {
  return (
    <svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
      <Backlight uid={uid} color={color} />
      {Array.from({ length: 14 }).map((_, i) => (
        <circle key={i} cx={10 + i * 16 + (i % 3) * 3} cy={10 + (i % 5) * 8} r="0.6" fill={color} opacity={0.4 + (i % 3) * 0.2} />
      ))}
      {/* church */}
      <path d="M122,42 L132,8 L142,42 Z" fill="#0a0608" />
      <rect x="124" y="42" width="16" height="38" fill="#0a0608" />
      <rect x="130" y="50" width="4" height="8" fill={color} opacity="0.4" />
      <path d="M132,4 L132,10 L134,10 L134,4 L136,4 L132,2 L128,4 Z" fill={color} opacity="0.85" />
      {/* rooftops */}
      <path d="M0,150 L0,90 L20,76 L40,90 L40,150 Z" fill="#070406" />
      <path d="M40,150 L40,96 L60,82 L80,96 L80,150 Z" fill="#0a0608" />
      <path d="M80,150 L80,84 L96,72 L112,84 L112,150 Z" fill="#0d0808" />
      <path d="M112,150 L112,80 L122,72 L142,72 L152,80 L152,150 Z" fill="#0c0808" />
      <path d="M152,150 L152,82 L172,68 L192,82 L192,150 Z" fill="#0a0608" />
      <path d="M192,150 L192,94 L212,80 L232,94 L232,150 Z" fill="#070406" />
      {/* windows */}
      {([
        [12,108],[26,108],[12,124],[26,124],[52,114],[66,114],[52,130],[66,130],
        [88,108],[100,108],[88,124],[100,124],[126,108],[138,108],[126,124],[138,124],
        [162,112],[180,112],[162,128],[180,128],[202,116],[222,116],
      ] as [number, number][]).map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="6" height="6" fill={color} opacity={0.5 + (i % 3) * 0.15} />
      ))}
      {/* lamp */}
      <line x1="118" y1="150" x2="118" y2="118" stroke="#1a0d0a" strokeWidth="2" />
      <circle cx="118" cy="116" r="4" fill={color} />
      <circle cx="118" cy="116" r="10" fill={color} opacity="0.18" />
    </svg>
  );
}

function ArtJester({ color, glow, uid }: { color: string; glow: string; uid: string }) {
  return (
    <svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
      <Backlight uid={uid} color={color} />
      {/* mask */}
      <path d="M120,138 Q72,118 72,80 Q72,54 100,48 L140,48 Q168,54 168,80 Q168,118 120,138 Z" fill="#7a6038" />
      <path d="M120,134 Q78,116 78,82 Q78,58 102,53 L138,53 Q162,58 162,82 Q162,116 120,134 Z" fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="0.8" />
      <path d="M94,82 L102,72 L110,82 L102,92 Z" fill="#08040a" />
      <path d="M130,82 L138,72 L146,82 L138,92 Z" fill="#08040a" />
      <circle cx="103" cy="78" r="1.2" fill={glow} />
      <circle cx="139" cy="78" r="1.2" fill={glow} />
      <path d="M90,66 Q102,58 112,66" stroke="#08040a" strokeWidth="2.2" fill="none" />
      <path d="M128,66 Q138,58 150,66" stroke="#08040a" strokeWidth="2.2" fill="none" />
      <circle cx="106" cy="96" r="2" fill={color} />
      <path d="M106,98 Q104,108 106,116" stroke={color} strokeOpacity="0.7" strokeWidth="1" fill="none" />
      <path d="M96,108 Q120,128 144,108 Q140,118 120,122 Q100,118 96,108 Z" fill="#3a0d14" />
      <path d="M120,82 L116,98 L120,100 L124,98 Z" fill="#5a4020" />
      {/* hat */}
      <path d="M72,54 Q72,42 78,34 L74,18 L88,28 L94,16 L100,30 L112,18 L116,32 L130,30 L130,16 L142,28 L150,16 L156,30 L168,18 L170,32 Q170,42 168,54 Z" fill={color} />
      {/* bells */}
      <circle cx="74" cy="16" r="3.2" fill={glow} stroke="#0a0608" strokeWidth="0.6" />
      <circle cx="120" cy="14" r="3.2" fill={glow} stroke="#0a0608" strokeWidth="0.6" />
      <circle cx="168" cy="16" r="3.2" fill={glow} stroke="#0a0608" strokeWidth="0.6" />
      {/* collar */}
      <path d="M70,126 L82,140 L94,126 L106,140 L118,126 L130,140 L142,126 L154,140 L168,126" stroke={color} strokeWidth="1.5" fill="none" />
    </svg>
  );
}

function ArtCover({ color, uid }: { color: string; glow: string; uid: string }) {
  return (
    <svg viewBox="0 0 240 150" xmlns="http://www.w3.org/2000/svg">
      <Backlight uid={uid} color={color} />
      <circle cx="50" cy="36" r="14" fill={color} opacity="0.5" />
      <circle cx="50" cy="36" r="14" fill="none" stroke={color} strokeOpacity="0.4" />
      <path d="M0,150 L0,116 L18,116 L18,100 L36,100 L36,112 L52,112 L52,90 L66,90 L66,108 L82,108 L82,98 L96,98 L96,110 L112,110 L112,86 L128,86 L128,104 L144,104 L144,94 L158,94 L158,106 L174,106 L174,84 L188,84 L188,108 L204,108 L204,98 L222,98 L222,112 L240,112 L240,150 Z" fill="#0a0608" />
      {([
        [8,124],[24,108],[40,118],[58,98],[74,114],[90,104],[106,116],[122,94],
        [138,110],[154,100],[170,90],[188,114],[208,106],[224,118],
      ] as [number, number][]).map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="3" height="3" fill={color} opacity={0.55 + (i % 3) * 0.15} />
      ))}
      {/* fedora */}
      <g transform="translate(120,72)">
        <ellipse cx="0" cy="14" rx="46" ry="6" fill="#000" />
        <path d="M-32,12 Q-30,-12 0,-16 Q30,-12 32,12 Z" fill="#020202" />
        <path d="M-30,6 Q-12,10 0,10 Q12,10 30,6 L30,2 Q12,5 0,5 Q-12,5 -30,2 Z" fill="#000" />
        <path d="M-30,6 Q-12,10 0,10 Q12,10 30,6" stroke={color} strokeOpacity="0.55" strokeWidth="0.5" fill="none" />
      </g>
      {/* rose */}
      <g transform="translate(120,108)">
        <circle r="10" fill={color} />
        <path d="M-4,-2 Q0,-8 4,-2 Q6,3 0,5 Q-6,3 -4,-2 Z" fill="#7a1d14" />
        <path d="M-3,1 Q0,-3 3,1 Q4,4 0,4 Q-4,4 -3,1 Z" fill="#3a0d0a" />
        <path d="M-9,3 Q-14,8 -8,10 Z" fill="#244020" />
        <path d="M9,3 Q14,8 8,10 Z" fill="#244020" />
      </g>
    </svg>
  );
}

const ART_BY_ROLE: Record<string, FC<{ color: string; glow: string; uid: string }>> = {
  mafia:     ArtMafia,
  godfather: ArtGodfather,
  silencer:  ArtSilencer,
  sniper:    ArtSniper,
  detective: ArtDetective,
  doctor:    ArtDoctor,
  bodyguard: ArtBodyguard,
  villager:  ArtVillager,
  jester:    ArtJester,
  cover:     ArtCover,
};

/* ─── Medallion icon inside the faction circle ─── */
function MedIcon({ roleId, size = 16 }: { roleId: string; size?: number }) {
  const s = size;
  switch (roleId) {
    case "mafia": case "godfather":
      return <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
        <path d="M10,2 L11,12 L10,14 L9,12 Z" fill="currentColor" />
        <path d="M6,12 L14,12 L13,14 L7,14 Z" fill="currentColor" />
        <path d="M9,14 L11,14 L11,18 L9,18 Z" fill="currentColor" />
      </svg>;
    case "silencer":
      return <svg width={s} height={s} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4,8 L4,12 L7,12 L11,15 L11,5 L7,8 Z" fill="currentColor" stroke="none" />
        <path d="M14,7 L18,13 M18,7 L14,13" />
      </svg>;
    case "sniper":
      return <svg width={s} height={s} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="10" cy="10" r="6" />
        <path d="M10,2 L10,5 M10,15 L10,18 M2,10 L5,10 M15,10 L18,10" />
        <circle cx="10" cy="10" r="1" fill="currentColor" />
      </svg>;
    case "detective":
      return <svg width={s} height={s} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="5" /><path d="M12,12 L17,17" />
      </svg>;
    case "doctor":
      return <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
        <rect x="8" y="3" width="4" height="14" fill="currentColor" />
        <rect x="3" y="8" width="14" height="4" fill="currentColor" />
      </svg>;
    case "bodyguard":
      return <svg width={s} height={s} viewBox="0 0 20 20" fill="currentColor" stroke="currentColor">
        <path d="M10,2 L17,5 L17,11 Q17,16 10,18 Q3,16 3,11 L3,5 Z" fillOpacity="0.35" strokeWidth="1.2" />
        <path d="M7,10 L9,12 L13,7" stroke="white" strokeWidth="1.5" fill="none" />
      </svg>;
    case "villager":
      return <svg width={s} height={s} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3,10 L10,3 L17,10 L17,17 L3,17 Z" />
        <rect x="8" y="12" width="4" height="5" fill="currentColor" />
      </svg>;
    case "jester":
      return <svg width={s} height={s} viewBox="0 0 20 20" fill="currentColor">
        <path d="M3,14 L5,5 L8,12 L10,4 L12,12 L15,5 L17,14 Z" />
        <circle cx="5" cy="5" r="1.4" /><circle cx="10" cy="4" r="1.4" /><circle cx="15" cy="5" r="1.4" />
      </svg>;
    default:
      return <svg width={s} height={s} viewBox="0 0 20 20" fill="currentColor">
        <circle cx="10" cy="10" r="6" opacity="0.7" />
      </svg>;
  }
}


/* Natural render width - the .rc CSS was designed at this size */
const NATURAL_W = 220;
const SIZE_W: Record<string, number> = { xs: 60, sm: 88, md: 158, lg: 220 };

interface Props {
  role: RoleDef;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  glowing?: boolean;
  className?: string;
}

export function RoleCard({ role, size = 'md', glowing = false, className = '' }: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const cv = ROLE_COLORS[role.id] ?? { c: role.color, glow: role.glowColor };
  const w = SIZE_W[size];
  const scale = w / NATURAL_W;
  const h = Math.round(w * 452 / 283);
  const Art = ART_BY_ROLE[role.id] ?? ART_BY_ROLE.villager;

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
  };

  return (
    <div className={`tw:relative tw:flex-shrink-0 ${className}`} style={{ width: w, height: h, overflow: 'hidden' }}>
      {glowing && (
        <div
          className="tw:absolute tw:pointer-events-none"
          style={{
            inset: '-20%',
            background: `radial-gradient(ellipse at center, ${cv.glow} 0%, transparent 65%)`,
            filter: 'blur(22px)',
            animation: 'rc-glow-pulse 2.5s ease-in-out infinite',
          }}
        />
      )}
      <div
        ref={ref}
        onMouseMove={onMouseMove}
        className="rc"
        style={{
          position: 'absolute', top: 0, left: 0,
          width: NATURAL_W,
          transformOrigin: 'top left',
          transform: `scale(${scale})`,
          '--rc-c': cv.c,
          '--rc-glow': cv.glow,
        } as CSSProperties}
      >
        <div className="rc__frame" />
        <div className="rc__corner-tr" />
        <div className="rc__corner-bl" />
        <div className="rc__inner">
          <div className="rc__seal" />
          <div className="rc__title">{role.name.toUpperCase()}</div>
          <div className="rc__art">
            <Art color={cv.c} glow={cv.glow} uid={role.id} />
          </div>
          <div className="rc__med-row">
            <div className="rc__divider" />
            <div className="rc__med" style={{ color: cv.c }}>
              <MedIcon roleId={role.id} size={16} />
            </div>
            <div className="rc__team">{t.maf.ui.team[role.faction]}</div>
            {size !== 'sm' && size !== 'xs' && <p className="rc__desc">{role.description}</p>}
            <div className="rc__diamond" />
          </div>
        </div>
        <div className="rc__sheen" />
      </div>
    </div>
  );
}

/** The face-down card, for the shuffle. */
export function RoleCardBack({ size = 'md' }: { size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const cv = ROLE_COLORS.cover;
  const w = SIZE_W[size];
  const scale = w / NATURAL_W;
  const h = Math.round(w * 452 / 283);
  return (
    <div className="tw:relative tw:flex-shrink-0" style={{ width: w, height: h, overflow: 'hidden' }}>
      <div
        className="rc rc--cover"
        style={{
          position: 'absolute', top: 0, left: 0,
          width: NATURAL_W,
          transformOrigin: 'top left',
          transform: `scale(${scale})`,
          '--rc-c': cv.c,
          '--rc-glow': cv.glow,
        } as CSSProperties}
      >
        <div className="rc__frame" />
        <div className="rc__corner-tr" />
        <div className="rc__corner-bl" />
        <div className="rc__inner">
          <div className="rc__seal" />
          <div className="rc__title">OMERTÀ</div>
          <div className="rc__art">
            <ArtCover color={cv.c} glow={cv.glow} uid="cover" />
          </div>
          <div className="rc__med-row">
            <div className="rc__divider" />
            <div className="rc__team">Deal · Deceive · Survive</div>
            <div className="rc__diamond" />
          </div>
        </div>
        <div className="rc__sheen" />
      </div>
    </div>
  );
}
