#!/usr/bin/env python3
"""Check an animation for the problems that make pixel animation look cheap.

Usage:
    python inspect_frames.py <frames_dir_or_glob> <out_dir> [--ref REF.png]

Reports per region of the frame:
  - flicker: pixels that change and change BACK on the next frame (A->B->A). Single-frame
    blinking reads as shimmer/"рябь"; real motion moves on. Flicker should be rare
    except in deliberate effects (sparkles, flames).
  - loop seam: difference last->first vs typical frame->frame (a seamless loop matches).
  - moving share: how much of the picture moves at all.
Writes motion_map.png (red = moves, yellow = moves a lot, blue = flickers).
"""
import argparse, glob, os
import numpy as np
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('frames'); ap.add_argument('out')
    a = ap.parse_args()
    files = sorted(glob.glob(os.path.join(a.frames, '*.png')) if os.path.isdir(a.frames) else glob.glob(a.frames))
    fr = np.array([np.asarray(Image.open(f).convert('RGB')).astype(int) for f in files])
    n, H, W, _ = fr.shape
    os.makedirs(a.out, exist_ok=True)
    diff = np.abs(np.diff(np.concatenate([fr, fr[:1]]), axis=0)).sum(-1) > 24          # n x H x W (incl. wrap)
    nxt = np.roll(fr, -1, 0); nxt2 = np.roll(fr, -2, 0)
    flick = (np.abs(nxt - fr).sum(-1) > 24) & (np.abs(nxt2 - fr).sum(-1) <= 6)        # A->B->A
    moving = diff.any(0)
    flick_rate = flick.mean(0)
    seam = np.abs(fr[-1] - fr[0]).sum(); step = np.mean([np.abs(fr[i + 1] - fr[i]).sum() for i in range(n - 1)])
    print(f'frames {n} {W}x{H}')
    print(f'moving pixels {moving.mean()*100:.1f}%   flicker pixels (A-B-A) {(flick_rate > 0).mean()*100:.2f}%')
    print(f'loop seam {seam/step:.2f}x a normal step (≈1 = seamless)')
    gy, gx = 4, 4
    print('flicker by region (% of region pixels that ever flicker):')
    for j in range(gy):
        row = []
        for i in range(gx):
            sl = (slice(j * H // gy, (j + 1) * H // gy), slice(i * W // gx, (i + 1) * W // gx))
            row.append(f'{(flick_rate[sl] > 0).mean()*100:5.1f}')
        print('   ' + ' '.join(row))
    base = fr[0].mean(-1) * 0.35
    img = np.stack([base] * 3, -1)
    act = diff.mean(0)
    img[..., 0] = np.maximum(img[..., 0], np.clip(act * 4, 0, 1) * 255)
    img[..., 1] = np.maximum(img[..., 1], np.clip(act * 4 - 1, 0, 1) * 255)
    fl = flick_rate > 0
    img[fl] = [60, 140, 255]
    Image.fromarray(img.astype(np.uint8)).save(os.path.join(a.out, 'motion_map.png'))


if __name__ == '__main__':
    main()
