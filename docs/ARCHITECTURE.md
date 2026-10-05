# Architecture

Plain classic scripts that hang everything off `window.RW`; load order is in
`index.html`. No build step, no dependencies. About 10k lines.

## Pages

| Page | What it is |
| --- | --- |
| `index.html` | The browser version (GitHub Pages): the wallpaper on its own, the pointer only (`MockDesktop` in bare mode). `?desktop=1` adds the mock Windows desktop (draggable windows/icons as geometry; the smoke test uses it). `?paused=1` for tests, `&seed=N` fixes the map. |
| `artifact.html` | The same as published to the shared claude.ai Artifact (see `CLAUDE.md`), bare. |
| `wallpaper.html` | The real wallpaper, run by Lively Wallpaper. Gets geometry from the helper; maps Lively's Customise properties (`LivelyProperties.json`) onto the config. `?panel=1` shows the settings panel. |
| `gallery.html` | A small fixed test room: `?spawn=lizard_pink@200,300;slugcat@400,300`. Good for close-up clips. |

## The loop (`js/engine.js`)

Fixed 60 Hz simulation (`tick`), rendering decoupled (`render`).

- **World size**: `zoom = 2 / mapSize`; the world is the window size divided
  by `zoom`, in *world units* (a 1080p screen at map size 1 is 960x540).
  Everything in the simulation works in world units.
- **Pixel scale** `ps` (1, 1.5, 2, 3): the canvas is `world * zoom / ps`
  pixels, upscaled with `image-rendering: pixelated`. `eco.artPx` is world
  units per art pixel.
- **Layers**: a pre-painted background canvas (`Background.paint`), then the
  weather, then a sprite canvas that is **alpha-thresholded** by
  `U.crispRects` (alpha < 110 becomes transparent, the rest opaque) for the
  crisp pixel-art look. Anything meant to be see-through (white lizard camo)
  must be drawn after that, in `Ecosystem.drawLate`.
- **tick**: poll the geometry provider -> `world.setDynamic(rects)` (windows,
  icons, taskbar) -> carry creatures standing on moved rects -> cursor and the
  drag "hand" -> `eco.update` -> `weather.update`.
- `regenerate(newSeed)`: rebuild decor + world (keeps creatures that still
  fit; a map-size change rescales them). **It replaces `engine.eco`** (and
  the world): never hold on to an old reference across it.
- `restartWildlife()`: clear all creatures, repopulate from the current
  weights, restart the rain cycle.

## World and navigation

- `js/world.js`: axis-aligned solids (`kind`: `edge`, `ledge`, `beam` =
  horizontal pole, `window`, `icon`, taskbar...) plus vertical poles. A 20px
  nav grid: a cell is solid when a rect covers over 30% of it. Queries:
  `nearestSurface(x, y, r, mask)` (the surface a creature clings to, with its
  normal), `collideCircle`, `isSolidPt`, `raycast`, `pole(cx, cy)`.
- `js/nav.js`: A* over the grid with WALK, FALL and JUMP edges. What a
  creature can do is its `caps` (`walls`, `ceil`, `poles`, `fall`, `fly`,
  `jumpX`, `jumpUp`, `leapPoles`); the jump edges and valid cells are cached
  per caps key and world version. Nodes are `{cx, cy, x, y, type}` and are
  recreated on every replan: compare cells, not node objects.

## Creatures (`js/creatures/`)

`base.js` holds the shared machinery:

- `Pather`: path following (`current()`, `previous()`, `advance()`).
- `Chain`: verlet point chains with `follow` (length), `limitBend` (no
  hairpins) and `collide`; bodies, tails and tentacles are chains.
