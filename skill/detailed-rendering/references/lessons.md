# Lessons log (newest last) — read before a piece, append after it

Shared with pixel-art-style; the rules are style-independent unless noted.

Format: piece — what happened → the rule. Promote rules that repeat into SKILL.md.

## Animating the user's references
- cat knight — warped cloth/flowers looked like cut-out pieces → redraw movers from
  their ramp every frame; never resample pixels.
- cat knight — light sweep over the face looked like glare → no light sweeps on characters.
- 6 locations — 2× grid on AI tiles looked "bitten" («покусали») → grid=1 on soft
  references; ask for full-size originals when tiles are small.
- lava — ridged veins flipped pixels back and forth → flow-map drift, veins=0.
- lava/falls — thin streaks at 2 px/frame flickered → octaves=1, slower lava.
- falls — 3×3 median erased white streaks; closing pulled ropes into the mask →
  vertical-only cleanup, never close a fall mask.
- candles — sized by glow became bonfires → size flames by their hot core.
- banners — folds pushed cloth into the darkest step (black holes) → fold floor at 1.
- palette merge moved the whole picture's colours → keep the repaint palette fixed.

## Photo → pixel art
- plain resize = low-res photo → median smoothing, small palette, dither only in
  smooth gradients, selective outline.
- smooth tint on a dithered picture snapped into blotches → dithered Mist.
- horizontal hair lock barely moved with row sway → SheetX held at the head.

## Original landscapes
- moon lake v1 — flat at 384 px → draw at 2×, shapes in design units.
- v1 — 1-px lit cloud rims read as lightning → lit bands 2–8 px deep, remove filaments.
- v1 — noise rock read as crumpled foil → height-field crag shading, broad scales far.
- v2 — Sway's dilated plate erased the lantern under the moss → exact plates for movers.
- v2 — user: pines float in the air → plant everything from the ground mask (ground_y).
- v2 — user: mountains like a wall right behind → hazy receding layers.
- v2 — user: castle too small / not grand → castle = composition of parts.
- v2 — user: more shadows, cinematic → near-black foreground, vignette sparing
  lights, moon rays, saturation only in lights.
- v3 — foreground tree vanished against the dark cliff → silhouettes go against
  lighter backgrounds.
- v3 — uniform dithered mist band read as a filter → patchy mist (thresh/gain).
- v3 — user: castle must be far more detailed → detailing pass with objects.Kit:
  masonry courses, tile rows, cylinder volume, corbels, framed lit windows,
  voussoir gate, ivy, banners/pennants; then artifact_check.
- kit test — mortar at index 0 made a black brick grid → mortar one step darker.
- kit test — 2-row tiles with black lips read as dots → 4×3 tiles, lit half + rim.
- moon lake v4 — glows and the vignette on textured stone left ~16k lone pixels →
  `artifact_check.clean()` before saving the still (protect stars and lights).
- v4 — re-quantising the still to 256 GIF colours added salt again → Location cleans
  its base (`clean_base=True`).
- v4 — animated window glow pools speckled the masonry → when the still already holds
  the spill, animate the core flicker only (glow strength ≈0.03).
- artifact_check — dither checkerboards were reported as jaggies → a jaggy needs a
  straight run (2 equal neighbours on each side).
- moon lake v5 — user: far ruins "ни к селу ни к городу" → remove props with no
  story reason or support; every prop must belong to the place.
- v5 — user: right fall flowed "from the trees" → falls start at a lip or a cave mouth
  in the rock face, below the forest; never a see-through notch at a slope edge.
- v5 — user: rock and mushrooms "pretended to be liquid" → the water effect's mask is
  water minus every solid (rock, props, plants, boat, pads), dilated by 1 px.
- v5 — mushroom glow pools animated on rock read as liquid → no animated light pools
  on textured surfaces; pulse the emitter only.
- v5 — the new rock texture vanished in the vignette → lift the foreground ramp one
  step and ease the vignette when detail is the point.
- v5 — user: more texture/shadow on every object → Nature kit: rock strata + cracks,
  moss, pebbles, grass, bark with knots, boulders at the waterline, foam lines,
  planks/oar on the boat, lily veins, cast shadows from the lantern.
