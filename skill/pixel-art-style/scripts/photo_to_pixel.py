#!/usr/bin/env python3
"""Photo -> pixel art in the user's style (approach F).

    python photo_to_pixel.py PHOTO OUT_DIR --width 320 [--colors 64] [--grade 1.0]
                             [--sat 1.25] [--style style.json] [--outline 0.35]

Writes OUT_DIR/native.png (the art grid), OUT_DIR/big.png (native enlarged to the
photo size with nearest-neighbour; feed it to Location(..., grid=scale) to animate)
and OUT_DIR/info.json (scale, native size).

Why not just downscale: a plain resize of a photo gives a blurry mosaic of hundreds
of muddy colours — it reads as "low-res photo", not pixel art. Pixel art needs
  1. flat clusters: edge-preserving smoothing before the reduction (median at 2x the
     grid), so skin, cloth and sky become calm areas and edges stay sharp;
  2. a small palette chosen like a painter: k-means in perceptual space, then the
     style's grading (violet shadows, warm lights, richer mid saturation);
  3. crisp edges: a light unsharp at the grid, then singleton cleanup;
  4. selective dark outline: only on strong edges between big shapes (figure vs
     background), one step darker, never black.
With --style the palette is pulled toward the reference palette (mix 0..1 via
--style-mix), so the photo lands in the same colour world as the user's art.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze_style import kmeans, to_perc, _assign
from repaint import grade, mode_filter
W8 = np.array([0.30, 0.59, 0.11]) ** 0.5
LUM = np.array([0.30, 0.59, 0.11])


def saturate(rgb, k):
    g = (rgb @ LUM)[..., None]
    return np.clip(g + (rgb - g) * k, 0, 255)


def s_curve(rgb, k=0.1):
    """Gentle contrast around mid-grey."""
    return np.clip((rgb / 255 - 0.5) * (1 + k) + 0.5, 0, 1) * 255


def convert(photo, width=320, colors=64, grade_k=1.0, sat=1.25, contrast=0.1, outline=0.3,
            style=None, style_mix=0.35, seed=0, smooth=3, dither=True, dither_var=60.0, outline_edge=70):
    im = Image.open(photo).convert('RGB')
    scale = max(1, round(im.width / width))
    W, H = im.width // scale, im.height // scale
    im = im.crop((0, 0, W * scale, H * scale))
    # 1. edge-preserving smoothing at 2x the grid, then box-reduce
    two = np.asarray(im.resize((W * 2, H * 2), Image.LANCZOS)).astype(float)
    if smooth:
        two = np.stack([ndimage.median_filter(two[..., c], size=smooth) for c in range(3)], -1)
    nat = np.asarray(Image.fromarray(two.clip(0, 255).astype(np.uint8)).resize((W, H), Image.BOX)).astype(float)
    # 2. crisp + graded
    blur = np.stack([ndimage.gaussian_filter(nat[..., c], 1.0) for c in range(3)], -1)
    nat = np.clip(nat + (nat - blur) * 0.5, 0, 255)
    nat = s_curve(saturate(nat, sat), contrast)
    nat = grade(nat, grade_k)
    # 3. palette
    c, lab = kmeans(to_perc(nat.reshape(-1, 3)), colors, iters=20, seed=seed)
    pal = np.clip(c / W8, 0, 255)
    if style:
        with open(style) as f:
            st = json.load(f)
        ref = np.array([[int(e['hex'][i:i + 2], 16) for i in (1, 3, 5)] for e in st['palette']], float)
        near = ref[_assign(to_perc(pal), to_perc(ref))]
        pal = pal * (1 - style_mix) + near * style_mix
    lab = lab.reshape(H, W)
    lab = mode_filter(lab, 1)
    out = pal[lab]
    # 4. ordered dither ONLY in smooth gradients (sky, fog, skin): a photo's smooth
    # ramps otherwise posterize into hard bands. Each pixel mixes its two nearest
    # palette colours by its position between them (Bayer threshold), so a gradient
    # becomes short dithered transitions between flat bands — the hand-made look.
    if dither:
        flat = nat.reshape(-1, 3)
        P = to_perc(pal); X = to_perc(flat)
        d = ((X[:, None] - P[None]) ** 2).sum(-1)
        o = np.argsort(d, 1)[:, :2]
        c1, c2 = P[o[:, 0]], P[o[:, 1]]
        seg = c2 - c1
        t = np.clip(((X - c1) * seg).sum(1) / np.maximum((seg * seg).sum(1), 1e-6), 0, 1)
        Lm = nat @ LUM
        smooth_area = (ndimage.uniform_filter(Lm ** 2, 3) - ndimage.uniform_filter(Lm, 3) ** 2) < dither_var
        yy, xx = np.mgrid[0:H, 0:W]
        B = ((np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) + 0.5) / 16)[yy % 4, xx % 4]
        use2 = (t.reshape(H, W) > B) & smooth_area & (t.reshape(H, W) > 0.12)
        lab_d = np.where(use2, o[:, 1].reshape(H, W), o[:, 0].reshape(H, W))
        lab = np.where(smooth_area, lab_d, lab)
        out = pal[lab]
    # 5. selective outline: only on very strong edges (figure against the sky / fog),
    # the darker side one step darker — never on soft interior edges (hands, folds)
    if outline:
        L = out @ LUM
        gy = np.abs(np.diff(L, axis=0, prepend=L[:1])); gx = np.abs(np.diff(L, axis=1, prepend=L[:, :1]))
        edge = np.maximum(gx, gy) > outline_edge
        darker = edge & (L < ndimage.uniform_filter(L, 3))
        dark_pal = pal * (1 - outline)
        out[darker] = out[darker] * (1 - outline)
        pal = np.vstack([pal, dark_pal])
        lab2 = _assign(to_perc(out.reshape(-1, 3)), to_perc(pal))
        out = pal[lab2].reshape(H, W, 3)
    return out.clip(0, 255).astype(np.uint8), scale


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('photo'); ap.add_argument('out')
    ap.add_argument('--width', type=int, default=320)
    ap.add_argument('--colors', type=int, default=64)
    ap.add_argument('--grade', type=float, default=1.0)
    ap.add_argument('--sat', type=float, default=1.25)
    ap.add_argument('--contrast', type=float, default=0.1)
    ap.add_argument('--outline', type=float, default=0.35)
    ap.add_argument('--style'); ap.add_argument('--style-mix', type=float, default=0.35)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    nat, scale = convert(a.photo, a.width, a.colors, a.grade, a.sat, a.contrast, a.outline, a.style, a.style_mix)
    H, W = nat.shape[:2]
    Image.fromarray(nat).save(os.path.join(a.out, 'native.png'))
    Image.fromarray(nat).resize((W * scale, H * scale), Image.NEAREST).save(os.path.join(a.out, 'big.png'))
    with open(os.path.join(a.out, 'info.json'), 'w') as f:
        json.dump(dict(native=[W, H], scale=scale, colors=int(len(np.unique(nat.reshape(-1, 3), axis=0)))), f)
    print(f'native {W}x{H} x{scale}')


if __name__ == '__main__':
    main()


def leaf_clumps(img, mask, light=(0, 0), scale=3.0, seed=0, lift=1.28, drop=0.72, pal=None):
    """Turn blurry photo foliage into pixel-art leaf clusters: a noise field cut into
    clumps; the clump edge facing the light gets one step lighter, the opposite edge one
    step darker. Photos have bokeh where pixel art has readable leaf masses.
    pal: snap the new colours to it (default: the colours already in img)."""
    H, W = mask.shape
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fx import tile_noise
    n = tile_noise(H, W, scale, seed, 2)
    clump = (n > 0.52) & mask
    yy, xx = np.mgrid[0:H, 0:W]
    dx = np.sign(light[0] - xx).astype(int); dy = np.sign(light[1] - yy).astype(int)
    toward = clump[np.clip(yy + dy, 0, H - 1), np.clip(xx + dx, 0, W - 1)]
    away = clump[np.clip(yy - dy, 0, H - 1), np.clip(xx - dx, 0, W - 1)]
    lit = clump & ~toward
    shade = clump & ~away
    out = img.astype(float).copy()
    out[lit] = np.clip(out[lit] * lift + 8, 0, 255)
    out[shade & ~lit] = out[shade & ~lit] * drop
    if pal is None:
        pal = np.unique(img.reshape(-1, 3), axis=0).astype(float)
    pal = np.asarray(pal, float)
    ch = lit | shade
    out[ch] = pal[_assign(to_perc(out[ch]), to_perc(pal))]
    return out
