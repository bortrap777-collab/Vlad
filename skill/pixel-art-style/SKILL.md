---
name: "pixel-art-style"
description: Pixel-art artist that studies the user's reference images and creates new pixel art in the same style — characters, sprites, scenes, backgrounds, game-level art, alternate versions of a scene (night, winter, rain, dawn) and frame animations (GIF + PNG frames + Pixelorama-ready spritesheets), including redrawing a whole reference picture and animating every object in it (wind in cloaks, banners, fur, plants; flickering windows, water, mist), and turning each picture of a set or collage into its own living looping location (flowing lava, lavafalls, torches and candles, fireflies, smoke, swinging cages, wind in trees). Use whenever the user shares pixel art and asks to draw something "in this style", "like this picture", make a variant, extend or animate a scene, or asks to analyze a pixel-art style or palette — in any language, e.g. «нарисуй рыцаря в стиле этой картинки», «сделай ночную версию этой сцены», «оживи фонари», «перерисуй и анимируй», «чтобы плащ развевался», «сделай живую локацию», «чтобы лава текла», «пиксель-арт», «спрайт», «тайлсет», even if they never say "pixel art".
---

# Pixel-art style artist

You are working as a pixel artist for someone who already has a style. Your job is to
learn that style from their images and make new work that sits next to it naturally.
The user cares about *spirit*: same mood, palette family, light and composition habits.
Close neighbouring shades are allowed; a different art style is not.

You draw with code (numpy + PIL) at the art's **native pixel grid**, then enlarge with
nearest-neighbour to the reference's original size. This keeps every pixel deliberate and
the edges crisp. Code drawing is good at palette, light, atmosphere, silhouettes, layers
and dithering, and weaker at faces, hands and dense ornament — so design pieces around
strong shapes and light rather than micro-detail, and say so briefly if a request leans
hard on what code does badly.

Scripts live in `scripts/` next to this file:

| script | what it does |
|---|---|
| `analyze_style.py IMG OUT_DIR` | finds the pixel grid, extracts palette (base + accents), tonal stats → `style.json`, `native.png`, `preview.png`, `palette.png` |
| `pixel_canvas.py` | drawing library: banded gradients, smooth glow, value noise, textured clouds lit by the moon/sun, texture, outlines, rim light, ridges, pines, towers, arched bridges; snaps to palette on save |
| `variants.py` | for variants and animation of an existing scene: find sun / lamps / sky, paint out a blob, shift a scene to a new light condition, shift a palette |
| `check_art.py ART_NATIVE STYLE [--enlarged BIG] [--palette P.json]` | palette fidelity, mood vs reference, noise, accent presence, crisp integer scale |
| `make_gif.py STEM SCALE FRAMES… [--ms N]` | GIF + numbered PNG frames, one shared palette |
| `repaint.py` | full repaint of a reference at any grid: unsharp, colour grading (violet shadows / warm lights), dense palette fit, singleton cleanup |
| `motion_objects.py` | objects redrawn every frame: `SheetX` (cape, tail: columns move), `SheetY` (banner: rows sway, top fixed), `Plant` (rooted, bends in gusts), `clean_index`, `ramp_from` |
| `inspect_frames.py FRAMES OUT` | animation QA: flicker (A→B→A shimmer) per region, loop seam, motion map |
| `location.py` | **living location** (approach E): repaint once at the finest grid, effects redrawn per frame, one GIF-safe palette; writes GIF (ref size + ×2), native frames, Pixelorama spritesheet, still |
| `fx.py` | the effects: `Liquid` (lava/pond, flow-map drift), `Fall` (water/lava falls), `Ripple`, `Flame` (sprite fire, candles to bonfires), `Lights` (windows, lanterns), `Particles` (ember, firefly, dust, drip, leaf, snow, bird, butterfly), `Smoke`, `Mist`, `Sway` (plants, crowns), `Swing` (cages, hanging lamps), `Banner`, `Breathe` (slow area light) |
| `photo_to_pixel.py PHOTO OUT --width 320` | **photo → pixel art** (approach F): median smoothing at 2× grid, style grading, small k-means palette pulled toward the reference palette (`--style`), ordered dither only in smooth gradients, selective outline; `leaf_clumps()` turns photo bokeh foliage into lit leaf clusters |
| `zoom_grid.py REF x0 y0 x1 y1 OUT [k]` | enlarged crop of the reference with a coordinate grid — find boxes for masks |
| `frame_strip.py FRAMES x0 y0 x1 y1 OUT [k] [frames…]` | the same crop from several frames stacked — judge motion by eye |

