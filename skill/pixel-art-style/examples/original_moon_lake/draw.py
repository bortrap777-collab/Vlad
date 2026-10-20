"""'Moon Lake' v4 (castle built with the detailing kit, grid x3) — from v3 — cinematic version: a great castle on the island (curtain walls,
five towers, a great hall, a gatehouse), mountains receding in hazy layers, every
object standing on real ground (placed from the ground mask, with contact shadows),
deep shadows, a vignette and moon rays.
Coordinates are DESIGN units (384x216); S converts them to art px (768x432)."""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
from pixel_canvas import Canvas, BAYER4
from fx import tile_noise

S = 3
W, H = 384 * S, 216 * S
OUT_SCALE = 1
os.makedirs('stage4', exist_ok=True)

PAL = [
    '#050410', '#0b0918', '#110e24', '#181431', '#211b40', '#2c2452', '#3a2f63', '#4b3d75', '#5e4d86',
    '#2a2348', '#3d3363', '#574a80', '#7d6fa3', '#a99cc6', '#d6cde6',
    '#fff9ec', '#f6efdc', '#ebe0c4', '#d9caa8', '#c4b393', '#a8977c',
    '#5a5290', '#463f78', '#3a3468', '#2f2a58', '#262248', '#1e1a3a', '#17142e', '#100d22', '#0a0817', '#070611',
    '#6a62a0', '#8e86c0', '#b8b0dc',
    '#6b6496', '#8a83b3', '#a9a2cc',
    '#0c0a1e', '#120f28', '#1a1636', '#241f48', '#30295a',
    '#05080b', '#070c10', '#0c1418', '#122026', '#1a2e32', '#24403f', '#35584f', '#4c7465',
    '#0f0d18', '#15121f', '#211c2e', '#2f2840', '#40375a', '#574c74', '#7a6e98',
    '#2a120e', '#3a1c16', '#5a2a1c', '#8c3d1e', '#c8642a', '#f09a3e', '#ffc86a', '#ffeab0',
    '#123a44', '#1e5a64', '#2f8f94', '#5fd4c8', '#b4fff0',
    '#1c110d', '#2a1a14', '#3d281c', '#55382a',
    '#2a0d10', '#4a1418', '#6e1c1e', '#9a2a26', '#c8963a',
]
cv = Canvas(W, H, PAL)
yy, xx = cv.yy, cv.xx
C = cv.c
B = BAYER4[yy % 4, xx % 4]
emissive = np.zeros((H, W), bool)          # lights: excluded from shadows / vignette


def P(pts):
    return [(x * S, y * S) for x, y in pts]


def poly(pts):
    return cv.poly_mask(P(pts))


def rect(x0, y0, x1, y1):
    return cv.rect_mask(x0 * S, y0 * S, x1 * S - 1, y1 * S - 1)


def N(scale, seed=0, octaves=3, stretch=(1, 1)):
    return tile_noise(H, W, scale * S, seed, octaves, stretch)


def roll(m, dy, dx):
    return np.roll(np.roll(m, dy, 0), dx, 1)


def ground_y(mask, x):
    """Top surface of a ground mask at design x (art px), or None."""
    col = np.nonzero(mask[:, int(np.clip(x * S, 0, W - 1))])[0]
    return col.min() if len(col) else None


def contact_shadow(ground, x, y, w, k=0.55):
    """Darken the ground right under an object (art px x, y; design width w)."""
    sh = cv.ellipse_mask(x, y + S, w * S * 0.6, 1.6 * S) & ground
    cv.rgb[sh] *= k


MX, MY, MR = 252 * S, 58 * S, 30 * S
LX_, LY_ = np.sign(MX - xx), np.sign(MY - yy)
dist = np.hypot(xx - MX, yy - MY)


def crag(mask, ramp, scale=6, seed=0, rough=1.0):
    h = N(scale, seed, 4) + 0.35 * N(scale * 0.35, seed + 1, 2) * rough
    gx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    gy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    lam = -(gx * np.sign(MX - xx) + gy * np.sign(MY - yy) * 0.6) * 8
    vals = lam[mask]
    if not len(vals):
        return
    cuts = np.quantile(vals, np.linspace(0, 1, len(ramp) + 1)[1:-1] ** 0.85)
    idx = np.searchsorted(cuts, lam)
    for i, col in enumerate(ramp):
        cv.paint(mask & (idx == i), col)


def haze(mask, col, y_top, y_bot, k=0.6):
    """Atmospheric perspective: the base of a far layer fades toward the haze colour."""
    t = np.clip((yy - y_top * S) / ((y_bot - y_top) * S), 0, 1) * k
    cv.rgb[mask] = cv.rgb[mask] + (C(col) - cv.rgb[mask]) * t[mask][:, None]


