# Pixel-art craft notes

Read before drawing characters, close-ups or animation. These are the rules that make
code-drawn pixel art look hand-made instead of filtered.

## Contents
1. Values and ramps
2. Clusters, lines, edges
3. Dithering and texture
4. Characters at large sizes
5. Light in dusk/night scenes
6. Animation

## 1. Values and ramps
- Each material (stone, fur, cloth, metal, foliage) gets a ramp of 3–5 palette colours
  from shadow to highlight. Use `cv.ramp(dark, light, n)`.
- **Hue shift**: shadows move toward blue/violet, highlights toward warm yellow/orange.
  A ramp that only changes brightness looks dead. With these dusk palettes the "free"
  shadow colours are the indigo/violet darks.
- Value carries the picture. Squint (or downscale 4×) — if the focal point disappears,
  increase its value contrast, not its detail.
- Keep the brightest whites and most saturated accents to small areas; their rarity is
  what makes them glow.

## 2. Clusters, lines, edges
- Paint in clusters (groups of same-colour pixels), not scattered singles. A lone pixel
  should be a deliberate highlight, eye, star or window.
- Clean lines: diagonal steps should be regular (1:1, 2:1, 3:1). Irregular steps
  ("jaggies") read as mistakes. PIL polygons at native size are mostly fine; check edges
  of the focal subject by eye and fix with `cv.px`.
- Avoid **banding**: two parallel outlines stepping in sync look like a staircase. Break
  one of them or vary the step.
- Outlines: use a dark colour from the material's own ramp or the deepest violet, not
  pure black. On the light side of a form the outline may drop out entirely (rim light
  replaces it). Background elements usually have no outline at all — silhouettes only.
- Manual anti-aliasing: at the inner corner of a curve, one pixel of a mid tone between
  shape and background softens the curve. Use sparingly and only on the focal subject.

## 3. Dithering and texture
- Ordered (Bayer) dithering for sky gradients, mist, glow falloff — `vgradient`, `glow`,
  `dither_between`. Restrict it to transitions; full-area dither looks like noise.
- Stone and foliage: chunky texture (`texture(..., cluster=2)`) in 2–3 neighbouring ramp
  colours, denser toward the shadow side.
- Mist between layers: a band of `dither_between(mask, layer_colour, mist_colour, t)`
  with t fading upward; it is what gives these scenes their depth.

## 4. Characters at large sizes (40–120 native px tall)
- Start with the silhouette in one colour; it must read without any interior detail.
  Exaggerate pose and the one or two shapes that define the character (cape, helmet
  plume, ears, weapon).
- Proportions for a heroic figure: head ≈ 1/6–1/7 of height; for a cute/chibi figure
  the head can be 1/3. Match the reference: the cat knight is stylised and soft.
- Face: at this size two dark pixels for eyes and a 1–2 px highlight are enough. Don't
  draw a mouth, nose, fingers unless the reference does at this scale.
- Armor: a dark base, mid plates, a hard 1-px highlight line along the edge facing the
  light, and one bright specular pixel per major plate.
- Cloth (capes, banners): big curved folds, 2–3 tones, dark at the inside of each fold.
- Place the character so its brightest part (fur, face, blade) is against the darkest
  background nearby.

## 5. Light in dusk/night scenes
- The key light is usually low and behind (sun/moon at the horizon): forms get a warm or
  pale rim on the light side and are dark on the viewer's side.
- Artificial lights: a core (2–4 brightest pixels), a halo (dithered glow), and light
  spill on surfaces below/around (ground, wall, water reflection as broken horizontal
  dashes).
- Water: darker than the sky above it; reflections are vertical columns of horizontal
  1-px dashes under each light, broken by darker rows.

## 6. Animation
- Change only what moves; everything else is pixel-identical between frames (this also
  keeps GIFs small and calm).
- Loops: drive everything with `phase = i / n`, use `sin(2π·phase)` or offsets that wrap
  by an exact number of texture periods, so frame n+1 == frame 1.
- Lantern flicker: vary glow strength 0.75–1.0 with two sine waves of different
  frequency (both integer cycles per loop) — reads as fire, not a blink.
- Waterfalls / streams: a vertical streak texture shifted down 1–2 px per frame; texture
  height must divide evenly into the loop length × speed.
- Smoke: a few dithered puffs rising and drifting, fading by reducing their pixel density.
- Character idle: 1-px vertical bob of torso/head over 4–8 frames; cape tip lags one frame.
- Timing: 80–150 ms per frame; 8 frames for ambient loops, 4–6 for a walk cycle step pair.

## 7. Cloth, plants and character life (learned on the cat-knight piece)
- Never bend existing pixels with a displacement field: per-pixel resampling of noisy
  texture shimmers and reads as "a cut-out piece being distorted". Rebuild the object
  each frame from its shape (edges, rows, columns) and shade it from its ramp.
- Before moving cloth, simplify its texture into solid clusters (median on ramp indices).
- Folds = the slope of the wave: the side turning toward the light is one ramp step
  lighter, the side turning away one darker. Keep the rim highlight on the silhouette.
- Anchors: a cape is held at the neck, a banner at its pole, a plant at its root, a tail
  at the body; motion grows toward the free end (u^1.2–1.6) and the free end lags.
- Wind is one gust travelling through the scene: phase = time + x / wavelength, so
  neighbouring objects move one after another, not in sync.
- Animate cloth and plants on twos (each pose held 2 frames); keep light and water on ones.
- Character life: blink once per loop (open → half lid → closed arc → half lid), a few
  short fur tufts swaying at the windward edge. No sheen/light sweeps over faces.
