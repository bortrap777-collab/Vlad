"""Example, approach B: an original character piece composed from scratch.
Paths are from the test run - adapt them. Shows layer order, cloud/mist/castle helpers, character build-up."""
import sys
import numpy as np
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))
from pixel_canvas import Canvas, load_style

st = load_style('/home/claude/styles/cat_knight/style.json')
W, H = st['native_size']
cv = Canvas(W, H, st['hex'])
n = cv.near
MOON = (214, 66)
cv.lit_colors('#d38876', steps=(0.2, 0.4))       # in-between tones for moon glow on clouds

# ---------------- sky: fill the WHOLE canvas first so nothing is left unpainted
cv.vgradient(0, H, [n('#130f15'), n('#1b1922'), n('#26232d'), n('#2d2f3e'), n('#3b394a'), n('#4e4555'), n('#5f5161'), n('#5f5161')], band=0.3)
cv.stars(cv.rect_mask(30, 0, W, 40), [n('#4e4555'), n('#5f5161'), n('#755f6e')], n=45, seed=3)
cv.glow(*MOON, 90, '#9b5b5d', strength=0.45, dither=0.1)

# ---------------- textured cloud banks, rims lit by the moon
cv.clouds(10, 46, [n('#26232d'), n('#3b394a'), n('#78484c'), n('#b2726e')], light=MOON, coverage=0.5, scale=20, seed=1)
cv.clouds(54, 86, [n('#2d2f3e'), n('#3b394a'), n('#4e4555')], light=MOON, coverage=0.45, scale=18, seed=4, x1=150)
cv.clouds(96, 116, [n('#4e4555'), n('#5f5161'), n('#9b5b5d'), n('#d38876')], light=MOON, coverage=0.45, scale=14, seed=5, x0=120)
# ---------------- moon
moon = cv.ellipse(*MOON, 40, 40, n('#ef9775'))
cv.paint(moon & cv.ellipse_mask(MOON[0] - 6, MOON[1] - 7, 32, 31), n('#f4ae88'))
cv.paint(moon & cv.ellipse_mask(MOON[0] - 12, MOON[1] - 14, 16, 14), n('#f2c1a2'))
for (dx, dy, r) in [(14, 10, 6), (-8, 18, 4), (20, -12, 4), (-18, -2, 3)]:
    crater = moon & cv.ellipse_mask(MOON[0] + dx, MOON[1] + dy, r, r * 0.8)
    cv.paint(crater, n('#db735d'))
    cv.paint(crater & ~cv.ellipse_mask(MOON[0] + dx + 1, MOON[1] + dy + 1, r, r * 0.8), n('#d38876'))

# a thin wisp crossing the moon keeps it inside the sky instead of pasted on top
cv.clouds(70, 80, [n('#5b3536'), n('#9b5b5d'), n('#d38876')], light=(MOON[0], MOON[1] - 30), coverage=0.35, scale=10, seed=9, x0=150, x1=300)
# ---------------- far mountains (left), darker than the sky behind them
far = cv.ridge(132, amp=36, color=n('#5f5161'), seed=11, x0=0, x1=210, peaks=[(75, 26), (150, 10)])
cv.rim(far, n('#755f6e'), dx=1, dy=-1)
cv.paint(far & (cv.noise(8, 3, seed=21, stretch=0.6) < 0.42), n('#4e4555'))   # shadowed gullies
nz = cv.noise(14, 3, seed=8, stretch=3)

near_m = cv.ridge(150, amp=18, color=n('#3b394a'), seed=13, x0=20, x1=170)
cv.rim(near_m, n('#4e4555'), dx=1, dy=-1)

# ---------------- castle on its cliff, in front of the moon
cliff = cv.poly([(146, H), (152, 168), (160, 150), (170, 140), (186, 132), (244, 130), (260, 138), (274, 152), (286, 172), (296, H)], n('#1b1922'))
strata = cv.noise(6, 2, seed=6, stretch=0.3)
cv.paint(cliff & (strata > 0.55), n('#26232d'))
cv.paint(cliff & (strata < 0.3), n('#130f15'))
edge_n = cv.noise(3, 2, seed=17)
outer = cliff & ~cv._erode(cv._erode(cliff))
cliff &= ~(outer & (edge_n > 0.6))
cv.rim(cliff, n('#3e292d'), dx=0, dy=-1, width=2)
cv.rim(cliff, n('#5b3536'), dx=1, dy=-1)

