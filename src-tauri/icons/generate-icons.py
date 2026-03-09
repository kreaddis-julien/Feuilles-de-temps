#!/usr/bin/env python3
"""Generate app icon and macOS tray icon for the timesheet app."""

import math
from PIL import Image, ImageDraw, ImageFilter

# ---------------------------------------------------------------------------
# App Icon (1024x1024) — Blueprint style with built-in rounded rect + shadow
# ---------------------------------------------------------------------------

SIZE = 1024
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))

INSET = 35
CORNER = 220
BG = (0, 122, 255, 255)

# Shadow layer
shadow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(shadow)
sd.rounded_rectangle(
    [INSET + 4, INSET + 8, SIZE - INSET + 4, SIZE - INSET + 8],
    radius=CORNER, fill=(0, 0, 0, 60),
)
shadow = shadow.filter(ImageFilter.GaussianBlur(radius=18))
img = Image.alpha_composite(img, shadow)

# Main shape
shape = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
sd = ImageDraw.Draw(shape)
sd.rounded_rectangle(
    [INSET, INSET, SIZE - INSET, SIZE - INSET],
    radius=CORNER, fill=BG,
)
img = Image.alpha_composite(img, shape)

# Subtle top highlight
highlight = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
hd = ImageDraw.Draw(highlight)
hd.rounded_rectangle(
    [INSET, INSET, SIZE - INSET, INSET + 80],
    radius=CORNER, fill=(255, 255, 255, 20),
)
img = Image.alpha_composite(img, highlight)

draw = ImageDraw.Draw(img)

GRID_FINE = (255, 255, 255, 35)
GUIDE = (255, 255, 255, 70)
WHITE = (255, 255, 255, 255)

cx, cy = SIZE // 2, SIZE // 2

# ============================================================
# Guide geometry
# ============================================================
R_outer = 255
R_inner = 185
R_play = 105
R_center = 40

R_arc = (R_outer + R_inner) / 2
arc_w = R_outer - R_inner

# Grid (clipped to rounded rect area)
grid = 64
for x in range(INSET, SIZE - INSET + 1, grid):
    draw.line([(x, INSET), (x, SIZE - INSET)], fill=GRID_FINE, width=1)
for y in range(INSET, SIZE - INSET + 1, grid):
    draw.line([(INSET, y), (SIZE - INSET, y)], fill=GRID_FINE, width=1)

# Center crosshairs
draw.line([(cx, INSET), (cx, SIZE - INSET)], fill=GUIDE, width=1)
draw.line([(INSET, cy), (SIZE - INSET, cy)], fill=GUIDE, width=1)

# Diagonals
draw.line([(INSET, INSET), (SIZE - INSET, SIZE - INSET)], fill=GUIDE, width=1)
draw.line([(SIZE - INSET, INSET), (INSET, SIZE - INSET)], fill=GUIDE, width=1)

# Guide circles
for r in [R_center, R_play, R_inner, R_outer]:
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=GUIDE, width=1)

# ============================================================
# Glyph
# ============================================================
gap_half = 40
arc_start = gap_half
arc_end = 360 - gap_half

pts_o, pts_i = [], []
steps = 600
for i in range(steps + 1):
    angle = arc_start + (arc_end - arc_start) * i / steps
    a = math.radians(angle)
    pts_o.append((cx + R_outer * math.cos(a), cy + R_outer * math.sin(a)))
    pts_i.append((cx + R_inner * math.cos(a), cy + R_inner * math.sin(a)))

draw.polygon(pts_o + list(reversed(pts_i)), fill=WHITE)

# Round caps
cap_r = arc_w / 2
for angle in [arc_start, arc_end]:
    a = math.radians(angle)
    x = cx + R_arc * math.cos(a)
    y = cy + R_arc * math.sin(a)
    draw.ellipse([x - cap_r, y - cap_r, x + cap_r, y + cap_r], fill=WHITE)

# Crown
crown_w = 44
crown_h = 65
crown_bottom = cy - R_outer + 8
draw.rounded_rectangle(
    [cx - crown_w // 2, crown_bottom - crown_h, cx + crown_w // 2, crown_bottom],
    radius=crown_w // 2, fill=WHITE,
)

# Overlay guides on top
OVER = (0, 50, 160, 85)
OVER_B = (0, 50, 160, 120)

for r in [R_center, R_inner, R_outer]:
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=OVER, width=2)
draw.ellipse([cx - R_play, cy - R_play, cx + R_play, cy + R_play],
             outline=OVER_B, width=2)
draw.line([(cx, INSET), (cx, SIZE - INSET)], fill=OVER, width=1)
draw.line([(INSET, cy), (SIZE - INSET, cy)], fill=OVER, width=1)

# --- Save ---
icon_dir = '/Users/julien/Documents/Projects/git/timesheet/src-tauri/icons'
img.save(f'{icon_dir}/icon.png')
print('  icon.png')

sizes = {
    '32x32.png': 32, '64x64.png': 64, '128x128.png': 128,
    '128x128@2x.png': 256,
    'Square30x30Logo.png': 30, 'Square44x44Logo.png': 44,
    'Square71x71Logo.png': 71, 'Square89x89Logo.png': 89,
    'Square107x107Logo.png': 107, 'Square142x142Logo.png': 142,
    'Square150x150Logo.png': 150, 'Square284x284Logo.png': 284,
    'Square310x310Logo.png': 310, 'StoreLogo.png': 50,
}
for name, size in sizes.items():
    img.resize((size, size), Image.LANCZOS).save(f'{icon_dir}/{name}')

ico_sizes = [16, 24, 32, 48, 64, 128, 256]
imgs = [img.resize((s, s), Image.LANCZOS) for s in ico_sizes]
imgs[0].save(f'{icon_dir}/icon.ico', format='ICO',
             sizes=[(s, s) for s in ico_sizes], append_images=imgs[1:])
img.save(f'{icon_dir}/icon-1024.png')

# ---------------------------------------------------------------------------
# Tray Icon
# ---------------------------------------------------------------------------

def make_tray(size):
    t = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(t)
    c = size / 2
    r_o = size * 0.38
    r_i = size * 0.27
    r_arc = (r_o + r_i) / 2
    hw = (r_o - r_i) / 2
    a_start, a_end = 40, 320
    pts_o, pts_i = [], []
    for i in range(201):
        ad = a_start + (a_end - a_start) * i / 200
        a = math.radians(ad)
        pts_o.append((c + r_o * math.cos(a), c + r_o * math.sin(a)))
        pts_i.append((c + r_i * math.cos(a), c + r_i * math.sin(a)))
    d.polygon(pts_o + list(reversed(pts_i)), fill=(0, 0, 0, 220))
    for ad in [a_start, a_end]:
        a = math.radians(ad)
        cx2, cy2 = c + r_arc * math.cos(a), c + r_arc * math.sin(a)
        d.ellipse([cx2 - hw, cy2 - hw, cx2 + hw, cy2 + hw], fill=(0, 0, 0, 220))
    bw = max(2, round(size * 0.04))
    bh = max(3, round(size * 0.06))
    bb = c - r_o + 1
    d.rounded_rectangle([c - bw // 2, bb - bh, c + bw // 2, bb],
                        radius=bw // 2, fill=(0, 0, 0, 220))
    return t

make_tray(22).save(f'{icon_dir}/tray-icon@1x.png')
make_tray(44).save(f'{icon_dir}/tray-icon@2x.png')
make_tray(256).save(f'{icon_dir}/tray-icon.png')

print('  All done!')
