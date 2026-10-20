"""A living location: static repainted scene + effects redrawn every frame (approach E).

    import sys; sys.path.insert(0, '<skill>/scripts')
    from location import Location
    import fx
    L = Location('refs/lava.png', grid=2, N=24, n_colors=150, grade_k=0.0)
    lake = L.box(100, 118, 383, 171) & (L.L > 0.35) & (L.hue < 50)
    L.add(fx.Liquid(lake, churn=5), fx.Flame(148, 93, 6, 4, mask=...))
    L.render('out/lava', ms=90)

What render() writes (stem = out/lava):
    out/lava.gif             at the reference size (grid x scale)
    out/lava_x4.gif          a bigger copy for viewing (if 4 not already the scale)
    out/lava_frames/         native frames f_00.png ... (Pixelorama: 1 file px = 1 art px)
    out/lava_sheet.png       native spritesheet (cols x rows), for Pixelorama import
    out/lava_still.png       frame 0 at the reference size

Order of work inside: effects declare what they replace (plate); those pixels are
painted out (variants.inpaint) and the scene is repainted once with ~n_colors
(repaint.py, no blur). Each frame starts from the plate repaint, effects draw in
layer order, the frame snaps to one shared palette (<=256, GIF-safe).
"""
import os, sys, json
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from variants import load_native, analyse, inpaint
from repaint import grade, mode_filter
from analyze_style import kmeans, to_perc, _assign
W8 = np.array([0.30, 0.59, 0.11]) ** 0.5


def snap(img, pal):
    flat = img.reshape(-1, 3).astype(np.float32)
    p = pal.astype(np.float32)
    idx = np.empty(len(flat), np.int32)
    pw = p * W8.astype(np.float32)
    for i in range(0, len(flat), 16384):
        c = flat[i:i + 16384] * W8.astype(np.float32)
        d = (c * c).sum(1)[:, None] - 2 * c @ pw.T + (pw * pw).sum(1)[None]
        idx[i:i + 16384] = np.argmin(d, 1)
    return idx.reshape(img.shape[:2])


def merge_palette(cols, max_n=256, min_dist=5.0, keep_first=0):
    """Drop near-duplicates (perceptual distance < min_dist); if still too many,
    reduce the EXTRAS with k-means. The first keep_first colours (the repaint
    palette) are never moved, so the static scene keeps its exact colours."""
    cols = np.clip(np.round(np.asarray(cols, float)), 0, 255)
    base, extra = cols[:keep_first], cols[keep_first:]
    keep = list(base)
    for c in extra:
        if not keep or np.min(np.abs((np.array(keep) - c) * W8).sum(1)) >= min_dist:
            keep.append(c)
    keep = np.array(keep)
    if len(keep) > max_n:
        ex = keep[len(base):]
        c, _ = kmeans(to_perc(ex), max_n - len(base), iters=10, seed=0)
        keep = np.vstack([base, np.clip(np.round(c / W8), 0, 255)])
    return keep