rng = np.random.default_rng(42)
castle = np.zeros((H, W), bool)
body = cv.rect_mask(172, 104, 258, 134)
castle |= body
specs = [(214, 13, 84, 2.6)]                                   # (x, width, height, spire ratio)
for x in [174, 181, 190, 198, 205, 223, 231, 239, 247, 255]:
    specs.append((x, int(rng.integers(5, 9)), int(rng.integers(26, 62)) if abs(x - 214) > 20 else int(rng.integers(52, 70)), rng.uniform(2.2, 3.4)))
for (x, w, h, sp) in specs:
    castle |= cv.tower(x, 134, w, h, n('#130f15'), spire=sp)
    castle |= cv.line_mask([(x, 134 - h - w * sp), (x, 134 - h - w * sp - 3)])          # pinnacle
for x in range(172, 259, 3):
    castle |= cv.rect_mask(x, 102, x, 103)                                               # crenellations
for (x, y, w, h) in [(166, 118, 6, 16), (260, 120, 6, 14)]:                              # side buttresses
    castle |= cv.poly_mask([(x, y + h), (x + w, y + h), (x + w, y), (x + w - 2, y - 4)])
cv.paint(castle, n('#130f15'))
cv.rim(castle, n('#3e292d'), dx=0, dy=-1)
cv.rim(castle & (cv.xx > 214), n('#78484c'), dx=1, dy=0)
cv.rim(castle & (cv.xx < 214), n('#5b3536'), dx=-1, dy=0)
rocks = np.zeros((H, W), bool)
rr = np.random.default_rng(5)
for x in range(168, 262, 5):
    rocks |= cv.ellipse_mask(x + rr.uniform(-2, 2), 135 + rr.uniform(-1, 2), rr.uniform(4, 7), rr.uniform(2, 4))
cv.paint(rocks, n('#1b1922'))
cv.rim(rocks, n('#3e292d'), dx=0, dy=-1)
cv.texture(rocks, [n('#26232d')], density=0.3, seed=3, cluster=2)
# great gothic window + rows of small lit windows
gw = cv.poly([(210, 96), (214, 89), (218, 96), (218, 116), (210, 116)], n('#cf5948'))
cv.paint(gw & (cv.yy > 98) & ((cv.xx == 212) | (cv.xx == 216)), n('#ef9775'))
cv.paint(gw & (cv.yy == 104), n('#4d1921'))
cv.glow(214, 106, 14, '#b53c3c', strength=0.3, mask=castle & ~gw)
for i in range(26):
    x = int(rng.integers(174, 256)); y = int(rng.integers(80, 130))
    if castle[y, x] and castle[y + 1, x] and not gw[y, x]:
        cv.px(x, y, n('#f4ae88') if rng.random() < 0.4 else n('#db735d'))
        cv.px(x, y + 1, n('#b53c3c'))

# waterfalls: thin broken streaks, brightest where they leave the rock, lost in mist below
for (x, w, y0) in [(181, 2, 138), (248, 3, 136), (269, 2, 152)]:
    fall = cv.rect_mask(x, y0, x + w - 1, 172)
    streak = cv.noise(3, 2, seed=x, stretch=0.15)
    cv.paint(fall, n('#4e4555'))
    cv.paint(fall & (streak > 0.5), n('#755f6e'))
    cv.paint(fall & (cv.yy < y0 + 6), n('#755f6e'))
    cv.px(x, y0, n('#9b5b5d'))

# ---------------- bridge and drifting mist
bridge = cv.arch_bridge(112, 176, 150, 3, 12, 4, n('#1b1922'), pier=3)
cv.rim(bridge, n('#3b394a'), dx=0, dy=-1)
for x in (120, 136, 152, 168):
    cv.rect(x, 146, x + 1, 149, n('#1b1922')); cv.px(x, 146, n('#5b3536'))
mist_n = cv.noise(16, 3, seed=31, stretch=4)
from pixel_canvas import BAYER4
th = BAYER4[cv.yy % 4, cv.xx % 4]
for (y0, y1, col) in [(150, 172, '#3b394a'), (160, 182, '#4e4555')]:
    band = (cv.yy > y0) & (cv.yy < y1) & (cv.xx > 100)
    t = np.clip((mist_n - 0.42) * 2.5, 0, 1) * (1 - np.abs(cv.yy - (y0 + y1) / 2) / ((y1 - y0) / 2))
    cv.paint(band & (t > th), n(col))

