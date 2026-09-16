import { createContext, useContext, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, type Group } from 'three';
import { normalizeToken } from '../../game/settings';
import type { SkinId, TokenId } from '../../game/types';

/* Pieces are assembled from primitives rather than loaded as models: the
 * whole set is a few hundred triangles, there is nothing to download, and
 * the metal is defined by material and lighting rather than by a texture. */

interface PartProps { color: string }

/* A Plus finish (see net/plus.ts) is the material the whole piece is cast in,
 * set once for the piece rather than threaded through every part. */
const FinishContext = createContext<SkinId>('classic');

function Metal({ color, rough = 0.25 }: { color: string; rough?: number }) {
  const finish = useContext(FinishContext);
  if (finish === 'mirror') return <meshStandardMaterial color={color} metalness={1} roughness={0.04} />;
  if (finish === 'glass') {
    return (
      <meshPhysicalMaterial
        color={color} metalness={0} roughness={0.06} transmission={0.85} thickness={0.35} ior={1.45}
        transparent opacity={0.9}
      />
    );
  }
  if (finish === 'neon') {
    return <meshStandardMaterial color="#0b0f0d" emissive={color} emissiveIntensity={1.5} metalness={0.2} roughness={0.45} toneMapped={false} />;
  }
  if (finish === 'gilded') return <meshStandardMaterial color={color} metalness={1} roughness={0.16} />;
  return <meshStandardMaterial color={color} metalness={0.92} roughness={rough} />;
}

function Camel({ color }: PartProps) {
  return (
    <group>
      {/* Bactrian: a long body, two humps, the neck thrown forward and up. */}
      <mesh position={[0, 0.22, 0]} castShadow>
        <boxGeometry args={[0.4, 0.12, 0.16]} />
        <Metal color={color} />
      </mesh>
      {[-0.1, 0.08].map((x, i) => (
        <mesh key={i} position={[x, 0.29, 0]} castShadow>
          <sphereGeometry args={[0.075, 14, 10]} />
          <Metal color={color} />
        </mesh>
      ))}
      <mesh position={[0.24, 0.32, 0]} rotation={[0, 0, -0.5]} castShadow>
        <boxGeometry args={[0.07, 0.22, 0.07]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0.32, 0.42, 0]}>
        <boxGeometry args={[0.13, 0.07, 0.07]} />
        <Metal color={color} />
      </mesh>
      {[[-0.15, 0.05], [-0.15, -0.05], [0.14, 0.05], [0.14, -0.05]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.08, z]}>
          <boxGeometry args={[0.045, 0.17, 0.045]} />
          <Metal color={color} />
        </mesh>
      ))}
    </group>
  );
}

function Teapot({ color }: PartProps) {
  return (
    <group>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 0.04, 20]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0, 0.17, 0]} scale={[1, 0.8, 1]} castShadow>
        <sphereGeometry args={[0.19, 22, 16]} />
        <Metal color={color} rough={0.2} />
      </mesh>
      <mesh position={[0, 0.33, 0]}>
        <cylinderGeometry args={[0.07, 0.1, 0.05, 20]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0, 0.38, 0]}>
        <sphereGeometry args={[0.03, 10, 8]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0.24, 0.22, 0]} rotation={[0, 0, -0.9]}>
        <cylinderGeometry args={[0.018, 0.035, 0.16, 10]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[-0.2, 0.18, 0]}>
        <torusGeometry args={[0.07, 0.02, 8, 16]} />
        <Metal color={color} />
      </mesh>
    </group>
  );
}