`examples/` holds one worked script per approach (night variant, original character
scene, scene animation, `redraw_animate_cat_knight/` — the full approach D pipeline:
scene masks → repaint → per-frame objects → frames — and `living_locations/`, six
complete approach E scenes: lava cave, throne hall, dungeon, dark castle, enchanted
forest, sunny village). Skim the matching one before writing yours — it shows the
layer order and the parameter ranges that worked.

Read `references/craft.md` before drawing a character or an animation; it holds the
pixel-art craft rules (ramps, hue shifting, clusters, outlines, animation timing).

## Workflow

### 1. Study the references
Copy the user's images to a working folder (uploads are read-only) and run
`analyze_style.py` on each. Then **look** at `preview.png` with the Read tool: if the
reduced image still looks like the original, the grid and palette are right. If the
picture lost its focal colours or looks smeared, rerun with `--scale N` or more
`--accents`.

Why accents matter: area-weighted palettes drop tiny but essential colours — pale fur,
amber window light, moss green — and the result turns into one flat hue. The script keeps
them (bright/saturated pixels and any muted hue band the base palette missed); make sure
your art uses them where the reference does. Trust the measured colours over your eye:
in a warm-lit dark scene, "white" is often a pale peach and "green" a dark olive.

Many references are upscaled or AI-made, with a soft, uneven grid and 100k+ colours.
That's fine: the analyzer picks an integer scale that divides the image cleanly, so the
result enlarges back to exactly the user's size.

Write a short `style_brief.md` (for yourself; share the key points with the user the
first time) covering:
- **Grid**: native size and scale (e.g. 320×180 ×4 → 1280×720).
- **Palette roles**: which colours are shadow, mid, sky, light/glow, focal accents.
  Note hue drift: in these styles shadows lean blue-violet, lights lean orange.
- **Light**: time of day, where the key light is, what glows (windows, lanterns, moon).
- **Depth**: how layers change with distance (darker+detailed near, lighter+bluer+flatter far, mist between).
- **Composition habits**: framing elements, horizon height, where the focal point sits.
- **Recurring motifs**: e.g. castle on a cliff, waterfalls, arched bridges, banners, smoke.
- **Texture**: dithering in sky/mist, chunky speckle in stone/foliage, outline habits.

With several references, describe what they share; that shared core is the style.

### 2. Pick the approach for the request

**A. Variant of an existing scene** ("night version", "winter", "rain", "after a fire")
Do not redraw the scene — start from the reference's `native.png`, so all of the
user's drawing survives. Transform it:
1. Build a colour mapping for the palette: each colour → its counterpart in the new
   condition (night: darker, cooler, less saturated; winter: whites/blue-greys on top
   surfaces; dawn: warmer and lighter). Map by palette index, keeping the order of
   lightness inside each material, so forms stay readable.
2. Re-light: light sources behave differently from surfaces. At night, windows and
   lanterns get *brighter* and gain dithered glow pools on nearby walls/ground and
   reflections on water; the sky gets a moon and sparse stars.
3. Add condition-specific details on separate passes (snow caps on roof/ledge tops,
   rain streaks, fog layers).
`variants.py` does the detection and the shift (`find_sun`, `inpaint`, `find_lamps`,
`find_sky`, `relight`, `shift_palette`); `examples/night_variant.py` is a complete night
version in ~30 lines. Work from the reference reduced to the native grid in full colour
(`load_native`), not from the palette-snapped `native.png`, so subtle shades survive.
Typical traps: a lamp's dark housing shifted toward blue turns purple (relight keeps
pixels next to lamps warm); sunlit grass tops look like lamps (thin streaks are dropped);
stars must only land on sky (detect sky by colour); reflections only under lamps that
hang over water.

**B. New subject in the style** ("draw a knight in the style of this picture")
Compose a fresh image at the reference's native size (same aspect, same output size)
unless the user asks for a sprite on transparency. Default for a character: a full
illustration — the character as the focal point in a simple setting built from the
style's motifs, because that's what the references are. Steps:
1. Thumbnail the composition as large shapes: horizon, framing element, focal subject,
   light source. Put the brightest value next to the darkest at the focal point.
