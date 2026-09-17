#!/usr/bin/env python3
"""Generate the themed-board art sets (Party Hall Plus) with fal.ai.

One board theme is a full dressing: felt cloth, centre medallion, four
corner emblems, ten group motifs and two card backs, written to
public/art/themes/<theme>/ with the names src/art/art.ts resolves.

The engravings follow the house contract: champagne-gold linework on pure
black, composited with `screen` in CSS and 'lighter' on canvas, no alpha.
After download they are downscaled to their shipped size and the black
point is graded to true zero, exactly as the base set was, so the ground
drops out completely instead of laying a haze over the felt.

Usage:
    set FAL_KEY=...            # or put it in fal_key.txt next to this repo
    python scripts/gen_theme_art.py --theme tashkent
    python scripts/gen_theme_art.py --theme europe --only "corners/*"
    python scripts/gen_theme_art.py --theme tashkent --force   # regenerate

Existing files are skipped unless --force. Prints one line per asset.
"""

from __future__ import annotations

import argparse
import fnmatch
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

from PIL import Image

MODELS = ["fal-ai/flux-2-klein-9b", "fal-ai/flux-2/klein/9b"]

# ------------------------------------------------------------------ prompts --

GOLD = ("fine line engraving, champagne gold ink on pure black background, "
        "single centered vignette, no text, no letters, no watermark")

TASHKENT_STYLE = (GOLD + ", intricate Uzbek girih geometric ornament, "
                  "Central Asian ceramic islimi arabesque detail")

EUROPE_STYLE = (GOLD + ", art nouveau whiplash curves, laurel and fan ornament, "
                "1900s grand hotel print")

