// Behaviour checks: each one runs the simulation headlessly, measures one
// thing that has gone wrong before (bodies folding, dropwigs falling off
// corners, fruit dropping by itself...) and passes or fails on a threshold.
//
//   cd tests && npm install
//   node behaviour.mjs                 all checks (~10-15 min)
//   node behaviour.mjs --quick         shorter runs (~5 min), looser numbers
//   node behaviour.mjs bodies fruit    just the named checks
//   (CHROMIUM_PATH=/path/to/chrome to use a preinstalled browser)
//
// The simulation isn't seeded (only the map is, via ?seed=), so the numbers
// vary run to run. Thresholds sit well clear of the measured values; a check
// that fails once is worth a rerun before digging in, one that fails twice
// is a real regression. A check can also WARN when the random run gave it
// nothing to measure (e.g. no slugcat happened to need a ledge scramble).
import { launch, openPrototype } from './lib.mjs';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const only = args.filter((a) => !a.startsWith('--'));
const T = (min) => (quick ? min / 2 : min); // simulated minutes per check

// Every check: run(page) -> metrics (computed in the page), then
// judge(metrics) -> list of failures (empty = pass) and optional warnings.
const checks = [
  {
    name: 'soak',
    about: 'default settings through two downpours: no errors, no runaway population, active creatures not getting stuck',
    run: (page) =>
      page.evaluate((mins) => {
        const e = RW_APP.engine;
        e.cfg.rain.cycleMinutes = Math.max(1.5, mins / 2);
        // Burrowing away is the safety net for a creature that hasn't moved in
        // a while. One that's sheltering/leaving with no route to a den is
        // meant to slip away like that; an active one stuck is a bug.
        const C = RW.Creature.prototype;
        const bw = C.burrowAway;
        let stuckBurrows = 0;
        let leaveSlips = 0;
        C.burrowAway = function () {
          if (!this.burrow && !this.dead) {
            if (this.state === 'leave') leaveSlips++;
            else stuckBurrows++;
          }
          return bw.apply(this, arguments);
        };
        let bad = 0;
        let peakN = 0;
        let peakPop = 0;
        for (let i = 0; i < mins * 3600; i++) {
          e.tick(1 / 60);
          if (i % 300) continue;
          const eco = e.eco; // always re-read: regenerate() replaces the ecosystem
          peakN = Math.max(peakN, eco.creatures.length);
          peakPop = Math.max(peakPop, eco.population());
          for (const c of eco.creatures) if (!isFinite(c.x) || !isFinite(c.y)) bad++;
        }
        return { bad, peakN, peakPop: +peakPop.toFixed(1), cap: e.cfg.ecosystem.maxPopulation, stuckBurrows, leaveSlips, born: e.eco.stats.born };
      }, T(8)),
    judge: (m) => [
      m.bad && `${m.bad} non-finite creature positions`,
      m.peakN < 5 && 'ecosystem never populated',
      m.peakPop > m.cap * 1.4 && `population ran away (${m.peakPop} vs cap ${m.cap})`,
      // measured: ~0-1 per run (was ~4 before corner clambering)
      m.stuckBurrows > Math.max(3, m.born * 0.04) && `${m.stuckBurrows} active creatures got stuck and burrowed away (of ${m.born})`,
    ],
  },
  {
    name: 'bodies',
    about: 'centipedes never fold in half; lizards never hairpin or ball up on poles',
    run: (page) =>
      page.evaluate((mins) => {
        const e = RW_APP.engine;
        e.cfg.rain.enabled = false;
        e.cfg.ecosystem.predation = false;
        const S = e.cfg.species;
        for (const k in S) S[k].weight = 0;
        Object.assign(S.centipede, { weight: 3 });
        Object.assign(S.centipede_medium, { weight: 2 });
        for (const k of ['lizard_pink', 'lizard_blue', 'lizard_yellow']) S[k].weight = 2;
        S.slugcat.weight = 1;
        e.restartWildlife();
        const st = { centi: [0, 0, 0], lizPole: [0, 0, 0], liz: [0, 0, 0] }; // frames, hairpin joint, balled up
        for (let i = 0; i < mins * 3600; i++) {
          e.tick(1 / 60);
          if (i % 4) continue;
          const W = e.world;
          for (const c of e.eco.creatures) {
            if (c.dead || c.corpse || c.grabbedBy || c.burrow || c.turn || c.piping || c.unpiping) continue; // (a body bent into a pipe mouth isn't balled up)
            let P;
            let n;
            let k;
            if (c.chain && c.species.startsWith('centipede')) {
              P = c.chain.pts;
              n = P.length;
              k = 'centi';
            } else if (c.spine && c.species.startsWith('lizard')) {
              P = c.spine.pts;
              n = c.bodyN + 3;
              const h = P[Math.floor(c.bodyN / 2)];
              const cx = W.cellX(h.x);
              const cy = W.cellY(h.y);
              k = W.pole(cx, cy) && !W.solid(cx, cy + 1) ? 'lizPole' : 'liz';
            } else continue;
            let len = 0;
            let hair = false;
            for (let j = 1; j < n; j++) {
              len += Math.hypot(P[j].x - P[j - 1].x, P[j].y - P[j - 1].y);
              if (j < 2) continue;
              const ax = P[j - 1].x - P[j - 2].x;
              const ay = P[j - 1].y - P[j - 2].y;
              const bx = P[j].x - P[j - 1].x;
              const by = P[j].y - P[j - 1].y;
              if ((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1) < -0.5) hair = true;
            }
            const ratio = Math.hypot(P[n - 1].x - P[0].x, P[n - 1].y - P[0].y) / (len || 1);
            st[k][0]++;
            if (hair) st[k][1]++;
            if (ratio < 0.35) st[k][2]++;
          }
        }
        const pct = (a, i) => +((100 * a[i]) / (a[0] || 1)).toFixed(1);
        return {
          centiFrames: st.centi[0],
          centiHairpinPct: pct(st.centi, 1),
          centiBalledPct: pct(st.centi, 2),
          lizHairpinPct: pct(st.liz, 1),
          lizPoleFrames: st.lizPole[0],
          lizPoleBalledPct: pct(st.lizPole, 2),
        };
      }, T(5)),
    // measured: centipede hairpin 2-7% (was 82%), lizard pole balled 3-5% (was 21%)
    judge: (m) => [
      m.centiFrames < 500 && 'too few centipede frames to judge',
      m.centiHairpinPct > 10 && `centipedes folding (${m.centiHairpinPct}% of frames)`,
      m.centiBalledPct > 6 && `centipedes balled up (${m.centiBalledPct}%)`,
      m.lizHairpinPct > 8 && `lizard bodies hairpinning (${m.lizHairpinPct}%)`,
      m.lizPoleFrames > 300 && m.lizPoleBalledPct > 12 && `lizards balling up on poles (${m.lizPoleBalledPct}%)`,
    ],
  },
  {
    name: 'centipedes',
    about: 'centipedes get about on every surface: they rarely lose their grip, and never sit stuck long enough to burrow away',
    run: (page) =>
      page.evaluate((mins) => {
        const e = RW_APP.engine;
        e.cfg.rain.enabled = false;
        e.cfg.ecosystem.predation = false;
        const S = e.cfg.species;
        for (const k in S) S[k].weight = 0;
        S.centipede.weight = 3;
        S.centipede_medium.weight = 3;
        S.centipede_medium.max = 3;
        S.centipede_large.weight = 3;
        S.centipede_large.max = 2;
        e.restartWildlife();
        let frames = 0;
        let slips = 0;
        let burrows = 0;
        const B = RW.Creature.prototype.burrowAway;
        RW.Creature.prototype.burrowAway = function () {
          if (!this.burrow && this.species.startsWith('centipede')) burrows++;
          return B.call(this);
        };
        const air = new Map();
        for (let i = 0; i < mins * 3600; i++) {
          e.tick(1 / 60);
          for (const c of e.eco.creatures) {
            if (!c.species.startsWith('centipede') || c.dead || c.corpse || c.leaving || c.grabbedBy) continue;
            frames++;
            // falling fast without meaning to (not a planned drop, not stunned)
            const n = c.pather.current();
            const falling = c.vy > 200;
            if (falling && !air.get(c) && !(c.dropT > 0) && !(c.stunT > 0) && !(n && n.type === RW.Nav.FALL)) slips++;
            air.set(c, falling);
          }
        }
        RW.Creature.prototype.burrowAway = B;
        const m = frames / 3600;
        return { centipedeMinutes: +m.toFixed(1), slipsPerMin: +(slips / (m || 1)).toFixed(2), burrowsPerHour: +((burrows / (m || 1)) * 60).toFixed(1) };
      }, T(5)),
    // measured: ~0.15 slips per centipede-minute (was ~3), ~0.5 burrows per
    // centipede-hour (was ~12: stuck "at" goals they'd already reached)
    judge: (m) => [
      m.centipedeMinutes < 10 && 'too few centipedes to judge',
      m.slipsPerMin > 0.8 && `centipedes losing their grip (${m.slipsPerMin}/min)`,
      m.burrowsPerHour > 4 && `centipedes getting stuck and burrowing away (${m.burrowsPerHour}/hour)`,
    ],
  },
  {
    name: 'dropwigs',
    about: 'dropwigs keep their grip round corners and reach ceilings to ambush from',
    run: (page) =>
      page.evaluate((mins) => {
        const e = RW_APP.engine;
        e.cfg.rain.enabled = false;
        e.cfg.ecosystem.predation = false;
        const S = e.cfg.species;
        for (const k in S) S[k].weight = 0;
        S.dropwig.weight = 3;
        S.dropwig.max = 4;
        S.slugcat.weight = 0.5;
        e.restartWildlife();
        let frames = 0;
        let losses = 0;
        let waits = 0;
        const grip = new Map();
        const state = new Map();
        for (let i = 0; i < mins * 3600; i++) {
          e.tick(1 / 60);
          for (const c of e.eco.creatures) {
            if (c.species !== 'dropwig' || c.dead) continue;
            frames++;
            const had = grip.get(c.id);
            grip.set(c.id, !!c.grip);
            if (c.state === 'wait' && state.get(c.id) !== 'wait') waits++;
            state.set(c.id, c.state);
            if (had && !c.grip && (c.state === 'seek' || c.state === 'leave') && !(c.dropT > 0) && !c.leap) losses++; // a ceiling leap lets go on purpose
          }
        }
        const dwMin = frames / 3600;
        return { dropwigMinutes: +dwMin.toFixed(1), gripLossesPerMin: +(losses / (dwMin || 1)).toFixed(2), ambushesSetUp: waits };
      }, T(5)),
    // measured: ~0.25 grip losses per dropwig-minute (was ~50)
    judge: (m) => [
      m.dropwigMinutes < 3 && 'too few dropwigs to judge',
      m.gripLossesPerMin > 3 && `dropwigs losing their grip (${m.gripLossesPerMin}/min)`,
      m.ambushesSetUp < 1 && 'no dropwig ever settled on a ceiling',
    ],
  },
  {
    name: 'scramble',
    about: 'from a pole beside a ledge, creatures scramble up over the lip more often than they slip',
    seed: 21,
    run: (page) =>
      page.evaluate((mins) => {
        const e = RW_APP.engine;
        e.cfg.rain.enabled = false;
        e.cfg.ecosystem.predation = false;
        const S = e.cfg.species;
        for (const k in S) S[k].weight = 0;
        S.slugcat.weight = 3;
        S.lizard_pink.weight = 2;
        S.lizard_yellow.weight = 2;
        e.restartWildlife();
        const out = { slugDone: 0, slugSlip: 0, lizDone: 0, lizSlip: 0 };
        const B = RW.Creature.prototype;
        const ss = B.stepScramble;
        B.stepScramble = function (dt, pt) {
          const r = ss.call(this, dt, pt);
          const who = this.species === 'slugcat' ? 'slug' : 'liz';
          if (r === 'done') out[who + 'Done']++;
          if (r === 'slip') out[who + 'Slip']++;
          return r;
        };
        for (let i = 0; i < mins * 3600; i++) e.tick(1 / 60);
        return out;
      }, T(5)),
    // measured: slugcats ~85% success, lizards ~50% (size-dependent by design)
    judge: (m) => [
      m.slugDone + m.slugSlip >= 4 && m.slugDone < m.slugSlip && `slugcats slip more than they scramble up (${m.slugDone}/${m.slugSlip})`,
    ],
    warn: (m) => m.slugDone + m.slugSlip + m.lizDone + m.lizSlip === 0 && 'no scrambles happened this run',
  },
  {
    name: 'jumps',
    about: 'slugcats jump (pole to pole too), lizards leap between poles, centipedes never jump',
    run: (page) =>
      page.evaluate((mins) => {
        const e = RW_APP.engine;
        e.cfg.rain.enabled = false;
        e.cfg.ecosystem.predation = false;
        const S = e.cfg.species;
        for (const k in S) S[k].weight = 0;
        S.slugcat.weight = 3;
        for (const k of ['lizard_pink', 'lizard_blue', 'lizard_yellow']) S[k].weight = 2;
        S.centipede.weight = 2;
        S.centipede_large.weight = 1;
        e.restartWildlife();
        const out = { slugJumps: 0, slugLongLeaps: 0, lizardLeaps: 0, centipedeJumpCaps: 0 };
        const L = RW.Creatures.Lizard.prototype;
        const ll = L.launchLeap;
        L.launchLeap = function (node) {
          out.lizardLeaps++;
          return ll.call(this, node);
        };
        const Sl = RW.Creatures.Slugcat.prototype;
        const la = Sl.launch;
        Sl.launch = function (node) {
          out.slugJumps++;
          if (this.longJump) out.slugLongLeaps++;
          return la.call(this, node);
        };
        for (const sp of ['centipede', 'centipede_medium', 'centipede_large']) {
          const c = new (e.eco.classFor(sp))(e.eco, sp, 100, 100).caps;
          if (c.jumpX || c.jumpUp) out.centipedeJumpCaps++;
        }
        for (let i = 0; i < mins * 3600; i++) e.tick(1 / 60);
        return out;
      }, T(6)),
    judge: (m) => [m.centipedeJumpCaps && 'centipedes can jump', m.slugJumps < 3 && `slugcats hardly jump (${m.slugJumps})`],
    warn: (m) => (!m.lizardLeaps && 'no lizard pole leaps this run') || (!m.slugLongLeaps && 'no slugcat long leaps this run'),
  },
  {
    name: 'fruit',
    about: 'ripe fruit only drops when hit, and dropped fruit rots instead of piling up',
    run: (page) =>
      page.evaluate((mins) => {
        const e = RW_APP.engine;
        e.cfg.rain.enabled = false;
        let knocks = 0;
        const P = RW.FruitPlant.prototype;
        const ko = P.knockOff;
        P.knockOff = function () {
          if (this.ripe()) knocks++;
          return ko.apply(this, arguments);
        };
        const seen = new Set();
        let maxLoose = 0;
        let oldest = 0;
        for (let i = 0; i < mins * 3600; i++) {
          e.tick(1 / 60);
          if (i % 30) continue;
          let loose = 0;
          for (const it of e.eco.items) {
            if (!(it instanceof RW.Fruit) || it.dead) continue;
            seen.add(it);
            if (!it.heldBy) loose++;
            if (!it.claimedBy && !it.heldBy) oldest = Math.max(oldest, it.age);
          }
          maxLoose = Math.max(maxLoose, loose);
        }
        return { fruitDropped: seen.size, knocks, maxLoose, oldestUnclaimedS: Math.round(oldest) };
      }, T(6)),
    judge: (m) => [
      m.fruitDropped > m.knocks && `fruit appeared without being knocked off (${m.fruitDropped} fruit, ${m.knocks} knocks)`,
      m.maxLoose > 6 && `loose fruit piling up (${m.maxLoose})`,
      m.oldestUnclaimedS > 62 && `fruit not rotting away (${m.oldestUnclaimedS}s old)`,
    ],
  },
  {
    name: 'transients',
    about: 'slugcats and Daddy Long Legs leave after two meals (or a long fruitless while); batflies never run out',
    run: (page) =>
      page.evaluate((mins) => {
        const e = RW_APP.engine;
        e.cfg.rain.enabled = false;
        RW.applyWildlifePreset(e.cfg, 'daddy');
        e.restartWildlife();
        const out = { slugLeft: 0, slugEarly: 0, daddyLeft: 0, daddyEarly: 0, minBatflies: 99, nests: e.eco.nests.length };
        const C = RW.Creature.prototype;
        const lv = C.leave;
        C.leave = function () {
          if (this.species === 'slugcat') {
            out.slugLeft++;
            if (this.meals < 2 && this.age <= 210) out.slugEarly++;
          }
          if (this.species === 'daddy') {
            out.daddyLeft++;
            if (this.meals < 2 && this.age <= 300) out.daddyEarly++;
          }
          return lv.apply(this, arguments);
        };
        for (let i = 0; i < mins * 3600; i++) {
          e.tick(1 / 60);
          if (i > 3600 && i % 1800 === 0) out.minBatflies = Math.min(out.minBatflies, e.eco.count('batfly'));
        }
        return out;
      }, T(8)),
    judge: (m) => [
      m.slugEarly && `${m.slugEarly} slugcats left before eating twice`,
      m.daddyEarly && `${m.daddyEarly} Daddy Long Legs left before eating twice`,
      m.nests < 1 && 'no batfly nest',
      m.minBatflies < 1 && 'batflies ran out',
    ],
    warn: (m) => !m.slugLeft && 'no slugcat finished its visit this run',
  },
  {
    name: 'fliers',
    about: 'noodlefly families hunt, feed and leave together; a grabbed infant gets avenged; squidcadas flock, rest and feed; fliers stay on screen',
    run: async (page) => {
      const m = await page.evaluate((mins) => {
        const e = RW_APP.engine;
        e.cfg.rain.enabled = false;
        RW.applyWildlifePreset(e.cfg, 'flyers');
        e.restartWildlife();
        const out = { noodleMeals: 0, squidMeals: 0, squidRests: 0, squidPlays: 0, familiesLeft: 0, leftEarly: 0, infantsLeftWithFamily: 0, offScreen: 0, bad: 0 };
        const cons = e.eco.consume.bind(e.eco);
        e.eco.consume = (prey, by) => {
          if (by && by.species === 'noodlefly') out.noodleMeals++;
          if (by && by.species === 'squidcada') out.squidMeals++;
          return cons(prey, by);
        };
        const drn = e.eco.drain.bind(e.eco);
        e.eco.drain = (prey, by) => {
          out.noodleMeals++;
          return drn(prey, by);
        };
        const S = RW.Creatures.Squidcada.prototype;
        const ss = S.setState;
        S.setState = function (st) {
          if (st !== this.state && st === 'rest') out.squidRests++;
          if (st !== this.state && st === 'play') out.squidPlays++;
          return ss.call(this, st);
        };
        const C = RW.Creature.prototype;
        const lv = C.leave;
        C.leave = function () {
          if (this.species === 'noodlefly' && !e.eco.shouldShelter()) {
            out.familiesLeft++;
            if (this.meals < 2 && this.age <= 240) out.leftEarly++;
          }
          if (this.species === 'noodlefly_infant' && this.family.exitDen) out.infantsLeftWithFamily++;
          return lv.apply(this, arguments);
        };
        for (let i = 0; i < mins * 3600; i++) {
          e.tick(1 / 60);
          if (i % 60) continue;
          for (const c of e.eco.creatures) {
            if (!isFinite(c.x) || !isFinite(c.y)) out.bad++;
            if (c.isFlier && !c.dead && !c.piping && !c.unpiping && (c.x < -5 || c.y < -5 || c.x > e.world.w + 5 || c.y > e.world.h + 5)) out.offScreen++;
          }
        }
        return out;
      }, T(6));
      // revenge, staged: a slugcat grabs an infant next to its adult
      m.avenged = await page.evaluate(() => {
        const e = RW_APP.engine;
        const S = e.cfg.species;
        for (const k in S) S[k].weight = 0;
        e.restartWildlife();
        const slug = e.eco.spawn('slugcat');
        const ad = e.eco.spawn('noodlefly', slug.x + 120, slug.y - 90);
        // (no throwing while it's staged: a spear at the adult spoils it)
        for (let i = 0; i < 60; i++) {
          slug.throwCd = 9;
          e.tick(1 / 60);
        }
        const inf = ad.family.infants[0];
        inf.pos.x = slug.hip.x;
        inf.pos.y = slug.hip.y - 10;
        inf.cling = -1;
        slug.grab(inf);
        return ad.vengeance === slug;
      });
      return m;
    },
    judge: (m) => [
      m.bad && `${m.bad} non-finite positions`,
      m.offScreen > 5 && `fliers off screen (${m.offScreen} samples)`,
      m.leftEarly && `${m.leftEarly} noodlefly families left before eating twice`,
      !m.avenged && 'an adult noodlefly did not go after whoever grabbed its infant',
      m.noodleMeals + m.squidMeals < 1 && 'fliers never ate',
    ],
    warn: (m) => (!m.familiesLeft && 'no noodlefly family finished its visit') || (!m.squidRests && 'no squidcada rested'),
  },
  {
    name: 'rain',
    about: 'rain eases into and out of the downpour exponentially; waterfalls only in real rain; rain falls past horizontal poles',
    run: (page) =>
      page.evaluate(() => {
        const e = RW_APP.engine;
        const R = e.cfg.rain;
        R.cycleMinutes = 1;
        const w = e.weather;
        const cyc = 60;
        const out = { flatEarly: true, rampMonotonic: true, peak: 0, decaysBack: false, waterfallsInDrizzle: 0, beamBlocked: 0, beamExposed: 0 };
        let last = 0;
        e.tick(1 / 60);
        while (w.t < cyc * 2.3) {
          e.tick(1 / 60);
          const ph = w.phase;
          const second = w.t >= cyc;
          if (!second && ph < 0.5 && Math.abs(w.intensity - R.drizzle) > 1e-6) out.flatEarly = false;
          if (!second && ph > 0.5 && !w.downpour && w.intensity < last - 1e-6) out.rampMonotonic = false;
          if (w.downpour) out.peak = Math.max(out.peak, w.intensity);
          if (second && ph > 0.25 && ph < 0.5 && Math.abs(w.intensity - R.drizzle) < 0.01) out.decaysBack = true;
          if (w.intensity < (R.waterfallsFrom ?? 0.35) && w.waterfalls > 0) out.waterfallsInDrizzle++;
          last = w.intensity;
        }
        // rain shadow: points right under a horizontal pole that the rain
        // reaches must still get rain
        for (const s of e.world.solids.filter((q) => q.kind === 'beam')) {
          for (let fx = 0.1; fx < 0.95; fx += 0.1) {
            const x = s.x + s.w * fx;
            if (w.shelterAt(x, s.y - 1) < s.y - 1) continue; // in a ledge's shadow anyway
            out.beamExposed++;
            const hit = w.shelterAt(x, s.y + s.h + 2);
            if (hit >= s.y && hit <= s.y + s.h + 1) out.beamBlocked++;
          }
        }
        return out;
      }),
    judge: (m) => [
      !m.flatEarly && 'light rain not steady early in the cycle',
      !m.rampMonotonic && 'build-up to the downpour not smooth',
      m.peak < 0.99 && 'downpour never reached full strength',
      !m.decaysBack && 'rain never eased back to light rain after the downpour',
      m.waterfallsInDrizzle && 'ledge waterfalls running in light rain',
      m.beamBlocked && `horizontal poles block the rain (${m.beamBlocked} points)`,
    ],
    warn: (m) => !m.beamExposed && 'no horizontal pole caught any rain on this map',
  },
  {
    name: 'shelter',
    about: 'creatures head into the pipes before the downpour and come back out of them after it',
    run: (page) =>
      page.evaluate(() => {
        const e = RW_APP.engine;
        const R = e.cfg.rain;
        R.enabled = true;
        R.shelterDuringDownpour = true;
        const w = e.weather;
        for (let i = 0; i < 60 * 40; i++) e.tick(1 / 60);
        const cyc = R.cycleMinutes * 60;
        // to 50 s before the next downpour
        w.t = Math.floor(w.t / cyc) * cyc + cyc * (1 - R.downpourFraction) - 50;
        const alive = () => e.eco.creatures.filter((c) => !c.dead && !c.corpse && !c.leaving && c.species !== 'batfly').length;
        const out = { before: alive(), piped: 0, faded: 0, outAtDownpour: -1, sheltered: 0, backAfter40s: -1, stillInside: -1 };
        const C = RW.Creature.prototype;
        const lv = C.leave;
        C.leave = function () {
          const r = lv.apply(this, arguments);
          if (this.piping) out.piped++;
          else out.faded++;
          return r;
        };
        let after = -1;
        for (let i = 0; i < 60 * 140; i++) {
          e.tick(1 / 60);
          if (w.downpour && out.outAtDownpour < 0) out.outAtDownpour = alive();
          if (w.downpour) out.sheltered = Math.max(out.sheltered, e.eco.shelterStash.filter((c) => c.species !== 'batfly').length);
          if (out.outAtDownpour >= 0 && !w.downpour && after < 0) after = i;
          if (after >= 0 && i === after + 60 * 40) {
            out.backAfter40s = alive();
            out.stillInside = e.eco.shelterStash.length;
          }
        }
        C.leave = lv;
        return out;
      }),
    judge: (m) => [
      m.outAtDownpour > Math.max(3, m.before * 0.3) && `${m.outAtDownpour} of ${m.before} still out when the downpour hit`,
      m.piped < m.faded && 'most creatures faded away instead of going into a pipe',
      m.sheltered < 1 && 'nothing sheltered in the pipes',
      m.stillInside > 0 && `${m.stillInside} never came back out after the rain`,
      m.backAfter40s < m.sheltered * 0.6 && `only ${m.backAfter40s} creatures out 40 s after the rain`,
    ],
  },
  {
    name: 'reds',
    about: 'red lizards and large centipedes fight on sight and wear each other down; red lizards spit spine volleys that stun',
    run: (page) =>
      page.evaluate(() => {
        const e = RW_APP.engine;
        e.cfg.rain.enabled = false;
        RW.applyWildlifePreset(e.cfg, 'peaceful');
        e.cfg.ecosystem.spawnPerMinute = 0;
        e.restartWildlife();
        const out = { duels: 0, decided: 0, hits: 0, liveArmouredGrabs: 0, volleys: 0, spines: 0, spineHits: 0 };
        const C = RW.Creature.prototype;
        const th = C.takeHit;
        C.takeHit = function () {
          out.hits++;
          return th.apply(this, arguments);
        };
        const gr = C.grab;
        C.grab = function (prey) {
          const ok = gr.call(this, prey);
          if (ok && prey.p && prey.p.armored && !prey.corpse) out.liveArmouredGrabs++;
          return ok;
        };
        const S = RW.Spine.prototype;
        const st = S.strike;
        S.strike = function () {
          out.spineHits++;
          return st.apply(this, arguments);
        };
        const L = RW.Creatures.Lizard.prototype;
        const sp = L.spit;
        L.spit = function () {
          out.spines++;
          return sp.apply(this, arguments);
        };
        // measured when written: 3 of 4 duels decided within 2 min, ~20 hits each
        for (let k = 0; k < 3; k++) {
          e.eco.creatures.length = 0;
          const a = e.eco.spawn('lizard_red');
          const b = e.eco.spawn('centipede_large');
          out.duels++;
          for (let i = 0; i < 60 * 120; i++) {
            e.tick(1 / 60);
            if (a.corpse || b.corpse) {
              out.decided++;
              break;
            }
            if (a.dead || b.dead) break; // one left
          }
        }
        // spines: ~1 volley per 20 s of hunting, about half the spines land
        for (let k = 0; k < 3; k++) {
          e.eco.creatures.length = 0;
          const a = e.eco.spawn('lizard_red');
          e.eco.spawn('slugcat');
          let was = 0;
          for (let i = 0; i < 60 * 60; i++) {
            e.tick(1 / 60);
            if (a.spitN > 0 && !was) out.volleys++;
            was = a.spitN || 0;
          }
        }
        C.takeHit = th;
        C.grab = gr;
        S.strike = st;
        L.spit = sp;
        return out;
      }),
    judge: (m) => [
      m.hits < 5 && `red rivals barely touched each other (${m.hits} hits in ${m.duels} duels)`,
      m.liveArmouredGrabs > 0 && `${m.liveArmouredGrabs} armoured creatures were grabbed alive`,
    ],
    warn: (m) => (!m.decided && 'no feud was fought to the death this run') || (!m.spines && 'no red lizard got anything in range for a volley this run'),
  },
  {
    name: 'corpses',
    about: 'lizards contest a scavenged corpse (challenge, display, maybe fight); the winner gets it',
    run: (page) =>
      page.evaluate(() => {
        const e = RW_APP.engine;
        e.cfg.rain.enabled = false;
        RW.applyWildlifePreset(e.cfg, 'peaceful');
        e.cfg.ecosystem.spawnPerMinute = 0;
        e.restartWildlife();
        // (the compact map, so the two are within sight of each other)
        RW.applySizePreset(e.cfg, 'compact');
        e.regenerate(false);
        const out = { trials: 0, contested: 0, fights: 0, eaten: 0 };
        const kinds = ['lizard_pink', 'lizard_green', 'lizard_blue'];
        // measured when written: 3-4 of 8 contested, nearly all taken
        for (let k = 0; k < 8; k++) {
          e.eco.creatures.length = 0;
          // b has just picked up a corpse, a hungry a close by
          const a = e.eco.spawn(kinds[k % 3]);
          const b = e.eco.spawn(kinds[(k + 1) % 3], a.x + 90, a.y);
          for (let i = 0; i < 60 * 3; i++) e.tick(1 / 60);
          const c = e.eco.spawn('centipede', b.x, b.y);
          c.die(4);
          b.grab(c);
          a.fullT = b.fullT = 0;
          a.rivalCd = b.rivalCd = 0; // (new arrivals hold off a while)
          out.trials++;
          let contested = false;
          let fought = false;
          for (let i = 0; i < 60 * 45; i++) {
            e.tick(1 / 60);
            for (const l of [a, b]) {
              if (l.rivalWhy === 'food' && ['challenge', 'display', 'fight'].includes(l.state) && l.prize === c) contested = true;
              if (l.state === 'fight' && l.prize === c) fought = true;
            }
          }
          if (contested) out.contested++;
          if (fought) out.fights++;
          if (c.grabbedBy || c.dead) out.eaten++;
        }
        return out;
      }),
    judge: (m) => [
      m.contested < 1 && `no corpse was contested in ${m.trials} tries`,
      m.eaten < 1 && `none of ${m.trials} corpses was taken`,
    ],
  },
  {
    name: 'throws',
    about: 'spears and spines only fly within 30 degrees of level; slugcats backflip to throw down; slugcats eat only their own kills',
    run: (page) =>
      page.evaluate((mins) => {
        const e = RW_APP.engine;
        e.cfg.rain.enabled = false;
        const S = e.cfg.species;
        S.slugcat.weight = 4;
        S.slugcat.loadout = { spear: 0.8, rock: 0, both: 0.2 };
        for (const k of ['lizard_green', 'lizard_pink', 'lizard_red', 'centipede']) S[k].weight = 2;
        e.restartWildlife();
        const out = { flips: 0, downThrows: 0, levelThrows: 0, steepestLevel: 0, spines: 0, steepestSpine: 0, ownCorpses: 0, othersCorpses: 0 };
        const deg = (vx, vy) => Math.round((Math.abs(Math.atan2(vy, Math.abs(vx))) * 180) / Math.PI);
        const SC = RW.Creatures.Slugcat.prototype;
        const sb = SC.startBackflip;
        SC.startBackflip = function () {
          out.flips++;
          return sb.apply(this, arguments);
        };
        const C = RW.Creature.prototype;
        const gr = C.grab;
        C.grab = function (prey) {
          const ok = gr.call(this, prey);
          if (ok && this.species === 'slugcat' && prey.corpse) out[prey.killedBy === this ? 'ownCorpses' : 'othersCorpses']++;
          return ok;
        };
        const Wp = RW.Weapon.prototype;
        const ta = Wp.throwAt;
        Wp.throwAt = function (vx, vy, by) {
          if (this.kind === 'spear' && by && by.species === 'slugcat') {
            const a = deg(vx, vy);
            if (a > 60) out.downThrows++;
            else {
              out.levelThrows++;
              out.steepestLevel = Math.max(out.steepestLevel, a);
            }
          }
          return ta.apply(this, arguments);
        };
        const L = RW.Creatures.Lizard.prototype;
        const sp = L.spit;
        L.spit = function () {
          const r = sp.apply(this, arguments);
          const s2 = this.eco.items[this.eco.items.length - 1];
          if (s2 && s2.kind === 'spine') {
            out.spines++;
            out.steepestSpine = Math.max(out.steepestSpine, deg(s2.vx, s2.vy));
          }
          return r;
        };
        // measured when written (6 min): 3 flips, all ending in a down-throw
        for (let i = 0; i < mins * 3600; i++) e.tick(1 / 60);
        SC.startBackflip = sb;
        C.grab = gr;
        Wp.throwAt = ta;
        L.spit = sp;
        return out;
      }, T(6)),
    judge: (m) => [
      m.steepestLevel > 30 && `a spear went out at ${m.steepestLevel} degrees (limit 30)`,
      m.steepestSpine > 30 && `a spine went out at ${m.steepestSpine} degrees (limit 30)`,
      m.othersCorpses > 0 && `slugcats took ${m.othersCorpses} corpses they didn't kill`,
      m.flips > 0 && m.downThrows < 1 && 'backflips but no down-throws',
    ],
    warn: (m) => !m.flips && 'no backflip this run',
  },
  {
    name: 'presets',
    about: 'size presets scale the map (more ledge rows, nests, finer pixels); wildlife presets restart with only their creatures',
    run: (page) =>
      page.evaluate(() => {
        const e = RW_APP.engine;
        const out = { defaults: e.cfg.presets.size + '/' + e.cfg.presets.wildlife, sizes: {} };
        for (const sz of ['compact', 'normal', 'large', 'xl']) {
          RW.applySizePreset(e.cfg, sz);
          const rows = [];
          for (const seed of [3, 21]) {
            e.seed = seed;
            const t0 = performance.now();
            e.regenerate(false);
            const d = e.decor;
            rows.push({
              // (floor terrain shares the list but isn't a row)
              tiers: new Set(d.ledges.filter((l) => l.kind === 'ledge').map((l) => l.tier)).size,
              ledges: d.ledges.filter((l) => l.kind === 'ledge').length,
              nests: d.nests.length,
              ms: Math.round(performance.now() - t0),
              ps: e.ps,
            });
          }
          out.sizes[sz] = {
            tiers: Math.min(...rows.map((r) => r.tiers)),
            ledges: Math.min(...rows.map((r) => r.ledges)),
            nests: Math.min(...rows.map((r) => r.nests)),
            msMax: Math.max(...rows.map((r) => r.ms)),
            pixelScale: rows[0].ps,
          };
        }
        RW.applySizePreset(e.cfg, 'normal');
        e.regenerate(false);
        for (let i = 0; i < 600; i++) e.tick(1 / 60);
        RW.applyWildlifePreset(e.cfg, 'peaceful');
        e.restartWildlife();
        out.rainTimerAfterRestart = e.weather.t;
        out.peacefulSpecies = [...new Set(e.eco.creatures.filter((c) => !c.dead).map((c) => c.species))].sort().join(',');
        return out;
      }),
    judge: (m) => {
      const s = m.sizes;
      const peaceful = new Set(['batfly', 'centipede', 'slugcat', 'squidcada']);
      return [
        m.defaults !== 'normal/balanced' && `defaults are ${m.defaults}, expected normal/balanced`,
        s.compact.tiers !== 3 && `compact should have 3 ledge rows (${s.compact.tiers})`,
        !(s.normal.tiers > s.compact.tiers && s.xl.tiers >= 6) && `ledge rows don't grow with the map (${s.compact.tiers}/${s.normal.tiers}/${s.large.tiers}/${s.xl.tiers})`,
        s.xl.nests < 2 && 'XL should have two batfly nests',
        Object.values(s).some((r) => r.nests < 1) && 'a map without a batfly nest',
        `${s.compact.pixelScale}/${s.normal.pixelScale}/${s.large.pixelScale}/${s.xl.pixelScale}` !== '2/2/1.5/1' && 'pixel scales should be 2/2/1.5/1',
        s.xl.msMax > 3000 && `XL map takes ${s.xl.msMax}ms to build`,
        m.rainTimerAfterRestart > 0.1 && 'wildlife change did not restart the rain cycle',
        m.peacefulSpecies.split(',').some((k) => k && !peaceful.has(k)) && `Peaceful still has ${m.peacefulSpecies}`,
      ];
    },
  },
];

const browser = await launch();
let failures = 0;
const t0 = Date.now();
try {
  for (const c of checks) {
    if (only.length && !only.includes(c.name)) continue;
    const started = Date.now();
    const { page, errors } = await openPrototype(browser, { seed: c.seed });
    let metrics;
    let problems;
    try {
      metrics = await c.run(page);
      problems = c.judge(metrics).filter(Boolean);
    } catch (err) {
      metrics = {};
      problems = ['crashed: ' + err.message.split('\n')[0]];
    }
    if (errors.length) problems.push('page errors: ' + errors.slice(0, 3).join(' | '));
    const warning = !problems.length && c.warn && c.warn(metrics);
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`${problems.length ? 'FAIL' : warning ? 'WARN' : 'ok  '}  ${c.name.padEnd(10)} ${secs.padStart(4)}s  ${c.about}`);
    console.log(`      ${JSON.stringify(metrics)}`);
    for (const p of problems) console.log(`      -> ${p}`);
    if (warning) console.log(`      -> ${warning} (nothing to measure; rerun if it matters)`);
    if (problems.length) failures++;
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`\n${failures ? failures + ' check(s) failed' : 'all checks passed'} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
process.exit(failures ? 1 : 0);
