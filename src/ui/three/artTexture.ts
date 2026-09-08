import { useEffect, useState } from 'react';
import { RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three';

/* ------------------------------------------------------------------ *
 * Loading generated textures without betting the board on them.
 *
 * useLoader() from @react-three/fiber suspends, and a 404 - one wrong
 * base path on a static host is all it takes - throws inside the Canvas,
 * which takes the whole 3D scene down. This loads by hand instead and
 * simply reports null on failure, so every caller can fall back to the
 * procedural drawing it had before.
 * ------------------------------------------------------------------ */

const loader = new TextureLoader();

export interface ArtTextureOptions {
  /** Tiles the image this many times across the surface. 1 maps it once. */
  repeat?: number;
}

export function useArtTexture(url: string, { repeat = 1 }: ArtTextureOptions = {}): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);

  useEffect(() => {
    let live = true;
    let loaded: Texture | null = null;

    loader.load(
      url,
      (tex) => {
        if (!live) { tex.dispose(); return; }
        // Colour maps are authored in sRGB; without this three treats the
        // bytes as linear and the felt comes out washed out and pale.
        tex.colorSpace = SRGBColorSpace;
        tex.anisotropy = 8;
        if (repeat !== 1) {
          tex.wrapS = RepeatWrapping;
          tex.wrapT = RepeatWrapping;
          tex.repeat.set(repeat, repeat);
        }
        loaded = tex;
        setTexture(tex);
      },
      undefined,
      () => { if (live) setTexture(null); },
    );

    return () => {
      live = false;
      loaded?.dispose();
      setTexture(null);
    };
  }, [url, repeat]);

  return texture;
}