# kind: 'engraved' (black-graded) or 'texture' (full-bleed cloth)
ASSETS = {
    "tashkent": [
        ("table.jpg", 512, 512, "texture",
         "Seamless dark wood texture, deep espresso walnut with a cool smoky teal-grey cast, "
         "fine straight grain, polished matte lacquer, evenly lit, flat top-down texture, "
         "tileable, no objects, no pattern, no text"),
        ("felt.jpg", 512, 512, "texture",
         "Seamless woven cloth texture, deep dark teal velvet felt fabric, fine woven fibres, "
         "very subtle sheen, evenly lit, flat top-down texture, dark and moody, tileable, "
         "no objects, no pattern, no text"),
        ("medal.jpg", 768, 768, "engraved",
         f"{TASHKENT_STYLE}, circular medallion of an eight-pointed girih star rosette, "
         "concentric rings of interlaced geometric star pattern radiating outward"),
        ("corners/go.jpg", 320, 320, "engraved",
         f"{TASHKENT_STYLE}, a grand iwan portal arch with a rising sun above it, "
         "the start of a journey, small caravan silhouettes passing through"),
        ("corners/jail.jpg", 320, 320, "engraved",
         f"{TASHKENT_STYLE}, an ancient brick zindan prison tower with a domed top "
         "and one small barred window"),
        ("corners/parking.jpg", 320, 320, "engraved",
         f"{TASHKENT_STYLE}, a resting camel beside a courtyard fountain under a "
         "mulberry tree, a traveller's rest"),
        ("corners/gotojail.jpg", 320, 320, "engraved",
         f"{TASHKENT_STYLE}, crossed guard sabres above a pair of iron shackles"),
        ("groups/brown.jpg", 256, 256, "engraved",
         f"{TASHKENT_STYLE}, old mahalla mudbrick houses with carved wooden doors and poplar trees"),
        ("groups/lightblue.jpg", 256, 256, "engraved",
         f"{TASHKENT_STYLE}, a madrasa facade with twin minarets and a turquoise-tiled dome"),
        ("groups/pink.jpg", 256, 256, "engraved",
         f"{TASHKENT_STYLE}, a bazaar stall stacked with patterned textiles, ceramics and spice sacks"),
        ("groups/orange.jpg", 256, 256, "engraved",
         f"{TASHKENT_STYLE}, clay tandoor bread ovens with flames and rounds of non bread"),
        ("groups/red.jpg", 256, 256, "engraved",
         f"{TASHKENT_STYLE}, an ornate metro station interior with arched marble columns and chandeliers"),
        ("groups/yellow.jpg", 256, 256, "engraved",
         f"{TASHKENT_STYLE}, the great ribbed blue dome of a bazaar rising over market stalls and cypress trees"),
        ("groups/green.jpg", 256, 256, "engraved",
         f"{TASHKENT_STYLE}, a formal square with fountains and the silhouette of an equestrian statue"),
        ("groups/darkblue.jpg", 256, 256, "engraved",
         f"{TASHKENT_STYLE}, modern glass skyscrapers rising over old tiled rooftops at dusk"),
        ("groups/railroad.jpg", 256, 256, "engraved",
         f"{TASHKENT_STYLE}, a sleek metro train emerging from a tiled tunnel arch"),
        ("groups/utility.jpg", 256, 256, "engraved",
         f"{TASHKENT_STYLE}, a water canal with a small arched footbridge beside an electricity pylon"),
        ("cards/back-chance.jpg", 384, 384, "engraved",
         f"{TASHKENT_STYLE}, playing card back design, symmetrical girih star lattice with a "
         "central shooting-star medallion, ornate double border frame"),
        ("cards/back-chest.jpg", 384, 384, "engraved",
         f"{TASHKENT_STYLE}, playing card back design, symmetrical girih lattice with a central "
         "open merchant's coffer of coins medallion, ornate double border frame"),
    ],
    "europe": [
        ("table.jpg", 512, 512, "texture",
         "Seamless dark wood texture, rich reddish mahogany with a warm oxblood cast, "
         "fine grain, polished lacquer, evenly lit, flat top-down texture, tileable, "
         "no objects, no pattern, no text"),
        ("felt.jpg", 512, 512, "texture",
         "Seamless woven cloth texture, deep dark oxblood burgundy velvet felt fabric, "
         "fine woven fibres, very subtle sheen, evenly lit, flat top-down texture, dark and "
         "moody, tileable, no objects, no pattern, no text"),
        ("medal.jpg", 768, 768, "engraved",
         f"{EUROPE_STYLE}, circular medallion of an art nouveau compass rose inside a laurel "
         "wreath, radiating fan lines"),
        ("corners/go.jpg", 320, 320, "engraved",
         f"{EUROPE_STYLE}, a grand railway station clock above a platform arch, steam rising, "
         "the journey begins"),
        ("corners/jail.jpg", 320, 320, "engraved",
         f"{EUROPE_STYLE}, a heavy riveted iron prison door with one small barred window"),
        ("corners/parking.jpg", 320, 320, "engraved",
         f"{EUROPE_STYLE}, a grand cafe terrace with a striped awning and a parked 1920s automobile"),
        ("corners/gotojail.jpg", 320, 320, "engraved",
         f"{EUROPE_STYLE}, a gendarme's whistle and a pair of handcuffs"),
        ("groups/brown.jpg", 256, 256, "engraved",
         f"{EUROPE_STYLE}, alpine timber chalets with steep gables under pine trees"),
        ("groups/lightblue.jpg", 256, 256, "engraved",
         f"{EUROPE_STYLE}, Amsterdam canal houses with stepped gables and a small bridge"),
        ("groups/pink.jpg", 256, 256, "engraved",
         f"{EUROPE_STYLE}, a Venetian palazzo with arched windows and a gondola prow"),
        ("groups/orange.jpg", 256, 256, "engraved",
         f"{EUROPE_STYLE}, Mediterranean hillside villas with cypress trees and tiled roofs"),
        ("groups/red.jpg", 256, 256, "engraved",
         f"{EUROPE_STYLE}, London Georgian townhouses behind iron railings"),
        ("groups/yellow.jpg", 256, 256, "engraved",
         f"{EUROPE_STYLE}, a Riviera casino facade with palm trees and a grand staircase"),
        ("groups/green.jpg", 256, 256, "engraved",
         f"{EUROPE_STYLE}, Scandinavian gabled merchants' houses along a harbour front"),
        ("groups/darkblue.jpg", 256, 256, "engraved",
         f"{EUROPE_STYLE}, a Parisian Haussmann boulevard with the distant Eiffel tower"),
        ("groups/railroad.jpg", 256, 256, "engraved",
         f"{EUROPE_STYLE}, a 1920s night express steam locomotive pulling a sleeping carriage"),
        ("groups/utility.jpg", 256, 256, "engraved",
         f"{EUROPE_STYLE}, a cast-iron gas street lamp beside a stone drinking fountain"),
        ("cards/back-chance.jpg", 384, 384, "engraved",
         f"{EUROPE_STYLE}, playing card back design, symmetrical art nouveau peacock-feather "
         "fan medallion, ornate whiplash border frame"),
        ("cards/back-chest.jpg", 384, 384, "engraved",
         f"{EUROPE_STYLE}, playing card back design, symmetrical art nouveau lattice with a "
         "central cornucopia medallion, ornate border frame"),
    ],
    # Not a board: the Plus tabletop for a Silk Road game, written to the
    # art root rather than a theme directory.
    "base": [
        ("table-plus.jpg", 512, 512, "texture",
         "Seamless dark wood texture, near-black polished ebony with a subtle golden shimmer "
         "in the grain, luxurious, evenly lit, flat top-down texture, tileable, "
         "no objects, no pattern, no text"),
    ],
}

