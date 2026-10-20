"""Enchanted forest at night: lanterns breathing warm light, fireflies drifting,
the waterfall behind the rope bridge, the stream rippling with the lantern
reflection, mist over the water, flowers and ferns in the breeze."""
import sys, os
import numpy as np
from scipy import ndimage
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
from location import Location
import fx

L = Location('refs/forest.png', grid=1, unit=2, N=24, n_colors=190, grade_k=0.0)
hue, Lt, S, box, yy, xx, u = L.hue, L.L, L.S, L.box, L.yy, L.xx, L.u
blue = (hue > 185) & (hue < 235)

# ---- lanterns: warm glass (water reflection excluded, handled by the ripple)
glass = (hue > 15) & (hue < 62) & (Lt > 0.6) & (S > 0.45) & ~box(250, 140, 300, 159)
glass = L.clean(ndimage.binary_dilation(glass, iterations=u) & (Lt > 0.5) & (hue < 62) & (hue > 12), min_size=4)
glass &= ndimage.uniform_filter(Lt, 9 * u) < 0.32

# ---- falls
# no closing: ropes and posts cross the fall and must stay out of the mask
main_fall = L.clean(box(258, 92, 292, 133) & blue & (Lt > 0.4) & (S < 0.75), min_size=2)
small_fall = L.clean(box(191, 118, 204, 142) & blue & (Lt > 0.4), min_size=2)

# ---- stream + lantern reflection
water = box(176, 133, 330, 159) & (blue | ((hue > 15) & (hue < 62) & (Lt > 0.5))) & (Lt > 0.12)
water = L.clean(water, close=1, min_size=20)
refl = water & (hue > 15) & (hue < 62) & (Lt > 0.5)
mist = np.clip(1 - np.hypot((xx / u - 275) / 50, (yy / u - 132) / 10), 0, 1) + \
       0.6 * np.clip(1 - np.hypot((xx / u - 200) / 18, (yy / u - 140) / 7), 0, 1)

# ---- plants in the breeze: flower bed left, ferns lower right
flowers = (box(0, 75, 62, 125) & (((hue > 200) & (hue < 260) & (S > 0.3) & (Lt > 0.25)) | ((Lt > 0.6) & (S < 0.3))))
flowers = L.clean(flowers, close=1, min_size=12)
ferns = L.clean(box(325, 112, 383, 135) & (hue > 60) & (hue < 160) & (S > 0.3) & (Lt > 0.2), close=1, min_size=15)

L.add(fx.Fall(main_fall, n=7, speed=2 * u, scale=4 * u, seed=1, foam_rows=3 * u, keep=0.7),
      fx.Fall(small_fall, n=6, speed=2 * u, scale=3 * u, seed=2, foam_rows=3 * u, keep=0.7),
      fx.Ripple(water, amp=1.0 * u, freq=0.6 / u, cycles=2, sparkle=refl, sparkle_rate=0.75),
      fx.Mist(mist, col=(150, 190, 230), alpha=0.3, scale=16 * u, stretch=3.0, drift=6 * u, seed=3),
      fx.Lights(glass, color=(255, 175, 90), radius=1.2, strength=0.16, core_amp=0.28, seed=4, max_r=22 * u),
      fx.Sway(flowers, amp=1.2 * u, wavelength=90 * u, cycles=1, piece=8 * u, seed=5, min_px=10 * u * u),
      fx.Sway(ferns, amp=1.0 * u, wavelength=90 * u, cycles=1, piece=10 * u, seed=6, min_px=10 * u * u),
      fx.Particles('firefly', (0, 30, 383, 150), count=50, seed=7),
      fx.Particles('leaf', (40, 0, 383, 110), count=5, seed=8, rise=50,
                   cols=[[200, 190, 70], [150, 160, 60], [110, 130, 60]]))

if __name__ == '__main__':
    if '--masks' in sys.argv:
        L.overlay('tmp/forest_masks.png', [glass, main_fall, small_fall, water, refl, flowers, ferns])
    else:
        L.render('out/forest/forest', ms=90)
