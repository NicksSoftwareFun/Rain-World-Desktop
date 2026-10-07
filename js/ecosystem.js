// The ecosystem: owns creatures, items and particles, runs the weighted
// spawner, and answers questions creatures ask about the world (where's the
// nearest den, is it raining, where's the cursor).
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;
  const Nav = RW.Nav;

  const FLOOR_CAPS = { walls: false, ceil: false, poles: false, fall: true, key: 'floor' };
  const AIR_CAPS = { fly: true, key: 'air' };

  class Ecosystem {
    constructor(cfg, world) {
      this.cfg = cfg;
      this.world = world;
      this.creatures = [];
      this.shelterStash = []; // creatures sitting out the rain in the pipes
      this.items = [];
      this.particles = [];
      this.dens = [];
      this.plants = [];
      this.grass = [];
      this.nests = [];
      this.weather = null;
      this.t = 0;
      this.spawnT = 1;
      this.populated = false;
      this.cursor = { x: -9999, y: -9999, vx: 0, vy: 0, speed: 0, still: 0, inside: false };
      this.stats = { born: 0, eaten: 0, left: 0 };
    }

    setDecor(decor) {
      this.decor = decor;
      this.dens = decor.dens.map((d) => Object.assign({}, d));
      this.grass = decor.grass.map((g) => Object.assign({}, g));
      this.plants = decor.fruitPlants.map((p) => (p.under ? new RW.SeaFruitPlant(this, p.x, p.y, p.len) : new RW.FruitPlant(this, p.x, p.y, p.len)));
      this.nests = (decor.nests || []).map((n) => ({ x: n.x, y: n.y, phase: n.x % 10, pulse: 0 }));
      this.ledges = decor.ledges || [];
    }
    // A nest buried under a window for a while is rebuilt under another
    // ledge that's in the open, so there's always one to see.
    moveNest(n) {
      const W = this.world;
      const spots = [];
      for (const l of this.ledges) {
        if (l.w < 60 || l.y + l.h + 60 > W.h * 0.85) continue;
        for (let k = 0; k < 4; k++) {
          const x = l.x + 18 + Math.random() * (l.w - 36);
          const y = l.y + l.h;
          if (!W.isSolidPt(x, y + 4) && !W.isSolidPt(x, y + 14) && !W.isSolidPt(x, y + 32)) spots.push({ x, y });
        }
      }
      n.coveredT = 0;
      if (!spots.length) return;
      const sp = U.pick(spots);
      n.x = Math.round(sp.x);
      n.y = sp.y;
      for (const c of this.creatures) if (c.flock && c.flock.roost) c.flock.roost = null; // find the new one
    }
    // Batflies hatch from the nest (not from dens) unless it's buried under a
    // window; with a window or icon right below it they slip out sideways.
    openNests() {
      return this.nests.filter((n) => !this.world.isSolidPt(n.x, n.y + 4) && this.nestExit(n));
    }
    nestExit(n) {
      const W = this.world;
      for (let r = 0; r <= 120; r += 20) {
        for (const dx of r ? [-r, r] : [0]) {
          const x = n.x + dx;
          const y = n.y + 30;
          if (x > 8 && x < W.w - 8 && !W.isSolidPt(x, y) && !W.isSolidPt(x, y - 12) && !W.isSolidPt(x, y + 10) && !this.nearWater(x, y, 24)) return { x, y };
        }
      }
      return null;
    }
    // Water at (x, y) or within `below` px under it: a nest (or a sky den)
    // there stays shut, or its batflies would come out straight into it.
    nearWater(x, y, below) {
      const W = this.world;
      return !!(W.waterSim && (W.waterDepth(x, y) >= 0 || W.waterDepth(x, y + below) >= 0));
    }

    // ---- cursor -----------------------------------------------------------
    setCursor(x, y, inside, dt) {
      const c = this.cursor;
      if (inside && c.inside && dt > 0) {
        const vx = (x - c.x) / dt;
        const vy = (y - c.y) / dt;
        c.vx += (vx - c.vx) * 0.3;
        c.vy += (vy - c.vy) * 0.3;
      } else {
        c.vx = c.vy = 0;
      }
      c.speed = Math.hypot(c.vx, c.vy);
      if (Math.abs(x - c.x) + Math.abs(y - c.y) > 2) c.still = 0;
      else c.still += dt;
      c.x = x;
      c.y = y;
      c.inside = inside;
    }

    // ---- queries ------------------------------------------------------------
    // Shelter: from shelterWarnSeconds before the downpour until it's over.
    // No new arrivals in that time; creatures head into the pipes (each at
    // its own moment, see Creature.shelterTime) and come back out after.
    shouldShelter() {
      return this.shelterSoon(this.cfg.rain.shelterWarnSeconds ?? 45);
    }
    shelterSoon(lead) {
      const R = this.cfg.rain;
      const w = this.weather;
      return !!(R.enabled && R.shelterDuringDownpour && w && (w.downpour || w.toDownpour < lead));
    }
    // Heavy rain (past rain.avoidFrom, the build-up to the downpour):
    // creatures keep out of it, under cover where there is any.
    heavyRain() {
      const R = this.cfg.rain;
      const w = this.weather;
      return !!(R.enabled && w && w.intensity >= (R.avoidFrom ?? 0.45));
    }
    // Does the rain reach (x, y)? (not under a ledge, a window, a beam of
    // rock: wherever the rain shadow covers)
    rainOn(x, y) {
      const w = this.weather;
      return !!(w && w.shelter && w.shelterAt(x, y) > y);
    }
    // After the rain, the sheltered come back out of the pipes one by one.
    // They come back out spread evenly over every den on the map (not the
    // upper ones they crowded into to get out of the flood): each is given
    // the least-used den and waits until the water there has gone down
    // below its mouth. (A den that stays under, a pool's, gives way after a
    // while to whichever open one is least used.)
    releaseSheltered(dt) {
      const stash = this.shelterStash;
      if (this.shouldShelter()) this.releaseLoad = null; // (a fresh share-out next time)
      if (!stash.length || this.shouldShelter()) return;
      const load = (this.releaseLoad = this.releaseLoad || new Map());
      const leastUsed = (dens) => {
        let best = [];
        let bn = Infinity;
        for (const d of dens) {
          const n = load.get(d) || 0;
          if (n < bn) {
            bn = n;
            best = [d];
          } else if (n === bn) best.push(d);
        }
        const d = best.length ? U.pick(best) : null;
        if (d) load.set(d, bn + 1);
        return d;
      };
      for (const s of stash) {
        if (s.backAt === undefined) s.backAt = this.t + U.rand(1.5, 25);
        if (!s.releaseDen || !this.dens.includes(s.releaseDen)) s.releaseDen = leastUsed(this.usableDens(s.isFlier));
      }
      for (let i = stash.length - 1; i >= 0; i--) {
        const c = stash[i];
        if (this.t < c.backAt) continue;
        const open = this.openDens(c.isFlier);
        let d = c.releaseDen;
        if (!d || !open.includes(d)) {
          // still under water (or blocked): wait, unless it's been a while
          if (this.t < c.backAt + 60 || !open.length) continue;
          d = c.releaseDen = leastUsed(open);
        }
        stash.splice(i, 1);
        delete c.releaseDen;
        c.dead = c.leaving = c.sheltered = c.migrating = false;
        c.piping = c.burrow = c.nudge = c.unburrow = null;
        c.holding = c.grabbedBy = null;
        c.stillFor = 0;
        c.lastCheck = null;
        c.stateT = 0;
        c.label = '';
        delete c.backAt;
        if (c.pather) c.pather.clear();
        c.startUnpiping(d);
        this.creatures.push(c);
      }
    }

    denSpawnPoint(d) {
      if (d.sky) return { x: d.x, y: d.y + 30 }; // (just inside the opening)
      if (d.wall) return { x: d.x + d.dir * 16, y: d.y };
      return { x: d.x, y: d.y - 10 };
    }

    // Every den a creature could come out of, flooded or not (sky openings
    // for fliers only; not one walled over).
    usableDens(flier) {
      const W = this.world;
      return this.dens.filter((d) => {
        if (d.sky) return !!flier;
        const p = this.denSpawnPoint(d);
        return !W.solid(W.cellX(p.x), W.cellY(p.y)) && !W.isSolidPt(p.x, p.y) && !W.isSolidPt(p.x, p.y - 14);
      });
    }
    // Open dens; `flier` includes the openings to the sky at the top of an
    // experimental room, which only fliers use to come and go.
    openDens(flier) {
      const W = this.world;
      return this.dens.filter((d) => {
        const p = this.denSpawnPoint(d);
        if (d.sky) return !!flier && !this.nearWater(p.x, p.y, 24);
        // (a den gone under the flood is shut until it drains)
        if (W.waterSim && W.waterDepth(p.x, p.y) >= 0) return false;
        return !W.solid(W.cellX(p.x), W.cellY(p.y)) && !W.isSolidPt(p.x, p.y) && !W.isSolidPt(p.x, p.y - 14);
      });
    }

    // A fresh start (the wildlife mix changed): everything currently about
    // goes, corpses included, and the map fills straight from the new mix.
    // (Held weapons and fruit drop where they are.)
    repopulate() {
      for (const c of this.creatures) c.remove();
      this.creatures = [];
      this.stats = { born: 0, eaten: 0, left: 0 };
      this.noSlugT = 0;
      this.skips = {};
      this.shelterStash = [];
      this.spawnT = 60 / Math.max(0.1, +this.cfg.ecosystem.spawnPerMinute || 0.1);
      this.populate();
    }

    // The nearest open den, by straight line; given a walker's caps, the
    // nearest it can actually get to (so a creature making for shelter heads
    // for an exit it can reach, rather than the closest one through rock and
    // ending up tucked into a passage short of it). Remembered a couple of
    // seconds per spot, as it's asked every frame.
    nearestDen(x, y, caps) {
      const pts = this.openDens(caps && caps.fly).map((d) => this.denSpawnPoint(d));
      if (!pts.length) return null;
      pts.sort((a, b) => U.dist2(x, y, a.x, a.y) - U.dist2(x, y, b.x, b.y));
      if (!caps || caps.fly || pts.length === 1) return pts[0];
      const W = this.world;
      const key = (caps.key || Nav.capsKey(caps)) + ':' + W.cellX(x) + ',' + W.cellY(y);
      const memo = this.denMemo || (this.denMemo = new Map());
      const hit = memo.get(key);
      if (hit && this.t - hit.t < 2.5) {
        const p = pts.find((q) => q.x === hit.x && q.y === hit.y);
        if (p) return p;
      }
      let best = pts[0];
      for (const p of pts.slice(0, 5)) {
        const r = Nav.findPath(W, x, y, p.x, p.y, caps, 6000);
        if (r && r.complete) {
          best = p;
          break;
        }
      }
      if (memo.size > 400) memo.clear();
      memo.set(key, { t: this.t, x: best.x, y: best.y });
      return best;
    }

    // The open den farthest from (ox, oy) that a creature at (x, y) with
    // these caps can actually walk to (falls back to the farthest outright).
    farthestDen(ox, oy, x, y, caps) {
      const pts = this.openDens(caps && caps.fly).map((d) => this.denSpawnPoint(d));
      pts.sort((a, b) => U.dist2(b.x, b.y, ox, oy) - U.dist2(a.x, a.y, ox, oy));
      for (const p of pts.slice(0, 4)) {
        const r = Nav.findPath(this.world, x, y, p.x, p.y, caps, 6000);
        if (r && r.complete) return p;
      }
      return pts[0] || null;
    }

    count(species) {
      let n = 0;
      for (const c of this.creatures) if (c.species === species && !c.dead && !c.corpse) n++;
      for (const c of this.shelterStash || []) if (c.species === species) n++; // (coming back out)
      return n;
    }

    population() {
      let p = 0;
      const cost = (c) => {
        const s = this.cfg.species[c.species];
        return s && s.popCost !== undefined ? +s.popCost : 1; // 0 is a real cost (batflies)
      };
      for (const c of this.creatures) if (!c.dead && !c.corpse) p += cost(c);
      // (and those sheltering in the dens, coming back out after the rain:
      // the spawner mustn't fill their places meanwhile)
      for (const c of this.shelterStash || []) p += cost(c);
      return p;
    }

    // ---- spawning -----------------------------------------------------------
    classFor(species) {
      const C = RW.Creatures;
      if (species.indexOf('lizard') === 0) return C.Lizard;
      if (species.indexOf('centipede') === 0) return C.Centipede;
      if (species.indexOf('noodlefly') === 0) return C.Noodlefly;
      if (species === 'squidcada') return C.Squidcada;
      return {
        slugcat: C.Slugcat,
        daddy: C.Daddy,
        dropwig: C.Dropwig,
        batfly: C.Batfly,
        centipede: C.Centipede,
      }[species];
    }

    spawn(species, x, y) {
      const Cls = this.classFor(species);
      if (!Cls) return null;
      if (x === undefined && species === 'batfly' && this.openNests().length) {
        const n = U.pick(this.openNests());
        const ex = this.nestExit(n);
        x = ex.x;
        y = ex.y;
        n.pulse = 0.6;
      }
      // (from a pipe: the creature crawls out of it, as it goes in when it
      // leaves; see Creature.startUnpiping)
      let den = null;
      if (x === undefined) {
        const pos = this.pickSpawnPoint(species, false);
        if (!pos) return null;
        x = pos.x;
        y = pos.y;
        den = pos.den && !pos.den.sky ? pos.den : null;
      }
      const emerge = (c, wait) => {
        if (!den || c.isFlier || !c.startUnpiping) return;
        c.startUnpiping(den);
        c.unpiping.wait = wait || 0;
      };
      if (species === 'batfly') {
        const sz = this.cfg.species.batfly.params.flockSize || [3, 6];
        const room = Math.max(1, (this.cfg.species.batfly.max || 10) - this.count('batfly'));
        const n = Math.min(room, U.randInt(sz[0], sz[1]));
        const flock = {};
        let first = null;
        for (let i = 0; i < n; i++) {
          const b = new Cls(this, species, x + U.rand(-12, 12), y + U.rand(-12, 12), flock);
          this.creatures.push(b);
          first = first || b;
        }
        this.stats.born += n;
        return first;
      }
      if (species === 'noodlefly' || species === 'squidcada') {
        // a noodlefly family (an adult and its brood) or a squidcada flock
        const S = this.cfg.species;
        const group = species === 'noodlefly' ? { adult: null, infants: [] } : { members: [] };
        const lead = new Cls(this, species, x, y, group);
        lead.homeState = lead.state;
        this.creatures.push(lead);
        let n = 1;
        const kid = species === 'noodlefly' ? 'noodlefly_infant' : 'squidcada';
        const range = species === 'noodlefly' ? (S.noodlefly.params || {}).brood || [2, 4] : (S.squidcada.params || {}).flockSize || [2, 2];
        const want = U.randInt(range[0], range[1]) - (species === 'squidcada' ? 1 : 0);
        const room = Math.max(0, ((S[kid] && S[kid].max) || 10) - this.count(kid));
        for (let i = 0; i < Math.min(want, room); i++) {
          const k = new Cls(this, kid, x + U.rand(-14, 14), y + U.rand(-10, 10), group);
          k.homeState = k.state;
          this.creatures.push(k);
          n++;
        }
        this.stats.born += n;
        return lead;
      }
      const c = new Cls(this, species, x, y);
      c.homeState = c.state; // what it settles back into after sheltering
      this.creatures.push(c);
      this.stats.born++;
      emerge(c);
      // Yellow lizards hunt in packs: they come out in pairs, sharing a
      // territory (see Lizard.mate). One whose mate died or left gets the
      // newcomer as its new mate instead (it finds its way over to it).
      const widow = species === 'lizard_yellow' ? this.widowedYellow(c) : null;
      if (widow) {
        c.packMate = widow;
        widow.packMate = c;
      } else if (species === 'lizard_yellow' && this.count(species) < (this.cfg.species[species].max || 0)) {
        const m = new Cls(this, species, x + U.rand(-14, 14), y);
        m.homeState = m.state;
        c.packMate = m;
        m.packMate = c;
        this.creatures.push(m);
        this.stats.born++;
        emerge(m, 1.5); // (the mate following it out)
      }
      return c;
    }

    // A yellow lizard out on its own (its mate dead, or gone off the screen).
    widowedYellow(not) {
      // (not one just on its way out with it, or sitting out the rain in the pipes)
      const gone = (m) => !m || m.dead || m.corpse || (!this.creatures.includes(m) && !this.shelterStash.includes(m));
      return this.creatures.find((c) => c !== not && c.species === 'lizard_yellow' && !c.dead && !c.corpse && !c.leaving && gone(c.packMate)) || null;
    }

    // From a den normally; anywhere sensible when first populating.
    pickSpawnPoint(species, anywhere) {
      const W = this.world;
      const flier = species === 'batfly' || species === 'daddy' || species.indexOf('noodlefly') === 0 || species === 'squidcada';
      if (!anywhere) {
        const dens = this.openDens(flier);
        if (dens.length) {
          // Wall dens suit everything; ledge dens suit walkers; fliers mostly
          // come in from the sky where a room is open to it.
          const sky = dens.filter((d) => d.sky);
          const d = sky.length && Math.random() < 0.7 ? U.pick(sky) : U.pick(dens);
          return Object.assign(this.denSpawnPoint(d), { den: d });
        }
      }
      let caps = FLOOR_CAPS;
      let filter = null;
      if (species === 'batfly' || species === 'daddy' || species.indexOf('noodlefly') === 0 || species === 'squidcada') {
        caps = AIR_CAPS;
        filter = (cx, cy) => W.surfDist(cx, cy) >= 3;
      } else if (species === 'dropwig') {
        caps = { walls: true, ceil: true, key: 'ceil' };
        filter = (cx, cy) => W.solid(cx, cy - 1);
      }
      const g = Nav.randomValid(W, caps, W.w / 2, W.h / 2, Math.max(W.w, W.h), filter, 80);
      return g ? { x: g.x, y: g.y } : { x: W.w / 2, y: W.h / 2 };
    }

    // The population cap: 30% lower on an experimental (Rain World room)
    // map, which has much less open space than the ledge layouts.
    maxPopulation() {
      const m = +this.cfg.ecosystem.maxPopulation || 0;
      return this.cfg.world.layout === 'experimental' ? m * 0.7 : m;
    }

    chooseSpecies() {
      const cfg = this.cfg;
      const pop = this.population();
      const entries = [];
      const waiting = []; // allowed and not at their cap, even if too big to fit right now
      const overdueKinds = new Set(); // let in over the cap for being long overdue
      for (const k of Object.keys(cfg.species)) {
        const s = cfg.species[k];
        if (!s.enabled || !(s.weight > 0)) continue;
        if (this.count(k) >= (s.max || 0)) continue;
        waiting.push(k);
        // (a pair, for the species that come out two at a time; a yellow
        // lizard only alone to join one whose mate is gone, never on its own)
        const n = k === 'squidcada' ? Math.min(2, (s.max || 0) - this.count(k)) : k === 'lizard_yellow' ? (this.widowedYellow() ? 1 : 2) : 1;
        if (k === 'lizard_yellow' && this.count(k) + n > (s.max || 0)) continue;
        // (with nothing that counts about, anything fits: a Daddy Long Legs
        // can still turn up on a small map; and one that's long overdue may
        // come out over the cap, one at a time, so a small map still sees
        // the big, rare ones now and then)
        const over = pop + n * (s.popCost !== undefined ? +s.popCost : 1) > this.maxPopulation() + 0.01;
        const overdue = over && this.skipsOf(k) >= 12 && pop <= this.maxPopulation() + 0.01 && !this.count(k) && !(this.t - (this.overdueAt ?? -1e9) < 150);
        if (pop > 0.01 && over && !overdue) continue;
        if (pop > 0.01 && over) overdueKinds.add(k);
        entries.push([k, s.weight * this.varietyBoost(k)]);
      }
      const pick = U.weighted(entries);
      if (pick && overdueKinds.has(pick)) this.overdueAt = this.t;
      // every allowed species passed over this time waits one draw longer
      if (pick) for (const k of waiting) this.skips[k] = k === pick ? 0 : this.skipsOf(k) + 1;
      return pick;
    }
    // Variety: a species that hasn't come out in a while (or at all yet) is
    // favoured, more so with each draw it misses, so one heavy weight can't
    // crowd the rest out and every allowed creature gets its turn on screen.
    skipsOf(k) {
      if (!this.skips) this.skips = {};
      return this.skips[k] === undefined ? 4 : this.skips[k]; // never seen: as if skipped a few times
    }
    varietyBoost(k) {
      return Math.pow(1.4, Math.min(this.skipsOf(k), 14));
    }

    populate() {
      for (let i = 0; i < 60; i++) {
        const sp = this.chooseSpecies();
        if (!sp) break;
        const pos = this.pickSpawnPoint(sp, true);
        this.spawn(sp, pos.x, pos.y);
      }
      this.populated = true;
    }

    // ---- lifecycle ----------------------------------------------------------
    consume(prey, by) {
      if (!prey || prey.dead) return;
      const m = prey.mainPoint();
      // (a big meal makes a big mess; a big eater a bit more)
      const k = prey.bulk() * (by && by.bulk ? 0.8 + 0.2 * by.bulk() : 1);
      this.burst(m.x, m.y, prey.bloodColor || '#2a1418', 10, k);
      prey.grabbedBy = null;
      prey.remove();
      if (by && by.holding === prey) by.holding = null;
      this.stats.eaten++;
    }

    // A noodlefly has sucked a kill dry: the husk drops and stays on the map.
    drain(prey, by) {
      if (!prey || prey.dead) return;
      if (by && by.holding === prey) by.release();
      prey.drained = true;
      this.stats.eaten++;
    }

    // A spray of n particles; k scales it with the size of what it came
    // from (more of them, flung further, bigger, lasting longer).
    burst(x, y, color, n, k) {
      k = U.clamp(k || 1, 0.4, 3.5);
      const sk = Math.sqrt(k);
      n = Math.round(n * k);
      for (let i = 0; i < n; i++) {
        const a = U.rand(0, U.TAU);
        const s = U.rand(30, 140) * sk;
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: U.rand(0.4, 0.9) * (0.8 + 0.2 * k), t: 0, color, size: U.rand(1.5, 3) * sk });
      }
    }

    carry(moves) {
      for (const m of moves) {
        for (const c of this.creatures) if (c.contactId === m.id && !c.grabbedBy) c.carry(m.dx, m.dy);
        for (const it of this.items) if (it.contactId === m.id && !it.heldBy) it.carry(m.dx, m.dy);
      }
    }

    // Lizards can tangle and ball up in a fight, but never sink right into
    // one another: their bodies (head and torso; tails may cross) keep about
    // a body's width apart, the lighter one giving more, softly (a couple of
    // px a frame at most). The head's allowance is small, so bites land.
    separateLizards() {
      const lz = [];
      for (const c of this.creatures) {
        // (not in a passage: there they queue, or squeeze past one another)
        if (c.spine && c.bodyN && c.species.startsWith('lizard_') && !c.dead && !c.corpse && !c.grabbedBy && !c.piping && !c.unpiping && !c.burrow && !c.tunnel) lz.push(c);
      }
      for (let i = 0; i < lz.length; i++) {
        for (let j = i + 1; j < lz.length; j++) {
          const a = lz[i];
          const b = lz[j];
          const A = a.spine.pts;
          const B = b.spine.pts;
          const ca = A[3];
          const cb = B[3];
          if (Math.abs(ca.x - cb.x) > 90 * (a.L + b.L) || Math.abs(ca.y - cb.y) > 90 * (a.L + b.L)) continue;
          const wa = (b.mass || 1) / ((a.mass || 1) + (b.mass || 1));
          for (let ia = 0; ia < a.bodyN; ia++) {
            const p = A[ia];
            const ra = (ia === 0 ? 2.5 : 5) * a.L;
            for (let ib = 0; ib < b.bodyN; ib++) {
              const q = B[ib];
              const r = ra + (ib === 0 ? 2.5 : 5) * b.L;
              const dx = q.x - p.x;
              const dy = q.y - p.y;
              const d2 = dx * dx + dy * dy;
              if (d2 >= r * r) continue;
              const d = Math.sqrt(d2) || 0.01;
              const push = Math.min(2, r - d);
              const nx = d > 0.01 ? dx / d : 1;
              const ny = d > 0.01 ? dy / d : 0;
              p.x -= nx * push * wa;
              p.y -= ny * push * wa;
              q.x += nx * push * (1 - wa);
              q.y += ny * push * (1 - wa);
            }
          }
        }
      }
    }

    // Slugcats never stand in one another: two on the ground (or one on
    // the ground, one on a pole) keep a body's width apart, nudged aside
    // (never into the rock); two on one pole keep a body's length apart,
    // the lower one giving way. (In the air they may pass.)
    separateSlugcats() {
      const sc = [];
      for (const c of this.creatures) {
        if (c.species === 'slugcat' && c.hip && !c.dead && !c.corpse && !c.grabbedBy && !c.piping && !c.unpiping && !c.burrow && !c.tunnel && !c.leaving && (c.grounded || c.pole || c.perch)) sc.push(c);
      }
      const W = this.world;
      for (let i = 0; i < sc.length; i++) {
        for (let j = i + 1; j < sc.length; j++) {
          const a = sc[i];
          const b = sc[j];
          const A = a.hip;
          const B = b.hip;
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const pa = a.pole || a.perch;
          const pb = b.pole || b.perch;
          if (pa && pb && pa === pb) {
            // up and down one pole: the lower one drops back
            if (Math.abs(dy) >= 16 || Math.abs(dx) > 8) continue;
            const low = dy > 0 ? b : a;
            if (low.perch) continue;
            low.hip.y += Math.min(1.5, 16 - Math.abs(dy));
            continue;
          }
          if (Math.abs(dx) >= 10 || Math.abs(dy) >= 14) continue;
          const s = dx !== 0 ? Math.sign(dx) : a.id < b.id ? 1 : -1;
          const push = Math.min(1.2, (10 - Math.abs(dx)) / 2);
          // (one perched, or on a pole: it stays put, the other moves)
          for (const [c, k] of [[a, -s], [b, s]]) {
            if (c.perch || c.pole) continue;
            const nx = c.hip.x + k * push * ((pa || pb) ? 2 : 1);
            if (W.isSolidPt(nx + k * 6, c.hip.y) || W.isSolidPt(nx + k * 6, c.hip.y - 8)) continue;
            c.hip.x = nx;
          }
        }
      }
    }

    // A corpse's colour drains away as it lies there: down to about a
    // quarter of its saturation over 40 s, and a little darker.
    // (Drawn on a little scratch canvas the corpse's size and greyed pixel
    // by pixel there: a canvas filter would do it in one line, but costs a
    // whole-screen pass per corpse per frame, which brought the frame rate
    // down as the dead piled up.)
    drawFaded(ctx, c) {
      const f = U.smooth(U.clamp(c.corpseT / 40, 0, 1));
      if (f < 0.02) return c.draw(ctx);
      const m = ctx.getTransform();
      const k = m.a;
      const b = c.bounds();
      const x0 = Math.floor(b[0] * k + m.e) - 1;
      const y0 = Math.floor(b[1] * k + m.f) - 1;
      const w = Math.ceil((b[2] - b[0]) * k) + 3;
      const h = Math.ceil((b[3] - b[1]) * k) + 3;
      if (!(w > 0 && h > 0) || w * h > 250000) return c.draw(ctx);
      let cv = this.fadeCv;
      if (!cv) {
        cv = this.fadeCv = document.createElement('canvas');
        this.fadeCtx = cv.getContext('2d', { willReadFrequently: true });
      }
      if (cv.width < w || cv.height < h) {
        cv.width = Math.max(cv.width, w);
        cv.height = Math.max(cv.height, h);
      }
      const g = this.fadeCtx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, w, h);
      g.setTransform(k, 0, 0, k, m.e - x0, m.f - y0);
      c.draw(g);
      const img = g.getImageData(0, 0, w, h);
      const d = img.data;
      const sat = 1 - 0.75 * f;
      const br = 1 - 0.15 * f;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        d[i] = (l + (d[i] - l) * sat) * br;
        d[i + 1] = (l + (d[i + 1] - l) * sat) * br;
        d[i + 2] = (l + (d[i + 2] - l) * sat) * br;
      }
      g.putImageData(img, 0, 0);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(cv, 0, 0, w, h, x0, y0, w, h);
      ctx.restore();
    }

    // After the pixel snap: each translucent creature is drawn opaque on a
    // scratch layer, snapped there, then blended onto the sprite layer at its
    // see-through alpha. k is world units -> sprite pixels.
    drawLate(spriteCanvas, k) {
      if (!this.late || !this.late.length) return;
      const sc = spriteCanvas.getContext('2d');
      const W = spriteCanvas.width;
      const H = spriteCanvas.height;
      if (!this.scratch) this.scratch = document.createElement('canvas');
      const cv = this.scratch;
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
      }
      const x = cv.getContext('2d', { willReadFrequently: true });
      for (const c of this.late) {
        const b = c.bounds();
        const x0 = Math.max(0, Math.floor(b[0] * k) - 1);
        const y0 = Math.max(0, Math.floor(b[1] * k) - 1);
        const x1 = Math.min(W, Math.ceil(b[2] * k) + 1);
        const y1 = Math.min(H, Math.ceil(b[3] * k) + 1);
        if (x1 <= x0 || y1 <= y0) continue;
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.clearRect(x0, y0, x1 - x0, y1 - y0);
        x.setTransform(k, 0, 0, k, 0, 0);
        c.draw(x, true);
        U.crispRects(cv, [[x0, y0, x1, y1]]);
        sc.save();
        sc.setTransform(1, 0, 0, 1, 0, 0);
        sc.globalAlpha = c.ghostAlpha();
        sc.drawImage(cv, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
        sc.restore();
      }
    }

    // Keep a few rocks and spears lying about (about one in four a spear).
    stockWeapons(all) {
      const E = this.cfg.ecosystem;
      const want = { rock: E.rocks === undefined ? 6 : +E.rocks, spear: E.spears === undefined ? 2 : +E.spears };
      const have = { rock: 0, spear: 0 };
      for (const it of this.items) if (it instanceof RW.Weapon && !it.dead) have[it.kind]++;
      for (const kind of ['spear', 'rock']) {
        let n = Math.min(all ? 99 : 1, want[kind] - have[kind]);
        while (n-- > 0) this.spawnWeapon(kind);
      }
    }
    spawnWeapon(kind) {
      const W = this.world;
      const tops = W.solids.filter((s) => s.kind !== 'edge' && s.kind !== 'icon' && s.w >= 40 && s.y > 20);
      for (let t = 0; t < 10 && tops.length; t++) {
        const s = U.pick(tops);
        const x = s.x + U.rand(8, s.w - 8);
        const y = s.y - 4;
        if (W.isSolidPt(x, y) || W.isSolidPt(x, y - 8)) continue;
        this.items.push(new RW.Weapon(this, kind, x, y));
        return;
      }
    }
    // A loud clatter: nearby lizards come to see what it was.
    noise(x, y) {
      for (const c of this.creatures) {
        if (c.hearNoise && !c.dead && U.dist(c.x, c.y, x, y) < 280) c.hearNoise(x, y);
      }
    }

    dropFood(x, y) {
      if (this.world.isSolidPt(x, y)) return;
      const f = new RW.Fruit(this, x, y);
      f.vy = 30;
      this.items.push(f);
    }

    update(dt) {
      this.t += dt;
      const cfg = this.cfg;
      if (!this.populated && cfg.ecosystem.startPopulated) this.populate();
      if (!this.populated) this.stockWeapons(true);
      this.populated = true;
      this.weaponT = (this.weaponT || 0) - dt;
      if (this.weaponT <= 0) {
        this.weaponT = 6;
        this.stockWeapons(false);
      }

      // Never long without a slugcat: after 15s with none alive, one comes
      // out of a pipe regardless of the population cap.
      if (this.creatures.some((c) => c.species === 'slugcat' && !c.dead && !c.corpse && !c.leaving)) this.noSlugT = 0;
      else this.noSlugT = (this.noSlugT || 0) + dt;
      const sc = cfg.species.slugcat;
      if (this.noSlugT > 15 && sc && sc.enabled !== false && !this.shouldShelter()) {
        this.noSlugT = 0;
        this.spawn('slugcat');
      }

      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        // (well under the cap, arrivals come quicker, so a small map isn't
        // left half empty for minutes; and if nothing fitted this time, it
        // tries again soon rather than waiting the whole interval)
        const fill = this.population() / Math.max(0.1, this.maxPopulation());
        this.spawnT = (60 / Math.max(0.1, +cfg.ecosystem.spawnPerMinute || 0.1)) * (fill < 0.5 ? 0.4 : fill < 0.8 ? 0.7 : 1);
        if (!this.shouldShelter()) {
          const sp = this.chooseSpecies();
          if (sp) this.spawn(sp);
          else if (fill < 0.8) this.spawnT = Math.min(this.spawnT, 4);
        }
      }

      // The nest keeps batflies about (prey for everyone): whenever they run
      // low it lets out a fresh flock. They don't count toward the cap.
      for (const n of this.nests) {
        n.pulse = Math.max(0, n.pulse - dt);
        n.coveredT = this.world.isSolidPt(n.x, n.y + 14) ? (n.coveredT || 0) + dt : 0;
        if (n.coveredT > 10) this.moveNest(n);
      }
      this.nestT = (this.nestT === undefined ? 4 : this.nestT) - dt;
      if (this.nestT <= 0) {
        this.nestT = 18;
        const bf = cfg.species.batfly;
        const open = this.openNests();
        if (bf && bf.enabled !== false && open.length && !this.shouldShelter() && this.count('batfly') < Math.min(bf.max || 14, 6)) {
          const n = U.pick(open);
          const ex = this.nestExit(n);
          this.spawn('batfly', ex.x, ex.y);
          n.pulse = 0.6;
        }
      }

      for (const p of this.plants) p.update(dt);
      const Wd = this.world;
      const falls = this.weather && this.weather.fallSpans;
      for (const c of this.creatures) {
        c.update(dt);
        // (in the water: see Creature.waterLimp, waterPanic and each
        // swimmer's own swim)
        if (falls && falls.length) this.waterfallPush(c, falls, dt);
        // anything that has fallen or been flung far out of the world is gone
        if (c.y > Wd.h + 500 || c.y < -500 || c.x < -500 || c.x > Wd.w + 500 || !isFinite(c.x) || !isFinite(c.y)) c.remove();
      }
      this.separateLizards();
      this.separateSlugcats();
      for (const it of this.items) it.update(dt);
      // The flood at its height carries off the dead under it: a passive
      // clean-up of the map, once a downpour.
      const S = Wd.waterSim;
      const pouring = !!(this.weather && this.weather.downpour);
      if (S && pouring && S.flood > 0.95) {
        if (!this.floodSwept) {
          this.floodSwept = true;
          for (const c of this.creatures) if (c.corpse && !c.grabbedBy && Wd.waterDepth(c.x, c.y) >= 0) c.remove();
        }
      } else if (!pouring) {
        this.floodSwept = false;
      }

      for (const c of this.creatures) {
        if (c.dead && c.holding) c.release();
        // gone into a pipe out of the rain: kept, and let back out after it
        if (c.dead && c.leaving && c.sheltered && !c.corpse) this.shelterStash.push(c);
        else if (c.dead && c.leaving) this.stats.left++;
      }
      this.releaseSheltered(dt);
      this.creatures = this.creatures.filter((c) => !c.dead);
      this.items = this.items.filter((i) => !i.dead);

      for (const p of this.particles) {
        p.t += dt;
        p.vy += 500 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      this.particles = this.particles.filter((p) => p.t < p.life);
    }

    // A waterfall (an open top's, see Weather.updateFalls) bears down on
    // anything passing through it: pushed down, and now and then knocked
    // off the wall or pole it's clinging to, more so the heavier the rain.
    waterfallPush(c, falls, dt) {
      if (c.dead || c.corpse || c.grabbedBy || c.leaving || c.tunnel || c.piping || c.unpiping || c.burrow) return;
      const m = c.mainPoint();
      for (const f of falls) {
        if (m.x < f.x0 - 3 || m.x > f.x1 + 3 || m.y < 0 || m.y > f.bot) continue;
        const force = (220 + 520 * f.k) * (c.isFlier ? 0.6 : 1) / Math.sqrt(Math.max(0.5, c.mass || 1));
        if ('vy' in c) c.vy += force * dt;
        if ('vx' in c) c.vx *= Math.pow(0.5, dt);
        c.underFallT = (c.underFallT || 0) + dt;
        if (!c.isFlier && c.underFallT > 0.15 && Math.random() < dt * (0.3 + 1.1 * f.k)) {
          c.knockLoose();
          this.fallKnocks = (this.fallKnocks || 0) + 1;
          c.underFallT = 0;
          this.burst(m.x, m.y, U.rgba(U.mix((this.palette && this.palette.rain) || '#ffffff', '#ffffff', 0.4)), 4);
        }
        return;
      }
      c.underFallT = 0;
    }

    // A click on a creature: its AI state label for 15s, fading out over the
    // last second and a half; a click while it shows fades it at once.
    toggleLabel(c) {
      if (!c) return;
      if (c.labelUntil > this.t + 0.4) {
        c.labelUntil = this.t + 0.35;
        c.labelFade = 0.35;
      } else {
        c.labelUntil = this.t + 15;
        c.labelFade = 1.5;
      }
    }
    // The labels (every creature's when debug.showLabels is on), over the
    // creatures and the water: a small dark tag by the body, its name and
    // what it's doing.
    drawLabels(ctx) {
      const all = this.cfg.debug.showLabels;
      // (never smaller on screen than at the desktop's XL zoom: a phone's
      // zoomed-out map scales them back up)
      const L = Math.max(1, 0.8 / (this.zoom || 1));
      ctx.save();
      ctx.font = `${10 * L}px "Cascadia Mono", Consolas, monospace`;
      ctx.textBaseline = 'middle';
      for (const c of this.creatures) {
        if (c.dead) continue;
        let a = all || c.labelPinned ? 1 : 0;
        if (c.labelUntil > this.t) a = Math.max(a, Math.min(1, (c.labelUntil - this.t) / (c.labelFade || 1.5)));
        if (a <= 0.01) continue;
        const m = c.mainPoint();
        const sp = this.cfg.species[c.species];
        const name = ((sp && sp.label) || c.species).toLowerCase();
        const text = `${name} \u00b7 ${c.corpse ? 'dead' : c.state}${c.swimming ? ' (swimming)' : ''}`;
        const w = ctx.measureText(text).width + 10 * L;
        // (below the body while its menu is open over it)
        const below = !!c.menuOpen;
        const x = Math.round(m.x + 12 * L);
        const y = Math.round(m.y + (below ? 22 : -20) * L);
        ctx.globalAlpha = a * c.alpha;
        ctx.fillStyle = 'rgba(8,10,10,0.72)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y - 7 * L, w, 14 * L, 7 * L);
        else ctx.rect(x, y - 7 * L, w, 14 * L);
        ctx.fill();
        ctx.fillStyle = 'rgba(232,226,200,0.95)';
        ctx.fillText(text, x + 5 * L, y + 0.5 * L);
        // a tick back to the body
        if (below) ctx.fillRect(x - L, m.y + 4 * L, L, Math.max(0, y - 6 * L - m.y - 4 * L));
        else ctx.fillRect(x - L, y + 6 * L, L, Math.max(0, m.y - y - 10 * L));
      }
      ctx.restore();
    }

    // Draw order roughly follows Rain World's layering: big background
    // creatures first, small skittering things on top.
    draw(ctx) {
      const dirty = (this.dirty = []);
      // (in a room the grass is a foreground plant: see RW.Foliage)
      if (!this.grassInFoliage) {
        for (const g of this.grass) {
          this.drawGrass(ctx, g);
          dirty.push([g.x - 20, g.y - g.h - 8, g.x + 20, g.y + 2]);
        }
      }
      for (const p of this.plants) {
        p.draw(ctx);
        dirty.push([p.x - 14, p.y - 2, p.x + 14, p.y + p.len + 14]);
      }
      for (const n of this.nests) {
        this.drawNest(ctx, n);
        dirty.push([n.x - 16, n.y - 2, n.x + 16, n.y + 36]);
      }
      for (const it of this.items) dirty.push(it.bounds ? it.bounds() : [it.x - 9, it.y - 9, it.x + 9, it.y + 9]);
      for (const c of this.creatures) if (c.alpha > 0) dirty.push(c.bounds());
      for (const p of this.particles) dirty.push([p.x - 3, p.y - 3, p.x + 3, p.y + 3]);
      for (const d of this.dens) dirty.push([d.x - 24, d.y - 18, d.x + 24, d.y + 18]);
      const order = { daddy: 0, dropwig: 2, centipede: 3, slugcat: 4, squidcada: 4.5, noodlefly: 4.6, noodlefly_infant: 4.7, batfly: 5 };
      const sorted = this.creatures.slice().sort((a, b) => (order[a.species] ?? 1) - (order[b.species] ?? 1));
      // weapons stuck in creatures or in flight draw over them; the rest under
      const over = (it) => it.state === 'embedded' || it.state === 'flying';
      for (const it of this.items) if (!over(it)) it.draw(ctx);
      // Translucent creatures (a camouflaged white lizard) can't go through
      // the hard-edged pixel pass, which would snap them to all-or-nothing:
      // they're drawn afterwards, by drawLate.
      this.late = [];
      for (const c of sorted) {
        if (c.burrow || c.piping || c.unpiping) {
          // only the part still out of the surface (or the pipe) shows;
          // going into a pipe the body is also squeezed in toward the
          // pipe's axis, as if squirming through the gap
          const b = c.burrow || c.piping || c.unpiping;
          const nx = c.burrow ? b.nx : -b.ax;
          const ny = c.burrow ? b.ny : -b.ay;
          const tx = -ny;
          const ty = nx;
          const F = 1e4;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(b.sx + tx * F, b.sy + ty * F);
          ctx.lineTo(b.sx - tx * F, b.sy - ty * F);
          ctx.lineTo(b.sx - tx * F + nx * F, b.sy - ty * F + ny * F);
          ctx.lineTo(b.sx + tx * F + nx * F, b.sy + ty * F + ny * F);
          ctx.closePath();
          ctx.clip();
          if (c.piping || c.unpiping) {
            const q = b.k - 1; // scale across the axis (direction tx, ty) by k
            ctx.translate(b.sx, b.sy);
            ctx.transform(1 + q * tx * tx, q * tx * ty, q * tx * ty, 1 + q * ty * ty, 0, 0);
            ctx.translate(-b.sx, -b.sy);
          }
          c.draw(ctx);
          ctx.restore();
        } else if (c.ghostAlpha && c.ghostAlpha() < 0.99) this.late.push(c);
        else if (c.corpse && c.corpseT > 0.5) this.drawFaded(ctx, c);
        else c.draw(ctx);
      }
      for (const it of this.items) if (over(it)) it.draw(ctx);
      for (const p of this.particles) {
        ctx.fillStyle = U.rgba(p.color, 1 - p.t / p.life);
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      // Den indicator dots blink like Rain World's shortcut entrances.
      // Three short marks on the pipe mouth itself (the game's sign for a
      // pipe that leads out of the room).
      for (const d of this.dens) {
        if (d.sky) continue; // (an opening, not a pipe)
        if (d.busyT > 0) d.busyT -= 1 / 60;
        const on = d.busyT > 0 || Math.sin(this.t * 3 + d.x * 0.01) > 0.3;
        if (!on) continue;
        // sized and spaced in whole art pixels so none falls between them
        const ap = this.artPx || 1;
        const th = Math.max(1.6, ap);
        const gap = Math.max(4, Math.ceil(4 / ap) * ap);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        for (let k = -1; k <= 1; k++) {
          if (d.wall) ctx.fillRect(d.x + d.dir * 13 - 1.5, d.y + k * gap - th / 2, 3, th);
          else ctx.fillRect(d.x - 2.5, d.y + 7 + k * gap - th / 2, 5, th); // stacked down the shaft
        }
      }
    }

    drawGrass(ctx, g) {
      const pal = this.palette;
      if (!pal) return;
      ctx.strokeStyle = U.rgba(U.mix(pal.near, '#7a9a5c', 0.35));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const bx = g.x + (k - 3) * 2.5;
        const sway = Math.sin(this.t * 1.3 + g.phase + k) * 3;
        const h = g.h * (0.6 + 0.4 * Math.sin(k * 2.1 + g.phase) ** 2);
        ctx.moveTo(bx, g.y);
        ctx.quadraticCurveTo(bx + sway * 0.3, g.y - h * 0.6, bx + sway + (k - 3) * 2, g.y - h);
      }
      ctx.stroke();
    }
    // A batfly nest: a lumpy woven pod on a short stalk, with a dark
    // opening at the bottom; it swells a little as a flock squeezes out.
    drawNest(ctx, n) {
      const pal = this.palette;
      if (!pal) return;
      const sway = Math.sin(this.t * 0.7 + n.phase) * 1.5;
      const k = 1 + n.pulse * 0.25;
      const cx = n.x + sway;
      const cy = n.y + 17;
      ctx.strokeStyle = U.rgba(U.mix(pal.near, '#3b3424', 0.4));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(cx, cy - 10);
      ctx.stroke();
      ctx.fillStyle = U.rgba(U.mix(pal.near, '#7d6a45', 0.45));
      ctx.beginPath();
      ctx.ellipse(cx, cy, 9 * k, 12 * k, 0, 0, U.TAU);
      ctx.fill();
      // woven bands
      ctx.strokeStyle = U.rgba(U.mix(pal.near, '#2c2618', 0.5));
      ctx.lineWidth = 1.2;
      for (let i = -1; i <= 1; i++) {
        const by = cy + i * 6 * k;
        const hw = Math.sqrt(Math.max(0, 1 - (i * 6 / 12) ** 2)) * 9 * k;
        ctx.beginPath();
        ctx.moveTo(cx - hw, by - 1);
        ctx.quadraticCurveTo(cx, by + 3, cx + hw, by - 1);
        ctx.stroke();
      }
      // the way in and out
      ctx.fillStyle = U.rgba(U.mix(pal.near, '#000000', 0.6));
      ctx.beginPath();
      ctx.ellipse(cx, cy + 9 * k, 3.5, 2.5, 0, 0, U.TAU);
      ctx.fill();
    }
  }

  RW.Ecosystem = Ecosystem;
})();
