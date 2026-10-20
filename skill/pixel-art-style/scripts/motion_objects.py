"""Objects re-rendered every frame. Cloth is handled the way pixel animators do it:
the drawing is converted to indices of its own material ramp (shadow -> highlight);
each frame the SHAPE is rebuilt from moving edges (whole columns/rows, no per-pixel
resampling noise), and folds travel as +/-1 steps along the ramp. The result stays on
palette and crisp, with no smear."""
import os, sys
import numpy as np
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze_style import kmeans, to_perc, _assign

W8 = np.array([0.30, 0.59, 0.11]) ** 0.5
TAU = 2 * np.pi


def ramp_from(img, mask, n=6, seed=0):
    px = img[mask].reshape(-1, 3)
    c, _ = kmeans(to_perc(px), n, iters=20, seed=seed)
    c = c / W8
    return c[np.argsort((c * W8 ** 2).sum(1))]


def to_index(img, mask, ramp):
    idx = np.full(mask.shape, -1, int)
    idx[mask] = _assign(to_perc(img[mask]), to_perc(ramp))
    return idx


def clean_index(idx, mask, passes=2):
    """Median-filter a ramp-index map inside its mask: high-frequency texture (inherited
    noise) sparkles when cloth moves by a pixel; solid shading clusters move calmly."""
    out = idx.copy()
    for _ in range(passes):
        med = ndimage.median_filter(np.where(mask, out, -1), size=3)
        ok = mask & (med >= 0)
        out[ok] = med[ok]
    return out


def spans(mask):
    top = np.full(mask.shape[1], -1.0); bot = np.full(mask.shape[1], -1.0)
    for x in np.nonzero(mask.any(0))[0]:
        ys = np.nonzero(mask[:, x])[0]
        top[x], bot[x] = ys.min(), ys.max()
    return top, bot


class SheetX:
    """A sheet whose columns move vertically (cape, tail). attach = x where it is held
    (no motion); free end = the other side."""

    def __init__(self, img, mask, n=7, attach='right', seed=0, keep_colors=False):
        self.mask = mask
        self.ramp = ramp_from(img, mask, n, seed)
        self.idx = clean_index(to_index(img, mask, self.ramp), mask)
        self.img = img
        self.keep = keep_colors
        self.top, self.bot = spans(mask)
        cols = np.nonzero(mask.any(0))[0]
        self.cols, self.x0, self.x1 = cols, cols.min(), cols.max()
        self.attach = attach
        self.H, self.W = mask.shape

    def u(self, x):
        L = self.x1 - self.x0
        return np.clip(((self.x1 - x) if self.attach == 'right' else (x - self.x0)) / L, 0, 1)

    def draw(self, out, ph, amp=3.5, k=60.0, cycles=2, flap=1.5, fold=1, reach=1.5, lag=0.0):
        R = self.ramp
        n = len(R)
        sgn = -1 if self.attach == 'right' else 1
        # horizontal reach of each source column, then inverted per destination column so
        # no destination column is ever skipped (skips showed as black slits)
        xs = np.arange(self.x0, self.x1 + 1)
        uu = self.u(xs)
        dir_ = 1 if self.attach == 'right' else -1
        waves = TAU * cycles * ph + TAU * xs / k * dir_ - lag * uu
        dest = xs + sgn * reach * uu ** 1.5 * (0.5 + 0.5 * np.sin(waves - 0.6))
        lo, hi = int(np.floor(dest.min())), int(np.ceil(dest.max()))
        for xd in range(max(lo, 0), min(hi + 1, self.W)):
            j = int(np.argmin(np.abs(dest - xd)))
            if abs(dest[j] - xd) > 1.0:
                continue
            x = xs[j]
            if self.top[x] < 0:
                continue
            u = uu[j]; wave = waves[j]
            d = amp * u ** 1.4 * np.sin(wave)
            thick = flap * u ** 2 * np.sin(wave + 1.1)
            t0, b0 = self.top[x], self.bot[x]
            t, b = t0 + d, b0 + d + thick
            if b <= t:
                continue
            ys = np.arange(max(int(np.floor(t)), 0), min(int(np.ceil(b)) + 1, self.H))
            v = (ys - t) / max(1e-6, b - t)
            sy = np.clip(np.round(t0 + v * (b0 - t0)).astype(int), 0, self.H - 1)
            m = self.mask[sy, x]
            if not m.any():
                continue
            if self.keep:
                out[ys[m], xd] = self.img[sy, x][m]
                continue
            ii = self.idx[sy, x]
            if fold:
                # the part of the wave that turns toward the moon lifts one ramp step,
                # the part turning away drops one; the bright rim along the top edge keeps
                # its colour so the silhouette stays readable
                face = np.cos(wave) * u * (0.6 + 0.4 * np.sin(np.pi * np.clip(v, 0, 1)))
                delta = np.round(0.9 * face).astype(int)
                delta[v < 0.1] = np.maximum(delta[v < 0.1], 0)
                ii = np.clip(ii + np.clip(delta, -fold, fold), 0, n - 1)
            out[ys[m], xd] = R[ii[m]]


