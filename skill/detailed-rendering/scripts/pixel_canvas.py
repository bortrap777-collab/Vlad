"""Small drawing toolkit for pixel art at native resolution.

Import it from a drawing script:

    import sys; sys.path.insert(0, '<skill>/scripts')
    from pixel_canvas import Canvas, load_style

    st = load_style('style.json')            # palette + sizes from analyze_style.py
    cv = Canvas(*st['native_size'], st['hex'])
    cv.vgradient(0, 120, ['#1a1a2e', '#5b557f', '#d06174'])   # dithered sky
    cv.ridge(110, amp=25, color=cv.near('#3b425d'), seed=3)    # mountains
    ...
    cv.save('out', scale=st['scale'])        # out_native.png + out.png (enlarged)

Everything is drawn at the art's native grid with hard edges (no anti-aliasing);
`save` snaps every pixel to the palette, so off-palette colours cannot leak out.
Masks are boolean numpy arrays of shape (h, w); most drawing calls return the mask
they painted so you can reuse it for shading, outlines or rim light.
"""
import json
import numpy as np
from PIL import Image, ImageDraw

BAYER4 = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) + 0.5) / 16


def hex2rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)


def load_style(path):
    with open(path) as f:
        st = json.load(f)
    st['hex'] = [e['hex'] for e in st['palette']]
    st['scale'] = int(round(st['pixel_scale']))
    return st