2. Background back-to-front: sky gradient (dithered), far ridges, mid layers with mist,
   near layers — each layer one value step darker/warmer than the one behind.
3. The subject: silhouette first (it must read as a solid shape), then 3–4 tone ramps
   per material, rim light from the key light, selective dark outline (deep palette
   colour, never pure black unless the reference uses it).
4. Lights last: windows, lanterns, glow pools, reflections.

**B+. An original scene from scratch, detailed** («нарисуй сам красивый пейзаж»).
`examples/original_moon_lake/` is the worked piece (`draw.py` then `animate.py`): a
mysterious moonlit lake with a gothic tower, drawn at 768x432 with design units ×2.
What made it read as the user's style rather than "made by code" (each was a defect
in an earlier pass):
- Work at 2× the design grid (S=2). The 384×216 first pass looked flat; the user asked
  «сделай более детально». Shapes stay in design units, texture lives at art px.
- Shade rock from a fake height field (`crag()` in the example): light where the
  surface tilts toward the moon, broad scale for far ranges (12–13), finer for
  cliffs (7), lowest contrast far away. Small-scale noise reads as crumpled foil.
- Cloud edges facing the moon are a lit BAND 2–8 px deep, brighter near the moon;
  a 1-px lit line along a ragged edge reads as lightning. Remove 1–2 px filaments.
  Clouds part around the moon with a ragged (noise) opening, never a circle.
- Silhouette rule: the focal tower is near-black against the moon, with slate
  scallops, stone courses, buttresses, lancet windows (pointed, 3-tone warm), ivy,
  rims only where the halo is. One cold accent light (teal window) = mystery.
- Reflections mirror about each object's own waterline, fade and break with
  distance; the moon path is drawn after them and is wider than the tower.
- Foreground is the darkest layer; things standing on it (a stone lantern) get a
  lighter ramp and a rim, or they vanish into the cliff behind.
- Story props make it a place: ruins with one lit window on a far peak, a boat with
  a lamp, a dock and steps, lily pads with glowing flowers, glowing mushrooms.
- **Nothing floats, nothing sits where it can't** (user: «ели просто висят в
  воздухе»). Every tree, lantern, mushroom, ruin and bridge end is placed from the
  ground mask itself (`ground_y(mask, x)`: the top surface at that column) and sunk
  1–3 px into it, with a contact shadow. Forests are planted along a ground strip
  (`forest_on`), never on a guessed line. Falls start at their cliff's own edge.
  Bridges end on stone at both sides. Pads/props avoid each other (keep-out mask).
  Before delivering, brighten the still ×2 and inspect it in crops region by region.
- **Depth**: mountains recede in layers — far = light, bluish, low contrast, snow on
  the crest, fading into haze at the base; mid = darker with tiny pines on its
  slopes; then the shore forest; then the subject. Never one flat wall behind it.
- **A grand subject**: a castle is a composition, not one tower: back towers, a
  hall with tall windows, flanking towers, the keep, a curtain wall with merlons and
  a gatehouse in front (draw back to front), cast shadow of the keep on what is
  below it, ivy at the base, steps to a dock.
- **Cinematic**: deep shadows (foreground near-black, lake darker away from the
  shore), a vignette that spares light sources, faint dithered moon rays, the only
  saturated colours are the lights. A foreground silhouette (twisted tree) is placed
  against a lighter background, or it disappears.
- Mist over water must be patchy (`Mist(thresh≈0.52, gain≈3)`): a uniform dithered
  band reads as a filter.
- Animating your own drawing: `Location(big.png, grid=2, unit=2, n_colors=230,
  sharpen=0, denoise=False)`; mist only behind the foreground; the animated flame's
  glow is small when the still already holds the light pool; a bobbing boat is
  redrawn whole every frame (its plate is painted out).

