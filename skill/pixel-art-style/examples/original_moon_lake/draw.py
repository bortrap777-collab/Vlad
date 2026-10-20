"""'Moon Lake' v2 — the same mysterious night landscape, drawn at twice the grid
(768x432 art px) with much more detail: moonlit crags shaded from a height field,
pine forests tree by tree, castle ruins on the far mountain, a gothic tower with
buttresses / lancet windows / slate roofs / ivy, a stone bridge, a lantern boat,
lily pads, a carved stone lantern, a twisted tree with bark and hanging moss,
glowing mushrooms and ferns in the foreground.
All coordinates below are DESIGN units (384x216); S converts them to art px."""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'scripts'))
from pixel_canvas import Canvas, BAYER4
from fx import tile_noise

S = 2
W, H = 384 * S, 216 * S
OUT_SCALE = 2
os.makedirs('stage2', exist_ok=True)

PAL = [
    '#0b0918', '#110e24', '#181431', '#211b40', '#2c2452', '#3a2f63', '#4b3d75', '#5e4d86',     # sky
    '#2a2348', '#3d3363', '#574a80', '#7d6fa3', '#a99cc6', '#d6cde6', '#070611',                # clouds
    '#fff9ec', '#f6efdc', '#ebe0c4', '#d9caa8', '#c4b393', '#a8977c',                           # moon
    '#5a5290', '#463f78', '#3a3468', '#2f2a58', '#262248', '#1e1a3a', '#17142e', '#100d22', '#0a0817',  # rock/mountain
    '#6a62a0', '#8e86c0', '#b8b0dc',                                                            # moonlit rims
    '#6b6496', '#8a83b3', '#a9a2cc',                                                            # mist / falls
    '#120f28', '#1a1636', '#241f48', '#30295a',                                                 # water
    '#070c10', '#0c1418', '#122026', '#1a2e32', '#24403f', '#35584f', '#4c7465',                # foliage
    '#15121f', '#211c2e', '#2f2840', '#40375a', '#574c74', '#7a6e98',                           # stone
    '#3a1c16', '#5a2a1c', '#8c3d1e', '#c8642a', '#f09a3e', '#ffc86a', '#ffeab0',                # warm
    '#123a44', '#1e5a64', '#2f8f94', '#5fd4c8', '#b4fff0',                                      # teal magic
    '#2a1a14', '#3d281c', '#55382a',                                                            # wood
]
cv = Canvas(W, H, PAL)
yy, xx = cv.yy, cv.xx
C = cv.c
B = BAYER4[yy % 4, xx % 4]


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


MX, MY, MR = 252 * S, 66 * S, 31 * S          # moon (art px)
LX_, LY_ = np.sign(MX - xx), np.sign(MY - yy)  # per-pixel direction to the moon


def crag(mask, ramp, scale=6, seed=0, light=None, rough=1.0, rim=None):
    """Rock / mountain shading from a fake height field: brighter where the surface
    tilts toward the light. ramp dark -> light (palette hex). Gives craggy faces
    instead of flat silhouettes."""
    h = N(scale, seed, 4)
    h2 = N(scale * 0.35, seed + 1, 2)
    h = h + 0.35 * h2 * rough
    lx, ly = light if light is not None else (MX, MY)
    gx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    gy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    dx = np.sign(lx - xx); dy = np.sign(ly - yy) * 0.6
    lam = -(gx * dx + gy * dy) * 8
    vals = lam[mask]
    if not len(vals):
        return
    n = len(ramp)
    cuts = np.quantile(vals, np.linspace(0, 1, n + 1)[1:-1] ** 0.85)
    idx = np.searchsorted(cuts, lam)
    for i, col in enumerate(ramp):
        cv.paint(mask & (idx == i), col)
    if rim:
        top = mask & ~roll(mask, 1, 0)
        cv.paint(top, rim)


