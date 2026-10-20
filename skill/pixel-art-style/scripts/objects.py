"""Detailed, logically built pixel-art objects (the detailing kit).

Every builder works on a pixel_canvas.Canvas in ART PIXELS and follows the same
construction logic a pixel artist uses:
  silhouette -> material texture (blocks, tiles, planks) -> form shading (cylinder,
  plane, ambient occlusion) -> edges (rim light on the light side, dark contact
  lines) -> details that explain the object (sills, corbels, mullions, hinges) ->
  light it emits (glass gradient, spill on the wall below).

    import sys; sys.path.insert(0, '<skill>/scripts')
    from pixel_canvas import Canvas
    from objects import Kit
    kit = Kit(cv, light=(moon_x, moon_y))
    stone = kit.ramp('#0a0817', '#17142e', '#262248', '#3a3468', '#574a80')
    body = kit.round_tower(cx, base_y, w, h, stone, roof=slate, roof_h=40)
    kit.window(x, y, 6, 14, frame=stone, kind='lancet')

Ramps are lists of hex colours dark -> light; index 0 is the mortar / deepest
shadow, the last is the rim highlight. Use 5 steps for stone, 4 for slate.

Rules baked in (from reviews of earlier pieces):
- Texture must follow construction: stones are staggered courses with mortar,
  roofs are overlapping tile rows, never noise. Noise only varies tone per block.
- Form first, texture second: the cylinder / plane shading shifts the ramp index,
  the block texture adds +-1 on top. Texture never exceeds one ramp step, so the
  form still reads at a glance.
- Every opening has depth: frame lit on the light side, a dark reveal, a sill that
  casts a 1-px shadow.
- Things that stick out cast shadow below them (corbels, sills, eaves, merlons).
- Rim light only on edges that face the light; contact shadow where parts meet.
"""
import numpy as np
from scipy import ndimage
from pixel_canvas import BAYER4


def _h(seed, *ks):
    """Deterministic hash -> 0..1 for block ids (stable texture per block)."""
    v = np.uint64(seed * 2654435761 % 2 ** 32)
    out = np.zeros_like(ks[0], dtype=np.uint64) + v
    for k in ks:
        out = (out ^ (k.astype(np.uint64) + np.uint64(0x9E3779B9) + (out << np.uint64(6)) + (out >> np.uint64(2)))) % np.uint64(2 ** 32)
    return (out % np.uint64(10007)).astype(float) / 10007.0


