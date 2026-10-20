#!/usr/bin/env python3
"""Analyze the style of a pixel-art reference image.

Usage:
    python analyze_style.py <image> <out_dir> [--scale N] [--base 18] [--accents 8]

Writes to out_dir:
    style.json      grid scale, native size, palette (base + accents), tonal stats
    native.png      the reference reduced to its native pixel grid (exact palette)
    palette.png     swatch sheet, base colours on top row, accents below
    preview.png     native.png enlarged with nearest-neighbour, for eyeballing

Why two palette passes: ordinary quantization weights colours by area, so tiny
but essential colours (a white cat, amber window light, moss green) get merged
into neighbours and the picture loses its focal points. Accents are clustered
separately from the brightest / most saturated pixels and always kept.
"""
import argparse, colorsys, json, os
import numpy as np
from PIL import Image


def detect_scale(a):
    """Estimate the size of one art pixel in screen pixels (may be fractional)."""
    g = a.mean(2)
    best = []
    for axis in (0, 1):
        edges = np.abs(np.diff(g, axis=axis)).mean(axis=1 - axis)
        edges = edges - edges.mean()
        spec = np.abs(np.fft.rfft(edges * np.hanning(len(edges))))
        freqs = np.fft.rfftfreq(len(edges))
        mask = (freqs > 1 / 12) & (freqs < 1 / 2.2)   # periods 2.2 .. 12 px
        f = freqs[mask][np.argmax(spec[mask])]
        best.append(1 / f)
    fft_est = float(np.median(best))

    # Many references are upscaled/AI-made with soft, uneven grids, so a fractional
    # estimate is common. Output must scale back to the source size cleanly, so
    # choose an integer scale: among local minima of reconstruction error (with a
    # bonus when it divides the source size exactly), the one closest to the FFT
    # estimate.
    H, W = g.shape
    err = {}
    for s in range(2, 11):
        w, h = W // s, H // s
        if w < 16 or h < 16:
            break
        im = Image.fromarray(a.astype(np.uint8))
        small = im.resize((w, h), Image.BOX)
        back = np.asarray(small.resize((w * s, h * s), Image.NEAREST)).astype(float)
        err[s] = np.abs(back - a[:h * s, :w * s]).mean()
    ks = sorted(err)
    mins = [s for i, s in enumerate(ks)
            if (i == 0 or err[s] <= err[ks[i - 1]]) and (i == len(ks) - 1 or err[s] <= err[ks[i + 1]])
            and s >= 3]
    if not mins:
        return fft_est
    def cost(s):
        exact = (W % s == 0) + (H % s == 0)
        return abs(s - fft_est) - 0.4 * exact
    return float(min(mins, key=cost))


def _assign(x, c):
    out = np.empty(len(x), int)
    for i in range(0, len(x), 16384):
        d = ((x[i:i + 16384, None] - c[None]) ** 2).sum(-1)
        out[i:i + 16384] = np.argmin(d, 1)
    return out


def kmeans(x, k, iters=25, seed=0, sample=30000):
    """k-means fitted on a random sample (large grids would need GBs otherwise);
    labels for all points are assigned in chunks."""
    rng = np.random.default_rng(seed)
    full = x
    if len(x) > sample:
        x = x[rng.choice(len(x), sample, replace=False)]
    c, _ = _kmeans_core(x, k, iters, rng)
    return c, _assign(full, c)


def _kmeans_core(x, k, iters, rng):
    # k-means++ init with an incrementally updated nearest-centre distance
    c = [x[rng.integers(len(x))]]
    d = ((x - c[0]) ** 2).sum(1)
    for _ in range(1, k):
        nxt = x[rng.choice(len(x), p=d / d.sum())] if d.sum() > 0 else x[rng.integers(len(x))]
        c.append(nxt)
        d = np.minimum(d, ((x - nxt) ** 2).sum(1))
    c = np.array(c, float)
    for _ in range(iters):
        lab = _assign(x, c)
        cnt = np.bincount(lab, minlength=k)
        for ch in range(x.shape[1]):
            s = np.bincount(lab, weights=x[:, ch], minlength=k)
            c[cnt > 0, ch] = s[cnt > 0] / cnt[cnt > 0]
    return c, _assign(x, c)


def to_perc(rgb):
    """Rough perceptual space: weight channels so distances follow the eye."""
    return rgb * np.array([0.30, 0.59, 0.11]) ** 0.5


