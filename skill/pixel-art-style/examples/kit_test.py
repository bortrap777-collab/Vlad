import sys
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'scripts'))
import numpy as np
from pixel_canvas import Canvas
from objects import Kit
PAL = ['#050410','#0b0918','#181431','#2c2452','#4b3d75','#0a0817','#100d22','#17142e','#1e1a3a','#262248','#2f2a58','#3a3468','#574a80','#7d6fa3',
       '#070611','#0f0d18','#211c2e','#2f2840','#40375a','#574c74','#3a1c16','#8c3d1e','#c8642a','#f09a3e','#ffc86a','#ffeab0','#2a120e','#5a2a1c',
       '#1c110d','#2a0d10','#4a1418','#6e1c1e','#9a2a26','#c8963a','#070c10','#0c1418','#122026','#24403f']
W, H = 200, 140
cv = Canvas(W, H, PAL)
cv.vgradient(0, H, ['#050410', '#0b0918', '#181431', '#2c2452'], band=0.3)
kit = Kit(cv, light=(180, 10))
stone = ['#0a0817', '#17142e', '#262248', '#3a3468', '#574a80']
slate = ['#050410', '#100d22', '#1e1a3a', '#2f2a58', '#3a3468', '#574a80']
w1 = kit.wall(20, 180, 96, 132, stone, seed=1, slits=4)
t1 = kit.round_tower(40, 132, 22, 70, stone, roof=slate, roof_h=34, seed=2)
t2 = kit.round_tower(160, 132, 18, 56, stone, roof=slate, roof_h=28, seed=3)
kit.window(36, 80, 7, 14, stone, kind='lancet', spill=0.15)
kit.window(156, 92, 5, 10, stone, kind='lancet', spill=0.12)
g = kit.gate(100, 132, 18, 26, stone)
kit.buttress(70, 132, 4, 22, stone, seed=5)
m, em = kit.banner(122, 100, 8, 22)
kit.ivy((cv.xx > 20) & (cv.xx < 180) & (cv.yy > 112) & (cv.yy < 132), density=0.6, seed=4)
kit.pennant(40, t1['tip'][1] - 2)
cv.save('kit_test', scale=4)
print('ok')
