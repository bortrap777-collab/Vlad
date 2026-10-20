#!/usr/bin/env python3
"""Find (and optionally fix) the artifacts that make pixel art look sloppy.

    python artifact_check.py ART.png OUT_DIR [--masks masks.npz] [--ground NAME]
                             [--protect NAME,NAME] [--fix]

Checks
  salt        lone pixels whose colour matches none of their 8 neighbours (noise,
              leftovers of a resample). Fine as stars / sparkles / eyes: pass them
              in --protect (mask names from --masks) or they are reported.
  dust        2-3 px same-colour specks surrounded by one other colour.
  floating    with --masks and --ground: object components that touch neither the
              ground nor another object (a pine above its slope, a lantern above
              the ledge). Every object key in the npz except the ground is tested.
  rare        palette colours used by fewer than 6 pixels (often accidental).
  jaggies     single-pixel steps breaking an otherwise straight edge (1-px notch
              in a horizontal/vertical run).
Writes OUT_DIR/artifacts.png (the art dimmed, issues coloured: salt red, dust
orange, floating magenta, jaggies cyan) and prints a short report. --fix writes
ART_fixed.png with salt/dust/jaggies replaced by the local majority colour.

Use it on every still before animating, and again on one frame of the animation.
"""
import argparse, os
import numpy as np
from PIL import Image
from scipy import ndimage


def neighbours(img):
    H, W = img.shape[:2]
    pad = np.pad(img, ((1, 1), (1, 1), (0, 0)), mode='edge')
    return [pad[1 + dy:1 + dy + H, 1 + dx:1 + dx + W] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]


def code(img):
    return (img[..., 0].astype(np.int64) << 16) | (img[..., 1].astype(np.int64) << 8) | img[..., 2]


def salt(img):
    c = code(img)
    nb = neighbours(c[..., None])
    same = np.zeros(c.shape, int)
    for n in nb:
        same += (n[..., 0] == c)
    return same == 0


def majority(img, mask):
    """Replace masked pixels with the most common colour of their 8 neighbours."""
    c = code(img)
    nb = np.stack([n[..., 0] for n in neighbours(c[..., None])], 0)[:, mask]     # 8 x K
    cnt = (nb[:, None, :] == nb[None, :, :]).sum(1)                              # 8 x K
    best = nb[np.argmax(cnt, 0), np.arange(nb.shape[1])]
    out = img.copy()
    out[mask] = np.stack([(best >> 16) & 255, (best >> 8) & 255, best & 255], -1)
    return out


def dust(img, max_size=3):
    """2..max_size px same-colour specks whose whole border is one other colour.
    Vectorised: all specks of all colours get one global label; the ring colours of
    each speck are compared with labelled min/max (fast on 1000+ px canvases)."""
    c = code(img)
    glob = np.zeros(c.shape, np.int64)
    nxt = 0
    for v in np.unique(c):
        lab, n = ndimage.label(c == v)
        if not n:
            continue
        sizes = np.bincount(lab.ravel())
        keep = np.nonzero((sizes >= 2) & (sizes <= max_size))[0]
        keep = keep[keep > 0]
        if not len(keep):
            continue
        m = np.isin(lab, keep)
        remap = np.zeros(n + 1, np.int64)
        remap[keep] = np.arange(1, len(keep) + 1) + nxt
        glob[m] = remap[lab[m]]
        nxt += len(keep)
    if not nxt:
        return np.zeros(c.shape, bool)
    small = glob > 0
    grown = ndimage.grey_dilation(glob, size=3)
    ring = ~small & (grown > 0)
    ids = np.arange(1, nxt + 1)
    lo = ndimage.minimum(c, labels=np.where(ring, grown, 0), index=ids)
    hi = ndimage.maximum(c, labels=np.where(ring, grown, 0), index=ids)
    single = np.zeros(nxt + 1, bool)
    single[1:] = np.asarray(lo) == np.asarray(hi)
    return single[glob] & small


