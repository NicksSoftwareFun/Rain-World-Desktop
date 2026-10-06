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
  Everything in the simulation works in world units. On a touch screen
  (`pointer: coarse`) `Engine.zoomFor` zooms each size out further (map
  size 1, 1.4, 1.8, 2.4 act as 2, 2.4, 3.4, 5.2), never giving more world
  than that size gets on a 1920x1080 monitor; the art pixels shrink with
  it (`ps` scaled by the extra zoom, not below 1 or the size's own), the
  creature labels keep their screen size, and a press grabs the creature
  it was on.
- **Pixel scale** `ps` (1, 1.5, 2, 2.5, 3; 2.5 for the Compact size): the canvas is `world * zoom / ps`
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
  `Ecosystem.shelterStash` and come back out after it, spread evenly over
every den on the map (each given the least-used one, `releaseLoad`, and
waiting till the water is below its mouth; one that stays under gives way
to an open den after 60 s) (`startUnpiping`,
  `layInPipe`, `unpipeStep`: head first, along the ledge top from a ledge
  pipe). Before that, once the rain is past `rain.avoidFrom`
  (`Ecosystem.heavyRain()`), creatures keep out of it: `wanderGoal` looks
  for cover first (`Ecosystem.rainOn(x, y)`, from the weather's rain
  shadow; nearest first, giving up for 12 s if there's none), and
  `keepDry()` gets anything wandering, idling or resting out in it moving;
  lizards' territory goals, flier air goals, batfly roosts, dropwig ceilings
  and the rocks slugcats fetch all skip rained-on spots. Also grabbing and
  being held (`holdPoint`), weapons (`hitParts`, `stun`, `kill`), goal picking
  (`readyForGoal`, `exploreGoal` with a `heightBias`), and the pole-to-ledge
  scramble (`cornerAhead`, `startScramble`, `stepScramble`).

| File | Creature |
| --- | --- |
| `lizard.js` | All lizard colours (per-colour params in config, personality rolled per the wiki). Spine + 4 IK legs; hunting, lunges with a whole-body jolt, territory, rivalry and corpse fights, the red spine volley, carrying kills home (shaking them), scavenging, pole leaps, turning round (in-plane on poles). White lizards camouflage only while stalking. Per-species looks from params: `bands` (pink stripes across the back), `headScale` (green's heavier head), `crest` (blue's frilled head crest), `antennae` (yellow's jointed, sprung antennae: `drawAntenna`, lagging and flopping as the head turns and bobs), cyan's dark-edged bright rings; the white lizard's mole-like fan of four nose feelers in the head's colour; yellow's antennae lie back along the neck and flare up on the hunt. White lizards ambush (`p.ambush`, `ambush`, `lurkSpot`): up to a ceiling or a ledge's lip over open floor 4-10 cells below ('lurkgo'), where they keep still and vanish ('lurk', camo 0.03, `lurking` from the start, so nothing fears them; a slugcat already running from one stops); prey passing below, they let go (or hop off the lip) and drop on it, steering onto it and grabbing it on contact (`ambushT`); a spot is given up on after 60 s, when progress along the path stalls 8 s, or when there's no way there, and three failed trips in a row mean ordinary hunting for 30 s. |
| `slugcat.js` | Platformer physics, pole climbing, planned jumps (long leaps lie down and wind up first), arms and hands, rocks and spears (pick up, throw, two different items max), transit (eat one fruit + one meat, leave by the farthest den). Eats only what it killed itself (`killedBy`, set by `kill()` from the holder or the last hit). Spears (860 px/s) and rocks (700 px/s) fly fast and only within 30 degrees of level (`shot`); for a target steeply below, `startBackflip` springs up and back over and throws straight down from the top of the jump (straight down at once if already airborne). The same `backflip()` reverses direction at a run when the path doubles back (always when fleeing, otherwise for 60% of slugcats) and dodges a lizard's bite wind-up at close range; an escape flip can catch a pole on the way down. Fruit hanging overhead means walking to a spot level enough with it to throw from (`throwSpot`, state `aim`); a plant with no such spot is ignored for 30 s. Temperament by colour: the hunter (red, `fierce`) eats two meats and no fruit, comes out better armed, stands its ground and throws instead of fleeing, and armed, stalks a lizard in sight (`stalk`: keeps a throw's distance and throws when it has the shot; spears only against a red); a scruffy head (`scruff` tufts). The survivor and monk are meek (bravery x0.55) and throw only at something coming for them (`willThrowAt`). |
| `centipede.js` | Small/medium/large; segmented chain over any surface; small ones eat batflies, big ones hunt lizards and shock; large ones feud with red lizards. Never jump. |
| `daddy.js` | Daddy Long Legs: tentacles grope for anchors and grab prey; transit (two meat meals). |
| `dropwig.js` | Ceiling ambushers: crawl to a ceiling, wait, drop on prey. Long-legged grip across corners. |
| `batfly.js` | Flocking prey; hatch from and roost on the batfly nest. |
| `noodlefly.js` | Adult and infant noodleflies (one class): a family object ties an adult to its infants; arch + hanging tail chain; stalk / wind-up / stab / feed (the stab skewers the prey alive, `skewered`: it slides onto the tip, `holdPoint`, is reeled up off the ground as the neck curls and the needle draws in, squirms, `squirm`, and dies three-quarters of the way through the 5 s drain; no turning round with a catch on); infants cling to the tail; cry -> `avenge`; transit like slugcats. |
| `squidcada.js` | White/black squidcadas in a flock object: erratic flight, play, rest on ledges, hunt batflies/small centipedes, headbutts, rescue. |

Fliers have `isFlier`; ground predators only target one that `nearGround()`
(within reach of a surface).

**Getting nowhere.** A chase (prey, a corpse, fruit, a weapon) that
hasn't got half a cell closer in 8-10 s is dropped (`noHeadway`), and the
target ignored for 20 s (`ignore`/`ignores`: the food, prey and weapon
searches skip it; it still counts as a threat). Lizard hunts and
scavenging, centipede hunts, slugcat foraging and fetching. With a
complete route to the target, "closer" is measured down the route
(`pather.remaining()`), not in a straight line, so a long climb round
counts as headway. A lizard wandering does the same as a white lizard on
its way to a lurking spot (`tripStalled`): it keeps on as long as it gets
further down the route, however long the climb, and gives the goal up
after 6 s without (or at once if there's no route), staying off that spot
for 60 s (`badGoal`, skipped by `pickWander`).

**Scares (slugcats).** A slugcat remembers what it ran from for 20 s (40
s if it's the same one again; `scaredBy`, `dangersNow`): the food it was
going for is ignored that long, food by a remembered danger or with one
in the way is passed over for other food (`risky`: fruit, downed prey,
underwater fruit, plants to throw at), food that turns risky is dropped,
and its routes go round the danger where there's a way round
(`pather.avoid` -> `Nav.findPath`'s `avoid`: extra cost close in). So it
doesn't run up a pole, drop down for the same fruit and run again.

**The red feud.** Species with `red: true` (red lizards, large centipedes)
hunt the nearest other red creature within `FEUD_RANGE` (420 px,
`feudRange()`; `redFoe()`), and give one up for 25 s once it's well out of
range or there's been no way through to it for 6 s (`feudStuck`): no more
detours across a big map or standoffs through rock. `armored: true` means nothing can `grab()` one alive:
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
`packMate`; `max` 4), never alone: when one of a pair dies or leaves the
map (sheltering doesn't count), the next yellow to come out joins the
survivor as its new mate (`widowedYellow`; `chooseSpecies` lets a single
one out only then, a pair otherwise), share one hangout (the elder's: `pickHome`,
`updateHome`), regroup when more than 260px apart, never square up to
another yellow (`findFoe`), and hunt together: one's quarry is the other's
(within 1.6x vision), and with both on it each comes at it from the side
away from the other until the last 90px.

## Ecosystem (`js/ecosystem.js`)

Creatures, items (`items.js`: fruit and fruit plants; `weapons.js`: rocks and
spears), dens, the batfly nest(s). Spawning keeps the population near
`maxPopulation` (each species has a `popCost`: slugcats, small centipedes,
infant noodleflies and batflies are free, so their own caps are low, yellow
lizards and squidcadas a half each and checked as the pair they come out as;
those sheltering in the dens still count; with nothing that counts about,
anything fits) from weighted species below their caps; forces a slugcat after 15 s without one; the nest
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
- `Weather`: the rain cycle, automated: heavy drips left over from the
  last storm that die away, a calm, light rain from 40% of the way through
  (`rain.drizzle` sets how strong it gets), an exponential build-up, the
  downpour, an abrupt stop. `dripLevel` follows the same curve (`rain.drips`
  scales it). Rain drops with a slanted rain shadow
  under ledges/windows (not beams), curtains, fog, the cycle HUD.
  `drips.js`: drips from undersides and ledge-end waterfalls (only in real
  rain); seeps along the screen's top edge only under a ceiling, never
  where the top opens to the sky. In a room the rain shadow comes from the rock grid itself (each
  slanted rain line stops at the first rock cell, the screen-edge rock
  included), so rain only gets in through the openings; each opening to
  the sky has a waterfall down one side (`skyFalls`/`drawSkyFalls`: 4px of
  trickle in light rain, ~26px in the downpour, spray where it lands on
  rock or the water's surface; `updateFalls` keeps their spans in
  `fallSpans`). Anything passing through one is pushed down, and now and
  then knocked off the wall or pole it clings to (`waterfallPush`,
  `knockLoose`), more so the harder it rains. Where a room is open to the
  sky or out of a side, the screen's edge is open air (`World.setOpenings`
  splits the border; `solid()` is open there), and pit-shaft walls and
  faces looking off the screen give no grip (`nearestSurface`), so nothing
  walks along an invisible edge or down a pit.

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
- **Sky edges**: a surface map's sky runs off both sides of the screen
  (`Engine.openings`: the air down each side column to the first rock is
  open), so nothing climbs the screen's edge up into the sky.
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
  let it through) and passages. The rain drives it (`floodFor`): nothing in
  the light rain; rising hard from when creatures start making for
  shelter (`rain.shelterWarnSeconds` before the downpour); full through the
  downpour; draining after. Full is `rain.floodHeight` of the map's height
  (0.75: the panel's "water max height" slider, which shows a dotted line
  at that height while dragged). The water is poured (about the open
  cells' worth / 40 a second) into the main body's surface (`findBody`:
  what's connected to where it comes from) until that body's top
  (`levelRow`) reaches the target row, so a separate chamber only fills
  once the main body spills over into it. It comes from the pool's
  surface; on a dry map with pits, up out of the pits (into the top of
  what's welled up in each shaft); otherwise (mode `rain`) where the open
  tops' waterfalls land, or, in a room closed to the sky, seeping up
  through the lowest floor. `level()` shares the level of water resting on
  something along each row (the automaton alone leaves a fast-filling
  room's surface sloped). At the flood's height the corpses under it are
  carried off (`Ecosystem`, once a downpour). `World.inWater`/`waterDepth`/
  `waterCell`/`hasWater` ask it (scratch worlds fall back to the rects).
  Drawn over the creatures: everything under the surface is desaturated,
  multiplied toward the water's tint and lifted a touch (never black), then
  the translucent body, a rippling surface line, thin streams where it
  spills, spray where they land.
- **In the water** (`base.js`): `Nav.valid` lets swimmers (`caps.swim`, a
  cost multiplier: slugcat 3, lizards 4) anywhere in it; everything else
  keeps out (no jumps into or out of it either). Only divers (`caps.dive`:
  slugcats) path below the top row of the water; lizards keep to the
  surface, so nothing else dives to flee or to reach a pipe. A den under
  the flood is shut (`openDens`). Things under the water (sunk rocks and
  spears, corpses, fruit, downed prey) aren't worth a dive: creatures go
  for what's on land (or floating). Batflies keep up off the water (a hard
  floor just over it: fleeing never drives them in) and die the moment they
  touch it; a nest or sky den with water at or just under its exit stays
  shut (`nearWater`), so no flock comes out straight into the flood. Limp creatures float up to
  lie along the surface, corpses sink slowly (`waterLimp`, `floatBody`);
  creatures that hate it (`hatesWater`: centipedes, dropwigs) thrash for the
  nearest dry footing (`waterPanic`, `nearestDry`); the small and weak
  (`drowns`: dropwigs, small centipedes) flounder slowly, slip under and
  drown after ~7 s unless they make it out. While the flood is up nothing
  slips away underground or fades out short of a den (`flooding()`): it's
  a pipe or nothing, and anything left in the flood water too long drowns
  (35 s; a slugcat 70 s). The flood drains in about ten seconds once the
  downpour is over, so the pipes are clear for everything coming back. Slugcats swim like
  otters (`Slugcat.swim`: quick surging strokes at the surface, head up,
  arms pulling and legs kicking, tail sculling; a dive straight down when
  the path goes under, breaststroke and frog kick under water, ~10s of
  breath; out with a hop or onto a pole) but
  would rather stay dry (no resting in it). Lizards paddle clumsily
  (`Lizard.swim`: half speed in jerky surges, head held up, legs churning,
  a wobble; slow dives; no lunges, only a snap at prey in reach). Rocks and
  spears stall and sink; fruit floats. Splashes in and out (`noteWet`).
- **Sea fruit** (`items.js`, `SeaFruitPlant`): on most pool maps 1-2 fruit
  stalks stand up off the pool's bottom. Thrown things can't reach them;
  a hungry slugcat swims down and plucks one (state `dive`).
- **The flood's way in** (`addInlet`): a room with no opening to the sky
  and no pit gets an inlet pipe low in an outer wall (or, failing that,
  down out of a ceiling), a couple of cells above the lowest floor; the
  water sim pours the flood out of it (`decor.inlets`).
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
  slugcat's hands and feet grip the passage walls, `limbTargets`: each held
where it gripped while the body slides past, then moved ahead to a new
grip, the sides staggered, scrabbling a little; `tGrips`). Meeting a bigger or
  hungrier creature head on, it wriggles, squeezes round (`tunnelReverse`:
  ends swapped, back out from the new lead along the points ahead of it,
  never back over its own body) and backs out, twice at most in one
  passage; one going the same way just follows. Held up without headway
  for `JAM_SLIP` (2.5 s), whatever the reason, it slips past whatever's in
  the way for 1.5 s. Picking a passage up partway along, it carries on the
  way it faces. In a passage the trapped-in-rock rescue (`unburrowStep`)
  and the lizards' body push (`separateLizards`) leave it alone.
- **Dens** sit on floors, away from water and off blocks; **sky dens** (`sky: true`, not
  drawn) are the openings along the top edge: only fliers use them, to
  spawn (mostly) and to leave (`openDens(flier)`, `denMouth` points up).
- **Checking**: a scratch world and one reachability sweep (`Nav.reachSets`:
  every move on the map, forward and reversed) for a pole-climbing lizard
  from the best-connected pipe den (the first three tried): every pipe den
  must be reachable both ways; a pit that cuts the map gets a bridge bar, an
  unreachable platform gets a ladder down to the floor; failing that, up
  to 12 re-rolls (5 on a big map, with more ladder rounds) (`decor.ok`).
  If none passes, the nearest miss is used with only the dens that connect.
  (Nav's jump cache is keyed on the world object as well as its version: a
  new map's world starts its versions over, and stale jumps from another
  map sent creatures leaping through walls.)
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
It floats off the screen's edge (translucent, rounded) with its header and
close button pinned while it scrolls.

The rain cycle's settings aren't in the panel: the cycle timer sits in the
bottom-left corner (`Panel.buildRainMenu`: a canvas ring of pips and the
time to the downpour) and clicking it opens a **corner radial menu**
(`js/ui/radial.js`, `RW.RadialMenu`, reusable): items fan out round the
corner, toggles and actions on the inner ring, dials (drag up/right, the
wheel, or arrow keys; a gauge arc and the value) further out (an item's
`ring` overrides that), more rings as needed; Escape, the hub or a click outside closes it. Clear skies and
downpour now, a live "now" button (time into the cycle out of its length;
a click skips to the next stage); cycle length and flood height (turning
it shows the dotted line). Each new map picks its own flood height, 40-80%
from its seed (`Engine.init`); the dial overrides it until the next map.

A second one, the **world menu**, sits top left behind a globe
(`Panel.buildWorldMenu`): the world type on the inner ring (rooms =
experimental, the default; ledges = `tiers` or `scatter`, each map
picking one from its seed; tapping the type it's already on makes a new
map), the size (compact, normal, large, XL) outside. A size picked there keeps the world type;
everything saves and redraws the side panel to match. (Saves from before
rooms became the default, `cfg.rev` < 2, open on rooms once. The tests pin
`?layout=tiers` unless a check picks its own.) A room fills the whole
screen, so the taskbar never triggers the ground rebuild there.

Ledge-end trickles (`drips.js`) end on the flood's surface and vanish once
it's over the ledge end; drops splash on the surface, and beads don't form
under water.

A tap on a creature (released within 180 ms without moving; a finger gets
320 ms, 12 px of wobble and a bigger target) opens the **creature menu**
(`js/ui/creature-menu.js`, `RW.CreatureMenu`, via `Engine.onCreatureTap`):
three 46 px buttons in an arc over it that follow it about (under it near
the top of the screen): kill, make hungry (`Creature.makeHungry`: `fullT`
to 0, or a slugcat's `hunger` up), and path + AI: its route (`showPath`)
and its AI state (`labelPinned`, drawn below it while the menu's open)
together, and for a lizard its territory too (a dashed oval and its
hangout), per creature, on until switched off. Tapping it again, or a
press anywhere else (`Engine.onPress`), closes the menu; so does dragging
it. Holding or dragging picks it up (`Engine.press`), never opening the
menu. Without a menu the tap falls back to the 15 s label
(`Ecosystem.toggleLabel`).

Touch: the mock desktop reports whether a press is a finger, follows one
finger only, moves the "cursor" to where a finger goes down and drops it
when the finger lifts (nothing stalks where a finger last was). The canvas
has `touch-action: none` (no panning or pinch-zooming the page mid-drag)
and no long-press callout; the buttons have `touch-action: manipulation`
(no double-tap zoom), and the ≡ button grows to 44 px on touch screens.

## Windows side (`windows/`, `js/geometry/`)

- `windows/rw-helper.ps1` (+ `RwNative.cs`): a tiny local web server on
  `http://localhost:47315` that serves the wallpaper and `/api/geometry`
  (windows, icons, taskbar, cursor in physical pixels) and `/api/config`
  (settings shared between the wallpaper and a browser tab).
- `js/geometry/remote.js`: `RemoteGeometry` polls the helper; `ConfigSync`
  shares settings. `mock-desktop.js` is the prototype's stand-in.
- `tests/fake-helper.mjs` imitates the helper anywhere Node runs.

Fights and fear: lizard fights go in rounds (`Lizard.rivalry`: after each
lunge `backPending` -> `backT`, a slow back-step along the body's line,
facing the rival and gaping; squared up again one may submit); red lizards
barely give ground. Red lizards hunt the lesser lizards and every other
lizard flees one it sees (greens only up close), so a red one often uses
its spines on fleeing prey. A red centipede shocking something armoured
runs off round the far side after each shock (`Centipede.startRun`) and
comes in again from there. Corpses fade toward grey as they lie
(`Ecosystem.drawFaded`, on `corpseT`: drawn on a corpse-sized scratch
canvas and greyed pixel by pixel; a canvas filter cost a whole-screen
pass per corpse per frame).

Surface maps (`Rooms.surface`, `world.surface`): open ground across
the top over a complex of rooms in another region's style; the map's
palette is `decor.pal` (`makePalette`: a region variant from `VARIANTS`,
the complex's back walls, a `crust` colour for rock open to the sky,
`room.skyOpen`). See docs/EXPERIMENTAL_LAYOUT.md.

Passing clouds (`js/sky.js`, `RW.Sky`, built after each background paint):
a tileable fractal value-noise field cut at a share of cover (a quantile,
so the amount of cloud is what's asked for), lit by the cloud above each
pixel (bright tops, grey bellies) in sixteen tones with a smooth
edge (not dithered: two dithered layers sliding over each other crawled
like changing glyphs). Over a surface map's open sky two layers drift by
(`drawClouds`, right after the background, masked to where the painted sky
still shows: `decor.skyMask`, less the play layer), and a third of small
low clouds drifts quicker in front of the skyline and mountains, behind
the ground (`front`, masked by `decor.airMask`: all the air above the
ground). Every room open to the sky gets their shadows: the
field summed down each column, slanted along the beams (`decor.beamSlant`),
kept to where the sun reaches (the light map), drawn over everything as a
darkening and, in the gaps, a `screen` glint (`drawShade`, after the
foreground). Rebuilt only when the drift moves a pixel. Strongest in the
morning; as the cycle runs on and the rain comes the sky goes overcast,
the clouds greyer, and the shadows fade out.

Leaving a pole: the planner won't leap up off a pole that reaches higher
(it climbs to level with the landing, or above, and goes from there; a
level leap costs a little more where it could climb first), and slugcats
and lizards climb to the take-off point (a little above it) before
springing, rather than leaping from low down and clipping the corner.
Slugcats balance on pole tips (`Slugcat.perch`, any pole with open air
over it): they spring from the tip when the route jumps from the top,
sometimes climb one to rest a while when wandering (looking about, never
asleep), and count tips out of reach as places to flee to. A species'
`shelterEarly` (green lizards: 35 s) sends it to a den that much sooner.

The ground's colour (`paintTerrain`, `world.terrain`: 'strata', the
default, or 'flat'): earthy strata under the floors only (walls, undersides
and hanging blocks stay rock), measured down from the open air above on a
4 px grid and bent round steps in the floor, wavy, thinning into the rock
about four cells down (grey rock, with little colour of its own
(`terrainTones` `grey`): a stronger earth tone, running about six cells
down, and a darker rock beneath), with its own grain (the rock's texture
keeps off it); the floors get moss mats, litter and pebbles (`paintGroundAccents`).

Machinery in the rock (`paintJunk`): big pieces set into the masses
(`KINDS`, mixed per region by `MIX`): a cog half swallowed in a broken
socket, a ragged break showing a run of pipes (one main, the rest
thinner, flanged, one snapped and weeping rust), a porthole hatch or a
pressure door with its wheel, a piston or tank with pipes off into the
rock, patched hull plating with a plate torn away, a crevice of sagging
cables, a recessed fan (bevelled housing, shaded blades, sometimes one
snapped, a wire guard or louvres, grime and rust), and the old grille and
glyph panels chipped and cracked. On dark rock the depths of a hole go
back into the room's air instead of black (`dim`, `deep()`), the far wall
lighter away from the lip and laid in blockwork. The passages are painted
here too: a ragged gap with a back wall per straight run (truss, earth,
scrap), or the inside of a big ribbed pipe, the three-mark sign at each
door; junk keeps a cell clear of them. Small fixtures on rock faces, spaced out:
grates, vent rings, caged lamps (a few still faintly lit), junction boxes
with conduits, valve wheels, looping cables, glyph plates, machine boxes.

Decor in two kinds. Background props (`Rooms.paintProps`, on the backdrop
behind everything that moves): wall cogs, machine housings, wall fans
(rare: a room or so's worth, `want / 14`), louvred vents (capped at
`want / 8`), old glyph signs (hung on two chains from a real ceiling a few
cells up, else bolted to the wall; a corner broken off, glyphs worn faint),
windows through to a hazy far room (arched or round, bars, a shaft of
light, shards left in the frame), tanks lying on two saddles on a floor
(lit along the top, shaded under, banded, weld seams, a valve), pipe runs (rock to rock, a third of the props at most, thicker and lighter
than the climbable poles, a dull valve wheel on one in three), hoses
hanging from ceilings and junk piles on floors; each a soft shadow and a
rim of light (brighter near the openings), and a little haze so it reads
as further back. The wall fans turn: painted as an empty housing, each
gets a loop of blade frames coloured from the finished background under
it, and a cover of the play layer in front (poles), drawn every frame
straight after the background (`Background.drawFans`, built in `compose`):
two-tone blades turning under the painted hub and wire guard
(`Rooms.fanGuard`). Not every fan works (`q.mode`): about half run, a quarter have stopped
dead, and the rest hang loose, the blades rocking to and fro unevenly in
the air currents; only a running one blows. Each running fan blows toward
its more open side as far as the
next rock (`q.blow`, `q.reach`): dust drifts out on the draught and the
foreground plants and cables in it lean and flutter (`Foliage.setFans`).
The foreground (`js/foliage.js`, `RW.Foliage`): the plant painters
(`paintWaterPlants`, `paintAccents`, `paintBiolum`, and the batfly grass),
the cables slung between walls (`opts.swag`: they swing about the line
between their ends and are bumped only right at the cable) and the
hanging chains (`Background.drawChain`, whole art pixels; their drips
follow the swinging tip) draw through a recorder clump by clump
(`rec.plant(x, y, hang, opts)`). Each clump is redrawn a few times over,
bent a little further each time (the recorded strokes replayed through
`Foliage.bender`: stems curve, chains and cables swing straight, leaves
and links move whole), all onto one crisp sprite sheet; every frame each
shows the pose nearest its lean, a plain copy in front of the creatures
(before the water). The lean is a damped spring pushed by the rain's wind
(more in the downpour; kelp drifts in the current) and by anything moving
through it. They block nothing. Each casts a flat shadow onto the wall
(none under water), drawn behind the creatures and moving with it. The Ledges layout
gets one too (its grass and chains).

