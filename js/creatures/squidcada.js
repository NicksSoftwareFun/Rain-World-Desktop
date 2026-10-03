// Squidcadas: slugcat-sized fliers with a shiny oblong body, two pairs of
// thin buzzing wings and a fringe of squid arms round the face; white ones
// (black eyes, blue pupils) and black ones (blue eyes). Social: they fly in
// small groups, sometimes "play" by circling each other, tire and settle on a
// ledge to rest, snatch batflies and small centipedes, now and then headbutt a
// slugcat, and gang up on anything that grabs one of them. They keep clear of
// Daddy Long Legs, dropwigs and lizards (blue and white ones most of all).
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;
  const AIR = { fly: true, key: 'air' };
  const N_ARMS = 7;

  // White ones: pale body, black eye sockets with bright cyan pupils; black
  // ones: blue-black body, luminous cyan eyes with black pupils. Both have a
  // ragged teal patch where the head meets the body.
  const LOOKS = {
    white: { body: '#d6e0e2', gloss: '#f4f7f8', rim: '#c4d0d4', teal: '#4f9aa8', eye: '#0e1216', pupil: '#19c6ff', arm: '#dfe6e8', wing: '#cfd8d6' },
    black: { body: '#1a1a2c', gloss: '#3a3a58', rim: '#2e3a5a', teal: '#1b5560', eye: '#19d0ff', pupil: '#05050a', arm: '#22223a', wing: '#3f86a8' },
  };

  class Squidcada extends RW.Creature {
    constructor(eco, species, x, y, flock) {
      super(eco, species, x, y);
      const p = this.p;
      this.variant = Math.random() < (p.blackChance === undefined ? 0.35 : p.blackChance) ? 'black' : 'white';
      this.col = LOOKS[this.variant];
      this.L = p.size || 1;
      this.isFlier = true;
      this.pos = { x, y };
      this.vx = U.rand(-40, 40);
      this.vy = -30;
      this.ang = Math.PI / 2; // body axis, tail -> face (pi/2 = face down, hanging)
      this.flap = U.rand(0, 10);
      this.energy = U.rand(0.5, 1); // white ones have more stamina and lift
      this.stamina = this.variant === 'white' ? 1 : 0.7;
      this.flock = flock || { members: [] };
      this.flock.members.push(this);
      this.mass = 0.8;
      this.bloodColor = '#2c3434';
      this.diet = p.diet || ['batfly', 'centipede'];
      this.threats = ['daddy', 'lizard_*', 'dropwig', 'centipede_medium', 'centipede_large', 'noodlefly'];
      this.arms = [];
      for (let i = 0; i < N_ARMS; i++) this.arms.push(new RW.Chain(x, y, i % 2 ? 5 : 3, (i % 2 ? 4 : 3.4) * this.L, 0, 1));
      this.goal = null;
      this.goalT = 0;
      this.perceiveT = 0;
      this.fullT = U.rand(10, 30);
      this.butCd = U.rand(20, 50);
      this.state = 'fly';
    }
    mainPoint() {
      return this.pos;
    }
    bounds() {
      return [this.pos.x - 26, this.pos.y - 26, this.pos.x + 26, this.pos.y + 30];
    }
    carry(dx, dy) {
      if (this.state === 'rest' || this.corpse) this.shiftAll(dx, dy);
    }
    shiftAll(dx, dy) {
      this.pos.x += dx;
      this.pos.y += dy;
      for (const a of this.arms) a.shift(dx, dy);
    }
    face() {
      return { x: this.pos.x + Math.cos(this.ang) * 9.6 * this.L, y: this.pos.y + Math.sin(this.ang) * 9.6 * this.L };
    }
    holdPoint() {
      const f = this.face();
      return { x: f.x + Math.cos(this.ang) * 4, y: f.y + Math.sin(this.ang) * 4 };
    }
    hitParts() {
      return [{ x: this.pos.x, y: this.pos.y, r: 8 * this.L, part: 'body' }];
    }
    onRockHit() {
      this.stun(2.2);
    }
    onSpearHit() {
      this.die();
      return 'drop';
    }
    onRecovered() {
      this.vy = -140;
      this.setState('fly');
    }
    limp(dt) {
      const p = this.pos;
      this.vy += 650 * dt;
      this.vx *= Math.pow(0.4, dt);
      p.x += this.vx * dt;
      p.y += this.vy * dt;
      const c = this.W.collideCircle(p, 5 * this.L);
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx * 1.2;
          this.vy -= vn * c.ny * 1.2;
        }
        this.vx *= 0.7;
        this.ang = U.lerpAngle(this.ang, 0, U.approach(3, dt)); // flops onto its side
      }
      this.updateArms(dt);
    }
    // Squid arms hang from the face and trail as it flies.
    updateArms(dt) {
      const f = this.face();
      const px = -Math.sin(this.ang);
      const py = Math.cos(this.ang);
      for (let i = 0; i < this.arms.length; i++) {
        const P = this.arms[i].pts;
        const s = (i / (this.arms.length - 1) - 0.5) * 6.4 * this.L;
        P[0].x = P[0].px = f.x + px * s;
        P[0].y = P[0].py = f.y + py * s;
        // splayed out a little to either side, wriggling, trailing behind
        const splay = (i / (this.arms.length - 1) - 0.5) * 2 * 120;
        const wig = Math.sin(this.age * 7 + i * 1.3) * 18 + splay;
        this.arms[i].verlet(1, 0.86, Math.cos(this.ang) * 60 + px * wig, 260 + Math.sin(this.ang) * 60 + py * wig, dt);
        this.arms[i].follow(1);
      }
    }

    // Steer toward (tx, ty), fluttering about a bit on the way.
    fly(dt, tx, ty, maxSp, accel, jitter) {
      const p = this.pos;
      let ax = U.rand(-1, 1) * (jitter === undefined ? 160 : jitter);
      let ay = U.rand(-1, 1) * (jitter === undefined ? 160 : jitter) + Math.sin(this.age * 3.1 + this.id) * 20;
      if (tx !== undefined) {
        const dx = tx - p.x;
        const dy = ty - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const want = Math.min(maxSp, d * 2.5);
        ax += ((dx / d) * want - this.vx) * accel;
        ay += ((dy / d) * want - this.vy) * accel;
      } else {
        ax -= this.vx * 2;
        ay -= this.vy * 2;
      }
      const clear = this.routeT > 0 ? 12 : 26;
      const s = this.W.nearestSurface(p.x, p.y, clear, null);
      if (s && this.state !== 'land' && !(this.state === 'leave' && this.diving)) {
        const k = (clear - s.d) * 14;
        ax += s.nx * k;
        ay += s.ny * k;
      }
      this.vx += ax * dt;
      this.vy += ay * dt;
      p.x += this.vx * dt;
      p.y += this.vy * dt;
      const c = this.W.collideCircle(p, 6 * this.L);
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx * (this.state === 'butt' ? 1.6 : 1); // a headbutt bounces off walls
          this.vy -= vn * c.ny * (this.state === 'butt' ? 1.6 : 1);
        }
      }
      p.x = U.clamp(p.x, 8, this.W.w - 8);
      p.y = U.clamp(p.y, 8, this.W.h - 8);
      // body angle: along the flight when it's going somewhere, hanging face
      // down when it hovers
      const sp = Math.hypot(this.vx, this.vy);
      const want = sp > 45 ? Math.atan2(this.vy * 0.6, this.vx) : Math.PI / 2 + Math.sin(this.age * 1.3 + this.id) * 0.3;
      this.ang = U.lerpAngle(this.ang, want, U.approach(sp > 45 ? 5 : 2.5, dt));
      this.energy -= dt * 0.02 / this.stamina;
    }
    airGoal(x, y, r) {
      const W = this.W;
      return RW.Nav.randomValid(W, AIR, x, y, r, (cx, cy) => W.surfDist(cx, cy) >= 2, 30);
    }
    // Somewhere to land: the top of a ledge, window or the taskbar.
    perch() {
      const W = this.W;
      const p = this.pos;
      let best = null;
      let bd = 260 * 260;
      for (const s of W.solids) {
        if (s.kind === 'edge' || s.kind === 'beam' || s.w < 30) continue;
        const x = U.clamp(p.x, s.x + 10, s.x + s.w - 10);
        const y = s.y - 6;
        if (W.isSolidPt(x, y - 4)) continue;
        const d = U.dist2(x, y, p.x, p.y);
        if (d < bd) {
          bd = d;
          best = { x, y };
        }
      }
      return best;
    }

    update(dt) {
      this.flap += dt * 44;
      if (!this.tick(dt)) return;
      if (this.grabbedBy) {
        const hp = this.grabbedBy.holdPoint();
        this.pos.x = hp.x;
        this.pos.y = hp.y;
        this.vx = this.vy = 0;
        this.ang = U.lerpAngle(this.ang, -Math.PI / 2, U.approach(3, dt));
        if (!this.corpse) {
          this.flap += dt * 20; // buzzing to get free
          this.struggle(dt);
        }
        this.updateArms(dt);
        return;
      }
      this.think(dt);
      this.updateArms(dt);
    }

    think(dt) {
      const p = this.pos;
      const eco = this.eco;
      this.perceiveT -= dt;
      const perceive = this.perceiveT <= 0;
      if (perceive) this.perceiveT = 0.25;
      this.fullT -= dt;
      this.butCd -= dt;

      if (this.wantsToLeave(dt)) {
        this.setState('leave');
        const den = eco.nearestDen(p.x, p.y);
        if (den) {
          const wp = this.airWaypoint(dt, den.x, den.y);
          this.fly(dt, wp.x, wp.y, 130, 4, 60);
          this.diving = U.dist(p.x, p.y, den.x, den.y) < 120;
          if (U.dist(p.x, p.y, den.x, den.y) < 28) this.leave();
        }
        return;
      }
      if (this.holding) {
        // eating: hovering, arms wrapped round the catch
        this.setState('eat');
        this.eatT = (this.eatT || 0) + dt;
        const g = this.keepCatchOnScreen();
        this.fly(dt, g ? g.x : undefined, g ? g.y : undefined, g ? 60 : 0, g ? 3 : 0, 40);
        if (this.eatT > 3) {
          eco.consume(this.holding, this);
          this.holding = null;
          this.eatT = 0;
          this.fullT = U.rand(40, 80);
          this.setState('fly');
        }
        return;
      }
      // Afraid: blue and white lizards and the rot from a distance, other
      // lizards and the rest only up close.
      if (perceive) {
        this.threat = this.nearestOf(this.threats, 150, (c) => {
          if (c.lurking || c.holding) return false;
          const d = U.dist(c.x, c.y, p.x, p.y);
          const far = c.species === 'daddy' || c.species === 'lizard_blue' || c.species === 'lizard_white';
          return d < (far ? 150 : 80);
        });
      }
      if (this.threat && !this.threat.dead && this.state !== 'butt') {
        const t = this.threat;
        const dx = p.x - t.x;
        const dy = p.y - t.y;
        const d = Math.hypot(dx, dy) || 1;
        this.setState('flee');
        this.fly(dt, p.x + (dx / d) * 120, p.y + (dy / d) * 60 - 40, 170, 5, 120);
        return;
      }
      // A flockmate in something's jaws: go for whatever has it.
      if (perceive && this.state !== 'butt') {
        for (const m of this.flock.members) {
          const g = m !== this && !m.dead && !m.corpse && m.grabbedBy;
          if (g && !g.isHand && U.dist(g.x, g.y, p.x, p.y) < 320) this.startButt(g);
        }
      }
      if (this.state === 'butt') return this.stepButt(dt);
      // Tired: settle on a ledge for a breather.
      if (this.state === 'rest' || this.state === 'land') return this.stepRest(dt);
      if (this.energy < 0.15 && perceive) {
        this.landAt = this.perch();
        if (this.landAt) {
          this.setState('land');
          return;
        }
      }
      // Hungry: snatch a batfly or a small centipede.
      if (perceive && this.fullT <= 0 && this.state !== 'hunt') {
        const prey = this.nearestOf(this.diet, 220, (c) => c.canBeGrabbed() && (c.size || 1) <= 1 && this.canSee(c.x, c.y, 220));
        if (prey) {
          this.prey = prey;
          this.setState('hunt');
        }
      }
      if (this.state === 'hunt') {
        const prey = this.prey;
        if (!prey || prey.dead || prey.corpse || prey.grabbedBy || prey.leaving || this.stateT > 8) {
          this.prey = null;
          this.setState('fly');
        } else {
          this.fly(dt, prey.x, prey.y - 4, 160, 4, 60);
          const f = this.holdPoint();
          if (U.dist(f.x, f.y, prey.x, prey.y) < 12 && eco.cfg.ecosystem.predation && this.grab(prey)) {
            if (!prey.corpse) prey.kill();
            this.prey = null;
          }
          return;
        }
      }
      // Now and then, a headbutt for a slugcat.
      if (perceive && this.butCd <= 0) {
        this.butCd = U.rand(25, 60);
        const s = this.nearestOf(['slugcat'], 180, (c) => this.canSee(c.x, c.y, 180));
        if (s && Math.random() < 0.6) return this.startButt(s);
      }
      // Play: a pair circling each other for a while.
      if (this.state === 'play') {
        const m = this.mate;
        if (!m || m.dead || m.corpse || m.state !== 'play' || this.stateT > this.playFor) {
          this.setState('fly');
        } else {
          const cx = (p.x + m.pos.x) / 2;
          const cy = (p.y + m.pos.y) / 2;
          const a = Math.atan2(p.y - cy, p.x - cx) + 2.4 * dt * 3;
          this.fly(dt, cx + Math.cos(a) * 22, cy + Math.sin(a) * 22, 150, 6, 40);
          return;
        }
      }
      if (perceive && Math.random() < 0.02) {
        const m = this.flock.members.find((o) => o !== this && !o.dead && !o.corpse && o.state === 'fly' && U.dist(o.pos.x, o.pos.y, p.x, p.y) < 120);
        if (m) {
          this.mate = m;
          m.mate = this;
          this.playFor = m.playFor = U.rand(3, 6);
          this.setState('play');
          m.setState('play');
          return;
        }
      }
      // Flying about with the flock: goals near the flock's middle.
      this.setState('fly');
      this.goalT -= dt;
      if (!this.goal || this.goalT <= 0) {
        let cx = p.x;
        let cy = p.y;
        let n = 1;
        for (const m of this.flock.members) {
          if (m === this || m.dead || m.corpse || m.leaving) continue;
          cx += m.pos.x;
          cy += m.pos.y;
          n++;
        }
        this.goal = this.airGoal(cx / n, cy / n, 220);
        this.goalT = U.rand(2, 5);
      }
      const g = this.goal;
      const wp = g && this.airWaypoint(dt, g.x, g.y);
      this.fly(dt, wp ? wp.x : undefined, wp ? wp.y : undefined, 90, 2.2);
    }

    // Headbutt: pause, flutter, then dart straight at it; bounce off things.
    startButt(target) {
      this.butt = { target, t: 0, dir: null };
      this.setState('butt');
    }
    stepButt(dt) {
      const b = this.butt;
      const p = this.pos;
      b.t += dt;
      const t = b.target;
      if (!t || t.dead || t.leaving) {
        this.setState('fly');
        return;
      }
      if (b.t < 0.45) {
        // hang there buzzing, lined up on it
        this.vx *= 0.85;
        this.vy *= 0.85;
        this.flap += dt * 40;
        this.ang = U.lerpAngle(this.ang, Math.atan2(t.y - p.y, t.x - p.x), U.approach(10, dt));
        p.x += this.vx * dt;
        p.y += this.vy * dt;
        return;
      }
      if (!b.dir) {
        const a = Math.atan2(t.y - p.y, t.x - p.x);
        b.dir = { x: Math.cos(a), y: Math.sin(a) };
        this.vx = b.dir.x * 330;
        this.vy = b.dir.y * 330;
      }
      this.vx *= Math.pow(0.35, dt);
      this.vy *= Math.pow(0.35, dt);
      this.fly(dt, undefined, undefined, 0, 0, 0);
      this.ang = Math.atan2(this.vy, this.vx);
      if (!b.hit && U.dist(p.x, p.y, t.x, t.y) < 14) {
        // a thump: knocks it about (and loosens its grip on a flockmate)
        b.hit = true;
        if (t.holding && t.holding.species === 'squidcada') t.release();
        if (t.stun) t.stun(0.5);
        if ('vx' in t) {
          t.vx += b.dir.x * 120;
          t.vy += b.dir.y * 60 - 60;
        }
      }
      if (b.t > 2 || Math.hypot(this.vx, this.vy) < 40) this.setState('fly');
    }
    stepRest(dt) {
      const p = this.pos;
      const at = this.landAt;
      if (this.state === 'land') {
        if (!at) return this.setState('fly');
        const wp = this.airWaypoint(dt, at.x, at.y);
        this.fly(dt, wp.x, wp.y, 80, 3, 30);
        if (U.dist(p.x, p.y, at.x, at.y) < 6 || this.stateT > 6) this.setState('rest');
        return;
      }
      // resting on the ledge, wings folded, getting its breath back
      this.vx = this.vy = 0;
      if (at) {
        p.x += (at.x - p.x) * 0.2;
        p.y += (at.y - p.y) * 0.2;
      }
      this.ang = U.lerpAngle(this.ang, this.vx >= 0 ? 0.15 : Math.PI - 0.15, U.approach(4, dt));
      this.energy = Math.min(1, this.energy + dt * 0.12);
      if ((this.energy > 0.95 && this.stateT > 4) || this.W.isSolidPt(p.x, p.y)) {
        this.vy = -90;
        this.setState('fly');
      }
    }

    // ------------------------------------------------------------- drawing --
    draw(ctx) {
      const p = this.pos;
      const L = this.L;
      const col = this.col;
      const ap = this.eco.artPx || 1;
      const flying = !this.corpse && !(this.stunT > 0) && this.state !== 'rest' && !(this.grabbedBy && this.grabbedBy.isHand);
      ctx.save();
      ctx.globalAlpha = this.alpha;
      // squid arms, body-coloured, hanging from the face
      ctx.strokeStyle = col.arm;
      ctx.lineWidth = Math.max(1.3 * ap, 1.3 * L);
      ctx.beginPath();
      for (const a of this.arms) {
        const P = a.pts;
        ctx.moveTo(P[0].x, P[0].y);
        for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y);
      }
      ctx.stroke();
      ctx.translate(p.x, p.y);
      ctx.rotate(this.ang);
      // x runs from the tail point (-) to the face (+)
      if (flying) this.drawWings(ctx, false);
      // a pointed, bullet-shaped shiny body
      ctx.fillStyle = col.body;
      ctx.beginPath();
      ctx.moveTo(-12 * L, 0);
      ctx.quadraticCurveTo(-8 * L, -4.6 * L, -1 * L, -4.8 * L);
      ctx.quadraticCurveTo(4 * L, -4.6 * L, 5.2 * L, -2.6 * L);
      ctx.lineTo(5.2 * L, 2.6 * L);
      ctx.quadraticCurveTo(4 * L, 4.6 * L, -1 * L, 4.8 * L);
      ctx.quadraticCurveTo(-8 * L, 4.6 * L, -12 * L, 0);
      ctx.fill();
      // a subtle lower rim and one gloss patch up top
      ctx.fillStyle = col.rim;
      ctx.fillRect(-7 * L, 3.2 * L, 9 * L, Math.max(ap, 1.2 * L));
      ctx.fillStyle = col.gloss;
      ctx.fillRect(-6 * L, -3.6 * L, 7 * L, Math.max(ap, 2 * L));
      // the ragged teal patch where the head meets the body
      ctx.fillStyle = col.teal;
      const st = Math.max(ap, 1.2 * L);
      ctx.fillRect(2.4 * L, -3.6 * L, 2.6 * L, 7.2 * L);
      ctx.fillRect(1.2 * L, -2.2 * L, st, 3.6 * L);
      ctx.fillRect(0.2 * L, -0.6 * L, st, 2.2 * L);
      ctx.fillRect(4.6 * L, -4 * L, st, 2 * L);
      // a small rounded head
      ctx.fillStyle = col.body;
      ctx.beginPath();
      ctx.ellipse(7.4 * L, 0, 2.6 * L, 3 * L, 0, 0, U.TAU);
      ctx.fill();
      // eyes, wide-set at the front of the head, framed in teal (X'd out
      // when dead)
      const es = Math.max(2 * ap, 2 * L);
      ctx.fillStyle = col.teal;
      for (const sd of [-1, 1]) ctx.fillRect(8.2 * L - es / 2 - ap, sd * 1.9 * L - es / 2 - ap, es + 2 * ap, es + 2 * ap);
      for (const sd of [-1, 1]) {
        const ex = 8.2 * L;
        const ey = sd * 1.9 * L;
        if (this.corpse) {
          ctx.strokeStyle = this.variant === 'white' ? col.eye : col.pupil;
          ctx.lineWidth = ap * 0.8;
          ctx.beginPath();
          ctx.moveTo(ex - es / 2, ey - es / 2);
          ctx.lineTo(ex + es / 2, ey + es / 2);
          ctx.moveTo(ex + es / 2, ey - es / 2);
          ctx.lineTo(ex - es / 2, ey + es / 2);
          ctx.stroke();
          continue;
        }
        ctx.fillStyle = col.eye;
        ctx.fillRect(ex - es / 2, ey - es / 2, es, es);
        ctx.fillStyle = col.pupil;
        const ps = Math.max(ap, es * 0.5);
        ctx.fillRect(ex - ps / 2 + 0.4 * L, ey - ps / 2, ps, ps);
      }
      if (!flying && !this.corpse) this.drawWings(ctx, true);
      ctx.restore();
      this.drawDebug(ctx);
    }
    // Two pairs of thin wings off the back: a buzzing blur in flight, folded
    // flat along the back at rest.
    drawWings(ctx, folded) {
      const L = this.L;
      const ap = this.eco.artPx || 1;
      // two pairs on the flanks, each a single solid blade swept back from
      // the body (white ones' tips tinted teal); folded flat along the back
      // at rest
      const back = Math.PI - 0.87;
      const wings = folded
        ? [[1, -3.6, Math.PI + 0.08], [-3, -3.6, Math.PI + 0.2]]
        : [[1, -3.6, -back], [1, 3.6, back], [-3, -3.6, -(back + 0.35)], [-3, 3.6, back + 0.35]];
      ctx.lineCap = 'butt';
      ctx.lineWidth = Math.max(1.5 * ap, 1.6 * L);
      wings.forEach(([rx, ry, base], i) => {
        const a = base + (folded ? 0 : Math.sin(this.flap + i * 1.7) * 0.4 * Math.sign(ry));
        const len = (folded ? 15 : 21) * L;
        const x0 = rx * L;
        const y0 = ry * L;
        const x1 = x0 + Math.cos(a) * len;
        const y1 = y0 + Math.sin(a) * len;
        ctx.strokeStyle = this.col.wing;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        if (this.variant === 'white' && !folded) {
          ctx.strokeStyle = '#5aa8b4';
          ctx.beginPath();
          ctx.moveTo(x0 + (x1 - x0) * 0.72, y0 + (y1 - y0) * 0.72);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
  }

  RW.Creatures.Squidcada = Squidcada;
})();