class Kit:
    def __init__(self, cv, light=(0, 0)):
        self.cv = cv
        self.H, self.W = cv.h, cv.w
        self.yy, self.xx = cv.yy, cv.xx
        self.light = light
        self.B = BAYER4[self.yy % 4, self.xx % 4]
        self.emissive = np.zeros((self.H, self.W), bool)
        self.parts = {}                                   # name -> mask, for animation / checks

    # ------------------------------------------------------------- helpers
    def ramp(self, *hexes):
        return list(hexes)

    def paint_idx(self, mask, idx, ramp):
        idx = np.clip(idx, 0, len(ramp) - 1)
        for i, col in enumerate(ramp):
            self.cv.paint(mask & (idx == i), col)

    def side(self, x):
        """+1 if the light is to the right of x, else -1."""
        return 1 if self.light[0] > x else -1

    def roll(self, m, dy, dx):
        return np.roll(np.roll(m, dy, 0), dx, 1)

    def edge(self, mask, dx, dy):
        """Pixels of mask whose neighbour in direction (dx, dy) is outside."""
        return mask & ~self.roll(mask, -dy, -dx)

    # ------------------------------------------------------------- materials
    def masonry(self, mask, ramp, bw=5, bh=3, seed=0, shift=None, base=2, var=0.45, x0=0, y0=0,
                lit_top=True, crack=0.04, worn=0.05, mortar=1):
        """Staggered stone courses. shift: float array of ramp-index offsets from the
        form shading (cylinder / AO). Each block: one tone (base +-1 by hash), top row
        a step lighter (catches the sky), mortar joints = index 0, a few cracked or
        worn blocks for age."""
        yy, xx = self.yy - y0, self.xx - x0
        row = yy // bh
        off = (row % 2) * (bw // 2)
        col = (xx + off) // bw
        hb = _h(seed, row, col)
        idx = np.full((self.H, self.W), base, float)
        idx += np.where(hb < var / 2, -1, np.where(hb > 1 - var / 2, 1, 0))
        if shift is not None:
            idx = idx + shift
        if lit_top:
            idx = idx + ((yy % bh) == 0) * 0.6
        joint = ((yy % bh) == bh - 1) | (((xx + off) % bw) == bw - 1)
        idx = np.round(idx).astype(int)
        idx = np.clip(idx, 1, len(ramp) - 1)
        # mortar is `mortar` steps darker than the block it belongs to: at a distance a
        # wall reads as stone, not as a black-lined brick grid
        idx[joint] = np.maximum(0, idx[joint] - mortar)
        # cracks: a diagonal hairline through a few blocks; worn: block loses its lit top
        hc = _h(seed + 7, row, col)
        cr = (hc < crack) & (((xx + off) % bw) == ((yy % bh) + 1) % bw)
        idx[cr] = 0
        self.paint_idx(mask, idx, ramp)
        return joint & mask

    def roof_tiles(self, mask, ramp, tw=4, th=3, seed=0, axis_x=None, shift=None):
        """Overlapping slate / tile rows. Each tile: body tone (+-1 by hash), a lit top
        pixel row on its light half, a dark lower lip (the shadow cast on the row
        below). axis_x: ridge of a cone/gable roof - the half facing the light is a
        full step lighter and its outer edge gets a rim; the far half gets an outline."""
        yy, xx = self.yy, self.xx
        row = yy // th
        off = (row % 2) * (tw // 2)
        col = (xx + off) // tw
        hb = _h(seed, row, col)
        n = len(ramp)
        idx = np.full((self.H, self.W), 1.0) + (hb > 0.7) * 1 - (hb < 0.1) * 1
        lit_half = np.zeros((self.H, self.W), bool)
        if axis_x is not None:
            lit_half = (xx - axis_x) * self.side(axis_x) > 0
            idx += lit_half * 1.0
        if shift is not None:
            idx = idx + shift
        idx = np.round(idx).astype(int)
        lip = (yy % th) == th - 1
        joint = ((xx + off) % tw) == 0
        top = (yy % th) == 0
        idx = np.clip(idx, 1, n - 2)
        idx = np.where(joint & ~top, idx - 1, idx)
        idx = np.where(lip, idx - 1, idx)
        idx = np.where(top & ~joint, idx + 1, idx)
        self.paint_idx(mask, idx, ramp)
        if axis_x is not None:
            self.cv.paint(self.edge(mask, self.side(axis_x), 0) & lit_half, ramp[-1])
            self.cv.paint(self.edge(mask, -self.side(axis_x), 0) & ~lit_half, ramp[0])

    def planks(self, mask, ramp, ph=2, seed=0, vertical=False):
        yy, xx = self.yy, self.xx
        k = xx if vertical else yy
        line = (k % ph) == ph - 1
        hb = _h(seed, k // ph, (yy if vertical else xx) // 7)
        idx = 1 + (hb > 0.6) * 1
        idx = np.where(line, 0, idx)
        self.paint_idx(mask, idx, ramp)

    # ------------------------------------------------------------- form shading
    def cyl_shift(self, cx, w, strength=1.6):
        """Ramp-index offset for a round tower of width w centred at cx: the side
        toward the light is lighter, the far side darker, with a soft rim."""
        t = np.clip((self.xx - cx) / (w / 2), -1, 1) * self.side(cx)
        return strength * (0.55 * t - 0.25 * (1 - np.sqrt(np.clip(1 - t * t, 0, 1))) * (t < 0))

    def ao_shift(self, mask, depth=4, strength=1.2):
        """Ambient occlusion: darken pixels close to the bottom of a mask (where the
        part meets the ground / the wall below)."""
        bottom = mask & ~self.roll(mask, -1, 0)
        d = ndimage.distance_transform_edt(~bottom)
        return -strength * np.clip(1 - d / depth, 0, 1)

    # ------------------------------------------------------------- parts
    def cone(self, cx, top_y, w, h, flare=1.5, bell=0.18):
        """Conical roof mask with slightly concave (bell) sides and flared eaves."""
        yy, xx = self.yy, self.xx
        v = np.clip((yy - (top_y - h)) / h, 0, 1)            # 0 at tip .. 1 at eaves
        half = (w / 2 + flare) * (v ** (1 - bell))
        m = (yy >= top_y - h) & (yy <= top_y) & (np.abs(xx - cx + 0.5) <= half)
        return m

    def round_tower(self, cx, base_y, w, h, stone, roof=None, roof_h=None, seed=0, corbels=True,
                    merlons=False, slits=2, finial=True):
        """Round tower: masonry body with cylinder shading + AO at the foot, a corbel
        band (machicolations) under the roof, conical tiled roof with a finial.
        Returns dict of masks: body, roof, band, finial."""
        cv, yy, xx = self.cv, self.yy, self.xx
        top = base_y - h
        body = (np.abs(xx - cx + 0.5) <= w / 2) & (yy >= top) & (yy < base_y)
        sh = self.cyl_shift(cx, w, 2.2) + self.ao_shift(body, 6, 0.8)
        self.masonry(body, stone, bw=max(4, int(w / 4)), bh=3, seed=seed, shift=sh, x0=int(cx))
        cv.paint(self.edge(body, self.side(cx), 0), stone[-1])          # rim on the light side
        cv.paint(self.edge(body, -self.side(cx), 0), stone[0])          # outline on the dark side
        out = dict(body=body)
        if corbels:
            band = (np.abs(xx - cx + 0.5) <= w / 2 + 1.5) & (yy >= top - 4) & (yy < top)
            gaps = band & ((yy - (top - 4)) >= 2) & ((np.abs(xx - int(cx)) % 3) == 1)
            self.paint_idx(band & ~gaps, np.round(2.4 + self.cyl_shift(cx, w + 3, 2.0)).astype(int), stone)
            cv.paint(band & ((yy - (top - 4)) == 0), stone[-1])        # lit top of the parapet
            cv.paint(gaps, stone[0])                                   # dark gaps between corbels
            cv.paint(body & (yy < top + 2), stone[0])                  # the band's shadow on the wall
            out['band'] = band
            top -= 4
        if merlons:
            mer = (np.abs(xx - cx + 0.5) <= w / 2 + 1.5) & (yy >= top - 3) & (yy < top) & (((xx - int(cx)) // 3) % 2 == 0)
            self.paint_idx(mer, np.round(2 + self.cyl_shift(cx, w)).astype(int), stone)
            cv.paint(mer & (yy == top - 3), stone[-1])
            out['merlons'] = mer
            top -= 3
        if slits:
            for i in range(slits):
                sy = int(base_y - h * (0.35 + 0.4 * i / max(1, slits)))
                s = (np.abs(xx - cx) < 0.6) & (yy >= sy) & (yy < sy + 5)
                cv.paint(s, stone[0])
                cv.paint(self.edge(s, self.side(cx), 0), stone[-2])
        if roof is not None:
            rh = roof_h or w * 1.6
            rm = self.cone(cx, top, w + 2, rh)
            self.roof_tiles(rm, roof, tw=3, th=2, seed=seed + 3, axis_x=cx)
            cv.paint(self.edge(rm, 0, 1) & (yy >= top - 1), roof[0])          # eave shadow line
            cv.paint(body & (yy >= top + 4) & (yy < top + 6), stone[0])       # eaves cast shadow on the wall
            out['roof'] = rm
            if finial:
                f = (np.abs(xx - cx + 0.5) <= 0.5) & (yy >= top - rh - 6) & (yy < top - rh + 1)
                orb = (np.hypot(xx - cx + 0.5, yy - (top - rh - 6)) <= 1.2)
                cv.paint(f | orb, stone[1])
                cv.paint(orb & (xx >= cx) if self.side(cx) > 0 else orb & (xx < cx), stone[3])
                out['finial'] = f | orb
                out['tip'] = (cx, top - rh - 6)
        return out

    def wall(self, x0, x1, top_y, base_y, stone, seed=0, merlon_w=4, gap=3, walk=True, slits=0):
        """Curtain wall: masonry with AO, crenellations (merlons lit on top, shaded on
        the dark side), a wall-walk shadow line and optional arrow slits."""
        cv, yy, xx = self.cv, self.yy, self.xx
        body = (xx >= x0) & (xx < x1) & (yy >= top_y) & (yy < base_y)
        self.masonry(body, stone, bw=6, bh=3, seed=seed, shift=self.ao_shift(body, 8, 1.0))
        mer = (xx >= x0) & (xx < x1) & (yy >= top_y - 5) & (yy < top_y) & (((xx - x0) % (merlon_w + gap)) < merlon_w)
        self.masonry(mer, stone, bw=merlon_w, bh=3, seed=seed + 1, x0=x0, y0=top_y - 5)
        cv.paint(mer & (yy == top_y - 5), stone[-1])
        cv.paint(self.edge(mer, -self.side((x0 + x1) / 2), 0), stone[0])
        if walk:
            cv.paint(body & (yy < top_y + 2), stone[0])
        for i in range(slits):
            sx = int(x0 + (x1 - x0) * (i + 0.5) / slits)
            s = (np.abs(xx - sx) < 0.6) & (yy >= top_y + 5) & (yy < top_y + 11)
            cv.paint(s, stone[0])
        return dict(body=body, merlons=mer)

    def window(self, x, y, w, h, frame, kind='lancet', lit=True, glass=None, mullion=None, sill=True, spill=0.0):
        """An opening with depth: stone frame (lit side lighter), dark reveal, glass
        gradient (warm, brightest low and centre), mullion/transom for wide windows,
        a sill with a shadow under it. Returns the glass mask (for flicker)."""
        cv, yy, xx = self.cv, self.yy, self.xx
        glass = glass or ['#3a1c16', '#8c3d1e', '#c8642a', '#f09a3e', '#ffc86a', '#ffeab0']
        r = w / 2
        if kind == 'round':
            hole = (np.hypot(xx - (x + r - 0.5), yy - (y + r - 0.5)) <= r)
        else:
            rect = (xx >= x) & (xx < x + w) & (yy >= y + r) & (yy < y + h)
            if kind == 'lancet':
                # pointed arch from two circle arcs
                c1 = np.hypot(xx - (x + w - 0.5), yy - (y + r)) <= w * 0.95
                c2 = np.hypot(xx - (x - 0.5), yy - (y + r)) <= w * 0.95
                arch = c1 & c2 & (yy >= y) & (yy < y + r) & (xx >= x) & (xx < x + w)
            else:
                arch = (np.hypot(xx - (x + r - 0.5), yy - (y + r)) <= r) & (yy < y + r)
            hole = rect | arch
        fr = ndimage.binary_dilation(hole, iterations=1) & ~hole
        cv.paint(fr, frame[2])
        cv.paint(self.edge(fr | hole, self.side(x), 0) & fr, frame[3])
        cv.paint(self.edge(fr | hole, 0, -1) & fr, frame[3])
        if lit:
            v = np.clip((yy - y) / max(1, h - 1), 0, 1)
            c = 1 - np.clip(np.abs(xx - (x + r - 0.5)) / max(r, 1), 0, 1)
            gi = np.round(1 + 3.2 * (0.55 * v + 0.45 * c)).astype(int)
            self.paint_idx(hole, gi, glass)
            cv.paint(hole & ~self.roll(hole, 1, 0), glass[1])           # reveal shadow at the top
            self.emissive |= hole
        else:
            cv.paint(hole, frame[0])
        if (mullion is None and w >= 5) or mullion:
            mm = hole & (np.abs(xx - (x + r - 0.5)) < 0.6)
            cv.paint(mm, frame[1] if lit else frame[0])
            if h >= 10:
                tr = hole & (yy == int(y + h * 0.55))
                cv.paint(tr, frame[1] if lit else frame[0])
        if sill:
            s = (xx >= x - 1) & (xx < x + w + 1) & (yy == y + h)
            cv.paint(s, frame[3])
            cv.paint((xx >= x - 1) & (xx < x + w + 1) & (yy == y + h + 1), frame[0])
        if lit and spill:
            cv.glow(x + r, y + h + 2, w * 2.2, glass[3], strength=spill, dither=0.0, squash=0.8)
        return hole

    def gate(self, cx, base_y, w, h, stone, wood=None, lit=True):
        """Arched gateway: voussoir ring (radial stones alternating tone, a keystone),
        a deep reveal, portcullis lattice, warm light inside."""
        cv, yy, xx = self.cv, self.yy, self.xx
        r = w / 2
        hole = ((np.abs(xx - cx + 0.5) <= r) & (yy >= base_y - h + r) & (yy < base_y)) | \
               ((np.hypot(xx - cx + 0.5, yy - (base_y - h + r)) <= r) & (yy < base_y - h + r))
        ring = ((np.hypot(xx - cx + 0.5, yy - (base_y - h + r)) <= r + 3) & (yy < base_y - h + r + 1)) & ~hole
        ang = np.arctan2(yy - (base_y - h + r), xx - cx + 0.5)
        vous = (np.floor(ang / (np.pi / 9)) % 2).astype(int)
        self.paint_idx(ring, 2 + vous, stone)
        cv.paint(ring & (np.abs(ang + np.pi / 2) < 0.12), stone[-1])            # keystone
        cv.paint(ring & (np.abs(np.hypot(xx - cx + 0.5, yy - (base_y - h + r)) - (r + 3)) < 0.7), stone[0])
        glass = ['#2a120e', '#5a2a1c', '#8c3d1e', '#c8642a', '#f09a3e', '#ffc86a']
        if lit:
            v = np.clip((yy - (base_y - h)) / h, 0, 1)
            self.paint_idx(hole, np.round(1 + 3.5 * v).astype(int), glass)
            self.emissive |= hole
        else:
            cv.paint(hole, stone[0])
        lattice = hole & (((xx - int(cx)) % 3 == 0) | ((yy - base_y) % 4 == 0))
        cv.paint(lattice, '#1c110d')
        cv.paint(hole & (yy < base_y - h + 3), stone[0])                         # reveal
        return dict(hole=hole, ring=ring)

    def buttress(self, x, base_y, w, h, stone, seed=0):
        cv, yy, xx = self.cv, self.yy, self.xx
        m = (xx >= x) & (xx < x + w) & (yy >= base_y - h) & (yy < base_y)
        slope = (xx >= x) & (xx < x + w) & (yy >= base_y - h - w) & (yy < base_y - h) & \
                ((yy - (base_y - h - w)) >= (x + w - 1 - xx))
        self.masonry(m, stone, bw=w, bh=3, seed=seed, shift=self.ao_shift(m, 4, 0.8))
        cv.paint(slope, stone[3])
        cv.paint(self.edge(m, -self.side(x), 0), stone[0])
        return m | slope

    def ivy(self, region, density=0.5, seed=0, leaves=('#070c10', '#0c1418', '#122026', '#24403f')):
        """Ivy climbing from the bottom of a region: clusters of 2-px leaves, darker
        inside, a lit leaf edge on the light side; thins out with height."""
        cv, yy, xx = self.cv, self.yy, self.xx
        rng = np.random.default_rng(seed)
        ys, xs = np.nonzero(region)
        if not len(ys):
            return np.zeros_like(region)
        y0, y1 = ys.min(), ys.max()
        m = np.zeros_like(region)
        for _ in range(int(len(ys) * density * 0.02)):
            i = rng.integers(len(ys))
            y, x = ys[i], xs[i]
            if rng.random() > (y - y0) / max(1, y1 - y0) + 0.15:
                continue
            m |= (np.abs(xx - x) <= 1) & (np.abs(yy - y) <= 0) | (np.abs(xx - x) <= 0) & (np.abs(yy - y) <= 1)
        m &= region
        cv.paint(m, leaves[1])
        cv.paint(m & ~self.roll(m, 1, 0), leaves[2])
        cv.paint(self.edge(m, self.side(xs.mean()), 0), leaves[3])
        cv.paint(m & ~self.roll(m, -1, 0), leaves[0])
        return m

    def banner(self, x, top_y, w, h, cloth=('#2a0d10', '#4a1418', '#6e1c1e', '#9a2a26'), emblem='#c8963a'):
        """Hanging banner with a swallowtail, vertical fold shading and a cross.
        Returns (mask, emblem_mask) for fx.Banner."""
        cv, yy, xx = self.cv, self.yy, self.xx
        body = (xx >= x) & (xx < x + w) & (yy >= top_y) & (yy < top_y + h)
        notch = (yy >= top_y + h - w / 2) & (np.abs(xx - (x + w / 2 - 0.5)) < (yy - (top_y + h - w / 2)) * 1.0)
        m = body & ~notch
        fold = np.sin((xx - x) / max(2, w) * np.pi * 2.0)
        idx = np.round(1.6 + fold * 0.9).astype(int)
        self.paint_idx(m, idx, list(cloth))
        cv.paint(self.edge(m, self.side(x), 0), cloth[-1])
        em = m & (((np.abs(xx - (x + w / 2 - 0.5)) < 0.7) & (yy > top_y + 2) & (yy < top_y + h * 0.7)) |
                  ((np.abs(yy - (top_y + h * 0.3)) < 0.7) & (np.abs(xx - (x + w / 2 - 0.5)) < w * 0.3)))
        cv.paint(em, emblem)
        rod = (xx >= x - 1) & (xx < x + w + 1) & (yy == top_y - 1)
        cv.paint(rod, '#1c110d')
        return m, em

    def pennant(self, x, y, length=9, height=4, cloth=('#4a1418', '#9a2a26')):
        """A small flag on a finial, flying to the right. Returns its mask."""
        cv, yy, xx = self.cv, self.yy, self.xx
        t = (xx - x) / length
        m = (xx >= x) & (xx < x + length) & (yy >= y) & (np.abs(yy - y - height / 2) <= (1 - t) * height / 2 + 0.3)
        cv.paint(m, cloth[0])
        cv.paint(m & ~self.roll(m, 1, 0), cloth[1])
        return m