- `Leg`: two-bone IK legs that plant and step.
- `Creature`: `tick()` handles death (corpses are ragdolls with X eyes until
  eaten), stun, the burrow-away safety net for anything stuck 25 s,
  unburrowing from inside geometry, leaving through dens (`leave()` at a den
  starts `piping`: the head, `pipeLead()`, crawls into the mouth and the body
  follows via `pipeMove()`, clipped at the mouth by `Ecosystem.draw`; with no
  den in reach it fades out). Sheltering: from `rain.shelterWarnSeconds`
  before the downpour each creature heads in at its own moment
  (`shelterTime()`); those that go in for the rain (`sheltered`) wait in
  `Ecosystem.shelterStash` and come back out after it (`startUnpiping`,
  `layInPipe`, `unpipeStep`: head first, along the ledge top from a ledge
  pipe). Also grabbing and
  being held (`holdPoint`), weapons (`hitParts`, `stun`, `kill`), goal picking
  (`readyForGoal`, `exploreGoal` with a `heightBias`), and the pole-to-ledge
  scramble (`cornerAhead`, `startScramble`, `stepScramble`).

| File | Creature |
| --- | --- |
| `lizard.js` | All lizard colours (per-colour params in config, personality rolled per the wiki). Spine + 4 IK legs; hunting, lunges with a whole-body jolt, territory, rivalry and corpse fights, the red spine volley, carrying kills home (shaking them), scavenging, pole leaps, turning round (in-plane on poles). White lizards camouflage only while stalking. |
| `slugcat.js` | Platformer physics, pole climbing, planned jumps (long leaps lie down and wind up first), arms and hands, rocks and spears (pick up, throw, two different items max), transit (eat one fruit + one meat, leave by the farthest den). Eats only what it killed itself (`killedBy`, set by `kill()` from the holder or the last hit). Spears (860 px/s) and rocks (700 px/s) fly fast and only within 30 degrees of level (`shot`); for a target steeply below, `startBackflip` springs up and back over and throws straight down from the top of the jump (straight down at once if already airborne). The same `backflip()` reverses direction at a run when the path doubles back (always when fleeing, otherwise for 60% of slugcats) and dodges a lizard's bite wind-up at close range; an escape flip can catch a pole on the way down. Fruit hanging overhead means walking to a spot level enough with it to throw from (`throwSpot`, state `aim`); a plant with no such spot is ignored for 30 s. |
| `centipede.js` | Small/medium/large; segmented chain over any surface; small ones eat batflies, big ones hunt lizards and shock; large ones feud with red lizards. Never jump. |
| `daddy.js` | Daddy Long Legs: tentacles grope for anchors and grab prey; transit (two meat meals). |
| `dropwig.js` | Ceiling ambushers: crawl to a ceiling, wait, drop on prey. Long-legged grip across corners. |
| `batfly.js` | Flocking prey; hatch from and roost on the batfly nest. |
| `noodlefly.js` | Adult and infant noodleflies (one class): a family object ties an adult to its infants; arch + hanging tail chain; stalk / wind-up / stab / feed; infants cling to the tail; cry -> `avenge`; transit like slugcats. |
| `squidcada.js` | White/black squidcadas in a flock object: erratic flight, play, rest on ledges, hunt batflies/small centipedes, headbutts, rescue. |

Fliers have `isFlier`; ground predators only target one that `nearGround()`
(within reach of a surface).

**The red feud.** Species with `red: true` (red lizards, large centipedes)
hunt the nearest other red creature anywhere on the map (`redFoe()`), with
no give-up timer. `armored: true` means nothing can `grab()` one alive:
bites, shocks, needles and spines go through `takeHit(power, from)`, which
takes `power / toughness` off `hp`, knocks it back and kills it at zero
(toughness 6 for both, so a duel runs 20-60 s and either can win). Once
dead it's an ordinary corpse.

**Spines.** Red lizards (`spits: true`) open a hunt from 110-400 px with a
volley of 2-3 `RW.Spine`s (`weapons.js`, kept in `eco.items`): 24 px
barbs (a spear is 30), fast (800 px/s), only spat within 30 degrees of
level (prey steeply above or below is out of reach), aimed a touch high for the drop. A
hit acts like a rock (`onRockHit`, or a flipped stun) on anything but an
armoured creature, which takes a small `takeHit`, and the spine stays
`embedded` in that body part (corpse included) until its host leaves or is
eaten; a miss lodges `stuck` in the terrain (carried with a moving window).
Either way it's removed 40 s after it lands. Then the lizard closes in; the
next volley waits 7-11 s.

