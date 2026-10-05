# Experimental layout: plan

The owner's request (2026-10-04): a new **World layout** option, `experimental`,
that builds maps like real Rain World rooms (dataset: 8 contact sheets, 32
rooms from Outskirts, Shoreline, Industrial and Shaded Citadel). Switching to
it changes background, decor and terrain, and respawns every creature. It
needs bottomless pits (falling in is death) and water (a placeholder for now;
swimming comes later). Separately: the web page and the artifact lose the
fake desktop (windows, icons, taskbar); only the Lively build keeps desktop
geometry, and that comes from the real desktop.

The style brief an art-director agent wrote from the dataset (proportions,
motif counts, 18 generator rules, six archetypes, per-region palettes) is the
reference; its key numbers are copied below where they drive the code.

## Phase 0: no fake desktop on the web

- `MockDesktop` gets a bare mode: pointer tracking only (hover, press to pick
  up a creature), no windows, icons or taskbar.
- `index.html` (GitHub Pages) and `artifact.html` use the bare mode.
  `index.html?desktop=1` keeps the full mock for testing (the smoke test's
  window drag uses it). `wallpaper.html` (Lively) is unchanged: its geometry
  is the real desktop's.

## Phase 1: the generator (`js/rooms.js`, new)

- **A tile grid, then rectangles.** The map is built on the nav grid itself
  (20 px cells; 48 x 27 on a 1080p screen at map size 1), as tiles: solid,
  air, pole, water, pit. Solid tiles are merged into as few rectangles as
  possible (row runs, then stacked runs) and handed to the world as statics,
  so physics, nav and the existing renderers keep working unchanged.
- **Archetypes** (one rolled per map, from the brief): Sky Shaft (Outskirts),
  Cruciform Hall (Shoreline), Stacked Chambers (Industrial), Citadel Hall
  (Shaded), Ruined Skyline (Shaded/landscape). Phase 1 ships the first three;
  the others follow in Phase 3.
- **Shape rules** (brief section 5): solid 40-55% of the screen; one dominant
  irregular cavity built from 2-4 overlapping rectangles plus 1-3 side
  chambers joined by shafts; stair-stepped walls (a 1-2 cell notch every 4-10
  cells); 45-degree chamfers as 1-cell stair-steps on at least two corners;
  thick outer walls (3-8 cells) or a thin skin, by region; floors never share
  a height across the room; 4-8 floating blocks in 1-2 clusters, each hung on
  a pole; at least 8 vertical poles, 2 horizontal ones, a ladder; 1-3 thin
  shelves of different lengths; alcoves in the side walls, some holding dens.
- **Dens** sit in alcoves in the side walls and on floors (3-8 per map).
- **Validation.** After building, flood-fill the nav graph from the dens:
  every den and at least 85% of standable cells must be reachable, every
  shaft deeper than 6 cells needs a pole. A map that fails is patched (a pole
  added) or re-rolled from the next seed (up to 12 tries).
- **The setting.** `world.layout: 'experimental'` in the dropdown. Changing
  the layout regenerates the map and respawns all creatures
  (`restartWildlife`). The region follows the palette (Outskirts, Shoreline,
  Industrial, plus a new Shaded palette); the palette dropdown still works.

## Phase 2: pits and water

- **Pits.** 3-8 cells wide, in the floor, on about a third of maps (two wide
  ones in Ruined Skyline). The world's bottom border is split around them and
  `World.solid()` reports a pit's below-screen cell as open, so nav never
  treats the pit's edge as floor. Anything that falls below the screen is
  gone: creatures die and vanish (no corpse), items vanish. Every pit has a
  jump, pole or block route across, so it is never the only way between two
  halves.
- **Water (placeholder).** About a third of maps: a flat surface across the
  whole hollow, 3-5 cells deep over a solid basin, drawn as a translucent
  region-tinted body with a lighter 1-cell surface line, in front of the
  creatures. For now creatures walk the basin floor slowed by drag, splashes
  mark entries and exits, fliers keep above it, and rain rings it. Swimming
  and deep flooded rooms come later, once the owner signs off on this.

## Phase 3: the look

- **Solids**: flat near-black masses tinted by region (Outskirts violet,
  Industrial blue-black, Shoreline green-black, Shaded grey-black) with a
  faint brick/dot texture, a 1 px lighter lip on top faces only and a soft
  dark gradient on the hollow side. No outlines.
- **Background per region** (3-4 parallax layers): Outskirts pale grey-blue
  sky with lavender pump structures and fans; Industrial beige haze with huge
  gears at the open side and pipe conduits; Shoreline dark teal with red glow
  blobs and window/column lattices; Shaded near-black with faint fluted
  pillars and a few warm points of light.
- **Hanging detail**: 8-20 vines/roots/cables from ceilings and blocks,
  sagging chains between walls and blocks.
- The remaining archetypes (Citadel Hall, Ruined Skyline, Pipe Bend).

## Phase 4: reviews, tests, docs

- **Art reviews**: a Sonnet art-director agent compares screenshots of
  generated maps (several seeds per region) against the dataset and the
  brief, and lists concrete fixes; at least two rounds.
- **Tests**: a new `experimental` behaviour check (many seeds: solid share,
  reachability, pits and water present on some, no page errors) and a soak
  in experimental mode (no stuck creatures, falls into pits stay rare);
  smoke uses `?desktop=1`.
- Docs (ARCHITECTURE, LESSONS, CLAUDE.md), full suite, commit, artifact.

## Later (not in this round)

Water physics and swimming (slugcats swim and dive, lizards wade, eels and
leeches eventually), deep flooded rooms, more archetypes.

## Status (2026-10-04)

Phases 0-3 are done: there's no fake desktop on the web, and the generator
covers five archetypes in four regions. Pits, water and the sky openings
for fliers are in. The owner asked for passages (one-cell tunnels crawled
like pipes) mid-way, and they're in too. Three art-director review rounds
compare renders against the dataset (scores 4 → 6.5 → round 3 pending),
and the `experimental` behaviour check covers generation and living in
the maps. Next, once the owner has seen the placeholder: water physics
and swimming.

## Update (2026-10-05)

The owner found Large and XL maps the dullest (one screen-sized room
stretched out) and asked for a jungle gym. Big maps are now built from
2-6 rooms side by side and stacked, joined by doorways and laddered
shafts, with free-standing ledges (now and then on screen-sized maps, more
on big ones). Experimental maps hold 30% fewer creatures, and creatures
crawling a passage now squirm: surges, a wave down the body, legs pawing
at the walls, a slugcat clawing hand over hand.

## Update 2 (2026-10-05): water, rain, decor, territories

Water is a simulation now (js/water.js): it rises with the downpour,
spills into neighbouring hollows and drains after; pit maps flood up out
of their pits. Slugcats swim (and dive for the new underwater sea fruit),
lizards paddle, centipedes and dropwigs scramble out, corpses sink.
Everything under the surface is dark and muted. Rain only falls through
the openings to the sky, each with a waterfall down one side. Rooms get
plants round the water and a lot more manmade junk on the rock. Lizard
territories are ovals fitted to the room's chambers, and yellow lizards
hunt in pairs. Art review round 4 scored 7.5 (from 6.5); its fixes for
junk size, dark-map water, waterfall width and surface flatness are in.
