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
      this.faceS = this.facing; // eases through the turn
      this.look = this.facing > 0 ? 0.4 : Math.PI - 0.4; // where the head is looking
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
      // adults stab and eat lizards and anything smaller (not batflies:
      // beneath its notice)
      this.diet = this.infant ? [] : this.p.diet || ['lizard_*', 'slugcat', 'centipede', 'centipede_medium', 'squidcada', 'dropwig'];
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
    // Where things go for it: the neck, just behind the eyes, not the
    // shoulder where the tail hangs. x/y report it, so every predator's
    // chase and bite lines up on it.
    neckPt() {
      const A = this.archPts();
      return A[A.length - 2];
    }
    // (worked out once per pose: predators ask for x/y a lot)
    neckNow() {
      const k = this.age + ',' + this.pos.x + ',' + this.pos.y;
      if (this.neckKey !== k) {
        this.neck = this.neckPt();
        this.neckKey = k;
      }
      return this.neck;
    }
    get x() {
      return this.neckNow().x;
    }
    get y() {
      return this.neckNow().y;
    }
    bounds() {
      const A = this.archPts();
      return RW.Creature.ptsBounds(A.concat(this.tail.pts, [this.needleTip()]), (this.D.wing[0] + 4) * this.L);
    }
    carry(dx, dy) {
      if (this.state === 'stuck' || this.corpse) this.shiftAll(dx, dy);
    }
    // Out of a pipe nose first: straight down the pipe, pointing out.
    layInPipe(mo) {
      this.aim = Math.atan2(-mo.ay, -mo.ax);
      this.curl = 0;
      this.anchor = null;
      const L = this.D.archN * this.D.archSeg * this.L;
      this.pos.x = mo.x + mo.ax * (L + 2);
      this.pos.y = mo.y + mo.ay * (L + 2);
      let d = L + 2;
      this.tail.pts.forEach((q, i) => {
        if (i) d += this.tail.seg[i - 1];
        q.x = q.px = mo.x + mo.ax * d;
        q.y = q.py = mo.y + mo.ay * d;
      });
    }
    // Into a pipe nose first: the body straightens along the pipe and the
    // tail trails in after it.
    pipeLead() {
      return this.headPt();
    }
    pipeMove(dx, dy, dt) {
      const pp = this.piping || this.unpiping;
      const into = this.piping ? 1 : -1;
      this.aim = U.lerpAngle(this.aim, Math.atan2(pp.ay * into, pp.ax * into), U.approach(10, dt));
      this.curl += (0 - this.curl) * U.approach(8, dt);
      this.needle *= 0.9;
      this.pos.x += dx;
      this.pos.y += dy; // (update() still swings the tail in after it)
      return true;
    }
    shiftAll(dx, dy) {
      this.pos.x += dx;
      this.pos.y += dy;
      this.tail.shift(dx, dy);
      if (this.slack) {
        for (const q of this.slack) {
          q.x += dx;
          q.y += dy;
          q.px += dx;
          q.py += dy;
        }
      }
    }
    // Dead: the arch is no longer held in its crook but goes slack, a floppy
    // rope that hangs and drapes under its own weight (pinned at the neck
    // when something carries it off), and the proboscis slides back in.
    updateSlack(dt, pin) {
      if (!this.slack) this.slack = this.archPtsLive().map((q) => ({ x: q.x, y: q.y, px: q.x, py: q.y }));
      const P = this.slack;
      const n = P.length;
      const seg = this.D.archSeg * this.L;
      const g = (this.infant ? 300 : 500) * dt * dt;
      for (const q of P) {
        const vx = (q.x - q.px) * 0.9;
        const vy = (q.y - q.py) * 0.9;
        q.px = q.x;
        q.py = q.y;
        q.x += vx;
        q.y += vy + g;
      }
      const k = n - 2; // the neck
      for (let it = 0; it < 4; it++) {
        if (pin) {
          P[k].x = pin.x;
          P[k].y = pin.y;
        }
        for (let i = 1; i < n; i++) {
          const a = P[i - 1];
          const b = P[i];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 1e-4;
          const e = (d - seg) / d;
          if (pin && i - 1 === k) {
            b.x -= dx * e;
            b.y -= dy * e;
          } else if (pin && i === k) {
            a.x += dx * e;
            a.y += dy * e;
          } else {
            a.x += dx * e * 0.5;
            a.y += dy * e * 0.5;
            b.x -= dx * e * 0.5;
            b.y -= dy * e * 0.5;
          }
        }
      }
      // nothing stands up on its own: a link balanced straight up topples
      for (let i = 1; i < n; i++) {
        const a = P[i - 1];
        const q = P[i];
        if (a.y - q.y > seg * 0.7) q.x += (this.facing || 1) * seg * 0.08;
        if (i < n - 1) {
          const c = P[i + 1];
          if (c.y < q.y - seg * 0.7 && (!pin || i + 1 !== k)) c.x += (this.facing || 1) * seg * 0.08;
        }
      }
      for (const q of P) this.W.collideCircle(q, this.infant ? 1 : 2);
      if (pin) {
        P[k].x = P[k].px = pin.x;
        P[k].y = P[k].py = pin.y;
      }
      this.pos.x = P[0].x;
      this.pos.y = P[0].y;
      const h = P[n - 1];
      const b = P[n - 2];
      this.headAng = Math.atan2(h.y - b.y, h.x - b.x);
      this.needle += (0 - this.needle) * U.approach(10, dt);
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
      const nk = A[A.length - 2];
      return [
        { x: nk.x, y: nk.y, r: r + 2, part: 'head' }, // first: the part a biter goes for
        { x: h.x, y: h.y, r: r, part: 'head' },
        { x: top.x, y: top.y, r: r + 2, part: 'body' },
        { x: this.pos.x, y: this.pos.y, r: r + 1, part: 'body' },
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
      return this.slack || this.archPtsLive();
    }
    // How far round a turn the arch is at w (0 at the shoulder, 1 at the
    // head end): the head goes over first and the body follows it round.
    turnAt(w) {
      const lag = 1.1;
      const s = (this.faceS + 1) / 2; // 0 = facing left, 1 = right
      const toward = this.facing > 0;
      const u = toward ? s : 1 - s;
      const k = U.clamp(u * (1 + lag) - (1 - w) * lag, 0, 1);
      return (toward ? k : 1 - k) * 2 - 1;
    }
    archPtsLive() {
      const L = this.L;
      const n = this.D.archN;
      const seg = this.D.archSeg * L;
      const out = [{ x: this.pos.x, y: this.pos.y }];
      let x = this.pos.x;
      let y = this.pos.y;
      let ang = 0;
      const noseAt = n - this.D.nose;
      let noseBase = 0;
      let prevD = 0;
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        // facing right: rises straight up out of the tail, curls over the top
        // and comes down; the nose droops on round, limp, until the
        // proboscis comes out (feeding or hunting), when it straightens into
        // a spear
        let cr;
        if (k < noseAt) {
          // measured from straight up and scaled by faceS, so a turn swings
          // the crook over the top instead of flipping it
          const crook = 3.0 * Math.min(1, k / (noseAt - 1)) + Math.sin(this.age * 1.7 + k * 0.6) * 0.03;
          cr = -Math.PI / 2 + crook * this.turnAt(k / Math.max(1, noseAt - 1));
        } else {
          // the nose hangs down, floppy, but the head looks where it's going:
          // the first nose segment leans most toward `look`, the rest droop
          const j = k - noseAt + 1;
          const hang = Math.PI / 2 + Math.sin(this.age * 2.3 + j * 0.9) * 0.1 * j;
          cr = U.lerpAngle(hang, this.look, Math.max(0.2, 0.75 - 0.2 * (j - 1)));
        }
        // straight (along aim) to curled: each segment turns the same way
        // round as the one before it, or an aim straight down could send
        // half the arch one way and half the other, a loop
        let dA = U.angleDiff(this.aim, cr);
        if (k === 0) {
          if (Math.abs(dA) > 2.8) dA = -this.facing * Math.abs(dA);
        } else if (dA - prevD > Math.PI) dA -= 2 * Math.PI;
        else if (dA - prevD < -Math.PI) dA += 2 * Math.PI;
        prevD = dA;
        ang = this.aim + dA * this.curl;
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
      // through a lunge and the swing back round the head the tail travels
      // with the body (it's carried, not dragged): left to trail it got
      // flung forward when the lunge stopped and wrapped into a ring
      const lunging = this.state === 'windup' || this.state === 'stab' || this.state === 'recover';
      if (lunging && this.lastPos) {
        const dx = (this.pos.x - this.lastPos.x) * 0.85;
        const dy = (this.pos.y - this.lastPos.y) * 0.85;
        for (let i = 1; i < P.length; i++) {
          P[i].x += dx;
          P[i].px += dx;
          P[i].y += dy;
          P[i].py += dy;
        }
      }
      this.lastPos = { x: this.pos.x, y: this.pos.y };
      P[0].x = P[0].px = this.pos.x;
      P[0].y = P[0].py = this.pos.y;
      this.tail.verlet(1, lunging ? 0.82 : 0.9, 0, grav === undefined ? this.D.tailGrav : grav, dt);
      this.tail.follow(1);
      this.tail.limitBend(this.infant ? 0.5 : 0.2, 2, P.length, 0.5); // stiff enough that a whip never wraps into a ring
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
      // (a big clearance in open air; just a little while threading a route
      // between ledges, or it balances against the walls and hangs there)
      const clear = this.state === 'leave' && this.diving ? 0 : this.routeT > 0 ? 14 * this.L : this.D.clear * this.L;
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
      // turn round only for a steady push the other way, and not again for
      // a while (bobbing and dodging used to flick it back and forth);
      // hunting decides its own facing
      const hunting = this.state === 'stalk' || this.state === 'windup' || this.state === 'stab' || this.state === 'recover';
      if (!hunting && this.curl > 0.5) {
        const back = Math.abs(this.vx) > 35 && Math.sign(this.vx) !== this.facing;
        this.turnWant = back ? (this.turnWant || 0) + dt : 0;
        if (this.turnWant > 0.4) this.turn();
      }
    }
    // While it's straight (winding up, after a stab) it can face whichever
    // side it's aiming at for free: curling back up the wrong way round tied
    // it in a loop.
    faceAim() {
      const f = Math.cos(this.aim) >= 0 ? 1 : -1;
      if (f === this.facing) return;
      this.facing = f;
      this.turnedAt = this.age;
      if (this.curl < 0.4) this.faceS = f;
    }
    turn() {
      if (this.age - (this.turnedAt || -9) < 1.5) return;
      this.facing = -this.facing;
      this.turnedAt = this.age;
      this.turnWant = 0;
    }
    // Somewhere open to drift to, near (x, y).
    airGoal(x, y, r) {
      const W = this.W;
      return RW.Nav.randomValid(W, AIR, x, y, r, (cx, cy) => W.surfDist(cx, cy) >= 3, 30);
    }

    // ------------------------------------------------------------- update --
    update(dt) {
      this.flap += dt * (this.infant ? 80 : 58); // a quick buzz
      if (!this.tick(dt)) {
        this.updateTail(dt);
        return;
      }
      this.huntCd -= dt;
      if (this.grabbedBy) {
        // caught: hangs from the jaws by the neck (an infant dies of it in a
        // moment)
        const g = this.grabbedBy;
        const hp = g.holdPoint();
        if (this.corpse) {
          // dead in the jaws: slack, hanging from the neck
          this.updateSlack(dt, hp);
          this.vx = this.vy = 0;
          this.updateTail(dt);
          return;
        }
        // the body goes slack and dangles from the jaws, forward and down
        const gx = g.x !== undefined ? g.x : hp.x;
        const gy = g.y !== undefined ? g.y : hp.y;
        const fwd = Math.hypot(hp.x - gx, hp.y - gy) > 1 ? Math.atan2(hp.y - gy, hp.x - gx) : Math.PI / 2;
        // (if hanging down would put it through the floor, it lies out
        // along the ground in front instead)
        const len = this.D.archN * this.D.archSeg * this.L * 0.8;
        let hang = fwd;
        for (const t of [0.55, 0.35, 0.15, 0]) {
          hang = U.lerpAngle(fwd, Math.PI / 2, t);
          if (!this.W.isSolidPt(hp.x + Math.cos(hang) * len, hp.y + Math.sin(hang) * len) && !this.W.isSolidPt(hp.x + Math.cos(hang) * len * 0.5, hp.y + Math.sin(hang) * len * 0.5)) break;
        }
        this.aim = U.lerpAngle(this.aim, hang + Math.PI, U.approach(5, dt)); // aim runs shoulder -> head
        this.curl += (0.15 - this.curl) * U.approach(4, dt);
        const nk = this.neckPt();
        this.pos.x += hp.x - nk.x;
        this.pos.y += hp.y - nk.y;
        this.vx = this.vy = 0;
        if (this.infant && !this.corpse && (this.dieT -= dt) <= 0) this.kill();
        else if (!this.corpse) this.struggle(dt);
        this.updateTail(dt);
        return;
      }
      if (this.infant) this.thinkInfant(dt);
      else this.thinkAdult(dt);
      // a steady swing over the top, about 0.8 s end to end
      this.faceS += U.clamp(this.facing - this.faceS, -2 * dt, 2 * dt);
      this.updateLook(dt);
      // ease the body between the crook and the straight stabbing pose
      // (slowly enough to read as a wind-up, quickly for a clinging infant)
      const straight = this.state === 'windup' || this.state === 'stab' || this.state === 'stuck' || this.state === 'cling';
      const rate = this.state === 'cling' ? 14 : this.state === 'windup' ? 6 : this.state === 'recover' ? 4.5 : 4;
      this.curl += ((straight ? 0 : this.holding ? 0.45 : 1) - this.curl) * U.approach(rate, dt);
      const out = (straight && this.state !== 'cling') || this.state === 'stalk' || this.holding;
      this.needle += ((out ? 1 : 0) - this.needle) * U.approach(out ? 10 : 3, dt);
      // wind-up and recovery: the head stays put and the body moves round it
      if (this.anchor && (this.state === 'windup' || this.state === 'recover')) {
        const h = this.headPt();
        this.pos.x += this.anchor.x - h.x;
        this.pos.y += this.anchor.y - h.y;
        // straightening out behind the head mustn't push the body off
        // screen: if it would, the head gives way instead
        const cx = U.clamp(this.pos.x, 6, this.W.w - 6);
        const cy = U.clamp(this.pos.y, 6, this.W.h - 6);
        this.anchor.x += cx - this.pos.x;
        this.anchor.y += cy - this.pos.y;
        this.pos.x = cx;
        this.pos.y = cy;
      } else this.anchor = null;
      if (!this.anchor) this.keepHeadIn(dt);
      this.updateTail(dt);
    }
    // The drooping head and neck stay on screen and out of the floor: if
    // they'd go past an edge or into solid ground, the body lifts clear.
    keepHeadIn(dt, edgesOnly) {
      const A = this.archPts();
      let dx = 0;
      let dy = 0;
      for (const q of [A[A.length - 2], A[A.length - 1]]) {
        if (q.x < 4) dx = Math.max(dx, 4 - q.x);
        else if (q.x > this.W.w - 4) dx = Math.min(dx, this.W.w - 4 - q.x);
        if (q.y > this.W.h - 4) dy = Math.min(dy, this.W.h - 4 - q.y);
        else if (q.y < 4) dy = Math.max(dy, 4 - q.y);
        else if (!edgesOnly && this.W.isSolidPt(q.x, q.y)) dy = Math.min(dy, -Math.min(3, 160 * dt));
      }
      if (!dx && !dy) return;
      this.pos.x += dx;
      this.pos.y += dy;
      if (dy < 0) this.vy = Math.min(this.vy, 0);
      if (dx) this.vx *= 0.5;
    }

    // The head looks toward the prey it's stalking, else the way it's
    // flying (never far upward: the nose still droops), else ahead.
    updateLook(dt) {
      let dx = this.facing;
      let dy = 0;
      const t = this.target || this.vengeance;
      if (t && (this.state === 'stalk' || this.state === 'windup')) {
        const tp = t.mainPoint();
        const A = this.archPts();
        const h = A[A.length - 1];
        dx = tp.x - h.x;
        dy = tp.y - h.y;
      } else if (Math.hypot(this.vx, this.vy) > 25) {
        dx = this.vx;
        dy = this.vy;
      }
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy = Math.max(dy / d, -0.2) + 0.35;
      if (dx * this.facing < 0) dx *= 0.3; // a glance back, not a twist round
      this.look = U.lerpAngle(this.look, Math.atan2(dy, dx), U.approach(3, dt));
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
      if (this.corpse) {
        // dead on the ground: a slack heap, draped over whatever it's on
        this.updateSlack(dt, null);
        this.vx = this.vy = 0;
        return;
      }
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
      // the arch goes slack and lies out flat (hanging straight down it
      // stood propped on its own head)
      // which way it lies: flat ahead, flat behind, or hanging off an edge,
      // whichever is clear of the ground
      const len = this.D.archN * this.D.archSeg * this.L * 0.9;
      const free = (a) =>
        !this.W.isSolidPt(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len) &&
        !this.W.isSolidPt(p.x + Math.cos(a) * len * 0.5, p.y + Math.sin(a) * len * 0.5);
      const ahead = this.facing > 0 ? 0 : Math.PI;
      let want = null;
      for (const a of [ahead, Math.PI - ahead, Math.PI / 2]) {
        if (free(a)) {
          want = a;
          break;
        }
      }
      if (want === null) {
        // boxed in: flat toward whichever side has more room
        const room = (a) => {
          let d = 0;
          while (d < len && !this.W.isSolidPt(p.x + Math.cos(a) * d, p.y)) d += 6;
          return d;
        };
        want = room(0) >= room(Math.PI) ? 0 : Math.PI;
      }
      // face the way it lies, so what's left of the crook humps over the top
      if (Math.abs(Math.cos(want)) > 0.5) this.facing = Math.cos(want) > 0 ? 1 : -1;
      this.faceS += U.clamp(this.facing - this.faceS, -2 * dt, 2 * dt);
      this.curl += (0.08 - this.curl) * U.approach(3, dt);
      this.aim = U.lerpAngle(this.aim, want, U.approach(4, dt));
      this.needle *= 0.98;
      this.keepHeadIn(dt, true);
    }

    // Transit: in by one den, a couple of meals (or a long while), out by the
    // farthest; the rain sends everyone to the nearest. Infants go with the
    // family's adult.
    wantsToLeave(dt) {
      if (this.shelterTime()) return true;
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
      const den = (!this.shelterTime() && this.family.exitDen) || this.eco.nearestDen(p.x, p.y);
      this.setState('leave');
      if (!den) return;
      // close to the pipe it stops shying off the wall round it and goes in
      // (head first or shoulder first, whichever gets there)
      const d = U.dist(p.x, p.y, den.x, den.y);
      this.diving = d < 160 * this.L;
      const wp = this.airWaypoint(dt, den.x, den.y);
      this.fly(dt, wp.x, wp.y, this.infant ? 140 : 120, this.diving ? 6 : 4);
      const h = this.headPt();
      if (d < 30 || U.dist(h.x, h.y, den.x, den.y) < 30) this.leave();
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
        const g = this.keepCatchOnScreen();
        this.fly(dt, g ? g.x : undefined, g ? g.y : undefined, g ? 60 : 0, g ? 3 : 0);
        if (this.eatT > 4) {
          // it sucks the insides out through the needle: the husk drops and
          // stays, still there for scavengers
          this.eco.drain(this.holding, this);
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
          this.startRecover();
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
      const wp = g && this.airWaypoint(dt, g.x, g.y);
      this.fly(dt, wp ? wp.x : undefined, wp ? wp.y : undefined, near ? 20 : 70, near ? 1.2 : 2);
    }

    // Hunting, in four smooth beats: line the head up at striking distance
    // from the target, wind up (the body straightens out behind the head
    // along the line to the target and draws back a little), fly in along
    // that line, and after a miss coast to a stop, curl back up and line up
    // again. During the wind-up and the recovery the head is the anchor
    // (`this.anchor`), so straightening and curling never yank it about.
    headPt() {
      const A = this.archPts();
      return A[A.length - 1];
    }
    hunt(dt, t) {
      const p = this.pos;
      const L = this.L;
      const tp = t.mainPoint();
      const head = this.headPt();
      const toT = Math.atan2(tp.y - head.y, tp.x - head.x);
      if (this.state === 'windup') {
        // keep lined up on it, drawing back slowly
        this.aim = U.lerpAngle(this.aim, toT, U.approach(5, dt));
        const back = 34 * L * (1 - Math.min(1, this.stateT / 0.6));
        this.anchor.x -= Math.cos(this.aim) * back * dt;
        this.anchor.y -= Math.sin(this.aim) * back * dt;
        this.vx = this.vy = 0;
        if (this.stateT > 0.6) {
          this.setState('stab');
          this.anchor = null;
          const tip = this.needleTip();
          // fly in far enough to run it through, quick off the mark
          this.lunge = U.clamp((U.dist(tip.x, tip.y, tp.x, tp.y) + 40 * L) / 0.3, 200, 560);
        }
        return;
      }
      if (this.state === 'stab') {
        const k = U.approach(22, dt);
        this.vx += (Math.cos(this.aim) * this.lunge - this.vx) * k;
        this.vy += (Math.sin(this.aim) * this.lunge - this.vy) * k;
        p.x += this.vx * dt;
        p.y += this.vy * dt;
        const tip = this.needleTip();
        // the needle finds whatever it's pointed at
        for (const c of this.eco.creatures) {
          if (c === this || c.dead || c.drained || c.leaving || c.species.startsWith('noodlefly') || c.grabbedBy) continue;
          if (c !== t && !this.diet.some((s) => (s.endsWith('*') ? c.species.startsWith(s.slice(0, -1)) : s === c.species))) continue;
          const parts = c.hitParts ? c.hitParts() : [{ x: c.x, y: c.y, r: 8 }];
          if (!parts.some((q) => U.dist(q.x, q.y, tip.x, tip.y) < q.r + 3)) continue;
          if (c.p && c.p.armored && !c.corpse) {
            // armoured (a red lizard, a large centipede): the needle wounds,
            // it doesn't kill outright
            if (!c.takeHit(0.5, this)) {
              this.startRecover();
              return;
            }
          }
          if (this.eco.cfg.ecosystem.predation && this.grab(c)) {
            if (!c.corpse) c.kill();
            this.eco.burst(tip.x, tip.y, c.bloodColor || '#2a1418', 6);
            this.vengeance = null;
            this.target = null;
            this.vx *= 0.2;
            this.vy *= 0.2;
          } else {
            c.stun(1.2);
            this.startRecover();
          }
          return;
        }
        if (this.W.isSolidPt(tip.x, tip.y)) {
          this.setState('stuck');
          this.vx = this.vy = 0;
          return;
        }
        if (this.stateT > 0.38 || p.x < 6 || p.x > this.W.w - 6 || p.y < 6 || p.y > this.W.h - 6) this.startRecover();
        return;
      }
      if (this.state === 'recover') {
        // missed: coast to a stop, curling back up around the head
        const f = Math.pow(0.002, dt);
        this.vx *= f;
        this.vy *= f;
        this.anchor.x += this.vx * dt;
        this.anchor.y += this.vy * dt;
        if (this.stateT > 0.5) {
          this.anchor = null;
          this.attempts = (this.attempts || 0) + 1;
          if (this.attempts > 5 && !this.vengeance) {
            this.target = null;
            this.huntCd = U.rand(10, 20);
            this.setState('drift');
          } else this.setState('stalk');
        }
        return;
      }
      // Stalking: bring the head round to striking distance, a little above
      // the target and in clear sight, turning to face it as it goes.
      if (this.state !== 'stalk') this.setState('stalk');
      this.anchor = null;
      const strike = (this.D.needleOut + 26) * L;
      const dx = head.x - tp.x;
      const dy = head.y - tp.y;
      const d = Math.hypot(dx, dy) || 1;
      const sx = tp.x + (dx / d) * strike;
      const sy = tp.y + (dy / d) * strike * 0.7 - strike * 0.3;
      // steer the shoulder so that the head arrives there
      const wp = this.airWaypoint(dt, p.x + (sx - head.x), p.y + (sy - head.y));
      this.fly(dt, wp.x, wp.y, this.vengeance ? 170 : 130, 3);
      if ((tp.x - head.x) * this.facing < -30 * L) this.turn(); // only turn round if it's well behind
      this.aim = U.lerpAngle(this.aim, toT, U.approach(3, dt));
      const lined = U.dist(head.x, head.y, sx, sy) < 18 * L;
      if (lined && this.stateT > (this.attempts ? 0.25 : 0.8) && this.W.lineClear(head.x, head.y, tp.x, tp.y)) {
        this.setState('windup');
        this.faceAim();
        this.anchor = { x: head.x, y: head.y };
        this.vx = this.vy = 0;
      }
      if (this.stateT > 14 && !this.vengeance) {
        this.target = null;
        this.huntCd = U.rand(8, 16);
        this.setState('drift');
      }
    }
    startRecover() {
      this.setState('recover');
      this.faceAim();
      const h = this.headPt();
      this.anchor = { x: h.x, y: h.y };
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
        const wp = this.airWaypoint(dt, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.6);
        this.fly(dt, wp.x, wp.y, 140, 3);
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
      const s = (this.faceS >= 0 ? 1 : -1) * (this.curl > 0.3 ? 1 : 0) || 1;
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
      const f = this.faceS >= 0 ? 1 : -1; // the wings swap over mid-turn
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
