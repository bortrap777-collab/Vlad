"""Example, approach C: animate an existing scene - lamp flicker + waterfall streaks, seamless 8-frame loop.
Paths and waterfall boxes come from the test run; for a new scene find the boxes by cropping and looking."""
import sys, colorsys, os
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))
from pixel_canvas import Canvas, load_style

st = load_style('/home/claude/styles/village_moon/style.json')
W, H = st['native_size']
N = 8                                    # frames in the loop
OUT = '/home/claude/work/t3_anim/frames'
os.makedirs(OUT, exist_ok=True)

src = np.asarray(Image.open('/home/claude/refs/village_moon.png').convert('RGB').resize((W, H), Image.BOX)).astype(float)
hls = np.array([colorsys.rgb_to_hls(*p) for p in (src / 255).reshape(-1, 3)]).reshape(H, W, 3)
hue, L, S = hls[..., 0] * 360, hls[..., 1], hls[..., 2]
yy, xx = np.mgrid[0:H, 0:W]

# ---- lamps: warm bright clusters below the sky (the moon top-right is excluded)
lamp = (hue > 15) & (hue < 60) & (L > 0.55) & (S > 0.4) & (yy > 40)
lab, n = ndimage.label(ndimage.binary_dilation(lamp))
rng = np.random.default_rng(3)
lamps = []
for i in range(1, n + 1):
    comp = (lab == i) & lamp
    size = int(comp.sum())
    if size == 0:
        continue
    cy, cx = ndimage.center_of_mass(comp)
    big = size > 30                          # big lit windows flicker only a little
    lamps.append(dict(mask=comp, cx=cx, cy=cy, size=size, amp=0.25 if big else 1.0,
                      p1=rng.random(), p2=rng.random(), r=min(16, 4 + size ** 0.5 * 1.6)))

# ---- waterfalls: the lighter streak pixels inside the two falls
falls = []
for (x0, x1, y0, y1) in [(206, 214, 56, 74), (191, 200, 109, 129)]:
    box = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1)
    water = box & (L > np.quantile(L[box], 0.35)) & (hue > 190) & (hue < 280)
    water = ndimage.binary_closing(water)
    falls.append(dict(mask=water, x0=x0, y0=y0))

pal = list(st['hex'])
light = ['#7a3b16', '#c7742f', '#f29e6d', '#ffc47a', '#ffe3a8']
foam = ['#8f97c9', '#b9bfe6', '#dfe2f7']
base_cv = Canvas(W, H, pal + light + foam)
base_cv.lit_colors('#c7742f', steps=(0.2, 0.4, 0.6))       # in-between tones for glow pools
pal_full = base_cv.pal.copy()

PERIOD = 8                                                  # streak pattern height; 8 frames x 1 px = seamless
col_off = rng.integers(0, PERIOD, W)
col_len = rng.integers(3, 5, W)
col_on = rng.random(W) < 0.55

for f in range(N):
    ph = f / N
    cv = Canvas(W, H, ['#000000'])
    cv.pal = pal_full
    cv.rgb = src.copy()

    # waterfalls: the body stays as painted; a few columns carry streaks one light step
    # brighter, sliding down 1 px per frame (PERIOD == N, so frame N wraps to frame 0)
    for fl in falls:
        m = fl['mask']
        pos = (yy - f + col_off[None, :]) % PERIOD
        streak = m & (pos < col_len[None, :]) & col_on[None, :]
        cv.rgb[streak] = cv.rgb[streak] * 0.55 + cv.c(foam[0]) * 0.45
        head = streak & (pos == col_len[None, :] - 1)
        cv.rgb[head] = cv.rgb[head] * 0.4 + cv.c(foam[1]) * 0.6
        bottom = m & (yy >= yy[m].max() - 1)
        cv.paint(bottom & (((xx + f) % 4) == 0), foam[1])

    # lamps: two sine waves with whole cycles per loop -> irregular but seamless flicker
    for lp in lamps:
        k = 0.5 + 0.32 * np.sin(2 * np.pi * (ph + lp['p1'])) + 0.18 * np.sin(2 * np.pi * (3 * ph + lp['p2']))
        k = 1 - lp['amp'] * (1 - k)                                      # damp big windows
        cv.glow(lp['cx'], lp['cy'] + 1, lp['r'], '#c7742f', strength=0.04 + 0.16 * k, dither=0.0, squash=0.85)
        core = lp['mask']
        hot = ndimage.binary_erosion(core) if lp['size'] > 4 else core
        cv.paint(core, light[2] if k < 0.45 else light[3])
        cv.paint(hot, light[3] if k < 0.6 else light[4])

    cv.save(f'{OUT}/f_{f:02d}', scale=1)
    os.remove(f'{OUT}/f_{f:02d}_palette.json')
    os.remove(f'{OUT}/f_{f:02d}.png')
print('lamps', len(lamps), 'fall px', [int(fl['mask'].sum()) for fl in falls])