# ---------------- water with moon reflection
water = cv.rect_mask(120, 178, W, H)
cv.vgradient(178, H, [n('#26232d'), n('#1b1922'), n('#130f15')], mask=water)
rn = cv.noise(4, 2, seed=77, stretch=3)
for y in range(180, H):
    w = int(12 * (1 - (y - 180) / 45)) + 2
    off = int(np.sin(y * 0.9) * 2)
    for x in range(MOON[0] - w + off, MOON[0] + w + off):
        if 0 <= x < W and rn[y, x] > 0.52 and (y % 3):
            cv.px(x, y, n('#b2726e') if abs(x - MOON[0] - off) < w * 0.45 else n('#78484c'))

# ---------------- left framing tower with banner and lantern
tower = cv.rect(0, 0, 26, H, n('#130f15'))
cv.texture(tower, [n('#1b1922'), n('#26232d')], density=0.3, seed=9, cluster=2)
for y in range(6, H, 9):                                             # stone courses
    cv.rect(0, y, 26, y, n('#050405'))
cv.rim(tower, n('#3e292d'), dx=1)
cv.line([(26, 22), (52, 22)], n('#26232d'), width=2)                # banner pole
cv.px(53, 21, n('#3b394a'))
banner = cv.poly([(32, 24), (50, 24), (50, 70), (41, 63), (32, 70)], n('#4d1921'))
cv.paint(banner & cv.rect_mask(32, 24, 35, 70), n('#2d121a'))
cv.paint(banner & cv.rect_mask(46, 24, 50, 70), n('#5b3536'))
cv.rect(40, 34, 41, 54, n('#9b5b5d'))                                # pale cross
cv.rect(36, 40, 45, 41, n('#9b5b5d'))
cv.rim(banner, n('#78484c'), dx=1)
lantern = cv.rect(14, 60, 19, 67, n('#d38876'))
cv.rect(15, 61, 18, 66, n('#f4ae88'))
cv.rect(13, 58, 20, 59, n('#130f15')); cv.rect(13, 68, 20, 68, n('#130f15'))
cv.glow(16, 64, 22, '#d38876', strength=0.45, mask=~lantern)

# ---------------- foreground rock ledge and red foliage
ledge = cv.poly([(0, 172), (30, 168), (70, 167), (120, 170), (138, 178), (146, 196), (150, H), (0, H)], n('#130f15'))
cv.texture(ledge, [n('#1b1922'), n('#26232d'), n('#2d2f3e')], density=0.3, seed=12, cluster=2)
top = ledge & ~np.roll(ledge, 2, 0)
cv.paint(top, n('#3b394a'))
cv.paint(ledge & ~np.roll(ledge, 1, 0), n('#5f5161'))
for (x, y, r, s) in [(8, 205, 14, 1), (34, 210, 12, 2), (128, 206, 14, 3), (150, 212, 10, 4), (300, 205, 18, 5), (275, 212, 12, 6)]:
    bush = cv.ellipse(x, y, r, r * 0.7, n('#2d121a'))
    cv.texture(bush, [n('#4d1921'), n('#5b3536')], density=0.45, seed=s, cluster=2)
    cv.texture(bush & cv.ellipse_mask(x + r * 0.3, y - r * 0.3, r * 0.6, r * 0.4), [n('#78484c'), n('#b53c3c')], density=0.3, seed=s + 9)

# ---------------- the knight (focal): stands on the ledge, looks toward the castle
X, FEET = 88, 168
# cape first (behind the body), billowing left in the wind
cape = cv.poly([(80, 113), (96, 113), (99, 148), (92, 162), (74, 166), (58, 161), (44, 152), (52, 149), (60, 141), (68, 129), (74, 119)], n('#4d1921'))
cv.paint(cape & cv.poly_mask([(62, 140), (72, 124), (78, 160), (66, 163)]), n('#2d121a'))      # deep fold
cv.paint(cape & cv.poly_mask([(76, 120), (82, 116), (86, 160), (80, 162)]), n('#5b3536'))
cv.paint(cape & cv.poly_mask([(48, 151), (58, 146), (60, 150), (52, 154)]), n('#5b3536'))
cv.rim(cape, n('#b53c3c'), dx=0, dy=1)                               # hem catches the moon
cv.rim(cape, n('#78484c'), dx=-1, dy=-1)
# legs and boots
steel = cv.ramp('#1b1922', '#755f6e', 4)                             # dark -> light
legs = cv.poly([(79, 142), (86, 142), (85, 156), (84, 166), (85, FEET), (78, FEET), (79, 156)], steel[1])
legs |= cv.poly([(89, 142), (96, 142), (97, 156), (98, 165), (103, FEET), (92, FEET), (91, 156)], steel[1])
cv.paint(legs & (cv.yy > FEET - 6), steel[0])
cv.paint(legs & (cv.xx > 94) & (cv.yy < FEET - 6), steel[2])
cv.rect(83, 153, 85, 154, steel[2]); cv.rect(94, 153, 96, 154, steel[3])           # knee cops
# tassets
tas = cv.poly([(77, 132), (99, 132), (101, 145), (75, 145)], steel[1])
for y in (136, 140):
    cv.rect(76, y, 100, y, steel[0])