# ================= 1. SKY =================
cv.vgradient(0, 150 * S, ['#050410', '#0b0918', '#110e24', '#181431', '#211b40', '#2c2452', '#3a2f63', '#4b3d75'], band=0.3)
cv.lit_colors('#a99cc6', steps=(0.12, 0.25))
mw = np.clip(1 - np.abs((yy - (36 * S - xx * 0.18)) / (14 * S)), 0, 1) * N(10, 2, 3) * (xx < 190 * S)
cv.rgb[(mw * 0.9 > B) & (mw > 0.25)] = C('#2c2452')
cv.glow(MX, MY, 140 * S, '#7d6fa3', strength=0.5, dither=0.08)
cv.glow(MX, MY, 60 * S, '#d6cde6', strength=0.42, dither=0.08)
far = dist > 75 * S
sky_zone = (yy < 96 * S) & far
cv.stars(sky_zone, ['#5e4d86', '#7d6fa3'], n=420, seed=1)
cv.stars(sky_zone, ['#d6cde6', '#a99cc6'], n=110, seed=2)
rng = np.random.default_rng(11)
for _ in range(14):
    sx, sy = rng.uniform(10, 380) * S, rng.uniform(4, 64) * S
    if np.hypot(sx - MX, sy - MY) > 80 * S:
        cv.px(sx, sy, '#fff9ec')
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            cv.px(sx + dx, sy + dy, '#7d6fa3')
moon = cv.ellipse_mask(MX, MY, MR, MR)
cv.paint(moon, '#ebe0c4')
mar = N(9, 5, 4)
cv.paint(moon & (mar > 0.56), '#d9caa8')
cv.paint(moon & (mar > 0.64), '#c4b393')
cv.paint(moon & (mar > 0.72), '#a8977c')
for (cx, cy, r) in [(-10, -12, 4), (8, 6, 5), (-4, 14, 3), (14, -8, 3), (-16, 4, 2.5), (2, -20, 2)]:
    ring = cv.ellipse_mask(MX + cx * S, MY + cy * S, r * S, r * S)
    cv.paint(ring & moon, '#c4b393')
    cv.paint(ring & moon & roll(ring, 1, 1) & roll(ring, 1, 0) & ~roll(ring, -2, -2), '#f6efdc')
cv.paint(moon & (np.hypot(xx - (MX - 8 * S), yy - (MY - 8 * S)) < MR * 0.5) & (mar < 0.5), '#f6efdc')
cv.paint(moon & ~cv._erode(cv._erode(moon)) & (xx < MX - MR * 0.3), '#fff9ec')
cv.paint(moon & ~cv._erode(moon) & (xx > MX + MR * 0.4), '#d9caa8')
emissive |= moon
sky_before = cv.rgb.copy()

# clouds lit from the moon (bands, ragged opening, no filaments)
cl = cv.clouds(10 * S, 74 * S, ['#211b40', '#2a2348', '#3d3363'], light=None, coverage=0.42, scale=30 * S, seed=4, stretch=1.9)
opening = dist < MR + (5 + 10 * N(8, 16)) * S
restore = cl & opening
cl &= ~opening
cv.rgb[restore] = sky_before[restore]
thin = cl & ~ndimage.binary_opening(cl, iterations=2)
cv.rgb[thin] = sky_before[thin]
cl &= ~thin
cv.paint(cl & (N(4, 14, 3) > 0.68), '#3d3363')
depth = np.zeros((H, W), int)
for k in range(1, 9):
    depth += cl[np.clip(yy + LY_ * k, 0, H - 1), np.clip(xx + LX_ * k, 0, W - 1)]
band = cl & (depth < 8)
for (dmax, dlim, col) in [(220, 8, '#574a80'), (160, 5, '#7d6fa3'), (110, 3, '#a99cc6'), (80, 1, '#d6cde6')]:
    cv.paint(band & (dist < dmax * S) & (depth < dlim), col)
cv.paint(cl & ~roll(cl, -1, 0), '#110e24')
sky_mask = ~cl.copy()

# moon rays: faint dithered shafts radiating down through the gaps
ang = np.arctan2(yy - MY, xx - MX)
rays = (np.sin(ang * 23 + 1.3) * 0.5 + 0.5) * (np.sin(ang * 9) * 0.5 + 0.5)
ray_t = rays * np.clip(1 - dist / (210 * S), 0, 1) * (yy > MY + MR) * 0.5

# ================= 2. MOUNTAINS: three receding layers =================
def ridge(y_base, amp, seed, peaks=None, rough=0.55):
    r = np.random.default_rng(seed)
    n = 1024
    pts = np.zeros(n + 1); step, a = n, amp * S
    while step > 1:
        half = step // 2
        for i in range(half, n, step):
            pts[i] = (pts[i - half] + pts[i + half]) / 2 + r.uniform(-a, a)
        step, a = half, a * rough
    if peaks:
        for px_, ph in peaks:
            i = int(px_ / 384 * n)
            pts += ph * S * np.exp(-((np.arange(n + 1) - i) / (n * 0.08)) ** 2)
    top = y_base * S - (pts - pts.min())
    return yy >= top[(np.arange(W) / W * n).astype(int)][None, :]

# far: low contrast, light, bluish, snow on the peaks, fading into haze at the base
far1 = ridge(122, 40, 3, peaks=[(60, 26), (150, 10), (345, 18)])
crag(far1, ['#3a3468', '#463f78', '#4b3d75', '#5a5290'], scale=14, seed=30, rough=0.5)
snow = far1 & (N(5, 31) > 0.47)
snow &= yy < (np.where(far1, yy, H).min(0)[None, :] + 14 * S)         # only near the crest
crag(snow, ['#5a5290', '#6a62a0', '#8e86c0'], scale=6, seed=32, rough=0.5)
cv.paint(far1 & ~roll(far1, 1, 0), '#8e86c0')
haze(far1, '#4b3d75', 96, 128, k=0.75)
# ruins on the far peak, standing on its ridge
rx = 60
gy_ = ground_y(far1, rx)
if gy_ is not None:
    base = gy_ / S + 1.5
    ruin = rect(rx - 7, base - 8, rx - 5, base) | rect(rx - 2, base - 13, rx + 1, base) | rect(rx + 4, base - 6, rx + 6, base) \
        | rect(rx - 8, base - 2, rx + 8, base + 1) | poly([(rx - 2, base - 13), (rx + 1, base - 13), (rx - 0.5, base - 18)])
    cv.paint(ruin, '#2f2a58')
    cv.paint(rect(rx - 1, base - 10, rx, base - 8), '#c8642a')
    emissive |= rect(rx - 1, base - 10, rx, base - 8)
