#!/usr/bin/env python3
"""Check a finished piece against the reference style.

Usage:
    python check_art.py <art_native.png> <style.json> [--enlarged art.png]

Reports, with a verdict per line:
  - colours used and how many are off the reference palette
  - mean lightness / dark share compared with the reference (mood match)
  - orphan pixels: isolated single pixels unlike all 4 neighbours (noise / 'dirt')
  - whether the accent colours appear at all (focal points present)
  - for the enlarged file: exact integer scale with hard pixel edges
Problems are hints, not hard failures: a dawn version of a night scene SHOULD be
lighter. Read the numbers, then look at the picture.
"""
import argparse, json
import numpy as np
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('art'); ap.add_argument('style')
    ap.add_argument('--enlarged')
    ap.add_argument('--palette', help='JSON list of hex colours (or {"hex": [...]}) to check against '
                    'instead of the reference palette, e.g. for night/winter variants')
    a = ap.parse_args()
    st = json.load(open(a.style))
    pal = {e['hex'] for e in st['palette']}
    if a.palette:
        extra = json.load(open(a.palette))
        pal = set(extra['hex'] if isinstance(extra, dict) else extra)
    acc = {e['hex'] for e in st['palette'] if e['role'] == 'accent'}
    im = np.asarray(Image.open(a.art).convert('RGB'))
    h, w, _ = im.shape
    flat = im.reshape(-1, 3)
    cols, counts = np.unique(flat, axis=0, return_counts=True)
    hexes = ['#%02x%02x%02x' % tuple(c) for c in cols]
    off = [x for x in hexes if x not in pal]
    ok = lambda b: 'OK ' if b else '!! '

    print(f'size {w}x{h} (reference native {st["native_size"][0]}x{st["native_size"][1]})')
    print(ok(not off) + f'colours used: {len(cols)}, off-palette: {len(off)}' + (f' e.g. {off[:5]}' if off else ''))

    L = im.mean(2) / 255
    dl = L.mean() - st['mean_lightness']
    print(ok(abs(dl) < 0.06) + ('(variant: expected to differ) ' if a.palette else '') + f'mean lightness {L.mean():.3f} vs ref {st["mean_lightness"]:.3f} (diff {dl:+.3f})')
    dd = (L < 0.2).mean() - st['dark_share']
    print(ok(abs(dd) < 0.15) + f'dark share {(L < 0.2).mean():.2f} vs ref {st["dark_share"]:.2f}')

    used_acc = [x for x in hexes if x in acc]
    print(ok(bool(used_acc) or not acc) + f'accent colours present: {len(used_acc)}/{len(acc)}')

    p = im.astype(int)
    c = p[1:-1, 1:-1]
    diff = lambda q: np.abs(c - q).sum(2) > 30
    orphan = diff(p[:-2, 1:-1]) & diff(p[2:, 1:-1]) & diff(p[1:-1, :-2]) & diff(p[1:-1, 2:])
    # orphans that are also the same colour as none of the 8 neighbours = true noise
    rate = orphan.mean()
    print(ok(rate < 0.03) + f'orphan pixels {rate*100:.1f}% (texture is fine; >3% reads as noise)')

    if a.enlarged:
        E = np.asarray(Image.open(a.enlarged).convert('RGB'))
        sy, sx = E.shape[0] / h, E.shape[1] / w
        integer = sx == sy and sx == int(sx)
        crisp = False
        if integer:
            s = int(sx)
            crisp = np.array_equal(E, np.asarray(Image.fromarray(im).resize((w * s, h * s), Image.NEAREST)))
        print(ok(integer and crisp) + f'enlarged {E.shape[1]}x{E.shape[0]}: scale x{sx:g}, crisp blocks: {crisp}; '
              f'source size was {st["source_size"][0]}x{st["source_size"][1]}')


if __name__ == '__main__':
    main()
