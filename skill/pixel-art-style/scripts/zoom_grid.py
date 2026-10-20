import sys
from PIL import Image, ImageDraw
# usage: zoom.py ref.png x0 y0 x1 y1 out [k]  (native coords, ref is 2x native)
ref, x0, y0, x1, y1, out = sys.argv[1], *map(int, sys.argv[2:6]), sys.argv[6]
k = int(sys.argv[7]) if len(sys.argv) > 7 else 12
im = Image.open(ref).convert('RGB')
im = im.resize((im.width // 2, im.height // 2), Image.BOX).crop((x0, y0, x1, y1))
im = im.resize(((x1 - x0) * k, (y1 - y0) * k), Image.NEAREST)
d = ImageDraw.Draw(im)
for x in range(x0, x1):
    if x % 5 == 0:
        d.line([((x - x0) * k, 0), ((x - x0) * k, im.height)], fill=(0, 255, 255) if x % 10 else (255, 255, 0))
        if x % 10 == 0: d.text(((x - x0) * k + 2, 2), str(x), fill=(255, 255, 0))
for y in range(y0, y1):
    if y % 5 == 0:
        d.line([(0, (y - y0) * k), (im.width, (y - y0) * k)], fill=(0, 255, 255) if y % 10 else (255, 255, 0))
        if y % 10 == 0: d.text((2, (y - y0) * k + 2), str(y), fill=(255, 255, 0))
im.save(out)
