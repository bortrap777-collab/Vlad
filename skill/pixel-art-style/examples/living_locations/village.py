"""Sunny village: chimney smoke drifting with the wind, the tavern banner flapping,
tree crowns and flower beds swaying in travelling gusts, birds gliding over the
hills, butterflies over the flowers, lanterns glowing softly."""
import sys, os
import numpy as np
from scipy import ndimage
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
from location import Location
import fx

L = Location('refs/village.png', grid=1, unit=2, N=24, n_colors=190, grade_k=0.0)
hue, Lt, S, box, yy, xx, u = L.hue, L.L, L.S, L.box, L.yy, L.xx, L.u
red = ((hue > 330) | (hue < 20)) & (S > 0.3)
green = (hue > 60) & (hue < 160) & (S > 0.2) & (Lt > 0.12)

# ---- banner on the post (right)
banner = L.clean(box(354, 46, 380, 90) & ((red & (Lt > 0.12)) | ((hue > 15) & (hue < 55) & (S > 0.4) & (Lt > 0.35))),
                 close=1, min_size=60, fill=True)
emblem = banner & ~(red & (Lt < 0.4))

# ---- foliage: tree crowns against the sky (top corners), bushes, flower beds
sky = (hue > 190) & (hue < 235) & (Lt > 0.45)
leafy = (hue > 42) & (hue < 170) & (S > 0.12) & (Lt > 0.07)
crowns = leafy & (box(0, 0, 75, 30) | box(335, 0, 383, 30) | box(60, 0, 110, 30))
crowns = L.clean(crowns, close=1, min_size=40)
flowers = (box(0, 128, 90, 159) | box(320, 130, 383, 159)) & (green | ((Lt > 0.55) & (S < 0.3)) | ((hue > 290) | (hue < 10)) & (S > 0.35))
flowers = L.clean(flowers, close=1, min_size=20)
bushes = green & (box(230, 100, 300, 125) | box(100, 25, 150, 60))
bushes = L.clean(bushes, close=1, min_size=30)

# ---- smoke from the chimneys (x, y of the chimney top)
chimneys = [(116.5, 44), (174.5, 69), (247.5, 56), (270.5, 65)]
smoke = [fx.Smoke(x * u, y * u, height=26 * u, drift=14 * u, col=(196, 192, 202), puffs=7, seed=i, r=2.0 * u, alpha=0.7)
         for i, (x, y) in enumerate(chimneys)]

lamps = (box(154, 94, 162, 103) | box(355, 101, 363, 110) | box(368, 94, 376, 102)) & (Lt > 0.55) & (hue > 15) & (hue < 65)

L.add(*smoke,
      fx.Lights(lamps, color=(255, 190, 110), radius=0.8, strength=0.1, core_amp=0.2, seed=3, max_r=9 * u),
      fx.Sway(crowns, amp=1.4 * u, wavelength=150 * u, cycles=1, piece=14 * u, seed=1, min_px=12 * u * u),
      fx.Sway(bushes, amp=1.0 * u, wavelength=150 * u, cycles=1, piece=12 * u, seed=2, min_px=12 * u * u),
      fx.Sway(flowers, amp=1.3 * u, wavelength=120 * u, cycles=2, piece=8 * u, seed=3, min_px=10 * u * u),
      fx.Banner(banner, emblem, amp=1.8 * u, cycles=1, top_fixed=3 * u),
      fx.Particles('bird', (150, 6, 330, 30), count=3, seed=4),
      fx.Particles('butterfly', (10, 128, 80, 150), count=3, seed=5),
      fx.Particles('butterfly', (325, 130, 380, 150), count=2, seed=6),
      fx.Particles('leaf', (60, 30, 383, 120), count=6, seed=7, rise=60))

if __name__ == '__main__':
    if '--masks' in sys.argv:
        L.overlay('tmp/village_masks.png', [banner, crowns, flowers, bushes, lamps, emblem])
    else:
        L.render('out/village/village', ms=90)
