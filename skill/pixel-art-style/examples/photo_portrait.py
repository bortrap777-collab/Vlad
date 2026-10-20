"""Photo of a red-haired girl in a misty park at sunset -> pixel art in the user's
style, then a living loop: fog drifting, hair and trees in the breeze, autumn leaves
falling, sun glow breathing, golden motes, birds over the sunset, pearls glinting.

Run from a folder holding photo.png (and ../styles/<ref>/style.json from analyze_style.py).
The figure polygon and boxes fit the worked photo - redo them on a grid overlay
(zoom_grid.py) for a new one. --static: only the pixel-art still; --masks: overlay."""
import sys, os, json
import numpy as np
from PIL import Image
from scipy import ndimage
SK = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts')
sys.path.insert(0, SK)
from photo_to_pixel import convert, leaf_clumps
from location import Location
from pixel_canvas import Canvas
import fx

STAGE = 'stage'
os.makedirs(STAGE, exist_ok=True)

# ---------------- 1. photo -> pixel art (static)
if not os.path.exists(f'{STAGE}/big.png') or '--redo' in sys.argv:
    nat, scale = convert('photo.png', width=320, colors=56, grade_k=1.4, sat=1.35,
                         style='../styles/castle/style.json', style_mix=0.35)
    H, W = nat.shape[:2]
    cv = Canvas(W, H, ['#000000'])
    figure = cv.poly_mask([(150, 104), (120, 124), (117, 150), (110, 176), (94, 180), (98, 190), (88, 195), (84, 232),
                           (80, 276), (76, 296), (66, 330), (62, 400), (64, 426), (206, 426), (206, 360), (214, 312),
                           (220, 232), (216, 208), (202, 200), (196, 140), (180, 110)])
    np.save(f'{STAGE}/figure.npy', figure)
    img = nat.astype(float)
    Lm = img @ np.array([0.30, 0.59, 0.11]) / 255
    foliage = ~ndimage.binary_dilation(figure, iterations=2) & (cv.yy < 185) & (Lm < 0.42) & (Lm > 0.05)
    img = leaf_clumps(img, foliage, light=(250, 170), seed=4)
    Image.fromarray(img.astype(np.uint8)).save(f'{STAGE}/native.png')
    Image.fromarray(img.astype(np.uint8)).resize((W * scale, H * scale), Image.NEAREST).save(f'{STAGE}/big.png')
    json.dump(dict(scale=scale), open(f'{STAGE}/info.json', 'w'))
    if '--static' in sys.argv:
        Image.fromarray(img.astype(np.uint8)).resize((W * 2, H * 2), Image.NEAREST).save(f'{STAGE}/view.png')
        sys.exit()

scale = json.load(open(f'{STAGE}/info.json'))['scale']
figure = np.load(f'{STAGE}/figure.npy')

# ---------------- 2. living loop
L = Location(f'{STAGE}/big.png', grid=scale, unit=1, N=24, n_colors=200, grade_k=0.0, sharpen=0.0, denoise=False)
hue, Lt, S, box, yy, xx = L.hue, L.L, L.S, L.box, L.yy, L.xx
red = ((hue > 345) | (hue < 28)) & (S > 0.35) & (Lt > 0.12)

hair = L.clean(red & box(92, 100, 206, 216) & ~box(124, 132, 180, 202), min_size=8)   # face kept still
hair_edge = hair & ~ndimage.binary_erosion(hair, iterations=3)                       # only the outer locks move
strand = hair & box(90, 172, 125, 195)                                                 # the lock flying to the left
# only foliage that has sky next to it moves: a solid block would shear at its edges
sky = (Lt > 0.5) & ~figure & (yy < 200)
near_sky = ndimage.binary_dilation(sky, iterations=5)
crowns_l = L.clean(box(0, 0, 200, 150) & ~ndimage.binary_dilation(figure, iterations=3) & (Lt < 0.5) & near_sky, min_size=6)
crowns_r = L.clean(box(196, 0, 320, 200) & ~ndimage.binary_dilation(figure, iterations=3) & (Lt < 0.42) & near_sky, min_size=6)
fog = np.clip((yy - 270) / 40, 0, 1) * ~ndimage.binary_dilation(figure, iterations=1)
sun = np.clip(1 - np.hypot(xx - 250, (yy - 170) * 1.3) / 90, 0, 1) ** 2 * ~figure
pearls = box(146, 196, 172, 212) & (Lt > 0.55) & (S < 0.35)

def pearl_glint(img, f, n, loc):
    ys, xs = np.nonzero(pearls)
    if not len(ys):
        return
    k = (f * 5) % len(ys)                          # a glint runs along the necklace
    for j in (k, (k + len(ys) // 2) % len(ys)):
        if f % 3 == 0:
            img[ys[j], xs[j]] = [255, 250, 236]

from motion_objects import SheetX
_strand = {}

def draw_strand(img, f, n, loc):
    # the flying lock is held at the head (right end); its tip flutters like a cape
    if 'o' not in _strand:
        _strand['o'] = SheetX(loc.base, strand, n=5, attach='right', seed=3)
    ph = (f // 2) * 2 / n
    _strand['o'].draw(img, ph, amp=2.2, k=40, cycles=2, flap=0.8, reach=1.5)

L.add(fx.Breathe(sun, (255, 170, 80), k=0.14, cycles=1),
      fx.Sway(crowns_l, amp=1.2, wavelength=120, cycles=1, piece=12, seed=1, min_px=20),
      fx.Sway(crowns_r, amp=1.0, wavelength=120, cycles=1, piece=10, seed=2, min_px=15),
      fx.Mist(fog, col=(236, 190, 150), alpha=0.22, scale=34, stretch=3.5, drift=10, seed=3, dither=True),
      fx.Sway(hair_edge, amp=1.0, wavelength=80, cycles=1, piece=6, seed=4, min_px=4, root='top', direction=-1),
      fx.Custom(draw_strand, layer=31, plate=ndimage.binary_dilation(strand, iterations=2)),
      fx.Custom(pearl_glint, layer=36),
      fx.Particles('dust', (200, 120, 320, 260), count=30, seed=6, cols=[[255, 226, 160], [255, 196, 120]]),
      fx.Particles('leaf', (0, 0, 320, 300), count=10, seed=7, rise=70,
                   cols=[[232, 150, 60], [204, 92, 44], [240, 196, 80]]),
      fx.Particles('bird', (210, 10, 310, 60), count=2, seed=8))

if __name__ == '__main__':
    if '--masks' in sys.argv:
        L.overlay('masks.png', [figure, hair_edge, strand, crowns_l, crowns_r, pearls], scale=2)
    else:
        L.render('out/sunset_girl', ms=100, big=2)
