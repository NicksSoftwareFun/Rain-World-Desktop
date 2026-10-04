// Centipedes: segmented armoured crawlers that ripple along any surface,
// legs moving in a travelling wave. Small ones are shy prey; medium and large
// adults hunt, shocking what they catch before carrying it off to eat.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;
  const Nav = RW.Nav;

  const GRAV = 900;

  class Centipede extends RW.Creature {
    constructor(eco, species, x, y) {
      super(eco, species, x, y);
      const p = this.p;
      const S = (this.size = p.size || 1);
      const r = p.segments || [6, 9];
      this.n = U.randInt(r[0], r[1]);
      this.chain = new RW.Chain(x, y, this.n, 6.5 * S, U.sign(), 0);
      this.diet = p.diet || [];
      this.hp = 1;
      this.fullT = p.aggressive ? 0 : U.rand(0, 20); // the aggressive kind arrives hungry
      this.eatT = 0;
      this.cols = p.colors || ['#e3892c', '#e9b23a', '#8f2f17', '#7a2614'];
      this.vx = 0;
      this.vy = 0;
      this.caps = { walls: true, ceil: true, poles: true, fall: true, wallCost: 1.1, ceilCost: 1.3 };
      this.mask = { floor: true, walls: true, ceil: true, poles: true };
      this.maskNoPole = { floor: true, walls: true, ceil: true, poles: false };
      this.pather = new RW.Pather(this, this.caps);
      this.ux = 0;
      this.uy = -1;
      this.phase = 0;
      this.hue = U.rand(0, 1);
      this.threats = p.threats || ['lizard_*', 'daddy', 'dropwig', 'centipede_medium', 'centipede_large'];
      this.bloodColor = '#5a2a12';
      this.perceiveT = 0;
      this.idleT = 0;
    }
    mainPoint() {
      return this.chain.pts[0];
    }
    bounds() {
      return RW.Creature.ptsBounds(this.chain.pts, 16 * this.size);
    }
    holdPoint() {
      if (this.coil) return { x: this.coil.cx, y: this.coil.cy }; // in the middle of the coil
      const P = this.chain.pts;
      const a = Math.atan2(P[0].y - P[1].y, P[0].x - P[1].x);
      return { x: P[0].x + Math.cos(a) * 6 * this.size, y: P[0].y + Math.sin(a) * 6 * this.size };
    }
    carry(dx, dy) {
      this.chain.shift(dx, dy);
    }
    // --- weapons
    hitParts() {
      const P = this.chain.pts;
      const r = 4 * (this.size || 1);
      const out = [];
      for (let i = 0; i < P.length; i += 2) out.push({ x: P[i].x, y: P[i].y, r, part: i ? 'body' : 'head' });
      return out;
    }
    limp(dt) {
      const W = this.W;
      const P = this.chain.pts;
      const h = P[0];
      this.vy += GRAV * dt;
      this.vx *= Math.pow(0.3, dt);
      h.x += this.vx * dt;
      h.y += this.vy * dt;
      const c = W.collideCircle(h, 3 * this.size);
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx;
          this.vy -= vn * c.ny;
        }
        this.vx *= 0.8;
      }
      this.chain.verlet(1, 0.9, 0, GRAV, dt);
      this.chain.follow(1);
      this.chain.collide(W, 2.5 * this.size, 1);
      this.phase += dt * 6;
    }
    // Rocks stun the small ones well, adults barely; a spear skewers a small
    // one outright but takes a few to kill an adult.
    onRockHit() {
      this.stun(1.5 / (this.size * this.size));
    }
    onSpearHit(w) {
      if (this.size <= 1) {
        this.remove();
        return 'skewer';
      }
      this.hp -= 0.6 / (this.p.toughness || this.size);
      if (this.holding) this.release();
      if (this.hp <= 0) {
        this.die(14);
        return 'drop';
      }
      const t = w.thrower || w;
      const g = this.fleeGoal(this.caps, t.x, t.y, 300);
      if (g) this.pather.setGoal(g.x, g.y, true);
      this.setState('flee');
      return 'embed';
    }
    onBitten(by) {
      this.setState('flee');
      const g = this.fleeGoal(this.caps, by.x, by.y, 300);
      if (g) this.pather.setGoal(g.x, g.y, true);
    }

    think(dt) {
      const h = this.chain.pts[0];
      this.speed = this.p.speed || 55;
      this.perceiveT -= dt;
      if (this.wantsToLeave(dt)) {
        this.setState('leave');
        const den = this.eco.nearestDen(h.x, h.y);
        if (den) {
          this.pather.setGoal(den.x, den.y);
          if (U.dist(h.x, h.y, den.x, den.y) < 20) this.leave();
        }
        return;
      }
      // Adults: shock what we catch, then eat it.
      if (this.holding) {
        const prey = this.holding;
        this.setState('eat');
        this.pather.clear();
        this.eatT += dt;
        if (!prey.corpse && this.eatT > 0.7) prey.kill();
        if (this.eatT > 4) {
          this.eco.consume(prey, this);
          this.holding = null;
          this.eatT = 0;
          this.fullT = this.p.aggressive ? U.rand(8, 18) : U.rand(40, 80);
        }
        return;
      }
      this.fullT -= dt;
      const perceive = this.perceiveT <= 0;
      // the aggressive kind lashes out at anything that comes too close,
      // hungry or not (not at its own kind or a Daddy Long Legs)
      this.lashCd = (this.lashCd || 0) - dt;
      if (this.p.aggressive && perceive && this.lashCd <= 0) {
        const r = 22 * this.size;
        for (const c of this.eco.creatures) {
          if (c === this || c.dead || c.corpse || c.leaving || c.grabbedBy || c.species === this.species || c.species === 'daddy') continue;
          const hp = c.hitParts ? c.hitParts()[0] : { x: c.x, y: c.y, r: 6 };
          if (U.dist(h.x, h.y, hp.x, hp.y) > r + hp.r) continue;
          this.eco.burst(hp.x, hp.y, '#fff2a0', 10);
          c.stun(2);
          this.lashCd = 3;
          // and if it's food, it's dinner
          if (this.diet.some((s) => (s.endsWith('*') ? c.species.startsWith(s.slice(0, -1)) : s === c.species)) && this.state !== 'hunt') {
            this.prey = c;
            this.setState('hunt');
          }
          break;
        }
      }
      // the red feud: any red lizard is to be dealt with, now
      if (this.p.red && perceive && !this.holding) {
        const foe = this.redFoe();
        if (foe) {
          if (this.state !== 'hunt' || this.prey !== foe) this.setState('hunt');
          this.prey = foe;
          this.stateT = 0;
        }
      }
      this.shockCd = (this.shockCd || 0) - dt;
      if (perceive && this.diet.length && this.fullT <= 0 && this.state !== 'hunt' && this.state !== 'flee') {
        const v = this.p.vision || 200 * this.size;
        const prey = this.nearestOf(this.diet, v, (c) => c.canBeGrabbed() && c.nearGround(32 * this.size) && this.canSee(c.x, c.y, v)) || this.nearestCorpse(this.diet, v * 0.7);
        if (prey) {
          this.prey = prey;
          this.setState('hunt');
        }
      }
      // danger first: drop the hunt and let the threat check below run
      if (this.state === 'hunt' && perceive && this.threatNear(170)) this.setState('wander');
      if (this.state === 'hunt') {
        const prey = this.prey;
        if (!prey || prey.dead || prey.leaving || prey.grabbedBy || this.stateT > (this.p.aggressive ? 35 : 18)) {
          this.prey = null;
          this.setState('wander');
        } else {
          this.speed = this.p.huntSpeed || this.speed * 1.8;
          this.pather.interval = 0.5;
          this.pather.setGoal(prey.x, prey.y);
          const hp = prey.hitParts()[0];
          if (U.dist(h.x, h.y, hp.x, hp.y) < 9 * this.size + hp.r * 0.5) {
            // the shock: a crackle of sparks and the prey goes stiff
            if (prey.p.armored && !prey.corpse) {
              // armoured (a red feud): it wears it down, shock by shock
              if (this.shockCd <= 0) {
                this.shockCd = 1.4;
                this.eco.burst(hp.x, hp.y, '#fff2a0', 10);
                prey.takeHit(0.6 * U.rand(0.8, 1.2), this);
              }
              return;
            }
            this.eco.burst(hp.x, hp.y, '#fff2a0', 8);
            if (!prey.corpse) prey.stun(1.5);
            if (this.eco.cfg.ecosystem.predation && this.grab(prey)) {
              this.eatT = 0;
              this.prey = null;
            } else {
              this.setState('wander');
            }
          }
          return;
        }
      }
      if (this.perceiveT <= 0) {
        this.perceiveT = 0.4;
        const t = this.threatNear(170);
        if (t && this.state !== 'flee') {
          this.setState('flee');
          const g = this.fleeGoal(this.caps, t.x, t.y, 300);
          if (g) this.pather.setGoal(g.x, g.y, true);
        }
      }
      if (this.state === 'flee') {
        this.speed *= 2.2;
        if (this.stateT > 3) this.setState('wander');
        return;
      }
      if (this.state === 'idle') {
        this.idleT -= dt;
        this.pather.clear();
        if (this.idleT <= 0) this.setState('wander');
        return;
      }
      this.setState('wander');
      if (this.readyForGoal(dt, 20)) {
        if (this.pather.goal && Math.random() < 0.4) {
          this.setState('idle');
          this.idleT = U.rand(2, 6);
          return;
        }
        const g = this.wanderGoal(this.caps, 400);
        if (g) this.pather.setGoal(g.x, g.y, true);
        this.stateT = 0;
      }
    }

    update(dt) {
      if (!this.tick(dt)) return;
      const W = this.W;
      const P = this.chain.pts;
      const h = P[0];
      if (this.grabbedBy) {
        const hp = this.grabbedBy.holdPoint();
        h.x = hp.x;
        h.y = hp.y;
        this.chain.verlet(1, 0.9, 0, GRAV, dt);
        this.chain.follow(1);
        if (!this.grabbedBy.isHand && !this.corpse) this.phase += dt * 30;
        this.struggle(dt);
        return;
      }
      this.think(dt);
      // Medium and large ones ball up round what they're eating: the body
      // wound into a coil with the catch in the middle, slowly turning,
      // squeezing and writhing, legs twitching.
      if (this.holding && this.state === 'eat' && this.size >= 1.5) {
        this.stepCoil(dt);
        return;
      }
      this.coil = null;
      this.hp = Math.min(1, (this.hp === undefined ? 1 : this.hp) + dt * 0.015); // wounds mend slowly
      this.pather.update(dt, h.x, h.y);
      // (a path node counts as reached within the body's own grip offset
      // too: held off a surface by its size, a big one could otherwise sit a
      // pole's width from the node, pushing at it forever)
      this.pather.advance(h.x, h.y, W.cell * 0.8 + 3 * this.size);
      // Poles only count when the path uses one (see lizard.js). Grip range
      // covers path nodes that sit up to a cell from a partly covered wall.
      // It also keeps its grip on a pole it's still on (or just came along)
      // while stepping off it toward a ledge: let go early and it fell.
      const pn = this.pather.current();
      const onPole = W.pole(W.cellX(h.x), W.cellY(h.y));
      const mask = (pn && W.pole(pn.cx, pn.cy) && !W.solid(pn.cx, pn.cy + 1)) || onPole ? this.mask : this.maskNoPole;
      const S = this.size;
      // a long reach: a surface can sit most of a cell away from the path
      // node's centre (an underside in the top of its cell), and a centipede
      // bridges that rather than drop
      let g = W.nearestSurface(h.x, h.y, Math.max(34, 24 * S), mask);
      if (this.dropT > 0) {
        this.dropT -= dt;
        g = null;
      }
      const node = this.pather.current();
      // A head at each end: when the way on is behind it, it doesn't turn
      // round, it just goes the other way (the far end leads).
      if (node && !this.coil && P.length > 2) {
        const bx = h.x - P[1].x;
        const by = h.y - P[1].y;
        const bl = Math.hypot(bx, by) || 1;
        const nx = node.x - h.x;
        const ny = node.y - h.y;
        const nl = Math.hypot(nx, ny) || 1;
        if ((bx / bl) * (nx / nl) + (by / bl) * (ny / nl) < -0.4 && nl > W.cell * 0.6) this.reverse();
      }
      let dvx = 0;
      let dvy = 0;
      let leaving = false;
      if (node) {
        let ty = node.y;
        if (node.type === Nav.FALL && g) {
          if (Math.abs(node.x - h.x) < W.cell * 0.6) this.dropT = 0.35;
          else ty = h.y;
        }
        // stepping off a pole: climb level with the next node first, then
        // across (cutting the corner left it holding nothing mid-step)
        let tx = node.x;
        // (only where the pole reaches that high or low)
        if (g && g.id && g.id.startsWith('pole') && !W.pole(node.cx, node.cy) && Math.abs(ty - h.y) > 6 && W.pole(W.cellX(h.x), node.cy)) tx = h.x;
        const dx = tx - h.x;
        const dy = ty - h.y;
        const d = Math.hypot(dx, dy) || 1;
        dvx = (dx / d) * this.speed;
        dvy = (dy / d) * this.speed;
        leaving = node.type === Nav.FALL || (g && (dx / d) * g.nx + (dy / d) * g.ny > 0.6);
      }
      if (g) {
        const k = U.approach(8, dt);
        this.vx += (dvx - this.vx) * k;
        this.vy += (dvy - this.vy) * k;
      } else {
        this.vy += GRAV * dt;
      }
      // where every link was, to keep this frame's moves smooth (below)
      const before = P.map((q) => ({ x: q.x, y: q.y }));
      h.x += this.vx * dt;
      h.y += this.vy * dt;
      // (a pole it wraps round, close in; anything flat it rides 5*S off)
      const hold = (s) => (s.id && s.id.startsWith('pole') ? 1.5 * S : 5 * S);
      // the pull onto a surface eases in: a new nearest surface (a corner, a
      // pole beside a ledge) gets slid onto, not jumped to
      const maxPull = 45 * S * dt;
      if (g && !leaving) {
        const e = U.clamp((g.d - hold(g)) * 0.3, -maxPull, maxPull);
        h.x -= g.nx * e;
        h.y -= g.ny * e;
        this.contactId = g.id;
      }
      const c = W.collideCircle(h, 3.5 * S);
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx;
          this.vy -= vn * c.ny;
        }
      }
      this.chain.verlet(1, 0.8, 0, g ? 0 : GRAV, dt);
      this.chain.follow(1);
      // a segmented body curls round a turn; it never folds back on itself
      this.chain.limitBend(0.7, 2, P.length, 0.6);
      for (let i = 1; i < P.length; i++) {
        const s = W.nearestSurface(P[i].x, P[i].y, 18 * S, mask);
        if (s) {
          const e = U.clamp((s.d - hold(s)) * 0.35, -maxPull, maxPull);
          P[i].x -= s.nx * e;
          P[i].y -= s.ny * e;
        }
        W.collideCircle(P[i], 3 * S);
      }
      // No link jumps: holding on, none moves much further in a frame than
      // the body is travelling, so a correction (a new surface, the bend
      // limit) plays out over a few frames. Falling, it's free.
      if (g) {
        const lim = Math.max(1.2 * S, Math.hypot(this.vx, this.vy) * dt * 2.2);
        for (let i = 1; i < P.length; i++) {
          const mx = P[i].x - before[i].x;
          const my = P[i].y - before[i].y;
          const m = Math.hypot(mx, my);
          if (m > lim) {
            P[i].x = before[i].x + (mx * lim) / m;
            P[i].y = before[i].y + (my * lim) / m;
          }
        }
      }
      // gripping a pole: seen from behind, climbing up its middle (legs both
      // sides, the whole plate showing); eases in and out
      const gripPole = g && g.id && g.id.startsWith('pole') ? 1 : 0;
      this.poleK = (this.poleK || 0) + (gripPole - (this.poleK || 0)) * U.approach(6, dt);
      const ux = g ? g.nx : 0;
      const uy = g ? g.ny : -1;
      const ku = U.approach(8, dt);
      this.ux += (ux - this.ux) * ku;
      this.uy += (uy - this.uy) * ku;
      const ul = Math.hypot(this.ux, this.uy) || 1;
      this.ux /= ul;
      this.uy /= ul;
      this.phase += (Math.hypot(this.vx, this.vy) * dt * 0.45) / S;
    }

    // Swap ends in place (same point objects, so references to the head
    // stay valid): the old tail is now the head.
    reverse() {
      const P = this.chain.pts;
      const n = P.length;
      for (let i = 0; i < n >> 1; i++) {
        const a = P[i];
        const b = P[n - 1 - i];
        for (const key of ['x', 'y', 'px', 'py']) {
          const t = a[key];
          a[key] = b[key];
          b[key] = t;
        }
      }
      this.chain.seg.reverse();
      this.vx *= 0.3;
      this.vy *= 0.3;
    }
    stepCoil(dt) {
      const P = this.chain.pts;
      const S = this.size;
      const n = P.length;
      const total = this.chain.seg.reduce((a, b) => a + b, 0);
      if (!this.coil) {
        // a ring resting on the surface it's on, about a turn and a quarter
        const R = total / (U.TAU * 1.25);
        const ux = this.ux || 0;
        const uy = this.uy || -1;
        const h = P[0];
        const g = this.W.nearestSurface(h.x, h.y, 40 * S, this.maskNoPole);
        const bx = g ? h.x - g.nx * Math.max(0, g.d - 4 * S) : h.x;
        const by = g ? h.y - g.ny * Math.max(0, g.d - 4 * S) : h.y;
        this.coil = { cx: bx + ux * (R + 3 * S), cy: by + uy * (R + 3 * S), R, th: Math.atan2(h.y - by - uy * R, h.x - bx - ux * R), dir: U.sign(), squeeze: 0, sqT: U.rand(0.6, 1.6) };
      }
      const co = this.coil;
      // a slow turn, now and then a tightening squeeze
      co.th += co.dir * dt * 0.9;
      co.sqT -= dt;
      if (co.sqT <= 0) {
        co.sqT = U.rand(0.8, 2);
        co.squeeze = 1;
      }
      co.squeeze = Math.max(0, co.squeeze - dt * 2.2);
      let th = co.th;
      const k = U.approach(7, dt);
      for (let i = 0; i < n; i++) {
        // winding inward a little, each turn pulsing out of step with the next
        const r = co.R * (1 - 0.3 * (i / n)) * (1 - 0.18 * co.squeeze) * (1 + 0.09 * Math.sin(this.age * 5 + i * 0.8));
        const tx = co.cx + Math.cos(th) * r;
        const ty = co.cy + Math.sin(th) * r;
        P[i].x += (tx - P[i].x) * k;
        P[i].y += (ty - P[i].y) * k;
        this.W.collideCircle(P[i], 3 * S); // squashed against a wall, not through it
        P[i].px = P[i].x;
        P[i].py = P[i].y;
        if (i < n - 1) th -= (co.dir * this.chain.seg[i]) / Math.max(4, r);
      }
      this.vx = this.vy = 0;
      this.phase += dt * 14; // legs scrabbling at it
    }

    // Drawn after the game's sprites: a row of square-ish armour plates,
    // vivid orange with a darker belly band and a black rim, black gaps
    // between them; thin black jointed legs, a pair per plate; a dark head
    // with pincers; and long whip antennae at both ends (from a distance
    // you can't tell which end is the front).
    draw(ctx) {
      const P = this.chain.pts;
      const n = P.length;
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const S = this.size;
      const ap = (this.eco && this.eco.artPx) || 1;
      const seg = 6.5 * S;
      const front = U.mix(this.cols[0], this.cols[1], this.hue);
      const back = U.mix(this.cols[2], this.cols[3], this.hue);
      const ink = '#140c0a';
      const tangent = (i) => {
        const a = P[Math.max(0, i - 1)];
        const b = P[Math.min(n - 1, i + 1)];
        const tl = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        return { x: (a.x - b.x) / tl, y: (a.y - b.y) / tl };
      };
      // legs: thin and jointed, a pair per plate, stepping in a travelling
      // wave; knees out along the body, feet down on the surface
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(ap, 0.8 * Math.sqrt(S));
      ctx.beginPath();
      const pk = this.coil ? 0 : this.poleK || 0;
      for (let i = 0; i < n; i++) {
        const t = tangent(i);
        for (const s of [-1, 1]) {
          const w = Math.sin(this.phase + i * 0.9 + (s > 0 ? Math.PI : 0));
          const st = this.corpse ? 0 : w * 2.2;
          const lift = this.corpse ? 0 : Math.max(0, w) * 1.2;
          // side on, legs reach down to the surface; on a pole, out to
          // either side of it (s picks the side)
          let dx = -this.ux * (1 - pk) + -t.y * s * pk;
          let dy = -this.uy * (1 - pk) + t.x * s * pk;
          const dl = Math.hypot(dx, dy) || 1;
          dx /= dl;
          dy /= dl;
          const spread = s * (1 - pk); // along the body: fore and aft side on
          ctx.moveTo(P[i].x, P[i].y);
          ctx.lineTo(P[i].x + dx * (3.4 - lift) * S + t.x * (spread * 2.4 + st * 0.5) * S, P[i].y + dy * (3.4 - lift) * S + t.y * (spread * 2.4 + st * 0.5) * S);
          ctx.lineTo(P[i].x + dx * (7 - lift) * S + t.x * (spread * 3.4 + st) * S, P[i].y + dy * (7 - lift) * S + t.y * (spread * 3.4 + st) * S);
        }
      }
      ctx.stroke();
      // antennae at both ends: long dark whips, curving out and swaying
      const whips = (end, nb) => {
        const e = P[end];
        const ea = Math.atan2(P[end].y - P[nb].y, P[end].x - P[nb].x);
        const len = 4.2 * seg; // a fixed reach per plate, so it scales with the body
        ctx.beginPath();
        // seen side on, both arch up off the surface, one a little higher
        const up = Math.cos(ea) * -this.uy - Math.sin(ea) * -this.ux > 0 ? -1 : 1;
        for (const s of [-1, 1]) {
          const sw = this.corpse ? 0.5 * s : Math.sin(this.age * (end ? 2.1 : 2.6) + s * 1.3 + end) * 0.18;
          const lift = up * (s > 0 ? 0.26 : 0.08); // long and flat, barely raised
          const a1 = ea + lift + sw * 0.5;
          const a2 = ea + lift * 1.3 + up * 0.1 + sw;
          const cx = e.x + Math.cos(a1) * len * 0.55;
          const cy = e.y + Math.sin(a1) * len * 0.55;
          ctx.moveTo(e.x, e.y);
          ctx.quadraticCurveTo(cx, cy, cx + Math.cos(a2) * len * 0.5, cy + Math.sin(a2) * len * 0.5);
        }
        ctx.stroke();
        // thicker at the root
        ctx.save();
        ctx.lineWidth *= 1.8;
        ctx.beginPath();
        for (const s of [-1, 1]) {
          const lift = up * (s > 0 ? 0.26 : 0.08);
          ctx.moveTo(e.x, e.y);
          ctx.lineTo(e.x + Math.cos(ea + lift) * len * 0.22, e.y + Math.sin(ea + lift) * len * 0.22);
        }
        ctx.stroke();
        ctx.restore();
      };
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(ap, 0.7 * Math.sqrt(S));
      whips(0, 1);
      whips(n - 1, n - 2);
      // plates, tail first so each overlaps the one behind it
      const roundRect = (x, y, w, h, r) => {
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      };
      for (let i = n - 1; i >= 0; i--) {
        const t = tangent(i);
        const ang = Math.atan2(t.y, t.x);
        const k = i / (n - 1);
        // a touch fuller at the head, ~15% slimmer by the tail; a dark cap
        // at each end (the head a bit bigger)
        const endTaper = i === 0 || i === n - 1 ? 1.04 : 1.02 - 0.12 * Math.abs(k - 0.5) * 2;
        const hh = 2.5 * S * endTaper; // half height: long, flat plates
        const hl = seg * 0.5 * (i === 0 || i === n - 1 ? 1.05 : 1); // half length
        // which local side faces the surface: the belly band goes there
        const belly = -Math.sin(ang) * -this.ux + Math.cos(ang) * -this.uy > 0 ? 1 : -1;
        const cap = i === 0 || i === n - 1;
        const col = cap ? '#2a1410' : U.mix(front, back, Math.abs(k - 0.5) * 1.2);
        ctx.save();
        ctx.translate(P[i].x, P[i].y);
        ctx.rotate(ang);
        ctx.fillStyle = ink;
        ctx.beginPath();
        roundRect(-hl - 0.6 * S, -hh - 0.6 * S, hl * 2 + 1.2 * S, hh * 2 + 1.2 * S, hh * 0.55);
        ctx.fill();
        // flat colours, as in the game: a dark brown shell with the orange
        // plate across its back, the underside left dark
        ctx.fillStyle = '#2a1610';
        ctx.beginPath();
        roundRect(-hl + 0.4 * S, -hh, hl * 2 - 0.8 * S, hh * 2, hh * 0.45);
        ctx.fill();
        if (!cap) {
          ctx.fillStyle = U.rgba(col);
          ctx.beginPath();
          if ((this.poleK || 0) > 0.5 && !this.coil) roundRect(-hl + 0.8 * S, -hh + 0.6 * S, hl * 2 - 1.6 * S, hh * 2 - 1.2 * S, hh * 0.3); // from behind: the whole plate
          else roundRect(-hl + 0.8 * S, belly > 0 ? -hh + 0.5 * S : -hh * 0.25, hl * 2 - 1.6 * S, hh * 1.25 - 0.5 * S, hh * 0.3);
          ctx.fill();
        }
        if (i === 0 || i === n - 1) {
          // a head at each end: mandibles, two hooks reaching out and
          // curling down (the tail-end head faces the other way)
          if (i === n - 1) ctx.scale(-1, 1);
          ctx.strokeStyle = ink;
          ctx.lineWidth = Math.max(ap, 1.1 * Math.sqrt(S));
          ctx.beginPath();
          for (const o of [0, 0.35]) {
            const y0 = belly * hh * (0.15 + o);
            ctx.moveTo(hl * 0.7, y0);
            ctx.quadraticCurveTo(hl + 5 * S, y0 - belly * hh * 0.15, hl + 4 * S, y0 + belly * hh * 0.8);
          }
          ctx.stroke();
          if (this.corpse) {
            // dead: little X'd eyes
            ctx.strokeStyle = '#f2d36b';
            ctx.lineWidth = Math.max(ap, 0.8);
            ctx.beginPath();
            for (const ey of [-hh * 0.45, hh * 0.25]) {
              ctx.moveTo(0, ey - 0.8 * S);
              ctx.lineTo(1.6 * S, ey + 0.8 * S);
              ctx.moveTo(1.6 * S, ey - 0.8 * S);
              ctx.lineTo(0, ey + 0.8 * S);
            }
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      ctx.restore();
      this.drawPath(ctx, this.pather);
      this.drawDebug(ctx);
    }
  }

  RW.Creatures.Centipede = Centipede;
})();