# mid: darker, closer, forested slopes
mid = ridge(140, 24, 7, peaks=[(110, 8), (380, 10)])
crag(mid, ['#17142e', '#1e1a3a', '#262248', '#2f2a58'], scale=9, seed=33, rough=0.6)
cv.paint(mid & ~roll(mid, 1, 0), '#3a3468')
haze(mid, '#2c2452', 126, 150, k=0.45)

# shore land along the far bank: where the shore forest stands
LAKE = 156 * S
shore = ((yy >= (150 * S + (2 * np.sin(xx / (23.0 * S)) * S).astype(int))) & (yy < LAKE))
cv.paint(shore, '#0c0a1e')


def pine(x, yb, h, col='#0c1418', lit='#1a2e32', shade='#05080b', rim_ok=True):
    """A pine standing at (x, yb) art px, trunk sunk 1 px into the ground."""
    m = np.zeros((H, W), bool)
    tiers = max(3, int(h / (3 * S)))
    w = h * 0.42
    for t in range(tiers):
        ty = yb - h + t * h / tiers
        tw = w * (0.25 + 0.75 * (t + 1) / tiers) / 2
        m |= cv.poly_mask([(x, ty - 1), (x - tw, ty + h / tiers * 1.5), (x - tw * 0.4, ty + h / tiers * 1.2),
                           (x + tw * 0.4, ty + h / tiers * 1.2), (x + tw, ty + h / tiers * 1.5)])
    m |= cv.rect_mask(x - 0.5 * S, yb - h * 0.18, x + 0.5 * S, yb + 1)
    m &= yy <= yb + 1
    cv.paint(m, col)
    if rim_ok:
        side = m & ~roll(m, 0, 1 if x < MX else -1)
        cv.paint(side & (yy < yb - h * 0.25), lit)
    cv.paint(m & ~roll(m, 0, -1 if x < MX else 1), shade)
    return m


def forest_on(ground, x0, x1, hmin, hmax, seed, col='#0c1418', lit='#1a2e32', gap=(2.5, 5.5), rim_ok=True, sink=1.0):
    """Plant pines along the TOP SURFACE of a ground mask (never in the air)."""
    r = np.random.default_rng(seed)
    out = np.zeros((H, W), bool)
    x = x0
    while x < x1:
        gy = ground_y(ground, x)
        if gy is not None:
            yb = gy + sink * S
            h = r.uniform(hmin, hmax) * S
            out |= pine(x * S, yb, h, col, lit, rim_ok=rim_ok)
        x += r.uniform(*gap)
    return out

# forest on the mid range slopes (small, hazy) and on the far shore (back to front)
forest_mid = forest_on(mid, 0, 384, 3, 6, 50, col='#17142e', lit='#211b40', gap=(1.5, 3.2), rim_ok=False, sink=2.0)
forest_shore = forest_on(shore, 100, 330, 5, 11, 51, col='#0c1418', lit='#122026', gap=(2.0, 4.0))

# ================= 3. NEAR CLIFFS + FALLS =================
cliff_l = poly([(0, 100), (22, 94), (44, 98), (70, 108), (94, 114), (106, 128), (110, 158), (0, 158)])
cliff_r = poly([(384, 92), (366, 96), (352, 102), (340, 114), (334, 128), (331, 158), (384, 158)])
for m, sd in ((cliff_l, 21), (cliff_r, 22)):
    crag(m, ['#070611', '#0a0817', '#100d22', '#17142e', '#1e1a3a'], scale=7, seed=sd, rough=0.9)
    cv.paint(m & ~roll(m, 1, 0), '#3d3363')
forest_l = forest_on(cliff_l, 0, 100, 10, 22, 4, col='#0c1418', lit='#24403f', gap=(2.6, 5.0))
forest_r = forest_on(cliff_r, 338, 384, 12, 24, 5, col='#0c1418', lit='#24403f', gap=(2.6, 5.0))
falls = []
for fx_, w0, w1 in [(103, 5, 9), (348, 5, 9)]:
    cliff = cliff_l if fx_ < 200 else cliff_r
    top = ground_y(cliff, fx_) / S + 1                 # the fall leaves from the cliff's own edge
    fm = poly([(fx_ - w0 / 2, top), (fx_ + w0 / 2, top), (fx_ + w1 / 2, 156), (fx_ - w1 / 2, 156)])
    st = N(2, fx_, 2, stretch=(0.35, 5))
    cv.paint(fm, '#6b6496')
    cv.paint(fm & (st > 0.45), '#8a83b3')
    cv.paint(fm & (st > 0.6), '#a9a2cc')
    cv.paint(fm & (st > 0.72), '#d6cde6')
    cv.paint(fm & (~roll(fm, 0, 1) | ~roll(fm, 0, -1)), '#574a80')
    cv.paint(fm & (yy < (top + 2) * S), '#d6cde6')
    foam = cv.ellipse_mask(fx_ * S, 156 * S, w1 * S, 3 * S) & (N(1, fx_ + 1) > 0.4)
    cv.paint(foam, '#a9a2cc')
    cv.paint(foam & (B < 0.3), '#d6cde6')
    fm_all = fm | foam
    lab_, n_ = ndimage.label(fm_all)
    if n_ > 1:
        sizes_ = np.bincount(lab_.ravel()); sizes_[0] = 0
        fm_all = lab_ == np.argmax(sizes_)
    falls.append(fm_all)

