---
name: "detailed-rendering"
description: Detailing pass for any drawn image in any style — pixel art, painterly, flat/vector-like, dark fantasy or cosy — makes every object detailed, textured, logically constructed and alive, and removes artifacts. Builds objects by construction (what they are made of, what holds them up), renders materials (stone courses, roof tiles, planks, bark, rock strata, moss, grass, foliage, cloth, glass, water foam), adds volume and shadows (cylinder/plane shading, ambient occlusion, cast shadows from lights, contact shadows), places everything on real ground (nothing floats), then finds and cleans artifacts (lone pixels, specks, jaggies, floating parts) and records lessons so each next image is better. Use whenever an image is being drawn or improved and the user asks for more detail, texture, realism, shadows, quality, cleaner result, or complains that something floats, overlaps, looks fake, flat, noisy or strange — in any language, e.g. «сделай детальнее», «больше текстуры», «больше теней», «как по-настоящему», «убери артефакты», «висит в воздухе», «налезает», «выглядит странно», «проработай каждый объект».
---

# Detailed rendering (any style)

A process + a small code kit for turning a composed image into one where every
object reads as a real, built, lit thing. It sits on top of whatever produced the
image (a drawing script, an animation pipeline, a photo conversion). Style decides
the palette, the pixel size and how much texture; the logic below never changes.

Files:
| file | what it is |
|---|---|
| `references/process.md` | the detailing pass step by step + per-object checklist |
| `references/materials.md` | how to render each material (stone, wood, metal, cloth, glass, rock, bark, foliage, grass, water, snow, skin-free props), in pixel and painterly variants |
| `references/lessons.md` | running log of corrections — read it first, append to it last |
| `scripts/objects.py` | `Kit` (built things: masonry, roof tiles, planks, round towers, walls, windows, gates, buttresses, ivy, banners, pennants) and `Nature` (rock with strata and cracks, boulders, pebbles, moss, grass tufts, bark, foliage, wet streaks, foam lines, `ground_y`, `contact_shadow`, `cast_shadow`) |
| `scripts/artifact_check.py` | finds salt (lone pixels), dust specks, jaggies, floating components, rare colours; `clean()` fixes them, protecting stars/lights |
| `scripts/pixel_canvas.py`, `scripts/fx.py` | the canvas the kit draws on (palette-snapping optional) and tiling noise |
| `examples/kit_test.py` | a small test sheet of the kit — run it to see each builder |

## The pass (short form — details in references/process.md)
1. **Read `references/lessons.md`.** Don't repeat a logged mistake.
2. **Construct**: for each object answer *what is it made of, how is it built,
   what holds it up*. Place it from the ground mask (`Nature.ground_y`), sink the base,
   contact shadow. Draw back to front. Joins are logical (roof on a cornice, banner on
   a rod, fall from a cave or lip — never from a tree line or out of the sky).
3. **Material texture by construction** (`Kit.masonry`, `roof_tiles`, `planks`,
   `Nature.rock`, `bark`, `foliage`, `moss`, `grass_tufts`): tone varies per unit
   (block, tile, plank, leaf cluster), joints one step darker, never raw noise.
4. **Volume and shadow**: cylinder / plane shading, AO at the foot, overhangs cast
   shadows, `cast_shadow` from every strong local light (lantern, fire, window) onto
   the ground near it, rim light only on edges facing the light.
5. **Explaining details**: 3–6 per object, densest at the focal point (frames and
   sills, corbels, cracks with lit lips, moss in crevices, knots in bark, veins in
   leaves, planks and an oar on a boat, a cave mouth for a spring).
6. **Light**: emitters get a gradient core, a reveal, spill; mark them emissive so
   shadow / vignette passes skip them.
7. **Clean**: `artifact_check.py STILL OUT --masks M --ground G --protect stars,lights`
   → fix floating parts by construction, `clean()` the specks; then brighten the image
   ×2 and inspect it in crops region by region. Repeat until clean.
8. **Animation hygiene** (if animated): animate only the material that moves — water
   masks exclude rock, plants, props and their reflections' owners; light pools are
   not animated over textured surfaces (they read as liquid); thin movers paint out
   only their own pixels.
9. **Record**: append to `references/lessons.md` what the user corrected and what
   you found in review, as one-line rules. Promote rules that repeat into process.md.

## Style adapters
- **Pixel art**: draw at the art grid, snap to the palette (`Canvas.save`), 1-px rims,
  dither only in gradients; block/tile sizes scale with distance (near 6×3, far 4×2).
- **Painterly / high-res**: same builders at a larger grid with a big palette (or no
  snapping: use `cv.rgb` directly), soften joints by one tone, use 2–3 px rims, add
  a light blur only to atmosphere layers, never to object edges.
- **Flat / graphic**: keep construction and shadows, drop per-unit texture to 1–2
  tones, keep contact and cast shadows (they carry the realism).
Whatever the style: the realism comes from logic (support, joins, light direction,
shadows), not from noise.
