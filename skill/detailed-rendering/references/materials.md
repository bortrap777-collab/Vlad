# Materials — how to make each one read as real (any style)

Ramps are dark → light. "Step" = one ramp colour. Pixel art: 4–6 steps per material;
painterly: 8–12 steps or continuous, same logic.

| material | construction (what makes it read) | kit call | common mistakes |
|---|---|---|---|
| **Cut stone wall** | staggered courses; block tone ±1 by hash; mortar one step darker; lit top row; rare cracks; AO at the foot; moss at the base | `Kit.masonry(mask, ramp, bw, bh, shift=...)` | black mortar grid (brick look), noise instead of blocks, same block size near and far |
| **Round tower** | cylinder shading (light side +1, far side −1, rim on light edge, outline on dark), corbel band with gaps and shadow, cone roof with flared eaves | `Kit.round_tower` | flat tower, roof floating above the body, no shadow under eaves |
| **Roof tiles / slate** | rows overlapping; lit top pixel per tile, dark lower lip; lit half + rim facing the light; outline on the far half | `Kit.roof_tiles(mask, ramp, axis_x=...)` | dotted rows (tiles too small), both halves equal |
| **Window / opening** | frame lit on the light side, dark reveal at the top, glass gradient (bright low centre), mullion/transom when wide, sill + 1-px shadow, spill on the wall | `Kit.window` | a flat orange rectangle, no sill, light pool animated over stone |
| **Gate / arch** | voussoir ring (alternating tones), keystone, reveal, portcullis lattice, warm interior | `Kit.gate` | arch without thickness |
| **Wood / planks** | plank seams, tone per plank, end grain darker, a lit gunwale/edge | `Kit.planks` | single flat brown |
| **Cloth / banner** | hangs from a rod, vertical folds, emblem keeps its colour, swallowtail, rim on light edge | `Kit.banner`, `Kit.pennant` | folds pushing cloth into black, cloth without support |
| **Natural rock / cliff** | height-field facets lit from the light, bedding planes (strata) with lit lip + shadow under, cracks with lit lower lip, moss on upward faces, wet dark streaks near water | `Nature.rock`, `Nature.moss`, `Nature.wet` | crumpled-foil noise, uniform scale near and far |
| **Boulders / pebbles** | sit half-sunk on the ground they touch; lit top, dark base, contact shadow | `Nature.boulders(ground, ...)`, `Nature.pebbles` | stones floating on water or sky |
| **Bark** | vertical furrows following the trunk, lit ridge on the light side, knots (dark ring + lit rim), roots gripping the ground | `Nature.bark` | a black stick, tree placed where its silhouette vanishes |
| **Foliage / crowns** | leaf clusters (discs) darker inside, lit edges toward the light, dark gaps | `Nature.foliage` | speckle noise, flat blob |
| **Grass / ferns** | blades rooted on the surface, lean with the wind, lit tips | `Nature.grass_tufts` | blades starting in the air |
| **Moss / ivy** | grows on tops, crevices and wall bases, thins upward, 2-px clusters | `Nature.moss`, `Kit.ivy` | uniform green film |
| **Waterfall** | starts at a lip or a cave mouth in the rock face; streaks; ragged bright lip; foam + spray at the base; wet rock beside it | (scene code) + `Nature.wet` | water falling from a tree line, a white bar at the top, a see-through notch |
| **Lake / still water** | darker than the sky, mirrored reflections broken by ripples, fading with distance, light paths as dashes, foam line where it touches rock | `Nature.foam_line` | reflections of the wrong object, animated ripples spreading over rock |
| **Glow / emitters** | core gradient, halo, spill; emissive mask protects from shadows | `cv.glow`, `kit.emissive` | glow pools speckling textures, double-lit (still + animation) |

## Shadows checklist
- **Contact**: every object touching the ground darkens it right under its base.
- **Cast from local lights**: `Nature.cast_shadow(light_xy, occluders, receiver, radius)`
  — tree trunks, posts and people near a lantern throw long shadows away from it.
- **Overhangs**: eaves, corbels, sills, balconies, merlons — 1–2 px below them.
- **Key light (sun/moon)**: faces away from it one or two steps darker; objects in
  front of a backlit subject sit in its shadow.
- **Atmosphere**: far layers lighter and lower contrast; foreground darkest.
