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

  // Proportions in world units (a slugcat stands about 30 tall). From the
  // game: the adult's arch is ~2.7 slugcats wide, its tail ~4 slugcats long,
  // each wing ~3; infants are about a slugcat long. Bodies are thin for their
  // size (the arch ~6 thick at its top, the tail a hairline).
  const DIMS = {
    adult: { archN: 10, nose: 3, archSeg: 13, tailN: 24, tailSeg: 5, archW: [1.5, 3.0, 1.5], tailW: 1.3, needleIn: 6, needleOut: 46, wing: [86, 66], clear: 60, rad: 6, tailGrav: 700 },
    infant: { archN: 7, nose: 2, archSeg: 3.2, tailN: 7, tailSeg: 2.0, archW: [0.6, 1.1, 0.7], tailW: 0.7, needleIn: 1.5, needleOut: 9, wing: [15, 11], clear: 22, rad: 2.5, tailGrav: 150 },
  };

  // Colour variants, by how often they turn up (the wiki's eight: red,
  // purplish pink, bright red, dark purple, white, uniform red, black with
  // red-rooted wings, blue or purple with red eyes). Tails fade body -> end.
  const ADULT = [
    [{ body: '#8e1730', stripe: '#d4566e', belly: '#4a1020', end: '#3a1124', wing: '#aeb2c0', eye: '#d9d6dc' }, 4],
    [{ body: '#b02e6e', stripe: '#e58ab8', belly: '#5a1438', end: '#3a1430', wing: '#b8b4c4', wingBase: '#d85a90', eye: '#e6e2ea' }, 2],
    [{ body: '#e0404e', stripe: '#ff9da0', belly: '#7a1622', end: '#4a1420', wing: '#c4bcbc', wingBase: '#d85a70', eye: '#f0e8e8' }, 2],
    [{ body: '#3c2070', stripe: '#6c50b8', belly: '#1c1036', end: '#22163e', wing: '#aeacc0', eye: '#d8d4e4' }, 1.5],
    [{ body: '#e6e4e6', stripe: '#ffffff', belly: '#a8a4ac', end: '#8a8890', wing: '#d8d8e0', eye: '#4a4650' }, 1],
    [{ body: '#c41a2a', stripe: '#d63442', belly: '#7a0e18', end: '#86141e', wing: '#c0b8b8', eye: '#e8e0e0' }, 1.5],
    [{ body: '#1a1418', stripe: '#463238', belly: '#0c0a0c', end: '#5a1820', wing: '#c8c4c4', wingBase: '#c8343c', eye: '#d6d2d2' }, 1],
    [{ body: '#2a4aa8', stripe: '#6a8ae8', belly: '#162a64', end: '#1c2a5a', wing: '#e6dcb0', eye: '#e03a3a' }, 0.3],
    [{ body: '#4a2a7c', stripe: '#7a5ab8', belly: '#24143e', end: '#2a1a46', wing: '#b4b0c4', eye: '#e03a3a' }, 0.5],
  ];
  // infants: slim dusty-rose or crimson crescents (now and then grey)
  const INFANT = [
    [{ body: '#c97d88', stripe: '#e8c3ca', belly: '#8a4a56', end: '#7a3a48', wing: '#a9c4c8', eye: '#f0ecf0' }, 3],
    [{ body: '#e0405a', stripe: '#f4a0ae', belly: '#8a1a2e', end: '#7a2032', wing: '#a9c4c8', eye: '#f4eef4' }, 3],
    [{ body: '#8a7a80', stripe: '#c0b2b8', belly: '#4a4044', end: '#5a4e54', wing: '#b4c4c8', eye: '#f0eeee' }, 1],
  ];

  // One pass of corner cutting: smooths the jointed tail into a curve.
  function chaikin(P) {
    const out = [P[0]];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i];
      const b = P[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(P[P.length - 1]);
    return out;
  }

  class Noodlefly extends RW.Creature {
    constructor(eco, species, x, y, family) {
      super(eco, species, x, y);
      this.infant = species === 'noodlefly_infant';
      const L = (this.L = this.p.size || 1);
      this.D = DIMS[this.infant ? 'infant' : 'adult'];
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
      const n = this.D.tailN;
      const segs = [];
      for (let i = 0; i < n; i++) segs.push(this.D.tailSeg * L * (1 - (i / n) * 0.25));
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
      return RW.Creature.ptsBounds(A.concat(this.tail.pts, [this.needleTip()]), (this.D.wing[0] + 4) * this.L);
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
      const top = A[Math.floor(A.length * 0.45)];
      const r = this.D.rad * this.L;
      return [
        { x: this.pos.x, y: this.pos.y, r: r + 1, part: 'body' },
        { x: top.x, y: top.y, r: r + 2, part: 'body' },
        { x: h.x, y: h.y, r: r, part: 'head' },
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
      const n = this.D.archN;
      const seg = this.D.archSeg * L;
      const out = [{ x: this.pos.x, y: this.pos.y }];
      let x = this.pos.x;
      let y = this.pos.y;
      let ang = 0;
      const noseAt = n - this.D.nose;
      let noseBase = 0;
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        // facing right: rises straight up out of the tail, curls over the top
        // and comes down; the nose droops on round, limp, until the
        // proboscis comes out (feeding or hunting), when it straightens into
        // a spear
        let crook = -1.57 + 3.1 * Math.min(1, k / (noseAt - 1)) + Math.sin(this.age * 1.7 + k * 0.6) * 0.03;
        if (k >= noseAt) crook += (k - noseAt + 1) * 0.42 + Math.sin(this.age * 1.1) * 0.05;
        const cr = this.facing > 0 ? crook : Math.PI - crook;
        ang = U.lerpAngle(this.aim, cr, this.curl);
        if (k === noseAt - 1) noseBase = ang;
        if (k >= noseAt) ang = U.lerpAngle(ang, noseBase, U.clamp(this.needle * 1.4, 0, 1));
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
      const len = (this.D.needleIn + this.needle * (this.D.needleOut - this.D.needleIn)) * this.L;
      return { x: h.x + Math.cos(this.headAng) * len, y: h.y + Math.sin(this.headAng) * len };
    }
    // The tail hangs from the shoulder, swinging behind when it darts about.
    updateTail(dt, grav) {
      const P = this.tail.pts;
      P[0].x = P[0].px = this.pos.x;
      P[0].y = P[0].py = this.pos.y;
      this.tail.verlet(1, 0.9, 0, grav === undefined ? this.D.tailGrav : grav, dt);
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
      const clear = this.D.clear * this.L;
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
      const c = this.W.collideCircle(p, this.D.rad * this.L);
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
      const straight = this.state === 'windup' || this.state === 'stab' || this.state === 'stuck' || this.state === 'cling';
      this.curl += ((straight ? 0 : this.holding ? 0.45 : 1) - this.curl) * U.approach(straight ? 14 : 4, dt);
      const out = (straight && this.state !== 'cling') || this.state === 'stalk' || this.holding;
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
      const c = this.W.collideCircle(p, this.D.rad * this.L);
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
          this.vx = Math.cos(this.aim) * 480;
          this.vy = Math.sin(this.aim) * 480;
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
      const reach = (this.D.archN * this.D.archSeg + this.D.needleOut) * this.L * 0.75;
      const sx = tp.x + (dx / d) * reach;
      const sy = tp.y + (dy / d) * reach * 0.6 - reach * 0.3;
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
          for (let i = Math.floor(n * 0.6); i < n; i += 2) if (!taken.has(i)) spots.push(i);
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
        // clinging to the adult's tail: lying along it, head up toward the
        // adult, swinging with it
        const T = a.tail.pts;
        const i = Math.min(this.cling, T.length - 1);
        const tp = T[i];
        const up = T[i - 1];
        const ang = Math.atan2(up.y - tp.y, up.x - tp.x);
        const side = (this.id % 3) - 1;
        const ox = -Math.sin(ang) * (side || 1) * 3;
        const oy = Math.cos(ang) * (side || 1) * 3;
        p.x += (tp.x + ox - p.x) * U.approach(12, dt);
        p.y += (tp.y + oy - p.y) * U.approach(12, dt);
        this.vx = a.vx;
        this.vy = a.vy;
        this.aim = ang;
        this.setState('cling');
        return;
      }
      this.setState('drift');
      if (withParent) {
        // circling the adult loosely
        // circling the adult's arch loosely
        const ang = this.age * 0.7 + this.id * 2.1;
        const r = 55 + (this.id % 3) * 18;
        const cx = a.pos.x + a.facing * a.D.archSeg * a.D.archN * 0.3;
        const cy = a.pos.y - a.D.archSeg * a.D.archN * 0.15;
        this.fly(dt, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.6, 140, 3);
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
      const D = this.D;
      const col = this.col;
      const ap = this.eco.artPx || 1;
      const flying = !this.corpse && !(this.stunT > 0) && !this.grabbedBy;
      ctx.save();
      ctx.globalAlpha = this.alpha;
      if (flying && this.state !== 'cling') this.drawWings(ctx, A);

      // one tapering line: tail end -> shoulder -> head. The tail is a
      // hairline thickening toward the shoulder; the arch is thickest over
      // its top and thins to the head.
      const Ts = chaikin(T);
      const pts = Ts.slice().reverse().concat(A.slice(1));
      const nT = Ts.length;
      const nA = A.length - 1;
      const w = pts.map((q, i) => {
        if (i < nT) return Math.max(0.55 * ap, U.lerp(0.25, 1, Math.pow(i / (nT - 1), 1.5)) * D.tailW * L);
        const k = (i - nT + 1) / nA;
        const wa = k < 0.45 ? U.lerp(D.archW[0], D.archW[1], U.smooth(k / 0.45)) : U.lerp(D.archW[1], D.archW[2], U.smooth((k - 0.45) / 0.55));
        return Math.max(0.6 * ap, wa * L);
      });
      // the tail fades body -> end in three bands; the arch is body colour
      const bands = [
        [0, Math.ceil(nT * 0.3), col.end],
        [Math.ceil(nT * 0.3) - 1, Math.ceil(nT * 0.65), U.rgba(U.mix(col.body, col.end, 0.5))],
        [Math.ceil(nT * 0.65) - 1, pts.length, col.body],
      ];
      for (const [a, b, c] of bands) {
        ctx.fillStyle = c;
        U.taperPath(ctx, pts.slice(a, b), w.slice(a, b));
        ctx.fill();
      }
      // shading along the arch: a pale rim on the outside of the curl, a
      // dark line along the belly
      const s = this.facing * (this.curl > 0.3 ? 1 : 0) || 1;
      const edge = (off, color, from, to) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(ap, 0.8 * L);
        ctx.beginPath();
        for (let i = from; i < to; i++) {
          const a = A[i];
          const b = A[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const wi = w[nT + i - 1 + 1] || w[w.length - 1];
          const o = (wi - Math.max(ap, 0.8 * L) * 0.6) * off;
          const ox = (dy / d) * o * s;
          const oy = (-dx / d) * o * s;
          if (i === from) ctx.moveTo(a.x + ox, a.y + oy);
          ctx.lineTo(b.x + ox, b.y + oy);
        }
        ctx.stroke();
      };
      if (D.archW[1] * L > 1.4 * ap) {
        edge(1, col.stripe, 1, A.length - 2);
        edge(-1, col.belly, 2, A.length - 2);
      } else if (this.state !== 'cling') {
        edge(0.6, col.stripe, 1, A.length - 2);
      }

      const h = A[A.length - 1];
      const hx = Math.cos(this.headAng);
      const hy = Math.sin(this.headAng);
      // adults: five little claws hanging under the top and front of the arch
      if (!this.infant) {
        ctx.strokeStyle = col.belly;
        ctx.lineWidth = Math.max(ap, 0.9 * L);
        ctx.beginPath();
        for (let j = 0; j < 5; j++) {
          const q = A[Math.min(A.length - 2, 4 + j)];
          const sw = Math.sin(this.age * 5 + j * 1.3) * 0.8 * L;
          const kx = q.x + this.facing * 1.2 * L;
          const ky = q.y + D.archW[1] * L * 0.6;
          ctx.moveTo(kx, ky);
          ctx.lineTo(kx + sw, ky + 3.5 * L);
          ctx.lineTo(kx + sw + this.facing * 1.4 * L, ky + 5 * L);
        }
        ctx.stroke();
      }
      // the needle: black, with a pale red base and a white tip, the parts
      // that read against a dark room
      const nl = (D.needleIn + this.needle * (D.needleOut - D.needleIn)) * L;
      const lw = Math.max(1.15 * ap, (this.infant ? 0.7 : 1.2) * L);
      ctx.lineCap = 'butt';
      ctx.lineWidth = lw;
      const seg = (from, to, color) => {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(h.x + hx * from, h.y + hy * from);
        ctx.lineTo(h.x + hx * to, h.y + hy * to);
        ctx.stroke();
      };
      seg(0, nl, '#1b1216');
      if (this.needle > 0.3) {
        seg(0, Math.min(nl, 6 * L), '#d98e96');
        seg(Math.max(0, nl - 4 * L), nl, '#f4f0ee');
      }
      // adults: a small eye on the dorsal side, just behind the snout
      if (!this.infant) {
        const ex = h.x - hx * 3 * L + -hy * s * 1.4 * L;
        const ey = h.y - hy * 3 * L + hx * s * 1.4 * L;
        const es = Math.max(2 * ap, 2 * L);
        if (this.corpse) {
          ctx.strokeStyle = '#111';
          ctx.lineWidth = ap * 0.8;
          ctx.beginPath();
          ctx.moveTo(ex - es, ey - es);
          ctx.lineTo(ex + es, ey + es);
          ctx.moveTo(ex + es, ey - es);
          ctx.lineTo(ex - es, ey + es);
          ctx.stroke();
        } else {
          ctx.fillStyle = col.eye;
          ctx.fillRect(ex - es / 2, ey - es / 2, es, es);
        }
      }

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
    // Four long slim wings from the top of the arch, asymmetric (two
    // sweeping up and back, two down across the head), each a solid blade
    // (thin lines break up under the pixel filter); a vivid root band on
    // some variants.
    drawWings(ctx, A) {
      const L = this.L;
      const ap = this.eco.artPx || 1;
      const root = A[Math.min(A.length - 1, Math.floor(A.length * 0.3))];
      const f = this.facing;
      const angs = [-2.2, -1.85, 0.35, 0.7];
      const lens = [this.D.wing[0], this.D.wing[0] * 0.92, this.D.wing[1], this.D.wing[1] * 0.92];
      ctx.lineCap = 'butt';
      ctx.lineWidth = Math.max(1.6 * ap, (this.infant ? 1 : 2) * L);
      for (let i = 0; i < 4; i++) {
        let a = angs[i] + Math.sin(this.flap + i * 1.9) * 0.3;
        if (f < 0) a = Math.PI - a;
        const len = lens[i] * L;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        ctx.strokeStyle = this.col.wing;
        ctx.beginPath();
        ctx.moveTo(root.x + cx * 2 * L, root.y + cy * 2 * L);
        ctx.lineTo(root.x + cx * len, root.y + cy * len);
        ctx.stroke();
        if (this.col.wingBase) {
          ctx.strokeStyle = this.col.wingBase;
          ctx.beginPath();
          ctx.moveTo(root.x + cx * len * 0.1, root.y + cy * len * 0.1);
          ctx.lineTo(root.x + cx * len * 0.3, root.y + cy * len * 0.3);
          ctx.stroke();
        }
      }
    }
  }

  RW.Creatures.Noodlefly = Noodlefly;
})();
