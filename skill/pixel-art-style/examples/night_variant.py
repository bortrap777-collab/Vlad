"""Example, approach A: night version of a dusk scene.
Usage: python night_variant.py style.json reference.png out/stem
Tune: relight() strength, moon position (placed where the sun was), glow radii."""
import sys; import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))
import numpy as np
from scipy import ndimage
from pixel_canvas import Canvas, load_style
from variants import load_native, analyse, find_sun, inpaint, find_lamps, find_sky, relight, shift_palette
STYLE, REF, OUT = sys.argv[1:4]   # style.json, reference image, output stem
st = load_style(STYLE); W, H = st['native_size']
src = load_native(REF, W, H)
A = analyse(src); sun = find_sun(A); cy, cx = ndimage.center_of_mass(sun)
A = analyse(inpaint(src, sun))
lamps = find_lamps(A, exclude=sun); sky = find_sky(A) & ~sun
moon = ['#5a5b86', '#9a9cc4', '#d9d8ee', '#f4f2fb']; lamp_c = ['#8e4721', '#ca8334', '#f29e6d', '#ffc47a', '#ffe6b0']
cv = Canvas(W, H, shift_palette(st['hex']) + lamp_c + moon)
cv.rgb = relight(A, lamps)
cv.lit_colors('#ca8334', steps=(0.2, 0.4, 0.6)); cv.lit_colors('#9a9cc4', steps=(0.25, 0.5))
cv.stars(ndimage.binary_erosion(sky, iterations=2) & (A['yy'] < H * 0.4), moon[:3], n=70, seed=4)
mx, my = cx + 4, cy - 22
cv.glow(mx, my, 34, '#9a9cc4', strength=0.4, mask=sky)
m = cv.ellipse(mx, my, 8, 8, '#d9d8ee'); cv.ellipse(mx - 2, my - 2, 4, 4, '#f4f2fb')
cv.paint(m & cv.ellipse_mask(mx + 3, my + 2, 5, 5) & ~cv.ellipse_mask(mx - 2, my - 2, 5, 5), '#9a9cc4')
lab, n = ndimage.label(ndimage.binary_dilation(lamps))
for i in range(1, n + 1):
    comp = lab == i
    if comp.sum() >= 2:
        y, x = ndimage.center_of_mass(comp)
        cv.glow(x, y + 1, min(22, 5 + comp.sum() ** 0.5 * 2.2), '#ca8334', strength=0.42, squash=0.8)
inner = ndimage.binary_erosion(lamps)
cv.paint(lamps, '#ffc47a'); cv.paint(inner, '#ffe6b0'); cv.paint(lamps & ~ndimage.binary_dilation(inner), '#f29e6d')
cv.save(OUT, scale=st['scale'])
