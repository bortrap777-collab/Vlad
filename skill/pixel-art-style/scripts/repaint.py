"""Full repaint of a reference at a chosen grid: crisp clusters, one graded palette
(cool violet shadows, warm coral lights), singleton cleanup. The static half of
approach D (redraw + animate).

    from repaint import repaint, grade, mode_filter
    img, pal, labels = repaint(src_native_float_rgb, n_colors=160)

sharpen: the reference is often an upscaled image; at a grid finer than its blocks the
soft edges show, so an unsharp mask restores edge contrast before the palette fit.
Too much (>0.6) draws bright halos around light objects."""
import sys, os, colorsys
import numpy as np
from scipy import ndimage
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze_style import kmeans, to_perc
W8 = np.array([0.30, 0.59, 0.11]) ** 0.5


def grade(rgb, k=1.0):
    """Colour grading toward the style: shadows cooler/violet, lights warmer, a touch
    more contrast and saturation in the mids. Works on float RGB 0..255 arrays.
    k scales the effect (0 = off): dusk/night references want 1, a sunny day or a
    scene that is already strongly graded (lava, dungeon) wants 0-0.4."""
    if k <= 0:
        return rgb.copy()
    flat = rgb.reshape(-1, 3) / 255
    hls = np.array([colorsys.rgb_to_hls(*p) for p in flat])
    h, l, s = hls[:, 0] * 360, hls[:, 1], hls[:, 2]
    def toward(h, t, k):
        d = ((t - h + 180) % 360) - 180
        return (h + d * k) % 360
    dark = np.clip((0.38 - l) / 0.38, 0, 1)
    light = np.clip((l - 0.5) / 0.4, 0, 1)
    h = toward(h, 262, 0.18 * k * dark)
    h = toward(h, 16, 0.12 * k * light)
    s = np.clip(s * (1 + 0.15 * k * (1 - np.abs(l - 0.45) * 2)), 0, 1)
    l = np.clip(0.5 + (l - 0.5) * (1 + 0.06 * k) - 0.01 * k, 0, 1)            # gentle contrast, darks a bit deeper
    out = np.array([colorsys.hls_to_rgb(a / 360, b, c) for a, b, c in zip(h, l, s)])
    return out.reshape(rgb.shape) * 255


def mode_filter(lab, iters=1):
    """Majority vote in 3x3: removes isolated 'salt' pixels, keeps cluster edges."""
    H, W = lab.shape
    for _ in range(iters):
        pad = np.pad(lab, 1, mode='edge')
        stack = np.stack([pad[dy:dy + H, dx:dx + W] for dy in range(3) for dx in range(3)], 0)
        # count how many neighbours equal each candidate (the 9 values themselves)
        counts = np.stack([(stack == stack[k]).sum(0) for k in range(9)], 0)
        best = stack[np.argmax(counts, 0), np.arange(H)[:, None], np.arange(W)[None]]
        keep = counts[4] >= 2                                      # only true singletons are replaced
        lab = np.where(keep, lab, best)
    return lab


def repaint(src, n_colors=160, seed=0, sharpen=0.45, sharpen_sigma=1.0, grade_k=1.0):
    # The reference is an upscaled image: at a finer grid its soft edges show. An unsharp
    # mask restores edge contrast (whiskers, armour plates, brick edges) before the
    # palette is fitted, so clusters come out crisp instead of mushy.
    blur = np.stack([ndimage.gaussian_filter(src[..., c], sharpen_sigma) for c in range(3)], -1)
    sharp = np.clip(src + (src - blur) * sharpen, 0, 255)
    g = grade(sharp, grade_k)
    c, lab = kmeans(to_perc(g.reshape(-1, 3)), n_colors, iters=14, seed=seed)
    pal = np.clip(c / W8, 0, 255)
    lab = lab.reshape(src.shape[:2])
    lab = mode_filter(lab, 1)
    return pal[lab], pal, lab


