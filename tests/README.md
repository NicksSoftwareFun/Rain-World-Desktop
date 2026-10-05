# Tests

Headless checks for the prototype and the wallpaper build. Node 18+.

```sh
cd tests
npm install                      # Playwright (ESM won't find a global install)
export CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome   # cloud sessions; omit if Playwright has its own browser
npm test                         # smoke + quick behaviour checks (~4 min)
node smoke.mjs                   # page errors, population, window dragging, wallpaper vs fake helper (~1 min)
node behaviour.mjs               # all behaviour checks (~2-3 min)
node behaviour.mjs bodies rain   # just some
```

## When to run what

The suite exists to catch regressions before a release, not to confirm
every edit. Each step up costs more, so stop at the first that fits:

1. **While working**: `node --check` on the files touched, plus one small
   throwaway script that reproduces the thing being changed (a trace or a
   single screenshot; a GIF only for a finished feature the owner should
   see). Seconds.
2. **Before a commit**: `node behaviour.mjs --changed` runs only the checks
   covering the files changed since the last commit (see `COVERS` in
   behaviour.mjs); a UI/CSS-only change needs `smoke.mjs` instead. Usually
   under a minute.
3. **Before publishing the artifact, or after a change to shared code**
   (world, nav, base creature, ecosystem, engine): the full suite,
   `node behaviour.mjs` (about 2 minutes, three checks side by side) and
   `smoke.mjs`.

A failing check is rerun once automatically; one that passes the second
time is reported as `FLAKY` (worth a note, not a dig). A `FAIL` survived the
rerun and is real. Passing checks print one line; `--verbose` adds their
measurements.

## What's covered

`smoke.mjs`: the prototype and the wallpaper build (served by
`fake-helper.mjs`, a stand-in for the Windows helper) run for a few minutes
without page errors, populate, and react to geometry changes.

`behaviour.mjs`, one check per thing that has gone wrong before:

| Check | Guards against |
| --- | --- |
| `soak` | errors, runaway population, active creatures getting stuck (burrowing away) |
| `bodies` | centipedes folding in half, lizards hairpinning or balling up on poles |
| `centipedes` | centipedes slipping off poles and ceilings, or sitting "stuck" until they burrow away |
| `dropwigs` | dropwigs losing their grip on corners and falling in a loop |
| `scramble` | slugcats bouncing off ledge corners instead of scrambling up from poles |
| `jumps` | slugcats not jumping, centipedes able to jump (also reports lizard pole leaps and slugcat long leaps) |
| `fruit` | fruit dropping by itself or piling up |
| `transients` | slugcats / Daddy Long Legs leaving before two meals; batflies running out |
| `fliers` | noodlefly families hunting, feeding and leaving together, revenge for a grabbed infant, squidcadas feeding and resting, fliers leaving the screen |
| `rain` | the rain curve, waterfalls in light rain, rain blocked by horizontal poles |
| `shelter` | creatures caught out in the downpour, fading instead of using pipes, or not coming back out after the rain |
| `reds` | red lizards and large centipedes not fighting on sight, armoured reds grabbed alive, red lizards not spitting spines |
| `corpses` | lizards never contesting a scavenged corpse, corpses left untaken |
| `throws` | spears, rocks or spines thrown steeper than 30 degrees, slugcats eating corpses they didn't kill, backflips without a down-throw |
| `experimental` | Rain World room maps that cut dens off, never have pits or water, take too long to build, or that creatures get stuck in or keep falling out of |
| `water` | floods short of 75% of the map at the downpour's height or not draining after; corpses left under the flood; slugcats or medium centipedes stuck in the water, small centipedes and dropwigs not drowning, batflies surviving it, lizards diving; corpses or rocks floating, fruit sinking, sunk rocks fetched; rain falling inside rock; waterfalls knocking nothing; slugcats not diving for sea fruit |
| `packs` | yellow lizards coming out alone, fighting each other, splitting their territory or never hunting together |
| `presets` | defaults, ledge rows growing with map size, nests, pixel scales, wildlife restart |

The simulation isn't seeded, so numbers vary between runs. Each check's
thresholds are set well clear of the values measured when it was written
(noted in comments). A single failure is worth a rerun; a repeat failure is a
regression. **WARN** means the random run gave the check nothing to measure.

## Adding a check

Add an entry to `checks` in `behaviour.mjs`: `run(page)` drives the
simulation inside the page (`RW_APP.engine.tick(1/60)`, hook prototype
methods to count events) and returns plain numbers; `judge(metrics)` returns
failure strings. Re-read `engine.eco` after anything that regenerates.
