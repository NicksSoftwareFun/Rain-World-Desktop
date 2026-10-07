// Default configuration. Everything here can be overridden from the debug
// panel (` key), which saves to localStorage, or by editing this file.
//
// Spawning: the spawner keeps the ecosystem near `ecosystem.maxPopulation`.
// Each time it spawns it picks a species at random, in proportion to `weight`,
// from the species that are enabled and below their own `max`.
// `popCost` is how much one individual counts toward maxPopulation (a Daddy
// Long Legs is several; slugcats, small centipedes, infant noodleflies and
// batflies are free; yellow lizards and squidcadas, which come in pairs, a
// half each).
(function () {
  'use strict';
  const RW = (window.RW = window.RW || {});

  // The base settings: the "Compact" size with the "Balanced" wildlife. The
  // defaults below are these with the Normal size preset applied.
  RW.BASE_CONFIG = {
    world: {
      palette: 'industrial', // industrial | shoreline | outskirts | chimney | subterranean
      mapSize: 1, // how much world fits on screen: bigger = more map, everything smaller
      pixelScale: 2.5, // 1 = full res, 1.5-3 = chunkier Rain World pixels
      cellSize: 20, // navigation grid cell (px). Rain World tiles are 20px.
      seed: 0, // 0 = new background every load
      layout: 'experimental', // 'experimental' (rooms): carved like real Rain World rooms (js/rooms.js); 'ledges': ledges over open space, each map either in rows ('tiers': at shared heights, bridged by horizontal poles) or 'scatter'ed anywhere (both still accepted on their own)
      region: 'auto', // experimental layout: 'auto' (a different one each map) or outskirts / shoreline / industrial / shaded
      terrain: 'strata', // experimental layout: the ground's colour: 'strata' (earthy layers under the floors, rock deeper) or 'flat' (rock throughout)
      surface: 'auto', // experimental layout: open ground on top, a complex of rooms below: 'auto' (about two maps in five), 'always' or 'never'
      under: 'auto', // the complex's region under a surface map ('auto': Industrial under Shoreline, either under Outskirts)
      variant: 'auto', // the region's colour variant (Rooms.VARIANTS index), or 'auto' for a random one each map
      decorLedges: 7, // wallpaper ledges creatures can use
      decorPoles: 4, // extra free-standing poles (more are added wherever a ledge needs one)
      ledgePoles: 0.6, // chance a ledge gets a pole standing on it (linking up to a higher ledge if there is one)
      passages: 0.4, // chance a wide ledge has a gap with a pole running up through it
      beams: 0.5, // horizontal poles: bridges between level ledges, perches off vertical poles
      fruitPlants: 5,
      groundDecor: 1, // blocks, rubble mounds and debris on the floor (0 = bare floor, 2 = cluttered)
      timeScale: 1,
      realTimeLight: true, // day-night light run by the rain cycle (dawn .. dusk, the downpour is night); ledges and poles cast shadows
      timeOfDay: -1, // hours (0-24) to hold the light at; -1 = follow the rain cycle
      maxFps: 60, // 30 halves drawing cost; the simulation is unaffected
    },
    rain: {
      enabled: true,
      cycleMinutes: 4, // length of one rain cycle
      downpourFraction: 0.12, // final part of the cycle that is a downpour
      shelterDuringDownpour: true, // creatures retreat into dens when the rain hits
      shelterWarnSeconds: 45, // ...starting this long before it, and come back out after
      floodHeight: 0.75, // how high the water rises in the downpour, as a share of the map's height (experimental maps); each new map picks its own, 40-80%
      drizzle: 0.24, // light rain outside the downpour (0-1)
      waterfallsFrom: 0.35, // rain heavier than this sends water pouring off ledge ends
      avoidFrom: 0.45, // rain heavier than this sends creatures under cover (ledges, overhangs, the room's rock)
      drips: 0.7, // water dripping from window/icon/ledge undersides (0 = none)
      curtains: true, // faint drifting sheets of rain
      showCycleHud: true,
    },
    ecosystem: {
      maxPopulation: 5,
      spawnPerMinute: 2.5, // new arrivals per minute while below the population cap
      startPopulated: true, // fill the screen immediately on load
      predation: true, // predators actually eat prey (off = chase, bite, release)
      migrationPerMinute: 0.3,
      rocks: 15, // rocks kept lying about for slugcats to throw (plenty: they're the slugcats' main tool)
      spears: 3, // spears likewise, fewer (the wiki: about one weapon in five is a spear)
      cursorInteraction: true,
      clickDropsFood: false, // off: pressing on a creature picks it up instead
    },
    debug: {
      showGrid: false,
      showPaths: false,
      showLabels: false,
      showFps: false,
    },
    species: {
      slugcat: {
        label: 'Slugcat',
        enabled: true,
        weight: 4,
        max: 2, // (free, so their own cap is what keeps their numbers down)
        popCost: 0, // free: they don't count toward max population (their own max still applies)
        params: {
          speed: 105,
          runSpeed: 175,
          climbSpeed: 80,
          jumpX: 7, // cells
          jumpUp: 5, // cells
          vision: 260,
          escapeChance: 0.25, // per second while held by a predator
          variants: { survivor: 6, monk: 2, hunter: 1 },
          colors: { survivor: '#f1f1f4', monk: '#f4ee82', hunter: '#ff7070' },
        },
      },
      lizard_pink: {
        label: 'Pink Lizard',
        enabled: true,
        weight: 3,
        max: 2,
        popCost: 1.5,
        params: {
          headColor: '#ff36c4',
          bodyColor: '#120b11',
          length: 1.0,
          speed: 49, // wiki baseSpeed 4.1 x 12
          huntSpeed: 83,
          climbWalls: false,
          climbCeilings: false,
          poles: true,
          vision: 297,
          mass: 2.1, // wiki bodyMass
          chargeRate: 0.05, // wiki loungeTendency: chance to pounce from afar
          biteDelay: 12, // wiki biteDelay (frames at 40fps): windup before a bite
          biteRange: 60, // wiki attemptBiteRadius x 0.75
          biteDamage: 1, // wiki biteDamage (lizard fights)
          toughness: 1, // wiki toughness
          spines: 0,
          pattern: 'dapple',
          bands: true, // pink bands across the back
          tailTip: true,
        },
      },
      lizard_green: {
        label: 'Green Lizard',
        enabled: true,
        weight: 2,
        max: 2,
        popCost: 1.5,
        params: {
          noSwim: true, // keeps out of the water (too heavy to climb back out)
          reflexBite: 2.2, // snaps at a slugcat right in front of its jaws (bites a second while in reach; others 0.7)
          headColor: '#41f53c',
          bodyColor: '#0c0d10',
          length: 1.25,
          speed: 80, // wiki baseSpeed 6.7 x 12
          huntSpeed: 136,
          climbWalls: false,
          climbCeilings: false,
          poles: false,
          shelterEarly: 35, // seconds sooner than the rest it makes for a den before the downpour (slow, and it can't climb out of the flood)
          vision: 280,
          mass: 7.5, // wiki bodyMass
          chargeRate: 1.0, // wiki loungeTendency: chance to pounce from afar
          biteDelay: 20, // wiki biteDelay (frames at 40fps): windup before a bite
          biteRange: 75, // wiki attemptBiteRadius x 0.75
          biteDamage: 2, // wiki biteDamage (lizard fights)
          toughness: 2.5, // wiki toughness
          spines: 9,
          pattern: 'dots',
          headScale: 1.15, // a bigger, heavier head
        },
      },
      lizard_blue: {
        label: 'Blue Lizard',
        enabled: true,
        weight: 3,
        max: 2,
        popCost: 1.2,
        params: {
          headColor: '#2d8cff',
          bodyColor: '#0c0d10',
          length: 0.8,
          speed: 38, // wiki baseSpeed 3.2 x 12
          huntSpeed: 65,
          climbWalls: true,
          climbCeilings: true,
          backWalls: true, // crawls across the room's back wall (and the props on it)
          poles: true,
          vision: 314,
          mass: 1.4, // wiki bodyMass
          chargeRate: 0.01, // wiki loungeTendency: chance to pounce from afar
          biteDelay: 14, // wiki biteDelay (frames at 40fps): windup before a bite
          biteRange: 68, // wiki attemptBiteRadius x 0.75
          biteDamage: 0.7, // wiki biteDamage (lizard fights)
          toughness: 0.5, // wiki toughness
          spines: 0,
          pattern: 'fins',
          crest: true, // a frilled crest on the head
          tailTip: true,
        },
      },
      lizard_white: {
        label: 'White Lizard',
        enabled: true,
        weight: 1,
        max: 1,
        popCost: 1.5,
        params: {
          headColor: '#b6bac3',
          bodyColor: '#e9e9ec',
          length: 1.05,
          speed: 46, // wiki baseSpeed 3.8 x 12
          huntSpeed: 78,
          climbWalls: true,
          climbCeilings: true, // (to hang in ambush)
          poles: true,
          vision: 396,
          mass: 2.1, // wiki bodyMass
          chargeRate: 0.05, // wiki loungeTendency: chance to pounce from afar
          biteDelay: 15, // wiki biteDelay (frames at 40fps): windup before a bite
          biteRange: 64, // wiki attemptBiteRadius x 0.75
          biteDamage: 1, // wiki biteDamage (lizard fights)
          toughness: 0.9, // wiki toughness
          spines: 0,
          pattern: 'spots',
          camouflage: true,
          ambush: true, // hangs invisible from a ceiling and drops on prey below (see Lizard.ambush)
          patience: 60, // seconds on one spot
        },
      },
      lizard_red: {
        label: 'Red Lizard',
        enabled: true,
        weight: 0.5,
        max: 1,
        popCost: 2,
        params: {
          reflexBite: 2.8, // the quickest to snap at a slugcat right in front of its jaws
          headColor: '#ff1e2a',
          bodyColor: '#0c0608',
          length: 1.35,
          speed: 60, // wiki baseSpeed 5.0 x 12
          huntSpeed: 102,
          climbWalls: false,
          climbCeilings: false,
          poles: true,
          vision: 520,
          mass: 3.1, // wiki bodyMass
          chargeRate: 0.05, // wiki loungeTendency: chance to pounce from afar
          biteDelay: 2, // wiki biteDelay (frames at 40fps): windup before a bite
          biteRange: 90, // wiki attemptBiteRadius x 0.75
          biteDamage: 4, // wiki biteDamage (lizard fights)
          toughness: 6, // wiki says 3; doubled: reds feud and need the staying power
          stunImmune: true,
          // red creatures can't stand each other (see Creature.redFoe), and
          // armoured: no one grabs one alive, every attack just wears it down
          red: true,
          armored: true,
          spits: true, // a volley of red spines, then in for the kill // wiki: red lizards can't be stunned or flipped by rocks
          spines: 18,
          pattern: 'dots',
        },
      },
      lizard_yellow: {
        label: 'Yellow Lizard',
        enabled: true,
        weight: 1.5,
        max: 4, // (pack hunters: they come in pairs)
        popCost: 0.5, // half each: they come in pairs
        params: {
          headColor: '#ffbf1c',
          bodyColor: '#120d06',
          length: 0.95,
          speed: 49, // wiki baseSpeed 4.1 x 12
          huntSpeed: 83,
          climbWalls: false,
          climbCeilings: false,
          poles: true,
          vision: 297,
          mass: 1.7, // wiki bodyMass
          chargeRate: 0.05, // wiki loungeTendency: chance to pounce from afar
          biteDelay: 21, // wiki biteDelay (frames at 40fps): windup before a bite
          biteRange: 30, // wiki attemptBiteRadius x 0.75
          biteDamage: 0.8, // wiki biteDamage (lizard fights)
          toughness: 0.8, // wiki toughness
          spines: 0,
          pattern: 'dapple',
          antennae: true, // the pack's jointed antennae
          tailTip: true,
        },
      },
      lizard_cyan: {
        label: 'Cyan Lizard',
        enabled: true,
        weight: 1,
        max: 1,
        popCost: 1.2,
        params: {
          headColor: '#18d8e8',
          bodyColor: '#0a0d10',
          length: 0.95,
          speed: 58, // wiki baseSpeed 4.85 x 12
          huntSpeed: 99,
          climbWalls: true,
          climbCeilings: true,
          poles: true,
          vision: 327,
          mass: 2.0, // wiki bodyMass
          chargeRate: 0.033, // wiki loungeTendency: chance to pounce from afar
          biteDelay: 12, // wiki biteDelay (frames at 40fps): windup before a bite
          biteRange: 68, // wiki attemptBiteRadius x 0.75
          biteDamage: 1, // wiki biteDamage (lizard fights)
          toughness: 0.9, // wiki toughness
          spines: 0,
          pattern: 'rings',
        },
      },
      daddy: {
        label: 'Daddy Long Legs',
        enabled: true,
        weight: 0.3,
        max: 1,
        popCost: 4,
        params: {
          variants: { daddy: 2, brother: 1 },
          tentacles: 8,
          reach: 250,
          speed: 42,
          bodyRadius: 24,
          toughness: 6, // as tough as a red lizard or a large centipede: ~10 spears
        },
      },
      dropwig: {
        label: 'Dropwig',
        enabled: true,
        weight: 2,
        max: 2,
        popCost: 1,
        params: {
          speed: 85,
          triggerWidth: 26, // how close (horizontally) prey must pass beneath
          patience: 70, // seconds before giving up on an ambush spot
        },
      },
      batfly: {
        label: 'Batflies',
        enabled: true,
        weight: 3,
        max: 14,
        popCost: 0, // batflies don't count toward max population (their own max still applies)
        params: {
          flockSize: [3, 6],
          speed: 110,
        },
      },
      centipede: {
        label: 'Small Centipede',
        enabled: true,
        weight: 5, // common: something for everyone to hunt
        max: 2, // (free, so their own cap is what keeps their numbers down)
        popCost: 0, // free (the small ones)
        params: {
          segments: [6, 9],
          speed: 55,
          huntSpeed: 80,
          diet: ['batfly', 'noodlefly_infant'], // small ones snatch batflies and infant noodleflies
        },
      },
      centipede_medium: {
        label: 'Medium Centipede',
        enabled: true,
        weight: 1,
        max: 2,
        popCost: 1.5,
        params: {
          size: 1.5,
          segments: [8, 11],
          speed: 45,
          huntSpeed: 85,
          toughness: 1.5,
          diet: ['slugcat', 'centipede', 'dropwig', 'noodlefly_infant', 'squidcada', 'noodlefly'], // bigger prey than batflies
          threats: ['daddy', 'centipede_large', 'lizard_*'],
          colors: ['#e65a1c', '#ee7024', '#a8301a', '#922814'], // orange
        },
      },
      centipede_large: {
        label: 'Large Centipede',
        enabled: true,
        weight: 0.5,
        max: 1,
        popCost: 3,
        params: {
          size: 2,
          segments: [10, 13],
          speed: 72, // 30% quicker than the small and medium ones (55)
          huntSpeed: 111, // ...and on the hunt (85): runs down any lizard
          toughness: 6,
          red: true, // feuds with red lizards (and they with it)
          armored: true,
          diet: ['lizard_*', 'slugcat', 'centipede_medium', 'dropwig', 'squidcada', 'noodlefly'], // hunts lizards
          threats: ['daddy'],
          colors: ['#f02a24', '#ff3c2a', '#b81c1c', '#a01818'], // red, the shade of a red lizard
          // highly aggressive: hungry again soon after a meal, sees and
          // chases further and longer, and shocks anything that comes close
          aggressive: true,
          vision: 480,
          // and it stays: a big one settles in as the room's top hunter
          minStay: 300,
          migrateScale: 0.25,
        },
      },
      // Fliers. Noodleflies come as a family: an adult with a brood of
      // infants (infants only ever arrive with an adult).
      noodlefly: {
        label: 'Noodlefly',
        enabled: true,
        weight: 0.6,
        max: 2,
        popCost: 1.5,
        params: {
          brood: [2, 4], // infants that come with it
          vision: 420,
        },
      },
      noodlefly_infant: {
        label: 'Infant Noodlefly',
        enabled: true,
        weight: 0, // never on their own
        max: 10,
        popCost: 0, // free (they come with their parent)
        params: {
          escapeChance: 0,
        },
      },
      squidcada: {
        label: 'Squidcada',
        enabled: true,
        weight: 1.2,
        max: 4,
        popCost: 0.5, // half each: they come in pairs
        params: {
          flockSize: [2, 2], // pairs: more read as a swarm
          blackChance: 0.35,
          escapeChance: 0.12,
        },
      },
    },
  };

  // ---- presets --------------------------------------------------------------
  // Size: how much world there is and how much lives in it. Map size zooms
  // out (ledges, poles and plants scale with the area, see generateDecor),
  // and the art pixels get finer so zoomed-out creatures keep their detail;
  // population, spawn rate, weapons and each species' cap scale with it.
  RW.SIZE_PRESETS = {
    compact: { label: 'Compact', mapSize: 1, pixelScale: 2.5, maxPopulation: 5, spawnPerMinute: 2.5, rocks: 15, spears: 3, caps: 1 },
    normal: { label: 'Normal', mapSize: 1.4, pixelScale: 2, maxPopulation: 8, spawnPerMinute: 4, rocks: 28, spears: 6, caps: 1.7 },
    large: { label: 'Large', mapSize: 1.8, pixelScale: 1.5, maxPopulation: 12, spawnPerMinute: 6, rocks: 42, spears: 8, caps: 2.5 },
    xl: { label: 'XL', mapSize: 2.4, pixelScale: 1, maxPopulation: 18, spawnPerMinute: 9, rocks: 65, spears: 13, caps: 3.6 },
  };
  // Wildlife: which creatures turn up (spawn weights; anything not listed
  // stays away), each mix chosen to show off a set of behaviours. `caps`
  // multiplies the featured species' caps; `weapons` scales the rocks and
  // spears lying about.
  const LIZ = ['lizard_pink', 'lizard_green', 'lizard_blue', 'lizard_white', 'lizard_red', 'lizard_yellow', 'lizard_cyan'];
  RW.WILDLIFE_PRESETS = {
    balanced: { label: 'Balanced', note: 'a bit of everything', weights: null },
    turf: {
      label: 'Lizard turf wars',
      note: 'every colour of lizard staking out ledges, fighting over hangouts and kills',
      weights: { lizard_pink: 3, lizard_green: 2, lizard_blue: 3, lizard_white: 1.5, lizard_red: 1, lizard_yellow: 2.5, lizard_cyan: 2, slugcat: 2, batfly: 3, centipede: 4, squidcada: 1 },
      caps: { lizard_pink: 2, lizard_green: 2, lizard_blue: 2, lizard_white: 2, lizard_red: 2, lizard_yellow: 4, lizard_cyan: 2 },
    },
    hunters: {
      label: 'Slugcat hunters',
      note: 'slugcats with rocks and spears knocking down fruit and batflies, fending off a few lizards',
      weights: { slugcat: 8, batfly: 5, centipede: 5, centipede_medium: 1, lizard_pink: 1, lizard_green: 1, squidcada: 1.5, noodlefly: 0.5 },
      caps: { slugcat: 2 },
      weapons: 1.6,
    },
    centipedes: {
      label: 'Centipede hunt',
      note: 'centipedes of every size; the big ones go after lizards',
      weights: { centipede: 5, centipede_medium: 3, centipede_large: 2, lizard_pink: 2, lizard_blue: 2, lizard_green: 1.5, slugcat: 2, batfly: 3, squidcada: 1, noodlefly: 0.4 },
      caps: { centipede_medium: 2, centipede_large: 2 },
    },
    ambush: {
      label: 'Ambushers',
      note: 'dropwigs on the ceilings, white and cyan lizards lying in wait, noodleflies stalking from above',
      weights: { dropwig: 5, lizard_white: 3, lizard_cyan: 2.5, noodlefly: 1.5, slugcat: 4, batfly: 4, centipede: 4, squidcada: 1.5 },
      caps: { dropwig: 2, lizard_white: 3, lizard_cyan: 2 },
    },
    daddy: {
      label: "Daddy's buffet",
      note: 'Daddy Long Legs drifting through a crowd of prey',
      weights: { daddy: 2.5, slugcat: 5, batfly: 4, centipede: 5, lizard_pink: 1, squidcada: 2, noodlefly: 0.5 },
      caps: { daddy: 2 },
    },
    flyers: {
      label: 'Flyers',
      note: 'noodlefly families, squidcada flocks and batflies, with slugcats and small centipedes for prey',
      weights: { noodlefly: 2.5, squidcada: 3, batfly: 3, slugcat: 4, centipede: 5 },
      caps: { noodlefly: 2, squidcada: 1.5, slugcat: 1.5, centipede: 1.5 },
    },
    peaceful: {
      label: 'Peaceful',
      note: 'no predators: slugcats, batflies, small centipedes and squidcadas going about their day',
      weights: { slugcat: 5, batfly: 5, centipede: 5, squidcada: 2 },
    },
  };
  RW.LIZARD_SPECIES = LIZ;

  // Set the values a preset governs (from the base settings, so presets never
  // compound). 'custom' (or an unknown name) leaves things as they are.
  const PAIRS = ['lizard_yellow', 'squidcada'];
  RW.applySizePreset = function (cfg, name) {
    const P = RW.SIZE_PRESETS[name];
    cfg.presets = cfg.presets || {};
    cfg.presets.size = P ? name : 'custom';
    if (!P) return;
    const wild = RW.WILDLIFE_PRESETS[cfg.presets.wildlife] || {};
    const W = wild.weapons || 1;
    cfg.world.mapSize = P.mapSize;
    cfg.world.pixelScale = P.pixelScale;
    cfg.ecosystem.maxPopulation = P.maxPopulation;
    cfg.ecosystem.spawnPerMinute = P.spawnPerMinute;
    cfg.ecosystem.rocks = Math.round(P.rocks * W);
    cfg.ecosystem.spears = Math.round(P.spears * W);
    for (const k of Object.keys(cfg.species)) {
      const base = RW.BASE_CONFIG.species[k];
      // the free ones (batflies, slugcats...) cost nothing toward the
      // population, so their own caps grow more slowly with the map
      const f = (base && base.popCost === 0 ? Math.pow(P.caps, 0.6) : P.caps) * ((wild.caps && wild.caps[k]) || 1);
      // (the ones that come out in pairs: an even number, so none is left
      // to come out alone)
      if (base) cfg.species[k].max = PAIRS.includes(k) ? Math.max(2, 2 * Math.round((base.max * f) / 2)) : Math.max(1, Math.round(base.max * f));
    }
  };
  // Picking a size starts the world and the rain from their defaults (then
  // the size's own map scale and pixels); called only when the owner picks
  // a different size, not each time a preset is re-applied.
  RW.resetWorldAndRain = function (cfg) {
    // in place: other code holds on to these objects
    for (const k of ['world', 'rain']) {
      for (const key of Object.keys(cfg[k])) delete cfg[k][key];
      Object.assign(cfg[k], RW.U.clone(RW.DEFAULT_CONFIG[k]));
    }
  };
  RW.applyWildlifePreset = function (cfg, name) {
    const P = RW.WILDLIFE_PRESETS[name];
    cfg.presets = cfg.presets || {};
    cfg.presets.wildlife = P ? name : 'custom';
    if (!P) return;
    for (const k of Object.keys(cfg.species)) {
      const base = RW.BASE_CONFIG.species[k];
      if (!base) continue;
      const w = P.weights ? P.weights[k] || 0 : base.weight;
      cfg.species[k].weight = w;
      cfg.species[k].enabled = w > 0; // a creature the preset leaves out shows unchecked
    }
    // infants only ever come with their parents
    if (cfg.species.noodlefly_infant && cfg.species.noodlefly) cfg.species.noodlefly_infant.enabled = cfg.species.noodlefly.enabled;
    // the weapon supply depends on both
    if (RW.SIZE_PRESETS[cfg.presets.size]) RW.applySizePreset(cfg, cfg.presets.size);
  };

  RW.DEFAULT_CONFIG = RW.U.clone(RW.BASE_CONFIG);
  RW.DEFAULT_CONFIG.presets = { size: 'normal', wildlife: 'balanced' };
  RW.DEFAULT_CONFIG.rev = 8; // (see loadConfig)
  RW.applySizePreset(RW.DEFAULT_CONFIG, 'normal');

  const STORAGE_KEY = 'rw-desktop-config-v17'; // bumped when defaults change shape

  RW.loadConfig = function () {
    const cfg = RW.U.clone(RW.DEFAULT_CONFIG);
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const raw = JSON.parse(saved);
        RW.U.deepMerge(cfg, raw);
        // rev 2: rooms became the default and tiers/scatter merged into
        // 'ledges'; an older save opens on rooms
        if (!(raw.rev >= 2)) cfg.world.layout = 'experimental';
        // rev 3: the population cap 60% lower, some creatures free and the
        // pairs half each; an older save takes the new cap for its size and
        // the new costs
        if (!(raw.rev >= 3)) {
          const P = RW.SIZE_PRESETS[cfg.presets && cfg.presets.size];
          if (P) cfg.ecosystem.maxPopulation = P.maxPopulation;
          else cfg.ecosystem.maxPopulation = Math.max(1, Math.round(cfg.ecosystem.maxPopulation * 0.4));
          for (const k of Object.keys(cfg.species)) if (RW.BASE_CONFIG.species[k]) cfg.species[k].popCost = RW.BASE_CONFIG.species[k].popCost;
        }
        // rev 4: slugcats and small centipedes (free) capped lower
        if (!(raw.rev >= 4)) {
          const P = RW.SIZE_PRESETS[cfg.presets && cfg.presets.size];
          const f = P ? Math.pow(P.caps, 0.6) : 1;
          for (const k of ['slugcat', 'centipede']) if (cfg.species[k]) cfg.species[k].max = Math.max(1, Math.round(RW.BASE_CONFIG.species[k].max * f));
        }
        // rev 5: the pair species' caps even
        if (!(raw.rev >= 5)) for (const k of PAIRS) if (cfg.species[k] && cfg.species[k].max % 2) cfg.species[k].max += 1;
        // rev 7: the cyan lizard's body back to black (rev 6 had it cyan)
        if (!(raw.rev >= 7) && cfg.species.lizard_cyan) cfg.species.lizard_cyan.params.bodyColor = RW.BASE_CONFIG.species.lizard_cyan.params.bodyColor;
        // rev 8: white lizards climb ceilings (to hang in ambush)
        if (!(raw.rev >= 8) && cfg.species.lizard_white) Object.assign(cfg.species.lizard_white.params, { climbCeilings: true, ambush: true });
        cfg.rev = RW.DEFAULT_CONFIG.rev;
      }
    } catch (e) {
      /* storage blocked or corrupt — run on defaults */
    }
    return cfg;
  };

  RW.saveConfig = function (cfg) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch (e) {
      /* ignore */
    }
  };

  RW.clearSavedConfig = function () {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
  };
})();