**C. Animation** (GIF + PNG frames)
Draw the static base once, then make frames by changing only what moves — lantern
flicker (glow strength), water/waterfall (shifting streak texture), smoke drift, banners,
character idle (1-px breathing, cape sway). Make the motion cyclic so the loop is
seamless: drive it with `phase = i / n_frames` and `sin(2π·phase)` or wrap-around offsets.
6–12 frames at 80–150 ms reads well. Save each frame as `*_native.png` then run
`make_gif.py`. If the user asked to animate *their* scene, start from it reduced to the
native grid (`variants.load_native`) and change only the moving parts — see
`examples/animate_scene.py`. Moving parts stay one light step away from what is already
painted: waterfall streaks a shade lighter than the water, not white specks; the glow
breathes a little, the lamp core does most of the flicker. To verify motion, put crops
of 4 frames side by side enlarged 8× and look.


**D. Redraw the whole reference and animate every object** («перерисуй полностью сам и
добавь каждому объекту анимацию»). This is the highest-quality mode and what this user
asked for after seeing the others. The finished piece must look at least as good as the
reference, and every moving thing must move like a redrawn object — never like a cut-out
piece of the picture being bent. `examples/redraw_animate_cat_knight/` is the worked
pipeline; adapt its `scene.py` (masks) to the new picture, then reuse `build_base.py` and
`render.py`.
1. **Pick the finest grid the reference really supports.** Measure, don't guess: the
   share of image energy finer than 2 px (FFT) and the loss of a 2× round trip. If ≥95%
   of the energy is coarser than the grid, that grid holds all real detail (the
   cat-knight: 98% → 640×426, twice as fine as its 4-px blocks). Finer than that only
   adds blur. Output = grid × integer scale = the reference size (plus a ×4 copy).
2. **Repaint the static scene** with `repaint.py`: light unsharp (0.45; more draws halos),
   grading toward the style, ~160-colour fit, singleton cleanup. No blur: median filters
   wipe whiskers, eyes and armour detail. Compare crops side by side with the reference.
3. **Mask every object that moves** (by colour inside boxes, located on a coordinate-grid
   overlay of the reference) and check the overlay image. Fill holes in cloth masks;
   things lying on cloth (a sword over a cape) and the body are a fixed layer drawn after.
   Paint the movers out of a background plate (`variants.inpaint`, nearest-fill) and
   repaint the plate with the same palette.
4. **Redraw movers per frame, never warp pixels.** Cloth: convert its drawing to indices
   of its own ramp, clean them into solid clusters (`clean_index` — leftover texture
   sparkles when cloth moves), rebuild the shape from moving edges each frame (whole
   columns/rows), and let folds travel as ±1 ramp steps where the wave turns toward the
   light; keep the rim highlight. Plants: rooted at the bottom, tips bend most, gusts
   travel across the bushes so each plant moves at its own time. Characters: a clean
   blink (lid line drawn pixel by pixel), a few short fur tufts swaying — no light sweeps
   across a character (read as a weird glare).
5. **Animate cloth and plants on twos** (hold each pose two frames); lights, water and
   mist stay smooth. This alone cut shimmer on the cloth from 13% to 0.2% of its pixels.
6. **Keep the atmosphere that worked**: castle windows and lanterns flickering with
   breathing glow pools, moon halo breathing, waterfall streaks + irregular foam, water
   rows rippling sideways + reflection sparkles, mist as two noise fields cross-fading,
   petals tumbling past with fade-in/out.
7. **QA with `inspect_frames.py`**: flicker under ~1% outside deliberate effects
   (sparkles, flames), loop seam ≈1–1.5× a normal step. Then look at 4-frame strips.
8. **Deliver**: GIF at the reference size; for Pixelorama the native frames 1:1 (one file
   pixel = one art pixel) plus a spritesheet (e.g. 4×4) to import as a spritesheet;
   enlarged ×4 frames for viewing.

**E. Living location** («сделай каждую картинку отдельной живой локацией»: огни
мерцают, лава течёт, лес на ветру). The default for "animate this scene / make it
alive", and for a collage: cut it into tiles, one location each. Start from the
`living_locations/` example closest in mood and adapt its masks.
1. **Grid: finest first.** `Location(ref, grid=1, unit=2)` — every reference pixel is
   an art pixel. A coarser grid on a soft AI image reads as "bitten" edges (user's
   words: «изображение покусали») and drops the tiny lights that make a scene. Only
   go coarser when the reference has real, regular blocks (zoom_grid.py shows them).
