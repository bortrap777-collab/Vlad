"""Repaint the full scene once (static base) and the background plate with the same
palette; save both so frames can be composed quickly."""
import sys
import numpy as np
from scipy import ndimage
from scene import src, plate, A, box, cape, banner, tail, cat_fixed, S, W, H, SK
sys.path.insert(0, SK)
from repaint import repaint, grade, mode_filter, W8
from analyze_style import _assign, to_perc

ref_img, pal, lab = repaint(src)
blur = np.stack([ndimage.gaussian_filter(plate[..., c], 1.0) for c in range(3)], -1)
g = grade(np.clip(plate + (plate - blur) * 0.45, 0, 255))
plab = _assign(to_perc(g.reshape(-1, 3)), to_perc(pal)).reshape(H, W)
plab = mode_filter(plab, 1)
bg_img = pal[plab]
emblem = banner & (A['L'] > 0.33) & (A['S'] < 0.5)
np.savez_compressed('base.npz', ref=ref_img, bg=bg_img, pal=pal, emblem=emblem)
print('palette', len(pal))