function Lamp({ color }: PartProps) {
  return (
    <group>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.09, 0.12, 0.06, 20]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0, 0.13, 0]} scale={[1.35, 0.6, 1]} castShadow>
        <sphereGeometry args={[0.15, 22, 14]} />
        <Metal color={color} rough={0.2} />
      </mesh>
      <mesh position={[0.25, 0.17, 0]} rotation={[0, 0, -1.2]}>
        <cylinderGeometry args={[0.02, 0.045, 0.16, 12]} />
        <Metal color={color} />
      </mesh>
      {/* The flame is the one part that is not metal: it glows. */}
      <mesh position={[0.33, 0.26, 0]}>
        <coneGeometry args={[0.03, 0.09, 10]} />
        <meshStandardMaterial color="#ffb347" emissive="#ff8a1c" emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <mesh position={[-0.22, 0.16, 0]}>
        <torusGeometry args={[0.06, 0.018, 8, 16]} />
        <Metal color={color} />
      </mesh>
    </group>
  );
}

function Pomegranate({ color }: PartProps) {
  return (
    <group>
      <mesh position={[0, 0.2, 0]} castShadow>
        <sphereGeometry args={[0.2, 24, 18]} />
        <Metal color={color} rough={0.3} />
      </mesh>
      <mesh position={[0, 0.41, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 0.05, 12]} />
        <Metal color={color} />
      </mesh>
      {/* The crown: six points, each leaning out from the centre. */}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * 0.05, 0.46, Math.sin(a) * 0.05]}
            rotation={[Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]}
          >
            <coneGeometry args={[0.02, 0.07, 6]} />
            <Metal color={color} />
          </mesh>
        );
      })}
    </group>
  );
}

function Dutar({ color }: PartProps) {
  return (
    <group rotation={[0, 0, -0.18]}>
      {/* Stood on its bowl: the pear body, and the long neck it is known by. */}
      <mesh position={[0, 0.15, 0]} scale={[1, 1.15, 0.7]} castShadow>
        <sphereGeometry args={[0.13, 20, 14]} />
        <Metal color={color} rough={0.2} />
      </mesh>
      <mesh position={[0, 0.36, 0]} castShadow>
        <boxGeometry args={[0.04, 0.26, 0.03]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0, 0.52, 0]}>
        <boxGeometry args={[0.06, 0.06, 0.04]} />
        <Metal color={color} />
      </mesh>
      {[-0.035, 0.035].map((x, i) => (
        <mesh key={i} position={[x, 0.52, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.008, 0.008, 0.05, 6]} />
          <Metal color={color} />
        </mesh>
      ))}
    </group>
  );
}

function Horse({ color }: PartProps) {
  return (
    <group>
      <mesh position={[0, 0.24, 0]} castShadow>
        <boxGeometry args={[0.36, 0.13, 0.14]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0.2, 0.34, 0]} rotation={[0, 0, -0.45]} castShadow>
        <boxGeometry args={[0.08, 0.2, 0.08]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0.29, 0.41, 0]} rotation={[0, 0, 0.93]}>
        <boxGeometry args={[0.07, 0.15, 0.07]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[-0.21, 0.2, 0]} rotation={[0, 0, -0.5]}>
        <boxGeometry args={[0.03, 0.14, 0.04]} />
        <Metal color={color} />
      </mesh>
      {[[-0.13, 0.05], [-0.13, -0.05], [0.13, 0.05], [0.13, -0.05]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.09, z]}>
          <boxGeometry args={[0.04, 0.18, 0.04]} />
          <Metal color={color} />
        </mesh>
      ))}
    </group>
  );
}

function Doppi({ color }: PartProps) {
  return (
    <group>
      {/* The four-sided skullcap: a square crown on a stiff band. A
          four-segment cylinder is a square prism. */}
      <mesh position={[0, 0.07, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <cylinderGeometry args={[0.27, 0.27, 0.14, 4]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0, 0.23, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.27, 0.18, 4]} />
        <Metal color={color} rough={0.3} />
      </mesh>
      <mesh position={[0, 0.07, 0]} rotation={[0, Math.PI / 4, 0]}>
        <cylinderGeometry args={[0.275, 0.275, 0.03, 4]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.4} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Minaret({ color }: PartProps) {
  return (
    <group>
      <mesh position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.16, 0.17, 0.06, 20]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0, 0.26, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.13, 0.42, 20]} />
        <Metal color={color} rough={0.3} />
      </mesh>
      {/* Two brick bands on the taper, then the gallery and the dome. */}
      {[[0.17, 0.12], [0.33, 0.1]].map(([y, r], i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[r, 0.012, 6, 20]} />
          <Metal color={color} />
        </mesh>
      ))}
      <mesh position={[0, 0.49, 0]}>
        <cylinderGeometry args={[0.12, 0.09, 0.05, 20]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0, 0.515, 0]}>
        <sphereGeometry args={[0.07, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <Metal color={color} />
      </mesh>
    </group>
  );
}

