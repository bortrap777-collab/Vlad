"""Living-location effects: things that are REDRAWN every frame on top of a static
scene (approach E in SKILL.md). Each effect is an object with

    plate      boolean mask of reference pixels it replaces (painted out of the
               background plate before the repaint; None = overlay only)
    colors()   extra palette colours it needs (ramps, glow tints)
    draw(img, f, n)   paint frame f of n into img (float RGB, H x W x 3)
    layer      draw order (low first): 0 sky/far, 10 liquids, 20 lights,
               30 objects/plants/cloth, 40 particles, 50 foreground

Every motion is driven by phase = f / n with whole cycles per loop, so frame n
equals frame 0 and the GIF loops without a seam.

Rules these encode (each one came from a visible defect):
- Liquids and falls are re-generated from their OWN ramp (k-means of the region,
  sorted dark→light) with the reference's share of each ramp step, so the colours
  match; the texture is smooth noise mapped to ramp steps, then cluster-cleaned, so
  it moves as solid shapes instead of salt-and-pepper shimmer.
- Lava churns (noise sampled on a circle in noise space) rather than scrolling: a
  lake has no single flow direction and the loop closes by construction.
- Falls scroll a vertically stretched noise that tiles with the scroll period.
- Flames are drawn as sprites (teardrop, 4-5 step ramp, swaying tip, rare detached
  tongue); the painted flame is removed from the plate first. Never brighten the
  old flame pixels: that reads as a blinking sticker.
- Glow pools breathe 10-20%, the light core does most of the flicker.
- Particles (embers, fireflies, dust, drips, leaves) live on a loop: each has its
  own phase offset, fades in and out, never pops on screen edges.
"""
import numpy as np
from scipy import ndimage

TAU = 2 * np.pi
BAYER = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) + 0.5) / 16
W8 = np.array([0.30, 0.59, 0.11]) ** 0.5
LUM = np.array([0.30, 0.59, 0.11])


# ------------------------------------------------------------------ helpers
def flick(ph, p1, p2=None, fast=3):
    """0..1 flicker: two sines with whole cycles per loop (seamless, irregular)."""
    p2 = p1 * 1.7 if p2 is None else p2
    return 0.5 + 0.3 * np.sin(TAU * (ph + p1)) + 0.2 * np.sin(TAU * (fast * ph + p2))


def tile_noise(h, w, scale=16, seed=0, octaves=3, stretch=(1.0, 1.0)):
    """Smooth value noise in 0..1 that tiles over (h, w) in both axes.
    stretch=(sx, sy): >1 elongates features along that axis."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    out = np.zeros((h, w)); tot = 0.0; amp = 1.0; s = float(scale)
    for _ in range(octaves):
        gx = max(1, int(round(w / (s * stretch[0])))); gy = max(1, int(round(h / (s * stretch[1]))))
        g = rng.random((gy, gx))
        fx = xx / w * gx; fy = yy / h * gy
        ix, iy = fx.astype(int), fy.astype(int)
        tx, ty = fx - ix, fy - iy
        tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        x0, x1, y0, y1 = ix % gx, (ix + 1) % gx, iy % gy, (iy + 1) % gy
        v = (g[y0, x0] * (1 - tx) + g[y0, x1] * tx) * (1 - ty) + (g[y1, x0] * (1 - tx) + g[y1, x1] * tx) * ty
        out += v * amp; tot += amp; amp *= 0.5; s /= 2
    return out / tot


def sample(field, ys, xs):
    """Bilinear sample of a tiling field at float coordinates (wraps)."""
    h, w = field.shape
    x0 = np.floor(xs).astype(int); y0 = np.floor(ys).astype(int)
    tx, ty = xs - x0, ys - y0
    a = field[y0 % h, x0 % w]; b = field[y0 % h, (x0 + 1) % w]
    c = field[(y0 + 1) % h, x0 % w]; d = field[(y0 + 1) % h, (x0 + 1) % w]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def kmeans_ramp(px, n, seed=0, iters=15):
    """n representative colours of px, sorted dark → light."""
    px = np.asarray(px, float).reshape(-1, 3)
    rng = np.random.default_rng(seed)
    if len(px) > 20000:
        px = px[rng.choice(len(px), 20000, replace=False)]
    x = px * W8
    lum = px @ LUM
    c = x[np.argsort(lum)[np.linspace(0, len(px) - 1, n).astype(int)]].copy()
    for _ in range(iters):
        lab = np.argmin(((x[:, None] - c[None]) ** 2).sum(-1), 1)
        for k in range(n):
            if (lab == k).any():
                c[k] = x[lab == k].mean(0)
    c = c / W8
    c = c[np.argsort(c @ LUM)]
    # k-means averages the rare brightest pixels (white foam, a flame's core) into a
    # duller cluster: put the true top colour back as the last ramp step
    top = np.median(px[lum >= np.quantile(lum, 0.985)], 0)
    if (top @ LUM) - (c[-1] @ LUM) > 12:
        c = np.vstack([c, top])
    return c


def to_ramp_index(px, ramp):
    return np.argmin((((px[:, None] - ramp[None]) * W8) ** 2).sum(-1), 1)


def quantile_cuts(fields, mask, shares):
    """Thresholds that give each ramp index its share of pixels, measured over several
    frames at once. Fixed cuts keep a pixel's colour tied to its field value; per-frame
    quantiles shift every threshold a little each frame."""
    vals = np.concatenate([f[mask] for f in fields])
    return np.quantile(vals, np.clip(np.cumsum(shares)[:-1], 0, 1))


def quantile_map(t, mask, shares, cuts=None):
    """Map a continuous field t (inside mask) to ramp indices so each index gets the
    given share of the pixels — keeps the reference's balance of dark and bright."""
    idx = np.zeros(t.shape, int)
    vals = t[mask]
    if not len(vals):
        return idx
    if cuts is None:
        cuts = np.quantile(vals, np.clip(np.cumsum(shares)[:-1], 0, 1))
    idx[mask] = np.searchsorted(cuts, vals)
    return idx