class Location:
    def __init__(self, ref, grid=1, unit=2, N=24, n_colors=170, grade_k=0.0, sharpen=None, seed=0,
                 denoise=None):
        """grid: screen px of the reference per art pixel. 1 = every reference pixel is
        an art pixel (finest; use it unless the reference really has bigger blocks —
        a 2x grid on a soft AI image reads as "bitten" edges).
        unit: scene scripts are written in design units of `unit` art px, so box(),
        clean() and self.u keep one coordinate system whatever the grid."""
        im = Image.open(ref).convert('RGB')
        self.ref_size = im.size
        self.grid = grid
        self.U = self.u = unit
        sharpen = (0.0 if grid == 1 else 0.35) if sharpen is None else sharpen
        self.denoise = (grid >= 2) if denoise is None else denoise
        self.W, self.H = im.width // grid, im.height // grid
        self.src = load_native(ref, self.W, self.H)
        A = analyse(self.src)
        self.A = A
        self.hue, self.L, self.S, self.yy, self.xx = A['hue'], A['L'], A['S'], A['yy'], A['xx']
        self.N = N; self.n_colors = n_colors; self.grade_k = grade_k; self.sharpen = sharpen
        self.seed = seed
        self.effects = []
        self.extra_colors = []
        self._repaint_palette()

    # ---------- masks
    def box(self, x0, y0, x1, y1):
        """Rectangle in design units."""
        u = self.U
        return (self.xx >= x0 * u) & (self.xx < x1 * u) & (self.yy >= y0 * u) & (self.yy < y1 * u)

    def clean(self, m, close=0, min_size=3, fill=False):
        """close (iterations) and min_size (area) are in design units."""
        min_size = min_size * self.U ** 2
        if close:
            m = ndimage.binary_closing(m, iterations=close * self.U)
        if fill:
            m = ndimage.binary_fill_holes(m)
        lab, n = ndimage.label(m)
        if n:
            sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
            small = np.isin(lab, np.nonzero(sizes < min_size)[0] + 1)
            m = m & ~small
        return m

    def warm(self, lo=15, hi=62):
        return (self.hue > lo) & (self.hue < hi)

    # ---------- palette + base
    def _prep(self, img):
        blur = np.stack([ndimage.gaussian_filter(img[..., c], 1.0) for c in range(3)], -1)
        sharp = np.clip(img + (img - blur) * self.sharpen, 0, 255)
        return grade(sharp, self.grade_k) if self.grade_k > 0 else sharp

    def _repaint_palette(self):
        g = self._prep(self.src)
        c, lab = kmeans(to_perc(g.reshape(-1, 3)), self.n_colors, iters=14, seed=self.seed)
        self.pal = np.clip(c / W8, 0, 255)
        lab = lab.reshape(self.H, self.W)
        if self.denoise:
            lab = mode_filter(lab, 1)
        self.ref_img = self.pal[lab]

    def add(self, *effects):
        self.effects.extend(effects)
        return self

    def build(self):
        self.base = self.ref_img             # objects are redrawn from the full repaint
        for e in self.effects:
            e.u = self.U                     # design unit -> art px, for effect internals
            e.bind(self)
        movers = np.zeros((self.H, self.W), bool)
        for e in self.effects:
            if getattr(e, 'plate', None) is not None:
                movers |= e.plate if getattr(e, 'exact_plate', False) else ndimage.binary_dilation(e.plate, iterations=self.U)
        plate = inpaint(self.src, movers, iters=30) if movers.any() else self.src
        g = self._prep(plate)
        lab = _assign(to_perc(g.reshape(-1, 3)), to_perc(self.pal)).reshape(self.H, self.W)
        if self.denoise:
            lab = mode_filter(lab, 1)
        self.plate_img = self.pal[lab]
        cols = [self.pal]
        for e in self.effects:
            c = e.colors()
            if len(c):
                cols.append(np.asarray(c, float).reshape(-1, 3))
        if self.extra_colors:
            cols.append(np.asarray(self.extra_colors, float))
        self.PAL = merge_palette(np.vstack(cols), keep_first=len(self.pal))
        self.order = sorted(self.effects, key=lambda e: e.layer)

    def frame(self, f):
        img = self.plate_img.copy()
        for e in self.order:
            e.draw(img, f, self.N)
        return self.PAL[snap(np.clip(img, 0, 255), self.PAL)].astype(np.uint8)

    def render(self, stem, ms=90, big=2, sheet_cols=None, frames=None):
        self.build()
        d = os.path.dirname(stem)
        if d:
            os.makedirs(d, exist_ok=True)
        fd = stem + '_frames'
        os.makedirs(fd, exist_ok=True)
        idx = range(self.N) if frames is None else frames
        out = []
        for f in idx:
            fr = self.frame(f)
            Image.fromarray(fr).save(f'{fd}/f_{f:02d}.png')
            out.append(fr)
        if frames is not None:
            return out
        scale = self.grid
        self._gif(out, stem + '.gif', scale, ms)
        if big and big != scale:
            self._gif(out, stem + f'_x{big}.gif', big, ms)
        Image.fromarray(out[0]).resize((self.W * scale, self.H * scale), Image.NEAREST).save(stem + '_still.png')
        cols = sheet_cols or int(np.ceil(np.sqrt(len(out))))
        rows = int(np.ceil(len(out) / cols))
        sheet = Image.new('RGB', (cols * self.W, rows * self.H))
        for i, fr in enumerate(out):
            sheet.paste(Image.fromarray(fr), ((i % cols) * self.W, (i // cols) * self.H))
        sheet.save(stem + '_sheet.png')
        with open(stem + '_info.json', 'w') as fh:
            json.dump(dict(native=[self.W, self.H], scale=scale, frames=len(out), ms=ms,
                           sheet=[cols, rows], palette=len(self.PAL)), fh)
        print(f'{stem}: {len(out)} frames {self.W}x{self.H} x{scale}, palette {len(self.PAL)}')
        return out

    def _gif(self, frames, path, scale, ms):
        pal_img = Image.new('P', (1, 1))
        P = self.PAL.astype(np.uint8)
        pal_img.putpalette(list(P.ravel()) + [0] * (768 - 3 * len(P)))
        q = [Image.fromarray(fr).resize((self.W * scale, self.H * scale), Image.NEAREST)
             .quantize(palette=pal_img, dither=Image.Dither.NONE) for fr in frames]
        q[0].save(path, save_all=True, append_images=q[1:], duration=ms, loop=0, disposal=1, optimize=False)

    # ---------- debugging
    def overlay(self, path, masks, scale=2):
        """Save the reference dimmed with coloured masks on top (check masks by eye)."""
        over = self.src * 0.4
        cols = [(255, 40, 40), (255, 200, 0), (0, 255, 255), (0, 255, 0), (255, 0, 255), (80, 120, 255), (255, 255, 255)]
        for i, m in enumerate(masks):
            over[m] = cols[i % len(cols)]
        Image.fromarray(over.astype(np.uint8)).resize((self.W * scale, self.H * scale), Image.NEAREST).save(path)