# ================= 4. LAKE =================
lake = yy >= LAKE
ry = np.clip(2 * LAKE - yy - 1, 0, H - 1)
mw_ = np.clip(0.5 - (yy - LAKE) / (60 * S) * 0.35, 0.12, 0.5)[..., None]
cv.rgb[lake] = (cv.rgb[ry, xx] * mw_ + C('#0c0a1e') * (1 - mw_))[lake]
rip = N(3, 40, 3, stretch=(9, 1))
cv.paint(lake & (rip > 0.66), '#1a1636')
cv.paint(lake & (rip > 0.76), '#241f48')
cv.paint(lake & (rip < 0.3), '#0c0a1e')
cv.paint((yy >= LAKE) & (yy < LAKE + S) & ~(cliff_l | cliff_r), '#2c2452')

# ================= 5. THE CASTLE (detailing kit) =================
from objects import Kit
AX = 160 * S
island = poly([(166, 160), (174, 151), (186, 144), (204, 139), (232, 136), (270, 135), (296, 139), (312, 146),
               (322, 154), (326, 160)])
crag(island, ['#070611', '#0a0817', '#100d22', '#17142e'], scale=5, seed=60, rough=0.8)
cv.paint(island & ~roll(island, 1, 0), '#2f2a58')
kit = Kit(cv, light=(MX, MY - 40 * S))
STONE = ['#070611', '#100d22', '#17142e', '#1e1a3a', '#2f2a58', '#3a3468']
STONE_FAR = ['#0a0817', '#17142e', '#1e1a3a', '#262248', '#2f2a58', '#3a3468']
SLATE = ['#050410', '#0a0817', '#100d22', '#1e1a3a', '#2f2a58', '#3a3468']
castle = np.zeros((H, W), bool)
roofs = np.zeros((H, W), bool)
wins = np.zeros((H, W), bool)
flame_pts, banners, pennants, chimneys = [], [], [], []
Xs = lambda v: v * S


def add(d):
    global castle, roofs
    for k, m in d.items():
        if isinstance(m, np.ndarray):
            castle |= m
            if k == 'roof':
                roofs |= m


def win(x, y, w, h, kind='lancet', spill=0.08, frame=STONE):
    global wins
    m = kit.window(Xs(x), Xs(y), int(w * S), int(h * S), frame, kind=kind, spill=spill)
    wins |= m
    return m


# --- back towers (smaller stones = farther)
for (cx, base, w, h, rh, sd) in [(186, 150, 9, 34, 16, 1), (304, 150, 9, 36, 17, 2)]:
    t = kit.round_tower(Xs(cx), Xs(base), Xs(w), Xs(h), STONE_FAR, roof=SLATE, roof_h=Xs(rh), seed=sd, slits=1)
    add(t); pennants.append(t['tip'])
    win(cx - 1, base - h + 8, 2, 5)

# --- great hall: wall with buttresses between tall traceried windows, tiled roof, chimney
hall = rect(204, 106, 236, 140)
kit.masonry(hall, STONE, bw=6, bh=3, seed=10, shift=kit.ao_shift(hall, 10, 1.0))
hall_roof = poly([(202, 106), (238, 106), (231, 90), (209, 90)])
kit.roof_tiles(hall_roof, SLATE, tw=5, th=3, seed=11, axis_x=Xs(220))
cv.paint(kit.edge(hall_roof, 0, 1), SLATE[0])
cv.paint(hall & (yy < Xs(106) + 3), STONE[0])                                     # eave shadow
add(dict(body=hall, roof=hall_roof))
for i, wx in enumerate((207.5, 214.5, 221.5, 228.5)):
    win(wx, 112, 3, 14, spill=0.06)
for bx in (211.5, 218.5, 225.5):
    castle |= kit.buttress(Xs(bx), Xs(140), 3 * S - 1, Xs(16), STONE, seed=12)
chim = rect(226, 84, 230, 96)
kit.masonry(chim, STONE, bw=4, bh=3, seed=13)
cv.paint(rect(225.5, 83, 230.5, 85), STONE[4])
castle |= chim; chimneys.append((Xs(228), Xs(83)))

# --- flanking round towers
for (cx, base, w, h, rh, sd) in [(197, 146, 13, 48, 22, 3), (284, 146, 13, 46, 22, 4)]:
    t = kit.round_tower(Xs(cx), Xs(base), Xs(w), Xs(h), STONE, roof=SLATE, roof_h=Xs(rh), seed=sd, slits=2)
    add(t); pennants.append(t['tip'])
    win(cx - 1.5, base - h + 10, 3, 7, spill=0.08)
    win(cx - 1.5, base - h + 26, 3, 6, spill=0.06)
    kit.ivy(t['body'] & (yy > Xs(base - 14)), density=0.9, seed=sd)

# --- right wing between keep and right tower
wing = rect(266, 112, 278, 140)
kit.masonry(wing, STONE, bw=5, bh=3, seed=14, shift=kit.ao_shift(wing, 8, 1.0))
wing_roof = poly([(265, 112), (279, 112), (272, 100)])
kit.roof_tiles(wing_roof, SLATE, tw=4, th=3, seed=15, axis_x=Xs(272))
add(dict(body=wing, roof=wing_roof))
win(268.5, 118, 2.5, 7); win(273.5, 118, 2.5, 7)

