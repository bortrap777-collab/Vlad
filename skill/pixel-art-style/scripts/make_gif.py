#!/usr/bin/env python3
"""Assemble animation frames into a GIF plus numbered PNG frames.

Usage:
    python make_gif.py <out_stem> <scale> <frame1_native.png> <frame2_native.png> ... [--ms 120]
    python make_gif.py out/lanterns 4 frames/f_*.png --ms 100

Writes:
    <out_stem>.gif                 enlarged, crisp, loops forever
    <out_stem>_frames/frame_01.png enlarged frames (original size), one per frame

Frames must share size. Uses one shared palette across all frames so colours
never flicker between frames (a common GIF artefact with per-frame palettes).
"""
import argparse, os
import numpy as np
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('stem'); ap.add_argument('scale', type=int); ap.add_argument('frames', nargs='+')
    ap.add_argument('--ms', type=int, default=120, help='duration per frame, ms')
    a = ap.parse_args()
    frames = [Image.open(f).convert('RGB') for f in sorted(a.frames)]
    w, h = frames[0].size
    big = [f.resize((w * a.scale, h * a.scale), Image.NEAREST) for f in frames]

    os.makedirs(a.stem + '_frames', exist_ok=True)
    for i, f in enumerate(big, 1):
        f.save(os.path.join(a.stem + '_frames', f'frame_{i:02d}.png'))

    allc = np.unique(np.concatenate([np.asarray(f).reshape(-1, 3) for f in frames]), axis=0)
    if len(allc) > 256:
        raise SystemExit(f'{len(allc)} colours across frames; GIF allows 256. Snap frames to the palette first.')
    pal_img = Image.new('P', (1, 1))
    flatpal = list(allc.astype(np.uint8).ravel()) + [0] * (768 - 3 * len(allc))
    pal_img.putpalette(flatpal)
    q = [f.quantize(palette=pal_img, dither=Image.Dither.NONE) for f in big]
    q[0].save(a.stem + '.gif', save_all=True, append_images=q[1:], duration=a.ms, loop=0, disposal=1, optimize=False)
    print(f'{a.stem}.gif  {len(q)} frames  {w*a.scale}x{h*a.scale}  {len(allc)} colours  {a.ms} ms/frame')


if __name__ == '__main__':
    main()