def jaggies(img):
    """1-px notches: a pixel that differs from its left+right (or up+down) neighbours
    which are equal to each other, while the rows above/below are uniform runs."""
    c = code(img)
    l, r = np.roll(c, 1, 1), np.roll(c, -1, 1)
    u, d = np.roll(c, 1, 0), np.roll(c, -1, 0)
    l2, r2 = np.roll(c, 2, 1), np.roll(c, -2, 1)
    u2, d2 = np.roll(c, 2, 0), np.roll(c, -2, 0)
    # a notch in a straight run: both neighbours AND the next ones equal each other
    # (a dither checkerboard alternates, so l2 == c there and it is not flagged)
    h = (l == r) & (l2 == l) & (r2 == r) & (c != l) & ((u == l) | (d == l))
    v = (u == d) & (u2 == u) & (d2 == d) & (c != u) & ((l == u) | (r == u))
    return (h | v) & ~salt(img)


def clean(img, protect=None, passes=2):
    """Remove salt, dust and jaggies (majority of neighbours), except protected pixels
    (stars, sparkles, eyes, light cores). Returns the cleaned image."""
    out = img.copy()
    for _ in range(passes):
        bad = salt(out) | dust(out) | jaggies(out)
        if protect is not None:
            bad &= ~protect
        if not bad.any():
            break
        out = majority(out, bad)
    return out


def floating(masks, ground_name):
    g = ndimage.binary_dilation(masks[ground_name], iterations=1)
    others = np.zeros_like(g)
    for k, m in masks.items():
        if k != ground_name:
            others |= m
    out = np.zeros_like(g)
    report = []
    for k, m in masks.items():
        if k == ground_name:
            continue
        lab, n = ndimage.label(m)
        for i in range(1, n + 1):
            comp = lab == i
            touch = ndimage.binary_dilation(comp, iterations=1)
            rest = others & ~m
            if not (touch & g).any() and not (touch & rest).any():
                out |= comp
                ys, xs = np.nonzero(comp)
                report.append(f'{k}: component at x={xs.mean():.0f} y={ys.max()} ({comp.sum()} px) touches nothing')
    return out, report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('art'); ap.add_argument('out')
    ap.add_argument('--masks'); ap.add_argument('--ground'); ap.add_argument('--protect', default='')
    ap.add_argument('--check-objects', default='', help='comma list of mask names to test for floating')
    ap.add_argument('--fix', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    img = np.asarray(Image.open(a.art).convert('RGB')).copy()
    M = dict(np.load(a.masks)) if a.masks else {}
    protect = np.zeros(img.shape[:2], bool)
    for k in [p for p in a.protect.split(',') if p]:
        protect |= ndimage.binary_dilation(M[k], iterations=1)
    s = salt(img) & ~protect
    d = dust(img) & ~protect
    j = jaggies(img) & ~protect
    fl, rep = (np.zeros_like(s), [])
    if a.ground and M:
        names = [n for n in a.check_objects.split(',') if n] or [k for k in M if k != a.ground]
        fl, rep = floating({k: M[k] for k in names + [a.ground]}, a.ground)
    c = code(img)
    vals, cnt = np.unique(c, return_counts=True)
    rare = vals[cnt < 6]
    print(f'salt {s.sum()}  dust {d.sum()}  jaggies {j.sum()}  floating {fl.sum()}  rare colours {len(rare)} / {len(vals)}')
    for r in rep[:20]:
        print('  ', r)
    view = (img * 0.35).astype(np.uint8)
    view[j] = (0, 255, 255); view[d] = (255, 160, 0); view[s] = (255, 40, 40); view[fl] = (255, 0, 255)
    Image.fromarray(view).save(os.path.join(a.out, 'artifacts.png'))
    if a.fix:
        fixed = majority(img, s | d | j)
        stem = os.path.splitext(a.art)[0]
        Image.fromarray(fixed).save(stem + '_fixed.png')
        print('fixed ->', stem + '_fixed.png')


if __name__ == '__main__':
    main()
