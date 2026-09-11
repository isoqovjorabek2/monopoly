import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending, CanvasTexture, DoubleSide, MathUtils, SRGBColorSpace,
  type Group, type Mesh, type MeshBasicMaterial,
} from 'three';
import { BASE_H, TILE_H, tileLayout } from './layout';

/* ------------------------------------------------------------------ *
 * "Where are they?", answered on the board itself.
 *
 * The board already knows where every piece is; what it could not do was
 * point. Saying "Position: St. James" in a panel makes the reader do the
 * search themselves, and drawing a second little board beside the real one
 * asks them to hold two maps at once.
 *
 * So the real board answers, the way a game does it: a shaft of light
 * standing on the square, visible over the felt from any seat. It follows
 * the piece if it moves and goes out when nobody is asking.
 *
 * Drawn from geometry and one generated gradient, like everything else in
 * this scene - no sprite to download, no texture to 404.
 * ------------------------------------------------------------------ */

const HEIGHT = 3.4;

/* Built once for the life of the page, not once per hover. The beacon mounts
 * and unmounts every time the pointer crosses a player card, and a fresh
 * canvas plus a GPU upload each time is a lot of work to show the same four
 * hundred pixel gradient. It is tinted per player by the material's colour,
 * so one texture serves everyone. */
let shared: CanvasTexture | null = null;

function shaftTexture(): CanvasTexture {
  if (shared) return shared;
  shared = buildShaft();
  return shared;
}

/** A vertical gradient: solid at the felt, gone by the top. Additive, so the
 *  black end contributes nothing and there is no alpha channel to carry. */
function buildShaft(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.42)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function Beacon3D({ spaceId, color }: { spaceId: number; color: string }) {
  const { x, z } = useMemo(() => tileLayout(spaceId), [spaceId]);
  // Shared, so it is deliberately not disposed here - the next hover wants it.
  const tex = shaftTexture();

  const group = useRef<Group>(null);
  const shaft = useRef<Mesh>(null);
  const halo = useRef<Mesh>(null);
  const born = useRef(0);

  // Slide to the new square rather than cutting: when the beacon jumps
  // between two players it should read as the same light moving, which is
  // also what makes it obvious they are on different sides of the board.
  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    if (born.current === 0) {
      born.current = state.clock.elapsedTime;
      // Start on the square rather than sliding in from the origin.
      g.position.set(x, 0, z);
    }
    const age = state.clock.elapsedTime - born.current;

    g.position.x = MathUtils.damp(g.position.x, x, 9, dt);
    g.position.z = MathUtils.damp(g.position.z, z, 9, dt);

    // Rise on arrival, then breathe.
    const rise = Math.min(1, age / 0.42);
    const breathe = 0.92 + Math.sin(state.clock.elapsedTime * 2.4) * 0.08;
    if (shaft.current) {
      shaft.current.scale.y = rise;
      shaft.current.position.y = (HEIGHT * rise) / 2 + BASE_H / 2 + TILE_H;
      (shaft.current.material as MeshBasicMaterial).opacity = rise * breathe * 0.72;
      shaft.current.rotation.y += dt * 0.35;
    }
    if (halo.current) {
      const s = rise * (0.94 + Math.sin(state.clock.elapsedTime * 2.4) * 0.06);
      halo.current.scale.setScalar(s);
      (halo.current.material as MeshBasicMaterial).opacity = rise * 0.5;
    }
  });

  return (
    <group ref={group}>
      {/* The shaft. Open-ended and double sided so it reads as light rather
          than as a plastic tube, and never writes depth - a beam that
          occludes the pieces it is pointing at would be worse than none. */}
      <mesh ref={shaft} position={[0, BASE_H / 2 + TILE_H, 0]}>
        <cylinderGeometry args={[0.62, 0.34, HEIGHT, 20, 1, true]} />
        <meshBasicMaterial
          map={tex}
          color={color}
          transparent
          opacity={0.7}
          side={DoubleSide}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* The pool it stands in, so the square itself is marked and not just
          the air above it. */}
      <mesh
        ref={halo}
        position={[0, BASE_H / 2 + TILE_H + 0.004, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[0.52, 28]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.5}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
