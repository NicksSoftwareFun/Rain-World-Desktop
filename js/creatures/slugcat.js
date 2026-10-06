// Slugcats: small scavengers with platformer physics. They walk, climb poles,
// make solved jumps between ledges, forage for dangle fruit and batflies,
// flee predators, and get curious about a resting cursor.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;
  const Nav = RW.Nav;

  const GRAV = 1100;
  const R = 6.5;
  const ARM = 4.8; // upper arm and forearm length
  // Spears and rocks fly fast and only go out level-ish: within 30 degrees
  // of straight left or right. For something steeply below, a backflip out
  // over the drop gives a straight-down throw from the top of the flip;
  // for something above, get level with it first (climb, or back off).
  const SPEAR_V = 860;
  const ROCK_V = 700;
  const ARC = Math.PI / 6;
  const DOWN = 0.36; // (tan 20 degrees: how far off vertical a down-throw goes)
  const FLIP_VY = -390;
  const FLIP_T = 0.6; // seconds for the full turn
  const LEG = 5.6;

  class Slugcat extends RW.Creature {
    constructor(eco, species, x, y) {
      super(eco, species, x, y);
      const p = this.p;
      const variants = Object.entries(p.variants || { survivor: 1 });
      this.variant = U.weighted(variants) || 'survivor';
      this.color = U.hex((p.colors || {})[this.variant] || '#f1f1f4');
      this.hip = { x, y, px: x, py: y };
      this.head = { x, y: y - 11 };
      this.vx = 0;
      this.vy = 0;
      this.tail = new RW.Chain(x, y, 5, [5.2, 4.9, 4.4, 3.9, 3.4], -1, 0.3);
      this.caps = {
        walls: false,
        ceil: false,
        poles: true,
        fall: true,
        jumpX: p.jumpX || 7,
        jumpUp: p.jumpUp || 5,
        poleCost: 1.1,
        swim: 3, // (a fine swimmer, but it likes to keep dry)
        dive: true, // (and the only one that goes under)
      };
      this.grav = GRAV;
      this.pather = new RW.Pather(this, this.caps);
      this.facing = U.sign();
      this.faceS = this.facing; // the body's facing, following the head's
      this.look = 0;
      this.grounded = false;
      this.pole = null;
      this.jumping = false;
      this.walkPhase = 0;
      this.climbPhase = 0;
      this.blinkT = U.rand(1, 4);
      this.blink = 0;
      // Transitory: in through one pipe hungry, eat twice, then cross the map
      // and out through the pipe farthest from where we came in.
      this.hunger = U.rand(0.6, 0.85);
      this.meals = 0;
      this.mealKinds = { fruit: 0, meat: 0 }; // one of each, given the choice
      this.origin = null;
      this.exitDen = null;
      this.item = null;
      this.eatT = 0;
      this.restT = 0;
      this.sleeping = false;
      this.perceiveT = 0;
      this.threat = null;
      this.stuckT = 0;
      this.jumpFails = 0;
      this.crouchT = 0;
      this.lastX = x;
      this.lastY = y;
      this.pers = U.personality(); // bravery decides fight (throw) or flight
      // The hunter (the red one) lives for a fight, and eats only meat; the
      // others would rather keep out of trouble, and throw only at
      // something that's actually coming for them.
      this.fierce = this.variant === 'hunter';
      if (this.fierce) {
        this.pers.bravery = Math.max(0.85, this.pers.bravery);
        this.pers.aggression = Math.max(0.8, this.pers.aggression);
        this.scruff = Array.from({ length: 7 }, () => U.rand(0.6, 1.4)); // (its tufts, each a bit different)
      } else this.pers.bravery *= 0.55;
      this.weapon = null; // a rock or spear in the far hand (the throwing hand)
      this.offhand = null; // a second weapon, of the other kind, in the near hand
      this.armed = false; // starting weapons handed out yet?
      this.throwT = 0; // windup before a throw
      this.throwCd = 0;
      this.throwAt = null;
      this.fetch = null; // weapon we're walking over to pick up
      this.snackT = 0; // eating something skewered on a spear
      this.handPt2 = null;
      this.grabbedT = 0;
      this.lie = 0; // 0 standing .. 1 lying flat
      this.reachTo = null; // something the near hand is reaching for
      this.handPt = null;
      this.diet = ['batfly', 'centipede', 'noodlefly_infant'];
      this.threats = ['lizard_*', 'daddy', 'dropwig', 'centipede_medium', 'centipede_large', 'noodlefly'];
      this.bloodColor = '#3a1f22';
    }

    mainPoint() {
      return this.hip;
    }
    bounds() {
      const b = RW.Creature.ptsBounds([this.hip, this.head].concat(this.tail.pts), 16);
      if (this.item) b[1] -= 8;
      return b;
    }
    // Held things sit in the near hand.
    itemPoint() {
      return this.handPt || { x: this.head.x + this.facing * 4, y: this.head.y + 4 };
    }
    holdPoint() {
      return this.itemPoint();
    }
    // A predator is a threat when it's after us, or simply too close for
    // comfort (closer for the brave); a daddy's long reach counts.
    threatNear(range) {
      const hip = this.hip;
      const calm = 110 + 70 * (1 - this.pers.bravery);
      return this.nearestOf(this.threats, range, (c) => {
        if (c.holding || c.lurking || !this.canSee(c.x, c.y, range)) return false;
        const d = U.dist(c.x, c.y, hip.x, hip.y);
        return c.prey === this || c.target === this || c.lungePrey === this || d < calm || (c.species === 'daddy' && d < 230);
      });
    }
    // Running away: head for high ground if there's a route, ideally one the
    // pursuer can't follow (up a pole, onto a ledge); else just get clear.
    fleeGoal(caps, fx, fy, dist) {
      return this.escapeUp(fx, fy) || super.fleeGoal(caps, fx, fy, dist);
    }
    escapeUp(fx, fy) {
      const W = this.W;
      const m = this.hip;
      const list = Nav.validCells(W, this.caps).stand;
      const n = list.length / 2;
      if (!n) return null;
      const cands = [];
      for (let k = 0; k < 12; k++) {
        const i = Math.floor(Math.random() * n) * 2;
        const x = W.centerX(list[i]);
        const y = W.centerY(list[i + 1]);
        const dThreat = U.dist(x, y, fx, fy);
        const dMe = U.dist(x, y, m.x, m.y);
        if (y > m.y - 30 || dThreat < 120 || dMe > 450) continue;
        cands.push({ x, y, sc: (m.y - y) / 100 + dThreat / 300 - dMe / 400 + Math.random() * 0.3 });
      }
      // the tip of a pole up out of reach (balanced on: see perch)
      for (const p of W.poles) {
        const dThreat = U.dist(p.x, p.y1, fx, fy);
        const dMe = U.dist(p.x, p.y1, m.x, m.y);
        if (p.y1 > m.y - 30 || dThreat < 120 || dMe > 450 || !this.perchable(p)) continue;
        cands.push({ x: p.x, y: p.y1 + 6, sc: (m.y - p.y1) / 100 + dThreat / 300 - dMe / 400 + 0.4 + Math.random() * 0.3 });
      }
      cands.sort((a, b) => b.sc - a.sc);
      const t = this.threat;
      let fallback = null;
      for (const c of cands.slice(0, 3)) {
        const r = Nav.findPath(W, m.x, m.y, c.x, c.y, this.caps, 4000);
        if (!r || !r.complete) continue;
        if (!t || !t.caps) return c;
        const rt = Nav.findPath(W, t.x, t.y, c.x, c.y, t.caps, 3000);
        if (!rt || !rt.complete) return c; // somewhere it can't follow
        if (!fallback) fallback = c;
      }
      return fallback;
    }
    weaponPoint(w) {
      if (w && w === this.offhand) {
        // near hand; tucked against the shoulder while that hand holds food
        if (this.item || this.holding || !this.handPt) return this.shoulder();
        return this.handPt;
      }
      return this.handPt2 || { x: this.head.x - this.facing * 3, y: this.head.y + 6 };
    }
    weaponAngle(w) {
      if (w !== this.offhand && this.throwT > 0 && this.aimAng !== undefined) return this.aimAng;
      const tilt = w === this.offhand ? 0.25 : 0.45;
      return this.facing > 0 ? -tilt : Math.PI + tilt;
    }
    // Two hands, but never two of the same thing.
    hasKind(kind) {
      return (this.weapon && this.weapon.kind === kind) || (this.offhand && this.offhand.kind === kind);
    }
    canTake(w) {
      if (!w.pickable) return false;
      if (!this.weapon) return true;
      return !this.offhand && w.kind !== this.weapon.kind;
    }
    dropWeapons() {
      for (const w of [this.weapon, this.offhand]) if (w) w.drop();
      this.weapon = this.offhand = null;
    }
    // Some slugcats come out of the pipe already armed: a spear, a rock, or
    // one of each.
    armUp() {
      this.armed = true;
      const lo = this.fierce ? { spear: 0.35, rock: 0.15, both: 0.4 } : this.p.loadout || { spear: 0.3, rock: 0.25, both: 0.15 };
      const r = Math.random();
      const kinds = r < lo.spear ? ['spear'] : r < lo.spear + lo.rock ? ['rock'] : r < lo.spear + lo.rock + lo.both ? ['spear', 'rock'] : [];
      for (const kind of kinds) {
        const w = new RW.Weapon(this.eco, kind, this.hip.x, this.hip.y);
        this.eco.items.push(w);
        this.pickUpWeapon(w);
      }
    }
    remove() {
      this.dropWeapons();
      super.remove();
    }
    kill() {
      this.dropWeapons();
      if (this.item) {
        this.item.heldBy = null;
        this.item = null;
      }
      this.lie = 1;
      super.kill();
    }
    // Dead (or knocked out): a ragdoll lying on its side.
    limp(dt) {
      const hip = this.hip;
      this.vy += GRAV * dt;
      this.vx *= Math.pow(0.2, dt);
      hip.x += this.vx * dt;
      hip.y += this.vy * dt;
      const c = this.W.collideCircle(hip, R);
      this.grounded = false;
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx;
          this.vy -= vn * c.ny;
        }
        if (c.ny < -0.6) this.grounded = true;
      }
      this.pole = null;
      this.perch = null;
      this.jumping = false;
      this.lie += (1 - this.lie) * U.approach(6, dt);
      this.look += (this.facing - this.look) * U.approach(6, dt);
      this.easeBody(dt);
      this.updateHead(dt, false);
      this.updateTail(dt);
      this.updateHand();
    }
    leave() {
      for (const w of [this.weapon, this.offhand]) if (w) w.dead = true; // taken into the den
      this.weapon = this.offhand = null;
      super.leave();
    }
    layInPipe(mo) {
      this.head.x = mo.x + mo.ax * 2;
      this.head.y = mo.y + mo.ay * 2;
      this.hip.x = this.hip.px = mo.x + mo.ax * 13;
      this.hip.y = this.hip.py = mo.y + mo.ay * 13;
      let d = 13;
      this.tail.pts.forEach((q, i) => {
        if (i) d += this.tail.seg[i - 1];
        q.x = q.px = mo.x + mo.ax * d;
        q.y = q.py = mo.y + mo.ay * d;
      });
      this.handPt = this.handPt2 = null;
    }
    // Into a pipe head first, hips and tail following.
    pipeLead() {
      return this.head;
    }
    pipeMove(dx, dy) {
      const h = this.head;
      const hip = this.hip;
      h.x += dx;
      h.y += dy;
      if (this.tunnel) {
        // a shimmy side to side as it squeezes along
        const w = Math.sin((this.crawlPhase || 0) * 1.3) * 0.6;
        h.x += -dy * w * 0.2;
        h.y += dx * w * 0.2;
      }
      const d = Math.hypot(hip.x - h.x, hip.y - h.y) || 1;
      hip.x = h.x + ((hip.x - h.x) / d) * 11;
      hip.y = h.y + ((hip.y - h.y) / d) * 11;
      hip.px = hip.x;
      hip.py = hip.y;
      const P = this.tail.pts;
      P[0].x = hip.x;
      P[0].y = hip.y;
      this.tail.follow(1);
      this.handPt = this.handPt2 = null;
      return true;
    }
    carry(dx, dy) {
      this.hip.x += dx;
      this.hip.y += dy;
      this.head.x += dx;
      this.head.y += dy;
      this.tail.shift(dx, dy);
    }
    knockLoose() {
      this.perch = null;
      if (this.pole) {
        this.pole = null;
        this.jumping = false;
        this.grounded = false;
      }
      this.vy = Math.max(this.vy, 80);
    }
    onUnburrowed() {
      super.onUnburrowed();
      this.pole = null;
      this.perch = null;
      this.jumping = false;
    }
    onGrabbed() {
      this.pole = null;
      this.perch = null;
      this.jumping = false;
      if (this.holding) this.release();
      if (this.item) {
        this.item.heldBy = null;
        this.item.claimedBy = null;
        this.item = null;
      }
    }
    onReleased() {
      this.vy = -250;
      this.vx = U.rand(-120, 120);
      this.setState('flee');
    }
    onBitten(by) {
      this.vy = -320;
      this.vx = Math.sign(this.hip.x - by.x) * 220;
      this.grounded = false;
      this.pole = null;
      this.perch = null;
      this.threat = by;
      this.setState('flee');
    }

    // ---------------------------------------------------------------- AI ----
    think(dt) {
      const eco = this.eco;
      const hip = this.hip;
      const p = this.p;
      this.perceiveT -= dt;
      const perceive = this.perceiveT <= 0;
      if (perceive) this.perceiveT = 0.3;
      this.hunger = Math.min(1, this.hunger + dt / 100);
      this.ignoreFoodT = (this.ignoreFoodT || 0) - dt;
      this.ignorePlantT = (this.ignorePlantT || 0) - dt;
      this.swimTo = null;
      this.speed = p.speed || 105;
      this.sleeping = false;
      this.reachTo = null;

      if (this.snackT > 0) {
        // nibbling whatever came skewered on the spear we picked up
        this.setState('eat');
        this.pather.clear();
        this.snackT -= dt;
        if (this.snackT <= 0) {
          this.hunger = Math.max(0, this.hunger - this.snackVal);
          this.ate('meat');
          this.setState('rest');
          this.restT = U.rand(1, 3);
        }
        return;
      }

      if (this.item) {
        this.setState('eat');
        this.pather.clear();
        this.eatT += dt;
        if (this.eatT > 2.4) {
          this.item.dead = true;
          this.item = null;
          this.hunger = Math.max(0, this.hunger - 0.6);
          this.ate('fruit');
          this.eatT = 0;
          this.setState('rest');
          this.restT = U.rand(1, 3);
        }
        return;
      }
      if (this.holding) {
        if (!this.holding.corpse) this.holding.kill();
        // a batfly in hand: nibble it, then rest
        this.setState('eat');
        this.pather.clear();
        this.eatT += dt;
        if (this.eatT > 1.8) {
          eco.consume(this.holding, this);
          this.hunger = Math.max(0, this.hunger - 0.35);
          this.ate('meat');
          this.eatT = 0;
          this.setState('rest');
          this.restT = U.rand(1, 3);
        }
        return;
      }

      // A transit slugcat still runs from danger on its way out.
      const passing = this.exitDen && !this.shelterTime();
      if (this.wantsToLeave(dt) && !(passing && this.state === 'flee' && this.stateT < 3.5)) {
        if (passing && perceive) {
          const t = this.threatNear(p.vision || 260);
          if (t) {
            this.threat = t;
            if ((this.weapon || this.offhand) && this.willThrowAt(t)) this.startThrow(t);
            const g = this.fleeGoal(this.caps, t.x, t.y, 380);
            if (g) this.pather.setGoal(g.x, g.y, true);
            this.setState('flee');
            return;
          }
        }
        this.setState('leave');
        const den = passing ? this.exitDen : eco.nearestDen(hip.x, hip.y);
        if (den) {
          this.pather.setGoal(den.x, den.y);
          if (U.dist(hip.x, hip.y, den.x, den.y) < 22) this.leave();
        }
        this.speed = passing ? p.speed || 105 : p.runSpeed || 170;
        return;
      }

      if (perceive) {
        const t = this.threatNear(p.vision || 260);
        if (t) {
          this.threat = t;
          // a bite winding up right next to us: backflip up and away over it
          const tdd = U.dist(t.x, t.y, hip.x, hip.y);
          if ((t.windT > 0 || t.lungeT > 0) && tdd < 110 && (this.grounded || this.pole) && !this.flip && this.flipCd <= 0) {
            const dir = Math.sign(hip.x - t.x) || -this.facing;
            if (this.flipRoom(dir)) this.backflip(dir, dir * 150, -430);
          }
          // armed and brave enough: throw at it first, then run (the
          // hunter stands its ground instead, unless it's right on top of it)
          const td = U.dist(t.x, t.y, hip.x, hip.y);
          if (this.weapon && td < (this.fierce ? 300 : 230) && this.willThrowAt(t)) {
            this.startThrow(t);
          }
          if (this.fierce && td > 95 && this.canFight(t)) {
            this.quarry = t;
            if (this.state !== 'stalk') this.setState('stalk');
          } else if (this.state !== 'flee' || this.stateT > 1.5) {
            const g = this.fleeGoal(this.caps, t.x, t.y, 380);
            if (g) this.pather.setGoal(g.x, g.y, true);
            this.setState('flee');
          }
        }
      }
      if (this.state === 'flee') {
        this.speed = p.runSpeed || 170;
        if (this.stateT < 3.5) return;
        this.setState('wander');
      }

      // The hunter picks fights: armed, it goes after a lizard in sight,
      // keeps a throw's distance and lets fly whenever it has the shot.
      if (this.fierce && perceive && this.state !== 'stalk' && !this.item && !this.holding && this.snackT <= 0 && !this.exitDen) {
        const liz = this.nearestOf(['lizard_*'], 320, (c) => !c.corpse && !c.dead && !c.leaving && this.canFight(c) && this.canSee(c.x, c.y, 320));
        if (liz) {
          this.quarry = liz;
          this.setState('stalk');
        }
      }
      if (this.state === 'stalk') {
        const q = this.quarry;
        if (!q || q.dead || q.corpse || q.leaving || !this.canFight(q) || this.stateT > 14 || U.dist(q.x, q.y, hip.x, hip.y) > 450) {
          this.quarry = null;
          this.setState('wander');
        } else {
          const side = Math.sign(hip.x - q.x) || this.facing;
          this.pather.setGoal(q.x + side * 150, q.y);
          this.speed = p.speed || 105;
          this.lookAt = q.mainPoint ? q.mainPoint() : q;
          if (this.throwCd <= 0 && this.throwT <= 0) this.startThrow(q);
          return;
        }
      }

      // Startle at a fast cursor swipe.
      const cur = eco.cursor;
      const cfgE = eco.cfg.ecosystem;
      if (cfgE.cursorInteraction && cur.inside && cur.speed > 1300 && U.dist(cur.x, cur.y, hip.x, hip.y) < 120) {
        if (this.grounded) {
          this.vy = -300;
          this.vx = Math.sign(hip.x - cur.x) * 150;
        }
        const g = this.fleeGoal(this.caps, cur.x, cur.y, 250);
        if (g) this.pather.setGoal(g.x, g.y, true);
        this.setState('flee');
        this.stateT = 2;
        return;
      }

      // Prey knocked down by a rock: go and pick it up.
      if (perceive && this.hunger > 0.3 && this.state !== 'forage' && this.wants('meat')) {
        let downed = this.nearestOf(['batfly', 'centipede', 'noodlefly_infant'], 320, (c) => c.stunT > 0.4 && c.canBeGrabbed() && (c.size || 1) <= 1 && this.W.waterDepth(c.x, c.y) < 6);
        if (!downed) {
          // (a corpse only if we killed it: no scavenging)
          const c = this.nearestCorpse(['batfly', 'centipede', 'noodlefly_infant'], 320);
          if (c && (c.size || 1) <= 1 && c.killedBy === this) downed = c;
        }
        if (downed) {
          this.food = downed;
          this.setState('forage');
        }
      }
      if (this.state === 'forage' && this.food instanceof RW.Creature) {
        const f = this.food;
        if (f.dead || f.leaving || f.grabbedBy || !(f.stunT > 0 || f.corpse) || (f.corpse && f.killedBy !== this) || this.stateT > 12) {
          this.food = null;
          this.setState('wander');
        } else {
          this.pather.interval = 0.5;
          this.pather.setGoal(f.x, f.y - 4);
          const fd = U.dist(hip.x, hip.y, f.x, f.y);
          if (fd < 30) this.reachTo = f.mainPoint();
          if (fd < 15 && this.grab(f)) {
            this.eatT = 0;
            this.food = null;
          }
          return;
        }
      }
      // Food: fruit on the ground, or a batfly flying past.
      if (perceive && (this.hunger > 0.35 || this.state === 'forage') && this.wants('fruit')) {
        const fruit = this.findFruit(this.hunger > 0.6 ? 700 : 300);
        if (fruit) {
          this.food = fruit;
          this.setState('forage');
        }
      }
      if (this.state === 'forage') {
        const f = this.food;
        // No route to it (fruit on a window top, across a gap we can't jump):
        // give up and ignore that fruit for a while instead of standing still.
        const unreachable = f && this.pather.nodes && !this.pather.complete && this.pather.remaining() === 0 && this.stateT > 1.5;
        if (unreachable || (f && this.stateT > 20)) {
          this.ignoreFood = f;
          this.ignoreFoodT = 30;
        }
        if (!f || f.dead || f.heldBy || (f.claimedBy && f.claimedBy !== this) || this.stateT > 20 || unreachable) {
          this.food = null;
          this.setState('wander');
        } else {
          f.claimedBy = this;
          this.pather.interval = 0.7;
          this.pather.setGoal(f.x, f.y - 4);
          const fd = U.dist(hip.x, hip.y, f.x, f.y);
          if (fd < 30) this.reachTo = f;
          if (fd < 14) {
            f.heldBy = this;
            this.item = f;
            this.eatT = 0;
          }
          return;
        }
      }
      // Fruit growing under the water: swim down and pluck it.
      if (perceive && this.hunger > 0.35 && this.wants('fruit') && !this.item && (this.state === 'wander' || this.state === 'idle')) {
        let best = null;
        let bd = this.hunger > 0.6 ? 700 : 450;
        for (const pp of eco.plants) {
          if (!pp.under || !pp.ripe() || (pp.claimedBy && pp.claimedBy !== this) || (pp === this.ignorePlant && this.ignorePlantT > 0)) continue;
          const tp = pp.tip();
          const d = U.dist(tp.x, tp.y, hip.x, hip.y);
          if (d < bd) {
            bd = d;
            best = pp;
          }
        }
        if (best) {
          this.seaPlant = best;
          this.setState('dive');
        }
      }
      if (this.state === 'dive') {
        const sp = this.seaPlant;
        const unreachable = this.pather.nodes && !this.pather.complete && this.pather.remaining() === 0 && this.stateT > 2;
        if (!sp || !sp.ripe() || this.stateT > 25 || unreachable || (sp.claimedBy && sp.claimedBy !== this)) {
          if (sp && (unreachable || this.stateT > 25)) {
            this.ignorePlant = sp;
            this.ignorePlantT = 40;
          }
          this.seaPlant = null;
          this.setState('wander');
        } else {
          sp.claimedBy = this;
          const tp = sp.tip();
          this.pather.interval = 0.6;
          this.pather.setGoal(tp.x, tp.y);
          if (this.swimming && U.dist(hip.x, hip.y, tp.x, tp.y) < this.W.cell * 4) this.swimTo = tp; // (in the water and close: straight for it)
          const d = Math.min(U.dist(hip.x, hip.y, tp.x, tp.y), U.dist(this.head.x, this.head.y, tp.x, tp.y));
          if (d < 30) this.reachTo = tp;
          if (d < 14) {
            const f = sp.pluck(this);
            if (f) {
              this.item = f;
              this.eatT = 0;
            }
            this.seaPlant = null;
            this.setState('wander');
          }
          return;
        }
      }
      if (this.hunger > 0.3 && this.wants('meat')) {
        const bf = this.nearestOf(['batfly', 'noodlefly_infant'], 50, (c) => c.canBeGrabbed() && c.state !== 'cling');
        if (bf) {
          this.reachTo = bf.mainPoint();
          if (this.grounded && bf.y < hip.y) {
            this.vy = -Math.sqrt(2 * GRAV * Math.max(10, Math.min(90, hip.y - bf.y + 10)));
            this.vx = U.clamp((bf.x - hip.x) * 3, -200, 200);
            this.grounded = false;
          }
          // snatch it out of the air with a hand
          const hp = this.handPt || this.head;
          if (U.dist(hp.x, hp.y, bf.x, bf.y) < 9 || U.dist(this.head.x, this.head.y, bf.x, bf.y) < 14) {
            if (this.grab(bf)) {
              this.eatT = 0;
              this.reachTo = null;
            }
          }
        }
      }

      // Armed and hungry: knock prey out of the air, or fruit off its vine.
      if (perceive && this.weapon && this.hunger > 0.35 && this.throwCd <= 0 && !this.item && Math.random() < 0.35) {
        // (prey below the ledge we're on can be had from a backflip)
        const bf = this.wants('meat') && this.nearestOf(['batfly', 'centipede', 'noodlefly_infant'], 240, (c) => !c.grabbedBy && !(c.stunT > 0) && (c.size || 1) <= 1 && U.dist(c.x, c.y, hip.x, hip.y) > 40 && (this.canSee(c.x, c.y, 240) || c.y > hip.y + 40));
        if (bf) this.startThrow(bf);
        else if (this.wants('fruit') && !this.findFruit(500) && this.state !== 'aim') {
          // ripe fruit only comes down when something hits it (a rock's
          // best, but a spear will do); throws only go out level-ish, so
          // fruit hanging overhead means finding a spot level with it first
          const pl = this.ripePlant(hip, 300, false);
          if (this.ignorePlantT > 0) this.ignorePlantT -= 0.25;
          else this.ignorePlant = null;
          if (pl && pl !== this.ignorePlant && !this.startThrow(pl)) {
            const spot = this.throwSpot(this.aimPoint(pl));
            if (spot) {
              this.aimFor = { plant: pl, spot };
              this.setState('aim');
            } else {
              this.ignorePlant = pl; // nowhere to throw from: forget it a while
              this.ignorePlantT = 30;
            }
          }
        }
      }
      // Walking to a spot level with some fruit, to knock it down from there.
      if (this.state === 'aim') {
        const A = this.aimFor;
        const unreachable = this.pather.nodes && !this.pather.complete && this.pather.remaining() === 0 && this.stateT > 1.5;
        if (!A || !A.plant.ripe() || !this.weapon || this.stateT > 14 || unreachable) {
          if (A && (unreachable || this.stateT > 14)) {
            this.ignorePlant = A.plant;
            this.ignorePlantT = 30;
          }
          this.aimFor = null;
          this.setState('wander');
        } else {
          this.pather.interval = 0.7;
          this.pather.setGoal(A.spot.x, A.spot.y);
          if (perceive && this.throwCd <= 0 && (this.grounded || this.pole) && this.startThrow(A.plant)) {
            this.aimFor = null;
            this.setState('wander');
          }
          return;
        }
      }

      // Pick up a rock or spear (spears preferred) when empty-handed.
      if (this.state === 'fetch') {
        const w = this.fetch;
        const unreachable = this.pather.nodes && !this.pather.complete && this.pather.remaining() === 0 && this.stateT > 1.5;
        if (!w || !this.canTake(w) || this.stateT > 12 || unreachable || (w.claimedBy && w.claimedBy !== this)) {
          if (w && unreachable) {
            this.ignoreWeapon = w;
            this.ignoreWeaponT = 30;
          }
          this.fetch = null;
          this.setState('wander');
        } else {
          w.claimedBy = this;
          this.pather.interval = 0.7;
          this.pather.setGoal(w.x, w.y - 4);
          const wd = U.dist(hip.x, hip.y, w.x, w.y);
          if (wd < 30) this.reachTo = w;
          if (wd < 15) this.pickUpWeapon(w);
          return;
        }
      }
      this.ignoreWeaponT = (this.ignoreWeaponT || 0) - dt;
      // (hungry, empty-handed and ripe fruit overhead: look further afield)
      const forFruit = !this.weapon && this.hunger > 0.35 && this.wants('fruit') && !!this.ripePlant(hip, 600, false);
      if (!(this.weapon && this.offhand) && perceive && this.state === 'wander' && Math.random() < (forFruit ? 0.8 : 0.4)) {
        const w = this.findWeapon(forFruit ? 600 : 300);
        if (w) {
          this.fetch = w;
          this.setState('fetch');
          return;
        }
      }

      // Curious about a resting cursor.
      if (cfgE.cursorInteraction && cur.inside && cur.still > 0.8 && U.dist(cur.x, cur.y, hip.x, hip.y) < 320) {
        this.setState('curious');
        const below = Nav.nearestValid(this.W, cur.x, cur.y + 20, this.caps, 6);
        if (below) {
          const gx = this.W.centerX(below.cx);
          const gy = this.W.centerY(below.cy);
          if (U.dist(gx, gy, hip.x, hip.y) > 40) this.pather.setGoal(gx, gy);
          else this.pather.clear();
        }
        this.lookAt = cur;
        return;
      }
      this.lookAt = null;
      if (this.state === 'curious') this.setState('wander');

      if (this.state === 'rest') {
        this.pather.clear();
        this.restT -= dt;
        this.sleeping = this.stateT > 3 && !this.perch; // (not balanced on a pole: it looks about)
        if (this.restT <= 0) this.setState('wander');
        return;
      }
      if (this.state !== 'wander') this.setState('wander');
      const footing = this.grounded || !!this.pole;
      if (this.stuckT > 3 && footing) {
        // wedged: replan right away
        this.goalCd = 0;
        this.stateT = 99;
      }
      if (this.readyForGoal(dt, 16, footing)) {
        if (this.pather.goal && Math.random() < (this.perch ? 0.75 : 0.3) && this.grounded) {
          this.setState('rest');
          this.restT = this.perch ? U.rand(3, 8) : U.rand(3, 12);
          return;
        }
        // now and then: up a pole nearby, to balance on its tip a while
        const perch = !this.perch && Math.random() < 0.22 ? this.perchGoal(420) : null;
        if (perch) {
          this.pather.setGoal(perch.x, perch.y, true);
          this.stateT = 0;
          this.stuckT = 0;
          return;
        }
        // only meat will do (had fruit already): go where the batflies are
        const prey = this.hunger > 0.3 && !this.wants('fruit') && this.meatTarget(900);
        const near = prey && Nav.nearestValid(this.W, prey.x, prey.y + 30, this.caps, 6);
        const g = near ? { x: this.W.centerX(near.cx), y: this.W.centerY(near.cy) } : this.wanderGoal(this.caps, 550);
        if (g) this.pather.setGoal(g.x, g.y, true);
        this.stateT = 0;
        this.stuckT = 0;
      }
    }

    // Transit: the downpour sends everyone to the nearest den; otherwise a
    // slugcat leaves once it has eaten twice (or given up after a while),
    // heading for the den farthest from the one it arrived by.
    wantsToLeave(dt) {
      if (this.shelterTime()) return true;
      if (!this.origin) this.origin = this.eco.nearestDen(this.spawnX, this.spawnY) || { x: this.spawnX, y: this.spawnY };
      if (!this.exitDen && (this.meals >= 2 || this.age > 210) && !this.holding && !this.item && this.snackT <= 0) {
        const hip = this.hip;
        this.exitDen = this.eco.farthestDen(this.origin.x, this.origin.y, hip.x, hip.y, this.caps);
      }
      return !!this.exitDen;
    }
    ate(kind) {
      this.meals++;
      if (kind) this.mealKinds[kind]++;
      if (this.meals < 2) this.hunger = Math.max(this.hunger, 0.6); // still peckish
    }
    // Would we eat this kind of food now? After a fruit we want meat (and
    // after meat, fruit) as long as the map has some of the other kind. The
    // hunter only ever wants meat (two of them).
    wants(kind) {
      if (this.fierce) return kind === 'meat';
      if (!this.mealKinds[kind]) return true;
      const other = kind === 'fruit' ? 'meat' : 'fruit';
      if (this.mealKinds[other]) return true;
      return !this.foodAround(other);
    }
    foodAround(kind) {
      const eco = this.eco;
      if (kind === 'fruit') return eco.items.some((it) => it instanceof RW.Fruit && !it.dead && !it.heldBy) || eco.plants.some((p) => p.ripe());
      return eco.creatures.some((c) => (c.species === 'batfly' || c.species === 'noodlefly_infant' || (c.species === 'centipede' && (c.size || 1) <= 1)) && !c.dead && !c.leaving && !c.grabbedBy);
    }
    // Hunting for meat: the nearest small prey to head towards.
    meatTarget(range) {
      return this.nearestOf(['batfly', 'centipede', 'noodlefly_infant'], range, (c) => !c.grabbedBy && (c.size || 1) <= 1);
    }
    findWeapon(range) {
      const hip = this.hip;
      let best = null;
      let bs = range;
      const wet = this.eco.heavyRain(); // (not one lying out in heavy rain)
      for (const it of this.eco.items) {
        if (!(it instanceof RW.Weapon) || !this.canTake(it)) continue;
        if (wet && this.eco.rainOn(it.x, it.y - 8)) continue;
        if (it.claimedBy && it.claimedBy !== this) continue;
        if (this.W.waterDepth(it.x, it.y) >= 0) continue; // (one on land, not one sunk in the water)
        if (it === this.ignoreWeapon && this.ignoreWeaponT > 0) continue;
        const d = U.dist(it.x, it.y, hip.x, hip.y) - (it.kind === 'spear' ? 120 : 0) - (it.skewer && it.thrower === this && this.hunger > 0.3 ? 150 : 0);
        if (d < bs) {
          bs = d;
          best = it;
        }
      }
      return best;
    }
    pickUpWeapon(w) {
      if (w.skewer) {
        // our own catch is a snack; someone else's falls off the spear
        if (w.thrower === this) {
          this.snackT = 1.4;
          this.snackVal = w.skewer === 'centipede' ? 0.5 : 0.35;
        }
        w.skewer = null;
      }
      w.pickUp(this);
      if (!this.weapon) this.weapon = w;
      else this.offhand = w;
      this.fetch = null;
      if (this.state === 'fetch') this.setState('wander');
    }
    // Where to aim: a lizard's head for a rock (it flips them), its body
    // for a spear (the head is armoured); a fruit's stalk; else the middle.
    aimPoint(t) {
      if (t.tip && !t.spine && !t.chain) {
        const tp = t.tip();
        return { x: tp.x, y: tp.y + 5 };
      }
      if (t.spine && t.species.startsWith('lizard_')) {
        const P = t.spine.pts;
        return this.weapon && this.weapon.kind === 'spear' ? P[3] : P[0];
      }
      return t.mainPoint();
    }
    // Which of our weapons suits this target: a spear into a captor (it lets
    // go) or a red lizard (rocks don't faze them) or anything big; a rock to
    // flip other lizards, to down small prey for the taking, and for fruit.
    // A vine with ripe fruit near `from` (in clear sight, if `see`).
    ripePlant(from, range, see) {
      return this.eco.plants.find((pp) => {
        if (!pp.ripe() || pp.under) return false; // (no throwing through water)
        const tp = pp.tip();
        if (U.dist(tp.x, tp.y, from.x, from.y) > range) return false;
        return !see || this.W.lineClear(from.x, from.y - 8, tp.x, tp.y + 5);
      });
    }
    pickWeaponFor(t) {
      if (t === this.grabbedBy) return 'spear';
      if (t.tip && !t.spine && !t.chain) return 'rock';
      if (t.species && t.species.startsWith('lizard_')) return t.p && t.p.stunImmune ? 'spear' : 'rock';
      // (a rock knocks an infant noodlefly down without it crying out)
      if (t.species === 'batfly' || t.species === 'noodlefly_infant' || (t.species === 'centipede' && (t.size || 1) <= 1)) return 'rock';
      return 'spear';
    }
    // Throw at a threat? The hunter nearly always; the others only at
    // something actually coming for them, and not every time.
    willThrowAt(t) {
      if (this.fierce) return Math.random() < 0.9;
      const after = t.prey === this || t.target === this || t.lungePrey === this || t.windT > 0 || t.lungeT > 0;
      return after && Math.random() < 0.15 + 0.5 * this.pers.bravery;
    }
    // Armed for this one? (A red lizard shrugs rocks off: spears only.)
    canFight(t) {
      const want = this.pickWeaponFor(t);
      return [this.weapon, this.offhand].some((w) => w && w.kind === want);
    }
    startThrow(t) {
      if (!(this.weapon || this.offhand) || this.throwT > 0 || this.throwCd > 0 || !t || this.swimming) return false;
      // bring the right weapon to the throwing hand
      const want = this.pickWeaponFor(t);
      if (this.offhand && (!this.weapon || (this.offhand.kind === want && this.weapon.kind !== want))) {
        const w = this.weapon;
        this.weapon = this.offhand;
        this.offhand = w;
      }
      const tp = this.aimPoint(t);
      this.throwMode = null;
      if (t !== this.grabbedBy) {
        const mode = this.shot(tp);
        if (!mode) return false;
        if (mode === 'flip') return this.startBackflip(t);
        this.throwMode = mode;
      }
      this.throwAt = t;
      this.throwT = 0.16;
      this.facing = Math.sign(tp.x - this.hip.x) || this.facing;
      this.aimAng = this.throwMode === 'down' ? Math.PI / 2 : Math.atan2(tp.y - this.hip.y, tp.x - this.hip.x);
      return true;
    }
    // Can a throw reach tp from here? 'level' (within the 30 degree arc,
    // in clear sight), 'down' (in the air, it's right below), 'flip' (it's
    // steeply below: backflip out over the drop and throw from the top),
    // or null (out of the arc: get level with it, or above it).
    shot(tp) {
      const hip = this.hip;
      const from = this.shoulder();
      const dx = tp.x - from.x;
      const dy = tp.y - from.y;
      if (Math.abs(Math.atan2(dy, Math.abs(dx))) <= ARC) return this.W.lineClear(from.x, from.y, tp.x, tp.y) ? 'level' : null;
      if (dy < 40 || this.flip) return null; // (above: no throwing upward)
      if (!this.grounded && !this.pole) return Math.abs(dx) < dy * DOWN && this.W.lineClear(from.x, from.y, tp.x, tp.y) ? 'down' : null;
      const ax = hip.x + U.clamp(dx, -70, 70);
      const ay = hip.y - (FLIP_VY * FLIP_VY) / (2 * GRAV);
      if (Math.abs(tp.x - ax) > (tp.y - ay) * DOWN) return null;
      if (!this.W.lineClear(hip.x, hip.y - 10, ax, ay) || !this.W.lineClear(ax, ay, tp.x, tp.y)) return null;
      return 'flip';
    }
    // Spring up and back over, heading out above the target, and throw
    // straight down at the top of the jump (see update).
    startBackflip(t) {
      const dx = U.clamp(this.aimPoint(t).x - this.hip.x, -70, 70);
      this.backflip(Math.sign(dx) || this.facing, dx / (-FLIP_VY / GRAV), FLIP_VY, t);
      this.throwCd = 0.6; // (nothing else thrown meanwhile)
      return true;
    }
    // A backflip: a high jump back the other way, turning over once, head
    // first in the direction of travel. Faster than skidding to a stop and
    // turning round, so it's also how a slugcat doubles back at a run or
    // dodges a lunge (the strike passes underneath). With a target, a
    // spear goes straight down from the top of it.
    backflip(dir, vx, vy, target) {
      this.flip = { t: 0, target: target || null, thrown: !target, dir, ang: 0 };
      this.flipCd = 1.2;
      this.pole = null;
      this.perch = null;
      this.grounded = false;
      this.jumping = true;
      this.jumpTarget = null;
      this.crouchT = 0;
      this.pendingJump = null;
      this.vy = vy;
      this.vx = vx;
      this.facing = -dir; // still facing the way we were going, flipping back over
      this.faceS = -dir;
    }
    // Room overhead (and behind) for a backflip toward dir?
    flipRoom(dir) {
      const hip = this.hip;
      return this.W.lineClear(hip.x, hip.y - 8, hip.x + dir * 30, hip.y - 85) && this.W.lineClear(hip.x + dir * 30, hip.y - 85, hip.x + dir * 70, hip.y - 40);
    }
    releaseThrow() {
      const w = this.weapon;
      const t = this.throwAt;
      this.throwAt = null;
      if (!w || !t || t.dead || t.leaving) return;
      const from = this.handPt2 || this.shoulder();
      w.x = from.x;
      w.y = from.y;
      w.thrower = this;
      this.weapon = this.offhand; // the other hand's weapon is next
      this.offhand = null;
      this.throwCd = 1;
      if (t === this.grabbedBy) {
        // point blank into whatever has hold of us
        const parts = t.hitParts();
        let k = parts.findIndex((pp) => pp.part === (w.kind === 'spear' ? 'body' : 'head'));
        if (k < 0) k = 0;
        w.state = 'flying';
        w.vx = (parts[k].x - from.x) * 4;
        w.vy = (parts[k].y - from.y) * 4;
        w.strike(t, k, parts[k].part);
        return;
      }
      let tp = this.aimPoint(t);
      const V = w.kind === 'spear' ? SPEAR_V : ROCK_V;
      const g = w.kind === 'spear' ? 260 : 900;
      let tt = U.dist(from.x, from.y, tp.x, tp.y) / V;
      if (typeof t.vx === 'number' && typeof t.vy === 'number') tp = { x: tp.x + t.vx * tt * 0.7, y: tp.y + t.vy * tt * 0.7 };
      tt = U.dist(from.x, from.y, tp.x, tp.y) / V;
      let a;
      if (this.throwMode === 'down') {
        // straight down, give or take a little
        a = U.clamp(Math.atan2(tp.y - from.y, tp.x - from.x), Math.PI / 2 - Math.atan(DOWN), Math.PI / 2 + Math.atan(DOWN));
      } else {
        // level-ish only, aimed a touch high for the drop
        const dir = Math.sign(tp.x - from.x) || this.facing;
        const e = U.clamp(Math.atan2(tp.y - 0.5 * g * tt * tt - from.y, Math.abs(tp.x - from.x)), -ARC, ARC);
        a = dir > 0 ? e : Math.PI - e;
      }
      this.throwMode = null;
      w.throwAt(Math.cos(a) * V, Math.sin(a) * V, this);
  }
    // Somewhere to throw at tp from: a spot we can stand (or cling to a
    // pole) level enough with it to be in the arc, in clear sight, not too
    // close or far. The nearest to us, or null.
    throwSpot(tp) {
      const W = this.W;
      const hip = this.hip;
      const cx0 = W.cellX(tp.x);
      const cy0 = W.cellY(tp.y);
      const reach = Math.ceil(240 / W.cell);
      let best = null;
      let bd = Infinity;
      for (let cy = cy0 - 2; cy <= cy0 + Math.ceil(130 / W.cell); cy++) {
        for (let cx = cx0 - reach; cx <= cx0 + reach; cx++) {
          if (!W.inBounds(cx, cy) || !Nav.valid(W, cx, cy, this.caps)) continue;
          if (!Nav.standable(W, cx, cy, this.caps) && !W.pole(cx, cy)) continue;
          const x = W.centerX(cx);
          const y = W.centerY(cy) - 8; // (about shoulder height)
          const dx = Math.abs(tp.x - x);
          if (dx < 70 || dx > 240) continue;
          if (Math.abs(Math.atan2(tp.y - y, dx)) > ARC * 0.85) continue;
          const d = U.dist2(x, y, hip.x, hip.y);
          if (d >= bd || !W.lineClear(x, y, tp.x, tp.y)) continue;
          bd = d;
          best = { x, y: y + 8 };
        }
      }
      return best;
    }

    findFruit(range) {
      let best = null;
      let bd = range * range;
      for (const it of this.eco.items) {
        if (!(it instanceof RW.Fruit)) continue;
        if (it.dead || it.heldBy || (it.claimedBy && it.claimedBy !== this)) continue;
        if (it === this.ignoreFood && this.ignoreFoodT > 0) continue;
        if (this.W.waterDepth(it.x, it.y) > 6) continue; // (on land, or floating; never down under)
        const d = U.dist2(it.x, it.y, this.hip.x, this.hip.y);
        if (d < bd) {
          bd = d;
          best = it;
        }
      }
      return best;
    }

    // --------------------------------------------------------- physics ----
    // The top of a pole near enough to balance on, if any.
    perchGoal(range) {
      const hip = this.hip;
      const W = this.W;
      const opts = W.poles.filter((p) => p.y2 - p.y1 > W.cell * 2 && U.dist(p.x, p.y1, hip.x, hip.y) < range && this.perchable(p) && !(W.hasWater && W.hasWater() && W.waterDepth(p.x, p.y1 + 6) >= 0));
      if (!opts.length) return null;
      const p = opts[Math.floor(Math.random() * opts.length)];
      return { x: p.x, y: p.y1 + 6 };
    }
    // A pole with open air over its tip, to balance on (not one hung from
    // a ceiling)
    perchable(pole) {
      const W = this.W;
      return !W.isSolidPt(pole.x, pole.y1 - 6) && !W.isSolidPt(pole.x, pole.y1 - 26) && !W.isSolidPt(pole.x - 7, pole.y1 - 14) && !W.isSolidPt(pole.x + 7, pole.y1 - 14);
    }
    findPole(x, y) {
      for (const p of this.W.poles) {
        if (Math.abs(p.x - x) < 11 && y > p.y1 - 4 && y < p.y2 && !this.W.isSolidPt(p.x, y)) return p;
      }
      return null;
    }

    // Would a jump to `node` peaking `apex` cells above the higher end pass
    // clear of the rock all the way (body and head)?
    arcClear(node, apex) {
      const W = this.W;
      const hip = this.hip;
      const onPoleTarget = W.pole(node.cx, node.cy) && !W.solid(node.cx, node.cy + 1);
      const tx = node.x;
      const ty = onPoleTarget ? node.y : node.y + W.cell / 2 - R - 1;
      const ay = Math.min(hip.y, ty) - W.cell * apex;
      // a parabola through start, apex and end, sampled
      const tUp = Math.sqrt((2 * Math.max(4, hip.y - ay)) / GRAV);
      const tDown = Math.sqrt((2 * Math.max(1, ty - ay)) / GRAV);
      const T = tUp + tDown;
      const vy0 = -GRAV * tUp;
      const vx = (tx - hip.x) / T;
      for (let i = 1; i < 16; i++) {
        const t = (i / 16) * T;
        const x = hip.x + vx * t;
        const y = hip.y + vy0 * t + 0.5 * GRAV * t * t;
        if (W.isSolidPt(x, y) || W.isSolidPt(x - 5, y) || W.isSolidPt(x + 5, y) || W.isSolidPt(x + Math.sign(vx) * 12, y - 4) || W.isSolidPt(x, y - 9)) return false;
      }
      return true;
    }
    launch(node) {
      const W = this.W;
      const hip = this.hip;
      const onPoleTarget = W.pole(node.cx, node.cy) && !W.solid(node.cx, node.cy + 1);
      const tx = node.x;
      const ty = onPoleTarget ? node.y : node.y + W.cell / 2 - R - 1;
      // a long leap from lying flat is a low, flat pounce; a hop arcs higher
      this.longLeap = !!this.longJump;
      this.longJump = false;
      const apexY = Math.min(hip.y, ty) - W.cell * (this.longLeap ? 0.6 : 1.3);
      const vy0 = -Math.sqrt(2 * GRAV * Math.max(4, hip.y - apexY));
      const tUp = -vy0 / GRAV;
      const tDown = Math.sqrt((2 * Math.max(1, ty - apexY)) / GRAV);
      this.vx = (tx - hip.x) / (tUp + tDown);
      this.vy = vy0;
      this.jumpTarget = { x: tx, y: ty };
      this.jumping = true;
      this.grounded = false;
      this.pole = null;
      this.perch = null;
      this.facing = Math.sign(this.vx) || this.facing;
    }

    update(dt) {
      if (!this.tick(dt)) return;
      const W = this.W;
      const hip = this.hip;

      this.throwCd -= dt;
      this.flipCd = (this.flipCd || 0) - dt;
      if (this.throwT > 0) {
        this.throwT -= dt;
        if (this.throwT <= 0) this.releaseThrow();
      }
      if (this.grabbedBy) {
        // caught: a held rock or spear goes straight into the captor
        this.grabbedT += dt;
        if ((this.weapon || this.offhand) && this.grabbedT > 0.35 && this.throwT <= 0 && !this.grabbedBy.isHand) this.startThrow(this.grabbedBy);
        const hp = this.grabbedBy.holdPoint();
        hip.x = hp.x;
        hip.y = hp.y;
        this.vx = this.vy = 0;
        this.updateHead(dt, true);
        this.updateTail(dt);
        this.lie = 0;
        this.updateHand();
        this.struggle(dt); // escaping triggers onReleased via the holder
        return;
      }

      this.grabbedT = 0;
      this.think(dt);
      // snatch up a weapon lying right underfoot
      if (!this.armed) this.armUp();
      if (!(this.weapon && this.offhand) && !this.item && !this.holding && this.state !== 'eat') {
        for (const it of this.eco.items) {
          const reach = this.state === 'flee' ? 20 : 12; // grab one on the run
          if (it instanceof RW.Weapon && this.canTake(it) && (!it.claimedBy || it.claimedBy === this) && U.dist(it.x, it.y, hip.x, hip.y) < reach) {
            this.pickUpWeapon(it);
            break;
          }
        }
      }
      this.pather.update(dt, hip.x, hip.y);
      const cell = W.cell;
      this.pather.advance(hip.x, hip.y, cell * 0.65);
      const node = this.pather.current();
      const prev = this.pather.previous();
      const speed = this.speed || 105;

      this.scrambleCd = (this.scrambleCd || 0) - dt;
      // jammed against a corner on the way to the next cell: clamber round it
      if ((this.grounded || this.pole) && !this.jumping && !(this.crouchT > 0) && this.state !== 'eat') this.noteProgress(dt, hip);
      if (this.swimCheck(dt)) {
        this.swim(dt, node);
      } else if (this.scramble) {
        // hauling up over a ledge lip, hands on the edge
        const lip = this.scramble.lip;
        this.facing = this.scramble.side;
        const res = this.stepScramble(dt, hip);
        this.reachTo = res ? null : { x: lip.x + this.facing * 3, y: lip.y - 1 };
        if (res === 'slip') {
          // lost the edge: catch the pole again and slide down a little
          const pole = this.findPole(hip.x, hip.y);
          if (pole && Math.abs(pole.x - hip.x) < W.cell) this.pole = pole;
        } else {
          hip.x += this.vx * dt;
          hip.y += this.vy * dt;
        }
      } else if (this.perch) {
        // Balancing on the tip of a pole: upright, swaying a little, arms
        // out; off again down the pole, with a spring from the top, or a
        // hop to the side.
        const pole = this.perch;
        this.perchT = (this.perchT || 0) + dt;
        hip.x += (pole.x + Math.sin(this.age * 2.1) * 1.3 - hip.x) * U.approach(8, dt);
        hip.y += (pole.y1 - R - hip.y) * U.approach(10, dt);
        this.vx = 0;
        this.vy = 0;
        if (this.perchT > 1.2 && Math.random() < dt * 0.4) this.facing = -this.facing; // (looking about)
        if (node) {
          const onSamePole = Math.abs(node.x - pole.x) < cell * 0.6 && W.pole(node.cx, node.cy) && node.y > hip.y + 4;
          if (node.type === Nav.JUMP) {
            // crouch on the tip, then spring
            if (!(this.crouchT > 0)) {
              this.crouchT = 0.18;
              this.facing = Math.sign(node.x - hip.x) || this.facing;
            }
            this.crouchT -= dt;
            if (this.crouchT <= 0) {
              this.perch = null;
              this.launch(node);
            }
          } else if (onSamePole) {
            this.perch = null;
            this.pole = pole;
          } else if (Math.abs(node.x - pole.x) > cell * 0.6 || node.y < hip.y - cell) {
            // a hop off the side
            this.perch = null;
            this.vx = Math.sign(node.x - hip.x) * speed;
            this.vy = node.y < hip.y - 4 ? -300 : -120;
            this.facing = Math.sign(this.vx) || this.facing;
          }
        }
      } else if (this.pole) {
        const pole = this.pole;
        hip.x += (pole.x - hip.x) * 0.25;
        this.vx = 0;
        // at the top with nowhere further to go (or about to spring from
        // it): up onto the tip, if there's room over it
        const top = hip.y < pole.y1 + cell * 0.8;
        const prevTop = prev && node && node.type === Nav.JUMP && Math.abs(prev.x - pole.x) < cell * 0.6 && prev.y < pole.y1 + cell;
        if (top && (!node || prevTop) && this.perchable(pole)) {
          this.perch = pole;
          this.perchT = 0;
          this.pole = null;
          this.crouchT = 0;
        }
        if (!this.perch) {
          let tvy = 0;
          if (node) {
            const onSamePole = Math.abs(node.x - pole.x) < cell * 0.6 && W.pole(node.cx, node.cy);
            // (leaving the pole: up to the take-off point first, a little
            // above it, not from low down where the leap clips the corner)
            const below = prev && Math.abs(prev.x - pole.x) < cell * 0.6 && (node.type === Nav.JUMP || node.y < hip.y - 4) ? hip.y - (Math.max(pole.y1 + 3, prev.y - 3)) : 0;
            if (below > 2) {
              tvy = -(this.p.climbSpeed || 80);
              this.climbPhase += Math.abs(this.vy) * dt * 0.25;
            } else if (node.type === Nav.JUMP) {
              this.launch(node);
            } else if (onSamePole) {
              const dy = node.y - hip.y;
              tvy = Math.abs(dy) > 2 ? Math.sign(dy) * (this.p.climbSpeed || 80) : 0;
              this.climbPhase += Math.abs(this.vy) * dt * 0.25;
            } else if (this.cornerAhead(hip)) {
              // the ledge right beside the pole: scramble up over the lip
              // (after a slip, hang on a moment before trying again)
              if (this.scrambleCd <= 0) {
                this.startScramble(this.cornerAhead(hip), hip, R + 1, R + 1, 0.8);
                this.pole = null;
              }
            } else {
              // Step or drop off the pole toward the next node.
              this.pole = null;
              this.vx = Math.sign(node.x - hip.x) * speed;
              this.vy = node.y < hip.y - 4 ? -260 : -60;
              this.facing = Math.sign(this.vx) || this.facing;
            }
          }
          if (this.pole) {
            this.vy += (tvy - this.vy) * U.approach(10, dt); // ease into and out of climbing
            hip.y = U.clamp(hip.y + this.vy * dt, pole.y1 + 2, pole.y2);
            // reached the ground at the foot of the pole (but not while
            // setting off upward from it: the climb eases in from a standstill)
            if (tvy >= 0 && W.isSolidPt(hip.x, hip.y + R)) {
              this.pole = null;
              this.grounded = true;
            }
          }
        }
      } else {
        this.vy += GRAV * dt;
        if (this.grounded && this.crouchT > 0) {
          const pj = this.pendingJump;
          if (pj && !(node && node.cx === pj.cx && node.cy === pj.cy)) {
            // the plan changed mid-windup: get up instead of leaping
            this.crouchT = 0;
            this.pendingJump = null;
            this.longJump = false;
          }
          this.crouchT -= dt;
          this.vx *= 0.6;
          if (this.longJump && this.lie > 0.7) hip.x += Math.sin(this.age * 42) * 0.45; // a rump wiggle before the pounce
          if (this.crouchT <= 0 && this.pendingJump) {
            this.launch(this.pendingJump);
            this.pendingJump = null;
          }
        }
        if (this.grounded) {
          let want = 0;
          if (node) {
            const launchHere = !prev || Math.abs(prev.x - hip.x) < 9;
            if (node.type === Nav.JUMP && launchHere) {
              // crouch for a moment, then spring
              if (!(this.crouchT > 0) && !this.jumping) {
                // a long, flat leap across a gap: lie down, wind up, then
                // pounce; anything shorter is a quick crouch and spring
                // (only if the low, flat arc itself is clear: the path was
                // checked for a hop's higher one)
                const long = Math.abs(node.x - hip.x) >= W.cell * 4 && node.y > hip.y - W.cell * 1.5 && this.arcClear(node, 0.6);
                this.longJump = long;
                this.crouchT = long ? 0.6 : 0.1;
                this.pendingJump = node;
                this.facing = Math.sign(node.x - hip.x) || this.facing;
              }
            } else {
              const tx = node.type === Nav.JUMP && prev ? prev.x : node.x;
              const dx = tx - hip.x;
              want = Math.abs(dx) > 3 ? Math.sign(dx) * speed * Math.min(1, Math.abs(dx) / 20 + 0.3) : 0;
              // Climbing onto a pole or a one-cell step.
              if (node.type === Nav.WALK && node.y < hip.y - cell * 0.6 && Math.abs(node.x - hip.x) < cell * 1.1) {
                const pole = this.findPole(node.x, node.y);
                if (pole && Math.abs(pole.x - hip.x) < 12) this.pole = pole;
                else if (!pole && !this.jumping) {
                  this.vy = -330;
                  this.grounded = false;
                }
              }
            }
          }
          // Running one way and the path turns back: a backflip beats
          // skidding round (always when fleeing; some slugcats just like to)
          if (this.flipper === undefined) this.flipper = Math.random() < 0.6;
          if (want && !this.flip && !this.jumping && this.flipCd <= 0 && Math.sign(want) !== Math.sign(this.vx) && Math.abs(this.vx) > 80 && node && node.type === Nav.WALK && Math.abs(node.y - hip.y) < cell && Math.abs(node.x - hip.x) > 50 && (this.state === 'flee' || this.flipper) && this.flipRoom(Math.sign(want))) {
            this.backflip(Math.sign(want), Math.sign(want) * 150, -430);
          }
          if (!this.jumping && this.grounded) this.vx += (want - this.vx) * U.approach(12, dt);
          if (Math.abs(this.vx) > 5) this.facing = Math.sign(this.vx);
          this.walkPhase += Math.abs(this.vx) * dt * 0.22;
        } else if (!this.jumping && node) {
          const dx = node.x - hip.x;
          this.vx += (U.clamp(dx * 3, -speed, speed) - this.vx) * U.approach(2, dt);
        }
        // Catch a pole on the way past if the path wants one.
        if (!this.grounded && !(this.flip && this.flip.target) && node && W.pole(node.cx, node.cy) && this.vy > -150) {
          const pole = this.findPole(hip.x, hip.y);
          if (pole && Math.abs(node.x - pole.x) < cell) {
            this.pole = pole;
            this.jumping = false;
          }
        }
        if (!this.pole) {
          hip.x += this.vx * dt;
          hip.y += this.vy * dt;
        }
      }

      const c = W.collideCircle(hip, R);
      const wasGrounded = this.grounded;
      this.grounded = false;
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx;
          this.vy -= vn * c.ny;
        }
        if (c.ny < -0.6) {
          this.grounded = true;
          this.contactId = c.id;
          if (this.jumping) {
            this.jumping = false;
            // landed well short of where we aimed: after two misses, give up
            const jt = this.jumpTarget;
            if (jt && U.dist(hip.x, hip.y, jt.x, jt.y) > W.cell * 1.5) {
              if (++this.jumpFails >= 2) {
                this.jumpFails = 0;
                this.pather.clear();
                this.stateT = 99;
              }
            } else {
              this.jumpFails = 0;
            }
          }
          if (!wasGrounded) this.pather.timer = Math.min(this.pather.timer, 0.1);
        }
      }
      if (this.pole) this.grounded = false;
      if (this.perch) {
        this.grounded = true; // (standing, on the tip)
        this.jumping = false;
      }

      // The backflip: the body turns over once; at the top of the jump the
      // spear goes straight down.
      if (this.flip) {
        const F = this.flip;
        F.t += dt;
        const k = U.clamp(F.t / FLIP_T, 0, 1);
        F.ang = F.dir * U.TAU * k * k * (3 - 2 * k); // head goes back (the way we're flying) first
        if (!F.thrown && this.vy > -40) {
          F.thrown = true;
          this.throwMode = 'down';
          this.throwAt = F.target;
          this.aimAng = Math.PI / 2;
          this.releaseThrow();
        }
        if ((F.t > 0.15 && (this.grounded || this.pole)) || F.t > 1.5) {
          this.flip = null;
          this.jumping = false;
          this.facing = F.dir; // landed facing the new way
        }
      }

      // Stuck detection
      if (U.dist(hip.x, hip.y, this.lastX, this.lastY) < 0.4 && this.pather.current()) this.stuckT += dt;
      else this.stuckT = Math.max(0, this.stuckT - dt);
      this.lastX = hip.x;
      this.lastY = hip.y;

      if (!this.jumping) this.longLeap = false;
      const windup = this.longJump && this.crouchT > 0;
      // flat for a rest or a long-jump windup; half stretched out mid-pounce
      const lieT = windup || (this.state === 'rest' && this.grounded && !this.perch && this.stateT > 1) ? 1 : this.longLeap ? 0.6 : 0;
      this.lie += (lieT - this.lie) * U.approach(lieT > this.lie ? (windup ? 14 : 2.5) : 9, dt);
      this.updateHead(dt, false);
      this.updateTail(dt);
      this.updateHand();
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.blink = 0.12;
        this.blinkT = U.rand(2, 6);
      }
      this.blink = Math.max(0, this.blink - dt);
      let lookTarget = this.vx / 120;
      if (this.lie > 0.4) lookTarget = this.facing; // lying in profile
      else if (this.reachTo) lookTarget = U.clamp((this.reachTo.x - this.head.x) / 30, -1, 1);
      else if (this.lookAt) lookTarget = U.clamp((this.lookAt.x - this.head.x) / 60, -1, 1);
      else if (this.state === 'flee' && this.threat) lookTarget = U.clamp((this.threat.x - this.head.x) / 60, -1, 1);
      this.look += (U.clamp(lookTarget, -1, 1) - this.look) * U.approach(6, dt);
      this.easeBody(dt);
    }
    // ---- water ----
    // Hips under: swimming (a pole it's climbing keeps it out).
    swimCheck(dt) {
      const W = this.W;
      if (!W.waterSim || !W.waterSim.active()) return (this.swimming = false);
      const hip = this.hip;
      this.noteWet(hip);
      const d = this.depthOf(hip);
      // (just hopped out: not swimming for a moment, unless it fell back in)
      if (this.swimCd > 0 && d < 8) {
        this.swimCd -= dt;
        return (this.swimming = false);
      }
      this.swimCd = 0;
      const was = this.swimming;
      this.swimming = d > (was ? -1 : 4) && !(this.pole && d < 14);
      if (this.swimming && !was) {
        this.pole = null;
        this.perch = null;
        this.jumping = false;
        this.flip = null;
        this.crouchT = 0;
        this.pendingJump = null;
        this.longJump = false;
        this.scramble = null;
      }
      if (this.swimming && this.state === 'rest') this.setState('wander'); // (no napping in the water)
      return this.swimming;
    }
    // Swimming like an otter: quick strokes along the surface, head up;
    // a dive straight down after something under the water, then floating
    // back up when it stops swimming (or runs short of breath). Out onto
    // the bank with a hop, or onto a pole.
    swim(dt, node) {
      const W = this.W;
      const S = W.waterSim;
      const hip = this.hip;
      const cell = W.cell;
      let surf = S.surfaceY(hip.x, hip.y);
      if (surf === null) surf = hip.y - 4;
      const sp = this.p.swimSpeed || 125;
      this.swimPh = (this.swimPh || 0) + dt * (5 + Math.hypot(this.vx, this.vy) / 30);
      let tx = hip.x;
      let ty = surf + 4;
      let dive = false;
      if (this.swimTo) {
        tx = this.swimTo.x;
        ty = this.swimTo.y;
        dive = ty > surf + cell * 0.4;
      } else if (node) {
        tx = node.x;
        const dry = !W.waterCell(node.cx, node.cy);
        if (!dry && node.y > surf + cell * 0.7) {
          ty = node.y;
          dive = true;
        }
        if (dry && node.y < surf + cell && Math.abs(node.x - hip.x) < cell * 1.5) {
          // the bank (or a pole): up and out
          const pole = this.findPole(node.x, node.y);
          this.swimming = false;
          this.swimCd = 0.5;
          if (pole && Math.abs(pole.x - hip.x) < 16) {
            this.pole = pole;
            this.vx = this.vy = 0;
            return;
          }
          this.vy = -Math.sqrt(2 * GRAV * Math.max(14, hip.y - node.y + 14));
          this.vx = U.clamp((node.x - hip.x) * 4, -150, 150);
          this.jumping = true;
          this.jumpTarget = node;
          hip.x += this.vx * dt;
          hip.y += this.vy * dt;
          return;
        }
      }
      // short of breath down there: back up for air
      const under = hip.y - surf;
      this.breath = U.clamp((this.breath === undefined ? 10 : this.breath) + (under > 8 ? -dt : dt * 4), -1, 10);
      if (this.breath <= 0) {
        dive = false;
        ty = surf + 4;
      }
      this.diving = dive;
      // strokes: a surge, then a glide
      const surge = 0.55 + 0.75 * Math.max(0, Math.sin(this.swimPh));
      const dx = tx - hip.x;
      const dy = ty - hip.y;
      let wvx;
      let wvy;
      if (dive) {
        const d = Math.hypot(dx, dy) || 1;
        wvx = (dx / d) * sp * surge;
        wvy = (dy / d) * sp * surge;
      } else {
        // floating: the water holds it at the surface
        wvx = Math.abs(dx) > 4 ? Math.sign(dx) * sp * surge * Math.min(1, Math.abs(dx) / 30 + 0.3) : 0;
        wvy = U.clamp(dy * 5, -160, 120) + Math.sin(this.swimPh * 0.5) * 6;
      }
      const k = U.approach(dive ? 5 : 4, dt);
      this.vx += (wvx - this.vx) * k;
      this.vy += (wvy - this.vy) * k;
      if (Math.abs(this.vx) > 8) this.facing = Math.sign(this.vx);
      hip.x += this.vx * dt;
      hip.y += this.vy * dt;
    }

    // Turning round, the head goes first (look) and the body comes round
    // after it: limbs, hips and tail swing over through the middle.
    easeBody(dt) {
      if (this.faceS === undefined) this.faceS = this.facing;
      this.faceS += U.clamp(this.facing - this.faceS, -3.2 * dt, 3.2 * dt);
    }
    faceSign() {
      return this.faceS >= 0 ? 1 : -1;
    }

    updateHead(dt, held) {
      const hip = this.hip;
      const h = this.head;
      let tx;
      let ty;
      if (held) {
        // dangling: a predator's catch wriggles, the player's just hangs
        tx = hip.x + (this.grabbedBy && this.grabbedBy.isHand ? 0 : Math.sin(this.age * 9) * 4);
        ty = hip.y + 9;
      } else if (this.flip && this.flip.t < FLIP_T) {
        tx = hip.x + Math.sin(this.flip.ang) * 18;
        ty = hip.y - Math.cos(this.flip.ang) * 18;
      } else if (this.swimming) {
        // stretched out along the stroke: head up out of the water at the
        // surface, leading the way in a dive
        const sp = Math.hypot(this.vx, this.vy);
        if (this.diving && sp > 20) {
          tx = hip.x + (this.vx / sp) * 17;
          ty = hip.y + (this.vy / sp) * 17;
        } else {
          tx = hip.x + this.faceS * 15;
          ty = hip.y - 8 + Math.sin(this.swimPh * 2) * 1.2;
        }
      } else if (this.crouchT > 0) {
        tx = hip.x + this.facing * 6;
        ty = hip.y - 10;
      } else if (this.perch) {
        // upright on the tip, head up, looking about
        tx = hip.x + this.facing * 3;
        ty = hip.y - 17;
      } else if (this.state === 'eat' || this.state === 'rest') {
        tx = hip.x + this.facing * 7;
        ty = hip.y - 11;
      } else if (this.pole) {
        tx = hip.x;
        ty = hip.y - 18.5;
      } else if (!this.grounded) {
        const sp = Math.hypot(this.vx, this.vy) || 1;
        tx = hip.x + (this.vx / sp) * 10 + this.facing * 2;
        ty = hip.y - 16;
      } else {
        const lean = U.clamp(this.vx / 160, -1, 1);
        tx = hip.x + this.facing * 2 + lean * 6;
        ty = hip.y - 18 + Math.abs(lean) * 2.5 + Math.sin(this.walkPhase * 2) * Math.abs(lean) * 0.8;
      }
      if (this.state === 'eat') ty += Math.sin(this.age * 14) * 0.8;
      if (this.lie > 0) {
        // chin down on the floor in front of the body
        tx = U.lerp(tx, hip.x + this.facing * 16, this.lie);
        ty = U.lerp(ty, hip.y + 1.5, this.lie);
      }
      const k = U.approach(held ? 6 : this.flip ? 60 : 22, dt);
      h.x += (tx - h.x) * k;
      h.y += (ty - h.y) * k;
      const dx = h.x - hip.x;
      const dy = h.y - hip.y;
      const d = Math.hypot(dx, dy) || 1;
      // a long body: the head sits well clear of the hips
      const L = U.lerp((this.state === 'eat' || this.state === 'rest') && !this.perch ? 13 : 18, 16, this.lie);
      h.x = hip.x + (dx / d) * L;
      h.y = hip.y + (dy / d) * L;
      this.W.collideCircle(h, 5.5);
    }

    shoulder() {
      const hip = this.hip;
      const h = this.head;
      return { x: U.lerp(hip.x, h.x, 0.42), y: U.lerp(hip.y, h.y, 0.42) + this.lie * 1.5 };
    }
    // Where the near hand actually is (after IK), so held things sit in it.
    updateHand() {
      const sh = this.shoulder();
      const hands = this.limbTargets(sh).hands;
      const k = U.ik2(sh.x, sh.y, hands[0].x, hands[0].y, ARM, ARM, -this.faceSign());
      this.handPt = { x: k.ex, y: k.ey };
      const k2 = U.ik2(sh.x, sh.y, hands[1].x, hands[1].y, ARM, ARM, -this.faceSign());
      this.handPt2 = { x: k2.ex, y: k2.ey };
    }

    updateTail(dt) {
      const T = this.tail.pts;
      T[0].x = this.hip.x - this.faceS * 1.5;
      T[0].y = this.hip.y + 2;
      T[0].px = T[0].x;
      T[0].py = T[0].y;
      if (this.swimming) {
        // swimming: streaming out behind, sculling side to side
        this.tail.verlet(1, 0.86, -this.faceS * 300, 0, dt);
        this.tail.follow(1);
        const P = this.tail.pts;
        for (let i = 1; i < P.length; i++) {
          const a = P[i - 1];
          let ax = P[i].x - a.x;
          let ay = P[i].y - a.y;
          const al = Math.hypot(ax, ay) || 1;
          const w = Math.sin((this.swimPh || 0) * 1.5 - i * 0.9) * 1.6 * (i / P.length);
          P[i].x += (-ay / al) * w;
          P[i].y += (ax / al) * w;
        }
      } else {
        this.tail.verlet(1, 0.86, -this.faceS * 520, 420, dt); // tail streams out behind
        this.tail.follow(1);
      }
      this.tail.collide(this.W, 1.5, 1);
    }

    // ------------------------------------------------------------ drawing ----
    draw(ctx) {
      const hip = this.hip;
      const h = this.head;
      const col = this.color;
      const f = this.faceS; // the body comes round after the head
      const dark = U.rgba(U.scale(col, 0.45)); // far limbs: clearly shaded so they separate
      const main = U.rgba(col);
      const lie = this.lie;
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const shoulder = this.shoulder();
      const limbs = this.limbTargets(shoulder);

      // Lying down squashes body, tail and limbs toward the floor (the head
      // keeps its shape and rests on the floor by itself).
      const floorY = hip.y + R;
      ctx.save();
      if (lie > 0.01) {
        ctx.translate(0, floorY);
        ctx.scale(1, 1 - 0.32 * lie);
        ctx.translate(0, -floorY);
      }

      // far limbs
      this.drawLimb(ctx, hip.x - f, hip.y + 2, limbs.feet[1], LEG, LEG, dark, 3, this.faceSign());
      this.drawArm(ctx, shoulder, limbs.hands[1], dark, 2);

      // tail
      const T = this.tail.pts;
      ctx.fillStyle = main;
      U.taperPath(ctx, T, [5.4, 4.6, 3.6, 2.6, 1.2]);
      ctx.fill();

      // body: one soft sack as wide as the head where they meet (no neck),
      // easing a little toward the hips and on into the tail
      const mid = { x: U.lerp(hip.x, h.x, 0.5) - f * 0.5, y: U.lerp(hip.y, h.y, 0.5) };
      U.taperPath(ctx, [{ x: hip.x, y: hip.y - 1 }, mid, h], [5.8, 6.6, 7]);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hip.x, hip.y - 1.2, 5.6 + lie * 0.4, 0, U.TAU);
      ctx.fill();

      // near leg
      this.drawLimb(ctx, hip.x + f, hip.y + 2, limbs.feet[0], LEG, LEG, main, 3.2, this.faceSign());
      ctx.restore();

      // near arm, drawn before the head so a hand never paints across the face
      // (reaching, climbing or flailing, the arm comes out in front instead)
      const armFront = !!this.reachTo || !!this.grabbedBy || !!this.pole || (!this.grounded && this.lie < 0.5);
      let hand = armFront ? null : this.drawArm(ctx, shoulder, limbs.hands[0], main, 2.2);

      // head
      this.drawHeadShape(ctx, h.x, h.y, this.look, main);
      if (armFront) hand = this.drawArm(ctx, shoulder, limbs.hands[0], main, 2.2);

      // held fruit sits in the near hand, just under the chin while eating
      if (this.item) {
        const ip = this.itemPoint();
        const left = this.state === 'eat' ? 1 - Math.min(1, this.eatT / 2.4) : 1;
        const sc = 0.4 + 0.6 * left; // shrinks as it's eaten
        ctx.save();
        ctx.translate(ip.x, ip.y - 1);
        ctx.scale(sc, sc);
        RW.drawFruit(ctx, 0, 0, 0, 1);
        ctx.restore();
        // fingers over the fruit
        ctx.fillStyle = main;
        ctx.fillRect(hand.x - 1, hand.y - 0.5, 2, 2);
      }

      // eyes: big black ovals, low and wide; in profile only the near one
      const lx = this.look;
      const ax = Math.abs(lx);
      const sep = 3.1 * (1 - 0.45 * ax);
      const ex = h.x + lx * 2.6;
      const ey = h.y + 0.9;
      ctx.fillStyle = '#0b0b10';
      const closed = this.blink > 0 || this.sleeping || (this.grabbedBy && !this.grabbedBy.isHand && Math.sin(this.age * 7) > 0);
      for (const s of [-1, 1]) {
        if (ax > 0.8 && s === -Math.sign(lx)) continue;
        if (this.corpse) {
          // dead: X'd-out eyes
          ctx.strokeStyle = '#0b0b10';
          ctx.lineWidth = 1;
          const cx = ex + s * sep;
          ctx.beginPath();
          ctx.moveTo(cx - 1.6, ey - 1.6);
          ctx.lineTo(cx + 1.6, ey + 1.6);
          ctx.moveTo(cx + 1.6, ey - 1.6);
          ctx.lineTo(cx - 1.6, ey + 1.6);
          ctx.stroke();
          continue;
        }
        ctx.beginPath();
        if (closed) ctx.ellipse(ex + s * sep, ey + 0.9, 1.7, 0.5, 0, 0, U.TAU);
        else ctx.ellipse(ex + s * sep, ey, 1.45, 2.6, 0, 0, U.TAU);
        ctx.fill();
      }
      ctx.restore();
      this.drawPath(ctx, this.pather);
      this.drawDebug(ctx);
    }

    // The slugcat head: wider than tall, flat-topped with two pointed ears at
    // the corners and full cheeks tapering to a soft chin. Turning (look) slides
    // the ears back and the face forward until it reads as a profile.
    drawHeadShape(ctx, x, y, l, fill) {
      const a = Math.abs(l);
      const w = 7.4 * (1 - 0.12 * a); // half width across the cheeks
      const sx = -l * 0.8; // skull shifts back as the face turns
      const eb = l * 2.2; // ears sweep back
      const front = l * 1.4; // and the muzzle side bulges forward
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(x + sx - l * 0.4, y - 5.6);
      ctx.lineTo(x + sx + w * 0.5, y - 5.4);
      ctx.lineTo(x + sx + w * 0.88 - eb + 0.6 * (1 - a), y - 8.4); // right ear tip
      ctx.lineTo(x + sx + w + Math.max(0, front) * 0.4, y - 3.6);
      ctx.quadraticCurveTo(x + sx + w + 0.8 + Math.max(0, front), y + 3.8, x + sx + w * 0.42 + Math.max(0, front) * 0.6, y + 5.7);
      ctx.lineTo(x + sx - w * 0.42 + Math.min(0, front) * 0.6, y + 5.7);
      ctx.quadraticCurveTo(x + sx - w - 0.8 + Math.min(0, front), y + 3.8, x + sx - w + Math.min(0, front) * 0.4, y - 3.6);
      ctx.lineTo(x + sx - w * 0.88 - eb - 0.6 * (1 - a), y - 8.4); // left ear tip
      ctx.lineTo(x + sx - w * 0.5, y - 5.4);
      ctx.closePath();
      ctx.fill();
      // the hunter's scruff: ragged tufts on the cheeks and between the ears
      if (this.scruff) {
        const k = this.scruff;
        const tuft = (bx, by, dx, dy, n) => {
          ctx.moveTo(bx - dy * 1.3, by + dx * 1.3);
          ctx.lineTo(bx + dx * n, by + dy * n);
          ctx.lineTo(bx + dy * 1.3, by - dx * 1.3);
        };
        ctx.beginPath();
        for (const sgn of [-1, 1]) {
          const cx = x + sx + sgn * (w + 0.3);
          tuft(cx, y + 0.6, sgn, -0.25, 2.6 * k[sgn < 0 ? 0 : 1]);
          tuft(cx - sgn * 0.4, y + 3.2, sgn * 0.9, 0.45, 2.2 * k[sgn < 0 ? 2 : 3]);
        }
        tuft(x + sx - 1.6 - eb * 0.3, y - 5.4, -0.35, -1, 2 * k[4]);
        tuft(x + sx + 0.4 - eb * 0.3, y - 5.6, 0.1, -1, 2.4 * k[5]);
        tuft(x + sx + 2.2 - eb * 0.3, y - 5.4, 0.45, -1, 1.8 * k[6]);
        ctx.fill();
      }
    }

    limbTargets(shoulder) {
      const hip = this.hip;
      const f = this.faceS;
      const feet = [];
      const hands = [];
      const gy = hip.y + R + 0.5;
      if (this.grabbedBy && (this.grabbedBy.isHand || this.corpse)) {
        // dangling limp from the cursor: everything just hangs
        feet.push({ x: hip.x + 2, y: hip.y + 11 }, { x: hip.x - 2, y: hip.y + 11 });
        hands.push({ x: shoulder.x + 2, y: shoulder.y + 9 }, { x: shoulder.x - 2, y: shoulder.y + 9 });
      } else if (this.grabbedBy) {
        const w = Math.sin(this.age * 12) * 4;
        feet.push({ x: hip.x + 3 + w, y: hip.y + 10 }, { x: hip.x - 3 - w, y: hip.y + 10 });
        hands.push({ x: shoulder.x + 7, y: shoulder.y - 4 - w }, { x: shoulder.x - 7, y: shoulder.y - 4 + w });
      } else if (this.tunnel) {
        // squeezing through a passage: clawing forward hand over hand, the
        // feet shoving behind
        const hd = this.head;
        let dx = hd.x - hip.x;
        let dy = hd.y - hip.y;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl;
        dy /= dl;
        const c = this.crawlPhase || 0;
        for (const k of [0, Math.PI]) {
          const s = Math.sin(c + k);
          const side = k ? -1 : 1;
          hands.push({ x: hd.x + dx * (3 + s * 4) - dy * side * 4, y: hd.y + dy * (3 + s * 4) + dx * side * 4 });
          feet.push({ x: hip.x - dx * (5 - s * 3) - dy * side * 3, y: hip.y - dy * (5 - s * 3) + dx * side * 3 });
        }
      } else if (this.swimming) {
        // swimming: the arms reach and pull in turn, the legs kick behind
        const hd = this.head;
        let dx = hd.x - hip.x;
        let dy = hd.y - hip.y;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl;
        dy /= dl;
        const c = this.swimPh || 0;
        if (this.diving && this.depthOf(hip) > 6) {
          // under water: breaststroke. Both arms shoot forward together,
          // sweep out and back to the chest (the pull is the surge), tuck in
          // and shoot forward again; the legs frog-kick in time.
          const sh = shoulder;
          const fwd = 1 + 7 * Math.cos(c);
          const out = 1.5 + 4 * Math.max(0, Math.sin(c));
          for (const side of [1, -1]) {
            hands.push({ x: sh.x + dx * fwd - dy * side * out, y: sh.y + dy * fwd + dx * side * out });
            const kick = 2 + 3.5 * Math.max(0, -Math.sin(c));
            feet.push({ x: hip.x - dx * (6 + 3 * Math.cos(c)) - dy * side * kick, y: hip.y - dy * (6 + 3 * Math.cos(c)) + dx * side * kick });
          }
        } else {
          // at the surface: paddling, the arms in turn
          for (const k of [0, Math.PI]) {
            const s = Math.sin(c + k);
            const co = Math.cos(c + k);
            const side = k ? -1 : 1;
            hands.push({ x: hd.x + dx * (1 + s * 6) - dy * (co * 3 + side), y: hd.y + dy * (1 + s * 6) + dx * (co * 3 + side) + 3 });
            feet.push({ x: hip.x - dx * (7 + s * 2) - dy * side * (2 + co * 3), y: hip.y - dy * (7 + s * 2) + dx * side * (2 + co * 3) });
          }
        }
      } else if (this.pole) {
        // hugging the pole, hand over hand
        const px = this.pole.x;
        const c = this.climbPhase;
        feet.push({ x: px + 1, y: hip.y + 8 + Math.sin(c) * 2 }, { x: px - 1, y: hip.y + 8 - Math.sin(c) * 2 });
        hands.push({ x: px + f, y: this.head.y - 3 + Math.sin(c) * 3 }, { x: px - f, y: this.head.y - 3 - Math.sin(c) * 3 });
      } else if (this.lie > 0.5) {
        // lying flat: hind legs out behind, forepaws tucked under the chin
        feet.push({ x: hip.x - f * 4, y: gy }, { x: hip.x - f * 7, y: gy });
        hands.push({ x: this.head.x - f * 0.5, y: gy - 0.5 }, { x: this.head.x - f * 3, y: gy - 0.5 });
      } else if (!this.grounded) {
        feet.push({ x: hip.x - f * 3, y: hip.y + 7 }, { x: hip.x + f * 3, y: hip.y + 6 });
        // arms flung up and out mid-jump
        hands.push({ x: shoulder.x + f * 8, y: shoulder.y - 4 }, { x: shoulder.x - f * 5, y: shoulder.y - 2 });
      } else {
        const moving = U.clamp(Math.abs(this.vx) / 60, 0, 1);
        const ph = this.walkPhase;
        for (const k of [0, Math.PI]) {
          feet.push({
            x: hip.x + Math.sin(ph + k) * 5 * moving + f * 1 + (k ? -2 : 2) * (1 - moving),
            y: gy - Math.max(0, Math.cos(ph + k)) * 3 * moving,
          });
        }
        if (this.state === 'eat') {
          // both hands bring the food up to the mouth
          const mx = this.head.x + f * 5;
          const my = this.head.y + 7 + Math.sin(this.age * 14) * 0.6;
          hands.push({ x: mx, y: my }, { x: mx - f * 2, y: my + 1 });
        } else {
          // arms swing opposite the legs, held a little out from the body
          for (const k of [Math.PI, 0]) {
            hands.push({
              x: shoulder.x + Math.sin(ph + k) * 4.5 * moving + f * (k ? 8.5 : -6),
              y: shoulder.y + 7.5 - Math.max(0, -Math.cos(ph + k)) * 2 * moving,
            });
          }
        }
      }
      // the far hand carries the weapon: held ready, drawn back over the
      // shoulder in the windup, flung forward in the follow-through
      if (!this.grabbedBy && !this.pole && this.lie < 0.5 && this.state !== 'eat') {
        if (this.throwT > 0) hands[1] = { x: shoulder.x - f * 5, y: shoulder.y - 8 };
        else if (this.throwCd > 0.8) hands[1] = { x: shoulder.x + f * 9, y: shoulder.y - 1 };
        else if (this.weapon) hands[1] = { x: shoulder.x + f * 4, y: shoulder.y + 5 };
      } else if (this.grabbedBy && this.throwT > 0) {
        hands[1] = { x: shoulder.x - f * 5, y: shoulder.y - 8 };
      }
      // reaching for fruit or a batfly overrides the near hand
      if (this.reachTo && !this.grabbedBy && !this.pole) {
        hands[0] = { x: this.reachTo.x, y: this.reachTo.y };
        hands[1] = { x: U.lerp(hands[1].x, this.reachTo.x, 0.4), y: U.lerp(hands[1].y, this.reachTo.y, 0.4) };
      }
      return { feet, hands };
    }

    // Thin two-bone arm ending in a small round hand.
    drawArm(ctx, sh, t, col, w) {
      const k = U.ik2(sh.x, sh.y, t.x, t.y, ARM, ARM, -this.faceSign());
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(k.kx, k.ky);
      ctx.lineTo(k.ex, k.ey);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(k.ex, k.ey, 1.7, 0, U.TAU);
      ctx.fill();
      return { x: k.ex, y: k.ey };
    }

    drawLimb(ctx, ax, ay, t, l1, l2, col, w, bend) {
      const k = U.ik2(ax, ay, t.x, t.y, l1, l2, bend);
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(k.kx, k.ky);
      ctx.lineTo(k.ex, k.ey);
      ctx.stroke();
    }
  }

  RW.Creatures.Slugcat = Slugcat;
})();