# ============ 1. SKY ============
cv.vgradient(0, 150 * S, ['#0b0918', '#110e24', '#181431', '#211b40', '#2c2452', '#3a2f63', '#4b3d75', '#5e4d86'], band=0.3)
cv.lit_colors('#a99cc6', steps=(0.12, 0.25))
# a faint band of the milky way, diagonal, dithered
mw = np.clip(1 - np.abs((yy - (40 * S - xx * 0.18)) / (16 * S)), 0, 1) * N(10, 2, 3) * (xx < 200 * S)
cv.rgb[(mw * 0.9 > B) & (mw > 0.25)] = C('#2c2452')
cv.glow(MX, MY, 130 * S, '#7d6fa3', strength=0.5, dither=0.08)
cv.glow(MX, MY, 60 * S, '#d6cde6', strength=0.42, dither=0.08)
rng = np.random.default_rng(11)
far = np.hypot(xx - MX, yy - MY) > 75 * S
sky_zone = (yy < 100 * S) & far
cv.stars(sky_zone, ['#5e4d86', '#7d6fa3'], n=420, seed=1)                 # faint dust
cv.stars(sky_zone, ['#d6cde6', '#a99cc6'], n=120, seed=2)
big_stars = [(rng.uniform(10, 380) * S, rng.uniform(4, 70) * S) for _ in range(14)]
for (sx, sy) in big_stars:
    if np.hypot(sx - MX, sy - MY) > 80 * S:
        cv.px(sx, sy, '#fff9ec')
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            cv.px(sx + dx, sy + dy, '#7d6fa3')
# moon with maria, craters and a bright rim on the lit side
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
inner = np.hypot(xx - (MX - 8 * S), yy - (MY - 8 * S)) < MR * 0.5
cv.paint(moon & inner & (mar < 0.5), '#f6efdc')
cv.paint(moon & ~cv._erode(cv._erode(moon)) & (xx < MX - MR * 0.3), '#fff9ec')
cv.paint(moon & ~cv._erode(moon) & (xx > MX + MR * 0.4), '#d9caa8')
sky_before_clouds = cv.rgb.copy()

# ============ 2. CLOUDS lit from the moon ============
cl = cv.clouds(16 * S, 78 * S, ['#2a2348', '#3d3363', '#574a80'], light=None, coverage=0.4, scale=30 * S, seed=4, stretch=1.9)
opening = np.hypot(xx - MX, yy - MY) < MR + (5 + 10 * N(8, 16)) * S
restore = cl & opening
cl &= ~opening
cv.rgb[restore] = sky_before_clouds[restore]
thin = cl & ~ndimage.binary_opening(cl, iterations=2)
cv.rgb[thin] = sky_before_clouds[thin]
cl &= ~thin
dap = N(4, 14, 3)
cv.paint(cl & (dap > 0.68), '#3d3363')
dist = np.hypot(xx - MX, yy - MY)
depth = np.zeros((H, W), int)
for k in range(1, 9):
    depth += cl[np.clip(yy + LY_ * k, 0, H - 1), np.clip(xx + LX_ * k, 0, W - 1)]
band = cl & (depth < 8)
for (dmax, dlim, col) in [(220, 8, '#574a80'), (160, 5, '#7d6fa3'), (110, 3, '#a99cc6'), (80, 1, '#d6cde6')]:
    cv.paint(band & (dist < dmax * S) & (depth < dlim), col)
# underside of clouds: one darker row
cv.paint(cl & ~roll(cl, -1, 0), '#211b40')
wisp = (np.abs(yy - (MY + 12 * S + 3 * S * np.sin(xx / (9 * S)))) < 1.3 * S) & (np.abs(xx - MX) < MR + 22 * S) & (N(6, 15) > 0.42)
cv.paint(wisp & moon, '#c4b393')
cv.paint(wisp & ~moon, '#7d6fa3')

# ============ 3. MOUNTAINS ============
def ridge(y_base, amp, seed, peaks=None, rough=0.55):
    m = np.zeros((H, W), bool)
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
            pts += ph * S * np.exp(-((np.arange(n + 1) - i) / (n * 0.1)) ** 2)
    top = y_base * S - (pts - pts.min())
    tx = top[(np.arange(W) / W * n).astype(int)]
    return yy >= tx[None, :]