# torso, breastplate turned slightly right
torso = cv.poly([(78, 113), (98, 113), (100, 133), (76, 133)], steel[1])
cv.paint(torso & (cv.xx > 92), steel[2])
cv.line([(92, 115), (92, 124)], steel[3])                            # breastplate ridge
for y in (125, 128):                                                 # articulated lames
    cv.paint(torso & (cv.yy == y), steel[0])
    cv.paint(torso & (cv.yy == y + 1) & (cv.xx > 88), steel[3])
cv.paint(torso & (cv.xx < 81), steel[0])                             # side away from the moon
cv.rect(76, 130, 100, 132, n('#3e292d'))                             # belt
cv.px(93, 131, n('#d39e8c'))
# pauldrons
lp = cv.ellipse(77, 116, 6, 5, steel[1]); cv.paint(lp & (cv.yy > 117), steel[0])
rp = cv.ellipse(99, 116, 6, 5, steel[2]); cv.paint(rp & (cv.yy < 114), steel[3])
# right arm holding the planted sword
arm = cv.poly([(100, 119), (105, 120), (107, 136), (103, 137)], steel[1])
cv.paint(arm & (cv.xx > 104), steel[2])
blade = cv.poly([(105, 141), (108, 141), (108, FEET - 1), (106, FEET + 1)], n('#4e4555'))
cv.line([(107, 142), (107, FEET - 2)], n('#d39e8c'))                 # moonlit edge
cv.rect(101, 138, 112, 139, n('#3e292d'))                            # crossguard
cv.px(101, 138, n('#78484c')); cv.px(112, 138, n('#78484c'))
cv.rect(105, 133, 107, 137, n('#2d121a'))                            # grip
cv.rect(104, 131, 108, 132, n('#78484c'))                            # pommel
hand = cv.rect(103, 135, 108, 138, steel[2])
# helmet: great helm with a narrow visor facing right
helm = cv.ellipse(88, 104, 6, 8, steel[1])
cv.paint(helm & (cv.xx > 89), steel[2])
cv.paint(helm & cv.ellipse_mask(86, 100, 3, 3), steel[3])
cv.rect(90, 103, 94, 103, n('#050405'))                              # visor slit
cv.px(94, 105, n('#050405'))
cv.rect(83, 111, 93, 112, steel[0])                                  # gorget shadow
# plume: the brightest large shape in the picture, streaming back in the wind
plume = cv.poly([(88, 96), (86, 94), (81, 94), (75, 96), (70, 99), (66, 103), (70, 104), (75, 101), (81, 99), (87, 98)], n('#d39e8c'))
cv.paint(plume & (cv.yy <= 96) & (cv.xx > 76), n('#f2c1a2'))
cv.paint(plume & (cv.yy >= 100), n('#b2726e'))
cv.px(65, 104, n('#9b5b5d')); cv.px(67, 105, n('#b2726e'))
cv.rect(87, 94, 88, 96, n('#78484c'))                                # plume holder

knight = cape | legs | tas | torso | lp | rp | arm | helm | plume | blade | hand
# moon rim on the side facing the castle, dark outline toward the dark ledge
cv.rim(knight & ~plume & ~cape, n('#d38876'), dx=1, dy=0)
cv.rim(helm | rp, n('#ef9775'), dx=1, dy=-1)
cv.outline(knight, n('#050405'))
# ground contact shadow
cv.paint(cv.ellipse_mask(90, FEET + 1, 14, 1.5) & ~knight, n('#050405'))

cv.save('/home/claude/work/t1_knight/knight', scale=st['scale'])
print('ok')