# ------------------------------------------------------------------ fal.ai --


def fal_key() -> str:
    key = os.environ.get("FAL_KEY", "").strip()
    if key:
        return key
    try:
        with open(os.path.join(os.path.dirname(__file__), "..", "fal_key.txt"), encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        pass
    sys.exit("No fal.ai key: set FAL_KEY or write it to fal_key.txt in the repo root.")


def request(url: str, key: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method="POST" if data else "GET",
        headers={"Authorization": f"Key {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as res:
        return json.load(res)


def generate(prompt: str, width: int, height: int, key: str) -> bytes:
    """One image, as JPEG bytes. Sync endpoint first, queue on 404/405."""
    body = {
        "prompt": prompt,
        "image_size": {"width": width, "height": height},
        "num_images": 1,
        "output_format": "jpeg",
    }
    last: Exception | None = None
    for model in MODELS:
        try:
            out = request(f"https://fal.run/{model}", key, body)
            url = out["images"][0]["url"]
            with urllib.request.urlopen(url, timeout=120) as res:
                return res.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code in (404, 405):
                continue  # try the other spelling of the model id
            raise
    raise RuntimeError(f"all model endpoints failed: {last}")


# ------------------------------------------------------------ post-process --


def grade_black_point(img: Image.Image) -> Image.Image:
    """Pull the darkest tones to true zero so a `screen` composite drops the
    ground completely. The floor is the 1st percentile of luminance, which
    ignores JPEG noise specks while catching a hazy black."""
    gray = img.convert("L")
    floor = sorted(gray.getdata())[gray.width * gray.height // 100]
    if floor <= 0:
        return img
    scale = 255.0 / max(1, 255 - floor)
    lut = [min(255, max(0, round((v - floor) * scale))) for v in range(256)]
    return img.point(lut * len(img.getbands()))


def finish(raw: bytes, size: int, kind: str) -> bytes:
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    if img.width != size:
        img = img.resize((size, size), Image.LANCZOS)
    if kind == "engraved":
        img = grade_black_point(img)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88 if kind == "engraved" else 85)
    return buf.getvalue()


# --------------------------------------------------------------------- main --


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--theme", required=True, choices=sorted(ASSETS))
    ap.add_argument("--only", help="fnmatch pattern on the asset path, e.g. 'corners/*'")
    ap.add_argument("--force", action="store_true", help="regenerate files that exist")
    args = ap.parse_args()

    art_root = os.path.join(os.path.dirname(__file__), "..", "public", "art")
    root = art_root if args.theme == "base" else os.path.join(art_root, "themes", args.theme)
    key = fal_key()

    todo = []
    for rel, w, h, kind, prompt in ASSETS[args.theme]:
        if args.only and not fnmatch.fnmatch(rel, args.only):
            continue
        dest = os.path.join(root, rel)
        if os.path.exists(dest) and not args.force:
            print(f"skip  {rel} (exists)")
            continue
        todo.append((rel, w, h, kind, prompt, dest))

    if not todo:
        print("nothing to do")
        return

    print(f"generating {len(todo)} assets for '{args.theme}'")
    for rel, w, h, kind, prompt, dest in todo:
        for attempt in (1, 2, 3):
            try:
                raw = generate(prompt, w * 2, h * 2, key)  # supersampled, then downscaled
                data = finish(raw, w, kind)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "wb") as fh:
                    fh.write(data)
                print(f"ok    {rel} ({len(data) // 1024} KB)")
                break
            except Exception as exc:  # noqa: BLE001 - retryable service
                print(f"retry {rel}: {exc}", file=sys.stderr)
                time.sleep(3 * attempt)
        else:
            sys.exit(f"failed after 3 attempts: {rel}")

    print("done")


if __name__ == "__main__":
    main()
