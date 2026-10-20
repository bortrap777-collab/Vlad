import sys, glob
from PIL import Image
# strip.py frames_dir x0 y0 x1 y1 out [k] [frames...]
d, x0, y0, x1, y1, out = sys.argv[1], *map(int, sys.argv[2:6]), sys.argv[6]
k = int(sys.argv[7]) if len(sys.argv) > 7 else 4
idx = [int(a) for a in sys.argv[8:]] or [0, 3, 6, 9]
fs = sorted(glob.glob(d + '/*.png'))
ims = [Image.open(fs[i]).crop((x0, y0, x1, y1)).resize(((x1 - x0) * k, (y1 - y0) * k), Image.NEAREST) for i in idx]
W, H = ims[0].size
sheet = Image.new('RGB', (W, (H + 4) * len(ims)), (255, 255, 255))
for i, im in enumerate(ims):
    sheet.paste(im, (0, i * (H + 4)))
sheet.save(out)
