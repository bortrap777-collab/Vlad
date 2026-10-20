"""Cat-knight scene at the detailed grid (640x426, 2 screen px per art pixel at the
source size). Masks of every object that will be REDRAWN and animated, and the clean
background plate with those objects painted out."""
import sys, os
import numpy as np
from scipy import ndimage
SK = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts')
sys.path.insert(0, SK)
from variants import load_native, analyse, find_lamps, inpaint

S = 2                                   # detail factor vs the style grid (320x213)
W, H = 320 * S, 213 * S
REF = os.environ.get('REF', 'ref.png')                      # the user's reference image
src = load_native(REF, W, H)
A = analyse(src)
hue, L, Sat, yy, xx = A['hue'], A['L'], A['S'], A['yy'], A['xx']


def box(x0, y0, x1, y1):            # coordinates in style-grid units (320x213)
    return (xx >= x0 * S) & (xx < x1 * S) & (yy >= y0 * S) & (yy < y1 * S)


def clean(m, close=1, min_size=4):
    if close:
        m = ndimage.binary_closing(m, iterations=close)
    lab, n = ndimage.label(m)
    if n:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        for i, s_ in enumerate(sizes, 1):
            if s_ < min_size:
                m[lab == i] = False
    return m


def row_fill(m):
    out = m.copy()
    for y in range(H):
        xs = np.nonzero(m[y])[0]
        if len(xs) > 2:
            out[y, xs.min():xs.max() + 1] = True
    return out


red = ((hue > 330) | (hue < 22)) & (Sat > 0.22)
pale = (L > 0.5) & (Sat < 0.55) & ((hue < 40) | (hue > 300))

MOON_C, MOON_R = (243.5 * S, 35.0 * S), 35 * S
moon = (np.hypot(xx - MOON_C[0], yy - MOON_C[1]) < MOON_R) & (L > 0.5)

# ---- objects that get redrawn
cape = clean(red & (L > 0.08) & (L < 0.6) & box(10, 110, 100, 156) & ~(box(76, 118, 104, 156) & (L > 0.3))
             & ~box(0, 104, 48, 121) & ~box(87, 126, 110, 160), 2, 80)
cape = ndimage.binary_fill_holes(ndimage.binary_closing(cape, iterations=4)) & box(10, 110, 100, 156) & ~box(87, 126, 110, 160)
sword = clean(box(50, 124, 82, 186) & ~red & ((Sat < 0.32) | (L > 0.4)) & ~(pale & box(12, 136, 84, 166)), 0, 20)
cape &= ~sword
# the cape's free end rises diagonally to the left: anything above that edge is tower wall
cape &= ~((xx < 50 * S) & (yy < (141 - (xx / S - 12) * 0.55) * S))
cape = clean(cape, 1, 80)
tail = clean(pale & box(12, 136, 84, 166), 2, 120)
tail = ndimage.binary_fill_holes(tail)
banner = clean(red & (L > 0.07) & box(31, 22, 67, 100), 2, 100)
banner |= clean(pale & (Sat < 0.4) & box(38, 40, 60, 78) & (L > 0.35), 0, 2)
banner = ndimage.binary_fill_holes(ndimage.binary_closing(banner, iterations=3)) & box(31, 25, 67, 100)
head_fur = clean(pale & box(62, 86, 107, 123), 1, 60)
body_fur = clean(pale & box(92, 118, 110, 172), 1, 30)
cat_fixed = (box(74, 84, 112, 178) & ~cape & ~tail & (L > 0.06)) | head_fur | body_fur | sword
small_banners = [clean(red & (Sat > 0.25) & box(*b), 1, 8) for b in [(185, 106, 193, 127), (302, 124, 313, 154)]]
small_banners = [row_fill(m) for m in small_banners]

# ---- plants: red leaf rosettes of the foreground bushes; each is its own object
bush_zone = (box(0, 160, 60, 213) | box(55, 192, 168, 213) | box(268, 165, 320, 213)) & ~box(98, 160, 128, 196)
leaf = bush_zone & red & (L > 0.12) & (L < 0.5) & (Sat > 0.28)
leaf = clean(ndimage.binary_closing(leaf, iterations=1), 0, 12)
lab, n = ndimage.label(ndimage.binary_dilation(leaf, iterations=1))
plants = []
for i, sl in enumerate(ndimage.find_objects(lab), 1):
    comp = (lab == i) & leaf
    sz = int(comp.sum())
    if sz < 25:
        continue
    # big clumps are split into plant-sized pieces so each sways on its own
    ys, xs = np.nonzero(comp)
    step = 22
    for gx in range(xs.min(), xs.max() + 1, step):
        for gy in range(ys.min(), ys.max() + 1, step):
            piece = comp & (xx >= gx) & (xx < gx + step) & (yy >= gy) & (yy < gy + step)
            if piece.sum() >= 18:
                plants.append(piece)
plant_mask = np.zeros_like(leaf)
for p in plants:
    plant_mask |= p
flowers = plants; blossom_paint = plant_mask

# ---- light
lamps = find_lamps(A, exclude=moon | box(200, 0, 290, 30))
dark_around = ndimage.uniform_filter(L, 7 * S) < 0.30
castle_glow = clean(((hue < 42) | (hue > 340)) & (Sat > 0.4) & (L > 0.3) & box(130, 40, 320, 200) & ~moon & dark_around, 0, 2)
lamps = (lamps | castle_glow) & ~(cape | banner | tail)
lamps &= (xx > 140 * S) | box(0, 30, 14, 60)
lamps &= ~(box(200, 0, 320, 62) & ~dark_around)
GREAT_WIN = (243 * S, 62 * S)
LANTERN_L = (3.5 * S, 45 * S)
LANTERN_B = (165 * S, 189 * S)

# ---- water, falls
water = box(170, 172, 300, 213) & (L > 0.08) & ~lamps
reflection = water & ((hue < 30) | (hue > 330)) & (Sat > 0.25) & (L > 0.3)
falls = []
for b in [(244, 84, 254, 122), (255, 86, 262, 120), (155, 158, 168, 192), (204, 140, 212, 168), (261, 134, 268, 162)]:
    bm = box(*b)
    falls.append(clean(bm & (L > np.quantile(L[bm], 0.45)) & (Sat < 0.3), 1, 20))

# ---- plate: everything redrawn is painted out of the background
movers = cape | banner | tail | blossom_paint | small_banners[0] | small_banners[1]
plate = inpaint(src, ndimage.binary_dilation(movers, iterations=2), iters=40)

if __name__ == '__main__':
    from PIL import Image
    Image.fromarray(np.clip(plate, 0, 255).astype(np.uint8)).save('plate.png')
    over = src * 0.45
    for m, c in [(cape, (255, 40, 40)), (banner, (255, 160, 0)), (tail, (0, 255, 255)), (sword, (255, 255, 255)),
                 (head_fur, (0, 255, 0)), (lamps, (255, 255, 0)), (blossom_paint, (255, 0, 255))]:
        over[m] = c
    Image.fromarray(over.astype(np.uint8)).save('masks.png')
    print('flowers', len(flowers), 'cape', int(cape.sum()), 'tail', int(tail.sum()), 'banner', int(banner.sum()), 'lamps', int(lamps.sum()))