**Corpse fights.** `findFoe` also gives lizards a `'food'` rival in another
lizard carrying, eating or walking to a corpse it would eat (`prizeOf`):
far likelier, from further off, and even when not hungry if the corpse is
within its territory (`onOwnGround`, 1.15x the zone), which also adds
to its `resolve`. The corpse is the rivals' `prize`: dropped to fight, and
the loser's `submitTo` sends the winner to `scavenge` it.

**Territory zones.** A lizard's territory (`zone()`, `inZone(pt, k)`) is a
150px circle round its hangout on the desktop layouts; in a room it's an
oval fitted to the chamber the hangout is in (the open cells within 14
across and 9 up or down: long and low along a floor, tall up a shaft;
90-300 x 60-200px). A trespasser anywhere in it is noticed (even out of
sight or beyond the usual range) and challenged a little more keenly in
rooms; patrols (`homeGoal`) cover the whole zone.

**Yellow packs.** Yellow lizards come out in pairs (`Ecosystem.spawn` links
`packMate`; `max` 4), share one hangout (the elder's: `pickHome`,
`updateHome`), regroup when more than 260px apart, never square up to
another yellow (`findFoe`), and hunt together: one's quarry is the other's
(within 1.6x vision), and with both on it each comes at it from the side
away from the other until the last 90px.

## Ecosystem (`js/ecosystem.js`)

Creatures, items (`items.js`: fruit and fruit plants; `weapons.js`: rocks and
spears), dens, the batfly nest(s). Spawning keeps the population near
`maxPopulation` (each species has a `popCost`; batflies cost 0) from weighted
species below their caps; forces a slugcat after 15 s without one; the nest
tops batflies up. Drawing order and the late translucent pass live here too.

## Level and weather (`js/background.js`, `js/drips.js`)

- `generateDecor`: tiered rows of ledges (more rows on bigger maps; counts are
  densities scaled by map area), passages with poles through them, beams
  (horizontal poles), vertical poles, then a **reachability pass** that adds
  poles or removes ledges until every surface is reachable from the floor.
  Then ground pieces on the floor (the taskbar's top on a real desktop, see
  `Engine.floorOf`): low blocks and stepped rubble mounds (`kind: 'ground'`
  / `'rubble'`, a cell per step so anything walks up them, added after the
  reachability pass) and non-solid `debris` (rebar, stones, pipes). Then
  fruit plants, batfly grass, the nest, chains, dens.
- `paint` keeps the backdrop and the play layer (poles, ledges, dens) as
  separate canvases on `canvas._bg`; `compose` stacks backdrop, shadows,
  play layer and vignette, cheaply, whenever the light moves.
- `Light.at(hour)`: the day-night light. The hour is an accelerated clock run
  by the rain cycle (`Engine.cycleHour`: 6:00 as a cycle starts, 19:30 as
  the downpour hits, the downpour is the night) unless `world.timeOfDay`
  holds it. It gives the sun's side and height (the shadow offset `dx, dy`,
  thrown by ledges, poles and beams only, never creatures) and a colour
  wash the engine multiplies over the whole frame.
