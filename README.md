# Rain World Desktop

A living, Rain World-inspired ecosystem for your desktop background.
Procedurally animated creatures climb your windows, desktop icons and taskbar,
hunt each other, forage, react to your cursor, and shelter from the rain at
the end of every cycle.

Everything is plain JavaScript + `<canvas>`, with no build step and no dependencies.

## Try it

- **Browser prototype**: open `index.html` (or the hosted copy at
  <https://nickssoftwarefun.github.io/Rain-World-Desktop/>). It shows the
  wallpaper on its own. Desktop windows as ledges and walls for the creatures
  are a feature of the real wallpaper: `wallpaper.html` in Lively, with the
  helper (below). (`index.html?desktop=1` puts a mock Windows desktop on top
  for testing that in a browser.)
  - Press **`** (backtick) or the ≡ button for the **ecosystem panel**.
  - **Drag** a creature (living or dead) to pick it up: it hangs limp from
    the cursor and drops where you let go. (Clicking bare wallpaper to drop
    a dangle fruit is still available as a panel toggle, off by default.)
  - **Rest the cursor** near creatures: lizards stalk and snap at it, slugcats
    come and look at it, Daddy Long Legs reaches for it, Dropwigs drop on it.
- **Creature gallery**: `gallery.html?spawn=lizard_pink@200,300;slugcat@400,300`
  puts chosen creatures in a small test room (see the comment at the top of the file).
- **As your real Windows wallpaper**: see [`windows/README.md`](windows/README.md).

## The creatures

| Creature | Behaviour |
| --- | --- |
| **Lizards** (pink, green, blue, white) | Verlet spine, 4 IK legs stepping in a diagonal gait, hinged jaws. Hunt slugcats, centipedes and batflies; lunge and carry prey off. Pink climbs walls and poles; blue also ceilings; green is big and floor-only; white climbs everything and camouflages when stalking. Pole climbers leap between nearby poles (smaller lizards jump further) and scramble up over a ledge lip from the pole beside it. Greens keep to the ground; the others stake out territory on the middle and top tiers. |
| **Slugcats** (Survivor, Monk, Hunter) | Platformer physics: walk, climb poles, jump between ledges and poles, and scramble up onto a ledge from a pole beside it. Transients: they come in by one pipe, eat two things (one fruit and one meat when both are about), then leave by the farthest pipe. They knock ripe fruit down and batflies out of the air with rocks and spears. |
| **Daddy / Brother Long Legs** | Pulsing knot of rot bulbs with glowing spots. Its tentacles grope for anchors and haul the body along; anything in reach is seized and reeled in. Transients too: two meat meals, then out through the farthest pipe. |
| **Dropwigs** | Spiny ambushers that wait flattened against ceilings (window undersides!) and drop onto prey passing below. Prey can't see them while they lurk. |
| **Batflies** | Flocking prey that hatch from a nest hanging under a ledge (every map has one; it lets out a new flock when they run low), roost on it and on grass and pole tops, and scatter from danger. |
| **Small centipedes** | Armoured segments rippling over any surface on a wave of legs. |
| **Noodleflies** | A family passing through: an adult (a long crook-shaped body with a needle for a mouth and a long hanging tail) and its brood of infants, flying about it or clinging to its tail. Adults stalk lizards and anything smaller, wind up and stab, and feed on the wing; after two meals the family leaves by the farthest pipe. Grab or kill an infant and it cries out: the nearest adult hunts whoever was closest. Infants are prey for slugcats (who knock them down with rocks) and centipedes. |
| **Squidcadas** | White and black slugcat-sized fliers with buzzing wings and squid arms, in small flocks. They circle each other in play, rest on ledges when tired, snatch batflies and small centipedes, now and then headbutt a slugcat, and gang up on whatever grabs one of them. Lizards and centipedes catch fliers that come low. |

## Configuring

All defaults live in [`js/config.js`](js/config.js). The panel edits them live
and saves to `localStorage`. Its sections open and close when you click their
titles.

- **Presets** (top of the panel, and in Lively's Customise panel):
  - **Size**: Compact, Normal (the default), Large, XL. Sets the map size,
    population, spawn rate, rocks and spears, and each species' cap. Picking
    a size also puts the World and Rain cycle settings back to their defaults. Bigger
    maps get more rows of ledges and proportionally more poles, fruit plants
    and batfly nests, so there's no empty space. Compact is the old default.
  - **Wildlife**: Balanced (the default), Lizard turf wars, Slugcat hunters,
    Centipede hunt, Ambushers, Daddy's buffet, Flyers, Peaceful. Sets the spawn
    weights to show off a set of behaviours; creatures that aren't in the new
    mix walk off to a den.
  - Changing a setting a preset governs by hand switches that preset to
    *Custom*. In Lively, pick *Custom* to use the individual sliders.

- **Spawn weights**: when the spawner adds a creature it picks a species at
  random in proportion to `weight`, among enabled species below their `max`.
- **`ecosystem.maxPopulation`**: the total the spawner keeps the screen near.
  Each species has a `popCost` (a batfly counts 0, a Daddy Long Legs 4).
- **Level layout**: ledges (some split by a passage with a pole running up
  through it), vertical poles (from the floor, beside ledges, and standing on
  ledges up to higher ones) and horizontal poles (bridges between level
  ledges, perches off vertical poles). Every ledge and beam is checked to be
  reachable from the floor by a creature that can only walk and climb poles;
  a pole is added (or a passage opened) where one isn't, and anything still
  unreachable is left out. Panel sliders: ledges, poles, ledge poles,
  passages, horizontal poles.
- **`world.mapSize`**: how much of the world fits on screen (Compact is 1,
  Normal 1.4). Bigger shows more map with everything (creatures, ledges,
  poles) smaller; smaller zooms in so everything is bigger. The ledge, pole
  and fruit plant counts are densities: they scale with the map's area, and
  the tiered layout adds a row of ledges for about every 140 px of height.
- **World menu** (the globe, top left): the world type (tiers, scatter or
  rooms), the size (compact, normal, large, XL) and a new map.
- **Rain**: cycle length and whether creatures take shelter in dens during
  the downpour. The cycle runs itself: it opens dripping from the last
  storm, the drips die away into a calm, then light rain starts, builds on
  an exponential curve into the downpour and stops. Once the rain gets
  heavy (`rain.avoidFrom`, 0.45) creatures make for cover under ledges and
  overhangs. The cycle menu's "now"
  button shows the time into the cycle and skips to the next stage. Water
  only pours off ledge ends once the rain is heavier than
  `rain.waterfallsFrom` (0.35); in light rain there are just drips.
- **Experimental layout** (World layout: experimental): maps built like real
  Rain World rooms, with bottomless pits, passages and water. The water
  rises in the downpour (welling up out of the pits on a map without a
  pool) and drains after; slugcats swim (and dive for fruit growing under
  the water), lizards paddle, centipedes scramble out. Rain only falls
  through the openings to the sky, each with a waterfall down one side
  that can knock creatures off walls and poles. In the downpour the water
  rises to `rain.floodHeight` of the map (75%; the "water max height"
  slider) and carries off the dead. Lizards hold territories fitted to the
  room's chambers; yellow lizards hunt in pairs.
- **Dangle fruit** ripens on its vine and only drops when something hits it
  (a thrown rock or spear, or a creature barging into it). Fruit left lying
  about rots away after a minute.
- Every creature's parameters (speeds, colours, climbing abilities, vision…)
  are under `species.<name>.params`. Edit them in the panel's *Config JSON* box.

## How it works

```
js/
  util.js          math, colour, IK, taper-path drawing
  config.js        defaults + localStorage
  world.js         solid rects (windows/icons/taskbar/ledges), poles, collision,
                   raycasts, 20px nav grid
  nav.js           A* with per-species movement: walls, ceilings, poles,
                   deliberate drops, solved jumps, flight
  background.js    procedural fogged wallpaper (5 palettes), rain cycle
  creatures/       base (paths, verlet chains, legs, grabbing) + one file per creature
  ecosystem.js     weighted spawner, dens, predation, cursor, food
  engine.js        fixed-timestep loop, rendering, geometry providers
  geometry/
    mock-desktop.js  pointer input for the browser page (bare); a fake Windows desktop with ?desktop=1
    remote.js        real geometry from the Windows helper
windows/           Lively Wallpaper port + PowerShell geometry helper
tests/             fake-helper.mjs (helper stand-in for non-Windows dev)
```

The engine only sees rectangles from a **geometry provider**, so the prototype
and the real desktop run identical simulation code.
