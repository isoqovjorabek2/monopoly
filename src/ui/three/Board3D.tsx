import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  CanvasTexture, DoubleSide, MathUtils, PMREMGenerator, SRGBColorSpace, Vector3, type Mesh,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { BOARD } from '../../game/board';
import type { GameState, Space } from '../../game/types';
import {
  BASE_H, HALF, TILE_H, TOTAL,
  buildingPositions, tileLayout, tokenPosition,
} from './layout';
import { makeTileFace } from './tileFace';
import { Building3D, Token3D } from './Token3D';
import { Dice3D } from './Dice3D';

/* ------------------------------------------------------------------ *
 * The board as an object in light rather than a diagram of one.
 *
 * Nothing here decides anything: it reads GameState and the store's
 * animPos exactly like the 2D board does, so both renderers stay
 * interchangeable and the engine never learns that 3D exists.
 * ------------------------------------------------------------------ */

function Tile({ space, ownerColor, mortgaged, highlight, onSelect }: {
  space: Space;
  ownerColor: string | null;
  mortgaged: boolean;
  highlight: boolean;
  onSelect: (id: number) => void;
}) {
  const { x, z, sx, sz, edge } = useMemo(() => tileLayout(space.id), [space.id]);
  const face = useMemo(() => makeTileFace(space, sx, sz, edge), [space, sx, sz, edge]);
  useEffect(() => () => face.dispose(), [face]);

  const mesh = useRef<Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((state, dt) => {
    const m = mesh.current;
    if (!m) return;
    const want = hovered ? 0.06 : highlight
      ? 0.035 + Math.sin(state.clock.elapsedTime * 3) * 0.025
      : 0;
    m.position.y = MathUtils.damp(m.position.y, BASE_H / 2 + want, 12, dt);
  });

  return (
    <group position={[x, 0, z]}>
      <mesh
        ref={mesh}
        position={[0, BASE_H / 2, 0]}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
        onClick={(e) => { e.stopPropagation(); onSelect(space.id); }}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[sx * 0.985, TILE_H, sz * 0.985]} />
        {/* Sides stay dark so the plaques read as separate inlays. */}
        <meshStandardMaterial attach="material-0" color="#0a1f15" roughness={0.85} />
        <meshStandardMaterial attach="material-1" color="#0a1f15" roughness={0.85} />
        <meshStandardMaterial
          attach="material-2"
          map={face}
          roughness={0.72}
          metalness={0.04}
          color={mortgaged ? '#6f6f6f' : '#ffffff'}
        />
        <meshStandardMaterial attach="material-3" color="#08170f" roughness={0.9} />
        <meshStandardMaterial attach="material-4" color="#0a1f15" roughness={0.85} />
        <meshStandardMaterial attach="material-5" color="#0a1f15" roughness={0.85} />
      </mesh>

      {/* Ownership reads as a lit edge along the inner side of the plaque. */}
      {ownerColor && (
        <mesh position={[0, BASE_H + TILE_H * 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[sx * 0.985, sz * 0.985]} />
          <meshBasicMaterial color={ownerColor} transparent opacity={0.16} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

function Felt() {
  return (
    <group>
      {/* The block the plaques are set into. */}
      <mesh position={[0, 0, 0]} receiveShadow castShadow>
        <boxGeometry args={[TOTAL + 0.5, BASE_H, TOTAL + 0.5]} />
        <meshStandardMaterial color="#0c2419" roughness={0.95} metalness={0} />
      </mesh>
      {/* Gold leaf rail around the rim. */}
      <mesh position={[0, BASE_H / 2 + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[HALF + 0.12, HALF + 0.25, 4, 1, Math.PI / 4]} />
        <meshStandardMaterial color="#c8912f" metalness={1} roughness={0.22} side={DoubleSide} />
      </mesh>
      {/* Inner playing surface. */}
      <mesh position={[0, BASE_H / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[TOTAL - 3.3, TOTAL - 3.3]} />
        <meshStandardMaterial color="#0e2c1e" roughness={0.98} />
      </mesh>
    </group>
  );
}

/** The wordmark, printed on the felt as a texture rather than 3D text. */
function useWordmark() {
  return useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const c = canvas.getContext('2d')!;
    c.textAlign = 'center';
    c.textBaseline = 'middle';

    const gold = c.createLinearGradient(0, 150, 0, 300);
    gold.addColorStop(0, '#f2dfae');
    gold.addColorStop(0.55, '#c8912f');
    gold.addColorStop(1, '#7a5314');

    c.fillStyle = gold;
    c.font = '500 132px Oswald, "Arial Narrow", sans-serif';
    c.letterSpacing = '22px';
    c.fillText('MONOPOLY', 512, 222);

    c.fillStyle = '#c8912f';
    c.fillRect(300, 300, 424, 3);

    c.font = '400 52px Oswald, "Arial Narrow", sans-serif';
    c.letterSpacing = '40px';
    c.fillText('ROYALE', 512, 352);

    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }, []);
}

/** Deco sunburst printed on the felt, drawn as thin radial wedges. */
function Medallion() {
  const rays = useMemo(() => Array.from({ length: 48 }, (_, i) => (i * Math.PI * 2) / 48), []);
  const wordmark = useWordmark();
  useEffect(() => () => wordmark.dispose(), [wordmark]);
  return (
    <group position={[0, BASE_H / 2 + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {rays.map((a, i) => (
        <mesh key={i} rotation={[0, 0, a]}>
          <planeGeometry args={[0.07, 3.9]} />
          <meshBasicMaterial color="#c8912f" transparent opacity={i % 2 ? 0.05 : 0.1} toneMapped={false} />
        </mesh>
      ))}
      <mesh>
        <ringGeometry args={[3.0, 3.06, 64]} />
        <meshBasicMaterial color="#c8912f" transparent opacity={0.3} toneMapped={false} />
      </mesh>
      <mesh>
        <ringGeometry args={[1.9, 1.94, 64]} />
        <meshBasicMaterial color="#c8912f" transparent opacity={0.22} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.001]}>
        <planeGeometry args={[5.4, 2.7]} />
        <meshBasicMaterial map={wordmark} transparent opacity={0.9} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/**
 * Camera. Sits back far enough to hold the whole board, and eases toward
 * whatever the game is drawing attention to.
 */
/**
 * How far above the table the camera sits, in radians from the horizon.
 * This is the whole legibility/drama trade: lower is more cinematic but
 * shrinks the far row until its names are unreadable. 57 degrees keeps
 * real depth while every tile stays large enough to read.
 */
const ELEVATION = 1.0;

function Rig({ focus, cinematic }: { focus: [number, number, number] | null; cinematic: boolean }) {
  const { camera, size } = useThree();
  const target = useRef(new Vector3(0, 0, 0));
  const home = useRef(new Vector3(0, 12.2, 12.6));

  useEffect(() => {
    // Guarded hard: a zero width on the first measure makes this Infinity,
    // and one NaN in the camera matrix silently blanks the whole scene.
    if (!(size.width > 0) || !(size.height > 0)) return;

    const aspect = size.width / size.height;
    const fov = MathUtils.degToRad(38);
    const half = Math.tan(fov / 2);
    const span = 13.2;

    // Seen from above at ELEVATION, a flat board's on-screen depth is
    // foreshortened by sin(elevation). Framing to the raw span - the
    // mistake the first pass made - leaves the board tiny in the frame.
    const projectedDepth = span * Math.sin(ELEVATION);
    const distV = projectedDepth / 2 / half;
    const distH = span / 2 / (half * aspect);
    const dist = MathUtils.clamp(Math.max(distV, distH) * 1.06, 9, 48);

    home.current.set(0, dist * Math.sin(ELEVATION), dist * Math.cos(ELEVATION));
  }, [size]);

  useFrame((state, dt) => {
    // A gentle lean toward the action. Anything stronger than this pushes
    // the board off centre and reads as a camera bug rather than attention.
    const wantTarget = cinematic && focus
      ? new Vector3(focus[0] * 0.16, 0, focus[2] * 0.16)
      : new Vector3(0, 0, 0);
    target.current.lerp(wantTarget, 1 - Math.exp(-dt * 2.2));

    const px = state.pointer.x * 0.55;
    const py = state.pointer.y * 0.35;
    const want = new Vector3(
      home.current.x + px + target.current.x * 0.5,
      home.current.y - py,
      home.current.z + target.current.z * 0.5,
    );
    if (!Number.isFinite(want.x + want.y + want.z)) return;
    camera.position.lerp(want, 1 - Math.exp(-dt * 2.4));
    camera.lookAt(target.current.x, 0, target.current.z);
  });

  return null;
}

export interface Board3DProps {
  state: GameState;
  animPos: Record<string, number>;
  rolling: boolean;
  highlight: number | null;
  onInspect: (id: number) => void;
  quality: 'high' | 'low';
  onReady?: () => void;
}

export default function Board3D({
  state, animPos, rolling, highlight, onInspect, quality, onReady,
}: Board3DProps) {
  const current = state.seats[state.seatIndex];

  const bySpace = useMemo(() => {
    const map: Record<number, string[]> = {};
    for (const id of state.seats) {
      if (state.players[id].bankrupt) continue;
      const pos = animPos[id] ?? state.players[id].position;
      (map[pos] ??= []).push(id);
    }
    return map;
  }, [state, animPos]);

  const focus = useMemo<[number, number, number] | null>(() => {
    const pos = animPos[current] ?? state.players[current]?.position;
    if (pos == null) return null;
    const { x, z } = tileLayout(pos);
    return [x, 0, z];
  }, [current, animPos, state]);

  return (
    <Canvas
      shadows={quality === 'high'}
      dpr={quality === 'high' ? [1, 2] : 1}
      gl={{ antialias: quality === 'high', powerPreference: 'high-performance' }}
      camera={{ fov: 38, position: [0, 12.2, 12.6], near: 0.1, far: 90 }}
      style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}
      onCreated={({ gl, scene }) => {
        // Metal needs something to reflect or it renders black. RoomEnvironment
        // builds a small studio cube in memory - no HDRI to download, which
        // matters on a host with no backend.
        const pmrem = new PMREMGenerator(gl);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
        // Reveal only once a frame has actually been drawn.
        requestAnimationFrame(() => requestAnimationFrame(() => onReady?.()));
      }}
    >
      <color attach="background" args={['#05100c']} />
      <fog attach="fog" args={['#05100c', 22, 44]} />

      <ambientLight intensity={0.5} />
      <directionalLight
        position={[7, 14, 8]}
        intensity={2.1}
        castShadow={quality === 'high'}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      <pointLight position={[-8, 6, -6]} intensity={26} color="#e0be76" distance={30} />
      <pointLight position={[8, 5, 8]} intensity={14} color="#6fb6ef" distance={26} />

      <Suspense fallback={null}>
        <Felt />
        <Medallion />

        {BOARD.map((space) => {
          const st = state.properties[space.id];
          const owner = st?.owner ? state.players[st.owner] : null;
          return (
            <Tile
              key={space.id}
              space={space}
              ownerColor={owner ? owner.color : null}
              mortgaged={st?.mortgaged ?? false}
              highlight={highlight === space.id}
              onSelect={onInspect}
            />
          );
        })}

        {Object.entries(state.properties).map(([key, st]) => {
          const id = Number(key);
          if (!st.houses) return null;
          const hotel = st.houses === 5;
          const spots = buildingPositions(id, hotel ? 1 : st.houses);
          return spots.map((p, i) => (
            <Building3D key={`${id}-${i}`} position={p} hotel={hotel} />
          ));
        })}

        {Object.entries(bySpace).flatMap(([pos, ids]) =>
          ids.map((id, i) => {
            const p = state.players[id];
            return (
              <Token3D
                key={id}
                token={p.token}
                color={p.color}
                position={tokenPosition(Number(pos), i)}
                active={id === current}
                jailed={p.inJail}
              />
            );
          }))}

        <group position={[0, BASE_H / 2, 1.4]}>
          <Dice3D dice={state.dice} rolling={rolling} />
        </group>
      </Suspense>

      <Rig focus={focus} cinematic />
    </Canvas>
  );
}