- `Weather`: the rain cycle (light rain, an exponential build-up, the
  downpour, an exponential ease-off), rain drops with a slanted rain shadow
  under ledges/windows (not beams), curtains, fog, the cycle HUD.
  `drips.js`: drips from undersides and ledge-end waterfalls (only in real
  rain). In a room the rain shadow comes from the rock grid itself (each
  slanted rain line stops at the first rock cell, the screen-edge rock
  included), so rain only gets in through the openings; each opening to
  the sky has a waterfall down one side (`skyFalls`/`drawSkyFalls`: 4px of
  trickle in light rain, ~26px in the downpour, spray where it lands on
  rock or the water's surface; drawn only, it adds no water).

## Experimental layout (`js/rooms.js`)

`world.layout: 'experimental'` swaps `generateDecor` for `Rooms.generate`:
maps built like real Rain World rooms (from a dataset of 32 rooms; the plan
and the dataset brief's rules are in `docs/EXPERIMENTAL_LAYOUT.md`).

- **Regions** (`world.region`, `auto` rolls one per map): Outskirts,
  Shoreline, Industrial, Shaded Citadel. Each brings its own palette (the
  usual keys plus `mass`, `water`, `accent`, `interior`, `sky`; the palette
  dropdown doesn't apply) and `STYLE` (block kind, comb ceilings, wall
  thickness, floor steps), and rolls among its archetypes.
- **A tile grid on the nav cells**, carved out of solid by an archetype
  (`skyShaft`, `cruciform`, `stacked`, `citadel`): stair-stepped walls
  (`relieveWalls`), stair-step chamfers, stepped floors (`roughFloor`, a pole
  at any step over a cell), comb ceilings, blocks hung on poles
  (`hangBlocks`), then `furnish` (8-12 vertical poles in bundles, 2-3
  horizontal bars). Solid cells are merged into rectangles (`kind: 'rock'`)
  so the world, physics and nav are unchanged.
- **Big maps** (Large, XL): `roomGrid` splits the grid into 2-6 rooms
  (each about a dataset screen), each carved by its own archetype through a
  `SubGrid` view, then joined: `connectH` (a 3-tall doorway along a floor
  through the wall between) and `connectV` (a laddered 3-wide shaft from a
  floor down into the room below). `addLedges` adds free-standing ledges
  with a ladder each: now and then on a screen-sized map, more on big ones.
  Poles, bars, dens, fruit and nests scale with the number of rooms.
- **Population**: `Ecosystem.maxPopulation()` is 30% lower on an
  experimental map (less open space).
- **Pits or water, never both.** `addPit`: 3-5 cells cut down through the
  floor to the bottom edge, a pole beside it. `World.setPits` splits the
  bottom border, `solid()` is open below a pit column and `inPit()` marks
  the shaft so no walker paths into it (lizards don't leap over one; only
  slugcats do). Anything below the screen in a pit is removed (no corpse);
  items too. `addWater`: a flat surface 3-4 cells above the lowest floor,
  flood-filled (rejected if it would spill off the screen).
- **Water** (`js/water.js`, `RW.Water`, `world.waterSim`): a falling-water
  cellular automaton on the nav cells (each holds an amount, a little over 1
  under pressure; down, then level out sideways, then up when squeezed; 5
  rounds a tick, ~0.03ms). It's blocked by the room's own rock (thin bars
  let it through) and passages. The rain drives it: the flood follows the
  downpour (`flood`, lagging it), a pool rising by up to 16% of the open
  cells' worth (poured over its surface) and spilling over lips into the
  next hollow, then draining back to where it started; a pit map with no
  pool wells up out of the pits (poured into the top of what's in each
  shaft) and drains back down them. `World.inWater`/`waterDepth`/
  `waterCell`/`hasWater` ask it (scratch worlds fall back to the rects).
  Drawn over the creatures: everything under the surface is desaturated,
  multiplied toward the water's tint and lifted a touch (never black), then
  the translucent body, a rippling surface line, thin streams where it
  spills, spray where they land.
- **In the water** (`base.js`): `Nav.valid` lets swimmers (`caps.swim`, a
  cost multiplier: slugcat 3, lizards 4) anywhere in it; everything else
  keeps out (no jumps into or out of it either). Limp creatures float up to
  lie along the surface, corpses sink slowly (`waterLimp`, `floatBody`);
  creatures that hate it (`hatesWater`: centipedes, dropwigs) thrash for the
  nearest dry footing (`waterPanic`, `nearestDry`). Slugcats swim like
  otters (`Slugcat.swim`: quick surging strokes at the surface, head up,
  arms pulling and legs kicking, tail sculling; a dive straight down when
  the path goes under, ~10s of breath; out with a hop or onto a pole) but
  would rather stay dry (no resting in it). Lizards paddle clumsily
  (`Lizard.swim`: half speed in jerky surges, head held up, legs churning,
  a wobble; slow dives; no lunges, only a snap at prey in reach). Rocks and
  spears stall and sink; fruit floats. Splashes in and out (`noteWet`).
- **Sea fruit** (`items.js`, `SeaFruitPlant`): on most pool maps 1-2 fruit
  stalks stand up off the pool's bottom. Thrown things can't reach them;
  a hungry slugcat swims down and plucks one (state `dive`).
- **Passages** (`carvePassages`): 1-2 one-cell tunnels through the rock
  between side doors (open floor cells beside a wall) that are a long way
  apart through the open or on different floors; routed through solid only
  with a wall all round (A*, turns cost extra: L and Z shapes). Accidental
  one-cell slits are filled first (`closeSlits`: creatures jammed in them).
  `World.setPassages`/`passage()`; nav `TUNNEL` edges (straight steps only;
  passage cells are never a start or goal). A creature whose path runs into
  one (or that's in one, not held) crawls it end to end like a pipe
  (`Creature.tryTunnel`/`tunnelStep`): head first, the body laid along the
  head's own trail (`layOnTrail`), up and down alike, in surges with a wave
  down the body and the legs pawing at the walls (`tunnelWiggle`; a
  slugcat claws hand over hand, `limbTargets`). Meeting a bigger or
  hungrier creature head on, it wriggles, squeezes round (`tunnelReverse`:
  ends swapped, back out from the new lead) and backs out; one going the
  same way just follows.
- **Dens** sit on floors, away from water and off blocks; **sky dens** (`sky: true`, not
  drawn) are the openings along the top edge: only fliers use them, to
  spawn (mostly) and to leave (`openDens(flier)`, `denMouth` points up).
- **Checking**: a scratch world and A* for a pole-climbing lizard between
  every pair of pipe dens; a pit that cuts the map gets a bridge bar, an
  unreachable platform gets a ladder down to the floor; failing that, up
  to 12 re-rolls (`decor.ok`).
- **Painting** (`Background.paint` hands over to `paintRoom`): a light map
  (the region's dim interior colour, the sky colour only within ~14 cells
  of an opening, smoothed up from one pixel per cell), backdrop silhouettes
  that darken what's behind them (towers and fans, gears and conduits, a
  column lattice, fluted pillars), Shoreline's red and Shaded's warm glows,
  a hard shade band along faces into the hollow (`paintShade`), then the
  mass (texture courses, brick dashes, conduits, a lit lip on top faces,
  roots), blocks (octagons for Shaded), manmade junk to break up the rock's
  edges (`paintJunk`: big pipes straddling wall faces with flanges and
  elbows, pipes under ceilings, pipe stubs, recessed panels with lit rims in
  the big masses holding grilles, vents or glyphs, small grates and boxes
  in faces, girders braced into corners, rebar, catwalk railings along ledge
  tops, rubble in floor corners), accents and cables (`paintAccents`), and
  plant life round the water or the pits' rims (`paintWaterPlants`: kelp on
  the bottom, reeds and cattails in clumps on the banks and standing out of
  the shallows, vines hanging over it, moss). No cast sun shadows in rooms.

## Settings (`js/config.js`, `js/debug-panel.js`)

`RW.BASE_CONFIG` is the Compact size with Balanced wildlife;
`RW.DEFAULT_CONFIG` is that with the Normal size applied. Size presets set
map size, pixel scale, population, spawn rate, weapons and species caps;
wildlife presets set spawn weights (and cap boosts). Picking a different
size from the panel or Lively also resets `world` and `rain` to defaults
(`RW.resetWorldAndRain`). The panel (backtick or
the ≡ button) saves to `localStorage` under `STORAGE_KEY`; sections collapse.

## Windows side (`windows/`, `js/geometry/`)

- `windows/rw-helper.ps1` (+ `RwNative.cs`): a tiny local web server on
  `http://localhost:47315` that serves the wallpaper and `/api/geometry`
  (windows, icons, taskbar, cursor in physical pixels) and `/api/config`
  (settings shared between the wallpaper and a browser tab).
- `js/geometry/remote.js`: `RemoteGeometry` polls the helper; `ConfigSync`
  shares settings. `mock-desktop.js` is the prototype's stand-in.
- `tests/fake-helper.mjs` imitates the helper anywhere Node runs.