def hls(c):
    h, l, s = colorsys.rgb_to_hls(*(np.clip(c, 0, 255) / 255))
    return h * 360, l, s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('image'); ap.add_argument('out_dir')
    ap.add_argument('--scale', type=float, help='override detected pixel size')
    ap.add_argument('--base', type=int, default=18)
    ap.add_argument('--accents', type=int, default=8)
    args = ap.parse_args()
    os.makedirs(args.out_dir, exist_ok=True)

    im = Image.open(args.image).convert('RGB')
    a = np.asarray(im).astype(float)
    scale = args.scale or detect_scale(a)
    W, H = max(8, round(im.width / scale)), max(8, round(im.height / scale))
    native = np.asarray(im.resize((W, H), Image.BOX)).astype(float)
    px = native.reshape(-1, 3)

    # --- base palette: area-weighted
    cb, _ = kmeans(to_perc(px), args.base)
    base = cb / np.array([0.30, 0.59, 0.11]) ** 0.5

    # --- accents: pixels that stand out by lightness or chroma
    # Main pool: pixels that stand out by lightness or chroma. Extra small pool of the
    # very lightest pixels, so near-white highlights survive next to saturated lights.
    # Note: "white" in a warm-lit scene is often a pale peach/pink — trust the numbers.
    L = px.mean(1) / 255
    S = (px.max(1) - px.min(1)) / 255
    acc = []
    for score, q, k, seed in ((np.maximum(L, S * 1.4), 0.97, args.accents, 1), (L, 0.99, 3, 2)):
        cand = px[score >= np.quantile(score, q)]
        if len(cand) >= k > 0:
            ca, _ = kmeans(to_perc(cand), k, seed=seed)
            acc += list(ca / np.array([0.30, 0.59, 0.11]) ** 0.5)
    # drop accents that duplicate a base colour
    kept = []
    for c in acc:
        if np.min(np.abs(base - c).sum(1)) > 40 and all(np.abs(k - c).sum() > 30 for k in kept):
            kept.append(c)
    acc = kept
    # --- hue coverage: muted but distinct hues (olive grass, mossy stone) can be
    # neither big enough for the base pass nor bright enough for the accent pass.
    # For every 30° hue band that holds a noticeable share of chromatic pixels but
    # has no palette colour nearby, add a dark and a light representative.
    def hue_of(c):
        return hls(c)[0], hls(c)[2]
    pal_hues = [hue_of(c) for c in list(base) + list(acc)]
    hpx = np.array([colorsys.rgb_to_hls(*(p / 255)) for p in px[::3]])
    sub = px[::3]
    chrom = (sub.max(1) - sub.min(1)) / 255 > 0.08
    extra = []
    for lo in range(0, 360, 30):
        hh = hpx[:, 0] * 360
        m = chrom & (hh >= lo) & (hh < lo + 30) & (hpx[:, 1] > 0.08)
        if m.mean() < 0.002:
            continue
        mid = lo + 15
        covered = any(min(abs(h - mid), 360 - abs(h - mid)) < 25 and s > 0.12 for h, s in pal_hues)
        if covered:
            continue
        grp = sub[m]
        lum = grp.mean(1)
        for part in (grp[lum <= np.median(lum)], grp[lum > np.median(lum)]):
            if len(part):
                extra.append(np.median(part, 0))
    if extra:
        acc = list(acc) + extra
    pal = np.vstack([base] + ([np.array(acc)] if len(acc) else []))
    pal = np.clip(np.round(pal), 0, 255).astype(np.uint8)

    lab = np.argmin(((to_perc(px)[:, None] - to_perc(pal.astype(float))[None]) ** 2).sum(-1), 1)
    share = np.bincount(lab, minlength=len(pal)) / len(lab)
    nat = pal[lab].reshape(H, W, 3)
    Image.fromarray(nat).save(os.path.join(args.out_dir, 'native.png'))
    k = max(1, round(scale))
    Image.fromarray(nat).resize((W * k, H * k), Image.NEAREST).save(os.path.join(args.out_dir, 'preview.png'))

    entries = []
    for i, c in enumerate(pal):
        h, l, s = hls(c.astype(float))
        entries.append({'hex': '#%02x%02x%02x' % tuple(c), 'share': round(float(share[i]), 4),
                        'role': 'base' if i < len(base) else 'accent',
                        'hue': round(h), 'light': round(l, 2), 'sat': round(s, 2)})
    entries.sort(key=lambda e: (e['role'] != 'base', e['light']))

    # swatches
    nb = sum(e['role'] == 'base' for e in entries)
    cols = max(nb, len(entries) - nb, 1)
    sw = Image.new('RGB', (cols * 24, 48), (255, 255, 255))
    for j, e in enumerate(entries):
        r, cidx = (0, j) if j < nb else (1, j - nb)
        sw.paste(tuple(int(e['hex'][t:t + 2], 16) for t in (1, 3, 5)), (cidx * 24, r * 24, cidx * 24 + 24, r * 24 + 24))
    sw.save(os.path.join(args.out_dir, 'palette.png'))

    Ln = nat.mean(2) / 255
    dark = [e for e in entries if e['light'] < 0.3]
    style = {
        'source': os.path.abspath(args.image),
        'source_size': [im.width, im.height],
        'pixel_scale': round(scale, 2),
        'native_size': [W, H],
        'palette': entries,
        'mean_lightness': round(float(Ln.mean()), 3),
        'dark_share': round(float((Ln < 0.2).mean()), 3),
        'bright_share': round(float((Ln > 0.7).mean()), 4),
        'shadow_hue': round(float(np.median([e['hue'] for e in dark]))) if dark else None,
        'unique_colors_in_source': int(len(np.unique(a.reshape(-1, 3).astype(np.uint8), axis=0))),
    }
    with open(os.path.join(args.out_dir, 'style.json'), 'w') as f:
        json.dump(style, f, indent=2, ensure_ascii=False)
    print(json.dumps({k: v for k, v in style.items() if k != 'palette'}, ensure_ascii=False, indent=1))
    for e in entries:
        print(f"{e['role']:6} {e['hex']} {e['share']*100:5.1f}%  hue {e['hue']:3}  L {e['light']:.2f}  S {e['sat']:.2f}")


if __name__ == '__main__':
    main()
