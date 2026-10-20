"""Throne hall: ~40 candle flames redrawn as sprites, chandelier, stained glass
breathing, banners stirring in a draught, candle light flickering in the polished floor,
dust motes in the window light."""
import sys, os
import numpy as np
from scipy import ndimage
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
from location import Location
import fx

L = Location('refs/throne.png', grid=1, unit=2, N=24, n_colors=180, grade_k=0.0)
hue, Lt, S, box, u = L.hue, L.L, L.S, L.box, L.u

windows = box(133, 24, 151, 82) | box(186, 44, 214, 102) | box(249, 24, 268, 82)
glass = windows & (S > 0.25) & (Lt > 0.25)

# ---- candle flames: small bright warm clusters above the floor line
knights = box(12, 98, 36, 152) | box(88, 110, 106, 152) | box(290, 110, 310, 152)
# candle flames here are nearly white (pale core) against orange-lit stone
hot = (Lt > 0.8) & (((hue > 15) & (hue < 70)) | (S < 0.4)) & ~windows & ~knights & box(0, 0, 383, 150)
lab, n = ndimage.label(ndimage.binary_dilation(hot, iterations=1))   # one flame = one object, even if its pixels are split
flames, fmasks = [], []
for i, sl in enumerate(ndimage.find_objects(lab), 1):
    comp = (lab == i) & hot
    sz = int(comp.sum())
    if sz < 2 * u * u or sz > 40 * u * u:
        continue
    ys, xs = np.nonzero(comp)
    h = ys.max() - ys.min() + 1; w = xs.max() - xs.min() + 1
    if w > 6 * u or h > 9 * u:
        continue
    x = xs.mean() + 0.5; y = ys.max() + 0.5
    hh = max(2.5 * u, h * 1.1); ww = max(2 * u, min(4 * u, w))
    flames.append(fx.Flame(x, y, hh, ww, mask=comp, seed=100 + i, tongues=1 if ww < 4 * u else 3, tongue=False,
                           glow_r=7 * u + hh * 1.6, glow_k=0.13, glow_col=(255, 170, 90)))
    fmasks.append(comp)

# ---- floor: candle reflections flicker, light pools on it breathe
floor_refl = box(0, 150, 383, 179) & (hue > 15) & (hue < 60) & (Lt > 0.45) & (S > 0.4)
floor_refl = L.clean(floor_refl, min_size=2)

# ---- banners
banner_l = L.clean(box(101, 4, 121, 82) & (((hue > 330) | (hue < 25)) & (S > 0.3) & (Lt > 0.12) | ((hue > 25) & (hue < 60) & (Lt > 0.35))), close=1, min_size=40, fill=True)
banner_r = L.clean(box(279, 4, 300, 82) & (((hue > 330) | (hue < 25)) & (S > 0.3) & (Lt > 0.12) | ((hue > 25) & (hue < 60) & (Lt > 0.35))), close=1, min_size=40, fill=True)
emblem = ~(((hue > 330) | (hue < 12)) & (S > 0.3) & (Lt < 0.27)) & (banner_l | banner_r)

# light from the stained glass, falling into the hall
win_light = np.zeros_like(Lt)
for (cx, cy, r) in [(142, 60, 30), (200, 80, 40), (258, 60, 30)]:
    win_light = np.maximum(win_light, np.clip(1 - np.hypot(L.xx - cx * u, (L.yy - cy * u) * 0.8) / (r * u), 0, 1) ** 2)
glass_w = glass.astype(float)

L.add(fx.Breathe(glass_w, (255, 230, 240), k=0.18, cycles=1),
      fx.Breathe(win_light * ~glass, (230, 150, 170), k=0.06, cycles=1, phase=0.1),
      fx.Lights(floor_refl, color=(255, 180, 100), strength=0.0, core_amp=0.3, seed=7),
      fx.Banner(banner_l, emblem & banner_l, amp=1.2 * u, cycles=1, top_fixed=8 * u),
      fx.Banner(banner_r, emblem & banner_r, amp=1.2 * u, cycles=1, top_fixed=8 * u),
      *flames,
      fx.Particles('dust', (120, 40, 280, 150), count=70, seed=3, cols=[[255, 226, 214], [236, 190, 200]]))

if __name__ == '__main__':
    print('flames', len(flames))
    if '--masks' in sys.argv:
        fm = np.zeros_like(Lt, bool)
        for m in fmasks:
            fm |= m
        L.overlay('tmp/throne_masks.png', [fm, floor_refl, banner_l | banner_r, glass, emblem])
    else:
        L.render('out/throne/throne', ms=90)
