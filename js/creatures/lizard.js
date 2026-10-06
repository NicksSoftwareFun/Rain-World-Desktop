// Lizards: the iconic Rain World predator. A verlet spine (neck, body, tail)
// steered from the head, four IK legs that step onto real surfaces in a
// diagonal gait, and a hinged jaw. Species differ by colour, size and which
// surfaces they may climb.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;
  const Nav = RW.Nav;

  const GRAV = 900;
  const LIZARDS = ['lizard_*'];
  const REAR = [0, 0.9, 0.65, 0.35, 0.12]; // how much each front spine point lifts when rearing
  const TERR_R = 150; // territory radius around a lizard's hangout
  const RIVALRY = ['challenge', 'display', 'fight'];
  // Rain World wiki: biteDamage and toughness per species (fights only)
  const isLizard = (c) => c.species.startsWith('lizard_');

  class Lizard extends RW.Creature {
    constructor(eco, species, x, y) {
      super(eco, species, x, y);
      const p = this.p;
      const L = (this.L = p.length || 1);
      this.headColor = U.hex(p.headColor || '#ff2fc0');
      this.bodyColor = U.hex(p.bodyColor || '#1d151d');
      this.bodyTint = p.bodyTint === undefined ? 0.25 : p.bodyTint;
      this.bodyN = 7;
      const nTail = 16;
      const segs = [];
      for (let i = 0; i < this.bodyN; i++) segs.push((i === 0 ? 9 : 6.6) * L);
      for (let i = 0; i < nTail; i++) segs.push(6.4 * L * (1 - i / (nTail * 2.4)));
      const dir = U.sign();
      this.spine = new RW.Chain(x, y, this.bodyN + nTail, segs, -dir, 0);
      this.vx = 0;
      this.vy = 0;
      this.caps = {
        walls: !!p.climbWalls,
        ceil: !!p.climbCeilings,
        poles: !!p.poles,
        fall: true,
        // short leaps to and from poles, shorter for bigger lizards (slugcats
        // jump much further)
        // (not one that crawls the back wall: it goes across instead)
        jumpX: p.poles && !p.backWalls ? Math.max(2, Math.round(3.2 / L)) : 0,
        jumpUp: p.poles && !p.backWalls ? (L <= 1 ? 2 : 1) : 0,
        leapPoles: true,
        wallCost: 1.3,
        ceilCost: 1.8,
        poleCost: 1.4,
        fallCost: p.climbWalls ? 4 : 1, // climbers climb down rather than drop
        swim: 4, // (they swim, clumsily, and would rather not)
        back: !!p.backWalls,
        backCost: 1.6,
      };
      this.grav = GRAV;
      this.mask = { floor: true, walls: !!p.climbWalls, ceil: !!p.climbCeilings, poles: !!p.poles };
      this.maskNoPole = Object.assign({}, this.mask, { poles: false });
      this.pather = new RW.Pather(this, this.caps);
      const l1 = 16 * L;
      const l2 = 16 * L;
      // heavy species take slower, flatter steps
      const o = { stepDur: 0.2 + 0.015 * (p.mass || 2), lift: 4.5 * L };
      this.legs = [
        { leg: new RW.Leg(l1, l2, Object.assign({ group: 0, forward: 0.65 }, o)), at: 2, near: true },
        { leg: new RW.Leg(l1, l2, Object.assign({ group: 1, forward: 0.35 }, o)), at: 2, near: false },
        { leg: new RW.Leg(l1, l2, Object.assign({ group: 1, forward: 0.55 }, o)), at: 5, near: true },
        { leg: new RW.Leg(l1, l2, Object.assign({ group: 0, forward: 0.25 }, o)), at: 5, near: false },
      ];
      for (const l of this.legs) {
        const h = this.spine.pts[l.at];
        l.leg.place(h.x, h.y + 10);
      }
      this.ux = 0;
      this.uy = -1;
      this.jaw = 0;
      this.jawTarget = 0;
      this.headAng = dir > 0 ? 0 : Math.PI;
      this.speed = p.speed || 90;
      this.grip = null;
      this.lungeT = 0;
      this.lungeCd = 0;
      this.perceiveT = 0;
      this.prey = null;
      this.fullT = U.rand(0, 15);
      this.eatT = 0;
      this.idleT = 0;
      this.cursorBites = 0;
      this.cursorBored = 0;
      // (lizards ignore batflies, per the Rain World wiki; greens and cyans
      // eat blue lizards)
      this.diet = ['slugcat', 'centipede', 'dropwig'];
      if (species === 'lizard_green' || species === 'lizard_cyan') this.diet.push('lizard_blue');
      this.diet.push('centipede_medium'); // the wiki: lizards eat adult centipedes too
      this.diet.push('noodlefly_infant', 'noodlefly', 'squidcada'); // fliers, when they come low enough
      // red lizards hunt the lesser lizards (the green's too big to bother)
      if (p.red) this.diet.push('lizard_pink', 'lizard_blue', 'lizard_white', 'lizard_yellow', 'lizard_cyan');
      this.hp = 1; // fighting condition; recovers slowly
      this.home = null; // favourite hangout: { sid, ox } on top of a solid
      this.homeAwayT = 0;
      this.truces = new Map(); // lizard id -> eco time until which we leave it be
      this.threats = ['daddy'];
      // large centipedes hunt lizards: every lizard backs away from one
      // (how close it lets one come depends on its bravery)
      if (!p.red) this.threats.push('centipede_large'); // (a red lizard goes for it instead)
      this.camo = 1;
      this.mass = p.mass || 2 * L;
      // Rain World personality: energy, bravery, sympathy, dominance,
      // nervousness and aggression, each 0..1.
      this.pers = U.personality();
      this.walkPh = 0;
      // personality state
      this.look = 0; // head angle offset from the neck, radians
      this.lookAt = null; // point the head is turned toward
      this.idleLook = { x: x, y: y, t: 0 };
      this.raise = 0; // rearing up (display, stalking)
      this.raiseS = 0;
      this.lashS = 0;
      this.windT = 0;
      this.turn = null;
      this.turnCd = 0;
      this.tongue = 0; // 0..1 flick progress
      this.tongueCd = U.rand(2, 8);
      this.noticeT = 0;
      this.thrashT = 0;
      this.lash = 0; // tail agitation
      this.rival = null;
      this.rivalCd = U.rand(5, 15);
      this.blink = 0;
      this.blinkT = U.rand(2, 6);
      this.breathe = U.rand(0, 10);
      // Fixed markings, Rain World style: colour flecks bleeding from the head
      // down the neck, plus a species pattern. t = position along the spine.
      this.spineSet = [];
      if (!p.spines && (p.pattern === 'dapple' || p.pattern === 'spots')) {
        for (let t = 0.1; t < 0.5; t += U.rand(0.06, 0.1)) this.spineSet.push({ t, len: U.rand(2, 3.5), lean: 0.5 });
      }
      if (p.spines) {
        let t = 0.06;
        for (let k = 0; k < p.spines && t < (p.spines > 14 ? 0.8 : 0.62); k++) {
          const stubby = Math.random() < 0.25;
          const big = p.spines > 14; // red lizards: a crown of huge spines
          this.spineSet.push({ t, len: stubby ? U.rand(2.5, 4) : big ? U.rand(9, 16) : U.rand(6, 10), lean: U.rand(0.35, 0.8) });
          t += big ? U.rand(0.025, 0.045) : U.rand(0.035, 0.07);
        }
      }
      this.specks = [];
      const pat = p.pattern;
      const add = (t, side, size, kind) => this.specks.push({ t, side, size, kind: kind || 'fleck' });
      if (pat !== 'spots') for (let i = 0; i < 60; i++) add(0.08 + Math.pow(Math.random(), 1.6) * 0.34, U.rand(-0.95, 0.95), U.rand(1, 2.4));
      if (pat === 'dapple') {
        for (let i = 0; i < 14; i++) add(U.rand(0.15, 0.6), U.rand(-0.8, 0.8), 1);
        for (let i = 0; i < 18; i++) add(1 - Math.pow(Math.random(), 1.5) * 0.2, U.rand(-0.9, 0.9), 1);
      } else if (pat === 'dots') {
        for (let i = 0; i < 22; i++) add(0.1 + Math.pow(Math.random(), 1.6) * 0.6, U.rand(-0.8, 0.8), 2);
      } else if (pat === 'fins') {
        for (let i = 0; i < 14; i++) add(U.rand(0.05, 0.8), Math.random() < 0.7 ? 1 : -1, U.rand(7, 12), 'fin');
        for (let i = 0; i < 20; i++) add(1 - Math.pow(Math.random(), 1.4) * 0.25, U.rand(-0.9, 0.9), 1);
      } else if (pat === 'spots') {
        for (let i = 0; i < 26; i++) add(U.rand(0.08, 0.8), U.rand(-0.85, 0.85), U.randInt(1, 2), 'dark');
      }
    }

    mainPoint() {
      return this.spine.pts[0];
    }
    // How see-through to draw (white lizards' camouflage).
    ghostAlpha() {
      return this.p.camouflage ? this.alpha * this.camo : 1;
    }
    bounds() {
      return RW.Creature.ptsBounds(this.spine.pts, 56 * this.L);
    }
    holdPoint() {
      const h = this.spine.pts[0];
      return { x: h.x + Math.cos(this.headAng) * 12 * this.L, y: h.y + Math.sin(this.headAng) * 12 * this.L };
    }
    carry(dx, dy) {
      this.spine.shift(dx, dy);
      for (const l of this.legs) l.leg.shift(dx, dy);
    }

    // ---------------------------------------------------------------- AI ----
    think(dt) {
      const eco = this.eco;
      const head = this.spine.pts[0];
      const cfgE = eco.cfg.ecosystem;
      this.perceiveT -= dt;
      this.fullT -= dt;
      this.lungeCd -= dt;
      this.cursorBored -= dt;
      const perceive = this.perceiveT <= 0;
      if (perceive) this.perceiveT = 0.25 + Math.random() * 0.1;
      const pe = this.pers;
      // energetic lizards amble a little quicker
      this.speed = (this.p.speed || 50) * (0.88 + 0.24 * pe.energy);
      this.jawTarget = 0;
      this.pather.interval = 1.2;
      this.lookAt = null;
      this.raise = 0; // head stays in line with the body unless rearing
      this.lash = 0.08 + 0.2 * pe.nervous; // nervous ones twitch their tails

      if (this.holding && RIVALRY.includes(this.state) && this.rival) {
        if (this.rivalry(dt, perceive)) return; // someone wants our food
      }
      // (with the rain coming it carries its catch into the den instead)
      if (this.holding && !this.shelterTime()) {
        const prey = this.holding;
        this.jawTarget = 0.3;
        this.lash = 0.5;
        if (!prey.corpse) {
          // still kicking in our jaws: shake it until it dies
          this.setState('kill');
          this.pather.clear();
          if (this.killT === undefined) this.killT = U.rand(0.8, 2.2);
          this.killT -= dt;
          this.thrashT = Math.max(this.thrashT, 0.15);
          if (this.killT <= 0) {
            this.killT = undefined;
            prey.kill();
          }
          return;
        }
        // Dead: carry it back to our hangout before swallowing it there.
        const hp = this.homePos();
        const homeD = hp ? U.dist(head.x, head.y, hp.x, hp.y) : 0;
        if (hp && homeD > 45 && this.state !== 'eat' && !(this.state === 'carry' && this.stateT > 45)) {
          this.setState('carry');
          this.speed *= 0.85;
          // every so often, stop and give the carcass a good hard shake
          // (the more aggressive the lizard, the more often)
          this.shakeCd = (this.shakeCd === undefined ? U.rand(1.5, 4) : this.shakeCd) - dt;
          if (this.shakeCd <= 0 && this.grip && !this.turn) {
            this.shakeCd = U.rand(3, 7) * (1.4 - 0.7 * pe.aggression);
            this.shakeT = U.rand(0.5, 1);
          }
          if (this.shakeT > 0) this.speed = 0;
          this.pather.interval = 0.8;
          this.pather.setGoal(hp.x, hp.y);
          // no route, or no progress for a while: eat it here after all
          const cc = this.carryCheck || (this.carryCheck = { x: head.x, y: head.y, t: 0 });
          cc.t += dt;
          let stalled = false;
          if (cc.t > 5) {
            stalled = U.dist(head.x, head.y, cc.x, cc.y) < 10;
            this.carryCheck = { x: head.x, y: head.y, t: 0 };
          }
          const stuck = stalled || (this.pather.nodes && !this.pather.complete && this.pather.remaining() === 0 && this.stateT > 2);
          if (!stuck) return;
          this.carryCheck = null;
        }
        if (this.state !== 'eat' && Math.random() < 0.4) this.shakeT = U.rand(0.5, 0.9); // one last shake
        this.setState('eat');
        this.pather.clear();
        if (this.shakeT > 0) return; // swallowing waits for the shaking
        this.eatT += dt;
        if (this.eatT > 3) {
          eco.consume(prey, this);
          this.holding = null;
          this.fullT = U.rand(30, 60) * (1.3 - 0.5 * pe.aggression);
          this.eatT = 0;
        }
        return;
      }

      if (this.wantsToLeave(dt)) {
        this.setState('leave');
        const den = eco.nearestDen(head.x, head.y, this.caps);
        if (den) {
          this.pather.setGoal(den.x, den.y);
          if (U.dist(head.x, head.y, den.x, den.y) < 26) this.leave();
        }
        this.speed *= 1.3;
        return;
      }

      // Every lizard keeps clear of a red one: it hunts them. How close it
      // lets one come depends on its bravery; a green, big enough to hold
      // its ground, only gives way when it's right on top of it.
      if (perceive && !this.p.red && !this.holding) {
        const fear = this.species === 'lizard_green' ? 0.3 : 1;
        const range = 300 * fear * (1.3 - 0.6 * pe.bravery) * this.L;
        const red = this.nearestOf(['lizard_red'], range, (c) => !c.corpse && !c.holding && this.canSee(c.x, c.y, range));
        if (red) {
          if (this.rival) this.endRivalry(U.rand(4, 8));
          this.setState('flee');
          const g = this.fleeGoal(this.caps, red.x, red.y, 400);
          if (g) this.pather.setGoal(g.x, g.y, true);
        }
      }
      if (perceive) {
        const threat = this.threatNear(200 * (1.3 - 0.6 * pe.bravery)); // the brave let danger come closer
        if (threat) {
          this.setState('flee');
          const g = this.fleeGoal(this.caps, threat.x, threat.y, 350);
          if (g) this.pather.setGoal(g.x, g.y, true);
        }
      }
      if (this.state === 'flee') {
        this.speed = this.p.huntSpeed || 90;
        if (this.stateT < 3) return;
        this.setState('wander');
      }

      // Territory (Rain World's rivalry): an owner challenges lizards that
      // stray onto its hangout, and hungry lizards go after one that has
      // food. Both hiss and rear up trying to make the other back off; if
      // neither does, it becomes a fight until one submits (and maybe
      // leaves), dies, or is distracted by prey or a predator.
      this.rivalCd -= dt;
      this.hp = Math.min(1, this.hp + dt * 0.02);
      if (RIVALRY.includes(this.state)) {
        if (this.rivalry(dt, perceive)) return;
      }
      if (perceive) this.updateHome(0.3);
      if (perceive && this.rivalCd <= 0 && this.state !== 'hunt') {
        const f = this.findFoe();
        if (f) {
          this.rival = f.c;
          this.rivalWhy = f.why;
          this.prize = f.prize || null;
          this.setState('challenge');
          return;
        }
      }

      // Scavenging: a corpse of something we eat is an easy meal to carry home.
      if (this.state === 'scavenge') {
        const c = this.prey;
        // (it sank, or the water came up over it: a lizard won't dive for
        // it, so it gives up rather than paddling over it for good)
        if (!c || c.dead || !c.corpse || c.grabbedBy || this.stateT > 20 || this.W.waterDepth(c.x, c.y) > 6 || this.noHeadway(c, dt)) {
          this.prey = null;
          this.setState('wander');
        } else {
          this.pather.interval = 0.6;
          this.pather.setGoal(c.x, c.y);
          this.lookAt = c.mainPoint();
          const hp = c.hitParts()[0];
          if (U.dist(head.x, head.y, hp.x, hp.y) < 16 * this.L && this.grab(c)) {
            this.eatT = 0;
            this.prey = null;
          }
          return;
        }
      }
      if (perceive && this.fullT <= 0 && this.state !== 'hunt') {
        const c = this.nearestCorpse(this.diet, (this.p.vision || 300) * 0.8);
        if (c && this.canSee(c.x, c.y, (this.p.vision || 300) * 0.8)) {
          this.prey = c;
          this.setState('scavenge');
          return;
        }
      }

      // Ambush (white lizards): up to a ceiling over open floor, still and
      // invisible, and down on whatever passes below.
      if (this.p.ambush && !this.holding && this.fullT <= 0 && this.ambush(dt, perceive)) return;

      // Hunting
      if (perceive && this.fullT <= 0) {
        const vision = this.p.vision || 300;
        if (this.giveUpT > 0) this.giveUpT -= 0.25;
        // (not something down under the water: a lizard won't dive for it)
        const prey = this.nearestOf(this.diet, vision, (c) => !c.grabbedBy && !(this.giveUpT > 0 && c === this.gaveUpOn) && !this.ignores(c) && c.nearGround(45 * this.L) && this.canSee(c.x, c.y, vision) && this.W.waterDepth(c.x, c.y) < 14);
        if (prey) {
          if (this.state !== 'hunt') this.noticeT = 0.45 * (1.4 - pe.aggression); // freeze and stare before the charge
          this.prey = prey;
          this.setState('hunt');
        } else if (this.state === 'hunt' && this.stateT > 4) {
          this.prey = null;
          this.setState('wander');
        }
      }
      // A pack hunts together: the mate's quarry is ours too.
      const mate = this.mate();
      if (perceive && mate && mate.state === 'hunt' && mate.prey && !mate.prey.dead && !mate.prey.grabbedBy && this.state !== 'hunt' && !this.holding && !RIVALRY.includes(this.state) && this.state !== 'flee' && this.diet.includes(mate.prey.species)) {
        if (U.dist(head.x, head.y, mate.prey.x, mate.prey.y) < (this.p.vision || 300) * 1.6) {
          this.prey = mate.prey;
          this.setState('hunt');
          this.noticeT = 0.2;
        }
      }
      // The red feud: another red creature anywhere in sight of the map is
      // the only thing that matters.
      if (this.p.red && perceive && !this.holding) {
        const foe = this.redFoe();
        if (foe) {
          if (this.prey !== foe) this.noticeT = 0.3;
          this.prey = foe;
          this.setState('hunt');
        }
      }
      if (this.state === 'hunt' && this.prey) {
        const prey = this.prey;
        const persist = 0.6 + pe.aggression;
        const feud = this.p.red && prey.p && prey.p.red;
        // (a red foe: given up on only once out of reach or out of range)
        const hopeless = feud ? this.feudStuck(prey, dt) : this.stateT > 25 * persist || (this.stateT > 8 * persist && !this.pather.complete) || this.noHeadway(prey, dt, 10);
        if (hopeless) {
          this.gaveUpOn = prey;
          this.giveUpT = 20;
        }
        if (prey.dead || prey.leaving || prey.grabbedBy || hopeless) {
          this.prey = null;
          this.setState('wander');
        } else {
          this.speed = (this.p.huntSpeed || 90) * (0.9 + 0.2 * pe.aggression);
          this.pather.interval = 0.45;
          // with the mate on the same quarry: come at it from the other side
          // (flanking), straight in only at the last
          const hm = this.mate();
          const dp = U.dist(head.x, head.y, prey.x, prey.y);
          if (hm && hm.state === 'hunt' && hm.prey === prey && dp > 90) {
            const side = Math.sign(prey.x - hm.spine.pts[0].x) || 1;
            this.pather.setGoal(prey.x + side * 70, prey.y);
          } else {
            this.pather.setGoal(prey.x, prey.y);
          }
          this.lookAt = prey.mainPoint();
          this.lash = 0.7;
          const d = U.dist(head.x, head.y, prey.x, prey.y);
          if (this.noticeT > 0) {
            this.noticeT -= dt;
            this.speed = 0;
            this.raise = 0.6;
            this.jawTarget = 0.15;
            return;
          }
          if (d < 140) this.jawTarget = 0.35;
          // Red lizards open up with a volley of 2 or 3 spines first, then
          // move in for the kill.
          if (this.p.spits) {
            this.spitCd = (this.spitCd || 0) - dt;
            if (this.spitN > 0 && d > 45 * this.L && Math.abs(Math.atan2(prey.y - head.y, Math.abs(prey.x - head.x))) < Math.PI / 5) {
              this.speed = 0;
              this.raise = 0.55;
              this.jawTarget = 1;
              this.spitT -= dt;
              if (this.spitT <= 0) {
                this.spit(prey);
                this.spitT = 0.42;
                if (--this.spitN <= 0) this.spitCd = U.rand(7, 11);
              }
              return;
            }
            this.spitN = 0;
            // (only level-ish: within 30 degrees of straight ahead, left or right)
            const level = Math.abs(Math.atan2(prey.y - head.y, Math.abs(prey.x - head.x))) < Math.PI / 6;
            if (this.spitCd <= 0 && this.grip && this.lungeT <= 0 && level && !(prey.stunT > 0) && d > 110 * this.L && d < 450 && this.W.lineClear(head.x, head.y, prey.x, prey.y)) {
              this.spitN = U.randInt(2, 3);
              this.spitT = 0.3; // a beat with the mouth open before the first
            }
          }
          const canStrike = this.lungeCd <= 0 && this.grip && this.W.lineClear(head.x, head.y, prey.x, prey.y);
          if (canStrike && d < (this.p.biteRange || 60) * this.L) {
            this.lunge(prey.x, prey.y, prey, false);
          } else if (canStrike && perceive && !this.p.backWalls && d < 170 * this.L && Math.random() < (this.p.chargeRate || 0.05)) {
            // a long pounce from afar: green lizards always, most others rarely
            this.lunge(prey.x, prey.y, prey, true);
          }
          return;
        }
      }

      // Stalk the cursor when it's resting nearby.
      const cur = eco.cursor;
      if (cfgE.cursorInteraction && cur.inside && this.cursorBored <= 0) {
        const d = U.dist(head.x, head.y, cur.x, cur.y);
        const vision = this.p.vision || 300;
        if (d < vision && cur.still > 0.5 && (this.state === 'stalk' || (perceive && Math.random() < 0.08))) {
          this.setState('stalk');
          this.speed = (this.p.speed || 50) * 0.75;
          this.jawTarget = 0.25;
          this.lookAt = cur;
          this.raise = 0.5;
          this.lash = 0.6;
          this.pather.interval = 0.6;
          this.pather.setGoal(cur.x, cur.y);
          if (d < (this.p.biteRange || 60) * this.L && this.lungeCd <= 0 && this.grip) {
            this.lunge(cur.x, cur.y, null, false);
            if (++this.cursorBites >= 3) {
              this.cursorBites = 0;
              this.cursorBored = U.rand(12, 25);
              this.setState('wander');
            }
          }
          return;
        }
        if (this.state === 'stalk') this.setState('wander');
      } else if (this.state === 'stalk') {
        this.setState('wander');
      }

      // Wander with pauses.
      if (this.state !== 'wander' && this.state !== 'idle') this.setState('wander');
      if (this.state === 'idle') {
        this.pather.clear();
        this.idleT -= dt;
        // look around at nothing in particular
        this.idleLook.t -= dt;
        if (this.idleLook.t <= 0) {
          const a = U.rand(0, U.TAU);
          this.idleLook = { x: head.x + Math.cos(a) * 80, y: head.y + Math.sin(a) * 80, t: U.rand(0.8, 2.2) * (1.4 - 0.8 * pe.nervous) };
        }
        this.lookAt = this.idleLook;
        // every few seconds: rear up and gape
        this.gapeCd = (this.gapeCd === undefined ? U.rand(2, 5) : this.gapeCd) - dt;
        if (this.gapeCd <= 0) {
          this.gapeT = U.rand(0.8, 1.4);
          this.gapeCd = U.rand(4, 8);
        }
        if (this.gapeT > 0) {
          this.gapeT -= dt;
          this.jawTarget = 0.7;
          this.raise = 0.4;
        }
        if (this.idleT <= 0) this.setState('wander');
        return;
      }
      // (like a white lizard's trip to its lurking spot: it keeps on for as
      // long as it gets further down the route, however long the climb, and
      // gives a spot up once it doesn't)
      if (this.state === 'wander' && this.tripStalled(dt, 6)) {
        this.goalCd = 0;
        this.stateT = 99;
      }
      if (this.readyForGoal(dt, this.trip ? 60 : 35, !!this.grip)) { // slow walkers need time for a long climb
        // low-energy lizards stop to rest more often and for longer; a
        // low-energy white lizard lies still long enough to vanish (lurk)
        if (this.pather.goal && Math.random() < 0.2 + 0.35 * (1 - pe.energy) + (this.atHome() ? 0.2 : 0)) {
          this.setState('idle');
          this.idleT = U.rand(1.5, 4.5) * (1.5 - pe.energy) * (this.p.camouflage ? 2.5 - 1.5 * pe.energy : 1);
          return;
        }
        // (a pack sticks together: strayed too far, back to the mate)
        const pm = this.mate();
        const regroup = pm && U.dist(head.x, head.y, pm.spine.pts[0].x, pm.spine.pts[0].y) > 260 && Math.random() < 0.7 ? Nav.randomValid(this.W, this.caps, pm.spine.pts[0].x, pm.spine.pts[0].y, 90) : null;
        const g = regroup || this.homeGoal() || this.wanderGoal(this.caps, 500);
        if (g) this.pather.setGoal(g.x, g.y, true);
        this.stateT = 0;
      }
    }

    // A white lizard's ambush: pick a spot up high, on a ceiling or a ledge's
    // lip, over open floor ('lurkgo'), get there, then keep still ('lurk') and
    // vanish (see the camouflage in update); the others don't see it as a
    // threat then (lurking). Prey passing below: it lets go and drops on
    // it, turning into an ordinary hunt. True while it's busy at it.
    ambush(dt, perceive) {
      const W = this.W;
      const head = this.spine.pts[0];
      if (this.state === 'hunt' || this.state === 'scavenge') return false;
      if (this.state !== 'lurk' && this.state !== 'lurkgo') {
        if (!perceive || (this.state !== 'wander' && this.state !== 'idle')) return false;
        if (this.lurkCd > this.eco.t) return false; // (no luck getting anywhere lately: hunting as usual a while)
        const spot = this.lurkSpot();
        if (!spot) return false;
        this.spot = spot;
        this.setState('lurkgo');
      }
      const sp = this.spot;
      if (this.state === 'lurkgo') {
        this.speed *= 0.85;
        this.pather.interval = 1.2;
        this.pather.setGoal(sp.x, sp.y);
        // (getting nowhere along the way, or no way there at all: a long
        // climb round to a ceiling makes headway down its path, not
        // straight toward the spot)
        const pa = this.pather;
        const rem = pa.nodes ? pa.remaining() : null;
        if (rem !== null && (this.lurkBest === undefined || rem < this.lurkBest)) {
          this.lurkBest = rem;
          this.lurkStall = 0;
        } else this.lurkStall = (this.lurkStall || 0) + dt;
        const noWay = pa.nodes && !pa.complete && this.stateT > 1.5;
        if (noWay || this.lurkStall > 8 || this.stateT > 50) {
          this.lurkBest = undefined;
          this.lurkStall = 0;
          this.lurkFails = (this.lurkFails || 0) + 1;
          if (this.lurkFails >= 3) {
            this.lurkFails = 0;
            this.lurkCd = this.eco.t + 30;
          }
          (this.badSpots = this.badSpots || []).push({ x: sp.x, y: sp.y, until: this.eco.t + 60 });
          this.spot = null;
          this.setState('wander');
          return false;
        }
        // (there, or as good as: clinging just under the ceiling, or on the
        // ledge's lip)
        if (U.dist(head.x, head.y, sp.x, sp.y) < W.cell * 1.1 && this.grip) {
          this.lurkBest = undefined;
          this.lurkStall = 0;
          this.lurkFails = 0;
          this.setState('lurk');
          this.pather.clear();
        }
        return true;
      }
      // lurking: hanging still on the ceiling
      this.pather.clear();
      this.speed = 0;
      this.lash = 0;
      if (this.stateT > (this.p.patience || 60) || !this.grip) {
        this.spot = null;
        this.setState('wander');
        return false;
      }
      if (!perceive) return true;
      // something to eat passing below (led a little for its pace)?
      const prey = this.nearestOf(this.diet, W.cell * 11, (c) => {
        if (c.grabbedBy || c.isFlier || !c.nearGround(40 * this.L)) return false;
        const dy = c.y - head.y;
        const lx = c.x + (c.vx || 0) * 0.35;
        return dy > W.cell * 1.5 && dy < W.cell * 10 && Math.abs(lx - head.x) < W.cell * 1.6 && W.lineClear(head.x, head.y + 6, c.x, c.y);
      });
      if (prey) {
        // let go and drop on it
        this.prey = prey;
        this.setState('hunt');
        this.noticeT = 0;
        this.dropT = 0.6;
        this.ambushT = 1.4;
        this.vx = U.clamp((prey.x + (prey.vx || 0) * 0.35 - head.x) * 2.2, -160, 160);
        // (off a ceiling it just lets go; off a ledge's lip, a hop out over it)
        const onFloor = this.grip && this.grip.ny < -0.5;
        this.vy = onFloor ? -140 : 40;
        if (onFloor && Math.abs(this.vx) < 60) this.vx = 60 * (Math.sign(prey.x - head.x) || 1);
        this.spot = null;
      }
      return true;
    }
    // Somewhere high over open floor (where things pass): a ceiling cell with
    // a drop under it, or the lip of a ledge with a drop beside it; not by a
    // batfly nest, another white lizard's spot, or a spot it lately couldn't
    // get to.
    lurkSpot() {
      const W = this.W;
      const eco = this.eco;
      const head = this.spine.pts[0];
      const bad = (this.badSpots || []).filter((q) => q.until > eco.t);
      this.badSpots = bad;
      const others = eco.creatures.filter((c) => c !== this && c.spot && c.p && c.p.ambush).map((c) => c.spot);
      const near = (list, x, y, r) => list.some((q) => Math.abs(q.x - x) < r && Math.abs(q.y - y) < r);
      // (open below, a floor in reach of the drop: 4-10 cells down)
      const dropBelow = (cx, cy) => {
        let k = 1;
        while (k <= 10 && !W.solid(cx, cy + k)) k++;
        return k >= 4 && k <= 10;
      };
      const ok = (cx, cy) => {
        if (W.solid(cx, cy)) return false;
        // a ceiling over a drop, or the lip of a ledge with a drop beside it
        const ceiling = W.solid(cx, cy - 1) && dropBelow(cx, cy);
        const lip = !ceiling && W.solid(cx, cy + 1) && [-1, 1].some((sd) => !W.solid(cx + sd, cy) && !W.solid(cx + sd, cy + 1) && dropBelow(cx + sd, cy));
        if (!ceiling && !lip) return false;
        const x = W.centerX(cx);
        const y = W.centerY(cy);
        if (eco.rainOn && eco.heavyRain && eco.heavyRain() && eco.rainOn(x, y)) return false;
        return !near(eco.nests || [], x, y, W.cell * 2.5) && !near(bad, x, y, W.cell * 1.5) && !near(others, x, y, W.cell * 4);
      };
      return Nav.randomValid(W, this.caps, head.x, head.y, 420, ok) || Nav.randomValid(W, this.caps, head.x, head.y, 800, ok);
    }

    // -------------------------------------------------------------- weapons --
    hitParts() {
      const P = this.spine.pts;
      const L = this.L;
      const out = [{ x: P[0].x, y: P[0].y, r: 6 * L, part: 'head' }];
      for (let i = 2; i < this.bodyN + 3; i++) out.push({ x: P[i].x, y: P[i].y, r: 5.5 * L, part: 'body' });
      return out;
    }
    // On the back wall, a hit knocks it off: it falls, and can't take hold
    // of the wall again for a moment.
    knockOff() {
      if (!this.onBack) return;
      this.knockT = 1.6;
      this.onBack = false;
      this.vy = Math.max(this.vy, 40);
    }
    stun(t, flip) {
      this.knockOff();
      if (!super.stun(t, flip)) return false;
      this.turn = null;
      this.lungeT = 0;
      this.windT = 0;
      if (RIVALRY.includes(this.state) && this.rival) {
        this.rival.endRivalry(8);
        this.endRivalry(8);
      }
      return true;
    }
    // ------------------------------------------------------------ water --
    // In the water (shoulders under): swimming, until it hauls out.
    swimCheck(dt) {
      if (!this.W.waterSim || !this.W.waterSim.active()) return (this.swimming = false);
      const P = this.spine.pts;
      this.noteWet(P[2]);
      const d = this.depthOf(P[2]);
      // (just hauled out: not swimming for a moment, while the body follows
      // the head out; unless the head itself fell back in)
      if (this.swimCd > 0 && this.depthOf(P[0]) < 4) {
        this.swimCd -= dt;
        return (this.swimming = false);
      }
      this.swimCd = 0;
      const was = this.swimming;
      this.swimming = was ? d >= 0 : d > 5;
      if (this.swimming && !was) {
        if (this.vy > 0) this.vy *= 0.25; // (the water takes a plunge: no sinking deep)
        this.leap = null;
        this.scramble = null;
        this.leapWind = 0;
        this.lungeT = 0;
        this.turn = null;
        this.dropT = 0;
        this.jolt = null;
      }
      return this.swimming;
    }
    // A clumsy paddle: the head held up out of the water, the legs churning
    // under the body in jerky surges, the tail sculling, a wobble. It can
    // go under after something, slowly; it bobs back up when it stops.
    swim(dt) {
      const W = this.W;
      const S = W.waterSim;
      const P = this.spine.pts;
      const head = P[0];
      const L = this.L;
      const cell = W.cell;
      this.grip = null;
      this.windT = 0; // (no lunging in the water)
      this.pather.advance(head.x, head.y, cell * 0.9);
      const node = this.pather.current();
      let surf = S.surfaceY(P[2].x, P[2].y);
      if (surf === null) surf = S.surfaceY(head.x, head.y + 12 * L);
      if (surf === null) surf = head.y;
      this.swimPh = (this.swimPh || 0) + dt * 5.5;
      const sp = (this.speed || 60) * 0.5;
      // (lizards keep to the surface: they never dive)
      let tx = head.x;
      const ty = surf - 3 * L;
      if (node) {
        tx = node.x;
        const dry = !W.waterCell(node.cx, node.cy);
        if (dry && node.y < surf + cell && Math.abs(node.x - head.x) < cell * 1.6) {
          // the bank: a heave up and out onto it
          this.vy = -Math.sqrt(2 * GRAV * Math.max(16, head.y - node.y + 16 * L));
          this.vx = U.clamp((node.x - head.x) * 3, -130, 130);
          this.swimCd = 0.6;
          this.swimming = false;
          head.x += this.vx * dt;
          head.y += this.vy * dt;
          this.spine.follow(1); // (the body comes with it)
          return;
        }
      }
      const surge = 0.3 + 1.0 * Math.max(0, Math.sin(this.swimPh));
      const dx = tx - head.x;
      const dy = ty - head.y;
      const d = Math.hypot(dx, dy) || 1;
      let wvx = Math.abs(dx) > 4 ? (dx / d) * sp * surge : 0;
      let wvy = U.clamp(dy * 4, -120, 90);
      wvy += Math.sin(this.swimPh * 0.7) * 14;
      const k = U.approach(2.5, dt);
      this.vx += (wvx - this.vx) * k;
      this.vy += (wvy - this.vy) * k;
      head.x += this.vx * dt;
      head.y += this.vy * dt;
      const c = W.collideCircle(head, 5 * L);
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx;
          this.vy -= vn * c.ny;
        }
      }
      head.px = head.x;
      head.py = head.y;
      // the body trails along, floating; the tail sculls
      this.spine.verlet(1, 0.85, 0, 60, dt);
      this.spine.follow(1);
      this.spine.limitBend(0.8, 2, this.bodyN + 2, 0.5);
      this.spine.limitBend(0.75, this.bodyN + 2, P.length, 0.5);
      this.floatBody(dt, 3 * L, true);
      // a backbone: stretched out behind the head, not bunched in a heap
      for (let i = 1; i < P.length - 1; i++) {
        const a = P[i - 1];
        const b = P[i + 1];
        P[i].x += ((a.x + b.x) / 2 - P[i].x) * 0.25;
        P[i].y += ((a.y + b.y) / 2 - P[i].y) * 0.25;
      }
      this.spine.follow(1);
      const n = P.length;
      for (let i = 2; i < n; i++) {
        const a = P[i - 1];
        let ax = P[i].x - a.x;
        let ay = P[i].y - a.y;
        const al = Math.hypot(ax, ay) || 1;
        const w = Math.sin(this.swimPh * 1.4 - i * 0.7) * 2.2 * L * (i / n);
        P[i].x += (-ay / al) * w;
        P[i].y += (ax / al) * w;
        W.collideCircle(P[i], i < this.bodyN ? 4 * L : 2.5);
      }
      // legs churn: each foot circles under its shoulder or hip, in turn
      for (const l of this.legs) {
        const a = P[l.at];
        const b = P[l.at + 1];
        let fx = a.x - b.x;
        let fy = a.y - b.y;
        const fl = Math.hypot(fx, fy) || 1;
        fx /= fl;
        fy /= fl;
        const reach = (l.leg.l1 + l.leg.l2) * 0.6;
        const ph = this.swimPh * 1.6 + l.leg.group * Math.PI + (l.near ? 0 : 0.6);
        const ftx = a.x + fx * Math.cos(ph) * reach * 0.7;
        const fty = a.y + reach * 0.5 + Math.sin(ph) * reach * 0.3;
        const f = l.leg.foot;
        if (!f) continue;
        f.x += (ftx - f.x) * 0.35;
        f.y += (fty - f.y) * 0.35;
        l.leg.planted = false;
        l.leg.stepping = false;
      }
      // back up, head level and a little nose-up
      this.ux += (0 - this.ux) * U.approach(6, dt);
      this.uy += (-1 - this.uy) * U.approach(6, dt);
      const ang = Math.atan2(head.y - P[1].y, head.x - P[1].x);
      this.headAng = U.lerpAngle(this.headAng, ang - 0.25 * Math.sign(Math.cos(ang) || 1), U.approach(8, dt));
      this.jaw += (this.jawTarget - this.jaw) * U.approach(8, dt);
      this.lurking = false;
      this.camo += (1 - this.camo) * U.approach(3, dt);
      // a snap at prey that comes within reach
      const prey = this.prey;
      if (this.state === 'hunt' && prey && !prey.dead && !prey.grabbedBy && !(prey.p && prey.p.armored && !prey.corpse) && this.eco.cfg.ecosystem.predation && U.dist(head.x, head.y, prey.x, prey.y) < 16 * L) {
        if (this.grab(prey)) {
          this.eatT = 0;
          this.thrashT = 0.6;
        }
      }
    }

    // Knocked about: fall under gravity, legs flailing (in the air if flipped).
    limp(dt) {
      const W = this.W;
      const P = this.spine.pts;
      const head = P[0];
      const L = this.L;
      this.vy += GRAV * dt;
      this.vx *= Math.pow(0.4, dt);
      head.x += this.vx * dt;
      head.y += this.vy * dt;
      const c = W.collideCircle(head, 5 * L);
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx * 1.2;
          this.vy -= vn * c.ny * 1.2;
        }
        this.vx *= 0.85;
      }
      head.px = head.x;
      head.py = head.y;
      this.spine.verlet(1, 0.9, 0, GRAV, dt);
      this.spine.follow(1);
      // floppy, but a body has a spine: it never folds flat back on itself
      this.spine.limitBend(1.6, 2, this.bodyN + 3, 0.6);
      this.spine.collide(W, 3, 1);
      this.grip = null;
      // on its back: belly up, so the legs kick at the sky
      const tux = 0;
      const tuy = this.flipped ? 1 : -1;
      const k = U.approach(8, dt);
      this.ux += (tux - this.ux) * k;
      this.uy += (tuy - this.uy) * k;
      const ul = Math.hypot(this.ux, this.uy) || 1;
      this.ux /= ul;
      this.uy /= ul;
      this.headAng = U.lerpAngle(this.headAng, Math.atan2(head.y - P[1].y, head.x - P[1].x), U.approach(10, dt));
      this.jaw += ((this.corpse ? 0.25 : 0.5 + 0.3 * Math.sin(this.age * 20)) - this.jaw) * 0.2;
      this.lash = this.corpse ? 0 : 1;
      this.lashS *= this.corpse ? 0.9 : 1;
      for (const l of this.legs) l.leg.planted = false;
      this.updateLegs(dt, false);
    }
    onRecovered() {
      this.setState('wander');
    }
    // Rocks: a head hit flips it over; red lizards barely notice.
    onRockHit(w, part) {
      if (this.p.stunImmune) {
        this.thrashT = 0.3;
        this.noticeT = 0.3;
        return;
      }
      this.knockOff();
      this.stun(part === 'head' ? 1.3 : 0.8, part === 'head');
      this.vx += w.vx * 0.15;
      this.vy -= 120;
      this.angerAt(w.thrower);
    }
    // Spears: glance off the armoured head; stick in and wound the body.
    onSpearHit(w, part) {
      this.knockOff();
      if (part === 'head') {
        this.thrashT = 0.3;
        this.angerAt(w.thrower);
        return 'bounce';
      }
      this.hp -= 0.6 / (this.p.toughness || 1);
      if (this.holding) this.release();
      this.vx += w.vx * 0.25;
      this.vy += w.vy * 0.1 - 60;
      this.thrashT = 0.5;
      this.eco.burst(w.x, w.y, this.bloodColor || '#20141a', 4);
      if (this.hp <= 0) {
        this.die(16);
        return 'drop';
      }
      // badly hurt or timid: retreat (maybe to a den); otherwise turn on it
      if (this.hp < 0.45 || Math.random() > this.pers.bravery) {
        const t = w.thrower || w;
        const g = this.fleeGoal(this.caps, t.x, t.y, 350);
        if (g) this.pather.setGoal(g.x, g.y, true);
        this.setState('flee');
        if (this.hp < 0.45 && Math.random() < 0.5) this.migrating = true;
      } else {
        this.angerAt(w.thrower);
      }
      return 'embed';
    }
    angerAt(c) {
      if (!c || c.dead || !this.diet.includes(c.species)) return;
      this.prey = c;
      this.fullT = Math.min(this.fullT, 0);
      if (this.state !== 'flee') this.setState('hunt');
    }
    // A rock clattering nearby: go and have a look.
    hearNoise(x, y) {
      if ((this.state !== 'wander' && this.state !== 'idle') || this.stunT > 0 || Math.random() > 0.6) return;
      this.setState('wander');
      this.stateT = 0;
      this.pather.setGoal(x, y, true);
      this.noticeT = 0.3;
      this.idleLook = { x, y, t: 2 };
    }

    // ------------------------------------------------------------ territory --
    homePos() {
      const h = this.home;
      if (!h) return null;
      const sol = this.W.solidById(h.sid);
      if (!sol) return null;
      const x = sol.x + Math.min(h.ox, sol.w - 6);
      const y = sol.y - 12;
      if (y < 4 || this.W.isSolidPt(x, y)) return null; // covered over
      return { x, y };
    }
    // The pack mate (yellow lizards hunt in pairs), while it's about.
    mate() {
      const m = this.packMate;
      return m && !m.dead && !m.corpse && !m.leaving && m.eco === this.eco ? m : null;
    }
    // Hangouts: the tops of windows, the taskbar and wallpaper ledges.
    // (A pack shares one: the mate's, if it has one.)
    pickHome(exclude) {
      const W = this.W;
      const mate = this.mate();
      if (mate && mate.home && mate.home.sid !== exclude && mate.homePos()) {
        this.home = { sid: mate.home.sid, ox: mate.home.ox };
        this.homeAwayT = 0;
        return;
      }
      const head = this.spine.pts[0];
      const cands = [];
      for (const sol of W.solids) {
        if (sol.kind === 'edge' || sol.kind === 'icon' || sol.w < 80 || sol.id === exclude) continue;
        const ox = sol.w * U.rand(0.2, 0.8);
        const x = sol.x + ox;
        const y = sol.y - 12;
        if (y < 4 || W.isSolidPt(x, y)) continue;
        // unclaimed spots appeal; a dominant lizard may covet a claimed one
        let owner = null;
        for (const c of this.eco.creatures) {
          if (c !== this && c !== this.packMate && c.home && c.home.sid === sol.id && isLizard(c) && !c.dead && !c.corpse) owner = c;
        }
        const claim = owner ? (this.pers.dominance - owner.pers.dominance) * 0.8 - 0.25 : 0.3;
        // greens keep to the ground; the rest stake out the middle and top
        // tiers, and the bottom one is a last resort
        const h = 1 - y / W.h;
        const height = this.species === 'lizard_green' ? -h * 0.8 : h * 1.4 - (h < 0.2 ? 0.5 : 0);
        const sc = Math.random() * 0.6 + claim - U.dist(head.x, head.y, x, y) / 1400 + height;
        cands.push({ sc, sid: sol.id, ox, x, y });
      }
      // best-scoring spot we can actually walk to (checking only a few)
      cands.sort((a, b) => b.sc - a.sc);
      let best = null;
      for (const c of cands.slice(0, 4)) {
        const r = Nav.findPath(W, head.x, head.y, c.x, c.y, this.caps, 4000);
        if (r && r.complete) {
          best = { sid: c.sid, ox: c.ox };
          break;
        }
      }
      this.home = best || (cands[0] ? { sid: cands[0].sid, ox: cands[0].ox } : null);
      this.homeAwayT = 0;
    }
    // The pole a body point is hanging on (not standing at the foot of).
    poleUnder(pt) {
      const W = this.W;
      const cx = W.cellX(pt.x);
      const cy = W.cellY(pt.y);
      if (W.solid(cx, cy + 1)) return null;
      for (const p of W.poles) if (Math.abs(p.x - pt.x) < 16 * this.L && pt.y > p.y1 && pt.y < p.y2) return p;
      return null;
    }
    // Roaming follows the same taste: greens low, climbers up high.
    heightBias() {
      return this.species === 'lizard_green' ? -0.4 : 1.6;
    }
    updateHome(dt) {
      const hp = this.homePos();
      if (!hp) return this.pickHome();
      const head = this.spine.pts[0];
      // a pack keeps to one patch: the elder's (if it moved, follow)
      const mate = this.mate();
      if (mate && mate.id < this.id && mate.home && (mate.home.sid !== this.home.sid || mate.home.ox !== this.home.ox)) {
        this.home = { sid: mate.home.sid, ox: mate.home.ox };
        this.homeAwayT = 0;
        return;
      }
      // can't get there (or keeps getting chased off): settle somewhere else
      if (!this.inZone(head)) this.homeAwayT += dt;
      else this.homeAwayT = 0;
      if (this.homeAwayT > 70) this.pickHome(this.home.sid);
    }
    // The territory round the hangout: a circle on the desktop; in a room
    // (experimental maps), an oval fitted to the chamber the hangout is in:
    // long and low along a floor, tall up a shaft. {cx, cy, rx, ry}.
    zone() {
      const hp = this.homePos();
      if (!hp) return null;
      const W = this.W;
      const key = this.home.sid + ':' + Math.round(this.home.ox) + ':' + W.version;
      if (this.zoneKey === key) return this.zoneC;
      let z = { cx: hp.x, cy: hp.y, rx: TERR_R, ry: TERR_R };
      if (this.eco.decor && this.eco.decor.room) {
        // the open space round it, out to 14 cells across and 9 up or down
        const C = W.cols;
        const sx = W.cellX(hp.x);
        const sy = W.cellY(hp.y);
        const seen = new Set([sy * C + sx]);
        const q = [sy * C + sx];
        let x0 = sx;
        let x1 = sx;
        let y0 = sy;
        let y1 = sy;
        for (let h = 0; h < q.length; h++) {
          const i = q[h];
          const x = i % C;
          const y = (i / C) | 0;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
          for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
            if (!W.inBounds(nx, ny) || W.solid(nx, ny) || Math.abs(nx - sx) > 14 || Math.abs(ny - sy) > 9) continue;
            if (W.passageAt && W.passage(nx, ny) >= 0) continue;
            const j = ny * C + nx;
            if (seen.has(j)) continue;
            seen.add(j);
            q.push(j);
          }
        }
        const cell = W.cell;
        z = {
          cx: ((x0 + x1 + 1) / 2) * cell,
          cy: ((y0 + y1 + 1) / 2) * cell,
          rx: U.clamp(((x1 - x0 + 1) / 2 + 1) * cell, 90, 300),
          ry: U.clamp(((y1 - y0 + 1) / 2 + 1) * cell, 60, 200),
        };
      }
      this.zoneKey = key;
      this.zoneC = z;
      return z;
    }
    // Is pt inside the territory (scaled by k)?
    inZone(pt, k) {
      const z = this.zone();
      if (!z) return false;
      k = k || 1;
      const dx = (pt.x - z.cx) / (z.rx * k);
      const dy = (pt.y - z.cy) / (z.ry * k);
      return dx * dx + dy * dy < 1;
    }
    atHome() {
      return this.inZone(this.spine.pts[0]);
    }
    homeGoal() {
      const z = this.zone();
      if (!z || Math.random() > 0.55 + 0.3 * (1 - this.pers.energy)) return null;
      // (patrolling its patch, edge to edge, in a room)
      const W = this.W;
      // (in heavy rain, a dry corner of it: wanderGoal looks further afield)
      const wet = this.eco.heavyRain();
      return Nav.randomValid(W, this.caps, z.cx, z.cy, Math.max(z.rx, z.ry) * 0.85, (cx, cy) => this.inZone({ x: W.centerX(cx), y: W.centerY(cy) }, 0.9) && !(wet && this.eco.rainOn(W.centerX(cx), W.centerY(cy))));
    }
    truce(c, sec) {
      this.truces.set(c.id, this.eco.t + sec);
    }
    // Who, if anyone, is worth squaring up to right now?
    findFoe() {
      const head = this.spine.pts[0];
      const L = this.L;
      const pe = this.pers;
      const hp = this.homePos();
      const home = this.atHome();
      let best = null;
      let bd = Infinity;
      for (const c of this.eco.creatures) {
        if (c === this || !isLizard(c) || c.dead || c.corpse || c.leaving || c.grabbedBy || c.alpha < 0.8) continue;
        if (this.diet.includes(c.species) || c.diet.includes(this.species)) continue; // that's hunting, not rivalry
        if (this.species === 'lizard_yellow' && c.species === 'lizard_yellow') continue; // (yellows never fight yellows)
        if ((this.truces.get(c.id) || 0) > this.eco.t) continue;
        if (RIVALRY.includes(c.state) || c.state === 'flee' || c.state === 'leave') continue;
        const ch = c.spine.pts[0];
        const d = U.dist(head.x, head.y, ch.x, ch.y);
        // A scavenged corpse it's carrying, eating or heading for, that we'd
        // eat too: worth a fight, and far more so on our own patch (claimed
        // from further off, even when we're not that hungry).
        const prize = this.holding ? null : this.prizeOf(c);
        const ours = prize && this.onOwnGround(prize);
        // (a trespasser anywhere on our patch, however big the patch)
        const trespass = home && this.inZone(ch, 0.9);
        if (d > (prize ? (ours ? 300 : 240) : 200) * L && !trespass) continue;
        // (on its own patch it knows what's going on even without a clear view)
        if (!this.canSee(ch.x, ch.y, 320 * L) && !(ours && d < 220 * L) && !trespass) continue;
        let why = null;
        if (prize && (this.fullT <= 0 || ours)) {
          if (Math.random() < (ours ? 0.55 : 0.2) + 0.5 * pe.aggression) why = 'food';
        } else if (trespass) {
          // trespasser on our hangout (a room's chambers make for proper
          // patches, and they're guarded more keenly)
          const keen = this.eco.decor && this.eco.decor.room ? 0.2 : 0;
          if (Math.random() < 0.3 + keen + 0.7 * Math.max(pe.aggression, pe.dominance)) why = 'territory';
        } else if (c.holding && this.fullT <= 0 && !this.holding) {
          // it has food and we're hungry
          if (Math.random() < 0.25 + 0.6 * pe.aggression) why = 'food';
        } else if (d < 70 * L && Math.random() < 0.1 * pe.aggression) {
          why = 'meet'; // bumped into each other
        }
        if (why && d < bd) {
          bd = d;
          best = { c, why, prize: why === 'food' ? prize || c.holding : null };
        }
      }
      return best;
    }
    // The corpse c has scavenged (or is going for), if it's one we eat.
    prizeOf(c) {
      const f = c.holding && c.holding.corpse ? c.holding : c.state === 'scavenge' && c.prey && c.prey.corpse && !c.prey.grabbedBy ? c.prey : null;
      if (!f || f.dead || !this.diet.some((s) => (s.endsWith('*') ? f.species.startsWith(s.slice(0, -1)) : s === f.species))) return null;
      if (!f.grabbedBy && this.W.waterDepth(f.x, f.y) > 6) return null; // (sunk: nobody's getting it)
      return f;
    }
    // In or close by our own territory?
    onOwnGround(pt) {
      return !!this.home && this.inZone(pt, 1.15);
    }
    // Is the food we're squabbling over still there to be had?
    prizeLive(r) {
      const f = this.prize;
      if (!f || f.dead || !f.corpse) return !!r.holding;
      if (!f.grabbedBy && this.W.waterDepth(f.x, f.y) > 6) return false; // (it sank)
      return !f.grabbedBy || f.grabbedBy === r || f.grabbedBy === this;
    }
    // How determined we are to win against c.
    resolve(c) {
      const pe = this.pers;
      let r = pe.dominance * 0.5 + pe.aggression * 0.25 + pe.bravery * 0.15 + this.mass * 0.05 + this.hp * 0.3;
      if (this.rivalWhy === 'territory' && this.atHome()) r += 0.25; // defending our own patch
      if (this.holding) r += 0.15; // possession
      if (this.rivalWhy === 'food' && this.fullT <= 0) r += 0.1;
      if (this.rivalWhy === 'food' && this.prize && this.onOwnGround(this.prize)) r += 0.25; // our patch, our meal
      return r;
    }
    endRivalry(cd) {
      this.cancelStrike();
      this.backT = 0;
      this.backPending = false;
      this.rival = null;
      this.prize = null;
      this.rivalCd = cd;
      if (RIVALRY.includes(this.state)) this.setState('wander');
    }
    // Runs the challenge / display / fight states. Returns true while busy.
    rivalry(dt, perceive) {
      const r = this.rival;
      const head = this.spine.pts[0];
      const L = this.L;
      const gone = !r || r.dead || r.leaving || r.grabbedBy;
      if (gone || (this.state !== 'challenge' && (r.rival !== this || !RIVALRY.includes(r.state)))) {
        this.endRivalry(U.rand(4, 8));
        return false;
      }
      const rh = r.spine.pts[0];
      const d = U.dist(head.x, head.y, rh.x, rh.y);
      this.lookAt = rh;
      this.lash = 1;
      // a meal wandering past or a predator breaks it up
      if (perceive && this.state === 'fight' && this.fullT <= 0) {
        const prey = this.nearestOf(this.diet, 90 * L, (c) => !c.grabbedBy && c !== r);
        if (prey) {
          this.endRivalry(10);
          r.endRivalry(10);
          return false;
        }
      }

      if (this.state === 'challenge') {
        // stride over, head up, hissing
        this.speed = (this.p.speed || 50) * 1.15;
        this.raise = 0.35;
        this.jawTarget = 0.35;
        this.pather.interval = 0.5;
        this.pather.setGoal(rh.x, rh.y);
        const hp = this.homePos();
        const left = this.rivalWhy === 'territory' && hp && !this.inZone(rh, 1.3);
        if (left || this.stateT > 9 || (this.rivalWhy === 'food' && !this.prizeLive(r))) {
          // it moved on (or the food's gone): good enough
          this.truce(r, 20);
          this.endRivalry(U.rand(3, 6));
          return false;
        }
        if (d < 90 * L && !RIVALRY.includes(r.state)) {
          const t = U.rand(1.6, 3.2) * (0.7 + 0.6 * Math.max(this.pers.dominance, r.pers.dominance));
          for (const [a, b] of [[this, r], [r, this]]) {
            a.rival = b;
            a.rivalWhy = this.rivalWhy;
            a.prize = this.prize || r.holding || null;
            a.displayFor = t;
            a.setState('display');
            a.pather.clear();
          }
        }
        return true;
      }

      if (this.state === 'display') {
        // rear up, gape and hiss, face it, edge closer
        this.raise = 1;
        this.jawTarget = this.holding ? 0.3 : 0.55 + 0.45 * Math.max(0, Math.sin(this.stateT * 9));
        if (d > 95 * L) {
          this.speed = (this.p.speed || 50) * 0.6;
          this.pather.setGoal(rh.x, rh.y);
        } else {
          this.pather.clear();
        }
        this.faceToward(rh);
        if (this.stateT > this.displayFor && this.id < r.id) this.settleDisplay(r);
        return true;
      }

      // fight: close in and strike, then back off a few steps, still facing
      // it, rearing and gaping, and go again: a chance for either to lose
      // its nerve. (A red lizard barely gives ground: it stands and fights.)
      if (this.backPending && this.lungeT <= 0 && this.windT <= 0) {
        this.backPending = false;
        this.backT = this.p.red ? U.rand(0.15, 0.3) : U.rand(0.9, 1.7) * (1.3 - 0.5 * this.pers.aggression);
      }
      if (this.backT > 0) {
        this.backT -= dt;
        this.pather.clear();
        this.raise = 0.8;
        this.jawTarget = 0.45 + 0.45 * Math.max(0, Math.sin(this.stateT * 9));
        if (this.backT <= 0 && this.id < r.id) {
          // squared up again: one may think better of it
          const diff = this.resolve(r) - r.resolve(this) + U.rand(-0.15, 0.15);
          if (Math.abs(diff) > 0.3 && Math.random() < 0.4) {
            if (diff > 0) r.submitTo(this);
            else this.submitTo(r);
            return false;
          }
        }
        return true;
      }
      this.raise = 0.3;
      this.jawTarget = 0.5;
      this.speed = (this.p.huntSpeed || 90) * 0.8;
      this.pather.interval = 0.35;
      this.pather.setGoal(rh.x, rh.y);
      this.faceToward(rh);
      if (d < (this.p.biteRange || 60) * L + 12 && this.lungeCd <= 0 && this.grip && this.windT <= 0 && this.lungeT <= 0) {
        this.lunge(rh.x, rh.y, r, false);
        this.lungeCd = U.rand(0.5, 1.1) * (1.3 - 0.5 * this.pers.aggression);
        this.backPending = true;
      }
      if (this.stateT > 14 && this.id < r.id) {
        // a long scrap: whoever is worse off gives up
        if (this.hp < r.hp) this.submitTo(r);
        else r.submitTo(this);
      }
      return true;
    }
    cancelStrike() {
      if (this.lungePrey && isLizard(this.lungePrey) && !this.diet.includes(this.lungePrey.species)) {
        this.lungePrey = null;
        this.windT = 0;
      }
    }
    faceToward(pt) {
      const P = this.spine.pts;
      const fx = P[0].x - P[2].x;
      const fy = P[0].y - P[2].y;
      if (!this.turn && this.turnCd <= 0 && this.grip && fx * (pt.x - P[0].x) + fy * (pt.y - P[0].y) < 0) this.startTurn();
    }
    // End of the hissing: one backs down, or it comes to blows.
    settleDisplay(r) {
      const diff = this.resolve(r) - r.resolve(this) + U.rand(-0.12, 0.12);
      if (Math.abs(diff) > 0.2) {
        if (diff > 0) r.submitTo(this);
        else this.submitTo(r);
        return;
      }
      for (const a of [this, r]) {
        if (a.holding) {
          // drop the food to fight for it: it's what the winner gets
          const f = a.holding;
          a.release();
          this.prize = r.prize = f;
        }
        a.setState('fight');
      }
    }
    // Back down: run from the winner, maybe give up the hangout or the food,
    // and maybe leave the screen altogether.
    submitTo(w) {
      const eco = this.eco;
      const why = this.rivalWhy;
      const food = this.holding;
      const prize = this.prize;
      if (food) {
        this.release();
        if (eco.cfg.ecosystem.predation && w.diet.includes(food.species) && !w.holding) w.grab(food);
      }
      if (why === 'territory' && this.home && w.home && this.atHome()) {
        // the winner takes over this hangout; we look for another
        w.home = this.home;
        w.homeAwayT = 0;
        this.pickHome(this.home.sid);
      }
      this.cancelStrike();
      this.truce(w, 40);
      w.truce(this, 40);
      w.endRivalry(U.rand(8, 15));
      // the spoils: the corpse dropped (or never reached) goes to the winner
      const spoils = food && !food.grabbedBy ? food : prize;
      if (spoils && spoils.corpse && !spoils.dead && !spoils.grabbedBy && !w.holding && eco.cfg.ecosystem.predation) {
        w.prey = spoils;
        w.setState('scavenge');
      }
      this.rival = null;
      this.prize = null;
      this.rivalCd = U.rand(20, 40);
      const g = this.fleeGoal(this.caps, w.x, w.y, 300);
      if (g) this.pather.setGoal(g.x, g.y, true);
      this.setState('flee');
      if (Math.random() < 0.3 * (1 - this.pers.bravery) + (this.hp < 0.35 ? 0.35 : 0)) this.migrating = true;
    }
    // A fight bite landed on our rival.
    biteRival(r) {
      const L = this.L;
      const head = this.spine.pts[0];
      const rh = r.spine.pts[0];
      const dmg = ((this.p.biteDamage || 1) / (r.p.toughness || 1)) * 0.16 * U.rand(0.8, 1.2);
      r.hp -= dmg;
      const dx = rh.x - head.x;
      const dy = rh.y - head.y;
      const dl = Math.hypot(dx, dy) || 1;
      r.vx += (dx / dl) * 230;
      r.vy += (dy / dl) * 230 - 60;
      r.thrashT = 0.35;
      this.thrashT = 0.25;
      this.eco.burst(rh.x, rh.y, r.bloodColor || '#20141a', 3);
      if (r.hp <= 0) {
        // killed: it stays where it fell
        r.die(14);
        this.endRivalry(U.rand(15, 25));
        return;
      }
      const submitAt = 0.2 + 0.35 * (1 - r.pers.bravery);
      if (r.hp < submitAt || Math.random() < 0.08 * (1 - r.pers.bravery)) r.submitTo(this);
    }

    // Lunges have a short windup (stop, rear, gape) before the strike.
    // A bite is a short snap once in range; a pounce is a long leap from
    // further off. The windup follows the species' bite delay.
    // One spine from the open mouth, aimed a little high to allow for its
    // drop (and a little wild).
    spit(prey) {
      const m = this.holdPoint();
      const t = prey.mainPoint();
      const v = 800;
      const d = Math.hypot(t.x - m.x, t.y - m.y);
      const ft = d / v;
      const tx = t.x + (prey.vx || 0) * ft * 0.5;
      const ty = t.y - 0.5 * 260 * ft * ft;
      // never more than 30 degrees off level
      const dir = tx >= m.x ? 1 : -1;
      const e = U.clamp(Math.atan2(ty - m.y, Math.abs(tx - m.x)) + U.rand(-0.05, 0.05), -Math.PI / 6, Math.PI / 6);
      const a = dir > 0 ? e : Math.PI - e;
      this.eco.items.push(new RW.Spine(this.eco, m.x + Math.cos(a) * 6, m.y + Math.sin(a) * 6, Math.cos(a) * v, Math.sin(a) * v, this));
      this.thrashT = 0.12; // the head jerks with each one
    }
    // How squarely the head points at (tx, ty): 1 dead ahead, -1 behind.
    facing(tx, ty) {
      const P = this.spine.pts;
      const fx = P[0].x - P[2].x;
      const fy = P[0].y - P[2].y;
      const dx = tx - P[0].x;
      const dy = ty - P[0].y;
      return (fx * dx + fy * dy) / (Math.hypot(fx, fy) * Math.hypot(dx, dy) || 1);
    }
    lunge(tx, ty, prey, pounce) {
      // Only at something in front: snapping at what's behind whips the head
      // back over the body. Turn round (head first) instead, then strike.
      if (this.facing(tx, ty) < -0.15) {
        this.faceToward({ x: tx, y: ty });
        this.lungeCd = Math.max(this.lungeCd || 0, 0.25);
        return;
      }
      this.windT = 0.08 + ((this.p.biteDelay === undefined ? 12 : this.p.biteDelay) / 40) * 0.5;
      this.lungeTarget = { x: tx, y: ty };
      this.lungeCd = U.rand(1.3, 2.4);
      this.lungePrey = prey;
      this.pounce = !!pounce;
    }

    launchLunge() {
      const head = this.spine.pts[0];
      const prey = this.lungePrey;
      const tx = prey && !prey.dead ? prey.x : this.lungeTarget.x;
      const ty = prey && !prey.dead ? prey.y : this.lungeTarget.y;
      if (this.facing(tx, ty) < -0.3) {
        // it got round behind us during the windup: no strike, turn to face it
        this.lungePrey = null;
        this.faceToward({ x: tx, y: ty });
        return;
      }
      const dx = tx - head.x;
      const dy = ty - head.y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = this.pounce ? 380 + 120 * this.L : 240 + 80 * this.L;
      this.lungeV = { x: (dx / d) * sp, y: (dy / d) * sp };
      this.lungeT = this.pounce ? 0.32 : 0.22;
      // the whole body is thrown into the strike, not just the head
      this.jolt = { hx: head.x, hy: head.y };
      // feet leave the ground for the strike
      for (const l of this.legs) l.leg.planted = false;
    }

    // Leap for a nearby pole: a ballistic arc over to the next path node.
    launchLeap(node) {
      const head = this.spine.pts[0];
      const cell = this.W.cell;
      const apexY = Math.min(head.y, node.y) - cell * 1.1;
      const vy0 = -Math.sqrt(2 * GRAV * Math.max(4, head.y - apexY));
      const tUp = -vy0 / GRAV;
      const tDown = Math.sqrt((2 * Math.max(1, node.y - apexY)) / GRAV);
      this.vx = (node.x - head.x) / (tUp + tDown);
      this.vy = vy0;
      this.leap = { t: 0, tx: node.x, ty: node.y, dur: tUp + tDown };
      this.leapNode = null;
      for (const l of this.legs) l.leg.planted = false;
    }

    // --------------------------------------------------------- physics ----
    update(dt) {
      if (!this.tick(dt)) {
        // crawling a passage: the head looks the way it goes, along the
        // neck, not off sideways at whatever it was facing going in
        if (this.tunnel) {
          const P = this.spine.pts;
          this.headAng = U.lerpAngle(this.headAng, Math.atan2(P[0].y - P[1].y, P[0].x - P[1].x), U.approach(18, dt));
          this.jaw *= 0.9;
        }
        return;
      }
      const W = this.W;
      const P = this.spine.pts;
      const head = P[0];
      const L = this.L;

      if (this.grabbedBy) {
        const hp = this.grabbedBy.holdPoint();
        head.x = hp.x;
        head.y = hp.y;
        this.spine.verlet(1, 0.9, 0, GRAV, dt);
        this.spine.follow(1);
        this.spine.collide(W, 3, 1);
        // dead or dangling from the player's hand: slack-jawed; caught by a
        // predator: snapping
        const limp = this.corpse || this.grabbedBy.isHand;
        this.jaw += limp ? (0.25 - this.jaw) * 0.2 : (Math.random() < 0.1 ? 1 : 0 - this.jaw) * 0.3;
        this.updateLegs(dt, false);
        this.struggle(dt);
        return;
      }

      this.think(dt);
      this.pather.update(dt, head.x, head.y);
      if (this.swimCheck(dt)) return this.swim(dt);
      this.turnCd = (this.turnCd || 0) - dt;
      if (this.turn && this.turn.phase === 'arch') {
        this.stepTurn(dt);
        this.headAng = U.lerpAngle(this.headAng, Math.atan2(P[0].y - P[1].y, P[0].x - P[1].x), U.approach(20, dt));
        this.updateLegs(dt, true);
        return;
      }
      if (this.turn) this.turn.t += dt;
      if (this.windT > 0) {
        // windup: stop, rear, gape
        this.windT -= dt;
        this.raise = 0.8;
        this.jawTarget = 0.9;
        this.vx *= 0.7;
        this.vy *= 0.7;
        // coil: draw the head and shoulders back away from the target
        const lt = this.lungeTarget;
        if (lt) {
          const dx = lt.x - head.x;
          const dy = lt.y - head.y;
          const d = Math.hypot(dx, dy) || 1;
          const pull = 30 * L * dt;
          for (let i = 0; i < this.bodyN; i++) {
            const k = 1 - (i / this.bodyN) * 0.7; // the whole body rocks back
            P[i].x -= (dx / d) * pull * k;
            P[i].y -= (dy / d) * pull * k;
          }
        }
        if (this.windT <= 0) this.launchLunge();
      }
      if (this.lungeT > 0) this.jawTarget = 1; // hold the gape through the strike

      // Only cling to a pole when the path is actually using it; otherwise a
      // pole base pushes the lizard sideways and it can't walk past.
      const pn = this.pather.current();
      // (and only that pole: between two poles a cell or two apart, the
      // nearer one would pull it off the one its path climbs)
      let mask = this.maskNoPole;
      const onePole = (x) => {
        const m = this.maskOnePole || (this.maskOnePole = Object.assign({}, this.mask));
        m.poleX = x;
        return m;
      };
      if (pn && W.pole(pn.cx, pn.cy) && !W.solid(pn.cx, pn.cy + 1)) mask = onePole(W.centerX(pn.cx));
      let g = W.nearestSurface(head.x, head.y, 22 * L, mask);
      if (!g) g = W.nearestSurface(P[3].x, P[3].y, 20 * L, mask);
      // A blue lizard out in the open clings to the back wall behind it
      // (seen from above, legs splayed either side); knocked off by a hit,
      // it can't for a moment.
      if (!g && this.caps.back && !(this.knockT > 0) && this.lungeT <= 0 && !this.leap && !(this.dropT > 0) && !(pn && pn.type === Nav.FALL) && W.backWall(W.cellX(head.x), W.cellY(head.y))) {
        g = { x: head.x, y: head.y, nx: 0, ny: 0, d: 15 * L, id: 'back', type: 'back' };
      }
      // Nothing to hold but the pole it's on: it keeps hold of that until it
      // means to leave it (a leap or a drop). At the top, stepping across to
      // the ledge beside it, reaching for the next pole over, or stopped
      // there to kill or eat, it doesn't just let go.
      if (!g && this.lungeT <= 0 && !this.leap && !(pn && (pn.type === Nav.FALL || pn.type === Nav.JUMP))) {
        const under = this.poleUnder(head) || this.poleUnder(P[2]);
        if (under) g = W.nearestSurface(head.x, head.y, 22 * L, onePole(under.x)) || W.nearestSurface(P[3].x, P[3].y, 20 * L, onePole(under.x));
      }
      this.onBack = !!(g && g.type === 'back');
      if (this.knockT > 0) this.knockT -= dt;
      if (this.dropT > 0) {
        // letting go on purpose to drop down
        this.dropT -= dt;
        g = null;
      }
      if (this.leap) {
        // mid-leap: don't snag on the pole we left; grab hold near the far end
        const lp = this.leap;
        const near = U.dist(head.x, head.y, lp.tx, lp.ty) < W.cell * 1.6;
        if (!near && lp.t < lp.dur * 0.75) g = null;
      }
      if (this.scramble) g = null; // hauling over a ledge lip: no hugging
      this.grip = g;

      if (this.lungeT > 0) {
        this.lungeT -= dt;
        if (this.lungeT > 0.19) {
          // ease into the strike over a few frames
          this.vx += (this.lungeV.x - this.vx) * 0.5;
          this.vy += (this.lungeV.y - this.vy) * 0.5;
        }
        if (this.lungeT < 0.12) this.vy += GRAV * dt;
        const prey = this.lungePrey;
        if (prey && prey === this.rival && this.state === 'fight' && !prey.dead && U.dist(head.x, head.y, prey.x, prey.y) < 22 * L) {
          this.lungeT = 0;
          this.lungePrey = null;
          this.biteRival(prey);
        } else if (prey && !prey.dead && U.dist(head.x, head.y, prey.x, prey.y) < 18 * L) {
          if (isLizard(prey) && !this.diet.includes(prey.species) && !(prey.p.red && this.p.red)) {
            // a rival, not a meal (the scrap ended mid-lunge): just snap shut
            this.lungeT = 0;
          } else if (prey.p.armored && !prey.corpse) {
            // armoured (a red feud): the bite wounds it, it doesn't take it
            this.lungeT = 0;
            this.lungePrey = null;
            this.lungeCd = Math.max(this.lungeCd || 0, 0.7);
            this.thrashT = 0.3;
            prey.takeHit(((this.p.biteDamage || 1) * 0.16) * U.rand(0.8, 1.2), this);
          } else if (this.eco.cfg.ecosystem.predation && this.grab(prey)) {
            this.eatT = 0;
            this.lungeT = 0;
            this.thrashT = 1.1; // shake the catch
          } else if (prey.onBitten) {
            prey.onBitten(this);
            this.lungeT = 0;
          }
          this.lungePrey = null;
        }
      } else {
        // Steering toward the next path node.
        const cell = W.cell;
        this.pather.advance(head.x, head.y, cell * 0.8);
        const node = this.pather.current();
        let dvx = 0;
        let dvy = 0;
        this.leavingSurface = false;
        this.scrambleCd = (this.scrambleCd || 0) - dt;
        if (!this.scramble && !this.leap && !(this.leapWind > 0) && this.scrambleCd <= 0) {
          // off a pole onto the ledge beside it: scramble up over the lip
          // (smaller lizards make it more often)
          const corner = this.cornerAhead(head);
          // (each slip back teaches it the grip: the next try does better)
          if (corner) this.startScramble(corner, head, 6 * L, 15 * L, U.clamp(0.95 - L * 0.4, 0.35, 0.7) + 0.25 * (this.scrambleFails || 0));
        }
        if (this.scramble) {
          const sc = this.scramble;
          if (this.stepScramble(dt, head) === null) {
            // the body wriggles and the feet paw at the face
            for (let i = 1; i < this.bodyN; i++) P[i].x += Math.sin(sc.t * 30 - i * 1.1) * 0.6 * L;
            this.raise = 0.5;
          }
        } else if (this.leap) {
          // airborne: a ballistic arc until we catch hold of something
          const lp = this.leap;
          lp.t += dt;
          this.vy += GRAV * dt;
          if ((g && lp.t > 0.12) || lp.t > lp.dur + 0.8) {
            this.leap = null;
            this.pather.timer = Math.min(this.pather.timer, 0.1);
          }
        } else if (this.leapWind > 0) {
          // crouch, then spring
          this.leapWind -= dt;
          this.vx *= 0.7;
          this.vy *= 0.7;
          if (this.leapWind <= 0 && this.leapNode) this.launchLeap(this.leapNode);
        } else if (node && node.type === Nav.JUMP) {
          // a leap: get to the take-off point first
          const prev = this.pather.previous();
          // (off a pole: from level with the take-off point or above, not
          // from below it, where the leap clips the ledge's corner)
          const lowOnPole = prev && W.pole(prev.cx, prev.cy) && head.y > prev.y + 3;
          if (g && (!prev || (U.dist(head.x, head.y, prev.x, prev.y) < cell * 0.9 && !lowOnPole))) {
            this.leapWind = 0.14;
            this.leapNode = node;
          } else if (prev) {
            const dx = prev.x - head.x;
            const dy = prev.y - head.y;
            const d = Math.hypot(dx, dy) || 1;
            dvx = (dx / d) * this.speed;
            dvy = (dy / d) * this.speed;
          }
        } else if (node) {
          if (g && this.speed > 0 && this.windT <= 0) this.noteProgress(dt, head); // jammed on a corner: clamber
          let tx = node.x;
          let ty = node.y;
          if (node.type === Nav.FALL && g) {
            if (Math.abs(node.x - head.x) < cell * 0.6) this.dropT = 0.35; // right above it: let go
            else ty = head.y; // walk off the edge first
          }
          const dx = tx - head.x;
          const dy = ty - head.y;
          const d = Math.hypot(dx, dy) || 1;
          // speed surges as feet step and eases as they plant
          // lumbering: a heave forward as feet swing, a sag as they plant
          const surge = this.legs.some((l) => l.leg.stepping) ? 1.25 : 0.68;
          dvx = (dx / d) * this.speed * surge;
          dvy = (dy / d) * this.speed * surge;
          if (g && !this.turn && this.speed > 0 && this.turnCd <= 0 && this.windT <= 0) {
            let nx = P[0].x - P[2].x;
            let ny = P[0].y - P[2].y;
            const nl = Math.hypot(nx, ny) || 1;
            if ((nx / nl) * (dx / d) + (ny / nl) * (dy / d) < -0.3) {
              this.startTurn();
              return;
            }
          }
          // Deliberately stepping off a surface: don't let the hug pull us back.
          this.leavingSurface = node.type === Nav.FALL || (g && (dx / d) * g.nx + (dy / d) * g.ny > 0.6);
        }
        if (this.backT > 0 && this.state === 'fight' && g && this.lungeT <= 0) {
          // backing off: a slow step back along the body's line (the head
          // shoves the body back the way it lies)
          let bx = P[2].x - head.x;
          let by = P[2].y - head.y;
          const bn = bx * g.nx + by * g.ny;
          bx -= bn * g.nx;
          by -= bn * g.ny;
          const bl = Math.hypot(bx, by) || 1;
          const bs = (this.p.speed || 50) * 0.35;
          dvx = (bx / bl) * bs;
          dvy = (by / bl) * bs;
        }
        if (this.leap || this.scramble) {
          // (gravity already applied or scrambling; no steering)
        } else if (g) {
          // heavy lizards are slow to get going and slow to stop
          const k = U.approach(U.clamp(11 / Math.sqrt(this.mass), 3.5, 9), dt);
          this.vx += (dvx - this.vx) * k;
          this.vy += (dvy - this.vy) * k;
        } else {
          this.vy += GRAV * dt;
          this.vx += (dvx * 0.3 - this.vx) * U.approach(0.8, dt);
        }
      }

      // On a surface the head never walks backwards into its own shoulders
      // (that folds the body up behind it); it has to turn round instead.
      if (g && this.lungeT <= 0 && !this.leavingSurface && !(this.backT > 0 && this.state === 'fight')) {
        let fx = head.x - P[2].x;
        let fy = head.y - P[2].y;
        const fl = Math.hypot(fx, fy) || 1;
        fx /= fl;
        fy /= fl;
        const back = this.vx * fx + this.vy * fy;
        if (back < 0) {
          this.vx -= back * fx;
          this.vy -= back * fy;
        }
      }
      // Coming round a turn it keeps walking until the tail is round too
      // (stopping halfway left it folded in two).
      if (this.turn && this.turn.phase === 'walk' && g) {
        let hx = head.x - P[1].x;
        let hy = head.y - P[1].y;
        const hl = Math.hypot(hx, hy) || 1;
        hx /= hl;
        hy /= hl;
        const along = this.vx * hx + this.vy * hy;
        const want = Math.max(25, (this.p.speed || 40) * 0.7);
        if (along < want) {
          this.vx += (want - along) * hx;
          this.vy += (want - along) * hy;
        }
      }
      head.x += this.vx * dt;
      head.y += this.vy * dt;
      if (g && this.lungeT <= 0 && !this.leavingSurface) {
        // hug the surface at a fixed body height
        this.raiseS = (this.raiseS || 0) + (this.raise - (this.raiseS || 0)) * U.approach(5, dt);
        // a slow rise and fall with the stride
        const moving = U.clamp(Math.hypot(this.vx, this.vy) / 40, 0, 1);
        this.walkPh += Math.hypot(this.vx, this.vy) * dt * 0.11 / L;
        const bob = Math.sin(this.walkPh * 2) * 1.3 * moving;
        const err = g.d - (15 + bob + this.raiseS * 12) * L;
        head.x -= g.nx * err * 0.25;
        head.y -= g.ny * err * 0.25;
        this.contactId = g.id;
      }
      const c = W.collideCircle(head, 5 * L);
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx;
          this.vy -= vn * c.ny;
        }
      }
      head.px = head.x;
      head.py = head.y;

      // Body and tail (coming round a turn, they follow the head's path)
      // (only a lunge, a leap or a real fall cuts a turn short: rearing up
      // out of reach of the ground mid-turn, the body still follows through)
      if (this.turn && (this.lungeT > 0 || this.leap || (!g && this.vy > 150))) {
        this.turn = null;
        this.turnCd = 1.5; // (no straight back into another one)
      }
      if (this.turn) this.followTrail();
      else {
        this.spine.verlet(this.bodyN, 0.88, 0, this.onBack ? 0 : g ? 150 : 700, dt);
        this.spine.follow(1);
        // no hairpins: the body and tail bend round, never double back flat
        this.spine.limitBend(0.8, 2, this.bodyN + 2, 0.5);
        this.spine.limitBend(0.75, this.bodyN + 2, P.length, 0.5);
        for (let i = 1; i < P.length; i++) {
          const pt = P[i];
          if (g && !this.leavingSurface && i < this.bodyN + 4) {
            const s = W.nearestSurface(pt.x, pt.y, 22 * L, mask);
            if (s) {
              const e = s.d - (i < this.bodyN ? 14 - i * 0.5 + this.raiseS * 12 * (REAR[i] || 0) : 5.5 + (this.bodyN + 4 - i) * 1.4) * L;
              pt.x -= s.nx * e * 0.3;
              pt.y -= s.ny * e * 0.3;
            }
          }
          W.collideCircle(pt, i < this.bodyN ? 4 * L : 2.5);
        }
        // On a pole the body hangs straight down one side of it (the side the
        // neck is on) instead of coiling round it.
        const pole = this.lungeT <= 0 && !this.leavingSurface && this.poleUnder(P[2]) && this.poleUnder(P[Math.min(this.bodyN, P.length - 1)]);
        if (pole) {
          const side = Math.sign(P[1].x - pole.x) || 1;
          const tx = pole.x + side * 6 * L;
          for (let i = 2; i < this.bodyN + 3; i++) {
            const pt = P[i];
            if (pt.y > pole.y1 && pt.y < pole.y2) pt.x += (tx - pt.x) * 0.2;
          }
        }
        // A little backbone stiffness: the body resists folding into a heap.
        if (g && !this.leavingSurface) {
          for (let i = 1; i < this.bodyN + 2; i++) {
            const a = P[i - 1];
            const b = P[i + 1];
            const pt = P[i];
            pt.x += ((a.x + b.x) / 2 - pt.x) * 0.12;
            pt.y += ((a.y + b.y) / 2 - pt.y) * 0.12;
          }
        }

      } // (end of the usual body; see the turn above)

      // Lunge follow-through: shoulders, hips and tail lurch after the head.
      // Each point is dragged along by a share of the head's own movement this
      // frame, most at the shoulders, least at the tail tip.
      if (this.jolt) {
        const j = this.jolt;
        const mx = head.x - j.hx;
        const my = head.y - j.hy;
        j.hx = head.x;
        j.hy = head.y;
        const n = P.length;
        for (let i = 1; i < n; i++) {
          const k = Math.pow(1 - i / n, 0.8) * 0.6;
          P[i].x += mx * k;
          P[i].y += my * k;
        }
        if (this.lungeT <= 0) this.jolt = null;
      }

      // Smoothed "up" (away from surface) and head angle.
      const ux = g ? g.nx : 0;
      const uy = g ? g.ny : -1;
      const ku = U.approach(6, dt);
      this.ux += (ux - this.ux) * ku;
      this.uy += (uy - this.uy) * ku;
      const ul = Math.hypot(this.ux, this.uy) || 1;
      this.ux /= ul;
      this.uy /= ul;
      const neckAng = Math.atan2(head.y - P[1].y, head.x - P[1].x);
      let lookTarget = 0;
      if (this.lookAt) {
        const want = Math.atan2(this.lookAt.y - head.y, this.lookAt.x - head.x);
        lookTarget = U.clamp(U.angleDiff(neckAng, want), -0.85, 0.85);
      }
      this.look += (lookTarget - this.look) * U.approach(this.noticeT > 0 ? 30 : 7, dt);
      let ang = neckAng + this.look;
      // never let the head point more than ~35 degrees off the body line
      const bodyAng = Math.atan2(P[1].y - P[3].y, P[1].x - P[3].x);
      ang = bodyAng + U.clamp(U.angleDiff(bodyAng, ang), -0.6, 0.6);
      // ...and on a surface, keep the head near level with it: a little
      // up-tilt (more when rearing), never nosing down into the ground
      if (g && this.lungeT <= 0) {
        const hx = Math.cos(ang);
        const hy = Math.sin(ang);
        const up = hx * this.ux + hy * this.uy;
        const maxUp = Math.sin(0.4 + (this.raiseS || 0) * 0.7);
        const maxDown = -Math.sin(0.25);
        if (up > maxUp || up < maxDown) {
          let tx = hx - up * this.ux;
          let ty = hy - up * this.uy;
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl;
          ty /= tl;
          const u = U.clamp(up, maxDown, maxUp);
          const c = Math.sqrt(1 - u * u);
          ang = Math.atan2(ty * c + this.uy * u, tx * c + this.ux * u);
        }
      }
      if (this.thrashT > 0) {
        this.thrashT -= dt;
        ang += Math.sin(this.age * 38) * 0.45 * Math.min(1, this.thrashT);
      }
      if (this.shakeT > 0) {
        // a vigorous shake of the kill: the head whips side to side and the
        // neck and shoulders swing with it, flinging the carcass about
        this.shakeT -= dt;
        if (!this.holding) this.shakeT = 0;
        const k = Math.min(1, this.shakeT * 4) * Math.min(1, (this.shakeDur = (this.shakeDur || 0) + dt) * 6);
        const w = Math.sin(this.age * 30);
        ang += w * 0.85 * k;
        let nx = -(P[0].y - P[2].y);
        let ny = P[0].x - P[2].x;
        const nl = Math.hypot(nx, ny) || 1;
        nx /= nl;
        ny /= nl;
        P[1].x += nx * w * 1.6 * L * k;
        P[1].y += ny * w * 1.6 * L * k;
        P[2].x += nx * Math.sin(this.age * 30 - 0.9) * 0.9 * L * k;
        P[2].y += ny * Math.sin(this.age * 30 - 0.9) * 0.9 * L * k;
        this.jawTarget = 0.35;
      } else {
        this.shakeDur = 0;
      }
      this.headAng = U.lerpAngle(this.headAng, ang, U.approach(this.thrashT > 0 || this.shakeT > 0 ? 40 : 12, dt));
      this.jaw += (this.jawTarget - this.jaw) * U.approach(this.jawTarget > this.jaw ? 25 : 8, dt);

      // Tongue flicks while idle, stalking or sizing up a rival.
      this.tongueCd -= dt;
      if (this.tongue > 0) this.tongue = Math.min(1.0001, this.tongue + dt * 3.2);
      if (this.tongue > 1) this.tongue = 0;
      if (this.tongueCd <= 0 && this.tongue === 0 && this.jaw < 0.3 && ['idle', 'stalk', 'wander', 'display'].includes(this.state)) {
        this.tongue = 0.001;
        this.tongueCd = U.rand(2.5, 9);
      }
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.blink = 0.14;
        this.blinkT = U.rand(2.5, 7);
      }
      this.blink = Math.max(0, this.blink - dt);

      // Tail: lazy swish at rest, lashing when agitated.
      this.lashS = (this.lashS || 0) + (this.lash - (this.lashS || 0)) * U.approach(3, dt);
      const nT = P.length - this.bodyN;
      const freq = 2 + this.lashS * 7;
      for (let i = this.bodyN + 2; i < P.length; i++) {
        const k = (i - this.bodyN) / nT;
        const a = P[i - 1];
        let tx = P[i].x - a.x;
        let ty = P[i].y - a.y;
        const tl = Math.hypot(tx, ty) || 1;
        const amp = (0.25 + this.lashS * 1.4) * k * k * L;
        const w = Math.sin(this.age * freq - i * 0.55) * amp;
        P[i].x += (-ty / tl) * w;
        P[i].y += (tx / tl) * w;
      }

      this.updateLegs(dt, true);
      const speedNow = Math.hypot(this.vx, this.vy);
      if (this.p.camouflage) {
        // only while stalking or hunting: fades see-through when still (never
        // fully invisible); otherwise in plain sight
        // (lying in ambush: gone altogether, bar a faint shimmer)
        const sneaking = this.state === 'hunt' || this.state === 'stalk' || this.state === 'lurkgo';
        const visible = this.state === 'lurk' && !this.lungeT && !this.holding ? 0.03 : !sneaking || this.lungeT > 0 || this.holding ? 1 : U.clamp(speedNow / 140, 0.35, 1);
        this.camo += (visible - this.camo) * U.approach(visible > this.camo ? 6 : 0.7, dt);
        // (in ambush it's hidden from the start, not only once faded)
        this.lurking = this.camo < 0.4 || this.state === 'lurk';
        // dropping from an ambush: steer onto the prey below, and take it
        // the moment it's in reach, as a dropwig does
        if (this.ambushT > 0) {
          this.ambushT -= dt;
          const pr = this.prey;
          if (pr && !pr.dead && !pr.grabbedBy && this.state === 'hunt') {
            const pm = pr.mainPoint();
            const hd = this.spine.pts[0];
            if (!this.grip) this.vx = U.clamp(this.vx + U.clamp((pm.x + (pr.vx || 0) * 0.15 - hd.x) * 8, -500, 500) * dt, -170, 170);
            if (U.dist(hd.x, hd.y, pm.x, pm.y) < 20 * this.L && this.eco.cfg.ecosystem.predation && this.grab(pr)) {
              this.eatT = 0;
              this.prey = null;
              this.ambushT = 0;
            }
          } else this.ambushT = 0;
        }
      }
    }

    updateLegs(dt, active) {
      const P = this.spine.pts;
      const stepping = [false, false];
      for (const l of this.legs) if (l.leg.stepping) stepping[l.leg.group] = true;
      const spd = Math.hypot(this.vx, this.vy) / (this.p.speed || 90);
      if (this.onBack) return this.backLegs(dt, active, stepping, spd);
      for (const l of this.legs) {
        const a = P[l.at - 1];
        const b = P[l.at + 1];
        let fx = a.x - b.x;
        let fy = a.y - b.y;
        const fl = Math.hypot(fx, fy) || 1;
        fx /= fl;
        fy /= fl;
        const h = P[l.at];
        let canStep = active && !stepping[1 - l.leg.group];
        if (l.at === 2 && (this.raiseS || 0) > 0.6 && active) {
          // reared up: front feet leave the ground and paw the air
          l.leg.planted = false;
          canStep = false;
        }
        l.leg.update(dt, this.W, h.x, h.y, fx, fy, this.ux, this.uy, this.mask, canStep, spd);
      }
    }

    // On the back wall, seen from above: each foot planted out to its own
    // side of the body (the near legs one side, the far legs the other),
    // held there while the body moves on, then swung ahead, in diagonal
    // pairs as on the ground.
    backLegs(dt, active, stepping, spd) {
      const P = this.spine.pts;
      for (const l of this.legs) {
        const leg = l.leg;
        const a = P[l.at - 1];
        const b = P[l.at + 1];
        let fx = a.x - b.x;
        let fy = a.y - b.y;
        const fl = Math.hypot(fx, fy) || 1;
        fx /= fl;
        fy /= fl;
        const h = P[l.at];
        const side = l.near ? 1 : -1;
        const sx = -fy * side;
        const sy = fx * side;
        const r = leg.reach;
        // (front feet reach forward, hind feet trail back: splayed, not an X)
        const fwd = (l.at <= 2 ? 0.6 : -0.5) + (leg.forward - 0.45) * 0.3;
        // (seen from above the legs look longer than they are side on: the
        // feet stay tucked in closer)
        const ix = h.x + fx * r * fwd * 0.8 + sx * r * 0.54;
        const iy = h.y + fy * r * fwd * 0.8 + sy * r * 0.54;
        if (leg.stepping) {
          leg.update(dt, this.W, h.x, h.y, fx, fy, this.ux, this.uy, this.mask, false, spd);
          continue;
        }
        const d = U.dist(leg.foot.x, leg.foot.y, ix, iy);
        if (!leg.planted || d > r * 0.8) {
          leg.foot.x = ix;
          leg.foot.y = iy;
          leg.planted = true;
        } else if (d > r * 0.36 && active && !stepping[1 - leg.group]) {
          // swing it ahead of where it should be, so it lands in front
          leg.from.x = leg.foot.x;
          leg.from.y = leg.foot.y;
          leg.to.x = ix + fx * r * 0.26;
          leg.to.y = iy + fy * r * 0.26;
          leg.n.x = sx * 0.5;
          leg.n.y = sy * 0.5;
          leg.t = 0;
          leg.stepping = true;
          leg.planted = false;
          stepping[leg.group] = true;
        }
      }
    }

    // ------------------------------------------------------------ drawing ----
    // Per-point normal pointing to the lizard's back (away from the surface).
    backNormals(P) {
      const n = P.length;
      const N = new Array(n);
      for (let i = 0; i < n; i++) {
        const a = P[Math.max(0, i - 1)];
        const b = P[Math.min(n - 1, i + 1)];
        let tx = a.x - b.x;
        let ty = a.y - b.y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        let nx = -ty;
        let ny = tx;
        if (nx * this.ux + ny * this.uy < 0) {
          nx = -nx;
          ny = -ny;
        }
        N[i] = { nx, ny, tx, ty };
      }
      return N;
    }

    draw(ctx) {
      const P = this.spine.pts;
      const L = this.L;
      const n = P.length;
      const px = this.eco.artPx || 1.25; // one art pixel, in world units
      const body = U.rgba(this.bodyColor);
      const headCol = U.rgba(this.headColor);
      ctx.save();
      // (a camouflaged lizard is drawn opaque here and blended in later; see
      // ghostAlpha and Ecosystem.drawLate)
      ctx.globalAlpha = this.alpha;

      // An open mouth is a gap: keep the lizard's own neck and legs out of it
      // (clip, rather than erase, so whatever is behind still shows).
      ctx.save();
      const wedge = this.mouthWedge();
      if (wedge) {
        const b = this.bounds();
        ctx.beginPath();
        ctx.rect(b[0] - 40, b[1] - 40, b[2] - b[0] + 80, b[3] - b[1] + 80);
        ctx.moveTo(wedge[0][0], wedge[0][1]);
        for (let i = 1; i < wedge.length; i++) ctx.lineTo(wedge[i][0], wedge[i][1]);
        ctx.closePath();
        ctx.clip('evenodd');
      }

      // (on the back wall, seen from above: all four legs show, under the body)
      for (const l of this.legs) if (!l.near || this.onBack) this.drawLeg(ctx, l, px);

      // Flat silhouette; the pixel pass gives it hard edges.
      const breath = 1 + 0.05 * Math.sin(this.age * 2.3 + this.breathe) * (this.state === 'display' ? 2.5 : 1);
      const widths = new Array(n);
      const prof = [6.2, 8, 9.2, 9, 8.2, 7, 5.8];
      for (let i = 0; i < n; i++) {
        if (i < this.bodyN) widths[i] = prof[i] * L * (i >= 2 && i <= 5 ? breath : 1);
        else {
          const t = (i - this.bodyN + 1) / (n - this.bodyN);
          widths[i] = Math.max(px * 0.8, 5.5 * L * (t < 0.75 ? 1 - t * 0.6 : 0.55 * (1 - t) / 0.25));
        }
      }
      const N = this.backNormals(P);
      if (this.onBack) {
        // on the back wall: its shadow on the wall just under it
        ctx.save();
        ctx.translate(2.5 * L, 3.5 * L);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        U.taperPath(ctx, P, widths);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = body;
      U.taperPath(ctx, P, widths);
      ctx.fill();
      // Neck takes the head colour solid for a short way...
      ctx.fillStyle = headCol;
      U.taperPath(ctx, P.slice(0, 3), widths.slice(0, 3).map((w) => w * 0.9));
      ctx.fill();

      // ...then breaks up into flecks, plus the species pattern.
      const at = (t) => {
        const f = U.clamp(t, 0, 1) * (n - 1);
        const i = Math.min(n - 2, Math.floor(f));
        const k = f - i;
        return {
          x: U.lerp(P[i].x, P[i + 1].x, k),
          y: U.lerp(P[i].y, P[i + 1].y, k),
          w: U.lerp(widths[i], widths[i + 1], k),
          nx: N[i].nx,
          ny: N[i].ny,
          tx: N[i].tx,
          ty: N[i].ty,
        };
      };
      for (const sp of this.specks) {
        const q = at(sp.t);
        if (sp.kind === 'fin') {
          // spiky fin sticking out of the outline
          const sx = q.x + q.nx * q.w * sp.side * 0.7;
          const sy = q.y + q.ny * q.w * sp.side * 0.7;
          const len = sp.size * L * (1 + this.raiseS * 0.5);
          const ox = q.nx * sp.side;
          const oy = q.ny * sp.side;
          ctx.fillStyle = headCol;
          ctx.beginPath();
          ctx.moveTo(sx + q.tx * px * 1.2, sy + q.ty * px * 1.2);
          ctx.lineTo(sx - q.tx * px * 1.2, sy - q.ty * px * 1.2);
          ctx.lineTo(sx + ox * len - q.tx * len * 0.8, sy + oy * len - q.ty * len * 0.8);
          ctx.fill();
          continue;
        }
        const sz = Math.max(1, Math.round(sp.size)) * px;
        const x = q.x + q.nx * q.w * sp.side * 0.85;
        const y = q.y + q.ny * q.w * sp.side * 0.85;
        ctx.fillStyle = sp.kind === 'dark' ? 'rgb(78,80,90)' : headCol;
        ctx.fillRect(Math.round(x / px) * px - sz / 2, Math.round(y / px) * px - sz / 2, sz, sz);
      }

      // Coloured tail tip (blue, pink, yellow, cyan...).
      if (this.p.tailTip) {
        ctx.fillStyle = headCol;
        const k0 = Math.floor(n * 0.78);
        U.taperPath(ctx, P.slice(k0), widths.slice(k0).map((w) => w * 0.95));
        ctx.fill();
      }
      // Bands across the back (pink lizards).
      if (this.p.bands) {
        // (each a dark-edged pink stripe, so it reads among the flecks)
        for (const [col, lw] of [[U.rgba(U.scale(this.bodyColor, 0.5)), Math.max(px * 3.2, 2.8 * L)], [headCol, Math.max(px * 1.8, 1.6 * L)]]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = lw;
        ctx.beginPath();
        for (let t = 0.18; t < 0.74; t += 0.09) {
          const q = at(t);
          ctx.moveTo(q.x + q.nx * q.w * 0.95 - q.tx * q.w * 0.25, q.y + q.ny * q.w * 0.95 - q.ty * q.w * 0.25);
          ctx.lineTo(q.x - q.nx * q.w * 0.2, q.y - q.ny * q.w * 0.2);
        }
        ctx.stroke();
        }
      }
      // Ring markings (cyan lizards): bright rings, each with a dark edge,
      // down the back and onto the tail.
      if (this.p.pattern === 'rings') {
        const rings = [0.13, 0.22, 0.31, 0.4, 0.5, 0.62, 0.74];
        const lw = Math.max(px * 1.5, 1.4 * L);
        for (const [col, w] of [[U.rgba(U.scale(this.bodyColor, 0.35)), lw * 2.1], [U.rgba(U.mix(this.headColor, '#ffffff', 0.3)), lw]]) {
          ctx.strokeStyle = col;
          ctx.lineWidth = w;
          for (const t of rings) {
            const q = at(t);
            const r = q.w * (t < 0.55 ? 0.5 : 0.42);
            ctx.beginPath();
            ctx.arc(q.x + q.nx * q.w * 0.15, q.y + q.ny * q.w * 0.15, r, 0, U.TAU);
            ctx.stroke();
          }
        }
        ctx.strokeStyle = headCol;
        // stripe along the tail
        ctx.lineWidth = Math.max(px, 1 * L);
        ctx.beginPath();
        for (let i = this.bodyN; i < n; i++) {
          const x = P[i].x + N[i].nx * widths[i] * 0.4;
          const y = P[i].y + N[i].ny * widths[i] * 0.4;
          if (i === this.bodyN) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Dorsal spines (green lizards): wide-based jagged pixel spikes,
      // irregular in height, spacing and lean.
      if (this.spineSet.length) {
        ctx.fillStyle = headCol;
        for (const sp of this.spineSet) {
          const q = at(sp.t);
          const len = sp.len * L * (1 + this.raiseS * 0.4);
          const half = Math.max(px * 1.6, 1.8 * L);
          const bx = q.x + q.nx * (q.w - px);
          const by = q.y + q.ny * (q.w - px);
          ctx.beginPath();
          ctx.moveTo(bx + q.tx * half, by + q.ty * half);
          ctx.lineTo(bx - q.tx * half, by - q.ty * half);
          ctx.lineTo(bx + q.nx * len - q.tx * len * sp.lean, by + q.ny * len - q.ty * len * sp.lean);
          ctx.fill();
        }
      }

      for (const l of this.legs) if (l.near && !this.onBack) this.drawLeg(ctx, l, px);
      ctx.restore(); // end of the mouth clip
      this.drawHead(ctx, px);
      ctx.restore();
      this.drawPath(ctx, this.pather);
      if (this.eco.cfg.debug.showPaths || this.showPath) {
        // territory (with its path, debug.showPaths or the creature menu's
        // path + AI): a faint dashed oval in the lizard's colour, and its
        // hangout marked
        const hp = this.homePos();
        const z = hp && this.zone();
        if (z) {
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(z.cx, z.cy, z.rx, z.ry, 0, 0, U.TAU);
          ctx.fillStyle = U.rgba(this.headColor, 0.07);
          ctx.fill();
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = U.rgba(this.headColor, 0.85);
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = U.rgba(this.headColor, 0.9);
          ctx.fillRect(hp.x - 2, hp.y - 2, 4, 4);
          ctx.restore();
        }
      }
      this.drawDebug(ctx);
    }

    // Sprawling limbs, seen from the side: front elbows point back and hind
    // knees forward, and a joint never rises above the body's centreline
    // (the leg splays out sideways instead, so it reads foreshortened).
    legJoint(l) {
      const P = this.spine.pts;
      const h = P[l.at];
      const leg = l.leg;
      const L = this.L;
      const a = P[l.at - 1];
      const b = P[l.at + 1];
      let fx = a.x - b.x;
      let fy = a.y - b.y;
      const fl = Math.hypot(fx, fy) || 1;
      fx /= fl;
      fy /= fl;
      const sgn = l.at <= 2 ? -1 : 1;
      if (this.onBack) {
        // (from above: the elbows and knees stick out sideways, a little
        // back at the front and forward at the back, like a gecko on glass)
        const side = l.near ? 1 : -1;
        const k = U.ikToward(h.x, h.y, leg.foot.x, leg.foot.y, leg.l1 * 0.77, leg.l2 * 0.77, -fy * side * 0.9 + fx * sgn * 0.3, fx * side * 0.9 + fy * sgn * 0.3);
        return { kx: k.kx, ky: k.ky, ex: k.ex, ey: k.ey };
      }
      const k = U.ikToward(h.x, h.y, leg.foot.x, leg.foot.y, leg.l1, leg.l2, fx * sgn, fy * sgn);
      // limit how far the joint sticks out from the hip-foot line
      const mx = (h.x + k.ex) / 2;
      const my = (h.y + k.ey) / 2;
      let ox = k.kx - mx;
      let oy = k.ky - my;
      const ol = Math.hypot(ox, oy);
      const maxOff = 7 * L;
      if (ol > maxOff) {
        ox *= maxOff / ol;
        oy *= maxOff / ol;
      }
      let kx = mx + ox;
      let ky = my + oy;
      // never above the centreline: push it down toward the surface
      const up = (kx - h.x) * this.ux + (ky - h.y) * this.uy;
      if (up > -1.5 * L) {
        kx -= this.ux * (up + 1.5 * L);
        ky -= this.uy * (up + 1.5 * L);
      }
      return { kx, ky, ex: k.ex, ey: k.ey };
    }

    drawLeg(ctx, l, px) {
      const P = this.spine.pts;
      const h = P[l.at];
      const leg = l.leg;
      const k = this.legJoint(l);
      const L = this.L;
      // near-black legs; only the feet carry the species colour
      const base = this.p.camouflage ? this.bodyColor : U.scale(this.bodyColor, l.near ? 1.6 : 1);
      const body = U.rgba(base);
      const foot = U.rgba(this.p.camouflage ? U.scale(this.bodyColor, 0.85) : this.headColor);
      ctx.fillStyle = body;
      U.taperPath(ctx, [{ x: h.x, y: h.y }, { x: k.kx, y: k.ky }], [4.6 * L, 3.2 * L]);
      ctx.fill();
      U.taperPath(ctx, [{ x: k.kx, y: k.ky }, { x: k.ex, y: k.ey }], [3.2 * L, 2.2 * L]);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(k.kx, k.ky, 3.2 * L, 0, U.TAU);
      ctx.fill();
      // three chunky toes, splayed forward along the surface; curled in the air
      const nx = leg.planted || leg.stepping ? leg.n.x : this.ux;
      const ny = leg.planted || leg.stepping ? leg.n.y : this.uy;
      // forward along the surface = body heading projected onto the surface
      const a = P[l.at - 1];
      const b = P[l.at + 1];
      const d = (a.x - b.x) * -ny + (a.y - b.y) * nx;
      const sx = -ny * Math.sign(d || 1);
      const sy = nx * Math.sign(d || 1);
      const curl = leg.stepping ? 0.55 : leg.planted ? 1 : 0.5;
      // four splayed toes, each a pointed wedge
      ctx.fillStyle = foot;
      ctx.beginPath();
      ctx.arc(k.ex, k.ey, Math.max(px, 1.6 * L), 0, U.TAU);
      ctx.fill();
      const half = Math.max(px, 1.3 * L);
      for (const s of [-0.6, 0.1, 0.7, 1.3]) {
        const len = 5.8 * L * curl;
        const tx = k.ex + sx * s * len + nx * (s < 0 ? 1 : 0.3) * L;
        const ty = k.ey + sy * s * len + ny * (s < 0 ? 1 : 0.3) * L;
        const dx = tx - k.ex;
        const dy = ty - k.ey;
        const dl = Math.hypot(dx, dy) || 1;
        ctx.beginPath();
        ctx.moveTo(k.ex - (dy / dl) * half, k.ey + (dx / dl) * half);
        ctx.lineTo(k.ex + (dy / dl) * half, k.ey - (dx / dl) * half);
        ctx.lineTo(tx, ty);
        ctx.fill();
      }
    }

    // Head-local art coordinates -> world, mirroring drawHead's transform.
    headToWorld(x, y) {
      const hd = this.spine.pts[0];
      const L = this.L * 1.3;
      const a = this.headAng;
      const flip = Math.sin(a) * this.ux - Math.cos(a) * this.uy < 0 ? -1 : 1;
      const lx = (x - 3) * L;
      const ly = (y + 1.6) * L * flip;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return [hd.x + lx * c - ly * s, hd.y + lx * s + ly * c];
    }
    // The open gape between the jaws (world points), or null when shut.
    mouthWedge() {
      const jawA = this.jaw * 0.95;
      if (jawA <= 0.04) return null;
      const c = Math.cos(jawA);
      const s = Math.sin(jawA);
      const lx = -4 + 20.4 * c;
      const ly = 0.5 + 20.4 * s;
      return [this.headToWorld(-4, 0.5), this.headToWorld(16.4, 0.5), this.headToWorld(lx, ly)];
    }

    // Big boxy head, flat colour, black tooth marks along the mouth line and
    // a black eye: the Rain World lizard face.
    drawHead(ctx, px) {
      const hd = this.spine.pts[0];
      const L = this.L * 1.3 * (this.p.headScale || 1);
      const a = this.headAng;
      const col = U.rgba(this.headColor);
      const jawCol = U.rgba(U.scale(this.headColor, 0.55));
      const ink = '#0a0608';
      ctx.save();
      ctx.translate(hd.x, hd.y);
      ctx.rotate(a);
      const topX = Math.sin(a);
      const topY = -Math.cos(a);
      if (topX * this.ux + topY * this.uy < 0) ctx.scale(1, -1);
      ctx.scale(L, L);
      // centre the skull+jaw on the spine so the head continues the neck
      // line (as in the game) instead of perching on top of it
      ctx.translate(-3, 1.6);
      const u = px / L; // one art pixel in head-local units
      const jawA = this.jaw * 0.95;
      const c = Math.cos(jawA);
      const s = Math.sin(jawA);
      const rot = (x, y) => [-4 + (x + 4) * c - (y - 0.5) * s, 0.5 + (x + 4) * s + (y - 0.5) * c];

      if (this.tongue > 0) {
        const ext = Math.sin(Math.PI * this.tongue) * 12;
        ctx.strokeStyle = '#e0405f';
        ctx.lineWidth = Math.max(u, 0.9);
        ctx.beginPath();
        ctx.moveTo(13, 1);
        ctx.lineTo(17 + ext, 1 + Math.sin(this.age * 40) * 0.6);
        ctx.lineTo(18.5 + ext, -0.3);
        ctx.moveTo(17 + ext, 1);
        ctx.lineTo(18.5 + ext, 2.3);
        ctx.stroke();
      }

      // a yellow lizard's antennae (the pack's signal): the far one behind
      // the skull, the near one over it
      if (this.p.antennae) this.drawAntenna(ctx, u, 1);
      // lower jaw
      ctx.fillStyle = jawCol;
      ctx.beginPath();
      // flat-bottomed lower jaw with a rounded front corner
      [[-5, 0.5], [16.2, 0.5], [16.2, 2.6], [15.2, 4], [-4.5, 4.4]].forEach((pt, i) => {
        const r = rot(pt[0], pt[1]);
        if (i) ctx.lineTo(r[0], r[1]);
        else ctx.moveTo(r[0], r[1]);
      });
      ctx.closePath();
      ctx.fill();
      // upper skull: flat top, blunt snout, rounded back
      ctx.fillStyle = col;
      ctx.beginPath();
      // short boxy skull: flat top and a blunt, rounded snout
      ctx.moveTo(-5.5, 0.6);
      ctx.lineTo(-7, -2.2);
      ctx.lineTo(-5.8, -5.6);
      ctx.lineTo(-2, -6.6);
      ctx.lineTo(10, -6.4);
      ctx.quadraticCurveTo(16.6, -6.2, 16.6, -1.6);
      ctx.lineTo(16.6, 0.6);
      ctx.closePath();
      ctx.fill();

      // a blue lizard's frilled crest: a few ragged spikes along the top of
      // the skull, raised with the rest of its frills
      if (this.p.crest) {
        ctx.fillStyle = col;
        const lift = 1 + (this.raiseS || 0) * 0.5;
        ctx.beginPath();
        [[-5.5, 4.4, -1], [-2.6, 6, -0.8], [0.4, 5.2, -0.7], [3.4, 4, -0.6], [6.2, 2.6, -0.5]].forEach(([x, h, lean]) => {
          ctx.moveTo(x - 1.3, -6.2);
          ctx.lineTo(x + 1.3, -6.4);
          ctx.lineTo(x + lean * h * lift, -6.4 - h * lift);
        });
        ctx.fill();
      }
      if (this.p.antennae) this.drawAntenna(ctx, u, 0);
      // a white lizard's nose feelers: four fine feelers fanned off the
      // snout like a mole's, from up to a little down, each twitching to
      // its own beat
      if (this.species === 'lizard_white') {
        ctx.strokeStyle = col; // (the head's own colour)
        ctx.lineWidth = Math.max(u, 0.55);
        ctx.beginPath();
        [[-1.05, 6.5, -4.2], [-0.55, 7.5, -3.2], [-0.05, 7, -2.2], [0.45, 5.5, -1.2]].forEach(([ang, len, oy], k) => {
          const w = Math.sin(this.age * (5 + k * 0.9) + k * 2.1) * 0.12;
          const a0 = ang + w;
          const x1 = 16.4 + Math.cos(a0) * len;
          const y1 = oy + Math.sin(a0) * len;
          // (each bowed a little, curling up at the tip)
          const mx = 16.4 + Math.cos(a0 + 0.25) * len * 0.55;
          const my = oy + Math.sin(a0 + 0.25) * len * 0.55;
          ctx.moveTo(16.2, oy);
          ctx.quadraticCurveTo(mx, my, x1, y1);
        });
        ctx.stroke();
        // a bead at the tip of the snout they spring from
        ctx.fillStyle = col;
        ctx.fillRect(15.8, -4.4, Math.max(u * 1.6, 1.4), 3.4);
      }

      // tooth marks: small irregular black ticks on the upper jaw along the
      // mouth line (gap at the snout tip); lower ones only show when it gapes
      const toothW = Math.max(u * 1.5, 1);
      const step = Math.max(2.6 * u, 2.4);
      ctx.fillStyle = ink;
      let k = 0;
      for (let x = 3.5; x <= 15.2; x += step, k++) {
        const th = Math.max(u * 2, 1.8) * [1, 0.65, 1.2, 0.8][k % 4];
        ctx.fillRect(x, 0.6 - th, toothW, th);
        if (jawA > 0.15) {
          const r0 = rot(x + 0.5, 0.6);
          const r1 = rot(x + 0.5, 0.6 + th * 0.8);
          ctx.fillRect(Math.min(r0[0], r1[0]), Math.min(r0[1], r1[1]), toothW, Math.abs(r1[1] - r0[1]) + 0.01);
        }
      }
      // dark line under the jaw
      ctx.fillStyle = ink;
      {
        const r0 = rot(-4, 4.3);
        const r1 = rot(15.2, 4);
        ctx.beginPath();
        ctx.moveTo(r0[0], r0[1]);
        ctx.lineTo(r1[0], r1[1]);
        ctx.lineTo(r1[0], r1[1] + Math.max(u, 0.8));
        ctx.lineTo(r0[0], r0[1] + Math.max(u, 0.8));
        ctx.fill();
      }
      // eye: a black dot at the top-back of the skull; narrows when hissing
      ctx.fillStyle = ink;
      const open = this.blink > 0 ? 0.35 : this.noticeT > 0 ? 1.3 : 1 - Math.min(0.5, this.jaw * 0.6);
      const es = Math.max(u * 2, 2.8);
      const eh = Math.max(u, es * open);
      if (this.corpse) {
        // dead: an X for an eye
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(u, 0.9);
        ctx.beginPath();
        ctx.moveTo(4, -6);
        ctx.lineTo(4 + es + 0.6, -6 + es + 0.6);
        ctx.moveTo(4 + es + 0.6, -6);
        ctx.lineTo(4, -6 + es + 0.6);
        ctx.stroke();
      } else ctx.fillRect(4, -5.4 + (es - eh) / 2, es, eh);
      if (open > 0.5 && !this.corpse) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(4, -5.4 + (es - eh) / 2, Math.max(u, 0.6), Math.max(u, 0.6));
        ctx.fillStyle = ink;
      }
      // nostril
      ctx.fillRect(14.6, -4.4, Math.max(u, 0.9), Math.max(u, 0.9));
      ctx.restore();
    }
    // One antenna (head-local units; far: 1 for the one behind the skull):
    // jointed segments sprung on the head, so they lag and flop as it turns
    // and bobs, and sway a little at rest.
    drawAntenna(ctx, u, far) {
      // (the spring, stepped once a frame: on the near one's turn)
      if (!far) {
        const now = this.age;
        const dt = U.clamp(now - (this.antT === undefined ? now : this.antT), 0, 0.05);
        this.antT = now;
        const ha = this.headAng;
        const dA = this.antHA === undefined ? 0 : Math.atan2(Math.sin(ha - this.antHA), Math.cos(ha - this.antHA));
        this.antHA = ha;
        const hp = this.spine.pts[0];
        const vy = this.antHY === undefined || dt <= 0 ? 0 : (hp.y - this.antHY) / dt;
        this.antHY = hp.y;
        const target = U.clamp(-dA * 9 + vy * 0.004, -0.9, 0.9) + Math.sin(this.age * 1.7) * 0.07;
        this.antV = (this.antV || 0) + ((target - (this.antA || 0)) * 60 - (this.antV || 0) * 6) * dt;
        this.antA = U.clamp((this.antA || 0) + this.antV * dt, -1.2, 1.2);
        // laid back along the neck, flaring up on the hunt (the pack's
        // signal), easing between the two
        const flare = this.state === 'hunt' || this.state === 'kill' ? 1 : 0;
        this.antF = (this.antF || 0) + (flare - (this.antF || 0)) * Math.min(1, dt * 4);
      }
      const bend = this.antA || 0;
      const F = this.antF || 0;
      // Not feelers: the two rearmost spines of the skull, as in the game.
      // Each sets off backward from the back of the head and curls round
      // forward into a hook, thick at the root and tapering to a point, in
      // the head's colour. On the hunt they lift and hook over further.
      const base = this.headColor;
      const col = U.rgba(far ? U.scale(base, 0.55) : base);
      let x = far ? 0.6 : -1.2;
      let y = far ? -5.4 : -5.8;
      let a = U.lerp(-2.85, -2.35, F) + (far ? 0.2 : 0); // (back, lifting when flared)
      const segs = 4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = col;
      for (let k = 0; k < segs; k++) {
        // (stiff: a little give as the head moves, mostly the curl)
        a += bend * (0.12 + k * 0.06) + (k > 0 ? U.lerp(0.42, 0.5, F) : 0);
        const len = 3.3 - k * 0.45;
        const nx = x + Math.cos(a) * len;
        const ny = y + Math.sin(a) * len;
        ctx.lineWidth = Math.max(u * 1.3, 0.85) + u * (2.4 - k * 0.75);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        x = nx;
        y = ny;
      }
      ctx.lineCap = 'butt';
    }
  }

  RW.Creatures.Lizard = Lizard;
})();
