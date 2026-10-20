# Living locations (approach E) — worked examples

Six scenes from one reference collage (2 × 3 tiles, each ~766 px wide), each turned
into its own looping location: the static picture is repainted once, and everything
that lives is redrawn every frame by an effect from `scripts/fx.py`.

| script | what lives in it |
|---|---|
| `lava.py` | lava lake flowing (flow-map drift + perspective), 6 lavafalls, 4 brazier fires, embers, heat light breathing on the rock |
| `throne.py` | 45 candles detected automatically (pale cores), stained glass breathing, banners in a draught, candlelight trembling in the polished floor, dust in the window light |
| `dungeon.py` | wall torches + candles, cages swinging on chains, waterfall + pool ripple + spray mist, drips from the vault, wet floor glints |
| `castle.py` | banners in the wind, brazier + sparks, hundreds of windows and bridge torches flickering, waterfalls, rolling mist, moon halo |
| `forest.py` | lanterns, 50 fireflies, waterfall behind the rope bridge, stream ripple + lantern reflection, mist, flowers and ferns in the breeze, falling leaves |
| `village.py` | chimney smoke, tavern banner, tree crowns / bushes / flower beds in travelling gusts, birds, butterflies, falling leaves |

Run from a work folder that holds `refs/<name>.png` (the cropped tile):

    python <skill>/examples/living_locations/lava.py --masks   # tmp/lava_masks.png: check masks first
    python <skill>/examples/living_locations/lava.py           # out/lava/...

Coordinates in the scripts are **design units** (`unit=2`: half the tile size), the
art grid is the tile itself (`grid=1`). `L.box()`/`L.clean()` take design units;
positions and sizes handed to effects are multiplied by `u`.

Cutting a collage into tiles: find the separator rows/columns (low variance, bright
line) and crop each tile to an even size.