2. **Masks by colour inside boxes** (design units), then `--masks` overlay, then look.
   Lights must be bright points in the dark (`uniform_filter(L) < 0.3`); in daylight
   scenes auto lamp detection catches sunlit highlights — give explicit boxes.
3. **Pick effects by what lives there**: fire → `Flame` (+ `Particles('ember')`),
   lit windows/lanterns → `Lights`, lava lake / pond → `Liquid`, falls → `Fall`,
   reflections → `Ripple`, fog/spray → `Mist`, chimneys → `Smoke`, wind → `Sway`,
   `Banner`, `Particles('leaf')`, hanging things → `Swing`, ambient life →
   fireflies / dust / drips / birds / butterflies, slow light change → `Breathe`.
4. **Render, QA, look**: `inspect_frames.py` (flicker < ~2% outside fire/particles),
   `frame_strip.py` on every effect next to the reference crop. Fix and re-render.
5. **Deliver** `<name>_x2.gif` for viewing, `<name>.gif` at the tile size,
   `_sheet.png` for Pixelorama, `_still.png`.

Lessons from approach E (each was a visible defect first):
- Liquids: `flow=(dy, dx)` (flow-map: two drifting copies cross-fading) instead of a
  circular churn; ridged `veins` flip pixels back and forth — keep `veins=0`. A lake
  seen low is streaky: `stretch=(6, 1)`, `persp=(y_far, y_near, 0.45)`, row-only
  cleanup `clean=(1, 3)`, `keep≈0.5` of the painter's light layout.
- Falls: `octaves=1`, lava `speed=u`, water `2u` px/frame; `keep≈0.7` and a vertical
  median so thin white streaks survive; never close/fill a fall mask (ropes, posts and
  rocks in front of it would be painted over).
- Flames: size each one by its hot core (`L > 0.78`), not by its glow, or candles
  become bonfires. Candle cores in warm halls are near-white (`L > 0.8 & S < 0.4`).
  Merge split fragments with a 1-px dilation, not more (neighbouring candles merge).
  The flame's edge ripples and its axis wobbles — a clean cone looks like a sticker.
- Glow pools breathe slowly (2 cycles/loop); only the flame flickers fast.
- Banners: everything that is not the cloth colour (cross, trims) is "emblem" and
  keeps its colour; folds never push cloth into the darkest ramp step.
