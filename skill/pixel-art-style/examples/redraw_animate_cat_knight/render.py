"""Cat-knight, redrawn and animated at the 640x426 detail grid.
Static scene: full repaint of the reference (base.npz). Every moving thing is an object
drawn each frame. Outputs native frames (Pixelorama-ready) + enlarged copies."""
import os, sys
import numpy as np
from scipy import ndimage
import scene as SC
from scene import W, H, S, box
from motion_objects import SheetX, SheetY, Plant, TAU
sys.path.insert(0, SC.SK)
from pixel_canvas import Canvas, BAYER4

N = 16
OUT = 'frames'
os.makedirs(OUT, exist_ok=True)
B = np.load('base.npz')
ref, bg, pal0, emblem = B['ref'], B['bg'], B['pal'], B['emblem']
L = SC.A['L']; yy, xx = SC.yy, SC.xx
rng = np.random.default_rng(7)

# ---------------- palette: the repaint's 160 colours + light / mist / water tones
extra = [[255, 214, 170], [255, 236, 206], [246, 170, 128], [214, 98, 78], [190, 64, 62],
         [200, 186, 200], [178, 162, 180], [150, 132, 148], [232, 160, 128]]
darks = pal0[np.argsort((pal0 * np.array([.3, .59, .11])).sum(1))][:48]
lit = [d + (np.array([239, 151, 117.]) - d) * t for d in darks[::2] for t in (0.2, 0.45)]
mist = [d + (np.array([150, 132, 148.]) - d) * t for d in darks[::2] for t in (0.25,)]
PAL = np.unique(np.clip(np.round(np.vstack([pal0, extra, lit, mist])), 0, 255), axis=0)
assert len(PAL) <= 256, len(PAL)

# ---------------- objects
cape = SheetX(ref, SC.cape, n=9)
tail = SheetX(ref, SC.tail, n=6, seed=2)
banner = SheetY(ref, SC.banner, emblem)
smalls = [SheetY(ref, m, n=4, top_fixed=2) for m in SC.small_banners if m.sum() > 10]
plants = [Plant(ref, m, rng) for m in SC.plants]

# eye (for the blink) and fur tufts on the back of the head
EYE = box(95, 107.5, 99, 112) & (L < 0.24)
eye_rows = np.nonzero(EYE.any(1))[0]
fur_px = ref[SC.head_fur]
fur_lum = (fur_px * np.array([.3, .59, .11])).sum(1)
FUR_MID = np.median(fur_px[(fur_lum > np.quantile(fur_lum, 0.4)) & (fur_lum < np.quantile(fur_lum, 0.6))], 0)
FUR_LIGHT = np.median(fur_px[fur_lum > np.quantile(fur_lum, 0.85)], 0)
FUR_SHADE = np.median(fur_px[fur_lum < np.quantile(fur_lum, 0.2)], 0)
LID = np.median(ref[box(93, 104, 101, 107)].reshape(-1, 3), 0)          # fur just above the eye

hf = SC.head_fur
tufts = []
rows = [y for y in range(int(92 * S), int(116 * S), 8) if hf[y].any()]
for y in rows:
    x = np.nonzero(hf[y])[0].min()
    if x < 150 * S:                                                     # back of the head only
        tufts.append(dict(x=x, y=y, len=rng.integers(2, 4), ang=rng.uniform(2.8, 3.3), p=rng.random()))
top = [(x, np.nonzero(hf[:, x])[0].min()) for x in range(int(70 * S), int(88 * S), 9) if hf[:, x].any()]
for (x, y) in top:                                                      # crown and nape tufts
    tufts.append(dict(x=x, y=y, len=rng.integers(2, 4), ang=rng.uniform(3.6, 4.2), p=rng.random()))


def draw_tufts(img, ph2):
    for t in tufts:
        a = t['ang'] + 0.28 * np.sin(TAU * (2 * ph + t['p'])) - 0.12      # wind pushes them back
        for i in range(1, t['len'] + 1):
            px = int(round(t['x'] + np.cos(a) * i)); py = int(round(t['y'] + np.sin(a) * i * 0.9))
            if 0 <= px < W and 0 <= py < H and (not SC.head_fur[py, px] or i == t['len']):
                img[py, px] = FUR_LIGHT if i < t['len'] else FUR_MID


