#!/usr/bin/env python3
"""Generate the Mafia game art set (Party Hall) with fal.ai.

One set: a picker cover, a wide hero, a night-table backdrop, two phase
emblems and nine role emblems, written to public/art/mafia/ with the names
src/art/art.ts resolves.

The emblems follow the house contract: champagne-gold linework on pure
black, composited with `screen` in CSS, no alpha. After download they are
downscaled to their shipped size and the black point is graded to true
zero, exactly as the board sets are, so the ground drops out completely.

Usage:
    set FAL_KEY=...            # or put it in fal_key.txt next to this repo
    python scripts/gen_mafia_art.py
    python scripts/gen_mafia_art.py --only "roles/*"
    python scripts/gen_mafia_art.py --force   # regenerate everything

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

NOIR = ("fine line engraving, champagne gold ink on pure black background, "
        "single centered vignette, 1920s art deco noir style, thin elegant "
        "linework, no text, no letters, no watermark")

WIDE = ("fine line engraving, champagne gold ink on pure black background, "
        "wide panoramic composition, 1920s art deco noir style, thin elegant "
        "linework, no text, no letters, no watermark")

# kind: 'engraved' (black-graded) or 'texture' (full-bleed)
ASSETS = [
    ("cover.jpg", 1200, 686, "engraved",
     f"{WIDE}, a 1920s noir city street at night seen from a doorway: art deco "
     "skyline, a lone street lamp, a vintage automobile, rain-slick cobblestones "
     "reflecting lamplight, a fedora-wearing silhouette in the distance"),
    ("hero.jpg", 1600, 900, "engraved",
     f"{WIDE}, a grand art deco speakeasy interior at midnight: a round table "
     "with a single hanging lamp, nine empty chairs around it, cigarette smoke "
     "curling through the light beam, moon in a tall arched window"),
    ("night.jpg", 1024, 1024, "texture",
     "Very dark night sky texture, deep blue-black with faint engraved gold "
     "constellation lines and a few small stars, subtle vignette, evenly dark, "
     "moody and quiet, no objects, no text"),
    ("moon.jpg", 512, 512, "engraved",
     f"{NOIR}, a crescent moon inside an art deco starburst halo, "
     "small stars orbiting it"),
    ("sun.jpg", 512, 512, "engraved",
     f"{NOIR}, a rising sun over an art deco city skyline, radiating fan beams"),
    ("roles/mafia.jpg", 512, 512, "engraved",
     f"{NOIR}, a fedora hat and a pair of leather gloves crossed over a "
     "switchblade, a single playing card beside them"),
    ("roles/godfather.jpg", 512, 512, "engraved",
     f"{NOIR}, a bowler hat above a cigar and a red rose rendered in gold "
     "lines, a signet ring, commanding and elegant"),
    ("roles/silencer.jpg", 512, 512, "engraved",
     f"{NOIR}, a gloved finger pressed over a pair of lips, a vintage "
     "gramophone with a muted horn behind"),
    ("roles/doctor.jpg", 512, 512, "engraved",
     f"{NOIR}, a 1920s doctor's leather bag with a stethoscope curled over "
     "it, a small medicine bottle"),
    ("roles/detective.jpg", 512, 512, "engraved",
     f"{NOIR}, a magnifying glass over an open case file with a deerstalker "
     "cap, a pocket watch chain"),
    ("roles/bodyguard.jpg", 512, 512, "engraved",
     f"{NOIR}, a broad art deco shield in front of a smaller figure outline, "
     "protective and solid"),
    ("roles/sniper.jpg", 512, 512, "engraved",
     f"{NOIR}, a telescopic sight crosshair over a city rooftop skyline, "
     "a single feather falling through the reticle"),
    ("roles/jester.jpg", 512, 512, "engraved",
     f"{NOIR}, a grinning theatrical jester mask with curled cap points and "
     "small bells"),
    ("roles/villager.jpg", 512, 512, "engraved",
     f"{NOIR}, a small townhouse window glowing warm above a lantern and a "
     "front door key"),
]

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


def finish(raw: bytes, width: int, height: int, kind: str) -> bytes:
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    if img.width != width or img.height != height:
        img = img.resize((width, height), Image.LANCZOS)
    if kind == "engraved":
        img = grade_black_point(img)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88 if kind == "engraved" else 85)
    return buf.getvalue()


# --------------------------------------------------------------------- main --


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", help="fnmatch pattern on the asset path, e.g. 'roles/*'")
    ap.add_argument("--force", action="store_true", help="regenerate files that exist")
    args = ap.parse_args()

    root = os.path.join(os.path.dirname(__file__), "..", "public", "art", "mafia")
    key = fal_key()

    todo = []
    for rel, w, h, kind, prompt in ASSETS:
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

    print(f"generating {len(todo)} mafia assets")
    for rel, w, h, kind, prompt, dest in todo:
        for attempt in (1, 2, 3):
            try:
                raw = generate(prompt, w * 2, h * 2, key)  # supersampled, then downscaled
                data = finish(raw, w, h, kind)
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