- Smoke by day: mid-grey (≈ #c4c0ca), flat-topped puffs — white smoke vanishes into
  clouds.
- The repaint palette stays fixed when effect colours are merged in (else the whole
  picture shifts colour).

**F. Photo → pixel art (+ animation)** («нарисуй это фото как пиксель-арт»). Keep the
likeness and the photo's light, move it into the user's colour world, then animate it
with approach E. `examples/photo_portrait.py` is the worked script (sunset portrait in
fog). Steps:
1. `convert(photo, width=320, colors≈56, grade_k≈1.4, sat≈1.35, style=<ref style.json>,
   style_mix≈0.35)`. 300–360 art px across keeps a face readable (~40 px) while every
   pixel still shows at ×4.
2. A plain resize is a "low-res photo", not pixel art. What makes it read as pixel
   art: flat clusters (median before reduction), a small palette, Bayer dither ONLY in
   smooth gradients (sky, fog, skin) so they become short dithered steps instead of
   posterized bands, crisp edges, outline only on very strong edges (interior outlines
   on hands looked dirty).
3. Foliage in photos is bokeh: `leaf_clumps(img, mask, light=sun_xy)` on the crowns
   against the sky only (on misty midground it draws worm-like noise).
4. Feed `big.png` to `Location(big, grid=scale, unit=1, n_colors=200, sharpen=0,
   denoise=False)` — the art is final, the Location must not repaint it.
5. Animation on a dithered picture: `Mist(..., dither=True)` (a smooth tint snaps into
   blotches); sway only foliage that touches sky (a solid block shears at its box
   edges); a horizontal flying lock of hair is a `SheetX` held at the head, not a
   `Sway` (rows-only motion barely moves it); the face stays still.
6. Faces: keep the photo's own shading; at ~40 px the eyes/lips read without redrawing.
   A real person's photo is their likeness — don't add or change features unasked.

### 3. Draw
Write one Python script per piece (keep it — it's the editable source). Fill the whole
canvas first (a full-height sky gradient): any pixel left unpainted comes out as a black
hole. Typical skeleton:

```python
import sys; sys.path.insert(0, 'SKILL_DIR/scripts')
from pixel_canvas import Canvas, load_style
st = load_style('styles/ref/style.json')
W, H = st['native_size']
cv = Canvas(W, H, st['hex'])
sky = [cv.near('#1a1a2e'), cv.near('#5b557f'), cv.near('#d06174')]
cv.vgradient(0, H, sky, band=0.3)          # flat bands, short dithered transitions
cv.clouds(10, 50, [cv.near(c) for c in ('#26232d', '#3b394a', '#78484c', '#b2726e')], light=(214, 66))
cv.ridge(H * 0.62, amp=20, color=cv.near('#4a4762'), seed=2)
...
cv.save('out/knight', scale=st['scale'])
```

`cv.near(colour)` turns any colour you have in mind into the nearest palette colour, so
you can think in colours and stay on palette. Before any `glow`, call
`cv.lit_colors(light_colour)` so the light pool has in-between colours to snap to;
without them a glow jumps straight to the light colour. Keep dithering short and sparse
(`band≈0.3`, glow `dither≤0.15`): wide Bayer dithering reads as a mechanical screen,
which is the most obvious "made by code" tell. Use `cv.noise` for anything organic —
mist, rock strata, cloud edges — instead of regular patterns or modulo tricks. Feel free to add your own helpers in the
piece script; the library is a starting point, not a cage. For variants, load
`native.png` into `cv.rgb` and paint over it.

### 4. Check, then look
Run `check_art.py out/x_native.png style.json --enlarged out/x.png` (add
`--palette out/x_palette.json`, written by `save`, when you extended the palette —
variants and glows do). Then open the
enlarged PNG (and a 2–4× crop of the focal area) with Read and judge it as an artist:
- Does the silhouette of the subject read instantly?
- Is the focal point the clearest value contrast in the picture?
- Do the layers separate (near dark, far light)?
- Any noisy pixel salt, stray single pixels on edges, or banding (parallel stair-steps)?
- Any black holes (unpainted areas), mechanical dither screens, regular stripes?
- Next to the reference, would it look like the same artist on a different day?
Fix and re-render at least once; first renders almost always have a weak spot. In the
test runs every first render had 3–5 visible problems; two or three rounds is normal.

### 5. Deliver
Give the user the PNG at the reference's original size (the enlarged file), and for
animations the GIF plus the `_frames` folder of PNGs (send them individually or zipped
if there are many). Keep `_native.png` and the drawing script in case they want edits.
In the reply: one or two sentences on what you made and which style traits you carried
over; mention any honest limitation that affects their use of it. An original piece
drawn from scratch will be simpler than a dense reference scene — say so plainly rather
than overselling it, and offer the variant route (building on their own pixels) when
that would serve them better.

## What this user has told us (keep improving toward it)
- Wants maximum detail and resolution, and the reference reproduced at least as well as
  the original — then every object animated on its own.
- Every picture of a set should become its own living location (GIF): flickering
  lights, flowing lava, wind in the forest. A 2× grid on their AI-made tiles looked
  "bitten" — use grid=1. Ask for full-size originals when a tile is small.
- Wants the skill to get better at the style itself, so "draw X in pixel style" lands
  close to these references (dark fantasy + cosy village, rich light, warm lamps vs
  cool shadows, castles, waterfalls, mist, banners with crosses).
- Liked: the moonlit village animation (calm, local: light flicker + waterfalls), the
  castle's living window light, water, mist, drifting petals.
- Disliked: anything that looks like a piece of the picture cut out and distorted (warped
  cloth, warped flowers), shimmer/ripple, a light sweep over the cat's head.
- After each piece, fold what made it better into this skill and save a new version.

## Notes
- Output size: match the reference's source size via an integer scale. If the source
  size isn't divisible by the scale, crop or pad the native canvas by a pixel and say so.
- Several references with different grids: use the grid of the one closest to the request.
- If the user's images are not pixel art at all (photo, painting), say so and offer to
  convert their palette/mood into pixel art rather than pretending to match a pixel style.
- Don't copy an existing copyrighted character or game asset on request; draw an
  original subject in the user's style instead.
