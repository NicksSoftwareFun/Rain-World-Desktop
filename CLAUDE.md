# Rain World Desktop: notes for Claude sessions

A Rain World-style ecosystem of procedurally animated creatures that lives on
a Windows desktop background. Plain JS + canvas, no build step. The browser
prototype (`index.html`) runs on a mock desktop; the real wallpaper
(`wallpaper.html`) runs in Lively Wallpaper with a PowerShell helper that
reports window geometry (`windows/`).

Read these before changing things:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the pieces fit, where things live.
- [`docs/LESSONS.md`](docs/LESSONS.md): pitfalls that have cost time, and the
  owner's feedback so far (what "looks right" means for each creature).
- [`tests/README.md`](tests/README.md): the headless test kit.
- [`docs/WINDOWS-TEST-CHECKLIST.md`](docs/WINDOWS-TEST-CHECKLIST.md): what to
  check on the real desktop after a batch of changes.

## Working with the owner

- They manage mechanical, HVAC and plumbing construction projects, not software. Keep
  explanations plain, lead with what changed on screen, skip implementation
  detail unless asked.
- They want to **see** work as it's made: send a GIF or screenshot of each
  visible change (crop tight on the creature; under ~2 MB). Headless
  screenshots are fine; see "Recording clips" below.
- They often send several requests while you're mid-task. Finish or park the
  current one cleanly (commit it), then take the next. Don't drop any.
- They know Rain World well and judge by it. When in doubt about a behaviour,
  ask for (or use) the Rain World wiki page; they can upload pages as HTML
  when the wiki can't be fetched.
- Usage is limited: measure, fix, verify, move on. Don't gold-plate.
- **Art reviews**: for new or reworked creature art, the owner asks for a
  Sonnet "art director" review: spawn a background `Agent` (model `sonnet`)
  that reads the wiki reference images and your screenshots, makes its own
  shots, and reports a prioritized critique without editing files; then
  implement it and re-shoot. Download wiki images from
  `https://static.wikitide.net/rainworldwiki/<h>/<hh>/<File_name>` where
  `hh` is the first two hex digits of md5(File_name).

## Workflow

1. **Measure before fixing.** For any "X looks wrong / happens too often"
   report, write a quick headless probe that counts it (see `tests/` and the
   patterns in `docs/LESSONS.md`), confirm the cause, then fix and re-measure.
   Report before/after numbers to the owner.
2. **Verify.** `node --check` every edited file; run the relevant
   `tests/behaviour.mjs` checks (or all with `--quick`) and `tests/smoke.mjs`
   before committing anything substantial.
3. **Commit** in small, descriptive commits (what changed on screen and why)
   and push to the session's branch.
4. **Republish the shared Artifact** after every visible change (below).
5. **Update `README.md`** when a user-facing behaviour or setting changes, and
   bump `STORAGE_KEY` in `js/config.js` when defaults change (otherwise saved
   settings keep the old values).

## The shared Artifact

The owner shares the prototype at
https://claude.ai/artifact/3nynyHKbbWPEskKUEZJxfX ("Anyone with the link").
Its page is [`artifact.html`](artifact.html). To update it from a new session:
read it first (`Artifact` action `read` with that URL), then publish
`artifact.html` with `url` set to that URL and a `files` map of every script
and stylesheet it loads, e.g. `{"js/creatures/lizard.js":
"js/creatures/lizard.js", ...}` (keys are the `src`/`href` values in
`artifact.html`, sources are paths in this repo). On later updates in the same session,
only the changed files need to be in the map. Add new script files to both
`index.html` and `artifact.html` (and `wallpaper.html`, `gallery.html` where
they apply).

## Repository and GitHub Pages

This repo, `NicksSoftwareFun/Rain-World-Desktop`, is the project's home. It
was developed inside `NicksSoftwareFun/Multi-Project-Playground`
(`rain-world-desktop/` on branch `ccr-5e3d0da8-apficq`) until its history
was moved here.

GitHub Pages publishes **`main`** at
https://nickssoftwarefun.github.io/Rain-World-Desktop/ (the prototype; also
`gallery.html`), updating a minute or two after each push. The owner wants
the site to track development as it happens: work on `main`, or if the
session is set up on another branch, merge it into `main` once it's
verified so the site updates (say so to the owner). `.nojekyll` keeps Pages
from running Jekyll over the files.

## Owner's requests of 2026-10-04: all done

Ground terrain finished; centipede surface snapping eased; centipedes climb
up the middle of poles (legs both sides); large centipedes 30% faster; the
red feud (red lizards and large centipedes hunt each other on sight, are
armoured and twice as tough); red lizards spit spine volleys; lizards
contest scavenged corpses, hardest on their own patch. Since then:
spines are spear-length and lodge in what they hit (40 s); slugcats eat
only their own kills; spears, rocks and spines fly faster and only
within 30 degrees of level; slugcats backflip to throw spears straight down, to
double back at a run and to dodge a lunge.
Details in docs/ARCHITECTURE.md.

## Next session: resume here (saved at low usage, 2026-10-04)

- **Not yet done since the last full suite:** run the full suite, then
  republish the artifact. The artifact needs `artifact.html` copied to its
  page and `js/rooms.js` added to its files.