def majority(idx, mask, passes=1, size=3):
    """Cluster cleanup of an index map: lone pixels take their neighbours' value.
    size=(1, 3) cleans along rows only and keeps 1-px-tall streaks (lake surfaces)."""
    out = idx.copy()
    for _ in range(passes):
        med = ndimage.median_filter(np.where(mask, out, -1), size=size)
        ok = mask & (med >= 0)
        out[ok] = med[ok]
    return out


def glow(img, cx, cy, r, col, strength, squash=1.0, mask=None, add=False):
    """Soft light pool. add=False tints toward col (lamps on walls); add=True adds
    light (fire on dark rock: keeps texture, brightens)."""
    H, W = img.shape[:2]
    y0, y1 = max(0, int(cy - r * squash) - 1), min(H, int(cy + r * squash) + 2)
    x0, x1 = max(0, int(cx - r) - 1), min(W, int(cx + r) + 2)
    if y0 >= y1 or x0 >= x1:
        return
    yy, xx = np.mgrid[y0:y1, x0:x1]
    d = np.hypot(xx - cx, (yy - cy) / squash) / r
    t = np.clip(1 - d, 0, 1) ** 2 * strength
    if mask is not None:
        t = t * mask[y0:y1, x0:x1]
    sub = img[y0:y1, x0:x1]
    col = np.asarray(col, float)
    if add:
        sub += col[None, None] * t[..., None]
    else:
        sub += (col - sub) * t[..., None]
    np.clip(sub, 0, 255, out=sub)


def lit_tints(pal, light, steps=(0.15, 0.3, 0.5), top=0.7, every=2):
    """Palette colours mixed toward a light colour, so glow pools snap to in-between
    tones instead of jumping straight to the light colour."""
    pal = np.asarray(pal, float)
    lum = pal @ LUM
    base = pal[lum < np.quantile(lum, top)][::every]
    light = np.asarray(light, float)
    return [b + (light - b) * t for b in base for t in steps]


class Effect:
    """Positions and sizes passed to effects are in ART PIXELS, except Particles
    (design units, see there). self.u = art px per design unit (set by Location)."""
    layer = 20
    plate = None
    u = 1

    def bind(self, loc):
        self.loc = loc

    def colors(self):
        return []

    def draw(self, img, f, n):
        pass


# ------------------------------------------------------------------ liquids
class Liquid(Effect):
    """Lava lake / pond surface re-generated each frame from its own ramp.

    keep:   0..1 weight of the reference's own light layout (its smoothed ramp
            position): bright where the painter made it bright (under falls, near
            light), dark crust where it was dark. 0.4-0.6 keeps the painting.
    flow:   (dy, dx) px of one-way drift per loop (flow-map cross-fade, seamless);
            lava 8-16 px per 2-s loop reads as slow and heavy. Prefer it to churn:
            a monotonic drift never flips pixels back and forth (A-B-A shimmer).
    churn:  radius in px of a circular wander in noise space (0 with flow).
    veins:  >0 adds ridged bright lines (lava crust cracks, light on ripples).
    stretch: (sx, sy) feature elongation; a lake seen at a low angle is strongly
            horizontal (4-6, 1).
    persp:  (y_far, y_near, k_far): features shrink toward the far shore (k_far ~0.4)."""
    layer = 10

    def __init__(self, mask, n=6, scale=14, churn=5.0, veins=0.6, stretch=(1.8, 1.0), seed=0,
                 ramp=None, shares=None, keep=0.5, persp=None, octaves=3, clean=3, flow=None):
        self.clean = clean; self.flow = flow
        self.mask = mask; self.n = n; self.scale = scale; self.churn = churn
        self.veins = veins; self.stretch = stretch; self.seed = seed
        self._ramp = ramp; self._shares = shares; self.keep = keep; self.persp = persp
        self.octaves = octaves

    def bind(self, loc):
        self.loc = loc
        H, W = self.mask.shape
        px = loc.src[self.mask]
        self.ramp = np.asarray(self._ramp, float) if self._ramp is not None else kmeans_ramp(px, self.n, self.seed)
        ii = to_ramp_index(px, self.ramp)
        if self._shares is None:
            self.shares = np.bincount(ii, minlength=len(self.ramp)) / len(ii)
        else:
            self.shares = np.asarray(self._shares, float)
        refpos = np.zeros((H, W)); refpos[self.mask] = ii / max(1, len(self.ramp) - 1)
        wsum = ndimage.gaussian_filter(self.mask.astype(float), 2.0)
        self.ref_t = ndimage.gaussian_filter(refpos, 2.0) / np.maximum(wsum, 1e-3)
        self.f1 = tile_noise(H, W, self.scale, self.seed + 1, self.octaves, self.stretch)
        self.f2 = tile_noise(H, W, self.scale * 0.6, self.seed + 2, 2, self.stretch)
        yy, xx = np.mgrid[0:H, 0:W].astype(float)
        if self.persp:
            yf, yn, kf = self.persp
            k = kf + (1 - kf) * np.clip((np.arange(H) - yf) / max(1, yn - yf), 0, 1)
            Y = np.cumsum(1 / k)
            cx = W / 2
            xx = cx + (xx - cx) / k[:, None]
            yy = np.repeat(Y[:, None], W, 1)
        self.yy, self.xx = yy, xx

    def colors(self):
        return list(self.ramp)

    def _noise(self, oy, ox, a):
        r = self.churn
        n1 = sample(self.f1, self.yy + oy + r * np.sin(a), self.xx + ox + r * np.cos(a))
        n2 = sample(self.f2, self.yy + oy * 1.3 - 0.7 * r * np.cos(a + 1.3), self.xx + ox * 1.3 + 0.7 * r * np.sin(a + 1.3))
        return 0.65 * n1 + 0.35 * n2

    def field(self, ph):
        a = TAU * ph
        if self.flow is None:
            t = self._noise(0, 0, a)
        else:
            # flow-map trick: two copies drift along `flow`, each restarting while its
            # weight is zero, so a slow one-way drift still loops seamlessly
            fy, fx_ = self.flow
            pa, pb = ph, (ph + 0.5) % 1.0
            wa = 1 - abs(2 * pa - 1)
            ta = self._noise(-fy * pa, -fx_ * pa, a)
            tb = self._noise(-fy * pb + 37, -fx_ * pb + 53, a)
            t = wa * ta + (1 - wa) * tb
            t = 0.5 + (t - 0.5) / np.sqrt(wa ** 2 + (1 - wa) ** 2)   # keep contrast through the blend
        if self.veins:
            ridge = 1 - np.abs(2 * t - 1)                  # bright where t crosses 0.5
            t = (1 - self.veins) * t + self.veins * ridge ** 3
        return (1 - self.keep) * t + self.keep * self.ref_t

    def draw(self, img, f, n):
        if getattr(self, 'cuts', None) is None:
            self.cuts = quantile_cuts([self.field(k / 6) for k in range(6)], self.mask, self.shares)
        t = self.field(f / n)
        idx = quantile_map(t, self.mask, self.shares, self.cuts)
        idx = majority(idx, self.mask, size=self.clean)
        img[self.mask] = self.ramp[idx[self.mask]]


