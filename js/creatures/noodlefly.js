// Noodleflies (the wiki's Adult and Infant Noodleflies): long, flexible fliers
// with a needle for a mouth. A family travels together, an adult with a brood
// of infants flying about it or clinging to its tail. They pass through: in by
// one den, a couple of meals, out by the farthest den. Adults hunt lizards and
// anything smaller with the needle (a telegraphed wind-up, then a lethal stab)
// and suck their kill dry on the wing. An infant that's grabbed or killed cries
// out, and the nearest adult goes after whoever was closest to it.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;
  const AIR = { fly: true, key: 'air' };
  const TAIL_GRAV = 520;

  // Colour variants, by how often they turn up (the wiki's palettes: adults
  // mostly reds, then pinks, purples, white, black with red wings, rarely
  // blue with red eyes; infants reds and pinks, now and then grey).
  const ADULT = [
    [{ body: '#8e1730', stripe: '#d4566e', end: '#24060d', wing: '#c9cad3', eye: '#d9d6dc' }, 5],
    [{ body: '#a63c6e', stripe: '#e48ab4', end: '#2c0c1e', wing: '#d0cbd8', eye: '#e0dce4' }, 2],
    [{ body: '#c21d24', stripe: '#f2685e', end: '#320708', wing: '#d6cfcf', eye: '#e4dede' }, 2],
    [{ body: '#4c1a46', stripe: '#8e4e86', end: '#14060f', wing: '#bdb9c9', eye: '#d0ccd8' }, 1.5],
    [{ body: '#d6d1d6', stripe: '#fbfafb', end: '#77727b', wing: '#e2e2ea', eye: '#4a4650' }, 1],
    [{ body: '#241719', stripe: '#553339', end: '#0a0607', wing: '#c8484c', eye: '#d6d2d2' }, 1],
    [{ body: '#2b3c8e', stripe: '#6f8fe6', end: '#0c1230', wing: '#c4cbe0', eye: '#e04040' }, 0.3],
  ];
  const INFANT = [
    [{ body: '#b8304a', stripe: '#ec7f92', end: '#4a0d18', wing: '#d8d3da', eye: '#f0ecf0' }, 5],
    [{ body: '#d0587a', stripe: '#f4a6bc', end: '#5a1a2c', wing: '#dcd6de', eye: '#f4eef4' }, 2],
    [{ body: '#86767c', stripe: '#bcadb3', end: '#2a2226', wing: '#d0ccd2', eye: '#f0eeee' }, 1],
  ];

  class Noodlefly extends RW.Creature {
    constructor(eco, species, x, y, family) {
      super(eco, species, x, y);
      this.infant = species === 'noodlefly_infant';
      const L = (this.L = (this.infant ? 0.42 : 1) * (this.p.size || 1));
      this.isFlier = true;
      this.pos = { x, y };
      this.vx = U.rand(-30, 30);
      this.vy = -20;
      this.facing = U.sign();
      this.curl = 1; // 1 = the resting crook, 0 = held out straight
      this.aim = 0; // direction of the straightened body
      this.needle = 0; // 0 retracted .. 1 fully out
      this.flap = U.rand(0, 10);
      this.col = U.weighted(this.infant ? INFANT : ADULT);
      const n = this.infant ? 5 : 12;
      const segs = [];
      for (let i = 0; i < n; i++) segs.push((this.infant ? 2.6 : 5.4) * L * (1 - (i / n) * 0.3));
      this.tail = new RW.Chain(x, y, n, segs, 0, 1);
      this.family = family || { adult: null, infants: [] };
      if (this.infant) this.family.infants.push(this);
      else if (!this.family.adult) this.family.adult = this;
      this.mass = this.infant ? 0.3 : 1.2;
      this.bloodColor = '#3a0c18';
      this.threats = ['daddy', 'centipede_large'];
      // adults stab and eat lizards and anything smaller
      this.diet = this.infant ? [] : this.p.diet || ['lizard_*', 'slugcat', 'centipede', 'centipede_medium', 'batfly', 'squidcada', 'dropwig'];
      this.meals = 0;
      this.huntCd = U.rand(5, 15);
      this.clingT = U.rand(2, 8);
      this.cling = -1;
      this.state = 'drift';
      this.goal = null;
      this.goalT = 0;
      this.perceiveT = 0;
    }
    mainPoint() {
      return this.pos;
    }
    bounds() {
      const A = this.archPts();
      return RW.Creature.ptsBounds(A.concat(this.tail.pts, [this.needleTip()]), 26 * this.L);
    }
    carry(dx, dy) {
      if (this.state === 'stuck' || this.corpse) this.shiftAll(dx, dy);
    }
    shiftAll(dx, dy) {
      this.pos.x += dx;
      this.pos.y += dy;
      this.tail.shift(dx, dy);
    }
    holdPoint() {
      return this.needleTip();
    }
    // Rocks and spears can hit the shoulder and the head end.
    hitParts() {
      const A = this.archPts();
      const h = A[A.length - 1];
      return [
        { x: this.pos.x, y: this.pos.y, r: 5 * this.L + 1, part: 'body' },
        { x: h.x, y: h.y, r: 4 * this.L + 1, part: 'head' },
      ];
    }
    onRockHit() {
      this.stun(this.infant ? 3 : 1.5); // a rock knocks an infant down without it crying out
    }
    onSpearHit() {
      if (this.infant) {
        this.remove();
        return 'skewer';
      }
      this.die();
      return 'drop';
    }
    onRecovered() {
      this.vy = -120;
    }

    // ---------------------------------------------------------------- body --
    // The arch from the shoulder up and over to the head (a crook when
    // resting, straightened along `aim` to stab).
    archPts() {
      const L = this.L;
      const n = this.infant ? 5 : 7;
      const seg = (this.infant ? 3.1 : 4.7) * L;
      const out = [{ x: this.pos.x, y: this.pos.y }];
      let x = this.pos.x;
      let y = this.pos.y;
      let ang = 0;
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        // facing right: starts up and forward, curls over to point down
        const crook = -0.8 + 2.55 * t + Math.sin(this.age * 1.7 + k * 0.6) * 0.04;
        const cr = this.facing > 0 ? crook : Math.PI - crook;
        ang = U.lerpAngle(this.aim, cr, this.curl);
        x += Math.cos(ang) * seg;
        y += Math.sin(ang) * seg;
        out.push({ x, y });
      }
      this.headAng = ang;
      return out;
    }
    needleTip() {
      const A = this.archPts();
      const h = A[A.length - 1];
      const len = (2 + this.needle * 24) * this.L;
      return { x: h.x + Math.cos(this.headAng) * len, y: h.y + Math.sin(this.headAng) * len };
    }
    // The tail hangs from the shoulder, swinging behind when it darts about.
    updateTail(dt, grav) {
      const P = this.tail.pts;
      P[0].x = P[0].px = this.pos.x;
      P[0].y = P[0].py = this.pos.y;
      this.tail.verlet(1, 0.9, 0, grav === undefined ? TAIL_GRAV : grav, dt);
      this.tail.follow(1);
      this.tail.limitBend(0.5, 2, P.length, 0.5);
      for (let i = 2; i < P.length; i++) this.W.collideCircle(P[i], 1.5);
    }

    // ---------------------------------------------------------- movement --
    // Steer toward (tx, ty) at up to maxSp, keeping off walls and ceilings.
    fly(dt, tx, ty, maxSp, accel) {
      const p = this.pos;
      let ax = 0;
      let ay = Math.sin(this.age * 2.3 + this.id) * 16 * this.L; // a lazy bob
      if (tx !== undefined) {
        const dx = tx - p.x;
        const dy = ty - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const want = Math.min(maxSp, d * 2.4);
        ax += ((dx / d) * want - this.vx) * accel;
        ay += ((dy / d) * want - this.vy) * accel;
      } else {
        ax -= this.vx * 1.5;
        ay -= this.vy * 1.5;
      }
      const clear = (this.infant ? 14 : 26) + 6;
      const s = this.W.nearestSurface(p.x, p.y, clear, null);
      if (s) {
        const k = (clear - s.d) * 14;
        ax += s.nx * k;
        ay += s.ny * k;
      }
      this.vx += ax * dt;
      this.vy += ay * dt;
      p.x += this.vx * dt;
      p.y += this.vy * dt;
      const c = this.W.collideCircle(p, 3 * this.L + 1);
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx;
          this.vy -= vn * c.ny;
        }
      }
      p.x = U.clamp(p.x, 6, this.W.w - 6);
      p.y = U.clamp(p.y, 6, this.W.h - 6);
      if (Math.abs(this.vx) > 15 && this.curl > 0.5) this.facing = Math.sign(this.vx);
    }
    // Somewhere open to drift to, near (x, y).
    airGoal(x, y, r) {
      const W = this.W;
      return RW.Nav.randomValid(W, AIR, x, y, r, (cx, cy) => W.surfDist(cx, cy) >= 3, 30);
    }

    // ------------------------------------------------------------- update --
    update(dt) {
      this.flap += dt * (this.infant ? 46 : 34);
      if (!this.tick(dt)) {
        this.updateTail(dt);
        return;
      }
      this.huntCd -= dt;
      if (this.grabbedBy) {
        // caught: hangs from the jaws (an infant dies of it in a moment)
        const hp = this.grabbedBy.holdPoint();
        this.pos.x = hp.x;
        this.pos.y = hp.y;
        this.vx = this.vy = 0;
        this.curl += (0.4 - this.curl) * U.approach(4, dt);
        if (this.infant && !this.corpse && (this.dieT -= dt) <= 0) this.kill();
        else if (!this.corpse) this.struggle(dt);
        this.updateTail(dt);
        return;
      }
      if (this.infant) this.thinkInfant(dt);
      else this.thinkAdult(dt);
      // ease the body between the crook and the straight stabbing pose
      const straight = this.state === 'windup' || this.state === 'stab' || this.state === 'stuck';
      this.curl += ((straight ? 0 : this.holding ? 0.45 : 1) - this.curl) * U.approach(straight ? 14 : 4, dt);
      const out = straight || this.state === 'stalk' || this.holding;
      this.needle += ((out ? 1 : 0) - this.needle) * U.approach(out ? 10 : 3, dt);
      this.updateTail(dt);
    }

    // A creature to blame: the one nearest the infant (not a noodlefly).
    culpritNear(m, prefer) {
      if (prefer && !prefer.isHand && !prefer.species.startsWith('noodlefly')) return prefer;
      let best = null;
      let bd = 260 * 260;
      for (const c of this.eco.creatures) {
        if (c.dead || c.corpse || c.leaving || c.species.startsWith('noodlefly')) continue;
        const d = U.dist2(m.x, m.y, c.x, c.y);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best;
    }
    // An infant's cry: the nearest adult takes revenge.
    cry(culprit) {
      if (this.cried) return;
      this.cried = true;
      this.cryT = 0.8;
      const m = this.pos;
      let adult = this.family.adult;
      if (!adult || adult.dead || adult.corpse || adult.leaving) {
        adult = null;
        let bd = Infinity;
        for (const c of this.eco.creatures) {
          if (c.species !== 'noodlefly' || c.dead || c.corpse || c.leaving) continue;
          const d = U.dist2(m.x, m.y, c.x, c.y);
          if (d < bd) {
            bd = d;
            adult = c;
          }
        }
      }
      const who = this.culpritNear(m, culprit);
      if (adult && who) adult.avenge(who);
    }
    avenge(who) {
      this.vengeance = who;
      this.vengeanceUntil = this.age + 45;
      this.huntCd = 0;
      this.attempts = 0;
      if (this.state !== 'stab' && this.state !== 'stuck') this.setState('stalk');
    }
    onGrabbed(by) {
      if (this.infant) {
        this.dieT = U.rand(0.8, 1.8);
        this.cry(by);
      }
    }
    kill() {
      const was = this.corpse;
      super.kill();
      if (!was && this.infant) this.cry(this.grabbedBy);
    }
    limp(dt) {
      // knocked out or dead: drops and lies where it lands
      const p = this.pos;
      this.vy += 700 * dt;
      this.vx *= Math.pow(0.4, dt);
      p.x += this.vx * dt;
      p.y += this.vy * dt;
      const c = this.W.collideCircle(p, 3 * this.L + 1);
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx * 1.2;
          this.vy -= vn * c.ny * 1.2;
        }
        this.vx *= 0.7;
      }
      this.curl += (0.35 - this.curl) * U.approach(3, dt);
      this.aim = Math.PI / 2;
      this.needle *= 0.98;
    }

    // Transit: in by one den, a couple of meals (or a long while), out by the
    // farthest; the rain sends everyone to the nearest. Infants go with the
    // family's adult.
    wantsToLeave(dt) {
      if (this.eco.shouldShelter()) return true;
      const fam = this.family;
      if (this.infant) {
        const a = fam.adult;
        if (fam.exitDen) return true;
        if (!a || a.dead || a.corpse) return this.age > 90; // orphans wander off before long
        return false;
      }
      if (!this.origin) this.origin = this.eco.nearestDen(this.spawnX, this.spawnY) || { x: this.spawnX, y: this.spawnY };
      if (!fam.exitDen && (this.meals >= 2 || this.age > 240) && !this.holding && !this.vengeance) {
        fam.exitDen = this.eco.farthestDen(this.origin.x, this.origin.y, this.pos.x, this.pos.y, AIR);
      }
      return !!fam.exitDen;
    }
    headForDen(dt) {
      const p = this.pos;
      const den = (!this.eco.shouldShelter() && this.family.exitDen) || this.eco.nearestDen(p.x, p.y);
      this.setState('leave');
      if (!den) return;
      this.fly(dt, den.x, den.y, this.infant ? 140 : 120, 4);
      if (U.dist(p.x, p.y, den.x, den.y) < 22) this.leave();
    }

    thinkAdult(dt) {
      const p = this.pos;
      this.perceiveT -= dt;
      const perceive = this.perceiveT <= 0;
      if (perceive) this.perceiveT = 0.3;

      if (this.holding) {
        // feeding: hover with the kill hanging off the needle
        this.setState('eat');
        this.eatT = (this.eatT || 0) + dt;
        this.aim = this.facing > 0 ? 1.1 : Math.PI - 1.1;
        this.fly(dt, undefined, undefined, 0, 0);
        if (this.eatT > 4) {
          this.eco.consume(this.holding, this);
          this.holding = null;
          this.eatT = 0;
          this.meals++;
          this.huntCd = U.rand(12, 25);
          this.setState('drift');
        }
        return;
      }
      if (this.state === 'stuck') {
        // a missed stab drove the needle into the wall: wriggle free
        this.vx = this.vy = 0;
        this.pos.x += Math.sin(this.age * 40) * 0.3;
        if (this.stateT > 3) {
          this.vx = -Math.cos(this.aim) * 90;
          this.vy = -Math.sin(this.aim) * 90 - 40;
          this.setState('recover');
        }
        return;
      }
      if (this.state !== 'stab' && this.wantsToLeave(dt)) return this.headForDen(dt);

      const v = this.vengeance;
      if (v && (v.dead || v.corpse || v.leaving || this.age > this.vengeanceUntil)) this.vengeance = null;
      let target = this.vengeance || this.target;
      if (target && !this.vengeance && (target.dead || target.corpse || target.leaving || target.grabbedBy)) target = this.target = null;
      if (!target && perceive && this.huntCd <= 0 && this.meals < 2) {
        target = this.target = this.nearestOf(this.diet, this.p.vision || 420, (c) => c.canBeGrabbed() && this.canSee(c.x, c.y, this.p.vision || 420));
        this.attempts = 0;
      }
      if (target) return this.hunt(dt, target);

      // Drifting about: hover a while, then on to somewhere else.
      if (this.state !== 'drift' && this.state !== 'hover') this.setState('drift');
      this.goalT -= dt;
      if (!this.goal || this.goalT <= 0) {
        this.goal = this.airGoal(p.x, p.y, 320);
        this.goalT = U.rand(4, 10);
      }
      const g = this.goal;
      const near = g && U.dist(p.x, p.y, g.x, g.y) < 30;
      this.fly(dt, g ? g.x : undefined, g ? g.y : undefined, near ? 20 : 70, near ? 1.2 : 2);
    }

    // Stalk to a striking distance, wind up (straighten, needle out, draw
    // back), stab in a straight line; a miss into a wall gets it stuck.
    hunt(dt, t) {
      const p = this.pos;
      const tp = t.mainPoint();
      if (this.state === 'windup') {
        this.aim = Math.atan2(tp.y - p.y, tp.x - p.x);
        this.facing = Math.cos(this.aim) >= 0 ? 1 : -1;
        this.vx += (-Math.cos(this.aim) * 30 - this.vx) * U.approach(6, dt);
        this.vy += (-Math.sin(this.aim) * 30 - this.vy) * U.approach(6, dt);
        p.x += this.vx * dt;
        p.y += this.vy * dt;
        if (this.stateT > 0.5) {
          this.setState('stab');
          this.vx = Math.cos(this.aim) * 460;
          this.vy = Math.sin(this.aim) * 460;
        }
        return;
      }
      if (this.state === 'stab') {
        p.x += this.vx * dt;
        p.y += this.vy * dt;
        const tip = this.needleTip();
        // the needle finds whatever it's pointed at
        for (const c of this.eco.creatures) {
          if (c === this || c.dead || c.leaving || c.species.startsWith('noodlefly') || c.grabbedBy) continue;
          if (c !== t && !this.diet.some((s) => (s.endsWith('*') ? c.species.startsWith(s.slice(0, -1)) : s === c.species))) continue;
          const parts = c.hitParts ? c.hitParts() : [{ x: c.x, y: c.y, r: 8 }];
          if (!parts.some((q) => U.dist(q.x, q.y, tip.x, tip.y) < q.r + 3)) continue;
          if (this.eco.cfg.ecosystem.predation && this.grab(c)) {
            if (!c.corpse) c.kill();
            this.eco.burst(tip.x, tip.y, c.bloodColor || '#2a1418', 6);
            this.vengeance = null;
            this.target = null;
            this.vx *= 0.2;
            this.vy *= 0.2;
          } else {
            c.stun(1.2);
            this.setState('recover');
          }
          return;
        }
        if (this.W.isSolidPt(tip.x, tip.y)) {
          this.setState('stuck');
          return;
        }
        if (this.stateT > 0.35 || p.x < 6 || p.x > this.W.w - 6 || p.y < 6 || p.y > this.W.h - 6) this.setState('recover');
        return;
      }
      if (this.state === 'recover') {
        this.fly(dt, undefined, undefined, 0, 0);
        if (this.stateT > 0.7) {
          this.attempts = (this.attempts || 0) + 1;
          if (this.attempts > 5 && !this.vengeance) {
            this.target = null;
            this.huntCd = U.rand(10, 20);
            this.setState('drift');
          } else this.setState('stalk');
        }
        return;
      }
      // stalking: hang off to one side and a little above, in clear sight
      if (this.state !== 'stalk') this.setState('stalk');
      const dx = p.x - tp.x;
      const dy = p.y - tp.y;
      const d = Math.hypot(dx, dy) || 1;
      const reach = 70;
      const sx = tp.x + (dx / d) * reach;
      const sy = tp.y + (dy / d) * reach * 0.6 - 28;
      this.facing = tp.x >= p.x ? 1 : -1;
      this.fly(dt, sx, sy, this.vengeance ? 170 : 130, 3);
      const clear = this.W.lineClear(p.x, p.y, tp.x, tp.y);
      if (d < reach * 1.5 && clear && this.stateT > 1) this.setState('windup');
      if (this.stateT > 14 && !this.vengeance) {
        this.target = null;
        this.huntCd = U.rand(8, 16);
        this.setState('drift');
      }
    }

    // Infants: keep close to the family's adult, flying about it or clinging
    // to its tail; skitter away from anything that comes close.
    thinkInfant(dt) {
      const p = this.pos;
      if (this.wantsToLeave(dt)) {
        this.cling = -1;
        return this.headForDen(dt);
      }
      const a = this.family.adult;
      const withParent = a && !a.dead && !a.corpse && !a.leaving && !a.grabbedBy;
      this.clingT -= dt;
      if (this.clingT <= 0) {
        this.clingT = U.rand(5, 14);
        if (this.cling >= 0 || !withParent) this.cling = -1;
        else if (Math.random() < 0.6) {
          const taken = new Set(this.family.infants.map((i) => i.cling));
          const n = a.tail.pts.length;
          const spots = [];
          for (let i = Math.floor(n * 0.45); i < n; i += 2) if (!taken.has(i)) spots.push(i);
          if (spots.length) this.cling = U.pick(spots);
        }
      }
      if (!withParent || a.state === 'windup' || a.state === 'stab') this.cling = -1;
      // something close and not family: scatter
      const threat = this.nearestOf(['lizard_*', 'slugcat', 'centipede*', 'daddy', 'dropwig', 'squidcada'], 50);
      if (threat && this.cling < 0) {
        const dx = p.x - threat.x;
        const dy = p.y - threat.y;
        const d = Math.hypot(dx, dy) || 1;
        this.fly(dt, p.x + (dx / d) * 80, p.y + (dy / d) * 80 - 20, 150, 5);
        this.setState('flee');
        return;
      }
      if (this.cling >= 0) {
        // hanging off the adult's tail, swinging with it
        const tp = a.tail.pts[Math.min(this.cling, a.tail.pts.length - 1)];
        p.x += (tp.x - p.x) * U.approach(12, dt);
        p.y += (tp.y + 2 - p.y) * U.approach(12, dt);
        this.vx = a.vx;
        this.vy = a.vy;
        this.facing = this.id % 2 ? 1 : -1;
        this.setState('cling');
        return;
      }
      this.setState('drift');
      if (withParent) {
        // circling the adult loosely
        const ang = this.age * 0.9 + this.id * 2.1;
        const r = 30 + (this.id % 3) * 9;
        this.fly(dt, a.pos.x + Math.cos(ang) * r, a.pos.y + Math.sin(ang) * r * 0.6 + 10, 120, 3);
      } else {
        this.goalT -= dt;
        if (!this.goal || this.goalT <= 0) {
          this.goal = this.airGoal(p.x, p.y, 200);
          this.goalT = U.rand(3, 7);
        }
        this.fly(dt, this.goal ? this.goal.x : undefined, this.goal ? this.goal.y : undefined, 60, 2);
      }
    }

    // ------------------------------------------------------------- drawing --
    draw(ctx) {
      const A = this.archPts();
      const T = this.tail.pts;
      const L = this.L;
      const col = this.col;
      const ap = this.eco.artPx || 1;
      const flying = !this.corpse && !(this.stunT > 0) && !this.grabbedBy;
      ctx.save();
      ctx.globalAlpha = this.alpha;
      if (flying && this.state !== 'cling') this.drawWings(ctx, A, 0);

      // one tapering line: tail end -> shoulder -> head
      const pts = T.slice().reverse().concat(A.slice(1));
      const nT = T.length;
      const w = pts.map((q, i) => {
        if (i < nT) return Math.max(0.55 * ap, U.lerp(0.5, 1.7, i / (nT - 1)) * L);
        const k = (i - nT + 1) / (A.length - 1);
        return Math.max(0.6 * ap, U.lerp(2.1, 1.3, k) * L);
      });
      ctx.fillStyle = col.body;
      U.taperPath(ctx, pts, w);
      ctx.fill();
      // the tail darkens toward its end
      const endN = Math.ceil(nT * 0.55);
      ctx.fillStyle = col.end;
      U.taperPath(ctx, pts.slice(0, endN + 1), w.slice(0, endN + 1).map((x) => x + 0.05));
      ctx.fill();
      // a pale stripe along the top of the arch
      ctx.strokeStyle = col.stripe;
      ctx.lineWidth = Math.max(ap * 0.75, 0.9 * L);
      ctx.beginPath();
      for (let i = 0; i < A.length - 1; i++) {
        const a = A[i];
        const b = A[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        // offset to the outside of the curl
        const s = this.facing * (this.curl > 0.3 ? 1 : 0) || 1;
        const ox = (dy / d) * 0.8 * L * s;
        const oy = (-dx / d) * 0.8 * L * s;
        if (i === 0) ctx.moveTo(a.x + ox, a.y + oy);
        ctx.lineTo(b.x + ox, b.y + oy);
      }
      ctx.stroke();

      const h = A[A.length - 1];
      const hx = Math.cos(this.headAng);
      const hy = Math.sin(this.headAng);
      // short dangling legs under the front of the arch
      if (!this.infant || L > 0.3) {
        ctx.strokeStyle = col.end;
        ctx.lineWidth = Math.max(ap * 0.7, 0.7 * L);
        ctx.beginPath();
        for (const k of [A.length - 3, A.length - 2]) {
          const q = A[k];
          for (const s of [-1, 1]) {
            const sw = Math.sin(this.age * 6 + k + s) * 0.6 * L;
            ctx.moveTo(q.x, q.y + 1.2 * L);
            ctx.lineTo(q.x + s * 1.2 * L + sw, q.y + 3.6 * L);
            ctx.lineTo(q.x + s * 2.2 * L + sw, q.y + 4.4 * L);
          }
        }
        ctx.stroke();
      }
      // the needle: black, a pale red base and a white tip when it's fresh out
      const nl = (2 + this.needle * 24) * L;
      ctx.lineWidth = Math.max(ap * 0.75, 0.8 * L);
      ctx.strokeStyle = '#1b1216';
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(h.x + hx * nl, h.y + hy * nl);
      ctx.stroke();
      if (this.needle > 0.3) {
        ctx.strokeStyle = '#d98e96';
        ctx.beginPath();
        ctx.moveTo(h.x, h.y);
        ctx.lineTo(h.x + hx * 3 * L, h.y + hy * 3 * L);
        ctx.stroke();
        ctx.strokeStyle = '#f4f0ee';
        ctx.beginPath();
        ctx.moveTo(h.x + hx * (nl - 2.5 * L), h.y + hy * (nl - 2.5 * L));
        ctx.lineTo(h.x + hx * nl, h.y + hy * nl);
        ctx.stroke();
      }
      // small oval eyes either side of the head
      const ex = h.x - hx * 1.6 * L;
      const ey = h.y - hy * 1.6 * L;
      const px = -hy;
      const py = hx;
      ctx.fillStyle = this.corpse ? '#111' : col.eye;
      const es = Math.max(ap, 1.1 * L);
      for (const s of [-1, 1]) ctx.fillRect(ex + px * s * 1.3 * L - es / 2, ey + py * s * 1.3 * L - es / 2, es, es);
      if (flying && this.state === 'cling') this.drawWings(ctx, A, 1);
      // an infant's cry: a few pale rings
      if (this.cryT > 0) {
        this.cryT -= 1 / 60;
        ctx.strokeStyle = '#f2e9ea';
        ctx.lineWidth = ap;
        ctx.beginPath();
        ctx.arc(h.x, h.y, (0.8 - this.cryT) * 22 + 3, 0, U.TAU);
        ctx.stroke();
      }
      ctx.restore();
      this.drawDebug(ctx);
    }
    // Four long thin blades from the shoulder, a blur of beats (folded back
    // while clinging).
    drawWings(ctx, A, folded) {
      const L = this.L;
      const ap = this.eco.artPx || 1;
      const root = A[1];
      const len = (this.infant ? 9 : 21) * L;
      ctx.fillStyle = this.col.wing;
      const base = folded ? [-2.3, -2.0] : [-1.05, -0.6, 0.6, 1.05];
      for (let i = 0; i < base.length; i++) {
        const beat = folded ? 0 : Math.sin(this.flap + i * 1.7) * 0.5;
        const a = -Math.PI / 2 + (base[i] + beat) * (folded ? this.facing : 1);
        const tx = root.x + Math.cos(a) * len;
        const ty = root.y + Math.sin(a) * len;
        const nx = -Math.sin(a) * Math.max(ap * 0.6, 0.9 * L);
        const ny = Math.cos(a) * Math.max(ap * 0.6, 0.9 * L);
        ctx.beginPath();
        ctx.moveTo(root.x - nx, root.y - ny);
        ctx.lineTo(root.x + nx, root.y + ny);
        ctx.lineTo(tx, ty);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  RW.Creatures.Noodlefly = Noodlefly;
})();
