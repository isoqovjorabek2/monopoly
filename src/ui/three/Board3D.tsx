import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, CanvasTexture, DoubleSide, MathUtils, NeutralToneMapping,
  PMREMGenerator, SRGBColorSpace, Vector3, type Mesh,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ART, TABLE } from '../../art/art';
import { useArtTexture } from './artTexture';
import { BOARD } from '../../game/board';
import type { GameState, Space } from '../../game/types';
import {
  BASE_H, HALF, TILE_H, TOTAL,
  buildingPositions, tileLayout, tokenPosition,
} from './layout';
import { makeTileEmissive, makeTileFace, onFaceArtReady } from './tileFace';
import { Building3D, Token3D } from './Token3D';
import { Dice3D } from './Dice3D';

/* ------------------------------------------------------------------ *
 * The board as an object in light rather than a diagram of one.
 *
 * Nothing here decides anything: it reads GameState and the store's
 * animPos exactly like the 2D board does, so both renderers stay
 * interchangeable and the engine never learns that 3D exists.
 * ------------------------------------------------------------------ */

function Tile({ space, ownerColor, mortgaged, highlight, artRev, onSelect }: {
  space: Space;
  ownerColor: string | null;
  mortgaged: boolean;
  highlight: boolean;
  /** Bumped when the generated ornament finishes loading; the face is a
   *  canvas drawn once, so it has to be drawn again to pick the art up. */
  artRev: number;
  onSelect: (id: number) => void;
}) {
  const { x, z, sx, sz, edge } = useMemo(() => tileLayout(space.id), [space.id]);
  const face = useMemo(
    () => makeTileFace(space, sx, sz, edge),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [space, sx, sz, edge, artRev],
  );
  useEffect(() => () => face.dispose(), [face]);

  const glow = useMemo(() => makeTileEmissive(space, sx, sz, edge), [space, sx, sz, edge]);
  useEffect(() => () => glow?.dispose(), [glow]);

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
        {/* Physical rather than standard for the one face that catches the
            light: a clear lacquer coat over the plaque is what makes the
            board read as an object that was made rather than a texture on
            a box, and it costs one material. */}
        <meshPhysicalMaterial
          attach="material-2"
          map={face}
          roughness={0.62}
          metalness={0.05}
          clearcoat={0.65}
          clearcoatRoughness={0.24}
          reflectivity={0.4}
          color={mortgaged ? '#6f6f6f' : '#ffffff'}
          emissiveMap={glow ?? undefined}
          emissive={glow ? '#ffffff' : '#000000'}
          // A mortgaged deed is out of play; its band should read as dead
          // ink rather than lit inlay.
          emissiveIntensity={glow ? (mortgaged ? 0.08 : 0.55) : 0}
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

/**
 * A texture arriving after first paint does not light up on its own: three
 * compiles the shader without USE_MAP and never recompiles, so the surface
 * renders as flat `color` forever. Keying the material on whether the map
 * exists builds a fresh one the moment it lands. This is why the board
 * came out white the first time - the map was ignored and the tint that
 * was meant to darken it was all that showed.
 */
function mapKey(texture: unknown): string {
  return texture ? 'mapped' : 'flat';
}

/**
 * The table the board sits on. Before this the board floated in fog over
 * nothing; a surface underneath gives the shadows something to land on and
 * the fog something to eat. Sized to reach the fog's far edge (44) so it
 * never ends in a visible horizon line.
 */
function Table() {
  const wood = useArtTexture(TABLE, { repeat: 4 });
  if (!wood) return null;
  return (
    <mesh position={[0, -BASE_H / 2 - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[46, 46]} />
      <meshStandardMaterial map={wood} roughness={0.55} metalness={0.05} />
    </mesh>
  );
}

function Felt() {
  // Repeated rather than stretched: one 512px image across a 12-unit block
  // smears the weave into mush at the camera's usual distance.
  const weave = useArtTexture(ART.felt, { repeat: 3 });
  const inner = useArtTexture(ART.felt, { repeat: 2 });

  return (
    <group>
      {/* The block the plaques are set into. The textures are pre-graded to
          average out to the colours below, so a variant swap changes the
          weave and never how dark the board reads. */}
      <mesh position={[0, 0, 0]} receiveShadow castShadow>
        <boxGeometry args={[TOTAL + 0.5, BASE_H, TOTAL + 0.5]} />
        <meshStandardMaterial
          key={mapKey(weave)}
          map={weave ?? undefined}
          color={weave ? '#ffffff' : '#0c2419'}
          roughness={0.95}
          metalness={0}
        />
      </mesh>
      {/* Gold leaf rail around the rim. */}
      <mesh position={[0, BASE_H / 2 + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[HALF + 0.12, HALF + 0.25, 4, 1, Math.PI / 4]} />
        <meshStandardMaterial color="#c8912f" metalness={1} roughness={0.22} side={DoubleSide} />
      </mesh>
      {/* Inner playing surface. Flat colour made this a shade lighter than
          the block; a map cannot be multiplied brighter than itself, so the
          two now share one grade and the roughness split does the
          separating instead. It reads as the same cloth, which it is. */}
      <mesh position={[0, BASE_H / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[TOTAL - 3.3, TOTAL - 3.3]} />
        <meshStandardMaterial
          key={mapKey(inner)}
          map={inner ?? undefined}
          color={inner ? '#ffffff' : '#0e2c1e'}
          roughness={0.98}
        />
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

/**
 * Just inside the inner playing surface (TOTAL - 3.3 = 8.94), so the
 * engraving stops short of the plaques rather than sliding under them.
 */
const MEDALLION_SPAN = 8.6;

/** Deco sunburst printed on the felt: an engraved plate, or drawn wedges. */
function Medallion() {
  const rays = useMemo(() => Array.from({ length: 48 }, (_, i) => (i * Math.PI * 2) / 48), []);
  const plate = useArtTexture(ART.medal);
  const wordmark = useWordmark();
  useEffect(() => () => wordmark.dispose(), [wordmark]);

  // The generated plates are gold on black, so additive blending is the
  // whole transparency story: black contributes nothing to the felt under
  // it and the gold lines glow. No alpha channel needed, which is what
  // keeps these as 30KB JPEGs instead of PNGs several times the size.
  const engraved = plate && (
    <mesh>
      <planeGeometry args={[MEDALLION_SPAN, MEDALLION_SPAN]} />
      <meshBasicMaterial
        map={plate}
        blending={AdditiveBlending}
        transparent
        opacity={0.62}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );

  // The plate carries its own rays and rings, so the drawn ones are the
  // fallback rather than a layer under it - together they read as clutter.
  const drawn = !plate && (
    <>
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
    </>
  );

  // Every plate leaves a clear disc in the middle, but a smaller one than
  // the drawn rings did, so the wordmark comes in to meet it.
  const wordmarkSpan: [number, number] = plate ? [4.0, 2.0] : [5.4, 2.7];

  return (
    <group position={[0, BASE_H / 2 + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {engraved}
      {drawn}
      <mesh position={[0, 0, 0.001]}>
        <planeGeometry args={wordmarkSpan} />
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

const FOV = MathUtils.degToRad(38);

/**
 * How far back the camera has to sit for the whole board to be in frame.
 *
 * The first version of this framed to the raw span and left the board tiny.
 * The second foreshortened it - `span * sin(elevation)` - which is the
 * orthographic answer, and orthographic is exactly what a perspective
 * camera is not: the near edge of the board is closer than the middle, so
 * it subtends a much larger angle than the average. At a 1.8:1 window that
 * approximation put the near edge 22 degrees off the view axis against a 19
 * degree half-FOV, and the front row of the board was cropped off the
 * bottom of the screen.
 *
 * So this asks the real question instead: place the four corners, and find
 * the smallest distance at which all of them are inside the frustum. The
 * angle shrinks monotonically as the camera retreats, which makes a bisection
 * both correct and quick, and it runs once per resize.
 */
function fitDistance(aspect: number): number {
  const tanHalf = Math.tan(FOV / 2);
  // Padded past the board itself: the rig leans toward the active square,
  // and an edge fitted exactly is an edge that clips the moment it moves.
  const hs = HALF + 0.9;
  const y = BASE_H / 2 + TILE_H;
  const corners: [number, number, number][] = [
    [-hs, y, -hs], [hs, y, -hs], [-hs, y, hs], [hs, y, hs],
  ];

  const fits = (d: number): boolean => {
    const h = d * Math.sin(ELEVATION);
    const z = d * Math.cos(ELEVATION);
    // Camera looks at the origin from (0, h, z) with world up, which makes
    // its basis exactly right = x, up = (0, z, -h)/d, forward = (0, -h, -z)/d.
    for (const [px, py, pz] of corners) {
      const dy = py - h;
      const dz = pz - z;
      const depth = (dy * -h + dz * -z) / d;
      if (!(depth > 0)) return false;
      const yCam = (dy * z - dz * h) / d;
      if (Math.abs(yCam) > tanHalf * depth) return false;
      if (Math.abs(px) > tanHalf * aspect * depth) return false;
    }
    return true;
  };

  let lo = 6;
  let hi = 48;
  if (!fits(hi)) return hi;
  for (let i = 0; i < 34; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return MathUtils.clamp(hi * 1.03, 9, 48);
}

function Rig({ focus, cinematic }: { focus: [number, number, number] | null; cinematic: boolean }) {
  const { camera, size } = useThree();
  const target = useRef(new Vector3(0, 0, 0));
  const home = useRef(new Vector3(0, 12.2, 12.6));

  useEffect(() => {
    // Guarded hard: a zero width on the first measure makes this Infinity,
    // and one NaN in the camera matrix silently blanks the whole scene.
    if (!(size.width > 0) || !(size.height > 0)) return;

    const aspect = size.width / size.height;
    const dist = fitDistance(aspect);
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
  /** The GPU dropped the context; the caller decides whether to retry. */
  onContextLost?: () => void;
}

export default function Board3D({
  state, animPos, rolling, highlight, onInspect, quality, onReady, onContextLost,
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

  /* One subscription for the board rather than forty: every face rebuilds
   * on the same tick when the ornament lands. */
  const [artRev, setArtRev] = useState(0);
  useEffect(() => onFaceArtReady(() => setArtRev((n) => n + 1)), []);

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
      /* ACES Filmic - what r3f reaches for by default - is a film curve,
         and film curves desaturate saturated colour on purpose. On a board
         whose whole legibility rests on eight flat colours being told
         apart, that is the wrong trade: the same eight read vividly on the
         flat board and washed out here. Khronos PBR Neutral tone maps the
         highlights without taking the chroma with them. */
      gl={{
        antialias: quality === 'high',
        powerPreference: 'high-performance',
        toneMapping: NeutralToneMapping,
      }}
      camera={{ fov: 38, position: [0, 12.2, 12.6], near: 0.1, far: 90 }}
      style={{ width: '100%', height: '100%', touchAction: 'pan-y' }}
      onCreated={({ gl, scene }) => {
        // Metal needs something to reflect or it renders black. RoomEnvironment
        // builds a small studio cube in memory - no HDRI to download, which
        // matters on a host with no backend.
        const pmrem = new PMREMGenerator(gl);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();

        // A lost context is not rare on laptops that switch GPUs or throttle
        // under memory pressure, and nothing recovers from it on its own:
        // three stops drawing and the canvas paints solid white over the
        // board. preventDefault is what lets the browser hand a context back
        // at all; the caller remounts the scene on top of that.
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          onContextLost?.();
        });

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
        <Table />
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
              artRev={artRev}
              onSelect={onInspect}
            />
          );
        })}

        {/* flatMap, not map: a nested array of children has no key of its
            own, and React reconciles the whole row of buildings from
            scratch every time any one property is improved. */}
        {Object.entries(state.properties).flatMap(([key, st]) => {
          const id = Number(key);
          if (!st.houses) return [];
          const hotel = st.houses === 5;
          return buildingPositions(id, hotel ? 1 : st.houses).map((p, i) => (
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
