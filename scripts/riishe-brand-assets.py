#!/usr/bin/env python3
"""
BEAN Intelligence — RIISHE official brand asset pipeline.

Source: upload/pasted_image_1793532992796.png (1254x1254, authoritative
robot-head app icon: glossy black rounded-square tile, gold neon robot).

Produces (canonical, no duplication):
  public/brand/riishe/riishe-tile.png  — full glossy rounded-square app icon
      (tile cropped tight, outside corners made transparent, baked inner glow
      preserved bit-exact).
  public/brand/riishe/riishe-mark.png  — transparent gold robot-head mark for
      compact navigation/header/avatar placements. Extracted by gold-keying
      (R-B separation kills the neutral-bluish tile surface), glow
      un-premultiplied from black so it recomposites faithfully on #080808.

Measurements used (derived from the source image):
  tile bbox (144,142)-(1105,1099), corner radius ~253px (~26%)
  robot (mid-gold) bbox (298,306)-(930,842)
  tile surface R-B ~ -4 (neutral-bluish)  -> excluded by positive floor
  gold content R-B 8..154                 -> kept with proportional alpha
"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import os

SRC = 'upload/pasted_image_1793532992796.png'
OUT_DIR = 'public/brand/riishe'

im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(np.float32)
H, W = a.shape[:2]
rb = a[:, :, 0] - a[:, :, 2]          # gold-ness (gold: R >> B; tile: B >= R)
lum = a.max(axis=2)

os.makedirs(OUT_DIR, exist_ok=True)

# ---------------------------------------------------------------- tile asset
# Tight crop around the tile (edge = last pixel with lum > 3 on mid row/col).
def edge_span(profile):
    idx = np.where(profile > 3)[0]
    return int(idx.min()), int(idx.max())

x0, x1 = edge_span(lum[H // 2, :])
y0, y1 = edge_span(lum[:, W // 2, ] if False else lum[:, W // 2])
pad = 2
x0, y0, x1, y1 = x0 - pad, y0 - pad, x1 + pad + 1, y1 + pad + 1
side = max(x1 - x0, y1 - y0)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
crop = im.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2))

# Rounded-rect mask (radius measured ~253 on 961 => 26.3%), feathered 1.5px.
tw, th = crop.size
r = int(round(0.263 * side))
mask = Image.new('L', (tw, th), 0)
d = ImageDraw.Draw(mask)
d.rounded_rectangle([0, 0, tw - 1, th - 1], radius=r, fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(1.2))

tile = crop.convert('RGBA')
tile.putalpha(mask)
# Canonical downsample: placements render at <=56 CSS px (<=168px @3x DPR);
# 512px keeps them crisp. WebP (alpha, q92): smooth dark gradients without
# PNG weight and without FASTOCTREE dither mottling.
CANON = 512
tile = tile.resize((CANON, CANON), Image.LANCZOS)
tile.save(f'{OUT_DIR}/riishe-tile.webp', quality=92, method=6)
print(f'riishe-tile.webp {tile.size} corner_r={r}px {os.path.getsize(f"{OUT_DIR}/riishe-tile.webp")//1024}KB')

# ---------------------------------------------------------------- mark asset
# Gold-key alpha: positive R-B beyond a small floor, scaled; luminance guard
# kills residual dark-neutral ghosting. Un-premultiply glow from black.
floor, scale = 4.0, 120.0
alpha = np.clip((rb - floor) / scale, 0.0, 1.0)
alpha *= np.clip(lum / 24.0, 0.0, 1.0)
a8 = (alpha * 255).astype(np.float32)

rgb = a.copy()
guard = np.maximum(a8, 32.0)[..., None]
rgb = np.clip(rgb * 255.0 / guard, 0, 255)  # un-premultiply (guarded)

ys, xs = np.where(a8 > 8)
mx0, mx1, my0, my1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
mside = max(mx1 - mx0, my1 - my0) + 2 * 28  # + glow breathing room
mcx, mcy = (mx0 + mx1) // 2, (my0 + my1) // 2
mx0, my0 = mcx - mside // 2, mcy - mside // 2

mark = np.dstack([rgb, a8])[my0:my0 + mside, mx0:mx0 + mside]
mark_im = Image.fromarray(mark.astype(np.uint8))
mark_im = mark_im.resize((CANON, CANON), Image.LANCZOS)
mark_im.save(f'{OUT_DIR}/riishe-mark.webp', quality=90, method=6)
print(f'riishe-mark.webp {mark_im.size} content=({mx0},{my0})-({mx0+mside},{my0+mside}) {os.path.getsize(f"{OUT_DIR}/riishe-mark.webp")//1024}KB')

# ------------------------------------------------- verification composites
for name, bg in {'on-080808': (8, 8, 8), 'on-0d0d10': (13, 13, 16), 'on-checker': None}.items():
    cw = CANON + CANON // 2 + 120
    canvas = Image.new('RGB', (cw, CANON + 80), bg or (8, 8, 8))
    if bg is None:  # dark checker to expose alpha edges
        dr = ImageDraw.Draw(canvas)
        for yy in range(0, CANON + 80, 16):
            for xx in range(0, cw, 16):
                if (xx // 16 + yy // 16) % 2:
                    dr.rectangle([xx, yy, xx + 15, yy + 15], fill=(16, 16, 18))
    canvas.paste(tile, (40, 40), tile)
    half = mark_im.resize((CANON // 2, CANON // 2), Image.LANCZOS)
    quarter = mark_im.resize((96, 96), Image.LANCZOS)
    mini = mark_im.resize((36, 36), Image.LANCZOS)
    canvas.paste(half, (CANON + 80, 40), half)
    canvas.paste(quarter, (CANON + 80, 40 + CANON // 2 + 20), quarter)
    canvas.paste(mini, (CANON + 80 + 116, 40 + CANON // 2 + 20 + 8), mini)
    canvas.save(f'scripts/riishe-brand-check-{name}.png')
print('verification composites written to scripts/')