class Canvas:
    def __init__(self, w, h, palette, bg=None):
        self.w, self.h = int(w), int(h)
        self.pal = np.array([hex2rgb(c) for c in palette])
        self.rgb = np.zeros((self.h, self.w, 3))
        if bg is not None:
            self.rgb[:] = self.c(bg)
        self.yy, self.xx = np.mgrid[0:self.h, 0:self.w]

    # ---------- colours
    def c(self, col):
        return hex2rgb(col) if isinstance(col, str) else np.asarray(col, float)

    def near(self, col):
        """Closest palette colour (as hex) to any colour you have in mind."""
        d = np.abs(self.pal - self.c(col)).sum(1)
        return '#%02x%02x%02x' % tuple(self.pal[np.argmin(d)].astype(int))

    def ramp(self, dark, light, n=4):
        """n palette colours stepping from dark to light, for shading a material."""
        a, b = self.c(dark), self.c(light)
        out = []
        for t in np.linspace(0, 1, n):
            h = self.near(a + (b - a) * t)
            if h not in out:
                out.append(h)
        return out

    # ---------- masks
    def _mask(self, fn):
        im = Image.new('1', (self.w, self.h), 0)
        fn(ImageDraw.Draw(im))
        return np.array(im, dtype=bool)   # writable copy

    def poly_mask(self, pts):
        return self._mask(lambda d: d.polygon([tuple(map(round, p)) for p in pts], fill=1))

    def rect_mask(self, x0, y0, x1, y1):
        return self._mask(lambda d: d.rectangle([round(x0), round(y0), round(x1), round(y1)], fill=1))

    def ellipse_mask(self, cx, cy, rx, ry):
        return self._mask(lambda d: d.ellipse([round(cx - rx), round(cy - ry), round(cx + rx), round(cy + ry)], fill=1))

    def line_mask(self, pts, width=1):
        return self._mask(lambda d: d.line([tuple(map(round, p)) for p in pts], fill=1, width=width))

    # ---------- painting
    def paint(self, mask, col):
        self.rgb[mask] = self.c(col)
        return mask

    def poly(self, pts, col):
        return self.paint(self.poly_mask(pts), col)

    def rect(self, x0, y0, x1, y1, col):
        return self.paint(self.rect_mask(x0, y0, x1, y1), col)

    def ellipse(self, cx, cy, rx, ry, col):
        return self.paint(self.ellipse_mask(cx, cy, rx, ry), col)

    def line(self, pts, col, width=1):
        return self.paint(self.line_mask(pts, width), col)

    def px(self, x, y, col):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.rgb[int(y), int(x)] = self.c(col)

    def dither_between(self, mask, col_a, col_b, t):
        """Fill mask with an ordered-dither mix: t=0 all col_a, t=1 all col_b.
        t may be a scalar or an (h, w) array, giving dithered gradients."""
        t = np.broadcast_to(np.asarray(t, float), (self.h, self.w))
        th = BAYER4[self.yy % 4, self.xx % 4]
        use_b = mask & (t > th)
        self.rgb[mask & ~use_b] = self.c(col_a)
        self.rgb[use_b] = self.c(col_b)

    def vgradient(self, y0, y1, cols, mask=None, x0=0, x1=None, band=0.35):
        """Vertical gradient through palette colours (top→bottom).

        band = fraction of each step that is dithered. Hand-made pixel art keeps flat
        bands of colour and dithers only a short transition between them; band=1
        dithers everything and looks like a mechanical screen. 0.25–0.4 is natural."""
        x1 = self.w if x1 is None else x1
        m = np.zeros((self.h, self.w), bool)
        m[max(0, int(y0)):int(y1), int(x0):int(x1)] = True
        if mask is not None:
            m &= mask
        pos = np.clip((self.yy - y0) / max(1, (y1 - y0)), 0, 1) * (len(cols) - 1)
        seg = np.minimum(pos.astype(int), len(cols) - 2)
        for i in range(len(cols) - 1):
            t = np.clip((pos - i - 0.5) / max(band, 1e-3) + 0.5, 0, 1)
            self.dither_between(m & (seg == i), cols[i], cols[i + 1], t)
        return m

    # ---------- noise (clouds, mist, foliage, rock)
    def noise(self, scale=24, octaves=4, seed=0, stretch=1.0):
        """Fractal value noise in 0..1, shape (h, w). scale = feature size in pixels;
        stretch > 1 elongates features horizontally (cloud banks, mist)."""
        rng = np.random.default_rng(seed)
        out = np.zeros((self.h, self.w))
        amp, tot, s = 1.0, 0.0, float(scale)
        for _ in range(octaves):
            gx, gy = int(self.w / (s * stretch)) + 3, int(self.h / s) + 3
            g = rng.random((gy, gx))
            fx = self.xx / (s * stretch); fy = self.yy / s
            ix, iy = fx.astype(int), fy.astype(int)
            tx, ty = fx - ix, fy - iy
            tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
            v = (g[iy, ix] * (1 - tx) + g[iy, ix + 1] * tx) * (1 - ty) + \
                (g[iy + 1, ix] * (1 - tx) + g[iy + 1, ix + 1] * tx) * ty
            out += v * amp; tot += amp; amp *= 0.5; s /= 2
        return out / tot

    def clouds(self, y0, y1, cols, light=None, coverage=0.5, scale=22, seed=0, stretch=2.5, x0=0, x1=None):
        """Textured cloud banks between y0 and y1.

        cols: palette colours from shadow to lit edge (2–4). light: (x, y) of the moon/
        sun — cloud edges facing it get the lit colours, the rest stay in shadow, which
        is what gives the reference skies their glowing rims. Returns the cloud mask."""
        x1 = self.w if x1 is None else x1
        nz = self.noise(scale, 4, seed, stretch)
        mid = (y0 + y1) / 2
        fall = 1 - np.clip(np.abs(self.yy - mid) / ((y1 - y0) / 2 + 1e-6), 0, 1) ** 2
        field = nz * fall
        th = np.quantile(field[int(max(0, y0)):int(y1), int(x0):int(x1)], 1 - coverage) if y1 > y0 else 1
        m = (field > th) & (self.xx >= x0) & (self.xx < x1)
        self.paint(m, cols[0])
        if light is not None and len(cols) > 1:
            lx, ly = light
            d = np.hypot(self.xx - lx, self.yy - ly)
            dx = np.sign(lx - self.xx).astype(int); dy = np.sign(ly - self.yy).astype(int)
            # how far inside the cloud a pixel is, measured toward the light
            inside = np.zeros(m.shape, int)
            probe = m.copy()
            for k in range(1, len(cols)):
                shifted = probe[np.clip(self.yy + dy * k, 0, self.h - 1), np.clip(self.xx + dx * k, 0, self.w - 1)]
                inside += shifted
            near = np.clip(1 - d / (self.w * 0.6), 0, 1)
            lvl = np.where(m, (len(cols) - 1 - inside) * (near > 0.15), 0)
            lvl = np.where(near < 0.45, np.minimum(lvl, 1), lvl)
            for k in range(1, len(cols)):
                self.paint(m & (lvl >= k), cols[k])
        return m

    def glow(self, cx, cy, r, col, strength=0.6, mask=None, dither=0.12, squash=1.0):
        """Radial light that tints existing pixels toward col (smooth falloff).

        The palette snap at save time turns the smooth tint into clean steps, so the
        palette must contain in-between colours (see `lit_colors`). A little ordered
        dither (dither=0.1..0.2) softens step edges; large values give an ugly
        screen-door pattern, so keep it small. squash<1 flattens the glow vertically
        (light pools on the ground)."""
        d = np.hypot(self.xx - cx, (self.yy - cy) / squash) / r
        t = np.clip(1 - d, 0, 1) ** 2 * strength
        if dither:
            t = t + (BAYER4[self.yy % 4, self.xx % 4] - 0.5) * dither * (t > 0.02)
        t = np.clip(t, 0, 1)
        if mask is not None:
            t = t * mask
        self.rgb += (self.c(col) - self.rgb) * t[..., None]
        return t > 0.05

    def lit_colors(self, light, steps=(0.25, 0.5), darks_only=True):
        """Add palette colours = each palette colour mixed toward `light`.
        Call before glow() so warm light pools have colours to snap to."""
        L = self.pal.mean(1)
        base = self.pal[L < np.quantile(L, 0.7)] if darks_only else self.pal
        new = [b + (self.c(light) - b) * t for b in base for t in steps]
        self.extend_palette(new)

    def extend_palette(self, cols):
        cols = np.array([self.c(c) for c in cols])
        self.pal = np.unique(np.round(np.vstack([self.pal, cols])), axis=0)

    def texture(self, mask, cols, density=0.15, seed=0, cluster=1):
        """Sprinkle palette colours over a mask (stone, foliage, grass speckle).
        cluster>1 makes 'chunky' speckles that read better at large sizes."""
        rng = np.random.default_rng(seed)
        hh, ww = -(-self.h // cluster), -(-self.w // cluster)
        r = rng.random((hh, ww)).repeat(cluster, 0).repeat(cluster, 1)[:self.h, :self.w]
        k = rng.integers(0, len(cols), (hh, ww)).repeat(cluster, 0).repeat(cluster, 1)[:self.h, :self.w]
        for i, col in enumerate(cols):
            self.rgb[mask & (r < density) & (k == i)] = self.c(col)

    def outline(self, mask, col, outside=True):
        """1-px outline of a mask (outside by default)."""
        m = mask
        nb = np.zeros_like(m)
        nb[1:] |= m[:-1]; nb[:-1] |= m[1:]; nb[:, 1:] |= m[:, :-1]; nb[:, :-1] |= m[:, 1:]
        edge = (nb & ~m) if outside else (m & ~self._erode(m))
        self.rgb[edge] = self.c(col)
        return edge

    def rim(self, mask, col, dx=1, dy=0, width=1):
        """Light the edge of a mask that faces the light (dx, dy point toward it)."""
        edge = np.zeros_like(mask)
        for k in range(1, width + 1):
            edge |= mask & ~np.roll(np.roll(mask, -dy * k, 0), -dx * k, 1)
        self.rgb[edge] = self.c(col)
        return edge

    def shade_side(self, mask, col, dx=-1, dy=0, width=2):
        """Darken the side of a mask facing away from the light."""
        return self.rim(mask, col, -dx, -dy, width)

    @staticmethod
    def _erode(m):
        e = m.copy()
        e[1:] &= m[:-1]; e[:-1] &= m[1:]; e[:, 1:] &= m[:, :-1]; e[:, :-1] &= m[:, 1:]
        return e

    # ---------- scene helpers
    def ridge(self, y_base, amp, color, seed=0, rough=0.55, x0=0, x1=None, peaks=None):
        """Mountain / hill silhouette filled downward from a jagged top line."""
        x1 = self.w if x1 is None else x1
        rng = np.random.default_rng(seed)
        n = 1
        while n < (x1 - x0):
            n *= 2
        pts = np.zeros(n + 1)
        step, a = n, amp
        while step > 1:
            half = step // 2
            for i in range(half, n, step):
                pts[i] = (pts[i - half] + pts[i + half]) / 2 + rng.uniform(-a, a)
            step, a = half, a * rough
        if peaks:
            for px_, ph in peaks:
                i = int((px_ - x0) / (x1 - x0) * n)
                pts += ph * np.exp(-((np.arange(n + 1) - i) / (n * 0.12)) ** 2)
        top = y_base - (pts - pts.min())[: int(x1 - x0)]
        m = np.zeros((self.h, self.w), bool)
        cols = np.arange(int(x0), int(x1))
        for i, x in enumerate(cols):
            if 0 <= x < self.w:
                m[max(0, int(top[i])):, x] = True
        self.paint(m, color)
        return m

    def pine(self, x, y_base, h, color, w=None):
        """Single conifer silhouette; returns mask."""
        w = w or max(3, h * 0.45)
        m = np.zeros((self.h, self.w), bool)
        tiers = max(2, int(h / 6))
        for t in range(tiers):
            ty = y_base - h + t * h / tiers
            tw = w * (0.35 + 0.65 * (t + 1) / tiers) / 2
            m |= self.poly_mask([(x, ty), (x - tw, ty + h / tiers * 1.6), (x + tw, ty + h / tiers * 1.6)])
        m |= self.rect_mask(x - max(0.5, w / 12), y_base - h * 0.15, x + max(0.5, w / 12), y_base)
        self.paint(m, color)
        return m

    def forest(self, x0, x1, y_base, hmin, hmax, color, seed=0, density=0.6):
        rng = np.random.default_rng(seed)
        m = np.zeros((self.h, self.w), bool)
        x = x0
        while x < x1:
            m |= self.pine(x, y_base + rng.integers(0, 3), rng.uniform(hmin, hmax), color)
            x += max(2, hmax * 0.45 * (1.2 - density) + rng.uniform(0, 3))
        return m

    def tower(self, x, y_base, w, h, color, spire=1.6, windows=None, win_col=None, seed=0):
        """Gothic tower with a pointed spire. windows: number of lit windows."""
        m = self.rect_mask(x - w / 2, y_base - h, x + w / 2, y_base)
        m |= self.poly_mask([(x - w / 2 - 1, y_base - h), (x + w / 2 + 1, y_base - h), (x, y_base - h - w * spire)])
        self.paint(m, color)
        if windows and win_col:
            rng = np.random.default_rng(seed)
            for _ in range(windows):
                wy = rng.uniform(y_base - h + 2, y_base - 3)
                self.rect(x - 0.5, wy, x, wy + 1, win_col)
        return m

    def arch_bridge(self, x0, x1, y_top, thick, arch_h, n_arches, color, pier=3):
        """Bridge / aqueduct: deck plus arched openings cut below it."""
        m = self.rect_mask(x0, y_top, x1, y_top + thick + arch_h)
        span = (x1 - x0) / n_arches
        for i in range(n_arches):
            cx = x0 + span * (i + 0.5)
            hole = self.ellipse_mask(cx, y_top + thick + arch_h, span / 2 - pier / 2, arch_h)
            m &= ~hole
        self.paint(m, color)
        return m

    def stars(self, mask, cols, n=60, seed=0):
        rng = np.random.default_rng(seed)
        ys, xs = np.nonzero(mask)
        if len(xs):
            for i in rng.choice(len(xs), min(n, len(xs)), replace=False):
                self.rgb[ys[i], xs[i]] = self.c(cols[rng.integers(len(cols))])

    # ---------- output
    def snap(self):
        """Nearest palette colour per pixel, in chunks so large grids (640×426+) and
        dense palettes (200+) stay within memory."""
        flat = self.rgb.reshape(-1, 3)
        pal = self.pal.astype(np.float32)
        idx = np.empty(len(flat), np.int32)
        for i in range(0, len(flat), 16384):
            c = flat[i:i + 16384].astype(np.float32)
            d = (c * c).sum(1)[:, None] - 2 * c @ pal.T + (pal * pal).sum(1)[None]
            idx[i:i + 16384] = np.argmin(d, 1)
        return self.pal[idx].reshape(self.h, self.w, 3).astype(np.uint8)

    def image(self):
        return Image.fromarray(self.snap())

    def save(self, stem, scale=4):
        """Writes <stem>_native.png (art grid), <stem>.png (enlarged, crisp) and
        <stem>_palette.json (the final palette, for check_art.py --palette)."""
        im = self.image()
        im.save(f'{stem}_native.png')
        with open(f'{stem}_palette.json', 'w') as f:
            json.dump(['#%02x%02x%02x' % tuple(c) for c in self.pal.astype(int)], f)
        im.resize((self.w * scale, self.h * scale), Image.NEAREST).save(f'{stem}.png')
        return f'{stem}.png'

    def copy(self):
        c = Canvas.__new__(Canvas)
        c.__dict__ = {k: (v.copy() if isinstance(v, np.ndarray) else v) for k, v in self.__dict__.items()}
        return c