- **Passages (owner's request, WIP):** these are one-cell tunnels through the
  rock in experimental maps that creatures squeeze through like pipes. They
  go vertically too, and turning back inside costs squeeze time.
  - Done: `World.setPassages`/`passage()`, nav `TUNNEL` edges (passage
    cells are never start or goal cells), and creature crawling in
    `base.js` (`tryTunnel`, `startTunnel`, `tunnelStep`, `layOnTrail`,
    `tunnelReverse`, `endTunnel`).
  - The generator `carvePassages` (rooms.js) currently carves **none**.
    There are too few doors, and the shortcut test is too strict
    (`room.debug` shows the counts). The fix was to allow side doors without
    the above/below rule, add floor doors going straight down, and use the
    shortcut rule `ad < md * 1.3 + 8`. It wasn't applied: the patch script
    had a stray `])`.
  - Then test with scratchpad-style checks: creatures enter, finish and
    reverse, and none get stuck. Then film one.
- **Art review 2** (6.5/10, up from 4). Its fixes, in order:
  1. Step every flat floor span.
  2. Offset slab rows so they never share a y.
  3. Make Shaded rooms thicker and less box-like.
  4. Shaded octagons: no grass or dens on top, 4 cells, add bell capitals.
  5. Rock texture: std dev about 3.
  6. Shoreline glow: true red-orange, smooth falloff.
  7. Water 3-5 cells deep, darker, with a climb-out ledge.
  8. Pit: a lip, an edge pole and a dark gradient.
  9. Pole rhythm.
  10. Accent clumps.
  11. Maybe a 1 px rim on creatures for readability.
- **Owner's bug reports after the WIP save** (with screenshots):
  1. **Narrow shafts jam creatures.** Lizards pile up in one-cell-wide
     vertical shafts and get stuck there, a whole stack of them in one shaft.
     These are probably narrow gaps left by the generator (wall notches,
     pillars beside walls), not real passages, which carve none yet. Two
     fixes:
     - The generator never leaves an accidental one-cell vertical gap: fill
       it, or widen it to three or more cells.
     - Real passages need a crawl that never jams: one creature at a time,
       the rest wait at the door, or nav treats an occupied passage as
       blocked.
  2. **Dragging is one-way.** The owner can drag a creature into a passage
     but can't drag it back out. Probably `tryTunnel` grabs anything whose
     lead is in a passage cell, and the hand's hold is then fighting
     `tunnelStep`. A hand hold (`grabbedBy.isHand`) should always win:
     clear `tunnel`, and don't re-enter while held or for a moment after
     release.
  3. **Long leaps pass through terrain.** Slugcat long leaps go straight
     through rock, likely on the new experimental maps: the jump arc check
     (`arcClear`) or the leap physics don't collide during `longLeap`.
     Reproduce it on an experimental seed and check the collision during
     the flight.
- `bodies` check is noisy, sometimes failing lizard hairpins, and it was
  already like that before this work.

## Experimental layout (in progress)

The owner's request: a `World layout` option, `experimental`, that builds
maps like real Rain World rooms from a dataset of room maps (32 rooms, four
regions), with bottomless pits, placeholder water and openings to the sky
that fliers use. The plan, phases and status are in
docs/EXPERIMENTAL_LAYOUT.md; the code is js/rooms.js. Water physics and
swimming come next, once the owner has seen the placeholder. The web page
and the artifact no longer show the fake desktop (only `?desktop=1`).

## Open items

- **Real-desktop test** pending: the owner runs
  [`docs/WINDOWS-TEST-CHECKLIST.md`](docs/WINDOWS-TEST-CHECKLIST.md) and
  reports back.
- **index.html in Lively**: the owner first loaded `index.html` (the browser
  preview with a pretend desktop) into Lively, so creatures only saw fake
  windows. The real wallpaper is `wallpaper.html` via the helper (checklist
  has the steps). Consider making the mistake harder to make (e.g. the
  preview detecting it's a wallpaper and saying so).
- Lizard scraps near pole bases still look tangled at times.
- Lizard pole leaps land cleanly only ~45% of the time (bigger ones worse,
  by design, but maybe too clumsy).
- XL maps take ~1 s to build (one-off pause); XL is about twice Normal's
  frame cost.
- Centipedes don't use the corner clamber (lizards and slugcats do).
- Ideas the owner was offered: the downpour being dangerous (creatures caught
  out get battered), more slugcat movement techniques, a new small creature
  (Eggbug, Lantern Mouse, Noodlefly). Ask for the wiki pages.

## Running headless

- Chromium is at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` in the
  cloud sessions; pass it as `CHROMIUM_PATH` to the tests. Run `npm install`
  in `tests/` first (ESM won't find a global Playwright).
- `index.html?paused=1` doesn't start the loop; drive it with
  `RW_APP.engine.tick(1/60)` or `RW_APP.step(n)` (step also renders).
  `&seed=N` fixes the map.
- Recording clips: step a few frames, `page.screenshot({clip})` each, then
  `ffmpeg -framerate 30 -i f%04d.png -vf "scale=W:-1:flags=neighbor,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none" out.gif`.
  To film an event, step until it starts (hook the method that begins it,
  e.g. `startScramble`), then record. `gallery.html?spawn=...` stages
  close-ups in a small fixed room.
