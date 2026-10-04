# Architecture

Plain classic scripts that hang everything off `window.RW`; load order is in
`index.html`. No build step, no dependencies. About 10k lines.

## Pages

| Page | What it is |
| --- | --- |
| `index.html` | Browser prototype on a mock Windows desktop (draggable windows/icons are real geometry). `?paused=1` for tests, `&seed=N` fixes the map. |
| `artifact.html` | The same, as published to the shared claude.ai Artifact (see `CLAUDE.md`). |
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
| `lizard.js` | All lizard colours (per-colour params in config, personality rolled per the wiki). Spine + 4 IK legs; hunting, lunges with a whole-body jolt, territory and rivalry fights, carrying kills home (shaking them), scavenging, pole leaps, turning round (in-plane on poles). White lizards camouflage only while stalking. |
| `slugcat.js` | Platformer physics, pole climbing, planned jumps (long leaps lie down and wind up first), arms and hands, rocks and spears (pick up, throw, two different items max), transit (eat one fruit + one meat, leave by the farthest den). |
| `centipede.js` | Small/medium/large; segmented chain over any surface; small ones eat batflies, big ones hunt lizards and shock. Never jump. |
| `daddy.js` | Daddy Long Legs: tentacles grope for anchors and grab prey; transit (two meat meals). |
| `dropwig.js` | Ceiling ambushers: crawl to a ceiling, wait, drop on prey. Long-legged grip across corners. |
| `batfly.js` | Flocking prey; hatch from and roost on the batfly nest. |
| `noodlefly.js` | Adult and infant noodleflies (one class): a family object ties an adult to its infants; arch + hanging tail chain; stalk / wind-up / stab / feed; infants cling to the tail; cry -> `avenge`; transit like slugcats. |
| `squidcada.js` | White/black squidcadas in a flock object: erratic flight, play, rest on ledges, hunt batflies/small centipedes, headbutts, rescue. |

Fliers have `isFlier`; ground predators only target one that `nearGround()`
(within reach of a surface).

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
  Then fruit plants, batfly grass, the nest, chains, dens.
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
  rain).

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