# --- the keep: square body, corner turrets, belt course, corbelled cornice, spire with a teal dormer
keep = rect(240, 72, 262, 140)
plane = np.where(xx > Xs(251), 0.5, -0.3) * 1.0                                 # moon side a little lighter
kit.masonry(keep, STONE, bw=6, bh=3, seed=20, shift=plane + kit.ao_shift(keep, 10, 1.0))
cv.paint(kit.edge(keep, 1, 0), STONE[-1]); cv.paint(kit.edge(keep, -1, 0), STONE[0])
belt = rect(239, 96, 263, 99)
kit.masonry(belt, STONE, bw=4, bh=3, seed=21, base=3)
cv.paint(belt & (yy == Xs(96)), STONE[-1])
cv.paint(keep & (yy >= Xs(99)) & (yy < Xs(99) + 2), STONE[0])                    # the belt's shadow
cornice = rect(238, 67, 264, 72)
cv.paint(cornice, STONE[3])
cv.paint(cornice & (yy == Xs(67)), STONE[-1])
cv.paint(cornice & (yy >= Xs(69)) & (((xx // S) % 2) == 0), STONE[0])             # corbels
cv.paint(keep & (yy < Xs(72) + 3), STONE[0])
spire = kit.cone(Xs(251), Xs(67), Xs(24), Xs(53), flare=2, bell=0.12)
kit.roof_tiles(spire, SLATE, tw=4, th=3, seed=22, axis_x=Xs(251))
fin = rect(250.5, 6, 251.5, 15)
cv.paint(fin, STONE[2]); cv.paint(cv.ellipse_mask(Xs(251), Xs(9), 1.6 * S, 1.6 * S), STONE[4])
dormer = poly([(247.5, 44), (254.5, 44), (251, 38)]) | rect(248, 44, 254, 50)
cv.paint(dormer, STONE[2]); cv.paint(kit.edge(dormer, 1, 0), STONE[-1])
teal_win = kit.window(Xs(249.5), Xs(42), 3 * S, 7 * S, STONE, kind='lancet',
                      glass=['#123a44', '#1e5a64', '#2f8f94', '#5fd4c8', '#b4fff0', '#b4fff0'])
add(dict(body=keep | belt | cornice | dormer | fin, roof=spire))
for tx in (235.5, 266.5):
    t = kit.round_tower(Xs(tx), Xs(126), Xs(6), Xs(46), STONE, roof=SLATE, roof_h=Xs(22), seed=int(tx), corbels=True, slits=1)
    add(t)
big = win(248.5, 101, 5, 12, spill=0.12)
cv.paint(rect(250.5, 103, 251.5, 113), '#5a2a1c'); cv.paint(rect(248.5, 107, 253.5, 108), '#5a2a1c')
balcony = rect(246, 114, 256, 116)
cv.paint(balcony, STONE[4]); cv.paint(rect(246, 116, 256, 117), STONE[0])
for bx in np.arange(246.5, 256, 1.5):
    cv.paint(rect(bx, 112, bx + 0.6, 114), STONE[3])
cv.paint(rect(245.5, 111.5, 256.5, 112.3), STONE[4])
castle |= balcony
for (x, y) in [(243, 78), (256.5, 78), (243.5, 121), (256, 121), (243, 86), (256.5, 86)]:
    win(x, y, 2.5, 6, spill=0.05)

# --- curtain wall + gatehouse with torches and banners
cw = kit.wall(Xs(180), Xs(312), Xs(132), Xs(152), STONE, seed=30, merlon_w=4, gap=3, slits=8)
add(cw)
gh = rect(238, 120, 264, 152)
kit.masonry(gh, STONE, bw=6, bh=3, seed=31, shift=np.where(xx > Xs(251), 0.4, -0.2) + kit.ao_shift(gh, 10, 1.0))
gm = rect(237, 116, 265, 120) & ((((xx // S) - 237) % 4) < 2)
kit.masonry(gm, STONE, bw=4, bh=3, seed=32)
cv.paint(gm & (yy == Xs(116)), STONE[-1])
cv.paint(gh & (yy < Xs(120) + 2), STONE[0])
cv.paint(kit.edge(gh, 1, 0), STONE[-1]); cv.paint(kit.edge(gh, -1, 0), STONE[0])
g = kit.gate(Xs(251), Xs(152), Xs(11), Xs(18), STONE)
add(dict(body=gh | gm))
for tx in (241.5, 260.5):
    cv.paint(rect(tx - 0.5, 136, tx + 0.5, 141), '#1c110d')                       # torch bracket
    cv.paint(rect(tx - 1, 135, tx + 1, 136), '#3d281c')
    flame_pts.append((Xs(tx), Xs(135)))
for bx in (231, 266):
    m_, em_ = kit.banner(Xs(bx), Xs(124), 5 * S, 15 * S)
    banners.append((m_, em_)); castle |= m_
kit.ivy((cw['body'] | gh) & (yy > Xs(142)), density=1.0, seed=33)

# cast shadow of the keep on the hall roof / wall top (moon behind -> shadows fall forward)
cv.rgb[(hall | cw['body'] | hall_roof) & (np.abs(xx - Xs(251)) < Xs(16)) & ~kit.emissive] *= 0.75
emissive |= kit.emissive
wins |= kit.emissive & ~(teal_win | g['hole'])
gate_door = g['hole']

# steps down to the dock
steps = np.zeros((H, W), bool)
for i in range(4):
    steps |= rect(244 - i, 152 + i * 2, 258 + i, 154 + i * 2)
steps &= island | (yy < AX)
kit.masonry(steps, STONE, bw=5, bh=2, seed=40, base=3)
cv.paint(steps & ~roll(steps, 1, 0), STONE[-1])
dock = rect(236, 158, 266, 160) | rect(237, 160, 238, 164) | rect(264, 160, 265, 164)
kit.planks(dock, ['#1c110d', '#2a1a14', '#3d281c', '#55382a'], ph=2, vertical=True)
cv.paint(rect(236, 158, 266, 159), '#55382a')

# bridge: right tower -> right cliff, voussoir arches, parapet, two lamps
bx0, deck_y = 290, 138
bridge = rect(bx0, deck_y, 333, deck_y + 4)
for i in range(3):
    cx = 298 + i * 12
    bridge |= rect(cx - 6, deck_y + 4, cx + 6, 158) & ~cv.ellipse_mask(cx * S, 158 * S, 4.5 * S, 12 * S)
bridge &= ~cliff_r | (yy < deck_y * S + 4 * S)
kit.masonry(bridge, STONE, bw=5, bh=3, seed=41, shift=kit.ao_shift(bridge, 6, 0.8))
cv.paint(bridge & ~roll(bridge, 1, 0), STONE[-1])
par = rect(bx0, deck_y - 2, 333, deck_y) & ((xx // S) % 3 != 0)
cv.paint(par, STONE[3]); cv.paint(par & (yy == Xs(deck_y - 2)), STONE[-1])
lamps = np.zeros((H, W), bool)
for lx in (300, 316):
    cv.paint(rect(lx, deck_y - 8, lx + 1, deck_y), '#070611')
    cv.paint(rect(lx - 1, deck_y - 10, lx + 2, deck_y - 7), '#17142e')
    lm = rect(lx, deck_y - 9, lx + 1, deck_y - 8)
    cv.paint(lm, '#ffc86a'); lamps |= lm
emissive |= lamps
for (px_, py_) in pennants:
    pm = kit.pennant(px_ + 1, py_ - 1, length=4 * S, height=2 * S)
    castle |= pm

# ================= 6. REFLECTIONS + MOON PATH =================
obj = castle | island | bridge
refl = np.zeros((H, W), bool); lrefl = np.zeros((H, W), bool)
for y in range(AX, H):
    sy = 2 * AX - y
    if sy < 0:
        continue
    fade = (y - AX) / (H - AX)
    keep_ = (rip[y] > 0.22 + 0.5 * fade) & (((y // S) % 2 == 0) | (fade < 0.25))
    refl[y] = obj[sy] & keep_
    lrefl[y] = (wins | lamps | gate_door)[sy] & (rip[y] > 0.45) & ((y // S) % 2 == 0)
cv.paint(refl & lake, '#070611')
moon_path = np.zeros((H, W), bool)
for y in range(LAKE + S, H):
    v = (y - LAKE) / (H - LAKE)
    half = (10 + v * 36) * S
    row = (np.abs(xx[y] - MX) < half * (0.55 + 0.45 * rip[y])) & (rip[y] > 0.44) & (((y // S) % 2 == 0) | (rip[y] > 0.6))
    cv.rgb[y][row & ~refl[y]] = C('#a99cc6')
    core = row & (np.abs(xx[y] - MX) < half * 0.4) & (rip[y] > 0.6) & (y > AX + 10 * S)
    cv.rgb[y][core] = C('#ebe0c4')
    moon_path[y] = row
cv.paint(lrefl & lake, '#c8642a')
cv.paint(lrefl & lake & (rip > 0.6), '#f09a3e')

# ================= 7. FOREGROUND =================
ledge = poly([(0, 170), (18, 165), (40, 167), (66, 163), (92, 169), (118, 177), (140, 189), (152, 216), (0, 216)])
crag(ledge, ['#050410', '#070611', '#0f0d18', '#15121f'], scale=9, seed=70, rough=0.7)
seam = ledge & (np.abs(N(8, 71, 2) - 0.5) < 0.018)
cv.paint(seam, '#050410')
cv.paint(ledge & roll(seam, 1, 0) & ~seam, '#211c2e')
top = ledge & ~roll(ledge, 1, 0)
cv.paint(top | (ledge & ~roll(ledge, 2 * S, 0) & (xx > 30 * S)), '#2f2840')
cv.paint(top & (xx > 60 * S), '#574c74')
moss_top = ledge & ~roll(ledge, 4 * S, 0) & (N(1.2, 73) > 0.45)
cv.paint(moss_top, '#0c1418'); cv.paint(moss_top & ~roll(moss_top, 1, 0), '#24403f')

# the twisted tree, rooted in the ledge
tree = np.zeros((H, W), bool)
TX = 127                                   # on the ledge's shoulder: its silhouette reads against the lake
TY = ground_y(ledge, TX) / S + 3          # roots sink into the rock


def branch(x0, y0, ang, length, width, depth, seed):
    global tree
    rr = np.random.default_rng(seed)
    x, y = x0, y0
    pts = [(x, y)]
    for i in range(int(length)):
        ang += rr.uniform(-0.16, 0.16)
        x += np.cos(ang); y += np.sin(ang)
        pts.append((x, y))
    for i in range(len(pts) - 1):
        wdt = max(1, width * (1 - 0.6 * i / len(pts)))
        tree |= cv.line_mask([(pts[i][0] * S, pts[i][1] * S), (pts[i + 1][0] * S, pts[i + 1][1] * S)], width=int(round(wdt * S)))
    if depth > 0:
        for k in range(2 + (depth > 1)):
            i = int(len(pts) * rr.uniform(0.35, 0.92))
            bx, by = pts[i]
            branch(bx, by, ang + rr.choice([-1, 1]) * rr.uniform(0.35, 0.95), length * rr.uniform(0.4, 0.62),
                   width * 0.55, depth - 1, seed * 3 + k + 1)


branch(TX, TY, -1.75, 60, 5.0, 4, 7)
branch(TX + 1, TY - 22, -0.55, 48, 3, 3, 8)
branch(TX - 1, TY - 14, -2.5, 26, 2.2, 2, 9)
tree |= poly([(TX - 8, TY), (TX + 9, TY), (TX + 14, TY + 3), (TX - 13, TY + 3)]) & ledge   # root flare on the rock
tree &= yy < H
cv.paint(tree, '#050410')
cv.paint(tree & (N(0.8, 95, 2, stretch=(0.3, 2.5)) > 0.6), '#0f0d18')
cv.paint(tree & ~roll(tree, 0, -1), '#15121f')
cv.paint(tree & ~roll(tree, 0, -1) & (dist < 200 * S), '#2f2840')     # moon-side rim
moss = np.zeros((H, W), bool)
ys_, xs_ = np.nonzero(tree & (yy < 150 * S) & ~roll(tree, -1, 0))
r = np.random.default_rng(5)
for i in r.choice(len(xs_), 60, replace=False):
    x, y = xs_[i], ys_[i]
    moss |= cv.line_mask([(x, y), (x + r.uniform(-2, 2), y + r.integers(4, 16) * S)], 1)
moss &= ~tree & ~ledge
cv.paint(moss, '#122026'); cv.paint(moss & (N(0.6, 96) > 0.6), '#24403f')

# carved stone lantern standing ON the ledge
LXd = 58
LYd = ground_y(ledge, LXd) / S + 1
lan_parts = [rect(LXd - 7, LYd - 2, LXd + 7, LYd + 1), rect(LXd - 5, LYd - 4, LXd + 5, LYd - 2), rect(LXd - 2, LYd - 15, LXd + 2, LYd - 4),
             rect(LXd - 5, LYd - 17, LXd + 5, LYd - 15), rect(LXd - 6, LYd - 27, LXd + 6, LYd - 17),
             poly([(LXd - 10, LYd - 27), (LXd + 10, LYd - 27), (LXd + 6, LYd - 31), (LXd - 6, LYd - 31)]),
             poly([(LXd - 6, LYd - 31), (LXd + 6, LYd - 31), (LXd, LYd - 35)]), rect(LXd - 1, LYd - 38, LXd + 1, LYd - 35),
             cv.ellipse_mask(LXd * S, (LYd - 39) * S, 1.6 * S, 1.6 * S)]
lan = np.zeros((H, W), bool)
for pm in lan_parts:
    lan |= pm
contact_shadow(ledge, LXd * S, LYd * S, 16)
crag(lan, ['#211c2e', '#2f2840', '#40375a', '#574c74'], scale=2, seed=90)
cv.paint(lan & ~roll(lan, 0, -1) & (xx > LXd * S), '#7a6e98')
cv.paint(lan & ~roll(lan, 1, 0), '#7a6e98')
cv.paint(lan & ~roll(lan, 0, 1), '#0f0d18')
cage = rect(LXd - 4, LYd - 25, LXd + 4, LYd - 18)
cv.paint(cage, '#2a120e')
cv.paint(lan & (N(1, 91) > 0.62) & (yy > (LYd - 15) * S), '#122026')
flame_base = (LXd * S, (LYd - 18.5) * S)
emissive |= cage

# glowing mushrooms on the ledge surface, at the tree's roots
mush_caps = np.zeros((H, W), bool)
r = np.random.default_rng(31)
for mxd in [16, 22, 40, 70, 96, 120, 133, 137]:
    gy = ground_y(ledge, mxd) / S + 0.5
    hh = r.uniform(2, 4)
    stem = rect(mxd, gy - hh, mxd + 0.6, gy)
    cap = cv.ellipse_mask((mxd + 0.3) * S, (gy - hh) * S, 1.8 * S, 1.0 * S) & (yy <= (gy - hh) * S)
    cv.paint(stem, '#b4fff0'); cv.paint(cap, '#2f8f94'); cv.paint(cap & ~roll(cap, 1, 0), '#5fd4c8')
    mush_caps |= cap
emissive |= mush_caps
# ferns rooted inside the ledge
ferns = np.zeros((H, W), bool)
for i in range(14):
    fx_ = r.uniform(70, 135)
    gy = ground_y(ledge, fx_)
    if gy is None:
        continue
    fy_ = gy / S + r.uniform(4, 30)
    for k in range(5):
        a = -np.pi / 2 + (k - 2) * 0.45
        ln = r.uniform(5, 9)
        ferns |= cv.line_mask([(fx_ * S, fy_ * S), ((fx_ + np.cos(a) * ln) * S, (fy_ + np.sin(a) * ln * 0.8) * S)], 1)
ferns &= ledge
cv.paint(ferns, '#0c1418'); cv.paint(ferns & ~roll(ferns, 1, 0), '#24403f')

# lantern boat on open water, lily pads that never touch the boat or the rock
BX, BY = 186, 190
hull = poly([(BX - 12, BY), (BX + 12, BY), (BX + 9, BY + 4), (BX - 9, BY + 4)])
boat_lamp = rect(BX + 3.5, BY - 9, BX + 5.5, BY - 6)
boat = hull | rect(BX + 7, BY - 9, BX + 8, BY) | rect(BX + 4, BY - 10, BX + 8, BY - 9)
cv.paint(boat, '#1c110d')
cv.paint(hull & ~roll(hull, 1, 0), '#3d281c')
cv.paint(hull & ((yy // S) % 2 == 1) & (yy > BY * S + S), '#2a1a14')
cv.paint(boat_lamp, '#ffc86a')
emissive |= boat_lamp
boat_refl = np.zeros((H, W), bool)
for y in range(int((BY + 4) * S), min(H, int((BY + 15) * S))):
    sy = 2 * (BY + 4) * S - y
    if 0 <= sy < H:
        boat_refl[y] = (boat | boat_lamp)[sy] & (rip[y] > 0.35)
cv.paint(boat_refl & ~boat, '#070611')
lamp_refl = np.zeros((H, W), bool)
for y in range(int((BY + 5) * S), int((BY + 16) * S), 2):
    lamp_refl[y] = (np.abs(xx[y] - (BX + 4.5) * S) < 1.5 * S) & (rip[y] > 0.3)
cv.paint(lamp_refl & ~boat, '#c8642a')
keep_out = ndimage.binary_dilation(ledge | boat | boat_refl, iterations=3 * S)
pads = np.zeros((H, W), bool)
teal_flowers = np.zeros((H, W), bool)
r = np.random.default_rng(21)
tries = 0
while tries < 40:
    tries += 1
    px_, py_ = r.uniform(100, 230), r.uniform(168, 212)
    rw = r.uniform(2.5, 4.5)
    pad = cv.ellipse_mask(px_ * S, py_ * S, rw * S, rw * 0.45 * S)
    if (pad & (keep_out | pads | ~lake)).any():
        continue
    pad &= ~poly([(px_, py_), (px_ + rw, py_ - 0.6), (px_ + rw, py_ + 0.6)])
    pads |= pad
    if r.random() < 0.45:
        f = cv.ellipse_mask((px_ - rw * 0.3) * S, (py_ - 0.8) * S, 1.2 * S, 0.8 * S)
        teal_flowers |= f
cv.paint(pads, '#122026')
cv.paint(pads & ~roll(pads, 1, 0), '#35584f')
cv.paint(pads & ~roll(pads, -1, 0), '#05080b')
cv.paint(teal_flowers, '#5fd4c8')
emissive |= teal_flowers
# reeds growing out of the water at the right edge
reeds = np.zeros((H, W), bool); heads = np.zeros((H, W), bool)
for i in range(70):
    x = r.uniform(300, 384); h = r.uniform(10, 34); lean = r.uniform(-4, 4)
    reeds |= cv.line_mask([(x * S, H), ((x + lean) * S, (216 - h) * S)], 1 if r.random() < 0.6 else 2)
    if r.random() < 0.3:
        heads |= rect(x + lean - 0.7, 216 - h - 3.5, x + lean + 0.7, 216 - h)
reeds |= heads
cv.paint(reeds, '#05080b')
cv.paint(reeds & ~roll(reeds, 0, 1), '#122026')
cv.paint(heads, '#1c110d'); cv.paint(heads & ~roll(heads, 0, 1), '#3d281c')

# ================= 8. LIGHT, SHADOW, CINEMA =================
cv.lit_colors('#f09a3e', steps=(0.1, 0.22, 0.38))
cv.lit_colors('#5fd4c8', steps=(0.12, 0.25))
# moon rays over sky / far layers only (not over the castle or the foreground)
ray_m = (ray_t > B * 0.9) & ~castle & (yy < 156 * S) & ~(cliff_l | cliff_r) & ~moon
cv.rgb[ray_m] = cv.rgb[ray_m] + (C('#8e86c0') - cv.rgb[ray_m]) * 0.22
# light pools
cv.glow(flame_base[0], flame_base[1] - 2 * S, 40 * S, '#f09a3e', strength=0.34, dither=0.06, squash=0.8)
cv.glow(251 * S, 108 * S, 16 * S, '#c8642a', strength=0.22, dither=0.0)
cv.glow(251 * S, 146 * S, 16 * S, '#c8642a', strength=0.26, dither=0.0, squash=0.6)
cv.glow(218 * S, 118 * S, 18 * S, '#c8642a', strength=0.16, dither=0.0)
cv.glow((BX + 4.5) * S, (BY - 7.5) * S, 14 * S, '#f09a3e', strength=0.3, dither=0.0)
cv.glow(34 * S, 170 * S, 16 * S, '#5fd4c8', strength=0.2, dither=0.0, squash=0.6)
cv.glow(251 * S, 41 * S, 9 * S, '#5fd4c8', strength=0.3, dither=0.0)
# vignette + darkened lower frame: cinematic falloff, lights stay bright
vx = (xx - W / 2) / (W / 2); vy = (yy - H * 0.42) / (H * 0.62)
vig = np.clip(1 - 0.5 * (vx ** 2 + vy ** 2) ** 1.3, 0.45, 1)
vig = vig * np.clip(1 - np.clip((yy - 190 * S) / (26 * S), 0, 1) * 0.25, 0, 1)
dark = ~emissive & ~ndimage.binary_dilation(emissive, iterations=S)
cv.rgb[dark] *= vig[dark][:, None]

# ================= 9. CLEAN-UP (artifact_check) =================
from artifact_check import clean
art = cv.snap()
stars_zone = (yy < 100 * S) & ~castle & ~cl
protect = ndimage.binary_dilation(emissive, iterations=1) | stars_zone
art = clean(art, protect=protect, passes=2)
cv.rgb = art.astype(float)
cv.save('stage4/still', scale=OUT_SCALE)
img = Image.open('stage4/still_native.png')
img.save('stage4/native.png')
img.resize((W * OUT_SCALE, H * OUT_SCALE), Image.NEAREST).save('stage4/big.png')
np.savez_compressed('stage4/masks.npz', falls0=falls[0], falls1=falls[1], lake=lake, moon_path=moon_path,
                    wins=wins & ~teal_win, wins_teal=teal_win, lamps=lamps | boat_lamp, lrefl=lrefl | lamp_refl,
                    moss=moss, reeds=reeds, tree=tree, cloud=cl, moon=moon, mush=mush_caps, teal_flowers=teal_flowers,
                    ferns=ferns, boat=boat | boat_refl, ledge=ledge, castle=castle, island=island | steps | dock,
                    banner0=banners[0][0], emb0=banners[0][1], banner1=banners[1][0], emb1=banners[1][1],
                    flames=np.array(flame_pts), chimneys=np.array(chimneys), pennants=np.array(pennants))
np.save('stage4/flame.npy', np.array(flame_base))
print('ok', W, H)