far1 = ridge(124, 46, 3, peaks=[(70, 22), (330, 14)])
crag(far1, ['#2f2a58', '#3a3468', '#463f78', '#5a5290'], scale=13, seed=30, rough=0.6)
snow = far1 & (yy < 94 * S) & (N(5, 31) > 0.5)
crag(snow, ['#5a5290', '#6a62a0', '#8e86c0'], scale=6, seed=32, rough=0.6)
cv.paint(far1 & ~roll(far1, 1, 0), '#8e86c0')
# castle ruins on the far left mountain, a few windows still lit
ruin = rect(58, 72, 60, 82) | rect(64, 68, 67, 82) | rect(70, 74, 72, 82) | rect(57, 80, 76, 84) | poly([(64, 68), (67, 68), (65.5, 63)])
cv.paint(ruin, '#262248')
cv.paint(rect(65, 72, 66, 74) | rect(59, 76, 60, 77), '#c8642a')
far2 = ridge(142, 28, 7, peaks=[(40, 10), (362, 16)])
crag(far2, ['#17142e', '#1e1a3a', '#262248'], scale=9, seed=33, rough=0.6)
cv.paint(far2 & ~roll(far2, 1, 0), '#3a3468')

# ============ 4. CLIFFS, FORESTS, FALLS ============
cliff_l = poly([(0, 102), (22, 96), (44, 100), (70, 110), (96, 116), (108, 130), (112, 154), (0, 154)])
cliff_r = poly([(384, 94), (366, 98), (350, 104), (334, 114), (322, 126), (316, 154), (384, 154)])
for m, sd in ((cliff_l, 21), (cliff_r, 22)):
    crag(m, ['#0a0817', '#100d22', '#17142e', '#1e1a3a', '#262248'], scale=7, seed=sd, rough=0.9)
    cv.paint(m & ~roll(m, 1, 0), '#3d3363')


def pine(x, yb, h, col, lit, shade):
    """A pine at art px: tiered, drooping branches, moonlit on the moon side."""
    m = np.zeros((H, W), bool)
    tiers = max(3, int(h / (3 * S)))
    w = h * 0.42
    for t in range(tiers):
        ty = yb - h + t * h / tiers
        tw = w * (0.25 + 0.75 * (t + 1) / tiers) / 2
        m |= cv.poly_mask([(x, ty - 1), (x - tw, ty + h / tiers * 1.5), (x - tw * 0.4, ty + h / tiers * 1.2),
                           (x + tw * 0.4, ty + h / tiers * 1.2), (x + tw, ty + h / tiers * 1.5)])
    m |= cv.rect_mask(x - 0.5 * S, yb - h * 0.15, x + 0.5 * S, yb)
    cv.paint(m, col)
    side = m & ~roll(m, 0, 1 if x < MX else -1)
    cv.paint(side & (yy < yb - h * 0.2), lit)
    cv.paint(m & ~roll(m, 0, -1 if x < MX else 1) & (N(1, 77) > 0.5), shade)
    return m


pines = np.zeros((H, W), bool)
r = np.random.default_rng(4)
for (x0, x1, yb_fn, hmin, hmax, col, lit, shade) in [
        (0, 104, lambda x: (110 - x * 0.06) * S, 10, 22, '#0c1418', '#24403f', '#070c10'),
        (328, 384, lambda x: (106 - (384 - x) * 0.05) * S, 12, 24, '#0c1418', '#24403f', '#070c10'),
        (104, 210, lambda x: 155 * S, 6, 12, '#0c1418', '#1a2e32', '#070c10'),
        (296, 330, lambda x: 153 * S, 7, 12, '#0c1418', '#1a2e32', '#070c10')]:
    x = x0 * S
    while x < x1 * S:
        h = r.uniform(hmin, hmax) * S
        pines |= pine(x, yb_fn(x / S) + r.integers(0, 2 * S), h, col, lit, shade)
        x += r.uniform(2.5, 5.5) * S

