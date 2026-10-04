# Lessons learned

Things that cost time in earlier sessions, and the owner's feedback, so the
next session doesn't relearn them.

## Pitfalls

- **`engine.regenerate()` and `restartWildlife()` replace things.**
  Regenerate builds a new `engine.eco` and `engine.world`: a test that keeps
  `const eco = e.eco` from before watches a dead ecosystem (it once made a
  whole batch of results read "0 creatures"). Always re-read `e.eco`. Setting
  `e.seed = N` then `regenerate(false)` is how to switch maps in a test.
- **Path nodes are recreated on every replan.** Compare `cx, cy`, never node
  objects, when tracking "the same next step" over time.
- **The sprite layer is alpha-thresholded** (`U.crispRects`, alpha < 110 ->
  gone). Semi-transparent drawing in the normal pass just vanishes or turns
  solid; draw translucent things in `Ecosystem.drawLate` (white lizard camo).
- **The nav grid is coarser than the geometry.** A cell is solid at >30%
  coverage, so a creature can stand in a cell nav thinks it can't, or be
  told to cut a corner diagonally that its body can't get round. Most
  "creature stuck / looping / bouncing" reports trace back to this. The
  generic answers now in `base.js`: scramble (pole -> ledge lip), clamber
  (any jammed adjacent step), nudge out of a dead cell, burrow away after
  25 s. Before adding a new special case, check whether these cover it.
- **Poles beside ledges** must sit in the grid column right next to the
  ledge (`beside()` in `generateDecor`) or the pole gets broken by the
  ledge's cells and nothing can step across.
- **Corner grip.** Surface-hugging creatures turn off hugging while leaving a
  surface; crossing a corner they could drift out of grip range and fall
  (dropwigs did this ~50 times a minute). Long-legged ones now keep a 44 px
  reach while crossing.
- **"Stuck" at your own goal.** The 25 s stuck safety net counted a
  creature parked on its own goal as stuck, and the wander fallback often
  picked an unreachable spot or the cell it stood in (the explore picker's
  path search runs out of budget on far goals). Centipedes burrowed away
  ~12 times per centipede-hour. Now arriving isn't being stuck, and the
  fallback only picks a reachable spot at least 60 px away.
- **Grip where the path is, not where the node is.** Path nodes sit at cell
  centres, but the real surface can be nearly a cell away (an underside in
  the top of its cell; a pole off-centre). Centipedes reach 34 px, hug poles
  close, keep a pole's grip while their head is on one, and count a node
  reached within their own body offset.
- **Chains need a bend limit.** Verlet chains with only length constraints
  fold flat when the head doubles back (centipedes folded in 82% of frames).
  `Chain.limitBend` fixed it; anything new with a body should use it.
- **Saved settings mask new defaults.** Bump `STORAGE_KEY` in `config.js`
  whenever defaults change, or everyone keeps the old values.
- **Presets govern their settings.** In Lively, the Customise panel replays
  every property on start; the preset dropdowns are reapplied after each
  property so their order doesn't matter, and the individual sliders only
  count when that preset is *Custom*.
- **GitHub Pages:** a repo has one Pages site. That's why the project moved
  out of Multi-Project-Playground (whose site is the weather radar app) into
  its own repo, published from `main`. The session's GitHub app can't create
  repositories or change Pages settings; the owner does those by hand.
  The repo is named `Rain-World-Desktop` and the Pages path is
  case-sensitive: `/Rain-World-Desktop/` works, `/rain-world-desktop/` 404s.
- **`U.weighted` takes `[value, weight]` pairs.** Swapping them returns a
  number instead of the value; a creature's colour set came back as `5` and
  it drew in leftover colours (it looked like a background vine).
- **Shell editing.** Use exact-match replacements that assert the match is
  unique (a Python `assert s.count(a) == 1` pattern worked well). A sed range
  typo once wrote a stray copy of `base.js` into the repo under a garbage
  file name; check `git status` before committing.
- **The sim isn't seeded** (only maps are, via `?seed=`): measure over
  several minutes and runs, compare rates not single events, and expect
  run-to-run spread of a few percent.

## How to investigate a "looks wrong" report

1. Turn the complaint into a number (frames with a folded body, grip losses
   per minute, burrows per run...), measured headlessly over a few minutes.
2. Sample the bad moments: log state, the path's next node and a small ASCII
   map of the surrounding grid (`#` solid, `|` pole, `@` creature, `N` next
   node). The pattern usually jumps out.
3. If it's visual, screenshot or film the moment (hook the method that starts
   it, then record) and look at it before deciding.
4. Fix, re-measure, report before/after to the owner, add a check to
   `tests/behaviour.mjs` if it could come back.

## The owner's feedback so far (what "right" looks like)

Creatures should read as Rain World creatures. Specific asks, roughly in order:

- **Lizards**: open mouths are see-through (you see what's behind them,
  including other lizards); knees never above the body centreline; slow,
  lumbering, with personalities and territories per the wiki (fight over food
  and hangouts, carry kills home, shake them while carrying); lunges throw the
  whole body; white lizards only go partly transparent and only while
  stalking/hunting; no folding or balling up (especially on poles); non-green
  lizards hold territory on middle/top tiers, greens on the ground. Wary of
  large centipedes.
- **Slugcats**: head not a circle, body as wide as the head (no neck), a bit
  elongated, arms and hands, can lie flat, no dark edge on the arms.
  Transients: arrive by a pipe, eat two things (one fruit + one meat if both
  exist), leave by the farthest pipe. Pick up and throw rocks and spears (two
  different items at most); knock fruit down and batflies out of the air.
  Long lateral leaps start lying down with a windup (owner verified).
- **Others**: centipedes small/medium/large, never jump, small ones eat
  batflies, large ones hunt lizards; Daddy Long Legs rarer, transient (two
  meat meals); dropwigs lethal ambushers (owner verified); batflies don't
  count toward population and always have a nest on the map.
- **World**: tiered ledges like the owner's favourite generated map, no
  unreachable ledges, passages with poles through them, horizontal poles,
  ledges with poles on them; more rows on bigger maps. Rain doesn't fall under
  ledges or stop at horizontal poles; it builds and eases exponentially;
  ledge waterfalls only in real rain, light rain just drips. Fruit only drops
  when hit and rots after a minute.
- **Interaction**: no click-to-drop-food; dragging a creature picks it up
  limp, releasing drops it. Corpses stay as limp ragdolls with X eyes until
  eaten.
- **Fliers** (from the wiki pages the owner supplied): noodleflies need only
  the pack behaviour (infants with their adult), hunting and eating, and
  adults avenging infants; they're transients. Infants are prey for slugcats
  and centipedes; lizards and centipedes can try to eat all three fliers;
  adult noodleflies eat lizards and smaller. Art should look almost identical
  to the game: review it with a Sonnet "art director" subagent against the
  wiki images (see CLAUDE.md).
- **Settings**: Size presets Compact..XL (Normal is default; Compact was the
  original default), Wildlife presets to show off behaviours, collapsible
  panel sections, changing wildlife restarts creatures and the rain.
  Rocks plentiful, spears a little less so.

- **A "hairpin" metric spike isn't always the code you just touched.** The
  lizard `bodies` check failed at 14% one run; the culprits turned out to be
  stunned lizards lying limp with the body folded flat (the ragdoll had no
  bend limit) and lunges launched at prey directly behind. Break the metric
  down by state before blaming the latest change, and run the same check on
  the last commit to see whether it's new.

