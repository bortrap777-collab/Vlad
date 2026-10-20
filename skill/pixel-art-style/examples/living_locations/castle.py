"""Dark castle under the blood moon: banners in the wind, brazier fire with sparks,
hundreds of castle windows and bridge torches flickering, waterfalls, mist rolling
under the bridges, moon halo breathing."""
import sys, os
import numpy as np
from scipy import ndimage
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
from location import Location
import fx

L = Location('refs/castle.png', grid=1, unit=2, N=24, n_colors=180, grade_k=0.0)
hue, Lt, S, box, yy, xx, u = L.hue, L.L, L.S, L.box, L.yy, L.xx, L.u
red = ((hue > 330) | (hue < 22)) & (S > 0.3)

# ---- banners (left pole: big one; two small ones on the bridge)
def banner_mask(b, min_size=30):
    m = box(*b) & ((red & (Lt > 0.1)) | ((hue > 15) & (hue < 55) & (Lt > 0.3) & (S > 0.3)))
    return L.clean(m, close=1, min_size=min_size, fill=True)
big = banner_mask((31, 37, 52, 100), 100)
small = [banner_mask((66, 109, 80, 142)), banner_mask((174, 106, 188, 142))]
gold = ~(((hue > 330) | (hue < 12)) & (S > 0.3) & (Lt < 0.42))      # everything that is not red cloth keeps its colour

# ---- brazier
flame_px = box(34, 116, 48, 132) & (Lt > 0.6) & (hue < 62) & (S > 0.3)
brazier = fx.Flame(41.5 * u, 131.5 * u, 10 * u, 7 * u, mask=flame_px, seed=3, glow_r=34 * u, glow_k=0.3, glow_col=(255, 150, 70))

# ---- windows and bridge lights: small warm clusters (the big window handled apart)
great = box(238, 45, 254, 78)
lamps = (hue > 12) & (hue < 60) & (Lt > 0.45) & (S > 0.45) & box(60, 40, 383, 150) & ~great
lamps &= ndimage.uniform_filter(Lt, 7 * u) < 0.3          # a light is a bright point in the dark
lamps = L.clean(lamps, min_size=1)
lab, n = ndimage.label(lamps)
for i, sl in enumerate(ndimage.find_objects(lab), 1):          # drop big lit surfaces
    if (lab[sl] == i).sum() > 30 * u * u:
        lamps[lab == i] = False
great_m = great & (Lt > 0.35) & ((hue < 40) | (hue > 340)) & (S > 0.4)

# ---- falls, mist, moon
fall_boxes = [(249, 90, 263, 136), (264, 90, 277, 132), (238, 134, 256, 179), (191, 136, 204, 168)]
falls = []
for i, b in enumerate(fall_boxes):
    m = L.clean(box(*b) & (Lt > 0.55) & (S < 0.45), close=1, min_size=12, fill=True)
    if m.sum() > 10:
        falls.append(fx.Fall(m, n=6, speed=2 * u, scale=4 * u, seed=20 + i, foam_rows=4 * u))
mist_zone = np.clip((yy / u - 128) / 18, 0, 1) * np.clip((179 - yy / u) / 6, 0, 1) * (xx > 60 * u)
moon = np.clip(1 - np.hypot(xx / u - 258, yy / u - 34) / 70, 0, 1) ** 2 * (yy < 90 * u)

L.add(fx.Breathe(moon, (255, 150, 120), k=0.1),
      *falls,
      fx.Mist(mist_zone, col=(160, 150, 190), alpha=0.32, scale=26 * u, stretch=3.5, drift=10 * u, seed=4),
      fx.Lights(lamps, color=(255, 160, 80), radius=0.8, strength=0.12, core_amp=0.3, seed=9, max_r=8 * u),
      fx.Lights(great_m, color=(255, 90, 60), radius=0.6, strength=0.12, core_amp=0.12, seed=2, big_amp=0.6),
      fx.Banner(big, gold & big, amp=2.2 * u, cycles=1, top_fixed=3 * u),
      *[fx.Banner(m, gold & m, amp=1.0 * u, cycles=1, top_fixed=2 * u) for m in small if m.sum() > 20 * u * u],
      brazier,
      fx.Particles('ember', (34, 100, 50, 124), count=14, seed=8, rise=24))

if __name__ == '__main__':
    if '--masks' in sys.argv:
        L.overlay('tmp/castle_masks.png', [big | small[0] | small[1], flame_px, lamps, great_m] + [f.mask for f in falls])
    else:
        L.render('out/castle/castle', ms=90)