falls = []
for (fx, fy0, fy1, w0, w1) in [(100, 118, 155, 5, 9), (326, 122, 155, 5, 9)]:
    fm = poly([(fx - w0 / 2, fy0), (fx + w0 / 2, fy0), (fx + w1 / 2, fy1), (fx - w1 / 2, fy1)])
    st = N(2, fx, 2, stretch=(0.35, 5))
    cv.paint(fm, '#6b6496')
    cv.paint(fm & (st > 0.45), '#8a83b3')
    cv.paint(fm & (st > 0.6), '#a9a2cc')
    cv.paint(fm & (st > 0.72), '#d6cde6')
    edge = fm & (~roll(fm, 0, 1) | ~roll(fm, 0, -1))
    cv.paint(edge, '#574a80')
    lip = fm & (yy < fy0 * S + 2 * S)
    cv.paint(lip, '#d6cde6')
    foam = cv.ellipse_mask(fx * S, fy1 * S, w1 * S, 3 * S) & (N(1, fx + 1) > 0.4)
    cv.paint(foam, '#a9a2cc')
    cv.paint(foam & (B < 0.3), '#d6cde6')
    falls.append(fm | foam)

# ============ 5. LAKE ============
LAKE = 155 * S
lake = yy >= LAKE
ry = np.clip(2 * LAKE - yy - 1, 0, H - 1)
mirror = cv.rgb[ry, xx]
cv.rgb[lake] = mirror[lake] * 0.5 + C('#120f28') * 0.5
rip = N(3, 40, 3, stretch=(9, 1))
cv.paint(lake & (rip > 0.64), '#241f48')
cv.paint(lake & (rip > 0.74), '#30295a')
cv.paint(lake & (rip < 0.3), '#120f28')
cv.paint((yy >= LAKE) & (yy < LAKE + S) & ~pines, '#3d3363')

# ============ 6. ISLAND + TOWER + BRIDGE ============
AX = 160 * S
island = poly([(204, 160), (212, 151), (222, 143), (236, 138), (262, 137), (278, 142), (290, 150), (298, 160)])
crag(island, ['#0a0817', '#100d22', '#17142e', '#1e1a3a'], scale=5, seed=60, rough=0.8)
cv.paint(island & ~roll(island, 1, 0), '#3d3363')
cv.paint(island & (N(1.5, 61) > 0.62) & (yy < AX - 4 * S), '#122026')
cv.paint(island & (N(1.5, 62) > 0.75) & (yy < AX - 4 * S), '#1a2e32')
# steps and a small dock
steps = np.zeros((H, W), bool)
for i in range(6):
    steps |= rect(226 + i * 2, 146 + i * 2, 234 + i * 2, 147 + i * 2)
cv.paint(steps, '#2f2840')
dock = rect(214, 158, 232, 160) | rect(215, 160, 216, 164) | rect(230, 160, 231, 164)
cv.paint(dock, '#3d281c')
cv.paint(rect(214, 158, 232, 159), '#55382a')

tower = np.zeros((H, W), bool)
body = rect(240, 74, 262, 140)
plinth = rect(235, 128, 267, 141)
cornice = rect(237, 70, 265, 75)
spire = poly([(240, 70), (262, 70), (251, 16)])
finial = rect(250.5, 9, 251.5, 17)
belt = rect(236, 96, 266, 99)
tower |= body | plinth | cornice | spire | finial | belt
turrets = np.zeros((H, W), bool)
for tx in (235.5, 266.5):
    turrets |= rect(tx - 3, 80, tx + 3, 128) | poly([(tx - 4, 80), (tx + 4, 80), (tx, 58)])
    turrets |= rect(tx - 0.5, 54, tx + 0.5, 59)
wing = rect(266, 112, 287, 141) | poly([(264, 112), (289, 112), (276.5, 98)])
buttress = np.zeros((H, W), bool)
for bx in (244, 258):
    buttress |= poly([(bx - 1.5, 141), (bx + 1.5, 141), (bx + 1.5, 108), (bx, 104)])