const SHAPES: Record<TokenId, (p: PartProps) => JSX.Element> = {
  camel: Camel,
  teapot: Teapot,
  lamp: Lamp,
  pomegranate: Pomegranate,
  dutar: Dutar,
  horse: Horse,
  doppi: Doppi,
  minaret: Minaret,
};

export function Token3D({
  token, color, position, active, jailed, finish = 'classic',
}: {
  token: TokenId;
  color: string;
  position: [number, number, number];
  active: boolean;
  jailed: boolean;
  /** A Plus player's finish; classic for everyone else. */
  finish?: SkinId;
}) {
  const group = useRef<Group>(null);
  const current = useRef<[number, number, number]>(position);
  const hop = useRef(0);
  const Shape = SHAPES[normalizeToken(token)];

  // A brighter, desaturated-toward-white version reads as polished metal.
  // Gilded pieces are the player's colour worked halfway into gold.
  const metal = useMemo(() => {
    const c = new Color(color);
    if (finish === 'gilded') c.lerp(new Color('#e3b654'), 0.55);
    else c.lerp(new Color('#ffffff'), 0.18);
    return `#${c.getHexString()}`;
  }, [color, finish]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const [tx, , tz] = position;
    const [cx, cy, cz] = current.current;

    // Ease toward the target square; every step of a walk arrives as a new
    // position, so this turns discrete hops into continuous motion.
    const k = 1 - Math.exp(-dt * 11);
    const nx = cx + (tx - cx) * k;
    const nz = cz + (tz - cz) * k;
    const dist = Math.hypot(tx - nx, tz - nz);

    // Arc: lift while travelling, settle with a small bounce.
    if (dist > 0.02) hop.current = Math.min(1, hop.current + dt * 6);
    else hop.current = Math.max(0, hop.current - dt * 7);
    const lift = Math.sin(hop.current * Math.PI) * 0.22;

    current.current = [nx, cy, nz];
    g.position.set(nx, position[1] + lift, nz);
    g.rotation.y += dt * (active ? 0.5 : 0.12);
    const squash = 1 + Math.sin(hop.current * Math.PI) * 0.08;
    g.scale.set(1 / squash ** 0.4, squash, 1 / squash ** 0.4);
  });

  return (
    <group ref={group} position={position}>
      <group scale={jailed ? 0.85 : 1}>
        <FinishContext.Provider value={finish}>
          <Shape color={metal} />
        </FinishContext.Provider>
        {finish === 'gilded' && (
          <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.2, 0.26, 32]} />
            <meshStandardMaterial color="#e3b654" metalness={1} roughness={0.2} />
          </mesh>
        )}
      </group>
      {active && (
        <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.3, 0.36, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.85} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

/* ------------------------------ buildings ----------------------------- */

export function Building3D({
  position, hotel,
}: { position: [number, number, number]; hotel: boolean }) {
  const color = hotel ? '#e03a36' : '#2ec46a';
  const w = hotel ? 0.3 : 0.15;
  const h = hotel ? 0.18 : 0.13;
  return (
    <group position={position}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <boxGeometry args={[w, h, w * 0.72]} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.55} />
      </mesh>
      <mesh position={[0, h + 0.045, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[w * 0.72, 0.1, 4]} />
        <meshStandardMaterial color={color} metalness={0.15} roughness={0.45} />
      </mesh>
    </group>
  );
}