class Fall(Effect):
    """Waterfall / lavafall: vertical streaks of its own ramp sliding down.
    speed px/frame (water 2-3, lava 1); the texture tiles every speed*N px so the
    loop is seamless. Streaks must be several times longer than `speed`, or a streak
    passes a pixel in 1-2 frames and reads as flicker: keep octaves=1.
    foam: the last foam_rows get brighter (splash band)."""
    layer = 12

    def __init__(self, mask, n=5, speed=2, scale=5, foam=True, seed=0, ramp=None, foam_col=None, foam_rows=3,
                 octaves=1, streak=(0.35, 3.2), keep=0.45, clean=(3, 1)):
        self.octaves = octaves; self.streak = streak; self.keep = keep; self.clean = clean
        self.mask = mask; self.n = n; self.speed = speed; self.scale = scale
        self.foam = foam; self.seed = seed; self._ramp = ramp; self.foam_col = foam_col
        self.foam_rows = foam_rows

    def bind(self, loc):
        self.loc = loc
        H, W = self.mask.shape
        px = loc.src[self.mask]
        self.ramp = np.asarray(self._ramp, float) if self._ramp is not None else kmeans_ramp(px, self.n, self.seed)
        ii = to_ramp_index(px, self.ramp)
        self.shares = np.bincount(ii, minlength=len(self.ramp)) / max(1, len(ii))
        # the painter's light layout (dark edges, bright centre) is kept; only the
        # streak texture moves — otherwise dark edge tones land inside as black slits
        refpos = np.zeros((H, W)); refpos[self.mask] = ii / max(1, len(self.ramp) - 1)
        wsum = ndimage.gaussian_filter(self.mask.astype(float), 0.6)
        self.ref_t = ndimage.gaussian_filter(refpos, 0.6) / np.maximum(wsum, 1e-3)   # thin streaks survive
        self.period = self.speed * loc.N                    # one texture tile per loop
        self.tex = tile_noise(self.period, W, self.scale, self.seed + 5, self.octaves, self.streak)
        ys, xs = np.nonzero(self.mask)
        self.bottom = np.full(W, -1)
        for x in np.unique(xs):
            self.bottom[x] = ys[xs == x].max()
        # ref brightness of each column, so the fall keeps its painted light/shade
        colL = np.zeros(W)
        for x in np.unique(xs):
            colL[x] = (loc.src[ys[xs == x], x] @ LUM).mean()
        self.col_bias = np.where(self.bottom >= 0, (colL - colL[colL > 0].mean()) / 255.0 if (colL > 0).any() else 0, 0)
        self.yy, self.xx = np.mgrid[0:H, 0:W]
        self.fcol = np.asarray(self.foam_col, float) if self.foam_col is not None else self.ramp[-1]

    def colors(self):
        return list(self.ramp) + [self.fcol]

    def _t(self, f):
        t = self.tex[(self.yy - self.speed * f) % self.period, self.xx] + self.col_bias[None, :] * 0.6
        t = (1 - self.keep) * t + self.keep * self.ref_t
        if self.foam:
            # splash: the last rows get brighter (a churning band, not a dotted hem)
            b = self.bottom[None, :]
            d = (b - self.yy) / max(1, self.foam_rows)
            t = t + 0.45 * np.clip(1 - d, 0, 1) * (b >= 0)
        return t

    def draw(self, img, f, n):
        t = self._t(f)
        if getattr(self, 'cuts', None) is None:
            self.cuts = quantile_cuts([self._t(k * self.loc.N // 4) for k in range(4)], self.mask, self.shares)
        idx = quantile_map(t, self.mask, self.shares, self.cuts)
        # clean along the fall only: a 3x3 median erases the 1-2 px white streaks
        idx = majority(idx, self.mask, size=self.clean)
        img[self.mask] = self.ramp[idx[self.mask]]


class Ripple(Effect):
    """Water rows sliding sideways (reflections wobble) + sparkles on the bright parts.
    Moves existing pixels by whole pixels along rows only, which reads as water."""
    layer = 11

    def __init__(self, mask, amp=1.4, freq=0.45, cycles=2, sparkle=None, sparkle_rate=0.9):
        self.mask = mask; self.amp = amp; self.freq = freq; self.cycles = cycles
        self.sparkle = sparkle; self.rate = sparkle_rate

    def bind(self, loc):
        self.loc = loc
        H, W = self.mask.shape
        self.yy, self.xx = np.mgrid[0:H, 0:W]

    def draw(self, img, f, n):
        ph = f / n
        yy, xx = self.yy, self.xx
        shift = np.round(self.amp * np.sin(TAU * self.cycles * ph + yy * self.freq)).astype(int)
        sx = np.clip(xx - shift, 0, xx.shape[1] - 1)
        ok = self.mask & self.mask[yy, sx]
        src = img.copy()
        img[ok] = src[yy, sx][ok]
        if self.sparkle is not None:
            sp = self.sparkle & (np.sin(TAU * self.cycles * ph + (xx * 0.9 + yy * 1.3) / self.u) > self.rate)
            img[sp] = np.minimum(img[sp] * 1.25 + 20, 255)


# ------------------------------------------------------------------ lights
FIRE = np.array([[110, 28, 22], [190, 60, 26], [238, 118, 38], [255, 182, 70], [255, 232, 160], [255, 252, 228]], float)


class Lights(Effect):
    """Lit windows / lantern glass / glowing gems: the painted core stays, its
    brightness flickers and a glow pool breathes around it. One object per component."""
    layer = 20

    def __init__(self, mask, color=(255, 170, 90), radius=1.0, strength=0.14, core_amp=0.25,
                 big_amp=0.3, big=40, pool_mask=None, seed=1, max_r=24, squash=0.9, add=False):
        self.mask = mask; self.color = np.asarray(color, float); self.radius = radius
        self.strength = strength; self.core_amp = core_amp; self.big_amp = big_amp
        self.big = big; self.pool_mask = pool_mask; self.seed = seed; self.max_r = max_r
        self.squash = squash; self.add = add

    def bind(self, loc):
        self.loc = loc
        rng = np.random.default_rng(self.seed)
        lab, n = ndimage.label(ndimage.binary_dilation(self.mask))
        self.items = []
        for i in range(1, n + 1):
            comp = (lab == i) & self.mask
            sz = int(comp.sum())
            if not sz:
                continue
            cy, cx = ndimage.center_of_mass(comp)
            amp = self.big_amp if sz > self.big else 1.0
            self.items.append(dict(m=comp, cx=cx, cy=cy, sz=sz, amp=amp, p1=rng.random(), p2=rng.random(),
                                   r=min(self.max_r, (3 + sz ** 0.5 * 2.2) * self.radius)))

    def colors(self):
        c = self.color
        return [c, np.minimum(c * 1.15 + 30, 255)] + lit_tints(self.loc.pal, c, (0.12, 0.25, 0.4))

    def draw(self, img, f, n):
        ph = f / n
        base = self.loc.base
        for it in self.items:
            k = flick(ph, it['p1'], it['p2'])
            k = 1 - it['amp'] * (1 - k)
            glow(img, it['cx'], it['cy'], it['r'], self.color, self.strength * (0.55 + 0.45 * k),
                 self.squash, self.pool_mask, self.add)
            m = it['m']
            img[m] = np.minimum(base[m] * (1 - self.core_amp + self.core_amp * 2 * k), 255)


class Flame(Effect):
    """A candle / torch / brazier flame redrawn as a sprite each frame.

    (x, y) = centre of the flame's base (where it sits on the wick / bowl), h = height,
    w = width at the widest point, in native px. The painted flame (mask or the hot
    pixels found in `box`) is removed from the plate."""
    layer = 25

    def __init__(self, x, y, h, w, mask=None, ramp=FIRE, glow_r=None, glow_col=(255, 150, 60),
                 glow_k=0.22, seed=0, lean=0.0, tongue=True, pool_mask=None, add_glow=True, tongues=3):
        self.tongues = tongues
        self.x, self.y, self.h, self.w = x, y, h, w
        self.fmask = mask; self.ramp = np.asarray(ramp, float)
        self.glow_r = glow_r if glow_r is not None else max(6, h * 3.2)
        self.glow_col = np.asarray(glow_col, float); self.glow_k = glow_k
        rng = np.random.default_rng(seed)
        self.p1, self.p2, self.p3 = rng.random(3)
        self.lean = lean; self.tongue = tongue; self.pool_mask = pool_mask; self.add_glow = add_glow

    def bind(self, loc):
        self.loc = loc
        if self.fmask is not None:
            self.plate = ndimage.binary_dilation(self.fmask)

    def colors(self):
        return list(self.ramp) + lit_tints(self.loc.pal, self.glow_col, (0.1, 0.22, 0.38))

    def _tongue(self, img, x, y, hh, w, sway, cool, ph=0.0):
        H, W = img.shape[:2]
        nr = len(self.ramp)
        top = int(np.floor(y - hh))
        for yy in range(top, int(y) + 1):
            if not 0 <= yy < H:
                continue
            v = min(1.0, max(0.0, (y - yy) / max(hh, 1)))       # 0 base .. 1 tip
            hw = w / 2 * (1 - v) ** 0.7 * min(1.0, (v + 0.5) / 0.6)
            # ragged edge: a ripple travelling up the flame, so it is never a clean cone
            hw *= 1 + 0.22 * np.sin(TAU * (3 * ph + self.p1) + (y - yy) * 1.3 / self.u)
            cx = x + sway * v ** 1.6 + 0.35 * self.u * np.sin(TAU * (4 * ph + self.p3) + (y - yy) * 0.9 / self.u) * v
            x0, x1 = int(np.floor(cx - hw + 0.5)), int(np.floor(cx + hw - 0.5))
            if x1 < x0:
                x0 = x1 = int(round(cx))
            for xx in range(x0, x1 + 1):
                if not 0 <= xx < W:
                    continue
                e = abs(xx + 0.5 - cx) / max(hw, 0.5)              # 0 centre .. 1 edge
                heat = (1 - e) * 0.65 + (1 - v) * 0.55 + 0.05 - cool
                ci = int(np.clip(round(heat * (nr - 1)), 1, nr - 1))
                if v > 0.7:
                    ci = min(ci, nr - 3)
                img[yy, xx] = self.ramp[ci]

    def draw(self, img, f, n):
        ph = f / n
        H, W = img.shape[:2]
        k = flick(ph, self.p1, self.p2, fast=4)
        if self.glow_k:
            # the pool breathes slowly (fast flicker on a wide pool = the whole wall blinking)
            kg = flick(ph, self.p1, self.p2, fast=2)
            glow(img, self.x, self.y - self.h * 0.45, self.glow_r, self.glow_col,
                 self.glow_k * (0.8 + 0.25 * kg), 0.95, self.pool_mask, add=self.add_glow)
        hh = self.h * (0.82 + 0.3 * k)
        sway = (0.55 * np.sin(TAU * (2 * ph + self.p3)) + 0.45 * np.sin(TAU * (5 * ph + self.p1))) * self.w * 0.3 + self.lean
        nr = len(self.ramp)
        # side tongues first (cooler, shorter, own rhythm), the main tongue on top
        if self.tongues > 1 and self.w >= 4:
            for side, p in ((-1, self.p2), (1, self.p3)):
                ks = flick(ph, p, p * 2.3, fast=5)
                self._tongue(img, self.x + side * self.w * 0.28, self.y, hh * (0.45 + 0.3 * ks), self.w * 0.55,
                             sway * 0.6 + side * 0.4, 0.25, ph + 0.3 * side)
        self._tongue(img, self.x, self.y, hh, self.w, sway, 0.0, ph)
        if self.tongue:                                           # a detached lick of fire now and then
            s = (3 * ph + self.p2) % 1.0
            if s < 0.22:
                ty = int(round(self.y - hh - 1 - s * 4 * self.u)); tx = int(round(self.x + sway * 1.2))
                if 0 <= ty < H and 0 <= tx < W:
                    img[ty, tx] = self.ramp[min(nr - 2, 3)] if s < 0.12 else self.ramp[2]


# ------------------------------------------------------------------ particles
class Particles(Effect):
    """Small living particles on a loop. kind:
      'ember'   rise from a band, wobble, cool from yellow to dark red, fade
      'firefly' wander slowly, pulse bright/dim with a tiny halo
      'dust'    float in a light beam, faint
      'drip'    fall straight from a ceiling line, splash at the bottom
      'leaf'    drift down/sideways with tumbling (2-3 px)
      'snow'    fall slowly with sway
      'bird'    glide on a wide figure-eight, wings up/down every 2 frames (3-px V)
      'butterfly' flutter over flowers, 2-px wings opening and closing
    region = (x0, y0, x1, y1) where they live, rise = travel, both in DESIGN units
    (Location.box units); shapes are drawn at art-pixel size, so a finer grid gives
    finer sparks. cols = ramp from bright to dim."""
    layer = 40

    def __init__(self, kind, region, count=20, cols=None, seed=0, rise=40, mask=None, cycles=1, size=1):
        self.kind = kind; self.region = region; self.count = count; self.seed = seed
        self.rise = rise; self.allowed = mask; self.cycles = cycles; self.size = size
        default = {
            'ember': [[255, 236, 160], [255, 190, 80], [240, 120, 40], [190, 60, 30], [120, 34, 26]],
            'firefly': [[250, 255, 190], [214, 236, 120], [150, 190, 80]],
            'dust': [[255, 236, 200], [230, 200, 160]],
            'drip': [[170, 210, 230], [110, 150, 180]],
            'leaf': [[214, 170, 70], [170, 120, 50], [120, 140, 50]],
            'snow': [[240, 244, 255], [200, 210, 235]],
            'bird': [[40, 36, 52], [70, 64, 84]],
            'butterfly': [[255, 236, 120], [255, 255, 255], [250, 160, 200]],
        }[kind]
        self.cols = np.asarray(cols if cols is not None else default, float)
        rng = np.random.default_rng(seed)
        x0, y0, x1, y1 = region
        self.p = [dict(x=rng.uniform(x0, x1), y=rng.uniform(y0, y1), o=rng.random(), sp=rng.uniform(0.7, 1.3),
                       wob=rng.uniform(0.6, 2.2), wp=rng.random(), c=rng.integers(0, len(self.cols)),
                       dx=rng.uniform(-1, 1), dy=rng.uniform(-1, 1))
                  for _ in range(count)]

    def colors(self):
        return list(self.cols) + lit_tints(self.loc.pal, self.cols[0], (0.2, 0.4), every=3)

    def _put(self, img, x, y, col, a=1.0):
        H, W = img.shape[:2]
        ix, iy = int(round(x)), int(round(y))
        if 0 <= ix < W and 0 <= iy < H and (self.allowed is None or self.allowed[iy, ix]):
            img[iy, ix] = img[iy, ix] * (1 - a) + np.asarray(col) * a

    def draw(self, img, f, n):
        # region, rise and every path below are in design units; q converts to art px
        q = self.u
        ph = f / n
        C = self.cols; nc = len(C)
        x0, y0, x1, y1 = self.region
        put = self._put
        for p in self.p:
            s = (self.cycles * ph + p['o']) % 1.0
            if self.kind == 'ember':
                x = p['x'] + p['wob'] * np.sin(TAU * (2 * s + p['wp'])) + 3 * p['dx'] * s
                y = p['y'] - self.rise * s
                ci = min(nc - 1, int(s * nc))
                if s > 0.85:
                    continue
                put(img, x * q, y * q, C[ci])
                if s < 0.4 and q > 1:                              # a short hot tail
                    put(img, x * q, y * q + 1, C[min(nc - 1, ci + 1)], 0.7)
            elif self.kind == 'firefly':
                x = p['x'] + 6 * np.sin(TAU * (s + p['wp'])) * p['dx'] + 2 * np.sin(TAU * 3 * s)
                y = p['y'] + 4 * np.sin(TAU * (s * 2 + p['wp'])) * p['dy']
                k = 0.5 + 0.5 * np.sin(TAU * (2 * ph + p['o']))
                if k < 0.25:
                    continue
                X, Y = x * q, y * q
                glow(img, X, Y, 2.6 * q, C[0], 0.35 * k, add=False)
                put(img, X, Y, C[0] if k > 0.6 else C[1])
                if q > 1 and k > 0.6:
                    for dx_, dy_ in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        put(img, X + dx_, Y + dy_, C[1], 0.6)
            elif self.kind == 'dust':
                x = p['x'] + 4 * np.sin(TAU * (s + p['wp'])) * p['dx']
                y = p['y'] - 6 * s
                k = np.sin(np.pi * s)
                put(img, x * q, y * q, C[p['c'] % nc], 0.35 * k + 0.1)
            elif self.kind == 'drip':
                y = y0 + (y1 - y0) * s ** 1.6
                X = p['x'] * q
                if s < 0.92:
                    put(img, X, y * q, C[0])
                    for k_ in range(1, q + 1):
                        put(img, X, y * q - k_, C[1], 0.6)
                else:
                    for k_ in range(1, q + 1):
                        put(img, X - k_, y1 * q - 1, C[0], 0.8); put(img, X + k_, y1 * q - 1, C[0], 0.8)
            elif self.kind == 'leaf':
                x = p['x'] - self.rise * s + 2 * np.sin(TAU * (2 * s + p['wp']))
                y = p['y'] + (y1 - y0) * 0.35 * s + p['wob'] * np.sin(TAU * (3 * s + p['wp']))
                if s < 0.06 or s > 0.94:
                    continue
                c = C[p['c'] % nc]
                X, Y = x * q, y * q
                put(img, X, Y, c)
                flip = (f + int(p['o'] * 8)) % 2
                for k_ in range(1, q + 1):                         # a leaf tumbling: flat / edge-on
                    if flip:
                        put(img, X + k_, Y, c * (0.9 - 0.1 * k_))
                    else:
                        put(img, X, Y + k_, c * (0.9 - 0.1 * k_))
            elif self.kind == 'bird':
                rx, ry = (x1 - x0) / 2 * p['wob'] / 2.2, (y1 - y0) / 2
                cx, cy = (x0 + x1) / 2 + p['dx'] * 10, (y0 + y1) / 2 + p['dy'] * 4
                a = TAU * (ph + p['o'])
                X = (cx + rx * np.sin(a)) * q; Y = (cy + ry * 0.6 * np.sin(2 * a)) * q
                up = ((f // 2) + int(p['o'] * 4)) % 2
                c = C[0]
                put(img, X, Y, c)
                for k_ in range(1, q + 1):                          # wings: up = V, down = ^
                    put(img, X - k_, Y - (k_ if up else -k_ * 0.5), c)
                    put(img, X + k_, Y - (k_ if up else -k_ * 0.5), c)
            elif self.kind == 'butterfly':
                a = TAU * (ph + p['o'])
                x = p['x'] + 5 * p['dx'] * np.sin(a) + 1.5 * np.sin(3 * a)
                y = p['y'] + 3 * p['dy'] * np.sin(2 * a) - 1.5 * abs(np.sin(4 * a))
                c = C[p['c'] % nc]
                X, Y = x * q, y * q
                put(img, X, Y, c)
                if (f + int(p['o'] * 4)) % 2:
                    for k_ in range(1, q + 1):
                        put(img, X - k_, Y - k_ + 1, c * 0.85); put(img, X + k_, Y - k_ + 1, c * 0.85)
                else:
                    put(img, X, Y - 1, c * 0.85)
            elif self.kind == 'snow':
                x = p['x'] + p['wob'] * np.sin(TAU * (2 * s + p['wp']))
                y = y0 + ((p['y'] - y0) + (y1 - y0) * s) % (y1 - y0)
                put(img, x * q, y * q, C[p['c'] % nc])


class Smoke(Effect):
    """Chimney smoke: a column of soft puffs rising and drifting with the wind,
    thinning out (dithered density) as they rise."""
    layer = 15

    def __init__(self, x, y, height=26, drift=10, col=(200, 200, 210), puffs=5, seed=0, r=2.2, alpha=0.6):
        self.alpha = alpha
        self.x, self.y, self.height, self.drift = x, y, height, drift
        self.col = np.asarray(col, float); self.puffs = puffs; self.r = r
        self.o = np.random.default_rng(seed).random()

    def colors(self):
        return [self.col] + lit_tints(self.loc.pal, self.col, (0.25, 0.45), top=1.0, every=3)

    def draw(self, img, f, n):
        ph = f / n
        H, W = img.shape[:2]
        for i in range(self.puffs):
            s = (ph + i / self.puffs + self.o) % 1.0
            cy = self.y - self.height * s
            cx = self.x + self.drift * s ** 1.4 + 0.8 * self.u * np.sin(TAU * (s * 1.5 + i * 0.3))
            r = self.r * (0.9 + 1.8 * s)
            a = self.alpha * (1 - s) ** 1.2 * min(1, s * 5 + 0.15)
            # flat-topped puff: (1-d)^0.6 keeps a readable body instead of a faint dot
            H_, W_ = img.shape[:2]
            y0, y1 = max(0, int(cy - r) - 1), min(H_, int(cy + r) + 2)
            x0, x1 = max(0, int(cx - r) - 1), min(W_, int(cx + r) + 2)
            if y0 < y1 and x0 < x1:
                yy, xx = np.mgrid[y0:y1, x0:x1]
                d = np.hypot(xx - cx, (yy - cy) / 0.85) / r
                t = np.clip(1 - d, 0, 1) ** 0.6 * a
                sub = img[y0:y1, x0:x1]
                sub += (self.col - sub) * t[..., None]


# ------------------------------------------------------------------ wind
class Sway(Effect):
    """Rooted foliage / grass / flowers / tree crowns bending in travelling gusts.
    Rows shift by whole pixels, more toward the free end; the area the object leaves
    shows the painted-out plate. Pieces are animated on twos (pose held 2 frames).
    root='bottom' (plants) or 'top' (hanging moss, vines)."""
    layer = 30

    def __init__(self, mask, amp=1.6, wavelength=160.0, cycles=1, root='bottom', piece=22, seed=0,
                 min_px=12, direction=1, twos=True):
        self.mask = mask; self.amp = amp; self.wavelength = wavelength; self.cycles = cycles
        self.root = root; self.piece = piece; self.seed = seed; self.min_px = min_px
        self.direction = direction; self.twos = twos
        self.plate = ndimage.binary_dilation(mask)

    def bind(self, loc):
        self.loc = loc
        rng = np.random.default_rng(self.seed)
        lab, n = ndimage.label(self.mask)
        H, W = self.mask.shape
        yy, xx = np.mgrid[0:H, 0:W]
        self.items = []
        for i, sl in enumerate(ndimage.find_objects(lab), 1):
            comp = (lab == i)
            ys, xs = np.nonzero(comp)
            step = self.piece
            for gx in range(xs.min(), xs.max() + 1, step):
                cols = comp[:, gx:gx + step]
                if cols.sum() < self.min_px:
                    continue
                piece = np.zeros_like(comp); piece[:, gx:gx + step] = cols
                py, px_ = np.nonzero(piece)
                self.items.append(dict(m=piece, y0=py.min(), y1=py.max(), cx=px_.mean(),
                                       amp=self.amp * rng.uniform(0.7, 1.25), jit=rng.uniform(-0.06, 0.06)))

    def draw(self, img, f, n):
        ff = (f // 2) * 2 if self.twos else f
        ph = ff / n
        H, W = img.shape[:2]
        base = self.loc.base
        for it in self.items:
            g = TAU * (self.cycles * ph + it['cx'] / self.wavelength + it['jit'])
            gust = 0.5 + 0.5 * np.sin(g)
            flutter = 0.3 * np.sin(2 * g + 1.0)
            h = max(1, it['y1'] - it['y0'])
            m = it['m']
            for y in range(it['y0'], it['y1'] + 1):
                xs = np.nonzero(m[y])[0]
                if not len(xs):
                    continue
                k = (it['y1'] - y) / h if self.root == 'bottom' else (y - it['y0']) / h
                dx = int(round(self.direction * it['amp'] * k ** 1.3 * (gust + flutter)))
                tx = xs + dx
                ok = (tx >= 0) & (tx < W)
                img[y, tx[ok]] = base[y, xs[ok]]


class Swing(Effect):
    """Something hanging from a pivot (cage, lantern on a chain, sign): rows shear
    sideways by an amount growing with distance from the pivot — a pendulum at small
    angles, without resampling the drawing."""
    layer = 30

    def __init__(self, mask, pivot_y, amp=1.5, cycles=1, phase=0.0, twos=True):
        self.mask = mask; self.pivot_y = pivot_y; self.amp = amp; self.cycles = cycles
        self.phase = phase; self.twos = twos
        self.plate = ndimage.binary_dilation(mask)

    def draw(self, img, f, n):
        ff = (f // 2) * 2 if self.twos else f
        a = np.sin(TAU * (self.cycles * ff / n + self.phase))
        base = self.loc.base
        ys = np.nonzero(self.mask.any(1))[0]
        L = max(1, ys.max() - self.pivot_y)
        W = img.shape[1]
        for y in ys:
            xs = np.nonzero(self.mask[y])[0]
            dx = int(round(self.amp * a * max(0, y - self.pivot_y) / L))
            tx = xs + dx
            ok = (tx >= 0) & (tx < W)
            img[y, tx[ok]] = base[y, xs[ok]]


class Banner(Effect):
    """Hanging cloth fixed at the top (wraps motion_objects.SheetY)."""
    layer = 30

    def __init__(self, mask, emblem=None, amp=2.0, cycles=1, n=6, top_fixed=3):
        self.mask = mask; self.emblem = emblem; self.amp = amp; self.cycles = cycles
        self.n = n; self.top_fixed = top_fixed
        self.plate = ndimage.binary_dilation(mask)

    def bind(self, loc):
        from motion_objects import SheetY
        self.loc = loc
        self.sheet = SheetY(loc.base, self.mask, self.emblem, n=self.n, top_fixed=self.top_fixed)

    def colors(self):
        return list(self.sheet.ramp)

    def draw(self, img, f, n):
        ph = (f // 2) * 2 / n
        self.sheet.draw(img, ph, amp=self.amp, cycles=self.cycles)


class Breathe(Effect):
    """Slow light change over a whole area (lava light pulsing on cave walls, a
    stained-glass window brightening as a cloud passes). One cycle per loop, small
    amplitude: anything faster reads as flicker of the whole picture."""
    layer = 5

    def __init__(self, weight, col, k=0.08, cycles=1, phase=0.0):
        self.weight = weight; self.col = np.asarray(col, float); self.k = k
        self.cycles = cycles; self.phase = phase

    def colors(self):
        return lit_tints(self.loc.pal, self.col, (0.06, 0.12), top=0.85, every=2)

    def draw(self, img, f, n):
        a = self.k * (0.5 + 0.5 * np.sin(TAU * (self.cycles * f / n + self.phase)))
        # added light, not a tint: whites stay white, darks pick up the light's hue
        img += self.col[None, None] * (self.weight * a)[..., None] * 0.5
        np.clip(img, 0, 255, out=img)


class Mist(Effect):
    """Drifting mist / fog / spray / steam: two tiling noise fields cross-fade while
    sliding sideways, tinted toward col with weight `zone` (0..1 array: where the mist
    lives, soft edges). alpha = max opacity. Calm and seamless."""
    layer = 18

    def __init__(self, zone, col=(150, 140, 160), alpha=0.3, scale=30, stretch=3.0, drift=8, seed=0, dither=False):
        self.dither = dither
        self.zone = zone; self.col = np.asarray(col, float); self.alpha = alpha
        self.scale = scale; self.stretch = stretch; self.drift = drift; self.seed = seed

    def bind(self, loc):
        self.loc = loc
        H, W = self.zone.shape
        self.a = tile_noise(H, W, self.scale, self.seed + 11, 3, (self.stretch, 1))
        self.b = tile_noise(H, W, self.scale, self.seed + 12, 3, (self.stretch, 1))
        self.yy, self.xx = np.mgrid[0:H, 0:W].astype(float)

    def colors(self):
        return lit_tints(self.loc.pal, self.col, (0.15, 0.3), top=0.9, every=2)

    def draw(self, img, f, n):
        ph = f / n
        t = 0.5 + 0.5 * np.cos(TAU * ph)
        ox = self.drift * np.sin(TAU * ph)
        fa = sample(self.a, self.yy, self.xx + ox)
        fb = sample(self.b, self.yy, self.xx - ox)
        field = fa * t + fb * (1 - t)
        a = np.clip((field - 0.42) * 2.2, 0, 1) * self.alpha * self.zone
        if self.dither:
            # ordered-dithered fog: each pixel is either untouched or tinted by one fixed
            # step, so a dithered picture (photo conversions) keeps its texture instead
            # of the tint snapping into flat blotches
            H, W = a.shape
            B = BAYER[self.yy.astype(int) % 4, self.xx.astype(int) % 4]
            on = (a / max(self.alpha, 1e-6)) > B
            img[on] += (self.col - img[on]) * self.alpha
        else:
            img += (self.col - img) * a[..., None]


class Custom(Effect):
    """Wrap a plain function draw(img, f, n, loc) as an effect."""

    def __init__(self, fn, layer=35, plate=None, colors=()):
        self.fn = fn; self.layer = layer; self.plate = plate; self._c = list(colors)

    def colors(self):
        return self._c

    def draw(self, img, f, n):
        self.fn(img, f, n, self.loc)