class SheetY:
    """A hanging sheet whose rows move horizontally (banner): fixed at the top."""

    def __init__(self, img, mask, emblem=None, n=6, top_fixed=6, seed=0):
        self.mask = mask
        cloth = mask & ~(emblem if emblem is not None else np.zeros_like(mask))
        self.ramp = ramp_from(img, cloth, n, seed)
        self.idx = clean_index(to_index(img, cloth, self.ramp), cloth)
        self.emblem = emblem if emblem is not None else np.zeros_like(mask)
        self.img = img
        ys, xs = np.nonzero(mask)
        self.y0, self.y1, self.x0, self.x1 = ys.min(), ys.max(), xs.min(), xs.max()
        self.top_fixed = top_fixed
        self.H, self.W = mask.shape

    def draw(self, out, ph, amp=3.5, cycles=2, fold=1):
        R = self.ramp; n = len(R)
        span = max(1, self.y1 - self.y0 - self.top_fixed)
        for y in range(self.y0, self.y1 + 1):
            xs = np.nonzero(self.mask[y])[0]
            if not len(xs):
                continue
            v = np.clip((y - self.y0 - self.top_fixed) / span, 0, 1)
            wave = TAU * cycles * ph - TAU * v * 1.1
            dx = int(round(-amp * v ** 1.2 * (0.5 + 0.5 * np.sin(wave))))
            col = np.zeros((len(xs), 3))
            em = self.emblem[y, xs]
            ii = self.idx[y, xs]
            if fold and v > 0:
                # broad fold bands drifting slowly across the cloth (one pass per loop)
                band = np.sin(TAU * (xs - self.x0) / 44.0 + TAU * ph + v * 1.2)
                delta = np.round(0.62 * band * min(1, v * 2.5)).astype(int)
                # the darkest ramp step is reserved for the cloth's own outline/creases:
                # a fold must never push mid-tone cloth into it (reads as a black hole)
                ii = np.where(ii >= 1, np.clip(ii + delta, 1, n - 1), ii)
            col[~em] = R[np.clip(ii[~em], 0, n - 1)]
            col[em] = self.img[y, xs[em]]
            tx = xs + dx
            ok = (tx >= 0) & (tx < self.W)
            out[y, tx[ok]] = col[ok]


class Plant:
    """A leaf rosette rooted at its bottom edge. Wind bends it: each row shifts left by
    an amount growing toward the top (the tips move most, the base stays put). Gusts
    arrive as a wave travelling across the bushes, so neighbours move at different times."""

    def __init__(self, img, mask, rng):
        self.mask = mask; self.img = img
        ys, xs = np.nonzero(mask)
        self.y0, self.y1 = ys.min(), ys.max()
        self.cx = xs.mean()
        self.amp = rng.uniform(1.2, 2.4)
        self.jit = rng.uniform(-0.08, 0.08)

    def draw(self, out, ph, wavelength=220.0, cycles=2):
        H, W = out.shape[:2]
        g = TAU * (cycles * ph + self.cx / wavelength + self.jit)
        gust = 0.5 + 0.5 * np.sin(g)                      # 0..1, wind pushes to the left
        flutter = 0.35 * np.sin(2 * g + 1.0)
        h = max(1, self.y1 - self.y0)
        for y in range(self.y0, self.y1 + 1):
            xs = np.nonzero(self.mask[y])[0]
            if not len(xs):
                continue
            k = (self.y1 - y) / h                          # 0 at the root, 1 at the tips
            dx = int(round(-self.amp * k * (gust + flutter)))
            dy = int(round(0.6 * k * gust))
            tx, ty = xs + dx, y + dy
            ok = (tx >= 0) & (tx < W) & (ty < H)
            out[ty, tx[ok]] = self.img[y, xs[ok]]
