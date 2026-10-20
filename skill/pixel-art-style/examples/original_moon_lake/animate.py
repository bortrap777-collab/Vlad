"""Animate 'Moon Lake' v2 (draw2.py, 768x432): ripples + glittering moon path, drifting
mist, falls, stone-lantern fire, flickering tower windows / bridge lamps / boat lamp,
the teal window and glowing mushrooms + water lilies pulsing, teal will-o'-wisps,
bats around the tower, twinkling stars, moss / reeds / ferns in the breeze, the boat
rocking gently."""
import sys, os
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
from location import Location
import fx

M = np.load('stage4/masks.npz')
FX, FY = np.load('stage4/flame.npy')
L = Location('stage4/big.png', grid=1, unit=3, N=24, n_colors=240, grade_k=0.0, sharpen=0.0, denoise=False)
hue, Lt, S, box, yy, xx, u = L.hue, L.L, L.S, L.box, L.yy, L.xx, L.u

lake = M['lake'] & ~M['boat'] & (yy > 157 * u)
moon_path = M['moon_path'] & lake
mist = np.clip(1 - np.abs(yy / u - 152) / 12, 0, 1) * ~M['tree'] * ~M['ledge'] * ~M['castle']   # over water and far shore only
MX, MY = 252 * u, 58 * u
stars = (yy < 100 * u) & (Lt > 0.72) & (np.hypot(xx - MX, yy - MY) > 80 * u) & ~M['cloud']
star_px = np.argwhere(stars)
rng = np.random.default_rng(3)
star_ph = rng.random(len(star_px))
teal = M['wins_teal'] | M['mush'] | M['teal_flowers']


def twinkle(img, f, n, loc):
    for (y, x), p in zip(star_px, star_ph):
        k = 0.5 + 0.5 * np.sin(2 * np.pi * (f / n * 2 + p))
        if k < 0.22:
            img[y, x] = loc.plate_img[min(y + 1, loc.H - 1), x] * 0.75 + img[y, x] * 0.25


boat = M['boat']
ys, xs = np.nonzero(boat)
bx0, bx1 = xs.min(), xs.max()


def rock_boat(img, f, n, loc):
    # the boat bobs 1 px on the swell, on twos (a whole-object move, no warping)
    dy = int(round(np.sin(2 * np.pi * ((f // 2) * 2 / n)) * 1.0))
    src = loc.base                      # the plate has the boat painted out: always redraw it
    img[boat] = loc.plate_img[boat]
    ty = np.clip(ys + dy, 0, loc.H - 1)
    img[ty, xs] = src[ys, xs]


wisp_cols = [[190, 255, 244], [95, 212, 200], [47, 143, 148]]
L.add(fx.Breathe(np.clip(1 - np.hypot(xx - MX, yy - MY) / (110 * u), 0, 1) ** 2 * (yy < 150 * u), (180, 170, 220), k=0.1),
      *[fx.Fall(M[k], n=6, speed=2 * u, scale=3 * u, seed=i, foam_rows=3 * u, keep=0.45) for i, k in enumerate(('falls0', 'falls1'))],
      fx.Ripple(lake, amp=1.0 * u, freq=0.5 / u, cycles=2, sparkle=moon_path, sparkle_rate=0.84),
      fx.Mist(mist, col=(140, 132, 186), alpha=0.3, scale=22 * u, stretch=4.0, drift=12 * u, seed=5, dither=True, thresh=0.52, gain=3.0),
      fx.Lights(M['wins'] | M['lrefl'], color=(255, 170, 80), radius=0.9, strength=0.035, core_amp=0.3, seed=6, max_r=8 * u),   # the still holds the spill; a strong pool speckles the masonry
      fx.Lights(M['lamps'], color=(255, 190, 100), radius=1.3, strength=0.18, core_amp=0.3, seed=7, max_r=10 * u),
      fx.Lights(teal, color=(95, 212, 200), radius=1.4, strength=0.16, core_amp=0.35, seed=13, max_r=12 * u, big_amp=0.6),
      # a small flame inside the lantern's cage; the stone cage itself stays untouched
      fx.Flame(FX, FY, 5 * u, 3 * u, mask=None, seed=8, tongues=1, tongue=False,
               glow_r=26 * u, glow_k=0.1, glow_col=(255, 150, 70)),   # the still already holds the light pool; this only breathes
      fx.Custom(rock_boat, layer=29, plate=boat),
      fx.Sway(M['moss'], amp=1.2 * u, wavelength=60 * u, cycles=1, piece=3 * u, seed=9, min_px=4, root='top'),
      fx.Sway(M['reeds'], amp=1.4 * u, wavelength=50 * u, cycles=1, piece=4 * u, seed=10, min_px=6),
      fx.Sway(M['ferns'], amp=0.8 * u, wavelength=50 * u, cycles=1, piece=5 * u, seed=11, min_px=4),
      fx.Custom(twinkle, layer=4),
      fx.Particles('firefly', (110, 150, 330, 210), count=14, seed=11, cols=wisp_cols),
      fx.Particles('firefly', (10, 140, 140, 185), count=8, seed=12, cols=wisp_cols),
      fx.Particles('bird', (200, 20, 305, 86), count=3, seed=13, cols=[[12, 10, 24], [24, 20, 40]]),
      fx.Particles('leaf', (100, 80, 200, 170), count=5, seed=14, rise=40,
                   cols=[[53, 88, 79], [36, 64, 63], [90, 70, 110]]))

# castle life: gate torches, banners, chimney smoke, pennants
from motion_objects import SheetX
for i, (fx_, fy_) in enumerate(M['flames']):
    L.add(fx.Flame(fx_, fy_, 4 * u, 2.5 * u, mask=None, seed=30 + i, tongues=1, tongue=True, glow_r=16 * u, glow_k=0.22,
                   glow_col=(255, 150, 70)))
for k in ('0', '1'):
    L.add(fx.Banner(M['banner' + k], M['emb' + k], amp=1.0 * u, cycles=1, top_fixed=2 * u))
for (cx, cy) in M['chimneys']:
    L.add(fx.Smoke(cx, cy, height=30 * u, drift=16 * u, col=(70, 62, 98), puffs=6, seed=5, r=2.0 * u, alpha=0.55))
pen = M['castle'] & False
for (px_, py_) in M['pennants']:
    pen |= box(px_ / u + 0.5, py_ / u - 2, px_ / u + 6, py_ / u + 2) & ((hue < 20) | (hue > 340)) & (S > 0.3)
_p = {}


def flutter(img, f, n, loc):
    if 'o' not in _p:
        from scipy import ndimage as nd
        lab, k = nd.label(pen)
        _p['o'] = [SheetX(loc.base, lab == i, n=3, attach='left', seed=i) for i in range(1, k + 1) if (lab == i).sum() > 3]
    for o in _p['o']:
        o.draw(img, (f // 2) * 2 / n, amp=1.2 * u, k=20 * u, cycles=2, flap=0.6, reach=0.8)


L.add(fx.Custom(flutter, layer=31, plate=pen))

if __name__ == '__main__':
    L.render('out4/moon_lake', ms=100, big=2)
