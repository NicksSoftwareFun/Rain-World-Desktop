# Designer's intent

This file exists so that a big feature push lands close to what the designer
(Nick) wants **the first time**. It is not a list of decisions he has already
made (those live in the code and `docs/ARCHITECTURE.md`); it is the pattern
behind his feedback: what he notices, what he sends back, and the questions
to ask yourself before he has to. Run the checklist at the end before you
present anything.

He is a construction project manager (mechanical, HVAC, plumbing), not a
programmer. He judges by watching the wallpaper run, and reports with
screenshots and reference images. The touchstone is always the game
**Rain World**: does this look and behave like something out of it?

## What his feedback keeps catching

Every one of these came back as a correction at least once. Assume the next
feature will trip the same wires unless you check.

### 1. The first pass is too plain

Features first shipped "functional" get sent back as boring, flat, boxy or
generic (the background fans, the big pieces of machinery, the back walls,
the decor). He expects the first version to already have:

- shading and depth, especially along cut edges and undersides;
- wear and story: rust weeping, broken corners, missing slats, grime;
- variation between instances (size, state, age), not one stamped shape;
- a little life where it fits (a slow sway, a flicker of motion, a
  secondary reaction in nearby things).

Ask: *would this pass for a hand-made asset from the game, or does it look
like a placeholder?*

### 2. One thing, too often

Once a new element exists it tends to appear everywhere (fans ended up on
every wall; small centipedes and slugcats flooded the map). Default to
**rare and varied**: cap how many of any one thing a room gets, and mix it
with siblings. When adding a new kind of thing, add two or three related
variants rather than one.

### 3. It doesn't hold up physically

He spots anything that breaks the illusion of a physical place:

- **Floating**: props, signs, debris, sections of wall with nothing holding
  them up. Everything is anchored to rock, a pole, a chain or a floor.
- **The sky**: nothing belongs in open sky: no props, no drips, no creatures
  walking on it, no "ground" at the top edge.
- **Contact**: limbs that hover instead of gripping (slugcats in passages,
  lizard legs), heads that bend unnaturally, bodies that overlap.
- **Cause and effect**: wind from a fan should move nearby things; water
  that falls should look like falling water; a slugcat in a lizard's mouth
  is in danger; a hit knocks a climber off.

Ask: *if this were a real space, what would be holding it, touching it,
pushing on it?*

### 4. It breaks on the other kinds of map

Many bugs only showed on a particular map type or moment, and he found them
before the tests did (open-sky maps above all). Every feature must be looked
at on:

- a **surface / open-sky** map (top and sides open to the sky);
- an **enclosed** room with **passages**;
- a **flooding** map during the **downpour**;
- a **dark** palette and a **grey/low-colour** palette;
- the **XL** and **compact** sizes.

### 5. Creatures get stuck in loops

The single most common behaviour report: a creature oscillating or frozen.
Examples: forage, flee, forage again; climb a pole, fall, climb again;
bouncing at a spot it can't reach; jammed in a passage; diving for something
it can't get; standoffs from seeking a target across the map; hiding
somewhere instead of leaving.

So every new behaviour ships with, from the start:

- a **give-up rule** based on real progress (along the route, not straight
  line) with a cooldown or memory so it doesn't retry the same thing;
- an **alternative** when blocked (another route, another target, safer
  food), not a retry;
- **range limits** on anything that seeks a target;
- a long simulated run (several minutes, several maps, through a rain cycle)
  looking specifically for repeats and stalls, with the numbers reported.

### 6. Features collide with each other

New behaviour often conflicts with an existing one: a dropwig choosing a
batfly nest's spot, lizards diving for a corpse in water, the new back-wall
crawl fighting the pole-grip fix. Before presenting, walk the new feature
past every species and map feature (water, passages, poles, dens, nests, the
rain cycle, the flood) and ask what happens when they meet.

### 7. Reference images were misread

When he sends a reference, he means its **anatomy and character**, not a
loose impression. The yellow lizard's "antennae" took four rounds because
they were read as insect feelers instead of skull spines. So:

- Before implementing, describe what the reference shows (what part of the
  body, where it attaches, which way it curves, how thick, what colour) and
  build exactly that.
- Avoid generic or insect-like readings; Rain World creatures are chunky,
  reptilian and a bit grotesque.
- Show a close-up next to the reference at the game's scale.

### 8. Visual noise

He reliably flags: flicker (clouds of shifting shapes, water strips that
flash), highlights that pop too much, palettes that crush to black, motion
that is twitchy or wagging. Defaults: smooth over time (ease, hysteresis,
fade in and out), keep highlights subtle, shade dark colours toward the air,
keep motion slow and weighty.

### 9. Proportions are off on the first try

Sizes come back as "a bit longer", "a bit shorter", "too bunched up". Check
proportions against the reference and the creature's body before
presenting, and avoid shapes that collapse into an X or a blob. When he
asks for "a bit", move in small steps.

### 10. Creatures should be distinct, with trade-offs

He wants each species to feel like its own animal with its own way of
moving and hunting, and likes abilities that come with a cost (the blue
lizard can crawl back walls but loses its long jump). When adding an
ability, propose the trade-off with it. Danger should be real but readable:
predators act on opportunity, prey reacts, invisible things don't scare.

## How to present

- Show it running: before/after on the same map, a close-up at game scale,
  a GIF for anything that moves.
- Plain language. Say what changed, what it looks like, and what you
  measured; flag what you couldn't check.
- Make sensible choices yourself and offer one or two tweaks after; don't
  hand him parameters to pick.
- No settings toggles for looks or small behaviours: pick a good default.
- Commit and push to `main` and update the shared artifact as you go.
- Don't overtest: targeted checks while working, the relevant suite before
  committing, the full suite only for big or shared changes; when usage is
  low, run only the most relevant check.

## Checklist before presenting a feature push

1. Does it look hand-made and finished (depth, wear, variation, a bit of
   life), not placeholder?
2. Is any single new element too frequent? Are there variants?
3. Is everything anchored? Nothing in the sky? Contacts and reactions
   believable?
4. Checked on open-sky, enclosed + passages, flooding/downpour, dark and grey
   palettes, both sizes?
5. For behaviour: give-up rule, alternative when blocked, range limit, and a
   long run with loop/stall counts?
6. Walked past every species and map feature for conflicts?
7. If there was a reference: does it match its anatomy, shown side by side?
8. Any flicker, harsh highlight, pure black, or twitchy motion?
9. Proportions checked against the reference and the body?
10. Is it distinct, and does a new ability have a cost?
