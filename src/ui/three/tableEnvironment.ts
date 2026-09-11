import {
  BackSide, BoxGeometry, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, Scene,
} from 'three';

/* ------------------------------------------------------------------ *
 * What the brass reflects.
 *
 * Metal renders black without an environment to mirror, so the scene has
 * always had one: three's `RoomEnvironment`, a generic white studio. It
 * works, but it is somebody else's room - a bright neutral box, which is
 * why the gold rail read closer to steel than to gold and the dice caught
 * a cold white edge that exists nowhere in this scene.
 *
 * This is the same trick aimed at this table: a dark room, one warm lamp
 * hanging over the board, a cool bounce from one side, and the wood
 * underneath throwing amber back up. The brass now reflects the room it is
 * actually sitting in.
 *
 * A photographic HDRI would do this too, and in one line. It would also be
 * the first thing this project downloads to draw a frame - the 3D chunk is
 * lazy, but it would still mean an asset to host, license and keep from
 * 404ing, and a studio photograph would sit oddly against art-deco felt.
 * Everything here is geometry and colour, so it costs bytes of code and
 * nothing at runtime beyond the one PMREM pass at startup.
 * ------------------------------------------------------------------ */

/** Emissive slab: a light you can see reflected, not a light that lights. */
function lamp(
  scene: Scene, color: string, intensity: number,
  w: number, h: number,
  pos: [number, number, number], rot: [number, number, number],
) {
  const mesh = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ color, toneMapped: false }),
  );
  mesh.material.color.multiplyScalar(intensity);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  scene.add(mesh);
}

/**
 * Builds the room and hands it over. The caller renders it once through a
 * PMREMGenerator and then disposes it — it is never added to the visible
 * scene, and exists only to be photographed.
 */
export function tableEnvironment(): Scene {
  const scene = new Scene();

  // The room itself: dark, and green rather than neutral, so the reflections
  // sit in the same world as the felt instead of greying it out.
  const shell = new Mesh(
    new BoxGeometry(30, 16, 30),
    new MeshStandardMaterial({ color: '#0a1410', side: BackSide, roughness: 1 }),
  );
  scene.add(shell);

  // The lamp over the table. This is the highlight that runs along the gold
  // rail and the top edge of every plaque, so it is wide and low rather than
  // a point - a small source gives metal a pinprick and no shape.
  lamp(scene, '#ffe6b8', 2.6, 13, 13, [0, 7.4, 0], [Math.PI / 2, 0, 0]);

  // A cooler, dimmer wall on one side keeps the metal from reading as a
  // single flat tone: without a second value there is nothing for the
  // curvature of a piece to modulate.
  lamp(scene, '#9ec7f0', 0.5, 16, 9, [-12, 3, 0], [0, Math.PI / 2, 0]);
  lamp(scene, '#c9a86a', 0.32, 16, 9, [12, 3, 0], [0, -Math.PI / 2, 0]);

  // Bounce off the wood. Warm, weak, and from below, which is what stops the
  // undersides of the pieces going dead black.
  lamp(scene, '#6b4a2a', 0.5, 26, 26, [0, -3.2, 0], [-Math.PI / 2, 0, 0]);

  return scene;
}

/** Frees everything the environment scene allocated. */
export function disposeEnvironment(scene: Scene) {
  scene.traverse((obj) => {
    const m = obj as Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
