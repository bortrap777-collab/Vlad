# Detailing pass — making every object detailed, logical and clean

A sub-skill of pixel-art-style. Run it on every object that matters (the focal
subject always, then anything large or close), after the composition works and
before animating. Tools: `scripts/objects.py` (Kit: detailed builders),
`scripts/artifact_check.py` (find / fix artifacts), `references/lessons.md`
(what earlier pieces taught — read it first, add to it last).

## 0. Before drawing: read lessons.md
Skim the newest entries. They are the user's corrections and the defects found in
review; repeating one of them is the most expensive mistake.

## 1. Construct before you texture (logic)
Ask of every object: what is it made of, how is it built, what holds it up?
- **Stands on something.** Find the support surface from the ground mask
  (`ground_y`), sink the base 1–3 px into it, add a contact shadow. Nothing floats.
- **Parts connect.** Roof sits on a cornice/corbel band; a band sits on the wall; a
  bridge ends on stone at both sides; a fall leaves from the cliff's own lip; a
  banner hangs from a rod; a lantern hangs from a hook.
- **Back to front.** Draw what is behind first (far towers, hall), then what
  covers it (keep, curtain wall, gatehouse). Bases of back parts are hidden by front
  parts, never by accident.
- **Scale is consistent.** Doors ≈ 1.5× a person, windows smaller up high, stones
  smaller on far parts (block size ∝ distance), merlons the same size along a wall.

## 2. Material texture follows construction
- Stone: staggered courses (`Kit.masonry`), block tone ±1 by hash, mortar ONE
  step darker (not black), lit top row, rare cracks. Block size: near 6×3, far 4×2.
- Roofs: overlapping tile rows (`Kit.roof_tiles`), lip shadow, lit half + rim on
  the light side, dark outline on the far side. Cones are bell-shaped with flared eaves.
- Wood: planks with dark seams (`Kit.planks`); metal: 1-px highlight + dark outline.
- Foliage / ivy: 2-px leaf clusters, darker inside, lit leaf edge toward the light;
  climbs from the ground and thins upward.
- Never fill a material with raw noise. Noise only varies tone per unit (block, tile).

## 3. Form shading on top (volume)
- Round things: `cyl_shift` — light side up to +1, far side −1, rim on the light
  edge, outline on the dark edge. Flat walls: one tone plane + AO at the foot.
- Overhangs cast shadow: under eaves, corbels, sills, merlons, bridges (1–2 px).
- Texture never moves a pixel more than one ramp step from its form tone, or the
  form dissolves into noise.

## 4. Details that explain the object (interest)
Pick 3–6 per object, not all: window frames + sills + mullions, a lit doorway
with voussoirs and a keystone, corbels / machicolations, arrow slits, buttresses,
a balcony, a chimney with smoke, banners and pennants (they animate), ivy, moss,
torches by the gate, a bell in a belfry, a lit stair window climbing a tower.
Place them with intent: more detail near the focal point, less at the edges.

## 5. Light it
Every lit opening: glass gradient (brightest low/centre), reveal shadow at the top,
spill on the wall below. One cold accent (teal) is allowed for mystery. Add lit
parts to `kit.emissive` so the vignette / shadow pass skips them.

## 6. Clean up (artifacts)
Run `artifact_check.py STILL OUT --masks masks.npz --ground ground --protect stars,lights`
- **salt** (lone pixels), **dust** (2–3 px specks), **jaggies** (1-px notches in
  straight edges), **floating** components, **rare** colours.
- Fix by construction first (move the object, change the mask). Use `--fix` only for
  leftovers inside textures. Stars, eyes, sparkles are protected, not "fixed".
- Then look: brighten the still ×2, inspect it at 2–4× in crops, region by region
  (sky, background, subject, water, foreground). Write down every defect, fix, re-run.

## 7. Improve and record
After the piece: append to `references/lessons.md` what the user asked for, what
was wrong in your first render, and the rule that fixes it (one line each). Promote
a lesson into SKILL.md / this file when it repeats. This is how the style and the
quality keep improving from piece to piece.

## Checklist (copy into your notes per object)
- [ ] stands on / hangs from something real; contact shadow
- [ ] built back to front; joins are logical
- [ ] material texture by construction; mortar/joints one step darker
- [ ] volume reads at 1×: light side, dark side, rim, AO
- [ ] overhangs cast shadows
- [ ] 3–6 explaining details, densest at the focal point
- [ ] lights: gradient, reveal, spill; marked emissive
- [ ] artifact_check clean (or justified), crops inspected
- [ ] lessons.md updated
