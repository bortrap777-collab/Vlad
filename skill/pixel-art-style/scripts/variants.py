"""Helpers for variants of an existing scene (night / dawn / winter ...) and for
finding things to animate. Work on the reference reduced to its native grid in full
colour (float RGB 0..255), then hand the result to a Canvas for palette snapping.

    import sys; sys.path.insert(0, '<skill>/scripts')
    from variants import load_native, analyse, find_lamps, find_sky, find_sun, inpaint, relight
    src = load_native('ref.png', W, H)
    A = analyse(src)                  # hue (deg), L, S arrays + yy/xx grids
    sun = find_sun(A)                 # boolean disc or all False
    src = inpaint(src, sun)           # paint it out (diffusion, no seams)
    A = analyse(src)
    lamps = find_lamps(A)             # boolean mask of lamp/window light
    sky = find_sky(A)                 # pink/violet sky, not mountains or castle
    out = relight(A, lamps, target_hue=232, hue_mix=0.8, l_mul=0.68, s_mul=0.5)

Lessons these encode (each one was a visible bug when done naively):
- Sky is found by colour, not by "first dark row from the top": mist and lit hills
  break that rule, which put stars on a hillside and treated a lantern as sky.
- Sunlit grass tops at dusk are amber like lamps; they are thin horizontal streaks,
  so streaks are dropped from the lamp mask.
- A lamp's housing is dark red/brown; shifting it toward blue turns it purple.
  Pixels next to a lamp keep their warm hue (they are lit by it).
- Painting out the sun row-by-row leaves a rectangle; diffusion leaves nothing.
"""
import colorsys
import numpy as np
from PIL import Image
from scipy import ndimage


def load_native(path, w, h):
    return np.asarray(Image.open(path).convert('RGB').resize((w, h), Image.BOX)).astype(float)


def analyse(src):
    hls = np.array([colorsys.rgb_to_hls(*p) for p in (src / 255).reshape(-1, 3)]).reshape(*src.shape[:2], 3)
    H, W = src.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W]
    return dict(src=src, hue=hls[..., 0] * 360, L=hls[..., 1], S=hls[..., 2], yy=yy, xx=xx, H=H, W=W)


def find_sun(A, top=0.45, min_px=30):
    """Largest bright warm blob in the upper part of the frame, returned as a disc."""
    hue, L, S, yy, xx = A['hue'], A['L'], A['S'], A['yy'], A['xx']
    warm = ((hue < 50) | (hue > 340)) & (S > 0.4) & (L > 0.5) & (yy < A['H'] * top)
    lab, n = ndimage.label(warm)
    if not n:
        return np.zeros_like(warm)
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    big = int(np.argmax(sizes)) + 1
    if sizes[big - 1] < min_px:
        return np.zeros_like(warm)
    blob = lab == big
    core = blob & (L > np.quantile(L[blob], 0.5))
    cy, cx = ndimage.center_of_mass(core)
    r = (core.sum() / np.pi) ** 0.5 * 1.25 + 2
    return np.hypot(xx - cx, yy - cy) < r


def inpaint(src, mask, iters=60):
    """Fill mask from its surroundings: each hole pixel first takes the nearest
    outside colour (keeps local texture and value, works for big holes), then a few
    neighbour-averaging passes soften the seams. Large holes (a whole cape) no longer
    collapse to one grey mean."""
    if not mask.any():
        return src
    src = src.copy()
    hole = ndimage.binary_dilation(mask, iterations=1)
    _, (iy, ix) = ndimage.distance_transform_edt(hole, return_indices=True)
    src[hole] = src[iy[hole], ix[hole]]
    k = np.array([[0, 1, 0], [1, 0, 1], [0, 1, 0]]) / 4
    for _ in range(iters):
        for ch in range(3):
            sm = ndimage.convolve(src[..., ch], k, mode='nearest')
            src[..., ch][hole] = sm[hole]
    return src


def find_lamps(A, exclude=None, min_y=0.2):
    """Warm artificial lights: windows, lanterns, fires. Drops thin horizontal streaks."""
    hue, L, S, yy = A['hue'], A['L'], A['S'], A['yy']
    m = (hue > 15) & (hue < 62) & (((S > 0.38) & (L > 0.46)) | ((S > 0.6) & (L > 0.36)) | ((S > 0.22) & (L > 0.58)))
    m &= yy > A['H'] * min_y
    if exclude is not None:
        m &= ~exclude
    lab, _ = ndimage.label(m)
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        hgt, wid = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if hgt <= 2 and wid > 2.5 * hgt + 1:
            m[lab == i] = False
    return m


def find_sky(A, top=0.45):
    """Sky pixels by colour: pink-violet, mid lightness, upper part of the frame."""
    hue, L = A['hue'], A['L']
    return (A['yy'] < A['H'] * top) & (L > 0.22) & (L < 0.8) & ((hue > 255) | (hue < 20))


def shift(h, l, s, target_hue, hue_mix, l_mul, s_mul, l_add=0.02):
    d = ((target_hue - h + 180) % 360) - 180
    return (h + d * hue_mix) % 360, np.clip(l * l_mul + l_add, 0, 1), np.clip(s * s_mul, 0, 1)


def relight(A, lamps, target_hue=232, hue_mix=0.8, l_mul=0.68, s_mul=0.5, keep_warm_radius=2):
    """Shift every surface toward a new light condition; pixels hugging a lamp keep
    their warm hue. Returns float RGB 0..255 (lamps themselves untouched — repaint them)."""
    h2, l2, s2 = shift(A['hue'], A['L'], A['S'], target_hue, hue_mix, l_mul, s_mul)
    near = ndimage.binary_dilation(lamps, iterations=keep_warm_radius) & ~lamps & ((A['hue'] < 60) | (A['hue'] > 330))
    h2 = np.where(near, A['hue'], h2); l2 = np.where(near, A['L'] * 0.8, l2); s2 = np.where(near, A['S'] * 0.9, s2)
    out = np.array([colorsys.hls_to_rgb(a / 360, b, c) for a, b, c in zip(h2.ravel(), l2.ravel(), s2.ravel())])
    out = out.reshape(A['H'], A['W'], 3) * 255
    out[lamps] = A['src'][lamps]
    return out


def shift_palette(hexes, **kw):
    """Apply the same shift to palette colours, so the variant has a matching palette."""
    res = []
    for hx in hexes:
        r, g, b = (int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5))
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        a, bb, c = shift(h * 360, l, s, kw.get('target_hue', 232), kw.get('hue_mix', 0.8), kw.get('l_mul', 0.68), kw.get('s_mul', 0.5))
        res.append('#%02x%02x%02x' % tuple(int(round(v * 255)) for v in colorsys.hls_to_rgb(a / 360, bb, c)))
    return list(dict.fromkeys(res))