tower |= turrets | wing
cv.paint(tower, '#100d22')
# slate roofs: rows of scallops on the spire, turret caps and wing roof
roofs = (spire | (turrets & (yy < 80 * S)) | (wing & (yy < 112 * S)))
slate = roofs & (((yy // S) % 3 == 0) | (((xx // S) + (yy // (3 * S))) % 4 == 0) & ((yy // S) % 3 == 1))
cv.paint(roofs, '#0a0817')
cv.paint(slate, '#17142e')
# stone courses + block joints on walls
walls = tower & ~roofs
cv.paint(walls & ((yy // S) % 5 == 0), '#0a0817')
cv.paint(walls & ((yy // S) % 5 != 0) & (((xx // S) + ((yy // (5 * S)) % 2) * 3) % 6 == 0), '#0a0817')
cv.paint(buttress, '#17142e')
cv.paint(buttress & ~roll(buttress, 0, 1), '#262248')
# moonlit rims: edges of the silhouette near the halo
edge = tower & ~cv._erode(tower)
near = dist < MR + 50 * S
cv.paint(edge & near, '#2f2a58')
cv.paint(edge & (dist < MR + 8 * S), '#574a80')
cv.paint(cornice & ~roll(cornice, 1, 0), '#262248')
cv.paint(belt & ~roll(belt, 1, 0), '#262248')
# crenellations on the cornice and the wing
for cx in np.arange(237, 265, 3):
    cv.paint(rect(cx, 68, cx + 1.5, 70) & ~spire, '#100d22')
# windows: lancet (pointed) shapes, warm; a teal one at the top (mystery)
wins = np.zeros((H, W), bool)
def lancet(x, y, w, h):
    m = rect(x, y + w / 2, x + w, y + h) | poly([(x, y + w / 2), (x + w, y + w / 2), (x + w / 2, y)])
    return m
win_list = [(248.5, 101, 5, 12), (243, 80, 2.5, 7), (256.5, 80, 2.5, 7), (243.5, 116, 2.5, 7), (256, 116, 2.5, 7),
            (269, 118, 2.5, 6), (275.5, 118, 2.5, 6), (282, 118, 2.5, 6), (234.5, 100, 2, 5), (265.5, 100, 2, 5)]
for (x, y, w, h) in win_list:
    m = lancet(x, y, w, h)
    wins |= m
    cv.paint(m, '#c8642a')
    cv.paint(m & ~roll(m, -1, 0) & ~roll(m, 0, -1), '#f09a3e')
    cv.paint(cv._erode(m), '#f09a3e')
    cv.paint(cv._erode(cv._erode(m)), '#ffc86a')
# tracery mullion in the big window
cv.paint(rect(250.5, 103, 251.5, 113) | rect(248.5, 107, 253.5, 108), '#5a2a1c')
teal_win = lancet(249.5, 40, 3, 7)
cv.paint(teal_win, '#2f8f94')
cv.paint(cv._erode(teal_win), '#5fd4c8')
wins_teal = teal_win
# a door at the base with warm light spilling on the steps
door = lancet(248, 130, 6, 11)
cv.paint(door, '#5a2a1c')
cv.paint(cv._erode(door), '#8c3d1e')
# ivy on the lower walls
ivy = (tower & ~roofs) & (yy > 116 * S) & (N(1.2, 80) > 0.55) & (N(6, 81) > 0.45)
cv.paint(ivy, '#122026')
cv.paint(ivy & ~roll(ivy, 0, 1), '#1a2e32')
# bridge from the wing to the right shore: deck, arches, voussoirs, parapet, lamps
bridge = rect(286, 139, 337, 143)
for i in range(3):
    cx = 296 + i * 16
    bridge |= rect(cx - 8, 143, cx + 8, 153) & ~cv.ellipse_mask(cx * S, 153 * S, 6.5 * S, 8 * S)
cv.paint(bridge, '#100d22')
cv.paint(bridge & ~roll(bridge, 1, 0), '#2f2840')
cv.paint(bridge & ((yy // S) % 3 == 0) & (yy > 143 * S), '#0a0817')
arch_ring = np.zeros((H, W), bool)
for i in range(3):
    cx = 296 + i * 16
    e1 = cv.ellipse_mask(cx * S, 153 * S, 7.5 * S, 9 * S); e2 = cv.ellipse_mask(cx * S, 153 * S, 6.5 * S, 8 * S)
    arch_ring |= e1 & ~e2 & (yy < 153 * S)
cv.paint(arch_ring, '#1e1a3a')
cv.paint(rect(286, 137, 337, 139) & ((xx // S) % 3 != 0), '#17142e')
lamp_pts = []
for bx in (294, 310, 326):
    cv.paint(rect(bx, 131, bx + 1, 137), '#0a0817')
    cv.paint(rect(bx - 1, 129, bx + 2, 132), '#17142e')
    cv.paint(rect(bx, 130, bx + 1, 131), '#ffc86a')
    lamp_pts.append((bx + 0.5, 130.5))
lamps_bridge = np.zeros((H, W), bool)
for bx, by in lamp_pts:
    lamps_bridge |= rect(bx - 0.5, by - 0.5, bx + 0.5, by + 0.5)

# ============ 7. REFLECTIONS + MOON PATH ============
obj = tower | island | bridge
refl = np.zeros((H, W), bool)
lrefl = np.zeros((H, W), bool)
for y in range(AX, H):
    sy = 2 * AX - y
    if sy < 0:
        continue
    fade = (y - AX) / (H - AX)
    keep = (rip[y] > 0.22 + 0.5 * fade) & (((y // S) % 2 == 0) | (fade < 0.25))
    refl[y] = obj[sy] & keep
    lrefl[y] = (wins | lamps_bridge | door)[sy] & (rip[y] > 0.45)
cv.paint(refl & lake, '#100d22')
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

# lily pads with teal flowers near the left shore; a lantern boat on the lake
pads = np.zeros((H, W), bool)
r = np.random.default_rng(21)
flowers = []
for i in range(16):
    px_, py_ = r.uniform(110, 200), r.uniform(172, 212)
    rw = r.uniform(2.5, 4.5)
    pad = cv.ellipse_mask(px_ * S, py_ * S, rw * S, rw * 0.45 * S)
    notch = poly([(px_, py_), (px_ + rw, py_ - 0.6), (px_ + rw, py_ + 0.6)])
    pads |= pad & ~notch
    if r.random() < 0.45:
        flowers.append((px_ - rw * 0.3, py_ - 0.8))
cv.paint(pads, '#1a2e32')
cv.paint(pads & ~roll(pads, 1, 0), '#35584f')
cv.paint(pads & ~roll(pads, -1, 0), '#0c1418')
teal_flowers = np.zeros((H, W), bool)
for fx_, fy_ in flowers:
    m = cv.ellipse_mask(fx_ * S, fy_ * S, 1.2 * S, 0.8 * S)
    teal_flowers |= m
    cv.paint(m, '#5fd4c8')
    cv.px(fx_ * S, fy_ * S - 1, '#b4fff0')
# boat
BX, BY = 176, 186
hull = poly([(BX - 12, BY), (BX + 12, BY), (BX + 9, BY + 4), (BX - 9, BY + 4)])
cv.paint(hull, '#2a1a14')
cv.paint(hull & ~roll(hull, 1, 0), '#55382a')
cv.paint(hull & ((yy // S) % 2 == 1) & (yy > BY * S + S), '#3d281c')
cv.paint(rect(BX + 7, BY - 9, BX + 8, BY), '#2a1a14')                  # lantern pole
cv.paint(rect(BX + 4, BY - 10, BX + 8, BY - 9), '#2a1a14')
boat_lamp = rect(BX + 3.5, BY - 9, BX + 5.5, BY - 6)
cv.paint(boat_lamp, '#ffc86a')
cv.paint(hull & (yy < BY * S + 2 * S) & (xx < BX * S - 4 * S), '#40375a')   # moonlit rim
boat = hull | rect(BX + 4, BY - 10, BX + 8, BY)
boat_refl = np.zeros((H, W), bool)
for y in range(int((BY + 4) * S), min(H, int((BY + 14) * S))):
    sy = 2 * (BY + 4) * S - y
    if 0 <= sy < H:
        boat_refl[y] = (boat | boat_lamp)[sy] & (rip[y] > 0.35)
cv.paint(boat_refl & ~boat, '#100d22')
cv.paint(boat_refl & roll(boat_lamp, int(2 * (BY + 4) * S - 2 * (BY - 7.5) * S), 0) & ~boat, '#c8642a')

# ============ 8. FOREGROUND ============
ledge = poly([(0, 172), (18, 167), (40, 169), (66, 165), (92, 171), (118, 179), (140, 191), (152, 216), (0, 216)])
crag(ledge, ['#070611', '#0a0817', '#15121f', '#211c2e'], scale=9, seed=70, rough=0.7)
cell = N(8, 71, 2)
seam = ledge & (np.abs(cell - 0.5) < 0.018)
cv.paint(seam, '#0a0817')
cv.paint(ledge & roll(seam, 1, 0) & ~seam, '#40375a')
top = ledge & ~roll(ledge, 1, 0)
cv.paint(top | (ledge & ~roll(ledge, 2 * S, 0) & (xx > 30 * S)), '#574c74')
cv.paint(top & (xx > 60 * S), '#7a6e98')
moss_top = ledge & ~roll(ledge, 4 * S, 0) & (N(1.2, 73) > 0.45)
cv.paint(moss_top, '#1a2e32')
cv.paint(moss_top & ~roll(moss_top, 1, 0), '#35584f')

# carved stone lantern
LX, LY = 56, 166
lan = np.zeros((H, W), bool)
parts = [rect(LX - 7, LY - 2, LX + 7, LY + 1), rect(LX - 5, LY - 4, LX + 5, LY - 2), rect(LX - 2, LY - 15, LX + 2, LY - 4),
         rect(LX - 5, LY - 17, LX + 5, LY - 15), rect(LX - 6, LY - 27, LX + 6, LY - 17),
         poly([(LX - 10, LY - 27), (LX + 10, LY - 27), (LX + 6, LY - 31), (LX - 6, LY - 31)]),
         poly([(LX - 6, LY - 31), (LX + 6, LY - 31), (LX, LY - 35)]), rect(LX - 1, LY - 38, LX + 1, LY - 35),
         cv.ellipse_mask(LX * S, (LY - 39) * S, 1.6 * S, 1.6 * S)]
for pm in parts:
    lan |= pm
crag(lan, ['#2f2840', '#40375a', '#574c74', '#7a6e98'], scale=2, seed=90)
cv.paint(lan & ~roll(lan, 0, -1) & (xx > LX * S), '#7a6e98')
cv.paint(lan & ~roll(lan, 1, 0), '#7a6e98')
cv.paint(lan & ~roll(lan, 0, 1), '#15121f')
cage = rect(LX - 4, LY - 25, LX + 4, LY - 18)
cv.paint(cage, '#3a1c16')
cv.paint(rect(LX - 0.5, LY - 25, LX + 0.5, LY - 18), '#211c2e')            # bar
cv.paint(lan & (N(1, 91) > 0.62) & (yy > (LY - 15) * S), '#1a2e32')
cv.paint(lan & (N(1, 92) > 0.7) & (yy > (LY - 4) * S), '#24403f')
flame_base = (LX * S, (LY - 18.5) * S)

# twisted tree with bark texture and hanging moss
tree = np.zeros((H, W), bool)
tw = np.zeros((H, W))
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
branch(24, 176, -1.45, 64, 5.5, 4, 7)
branch(25, 150, -0.5, 50, 3, 3, 8)
branch(20, 160, -2.4, 26, 2.2, 2, 9)
roots = poly([(14, 176), (34, 176), (40, 180), (8, 180)])
tree |= roots
cv.paint(tree, '#0a0817')
bark = N(0.8, 95, 2, stretch=(0.3, 2.5))
cv.paint(tree & (bark > 0.6), '#15121f')
cv.paint(tree & ~roll(tree, 0, -1), '#211c2e')
cv.paint(tree & ~roll(tree, 0, -1) & (yy < 120 * S) & (dist < 260 * S), '#2f2840')
moss = np.zeros((H, W), bool)
ys, xs = np.nonzero(tree & (yy < 140 * S) & (xx > 20 * S) & ~roll(tree, -1, 0))
r = np.random.default_rng(5)
for i in r.choice(len(xs), 60, replace=False):
    x, y = xs[i], ys[i]
    ln = r.integers(4, 16) * S
    moss |= cv.line_mask([(x, y), (x + r.uniform(-2, 2), y + ln)], 1)
moss &= ~tree
cv.paint(moss, '#24403f')
cv.paint(moss & (N(0.6, 96) > 0.6), '#35584f')

# glowing mushrooms at the roots, ferns, reeds
mush = np.zeros((H, W), bool)
mush_caps = np.zeros((H, W), bool)
r = np.random.default_rng(31)
for (mx, my) in [(30, 175), (34, 176), (38, 177), (10, 179), (44, 178), (86, 171), (90, 172)]:
    hh = r.uniform(2, 4)
    stem = rect(mx, my - hh, mx + 0.6, my)
    cap = cv.ellipse_mask((mx + 0.3) * S, (my - hh) * S, 1.8 * S, 1.0 * S) & (yy <= (my - hh) * S)
    mush |= stem | cap
    mush_caps |= cap
    cv.paint(stem, '#b4fff0')
    cv.paint(cap, '#2f8f94')
    cv.paint(cap & ~roll(cap, 1, 0), '#5fd4c8')
ferns = np.zeros((H, W), bool)
for i in range(14):
    fx_, fy_ = r.uniform(70, 140), r.uniform(176, 214)
    for k in range(5):
        a = -np.pi / 2 + (k - 2) * 0.45
        ln = r.uniform(5, 9)
        ferns |= cv.line_mask([(fx_ * S, fy_ * S), ((fx_ + np.cos(a) * ln) * S, (fy_ + np.sin(a) * ln * 0.8) * S)], 1)
ferns &= ledge
cv.paint(ferns, '#1a2e32')
cv.paint(ferns & ~roll(ferns, 1, 0), '#35584f')
reeds = np.zeros((H, W), bool)
heads = np.zeros((H, W), bool)
for i in range(70):
    x = r.uniform(296, 384); h = r.uniform(10, 34); lean = r.uniform(-4, 4)
    reeds |= cv.line_mask([(x * S, H), ((x + lean) * S, (216 - h) * S)], 1 if r.random() < 0.6 else 2)
    if r.random() < 0.3:
        heads |= rect(x + lean - 0.7, 216 - h - 3.5, x + lean + 0.7, 216 - h)
reeds |= heads
cv.paint(reeds, '#070c10')
cv.paint(reeds & ~roll(reeds, 0, 1), '#1a2e32')
cv.paint(heads, '#2a1a14')
cv.paint(heads & ~roll(heads, 0, 1), '#55382a')

# ============ 9. LIGHT ============
cv.lit_colors('#f09a3e', steps=(0.1, 0.22, 0.38))
cv.lit_colors('#5fd4c8', steps=(0.12, 0.25))
cv.glow(flame_base[0], flame_base[1] - 2 * S, 40 * S, '#f09a3e', strength=0.34, dither=0.06, squash=0.8)
cv.glow(251 * S, 108 * S, 16 * S, '#c8642a', strength=0.24, dither=0.0)
cv.glow(251 * S, 136 * S, 12 * S, '#c8642a', strength=0.22, dither=0.0, squash=0.7)
cv.glow((BX + 4.5) * S, (BY - 7.5) * S, 14 * S, '#f09a3e', strength=0.3, dither=0.0)
cv.glow(36 * S, 175 * S, 16 * S, '#5fd4c8', strength=0.22, dither=0.0, squash=0.6)
cv.glow(251 * S, 43 * S, 9 * S, '#5fd4c8', strength=0.3, dither=0.0)

cv.save('stage2/still', scale=OUT_SCALE)
img = Image.open('stage2/still_native.png')
img.save('stage2/native.png')
img.resize((W * OUT_SCALE, H * OUT_SCALE), Image.NEAREST).save('stage2/big.png')
np.savez_compressed('stage2/masks.npz', falls0=falls[0], falls1=falls[1], lake=lake, moon_path=moon_path,
                    wins=wins, wins_teal=wins_teal, lamps=lamps_bridge | boat_lamp, lrefl=lrefl, moss=moss,
                    reeds=reeds, tree=tree, cloud=cl, moon=moon, mush=mush_caps, teal_flowers=teal_flowers,
                    ferns=ferns, boat=boat | boat_refl)
np.save('stage2/flame.npy', np.array(flame_base))
print('ok', W, H)
