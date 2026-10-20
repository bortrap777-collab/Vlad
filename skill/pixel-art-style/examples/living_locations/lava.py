"""Lava cave: churning lava lake, six lavafalls, four braziers, rising embers,
light from the lava breathing on the rock."""
import sys, os
import numpy as np
from scipy import ndimage
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
from location import Location
import fx

L = Location('refs/lava.png', grid=1, unit=2, N=24, n_colors=180, grade_k=0.0)
hue, Lt, S, box, u = L.hue, L.L, L.S, L.box, L.u
lava_col = (hue < 48) & (S > 0.55) & (Lt > 0.3)

# ---- lake: the bright floor of the cave (rocks keep their shapes)
lake = lava_col & box(104, 112, 383, 171) & ~box(285, 100, 383, 140) & ~box(100, 108, 214, 121)
lake |= lava_col & box(285, 128, 383, 171)
lake = L.clean(lake, close=1, min_size=30)
lake = L.clean(ndimage.binary_opening(lake, iterations=u), min_size=30)

# ---- falls (native boxes found on the grid overlay)
fall_boxes = [(27, 20, 44, 58), (56, 58, 84, 110), (216, 10, 234, 68), (184, 18, 202, 76),
              (331, 22, 354, 64), (299, 84, 318, 128)]
falls = []
for i, b in enumerate(fall_boxes):
    m = box(*b) & lava_col & (Lt > 0.42)
    m = L.clean(m, close=1, min_size=20, fill=True)
    falls.append(fx.Fall(m, n=6, speed=u, scale=4 * u, seed=i, foam_rows=5 * u))

# ---- braziers: (x, y_base, height, width)
fl = [(149, 95.5, 10, 7), (201.5, 90.5, 7, 5), (243.5, 70.5, 7, 5), (282, 69.5, 9, 6)]
flames = []
for i, (x, y, h, w) in enumerate(fl):
    hot = box(x - w, y - h - 2, x + w + 1, y + 1) & (Lt > 0.55) & (hue < 62) & (S > 0.35)
    flames.append(fx.Flame(x * u, y * u, h * u, w * u, mask=hot, seed=10 + i, glow_r=h * 3.5 * u, glow_k=0.28, glow_col=(255, 150, 70)))

small_lights = (box(126, 94, 134, 101) | box(194, 95, 200, 101)) & (Lt > 0.55)

# ---- lava light breathing on walls near the lava
heat = ndimage.gaussian_filter((lava_col & (Lt > 0.45)).astype(float), 10 * u)
heat = np.clip(heat / heat.max() * 1.6, 0, 1) * ~lake

L.add(fx.Breathe(heat, (255, 120, 50), k=0.12),
      fx.Liquid(lake, n=8, scale=6 * u, churn=0, veins=0.0, stretch=(6.0, 1.0), seed=3, keep=0.5,
                persp=(112 * u, 171 * u, 0.45), octaves=3, clean=(1, 3), flow=(2 * u, 12 * u)),
      *falls, *flames,
      fx.Lights(small_lights, color=(255, 170, 80), strength=0.2, seed=4, add=True),
      fx.Particles('ember', (110, 120, 383, 171), count=60, seed=5, rise=46, mask=None),
      fx.Particles('ember', (20, 40, 90, 110), count=18, seed=6, rise=30))

if __name__ == '__main__':
    if '--masks' in sys.argv:
        L.overlay('tmp/lava_masks.png', [lake] + [f.mask for f in falls] + [small_lights] + [f.fmask for f in flames])
    else:
        L.render('out/lava/lava', ms=90)