EYE_DARK = ref[EYE].min(0)
EYE_COLS = np.nonzero(EYE.any(0))[0]


def blink(img, f):
    """One slow blink per loop. The eye is covered by fur in stages and the closed eye is
    a clean dark lid arc, drawn pixel by pixel, not a mix of leftover pixels."""
    state = {11: 0.5, 12: 1.0, 13: 0.5}.get(f, 0)
    if not state:
        return
    y0, y1 = eye_rows.min(), eye_rows.max()
    if state == 1:
        img[ndimage.binary_dilation(EYE)] = LID
        x0, x1 = EYE_COLS.min(), EYE_COLS.max()
        mid = (y0 + y1) / 2 + 1
        for x in range(x0, x1 + 1):
            t = (x - x0) / max(1, x1 - x0)
            yl = int(round(mid + 1.2 * (1 - (2 * t - 1) ** 2)))     # arc that dips in the middle
            img[yl, x] = EYE_DARK
        return
    cut = int(round(y0 + (y1 - y0) * state))
    big = ndimage.binary_dilation(EYE)
    img[big & (yy < cut)] = LID                                    # upper lid covers the top half
    x0, x1 = EYE_COLS.min(), EYE_COLS.max()
    for x in range(x0, x1 + 1):                                    # a continuous lid edge
        img[cut, x] = EYE_DARK


# ---------------- light
lab, n = ndimage.label(ndimage.binary_dilation(SC.lamps))
lamps = []
for i in range(1, n + 1):
    comp = (lab == i) & SC.lamps
    sz = int(comp.sum())
    if sz:
        cy, cx = ndimage.center_of_mass(comp)
        lamps.append(dict(m=comp, cx=cx, cy=cy, sz=sz, p1=rng.random(), p2=rng.random(), r=min(26, 5 + sz ** 0.5 * 2.6)))
big_lights = [(*SC.GREAT_WIN, 30, [190, 64, 62], 0.12, 0.1, 0.3),
              (*SC.LANTERN_L, 40, [239, 151, 117], 0.14, 0.12, 0.7),
              (*SC.LANTERN_B, 32, [239, 151, 117], 0.12, 0.12, 0.1)]

# mist (cross-fading fields with a gentle sway)
cvn = Canvas(W, H, ['#000000'])
nzA = cvn.noise(36, 3, seed=101, stretch=3.5); nzB = cvn.noise(36, 3, seed=202, stretch=3.5)
mist_zone = box(110, 112, 320, 182) & ~ndimage.binary_dilation(SC.lamps, iterations=2)
mist_fade = np.clip((yy - 112 * S) / (12 * S), 0, 1) * np.clip((182 * S - yy) / (12 * S), 0, 1) * np.clip((xx - 110 * S) / (30 * S), 0, 1)
MIST = np.array([150, 132, 148.])

# waterfalls
PERIOD = 32
col_off = rng.integers(0, PERIOD, W); col_len = rng.integers(5, 10, W); col_on = rng.random(W) < 0.6

# petals in the wind (liked: keep) — 3-px tumbling petals
petals = [dict(x0=rng.uniform(80, 660), y0=rng.uniform(200, 410), o=rng.random(), len=rng.uniform(90, 160),
               drop=rng.uniform(8, 26), bob=rng.uniform(2, 5), col=np.array(rng.choice([[181, 60, 60], [207, 89, 72], [150, 70, 76]]), float))
          for _ in range(16)]

MOON_C = SC.MOON_C
moon_halo = np.clip(1 - np.hypot(xx - MOON_C[0], yy - MOON_C[1]) / (80 * S), 0, 1) ** 2
sky_like = (L > 0.2) & (yy < 90 * S) & ~SC.moon

