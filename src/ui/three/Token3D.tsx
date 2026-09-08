import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, type Group } from 'three';
import type { TokenId } from '../../game/types';

/* Pieces are assembled from primitives rather than loaded as models: the
 * whole set is a few hundred triangles, there is nothing to download, and
 * the metal is defined by material and lighting rather than by a texture. */

interface PartProps { color: string }

function Metal({ color, rough = 0.25 }: { color: string; rough?: number }) {
  return <meshStandardMaterial color={color} metalness={0.92} roughness={rough} />;
}

function TopHat({ color }: PartProps) {
  return (
    <group>
      <mesh position={[0, 0.04, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.32, 0.06, 24]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0, 0.24, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.17, 0.34, 24]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.175, 0.175, 0.07, 24]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.4} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Roadster({ color }: PartProps) {
  return (
    <group>
      <mesh position={[0, 0.12, 0]} castShadow>
        <boxGeometry args={[0.56, 0.13, 0.26]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[-0.03, 0.24, 0]} castShadow>
        <boxGeometry args={[0.26, 0.13, 0.22]} />
        <Metal color={color} />
      </mesh>
      {[[-0.18, 0.14], [0.18, 0.14], [-0.18, -0.14], [0.18, -0.14]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.07, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.05, 14]} />
          <meshStandardMaterial color="#16120c" metalness={0.3} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

function Terrier({ color }: PartProps) {
  return (
    <group>
      <mesh position={[-0.03, 0.2, 0]} castShadow>
        <boxGeometry args={[0.42, 0.17, 0.19]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0.23, 0.26, 0]} castShadow>
        <boxGeometry args={[0.18, 0.2, 0.17]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0.2, 0.38, 0]}>
        <coneGeometry args={[0.05, 0.1, 4]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[-0.24, 0.3, 0]} rotation={[0, 0, 0.7]}>
        <boxGeometry args={[0.16, 0.05, 0.05]} />
        <Metal color={color} />
      </mesh>
      {[[-0.16, 0.07], [-0.16, -0.07], [0.12, 0.07], [0.12, -0.07]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.06, z]}>
          <boxGeometry args={[0.06, 0.12, 0.06]} />
          <Metal color={color} />
        </mesh>
      ))}
    </group>
  );
}

function Thimble({ color }: PartProps) {
  return (
    <group>
      <mesh position={[0, 0.19, 0]} castShadow>
        <cylinderGeometry args={[0.19, 0.13, 0.38, 22]} />
        <Metal color={color} rough={0.18} />
      </mesh>
      <mesh position={[0, 0.37, 0]}>
        <torusGeometry args={[0.19, 0.026, 8, 22]} />
        <Metal color={color} />
      </mesh>
    </group>
  );
}

function Boot({ color }: PartProps) {
  return (
    <group>
      <mesh position={[-0.06, 0.24, 0]} castShadow>
        <boxGeometry args={[0.2, 0.34, 0.2]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0.06, 0.09, 0]} castShadow>
        <boxGeometry args={[0.44, 0.15, 0.2]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0.06, 0.02, 0]}>
        <boxGeometry args={[0.48, 0.05, 0.23]} />
        <meshStandardMaterial color="#1b1610" metalness={0.3} roughness={0.7} />
      </mesh>
    </group>
  );
}

function Battleship({ color }: PartProps) {
  return (
    <group>
      <mesh position={[0, 0.08, 0]} castShadow>
        <boxGeometry args={[0.62, 0.12, 0.2]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[-0.02, 0.22, 0]} castShadow>
        <boxGeometry args={[0.24, 0.17, 0.15]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[-0.02, 0.36, 0]}>
        <boxGeometry args={[0.1, 0.12, 0.1]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0.14, 0.24, 0]}>
        <cylinderGeometry args={[0.045, 0.05, 0.18, 12]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[-0.02, 0.48, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.14, 6]} />
        <Metal color={color} />
      </mesh>
    </group>
  );
}

function Iron({ color }: PartProps) {
  return (
    <group>
      {/* A three-sided cylinder is a triangular prism: the iron's sole. */}
      <mesh position={[0, 0.08, 0]} rotation={[0, Math.PI / 6, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.13, 3]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.14, 0.032, 8, 16, Math.PI]} />
        <Metal color={color} />
      </mesh>
    </group>
  );
}

function Wheelbarrow({ color }: PartProps) {
  return (
    <group>
      <mesh position={[0.02, 0.2, 0]} rotation={[0, 0, -0.12]} castShadow>
        <boxGeometry args={[0.4, 0.18, 0.24]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[-0.24, 0.09, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.05, 14]} />
        <meshStandardMaterial color="#16120c" metalness={0.3} roughness={0.7} />
      </mesh>
      {[0.09, -0.09].map((z, i) => (
        <mesh key={i} position={[0.28, 0.16, z]} rotation={[0, 0, 0.3]}>
          <boxGeometry args={[0.3, 0.035, 0.035]} />
          <Metal color={color} />
        </mesh>
      ))}
    </group>
  );
}

const SHAPES: Record<TokenId, (p: PartProps) => JSX.Element> = {
  topper: TopHat,
  roadster: Roadster,
  terrier: Terrier,
  thimble: Thimble,
  boot: Boot,
  battleship: Battleship,
  iron: Iron,
  wheelbarrow: Wheelbarrow,
};

export function Token3D({
  token, color, position, active, jailed,
}: {
  token: TokenId;
  color: string;
  position: [number, number, number];
  active: boolean;
  jailed: boolean;
}) {
  const group = useRef<Group>(null);
  const current = useRef<[number, number, number]>(position);
  const hop = useRef(0);
  const Shape = SHAPES[token] ?? TopHat;

  // A brighter, desaturated-toward-white version reads as polished metal.
  const metal = useMemo(() => {
    const c = new Color(color);
    c.lerp(new Color('#ffffff'), 0.18);
    return `#${c.getHexString()}`;
  }, [color]);

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
        <Shape color={metal} />
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
