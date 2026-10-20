"""Dungeon: torches and candles, cages swinging on their chains, the waterfall under
the bridge with spray mist, water dripping from the vault, torchlight trembling in the
wet floor, blue light from the far arches breathing."""
import sys, os
import numpy as np
from scipy import ndimage
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
from location import Location
import fx

L = Location('refs/dungeon.png', grid=1, unit=2, N=24, n_colors=180, grade_k=0.0)
hue, Lt, S, box, yy, xx, u = L.hue, L.L, L.S, L.box, L.yy, L.xx, L.u

# ---- flames (torches, candles): bright warm clusters
hot = (hue > 15) & (hue < 62) & (Lt > 0.6) & (S > 0.45)
lab, n = ndimage.label(ndimage.binary_dilation(hot, iterations=u))   # one flame = one object, even if its pixels are split
flames, fmasks = [], []
for i, sl in enumerate(ndimage.find_objects(lab), 1):
    comp = (lab == i) & hot
    core = comp & (Lt > 0.78)                 # size the flame by its hot core, not its glow
    if core.sum() < 2 or Lt[core].max() < 0.85:
        continue
    ys, xs = np.nonzero(core)
    h = ys.max() - ys.min() + 1; w = xs.max() - xs.min() + 1
    if w > 7 * u or h > 10 * u or ys.max() > 150 * u and xs.mean() < 200 * u:
        continue
    big = h >= 5 * u                          # wall torches; the rest are candles/lamps
    x = xs.mean() + 0.5; y = ys.max() + 0.5
    hh = max(3 * u, h * 1.15) if big else min(4 * u, max(2.5 * u, h))
    ww = max(2 * u, min(5 * u, w + u)) if big else 2 * u
    flames.append(fx.Flame(x, y, hh, ww, mask=comp, seed=50 + i,
                           tongues=3 if big else 1, tongue=big, glow_r=(26 if big else 12) * u, glow_k=(0.22 if big else 0.14),
                           glow_col=(255, 160, 80)))
    fmasks.append(comp)

# ---- cages + chains (dark against the blue wall)
local = ndimage.uniform_filter(Lt, 9 * u)
cages = []
for (x0, y0, x1, y1, cx, top) in [(154, 0, 171, 60, 162, 31), (250, 0, 278, 72, 263, 27), (330, 0, 360, 72, 344, 21)]:
    m = box(x0, y0, x1, y1) & (Lt < local * 0.8) & (Lt < 0.16)
    m = L.clean(m, close=1, min_size=25, fill=True)
    # above the cage only the chain moves: a thin column at the cage's centre
    m &= (yy >= top * u) | (np.abs(xx - cx * u) <= u)
    cages.append(fx.Swing(m, pivot_y=0, amp=1.6 * u, cycles=1, phase=cx / 97.0))

# ---- waterfall under the bridge, its pool and spray
fall = L.clean(box(226, 110, 250, 156) & (((Lt > 0.42) & (hue > 170) & (hue < 220)) | ((Lt > 0.6) & (S < 0.35))), min_size=2)
pool = box(200, 150, 262, 162) & (hue > 170) & (hue < 230) & (Lt > 0.2) & ~fall
spray = np.clip(1 - np.hypot((xx / u - 238) / 26, (yy / u - 152) / 9), 0, 1)

# ---- wet floor: reflected torchlight (left room) trembles
floor = box(30, 95, 160, 120) & (hue > 15) & (hue < 60) & (Lt > 0.4) & (S > 0.35)
floor = L.clean(floor, min_size=2)

# ---- blue arches breathe
blue = np.clip(ndimage.gaussian_filter(((hue > 180) & (hue < 215) & (Lt > 0.45)).astype(float), 6 * u) * 4, 0, 1)

L.add(fx.Breathe(blue, (150, 230, 255), k=0.12, cycles=1),
      fx.Fall(fall, n=7, speed=2 * u, scale=4 * u, seed=1, foam_rows=4 * u, keep=0.7),
      fx.Ripple(pool, amp=1.0 * u, freq=0.7 / u, cycles=2),
      fx.Mist(spray, col=(170, 225, 240), alpha=0.35, scale=14 * u, stretch=2.0, drift=4 * u),
      fx.Lights(floor, color=(255, 170, 90), strength=0.0, core_amp=0.3, seed=2),
      *cages, *flames,
      fx.Particles('drip', (170, 6, 330, 92), count=5, seed=4, cols=[[170, 225, 245], [90, 150, 180]]),
      fx.Particles('dust', (10, 20, 120, 100), count=30, seed=5, cols=[[255, 214, 160], [220, 170, 120]]))

if __name__ == '__main__':
    print('flames', len(flames))
    if '--masks' in sys.argv:
        fm = np.zeros_like(Lt, bool)
        for m in fmasks:
            fm |= m
        L.overlay('tmp/dungeon_masks.png', [fm, fall, pool, floor] + [c.mask for c in cages])
    else:
        L.render('out/dungeon/dungeon', ms=90)