for f in range(N):
    ph = f / N
    img = bg.copy()

    # --- distant life first: moonlight, windows, mist, falls, water
    k = 0.07 + 0.05 * np.sin(TAU * ph)
    img[sky_like] += (np.array([239, 151, 117.]) - img[sky_like]) * (moon_halo[sky_like] * k)[..., None]

    t = 0.5 + 0.5 * np.cos(TAU * ph); ox = int(round(6 * np.sin(TAU * ph)))
    field = np.roll(nzA, ox, 1) * t + np.roll(nzB, -ox, 1) * (1 - t)
    a = np.clip((field - 0.5) * 1.4, 0, 0.3) * mist_fade * mist_zone
    img += (MIST - img) * a[..., None]

    for fm in SC.falls:
        pos = (yy - 4 * f + col_off[None, :]) % PERIOD                 # 4 px/frame, 32-px pattern: loops in 8
        streak = fm & (pos < col_len[None, :]) & col_on[None, :]
        img[streak] = img[streak] * 0.6 + np.array([190, 175, 190.]) * 0.4
        if fm.any():
            bottom = fm & (yy >= yy[fm].max() - 3)
            churn = bottom & (((xx * 13 + yy * 7 + f * 5) % 7) < 2)
            img[churn] = img[churn] * 0.55 + np.array([200, 186, 200.]) * 0.45

    water = SC.water
    shift = np.round(1.4 * np.sin(TAU * 2 * ph + yy * 0.45) * (yy > 172 * S)).astype(int)
    sx = np.clip(xx - shift, 0, W - 1)
    ok = water & water[yy, sx]
    img[ok] = img[yy, sx][ok]
    sparkle = SC.reflection & (np.sin(TAU * 2 * ph + xx * 0.9 + yy * 1.3) > 0.88)
    img[sparkle] = np.minimum(img[sparkle] * 1.2, 255)

    for sb in smalls:
        sb.draw(img, (f // 2) * 2 / N, amp=1.2, cycles=2)

    cv = Canvas(W, H, ['#000000']); cv.pal = PAL; cv.rgb = img
    for lp in lamps:
        kk = 0.5 + 0.3 * np.sin(TAU * (ph + lp['p1'])) + 0.2 * np.sin(TAU * (3 * ph + lp['p2']))
        cv.glow(lp['cx'], lp['cy'], lp['r'], '#cf5948', strength=0.05 + 0.13 * kk, dither=0.0)
        cv.rgb[lp['m']] = np.minimum(ref[lp['m']] * (0.88 + 0.28 * kk), 255)
    for (cx, cy, r, col, base, amp, p) in big_lights:
        kk = 0.5 + 0.3 * np.sin(TAU * (ph + p)) + 0.2 * np.sin(TAU * (3 * ph + p * 2))
        cv.glow(cx, cy, r, col, strength=base + amp * kk, dither=0.0)
    img = cv.rgb

    # --- the hero and the wind. Cloth and plants are animated "on twos": each pose is
    # held for two frames, the classic way to keep pixel cloth from shimmering.
    ph2 = (f // 2) * 2 / N
    tail.draw(img, ph2, amp=2.6, k=90 * S, cycles=1, flap=0.6, fold=0, reach=1.2)
    cape.draw(img, ph2, amp=3.5 * S / 2 * 1.4, k=60 * S, cycles=2, flap=1.5 * S / 2 * 1.3, reach=1.6 * S)
    img[SC.cat_fixed] = ref[SC.cat_fixed]
    draw_tufts(img, ph2)
    blink(img, f)
    banner.draw(img, ph2, amp=4.0 * S / 2 * 1.5, cycles=2)

    # --- foreground: plants in the gusts, petals carried past
    for p in plants:
        p.draw(img, ph2, wavelength=220 * S, cycles=2)
    for p in petals:
        s = (ph + p['o']) % 1.0
        if s < 0.08 or s > 0.92:
            continue
        x = p['x0'] - p['len'] * s
        y = p['y0'] + p['drop'] * s + p['bob'] * np.sin(TAU * 2 * s + p['o'] * 6)
        ix, iy = int(round(x)), int(round(y))
        if 1 <= ix < W - 2 and 1 <= iy < H - 2:
            c = p['col']
            if (f + int(p['o'] * 8)) % 2:
                img[iy, ix] = c; img[iy, ix + 1] = c * 0.8; img[iy, ix + 2] = c * 0.6
            else:
                img[iy, ix] = c; img[iy + 1, ix] = c * 0.8; img[iy + 1, ix + 1] = c * 0.65

    cv.rgb = np.clip(img, 0, 255)
    nat = cv.image()
    nat.save(f'{OUT}/f_{f:02d}.png')
print('frames', N, 'palette', len(PAL), 'lamps', len(lamps), 'plants', len(plants), 'tufts', len(tufts))
