// Shared creature machinery: path following, verlet chains, procedural legs
// and the grab/eat relationship between predator and prey.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;
  const Nav = RW.Nav;
  // How far a red creature will go looking for another red one (world px).
  const FEUD_RANGE = 420;
  // Seconds held up in a passage before a creature squeezes past.
  const JAM_SLIP = 2.5;

  let NEXT_ID = 1;

  // ---- Path following -------------------------------------------------------
  class Pather {
    constructor(owner, caps) {
      this.owner = owner;
      this.caps = Object.assign({}, caps);
      this.caps.key = Nav.capsKey(this.caps);
      this.nodes = null;
      this.i = 0;
      this.goal = null;
      this.timer = 0;
      this.version = -1;
      this.complete = false;
      this.interval = 1.2;
      this.avoid = null; // (places to route round: see Nav.findPath)
    }
    setGoal(x, y, urgent) {
      const changed = !this.goal || U.dist(this.goal.x, this.goal.y, x, y) > 30;
      this.goal = { x, y };
      if (changed || urgent) this.timer = Math.min(this.timer, urgent ? 0 : 0.15);
    }
    clear() {
      this.goal = null;
      this.nodes = null;
    }
    update(dt, x, y) {
      const W = this.owner.W;
      if (!this.goal) return;
      this.timer -= dt;
      if (this.version !== W.version) {
        this.version = W.version;
        this.timer = Math.min(this.timer, Math.random() * 0.4);
      }
      if (this.timer <= 0) {
        this.timer = this.interval * (0.75 + Math.random() * 0.5);
        const r = Nav.findPath(W, x, y, this.goal.x, this.goal.y, this.caps, 4000, this.avoid);
        this.nodes = r ? r.nodes : null;
        this.complete = r ? r.complete : false;
        this.i = 0;
      }
    }
    current() {
      return this.nodes && this.i < this.nodes.length ? this.nodes[this.i] : null;
    }
    peek(k) {
      return this.nodes && this.i + k < this.nodes.length ? this.nodes[this.i + k] : null;
    }
    previous() {
      return this.nodes && this.i > 0 ? this.nodes[this.i - 1] : null;
    }
    // Skip past nodes we're already close to.
    advance(x, y, radius) {
      if (!this.nodes) return;
      while (this.i < this.nodes.length) {
        const n = this.nodes[this.i];
        if (U.dist(x, y, n.x, n.y) < radius) this.i++;
        else break;
      }
    }
    done() {
      return !this.nodes || this.i >= this.nodes.length;
    }
    remaining() {
      return this.nodes ? this.nodes.length - this.i : 0;
    }
  }

  // ---- Verlet chain ---------------------------------------------------------
  class Chain {
    constructor(x, y, n, segLen, dirX, dirY) {
      this.pts = [];
      this.seg = Array.isArray(segLen) ? segLen : new Array(n).fill(segLen);
      dirX = dirX === undefined ? -1 : dirX;
      dirY = dirY || 0;
      let px = x;
      let py = y;
      for (let i = 0; i < n; i++) {
        this.pts.push({ x: px, y: py, px: px, py: py });
        px += dirX * this.seg[i];
        py += dirY * this.seg[i];
      }
    }
    // Follow-the-leader from point `start` onward.
    follow(start) {
      const P = this.pts;
      for (let i = Math.max(1, start || 1); i < P.length; i++) {
        const a = P[i - 1];
        const b = P[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-4;
        const L = this.seg[i - 1];
        b.x = a.x + (dx / d) * L;
        b.y = a.y + (dy / d) * L;
      }
    }
    // Joints bend at most `max` radians: past that the next point swings
    // back by `k` of the excess, so a body arcs round instead of folding flat
    // on itself (points from..to-1).
    limitBend(max, from, to, k) {
      const P = this.pts;
      const end = Math.min(to || P.length, P.length);
      for (let i = Math.max(2, from || 2); i < end; i++) {
        const a = P[i - 2];
        const b = P[i - 1];
        const c = P[i];
        const a1 = Math.atan2(b.y - a.y, b.x - a.x);
        const a2 = Math.atan2(c.y - b.y, c.x - b.x);
        let d = a2 - a1;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) <= max) continue;
        const na = a2 - (d - Math.sign(d) * max) * k;
        const L = Math.hypot(c.x - b.x, c.y - b.y);
        c.x = b.x + Math.cos(na) * L;
        c.y = b.y + Math.sin(na) * L;
      }
    }
    verlet(from, damp, gx, gy, dt) {
      const P = this.pts;
      for (let i = from; i < P.length; i++) {
        const p = P[i];
        const vx = (p.x - p.px) * damp;
        const vy = (p.y - p.py) * damp;
        p.px = p.x;
        p.py = p.y;
        p.x += vx + gx * dt * dt;
        p.y += vy + gy * dt * dt;
      }
    }
    collide(W, r, from) {
      const P = this.pts;
      for (let i = from || 0; i < P.length; i++) W.collideCircle(P[i], r);
    }
    shift(dx, dy) {
      for (const p of this.pts) {
        p.x += dx;
        p.y += dy;
        p.px += dx;
        p.py += dy;
      }
    }
  }

  // ---- Procedural leg -------------------------------------------------------
  class Leg {
    constructor(l1, l2, opts) {
      opts = opts || {};
      this.l1 = l1;
      this.l2 = l2;
      this.reach = (l1 + l2) * 0.92;
      this.stepDur = opts.stepDur || 0.16;
      this.lift = opts.lift || 6;
      this.group = opts.group || 0;
      this.forward = opts.forward || 0.5; // how far ahead of the hip to plant
      this.spread = opts.spread || 0; // sideways bias along the body
      this.foot = { x: 0, y: 0 };
      this.from = { x: 0, y: 0 };
      this.to = { x: 0, y: 0 };
      this.n = { x: 0, y: -1 };
      this.planted = false;
      this.stepping = false;
      this.t = 0;
      this.searchT = 0;
      this.surfId = null;
    }
    place(x, y) {
      this.foot.x = x;
      this.foot.y = y;
    }
    // hip: attach point. fwd: body heading. up: away from the main surface.
    update(dt, W, hx, hy, fx, fy, ux, uy, mask, canStep, speedK) {
      const reach = this.reach;
      if (this.stepping) {
        this.t += dt / (this.stepDur / Math.max(0.6, speedK || 1));
        const t = Math.min(1, this.t);
        const e = U.smooth(t);
        const arc = Math.sin(Math.PI * t) * this.lift;
        this.foot.x = U.lerp(this.from.x, this.to.x, e) + this.n.x * arc;
        this.foot.y = U.lerp(this.from.y, this.to.y, e) + this.n.y * arc;
        if (t >= 1) {
          this.stepping = false;
          this.planted = true;
        }
        return;
      }
      const d = U.dist(hx, hy, this.foot.x, this.foot.y);
      if (this.planted) {
        // Is the foot lagging too far behind, or simply out of reach?
        const ahead = (this.foot.x - hx) * fx + (this.foot.y - hy) * fy;
        const need = d > reach * 1.02 || ahead < -reach * 0.55 || ahead > reach * 0.95;
        if (need && (canStep || d > reach * 1.2)) {
          if (!this.tryStep(W, hx, hy, fx, fy, ux, uy, mask) && d > reach * 1.25) this.planted = false;
        } else if (d > reach * 1.2) {
          this.planted = false;
        }
        return;
      }
      // Dangling: hang below the hip with a little flail, keep looking for grip.
      const tx = hx - ux * reach * 0.55 + fx * reach * 0.25;
      const ty = hy - uy * reach * 0.55 + fy * reach * 0.25 + 4;
      const k = U.approach(14, dt);
      this.foot.x += (tx - this.foot.x) * k + (Math.random() - 0.5) * 1.5;
      this.foot.y += (ty - this.foot.y) * k + (Math.random() - 0.5) * 1.5;
      W.collideCircle(this.foot, 1);
      this.searchT -= dt;
      if (this.searchT <= 0 && canStep) {
        this.searchT = 0.08;
        this.tryStep(W, hx, hy, fx, fy, ux, uy, mask);
      }
    }
    tryStep(W, hx, hy, fx, fy, ux, uy, mask) {
      const reach = this.reach;
      const sx = -fy * this.spread;
      const sy = fx * this.spread;
      const px = hx + fx * reach * this.forward - ux * reach * 0.6 + sx * reach;
      const py = hy + fy * reach * this.forward - uy * reach * 0.6 + sy * reach;
      const s = W.nearestSurface(px, py, reach * 0.95, mask);
      if (!s) return false;
      if (U.dist(hx, hy, s.x, s.y) > reach) return false;
      this.from.x = this.foot.x;
      this.from.y = this.foot.y;
      this.to.x = s.x;
      this.to.y = s.y;
      this.n.x = s.nx;
      this.n.y = s.ny;
      this.surfId = s.id;
      this.t = 0;
      this.stepping = true;
      this.planted = false;
      return true;
    }
    shift(dx, dy) {
      this.foot.x += dx;
      this.foot.y += dy;
      this.to.x += dx;
      this.to.y += dy;
      this.from.x += dx;
      this.from.y += dy;
    }
    // Returns the knee for drawing.
    solve(hx, hy, ux, uy) {
      return U.ikToward(hx, hy, this.foot.x, this.foot.y, this.l1, this.l2, ux, uy);
    }
  }

  // ---- Creature base --------------------------------------------------------
  class Creature {
    constructor(eco, species, x, y) {
      this.eco = eco;
      this.W = eco.world;
      this.species = species;
      this.scfg = eco.cfg.species[species] || { params: {} };
      this.p = this.scfg.params || {};
      this.id = NEXT_ID++;
      this.dead = false;
      this.alpha = 0;
      this.leaving = false;
      this.age = 0;
      this.grabbedBy = null;
      this.holding = null;
      this.state = 'idle';
      this.stateT = 0;
      this.label = '';
      this.diet = [];
      this.threats = [];
      this.isFlier = false;
      this.mass = 1;
      this.spawnX = x;
      this.spawnY = y;
      this.contactId = null;
      this.migrateCheck = U.rand(5, 20);
    }
    get x() {
      return this.mainPoint().x;
    }
    get y() {
      return this.mainPoint().y;
    }
    mainPoint() {
      return { x: this.spawnX, y: this.spawnY };
    }
    setState(s) {
      if (this.state !== s) {
        this.state = s;
        this.stateT = 0;
        this.headway = null; // (a fresh chase, measured afresh)
      }
    }
    // Common lifecycle; returns false if the creature should skip its own logic.
    tick(dt) {
      this.age += dt;
      this.stateT += dt;
      if (this.burrow) return this.burrowStep(dt);
      if (this.piping) return this.pipeStep(dt);
      if (this.unpiping) return this.unpipeStep(dt);
      if (this.leaving) {
        this.alpha -= dt * 2;
        if (this.alpha <= 0) this.dead = true;
        return false;
      }
      this.alpha = Math.min(1, this.alpha + dt * 1.6);
      // Fell into a bottomless pit: gone for good, corpse and all.
      if (this.W.pits && this.W.pits.length && !this.grabbedBy && !this.isFlier && this.mainPoint().y > this.W.h + 40) {
        this.eco.fellInPit = (this.eco.fellInPit || 0) + 1;
        this.remove();
        return false;
      }
      if (this.unburrowStep(dt)) return false;
      // Dead: a limp ragdoll until something eats it (or it rots away). A
      // carried corpse lets its own grabbed-branch hang it from the jaws.
      if (this.corpse) {
        // (the clock stops while it's carried, in a killer's jaws or a
        // hand: it neither greys nor rots on the way)
        if (!this.grabbedBy) this.corpseT += dt;
        if (this.corpseT > 100 && !this.grabbedBy) {
          this.alpha -= dt * 0.4;
          if (this.alpha <= 0) this.dead = true;
        }
        if (this.grabbedBy) return true;
        this.limp(dt);
        this.waterLimp(dt);
        return false;
      }
      // Stunned (a rock, say): limp until it wears off.
      if (this.stunT > 0 && !this.grabbedBy) {
        this.stunT -= dt;
        this.limp(dt);
        this.waterLimp(dt);
        if (this.stunT <= 0) {
          this.flipped = false;
          this.onRecovered();
        }
        return false;
      }
      // In the water and hating it (centipedes, dropwigs): thrash for the
      // nearest dry footing. (Swimmers swim in their own update.)
      if (this.hatesWater && !this.grabbedBy && this.W.waterSim && this.W.waterSim.active()) {
        const lead = this.pipeLead();
        const d = this.depthOf(lead);
        // (until it's out and up on the dry footing it was making for)
        const g = this.dryGoal;
        const out = d < 0 && (!g || Math.hypot(g.x - lead.x, g.y - lead.y) < this.W.cell * 0.8 || !this.W.waterCell(this.W.cellX(lead.x), this.W.cellY(lead.y) + 1));
        if (d > 3 || (this.panicking && !out)) {
          this.panicking = true;
          this.tunnel = null;
          return this.waterPanic(dt);
        }
        this.panicking = false;
        this.dryGoal = null;
        this.drownT = 0;
      }
      // Passages: crawling through one, or about to (the path runs into one)
      if (this.tunnel && this.grabbedBy) this.tunnel = null;
      if (this.tunnel) return this.tunnelStep(dt);
      this.tunnelCd = (this.tunnelCd || 0) - dt;
      // (never while something's holding it: the hand or a jaw wins)
      if (!this.isFlier && !this.grabbedBy && this.W.passages && this.W.passages.length && this.tryTunnel()) return false;
      // No den reachable from here: slip away quietly rather than wait forever.
      // (not while the flood's up: then it's a pipe or nothing)
      if (this.state === 'leave' && this.stateT > (this.isFlier ? 60 : 30) && !this.flooding()) this.leave();
      // Caught in the flood with no way out: it can only last so long in the
      // water (a slugcat swims a good deal longer than anything else).
      if (!this.isFlier && this.flooding() && (this.swimming || this.panicking)) {
        this.floodT = (this.floodT || 0) + dt;
        if (this.floodT > (this.species === 'slugcat' ? 70 : 35)) {
          this.floodT = 0;
          this.kill();
          return false;
        }
      } else {
        this.floodT = 0;
      }
      this.keepDry(dt);
      // Arrived at a pipe (nothing left to walk) but not quite close enough
      // for its own "in we go" check: in we go.
      if (this.state === 'leave' && !this.leaving && (this.isFlier ? this.stateT > 2 : this.pather && this.pather.goal && this.pather.done() && this.stateT > 0.5)) {
        // (fliers keep their distance from walls: hovering by the pipe is
        // close enough)
        if (this.denMouthNear(this.isFlier ? 55 : 60) && this.wantsToLeave(0)) this.leave();
      }
      // Easing out of a wedged spot (see below): a couple of px a frame.
      if (this.nudge) {
        const m = this.mainPoint();
        const dx = this.nudge.x - m.x;
        const dy = this.nudge.y - m.y;
        const d = Math.hypot(dx, dy);
        const step = Math.min(d, 90 * dt);
        if (d > 0.5) this.shiftAll((dx / d) * step, (dy / d) * step);
        if (d <= 90 * dt || (this.nudgeT -= dt) <= 0) this.nudge = null;
      }
      // Safety net for odd geometry (e.g. a window dropped on top of us):
      // anything that hasn't budged while trying to go somewhere first eases
      // out of a dead cell (one it can't stand or cling in, such as a slot
      // between ledge pieces) into the nearest usable one; one that's trying
      // to leave with no way to a den slips away; after 25s anything leaves.
      this.stuckCheckT = (this.stuckCheckT || 0) + dt;
      if (this.stuckCheckT > 5) {
        this.stuckCheckT = 0;
        const m = this.mainPoint();
        const moved = this.lastCheck ? Math.hypot(m.x - this.lastCheck.x, m.y - this.lastCheck.y) : 99;
        this.lastCheck = { x: m.x, y: m.y };
        // (sitting at its own goal isn't being stuck)
        const gl = this.pather && this.pather.goal;
        const busy = gl && Math.hypot(gl.x - m.x, gl.y - m.y) > this.W.cell * 1.5 && !this.grabbedBy && !this.holding;
        this.stillFor = moved < 3 && busy ? (this.stillFor || 0) + 5 : 0;
        if (this.stillFor >= 10 && this.caps && !this.nudge) {
          const W = this.W;
          const cx = W.cellX(m.x);
          const cy = W.cellY(m.y);
          const to = !RW.Nav.valid(W, cx, cy, this.caps) && RW.Nav.nearestValid(W, m.x, m.y, this.caps, 3);
          if (to) {
            this.nudge = { x: W.centerX(to.cx), y: W.centerY(to.cy) };
            this.nudgeT = 1.5;
            this.pather.clear();
            this.stillFor = 0;
          } else if (this.state === 'leave') {
            // as close to a den as it can get: in it goes; nowhere near one
            // (no way there): it slips away underground
            const den = this.eco.nearestDen(m.x, m.y, this.caps);
            if (den && Math.hypot(den.x - m.x, den.y - m.y) < W.cell * 3) this.leave();
            else this.burrowAway();
          }
        }
        if (this.stillFor >= 25) this.burrowAway();
      }
      return true;
    }
    // Scrambling: stepping off a pole onto the ledge right beside it means
    // hauling up over the corner, which plain steering bumps into. Returns the
    // ledge-top node when that's the next move and `pt` is down by the lip.
    cornerAhead(pt) {
      const W = this.W;
      const n = this.pather.current();
      const pv = this.pather.previous();
      if (!n || !pv || n.type !== RW.Nav.WALK || n.cy > pv.cy || Math.abs(n.cx - pv.cx) !== 1) return null;
      if (W.pole(n.cx, n.cy) || !W.solid(n.cx, n.cy + 1) || !W.pole(pv.cx, pv.cy) || W.solid(pv.cx, pv.cy + 1)) return null;
      const top = (n.cy + 1) * W.cell;
      if (pt.y < top - W.cell * 0.3 || pt.y > top + W.cell * 2.5 || Math.abs(pt.x - n.x) > W.cell * 1.8) return null;
      return n;
    }
    // Start a scramble for ledge-top node `n`: `r` is how far `pt` keeps off
    // the ledge face, `lift` how high it rides above a surface, `chance` the
    // odds this attempt gets over (smaller, nimbler creatures do better).
    startScramble(n, pt, r, lift, chance) {
      const cell = this.W.cell;
      const side = Math.sign(n.x - pt.x) || 1; // toward the ledge
      const face = side > 0 ? n.cx * cell : (n.cx + 1) * cell;
      const top = (n.cy + 1) * cell;
      this.scramble = {
        t: 0,
        dur: U.rand(0.5, 0.75) + Math.max(0, pt.y - top) / 140, // longer from further down
        x0: pt.x,
        y0: pt.y,
        side,
        lip: { x: face, y: top },
        p1: { x: face - side * r, y: top - lift * 0.5 },
        p2: { x: face + side * (r + 3), y: top - lift },
        ok: Math.random() < chance,
      };
    }
    // Clambering: a creature pushing at a corner it can't get round (a
    // one-cell step, a ledge end onto the pole beside it, a low overhang)
    // makes no progress toward the next cell of its path. After 1.5s of that
    // it clambers there, round the open side of the corner, using the
    // scramble motion (always succeeds). Call each frame while steering.
    noteProgress(dt, pt) {
      const n = this.pather.current();
      if (!n || this.scramble) {
        this.stallKey = null;
        return;
      }
      const d = Math.hypot(n.x - pt.x, n.y - pt.y);
      const key = n.cx + ',' + n.cy;
      if (this.stallKey !== key || d < this.stallBest - 2) {
        this.stallKey = key;
        this.stallBest = d;
        this.stallT = 0;
        return;
      }
      this.stallT += dt;
      if (this.stallT < 1.5 || d > this.W.cell * 1.8) return;
      this.stallT = 0;
      const W = this.W;
      const cx = W.cellX(pt.x);
      const cy = W.cellY(pt.y);
      const dx = Math.sign(n.cx - cx);
      const dy = Math.sign(n.cy - cy);
      let mid = { x: (pt.x + n.x) / 2, y: (pt.y + n.y) / 2 };
      if (dx && dy) mid = !W.solid(cx + dx, cy) ? { x: W.centerX(cx + dx), y: W.centerY(cy) } : { x: W.centerX(cx), y: W.centerY(cy + dy) };
      this.scramble = { t: 0, dur: 0.5, x0: pt.x, y0: pt.y, side: dx || 1, lip: { x: n.x, y: n.y }, p1: mid, p2: { x: n.x, y: n.y }, ok: true };
    }
    // Advance a scramble, steering `pt` by setting vx/vy. Returns 'done' once
    // over the lip, 'slip' when this attempt fails, otherwise null.
    stepScramble(dt, pt) {
      const s = this.scramble;
      if (s.last !== undefined && this.age - s.last > 0.1) {
        // interrupted (stunned, grabbed, fighting): start over from scratch
        this.scramble = null;
        this.scrambleCd = 0.3;
        return 'slip';
      }
      s.last = this.age;
      s.t += dt;
      const u = s.t / s.dur;
      if (!s.ok && u > 0.5) {
        // couldn't get a grip on the lip: slide back down and try again
        this.scramble = null;
        this.scrambleCd = U.rand(0.35, 0.8);
        this.vx = -s.side * 25;
        this.vy = 70;
        this.scrambleFails = (this.scrambleFails || 0) + 1;
        if (this.scrambleFails >= 4) {
          this.scrambleFails = 0;
          this.pather.clear(); // give up on this route for now
        }
        return 'slip';
      }
      let tx;
      let ty;
      if (u < 0.6) {
        // claw up the face to the lip, wriggling side to side
        const k = U.smooth(u / 0.6);
        tx = U.lerp(s.x0, s.p1.x, Math.min(1, k * 1.6));
        ty = U.lerp(s.y0, s.p1.y, k);
        tx += Math.sin(s.t * 34) * 2.2 * (1 - k * 0.5);
        ty += Math.sin(s.t * 23) * 1.5;
      } else {
        // then haul over the top
        const k = Math.min(1, (u - 0.6) / 0.4);
        tx = U.lerp(s.p1.x, s.p2.x, k);
        ty = U.lerp(s.p1.y, s.p2.y, k) - Math.sin(k * Math.PI) * 3;
      }
      this.vx = U.clamp((tx - pt.x) / dt, -400, 400);
      this.vy = U.clamp((ty - pt.y) / dt, -400, 400);
      if (u >= 1) {
        this.scramble = null;
        this.scrambleFails = 0;
        this.vx = s.side * 30;
        this.vy = 0;
        return 'done';
      }
      return null;
    }

    // Stuck too long (or walled in): dig down into the surface underfoot and
    // disappear. The surface clips the creature as it sinks (see
    // Ecosystem.draw), with a little dirt kicked up.
    // force: walled in solid with no way out at all (always allowed)
    burrowAway(force) {
      if (this.burrow || this.dead) return;
      // (no slipping away underground while the flood's up: find a pipe, or
      // drown trying)
      if (!force && this.flooding()) return;
      if (this.holding) this.release();
      if (this.grabbedBy) return; // not while something has hold of it
      const W = this.W;
      const m = this.mainPoint();
      let s = W.nearestSurface(m.x, m.y, 80, { floor: true, walls: true, ceil: true, poles: false });
      if (!s) {
        const hit = W.raycast(m.x, m.y, m.x, m.y + 400);
        s = hit ? { x: hit.x, y: hit.y, nx: 0, ny: -1 } : { x: m.x, y: m.y + 10, nx: 0, ny: -1 };
      }
      this.burrow = { t: 0, dur: 1.4, sx: s.x, sy: s.y, nx: s.nx, ny: s.ny, dustT: 0 };
      this.label = '';
      if (this.pather) this.pather.clear();
    }
    burrowStep(dt) {
      const b = this.burrow;
      b.t += dt;
      // sink into the surface (against its normal), slowly then quicker
      const sp = 18 + 40 * (b.t / b.dur);
      this.shiftAll(-b.nx * sp * dt, -b.ny * sp * dt);
      b.dustT -= dt;
      if (b.dustT <= 0) {
        b.dustT = 0.12;
        const m = this.mainPoint();
        // dirt flicks up where the body meets the surface
        const d = (m.x - b.sx) * b.nx + (m.y - b.sy) * b.ny;
        this.eco.burst(m.x - b.nx * d, m.y - b.ny * d, '#2b241d', 3);
      }
      if (b.t >= b.dur) {
        this.dead = true;
        this.eco.stats.left++;
      }
      return false;
    }

    // Eaten, despawned or left the screen.
    remove() {
      this.dead = true;
      if (this.holding) this.release();
    }
    leave() {
      // A pipe standing up out of the floor goes in from above. Beside it
      // (on a pole next to it, across the floor at its level) it isn't in
      // yet: it keeps on to the spot over the mouth (where its path ends
      // anyway) rather than sliding in sideways through the rock. If it
      // can't get there in a while, it slips away where it is instead.
      let pipe = !this.grabbedBy && !this.corpse ? this.denMouthNear(70) : null;
      if (pipe && !pipe.sky && !pipe.wall && !this.overMouth(pipe)) {
        // (another pipe close by that it is over will do)
        const over = (this.eco.dens || []).find((d) => !d.sky && !d.wall && this.overMouth(d));
        if (over) pipe = over;
      }
      if (pipe && !pipe.sky && !pipe.wall && !this.overMouth(pipe)) {
        const t = this.eco.t;
        if (this.denWaitSince === undefined || t - this.denWaitSince > 30) this.denWaitSince = t;
        if (t - this.denWaitSince < 10) return;
        pipe = null;
      }
      this.denWaitSince = undefined;
      // a catch carried in out of the rain is eaten in there
      if (this.holding && this.eco.shouldShelter() && !this.holding.isHand) this.eco.consume(this.holding, this);
      if (this.holding) this.release();
      this.leaving = true;
      // gone to ground for the rain (not a visitor moving on): it'll be
      // back out once it passes
      const fam = this.family;
      this.sheltered = this.eco.shouldShelter() && !this.exitDen && !(fam && fam.exitDen) && !this.migrating;
      // at a den: squeeze in through the pipe mouth rather than fade out
      if (pipe) this.startPiping(pipe);
    }
    // Over a floor pipe's mouth, ready to go in from above (the head or lead
    // point right over the opening, not off to the side of it or below).
    overMouth(d) {
      const mo = RW.Creature.denMouth(d);
      const L = this.pipeLead();
      return L.y <= mo.y + 2 && L.y >= mo.y - 40 && Math.abs(L.x - mo.x) <= this.W.cell;
    }

    // --- going into a pipe ---
    // A den's mouth: where the opening is, the way into the pipe (a), and
    // the way out of it (n, the side the creature stays visible on).
    static denMouth(d) {
      if (d.sky) return { x: d.x, y: d.y, ax: 0, ay: -1 }; // up and away
      if (d.wall) return { x: d.x + d.dir * 12, y: d.y, ax: -d.dir, ay: 0 };
      return { x: d.x, y: d.y, ax: 0, ay: 1 };
    }
    denMouthNear(range) {
      const dens = (this.eco && this.eco.dens) || [];
      const parts = this.hitParts ? this.hitParts() : [];
      const pts = [this.mainPoint()].concat(parts);
      let best = null;
      let bd = range;
      for (const d of dens) {
        if (d.sky && !this.isFlier) continue;
        const mo = RW.Creature.denMouth(d);
        for (const q of pts) {
          const dd = Math.hypot(q.x - mo.x, q.y - mo.y);
          if (dd < bd) {
            bd = dd;
            best = d;
          }
        }
      }
      return best;
    }
    // Head first: the lead point (the head) makes for the mouth and then
    // down the pipe, and the body follows it in along its own path, as if
    // squirming through a tight gap. The part that's in is hidden by
    // clipping at the mouth (see Ecosystem.draw). Creatures without a body
    // to follow (small fliers) slide in whole, squeezed toward the opening.
    startPiping(d) {
      const mo = RW.Creature.denMouth(d);
      const sp = this.spine || this.chain;
      let len;
      if (sp instanceof RW.Chain) len = sp.seg.reduce((a, b) => a + b, 0) + 16;
      else {
        const b = this.bounds();
        len = Math.hypot(b[2] - b[0], b[3] - b[1]) * 0.85 + 12;
      }
      this.piping = { t: 0, sx: mo.x, sy: mo.y, ax: mo.ax, ay: mo.ay, len: Math.min(420, len), k: 1, den: d };
      this.shelterDen = d;
      this.label = '';
      if (this.pather) this.pather.clear();
      if ('vx' in this) this.vx = this.vy = 0;
    }
    pipeStep(dt) {
      const pp = this.piping;
      pp.t += dt;
      const lead = this.pipeLead();
      const along = (lead.x - pp.sx) * pp.ax + (lead.y - pp.sy) * pp.ay;
      const speed = 50 + 130 * Math.min(1, pp.t / 0.6);
      let dx;
      let dy;
      if (along < 3) {
        // still outside: to the mouth first
        const tx = pp.sx + pp.ax * 4 - lead.x;
        const ty = pp.sy + pp.ay * 4 - lead.y;
        const d = Math.hypot(tx, ty) || 1;
        const st = Math.min(d, speed * dt);
        dx = (tx / d) * st;
        dy = (ty / d) * st;
      } else {
        // in: on down the pipe, kept to its middle
        const px = -pp.ay;
        const py = pp.ax;
        const lat = (lead.x - pp.sx) * px + (lead.y - pp.sy) * py;
        const fix = -lat * Math.min(1, 10 * dt);
        dx = pp.ax * speed * dt + px * fix;
        dy = pp.ay * speed * dt + py * fix;
      }
      const crawls = this.pipeMove(dx, dy, dt);
      // a body that can't follow itself in is squeezed toward the opening
      if (!crawls) pp.k = 1 - 0.6 * U.smooth(Math.min(1, pp.t / 0.4));
      pp.den.busyT = 0.6; // its marks light up while something goes through
      if (along >= pp.len || pp.t > 6) this.dead = true; // counted as left by the ecosystem
      return false;
    }
    // ---- turning round (any creature with a spine: lizards, dropwigs) ----
    turnChain() {
      return this.spine || this.chain;
    }
    // Turning round: the head leads. It rears up and arcs back over its own
    // shoulders, coming down facing the other way (the head flips over at
    // the top), and walks off; the body follows the exact path the head
    // took, flowing up, over and back through itself, until the tail has
    // been round too.
    startTurn() {
      const P = this.turnChain().pts;
      const H = P[0];
      let fx = H.x - P[2].x;
      let fy = H.y - P[2].y;
      const fl = Math.hypot(fx, fy) || 1;
      fx /= fl;
      fy /= fl;
      // "up" is away from the surface, on the side the body isn't
      let ux = this.ux;
      let uy = this.uy;
      if (Math.abs(fx * ux + fy * uy) > 0.7) {
        ux = -fy;
        uy = fx;
      }
      const r = (this.turnRear || 9) * (this.L || 1); // how high it rears
      const trail = [];
      for (let i = P.length - 1; i >= 0; i--) trail.push({ x: P[i].x, y: P[i].y });
      const bodyLen = this.turnChain().seg.reduce((a, b) => a + b, 0);
      this.turn = { t: 0, dur: 0.6, phase: 'arch', c: { x: H.x - fx * r, y: H.y - fy * r }, f: { x: fx, y: fy }, up: { x: ux, y: uy }, r, trail, moved: 0, bodyLen };
      this.vx = this.vy = 0;
    }

    // The arch: the head along a half circle up, over and down behind.
    stepTurn(dt) {
      const T = this.turn;
      T.t += dt;
      const k = Math.min(1, T.t / T.dur);
      const th = Math.PI * U.smooth(k);
      const h = this.turnChain().pts[0];
      h.x = h.px = T.c.x + T.f.x * T.r * Math.cos(th) + T.up.x * T.r * Math.sin(th);
      h.y = h.py = T.c.y + T.f.y * T.r * Math.cos(th) + T.up.y * T.r * Math.sin(th);
      this.followTrail();
      if (k >= 1) {
        // down and off the other way
        T.phase = 'walk';
        this.vx = -T.f.x * 30;
        this.vy = -T.f.y * 30;
      }
    }

    // Lay the body along the head's own path, link by link behind it.
    followTrail() {
      const T = this.turn;
      const P = this.turnChain().pts;
      const h = P[0];
      const tr = T.trail;
      const last = tr[tr.length - 1];
      const d = Math.hypot(h.x - last.x, h.y - last.y);
      if (d > 0.5) {
        tr.push({ x: h.x, y: h.y });
        T.moved += d;
      }
      let j = tr.length - 1; // walking back along the trail from the head
      let ax = h.x;
      let ay = h.y;
      let left = 0; // distance still to go to the next body point
      for (let i = 1; i < P.length; i++) {
        left += this.turnChain().seg[i - 1];
        while (j >= 0) {
          const bx = tr[j].x;
          const by = tr[j].y;
          const sl = Math.hypot(bx - ax, by - ay);
          if (sl >= left && sl > 0) {
            ax += ((bx - ax) * left) / sl;
            ay += ((by - ay) * left) / sl;
            left = 0;
            break;
          }
          left -= sl;
          ax = bx;
          ay = by;
          j--;
        }
        P[i].x = P[i].px = ax;
        P[i].y = P[i].py = ay;
      }
      // all the way round (or held up too long): back to the usual body
      if ((T.phase === 'walk' && T.moved > T.bodyLen + T.r * 4) || T.t > 8) {
        this.turn = null;
        this.turnCd = 1.5;
        if (this.look !== undefined) this.look = 0;
      }
    }

    // Back out of a pipe after the rain: laid down the pipe, head at the
    // mouth, the head leads out (along the ledge top, from a ledge pipe) and
    // the body follows it out the way it went in.
    startUnpiping(d) {
      const mo = RW.Creature.denMouth(d);
      const sp = this.spine || this.chain;
      let len;
      if (sp instanceof RW.Chain) len = sp.seg.reduce((a, b) => a + b, 0) + 16;
      else {
        const b = this.bounds();
        len = Math.hypot(b[2] - b[0], b[3] - b[1]) * 0.6 + 12;
      }
      this.layInPipe(mo, len);
      this.unpiping = { t: 0, sx: mo.x, sy: mo.y, ax: mo.ax, ay: mo.ay, len: Math.min(420, len), k: 1, den: d, out: 0, side: Math.random() < 0.5 ? -1 : 1 };
      this.alpha = 1;
      if ('vx' in this) this.vx = this.vy = 0;
    }
    // Lay the body straight down the pipe, head just inside the mouth.
    layInPipe(mo, len) {
      const sp = this.spine || this.chain;
      if (sp instanceof RW.Chain) {
        let d = 2;
        sp.pts.forEach((q, i) => {
          if (i) d += sp.seg[i - 1];
          q.x = q.px = mo.x + mo.ax * d;
          q.y = q.py = mo.y + mo.ay * d;
        });
        if (this.legs) {
          for (const l of this.legs) {
            const a = sp.pts[Math.min(l.at || 0, sp.pts.length - 1)];
            if (l.leg.foot) l.leg.place(a.x, a.y);
          }
        }
        return;
      }
      const m = this.mainPoint();
      this.shiftAll(mo.x + mo.ax * len * 0.5 - m.x, mo.y + mo.ay * len * 0.5 - m.y);
    }
    unpipeStep(dt) {
      const up = this.unpiping;
      // (waiting its turn inside, behind one coming out ahead of it)
      if (up.wait > 0) {
        up.wait -= dt;
        return false;
      }
      up.t += dt;
      const lead = this.pipeLead();
      const depth = (lead.x - up.sx) * up.ax + (lead.y - up.sy) * up.ay; // > 0: still inside
      const speed = 45 + 120 * Math.min(1, up.t / 0.6);
      const step = speed * dt;
      let dx = -up.ax * step;
      let dy = -up.ay * step;
      if (up.ay > 0 && depth < -8) {
        // out of a ledge pipe: off along the ledge top, hugging it
        dx = up.side * step;
        dy = (up.sy - 6 - lead.y) * Math.min(1, 8 * dt);
      } else if (depth > 0) {
        // in the pipe: kept to its middle
        const px = -up.ay;
        const py = up.ax;
        const lat = (lead.x - up.sx) * px + (lead.y - up.sy) * py;
        dx -= px * lat * Math.min(1, 10 * dt);
        dy -= py * lat * Math.min(1, 10 * dt);
      }
      const crawls = this.pipeMove(dx, dy, dt);
      up.k = crawls ? 1 : 0.4 + 0.6 * U.smooth(Math.min(1, up.t / 0.5));
      up.out += step;
      up.den.busyT = 0.6;
      if (up.out >= up.len + 20 || up.t > 6) {
        this.unpiping = null;
        // back to what it was doing when it first arrived (not still 'leave')
        this.setState(this.homeState || 'idle');
        this.onUnburrowed();
      }
      return false;
    }
    // The point that goes in first, and how the body follows it. Chain
    // bodies (lizards, centipedes, dropwigs) follow their head link by link;
    // returns false when the creature can only be moved whole.
    pipeLead() {
      const sp = this.spine || this.chain;
      return sp instanceof RW.Chain ? sp.pts[0] : this.mainPoint();
    }
    pipeMove(dx, dy) {
      const sp = this.spine || this.chain;
      if (!(sp instanceof RW.Chain)) {
        this.shiftAll(dx, dy);
        return false;
      }
      const P = sp.pts;
      P[0].x += dx;
      P[0].y += dy;
      sp.follow(1);
      for (const q of P) {
        q.px = q.x;
        q.py = q.y;
      }
      // legs fold in against the body as it goes
      if (this.legs) {
        for (const l of this.legs) {
          const a = P[Math.min(l.at || 0, P.length - 1)];
          const f = l.leg.foot;
          if (!f) continue;
          f.x += (a.x - f.x) * 0.3;
          f.y += (a.y - f.y) * 0.3;
        }
      }
      return true;
    }

    // --- grabbing ---
    // The nearest corpse of one of these species (scavenging).
    nearestCorpse(species, range) {
      const m = this.mainPoint();
      let best = null;
      let bd = range * range;
      for (const c of this.eco.creatures) {
        if (!c.corpse || c.dead || c.grabbedBy || c.alpha < 0.5 || c === this || this.ignores(c)) continue;
        if (!species.some((s) => (s.endsWith('*') ? c.species.startsWith(s.slice(0, -1)) : s === c.species))) continue;
        if (this.W.waterDepth(c.x, c.y) > 6) continue; // (sunk: not worth a dive)
        const d = U.dist2(m.x, m.y, c.x, c.y);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best;
    }
    canBeGrabbed() {
      return !this.dead && !this.leaving && !this.grabbedBy && this.alpha > 0.5;
    }
    grab(prey) {
      if (!prey.canBeGrabbed()) return false;
      if (prey.p && prey.p.armored && !prey.corpse) return false; // only once it's dead
      prey.grabbedBy = this;
      this.holding = prey;
      prey.onGrabbed(this);
      return true;
    }
    // ---- getting nowhere ----
    // Going after something (prey, a corpse, fruit, a weapon) without
    // getting any closer for `secs`: give it up, and leave it be for a while
    // (the searches for food and weapons skip it; it still counts as a
    // threat). True when it gives up: the caller drops the chase.
    noHeadway(target, dt, secs) {
      const m = this.mainPoint();
      // (measured down the route there when it has one: a long climb round
      // makes headway along its path, not in a straight line)
      const pa = this.pather;
      const routed = !!(pa && pa.nodes && pa.complete && pa.goal && Math.hypot(pa.goal.x - target.x, pa.goal.y - target.y) < this.W.cell * 5);
      const d = routed ? pa.remaining() * this.W.cell : Math.hypot(target.x - m.x, target.y - m.y);
      const g = this.headway;
      if (!g || g.t !== target) {
        this.headway = { t: target, best: d, T: 0, routed };
        return false;
      }
      if (g.routed !== routed) {
        g.routed = routed;
        g.best = d;
      }
      if (d < g.best - this.W.cell * 0.5) {
        g.best = d;
        g.T = 0;
        return false;
      }
      g.T += dt;
      if (g.T < (secs || 8)) return false;
      this.headway = null;
      this.ignore(target, 20);
      return true;
    }
    // Off somewhere (a wander goal): getting no further down the route for
    // `secs`, or no route there at all: give it up and stay off that spot a
    // while (pickWander skips it). True when it gives up.
    tripStalled(dt, secs) {
      const pa = this.pather;
      const goal = pa && pa.goal;
      if (!goal) return !!(this.trip = null);
      let t = this.trip;
      if (!t || t.x !== goal.x || t.y !== goal.y) t = this.trip = { x: goal.x, y: goal.y, best: Infinity, T: 0, age: 0 };
      t.age += dt;
      if (!pa.nodes) return false;
      const left = pa.remaining();
      if (left < t.best) {
        t.best = left;
        t.T = 0;
      } else t.T += dt;
      const noWay = !pa.complete && left === 0 && t.age > 1.5;
      if (!noWay && t.T < secs) return false;
      this.trip = null;
      const bad = (this.badGoals || []).filter((q) => q.until > this.eco.t);
      bad.push({ x: goal.x, y: goal.y, until: this.eco.t + 60 });
      this.badGoals = bad;
      pa.clear();
      return true;
    }
    badGoal(x, y) {
      const r = this.W.cell * 2;
      return !!this.badGoals && this.badGoals.some((q) => q.until > this.eco.t && Math.abs(q.x - x) < r && Math.abs(q.y - y) < r);
    }
    ignore(t, secs) {
      if (!this.ignoring) this.ignoring = new Map();
      if (this.ignoring.size > 20) for (const [k, u] of this.ignoring) if (u < this.eco.t) this.ignoring.delete(k);
      this.ignoring.set(t, this.eco.t + secs);
    }
    ignores(t) {
      const u = this.ignoring && this.ignoring.get(t);
      return u !== undefined && this.eco.t < u;
    }

    // ---- the red feud ----
    // Red creatures (red lizards, large centipedes) can't abide one another:
    // the nearest other one within FEUD_RANGE (not across the whole map:
    // on a big room map that meant long detours and standoffs through
    // rock), and not one it has just failed to find a way to.
    redFoe() {
      if (!this.p.red) return null;
      const m = this.mainPoint();
      let best = null;
      let bd = this.feudRange();
      const skip = this.feudSkip && this.eco.t < this.feudSkip.until ? this.feudSkip.c : null;
      for (const c of this.eco.creatures) {
        if (c === this || c === skip || !c.p || !c.p.red || c.dead || c.corpse || c.leaving || c.piping || c.unpiping || c.alpha < 0.5) continue;
        const d = Math.hypot(c.x - m.x, c.y - m.y);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best;
    }
    feudRange() {
      return this.p.feudRange || FEUD_RANGE;
    }
    // While going for a red foe: one that's gone well out of range, or
    // there's no way through to for a few
    // seconds is let be for a while. True when it gives up.
    feudStuck(foe, dt) {
      this.feudT = this.pather && !this.pather.complete ? (this.feudT || 0) + dt : 0;
      const m = this.mainPoint();
      const far = Math.hypot(foe.x - m.x, foe.y - m.y) > this.feudRange() * 1.4;
      if (this.feudT < 6 && !far) return false;
      this.feudT = 0;
      this.feudSkip = { c: foe, until: this.eco.t + 25 };
      return true;
    }
    // A blow that wears an armoured creature down instead of taking it:
    // health off (by its toughness), a jolt, dead at zero. True if it died.
    takeHit(power, from) {
      if (this.dead || this.corpse) return false;
      if (from) this.lastHit = { by: from, t: this.eco.t };
      if (this.hp === undefined) this.hp = 1;
      this.hp -= power / (this.p.toughness || 1);
      const m = this.mainPoint();
      this.eco.burst(m.x, m.y, this.bloodColor || '#2a1418', 5, this.bulk());
      if (from && 'vx' in this) {
        const dx = m.x - from.x;
        const dy = m.y - from.y;
        const dl = Math.hypot(dx, dy) || 1;
        this.vx += (dx / dl) * 160;
        this.vy += (dy / dl) * 160 - 60;
      }
      if (this.hp <= 0) {
        if (this.holding) this.release();
        this.kill();
        return true;
      }
      this.stun(0.3);
      return false;
    }
    release() {
      const prey = this.holding;
      if (prey) {
        prey.grabbedBy = null;
        prey.skewered = null;
        prey.onReleased(this);
      }
      this.holding = null;
    }
    onGrabbed() {}
    onReleased() {}
    // Point where a held creature should be pinned.
    holdPoint() {
      return this.mainPoint();
    }
    // Prey struggles; returns true if it escaped this frame.
    struggle(dt) {
      if (this.corpse || (this.grabbedBy && this.grabbedBy.isHand)) return false; // limp in the hand
      if (this.skewered) return false; // (on a noodlefly's needle: it writhes, but it's going nowhere)
      const chance = this.p.escapeChance || 0.04;
      if (Math.random() < chance * dt) {
        const holder = this.grabbedBy;
        if (holder) holder.release();
        return true;
      }
      return false;
    }

    // --- perception ---
    canSee(x, y, range) {
      const m = this.mainPoint();
      if (U.dist2(m.x, m.y, x, y) > range * range) return false;
      return this.W.lineClear(m.x, m.y, x, y);
    }
    nearestOf(species, range, filter) {
      const m = this.mainPoint();
      let best = null;
      let bd = range * range;
      for (const c of this.eco.creatures) {
        if (c === this || c.dead || c.corpse || c.leaving || c.alpha < 0.6) continue;
        if (!species.some((s) => (s.endsWith('*') ? c.species.startsWith(s.slice(0, -1)) : s === c.species))) continue;
        if (filter && !filter(c)) continue;
        const d = U.dist2(m.x, m.y, c.x, c.y);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best;
    }
    // Fliers: the next point to steer for on the way to (x, y): straight there
    // when the way is clear, otherwise the next waypoint of an open-air route
    // round whatever's in the way (they used to press against the underside
    // of a ledge between them and a den and never get there). The route has
    // its own planner, so the walkers' stuck rules don't apply to fliers.
    airWaypoint(dt, x, y) {
      const m = this.mainPoint();
      this.routeT = (this.routeT || 0) - dt;
      if (this.W.lineClear(m.x, m.y, x, y)) {
        if (this.airPather) this.airPather.clear();
        return { x, y };
      }
      this.routeT = 0.5; // threading a route: fly() keeps only a small clearance
      const P = this.airPather || (this.airPather = new Pather(this, { fly: true }));
      P.interval = 0.8;
      P.setGoal(x, y);
      P.update(dt, m.x, m.y);
      P.advance(m.x, m.y, this.W.cell * 1.3);
      // aim past the next waypoint when the one after is in sight: smoother
      const n = P.current();
      const n2 = P.peek(1);
      if (n2 && this.W.lineClear(m.x, m.y, n2.x, n2.y)) return { x: n2.x, y: n2.y };
      return n ? { x: n.x, y: n.y } : { x, y };
    }
    // Within reach of a walker: anything not flying, or a flier that has come
    // down near a surface (resting, hovering low, stuck after a stab).
    nearGround(r) {
      if (!this.isFlier || this.corpse || this.stunT > 0) return true;
      const m = this.mainPoint();
      return !!this.W.nearestSurface(m.x, m.y, r || 40, null);
    }
    threatNear(range) {
      const t = this.nearestOf(this.threats, range, (c) => !c.holding && !c.lurking && this.canSee(c.x, c.y, range));
      return t;
    }
    // Pick somewhere reachable that's away from (fx, fy).
    fleeGoal(caps, fx, fy, dist) {
      const m = this.mainPoint();
      const a = Math.atan2(m.y - fy, m.x - fx);
      let best = null;
      let bs = -Infinity;
      for (let i = 0; i < 8; i++) {
        const aa = a + U.rand(-1.1, 1.1);
        const tx = U.clamp(m.x + Math.cos(aa) * dist, 10, this.W.w - 10);
        const ty = U.clamp(m.y + Math.sin(aa) * dist * 0.6, 10, this.W.h - 10);
        const n = Nav.nearestValid(this.W, tx, ty, caps, 4);
        if (!n) continue;
        const x = this.W.centerX(n.cx);
        const y = this.W.centerY(n.cy);
        const s = U.dist(x, y, fx, fy) - U.dist(x, y, m.x, m.y) * 0.3;
        if (s > bs) {
          bs = s;
          best = { x, y };
        }
      }
      return best;
    }
    // Time to pick somewhere new? Not mid-fall or from somewhere no route can
    // start (an empty route reads as "arrived"), and at most about once a
    // second, so a failed plan doesn't churn a new goal every frame.
    readyForGoal(dt, timeout, footing) {
      this.goalCd = (this.goalCd || 0) - dt;
      if (this.goalCd > 0 || footing === false) return false;
      const p = this.pather;
      if (!(p.done() || !p.goal || this.stateT > timeout)) return false;
      this.goalCd = 0.8;
      return true;
    }
    wanderGoal(caps, radius, filter) {
      // In heavy rain: somewhere under cover if there's anywhere near (if
      // not, it stops looking for a while rather than churning).
      const eco = this.eco;
      if (eco.heavyRain() && !this.isFlier && !(this.noCoverUntil > eco.t)) {
        const W = this.W;
        const dry = (cx, cy) => (!filter || filter(cx, cy)) && !eco.rainOn(W.centerX(cx), W.centerY(cy));
        // (the nearest cover first)
        const g = this.pickWander(caps, Math.min(radius, 260), dry, true) || this.pickWander(caps, radius, dry, true);
        if (g) return g;
        this.noCoverUntil = eco.t + 12;
      }
      return this.pickWander(caps, radius, filter);
    }
    pickWander(caps, radius, filter, strict) {
      if (!filter && Math.random() < 0.6) {
        const g = this.exploreGoal(caps);
        if (g && !this.badGoal(g.x, g.y)) return g;
      }
      const m = this.mainPoint();
      // somewhere it can actually get to, and not where it already is
      for (let k = 0; k < 6; k++) {
        const g = Nav.randomValid(this.W, caps, m.x, m.y, radius, filter);
        if (!g || Math.hypot(g.x - m.x, g.y - m.y) < 60 || this.badGoal(g.x, g.y)) continue;
        const r = Nav.findPath(this.W, m.x, m.y, g.x, g.y, caps, 4000);
        if (r && r.complete) return g;
      }
      return strict ? null : Nav.randomValid(this.W, caps, m.x, m.y, radius, filter);
    }
    // Heavy rain: anything pottering about out in it (wandering, idling,
    // resting) gets up and makes for cover, a fresh goal from wanderGoal.
    keepDry(dt) {
      this.dryCheckT = (this.dryCheckT || U.rand(0, 1.5)) - dt;
      if (this.dryCheckT > 0) return;
      this.dryCheckT = 1.5;
      const eco = this.eco;
      if (this.isFlier || !this.pather || this.swimming || this.grabbedBy || !eco.heavyRain() || this.noCoverUntil > eco.t) return;
      if (this.state !== 'wander' && this.state !== 'idle' && this.state !== 'rest') return;
      const m = this.mainPoint();
      const g = this.pather.goal;
      if (g && !this.pather.done() ? !eco.rainOn(g.x, g.y) : !eco.rainOn(m.x, m.y)) return;
      this.setState('wander');
      this.pather.clear();
      this.goalCd = 0;
      this.stateT = 99;
    }
    // Somewhere anywhere on the map, favouring high ground (window tops,
    // ledges, perches) so creatures don't all pool on the floor; only a
    // place we can actually get to.
    exploreGoal(caps) {
      const W = this.W;
      const vc = Nav.validCells(W, caps);
      const list = vc.stand.length && Math.random() < 0.8 ? vc.stand : vc.all;
      const n = list.length / 2;
      if (!n) return null;
      const m = this.mainPoint();
      // a handful of random candidates, the best by height and freshness
      const cands = [];
      for (let k = 0; k < 14; k++) {
        const i = Math.floor(Math.random() * n) * 2;
        const x = W.centerX(list[i]);
        const y = W.centerY(list[i + 1]);
        const d = U.dist(m.x, m.y, x, y);
        if (d < 80) continue;
        // height only counts where you can stand (not clinging to the top edge)
        const hw = list === vc.stand ? 1.2 : 0.2;
        cands.push({ x, y, sc: (1 - y / W.h) * hw * this.heightBias() + Math.random() * 0.6 - d / 3000 });
      }
      cands.sort((a, b) => b.sc - a.sc);
      for (const c of cands.slice(0, 5)) {
        const r = Nav.findPath(W, m.x, m.y, c.x, c.y, caps, 5000);
        if (r && r.complete) return c;
      }
      return null;
    }
    // How strongly roaming favours high ground (negative: keeps low).
    heightBias() {
      return 1;
    }
    // Shelter / migration: head for the nearest den and vanish into it.
    // Time to get under cover: each creature heads for a pipe at its own
    // moment in the run-up to the downpour, so they trickle in.
    shelterTime() {
      const warn = this.eco.cfg.rain.shelterWarnSeconds ?? 45;
      // (shelterEarly: a slow species that can't climb, a green lizard, sets
      // off this many seconds sooner, or the flood catches it on the way)
      if (this.shelterLead === undefined) this.shelterLead = U.rand(Math.min(18, warn), warn) + (this.p.shelterEarly || 0);
      return this.eco.shelterSoon(this.shelterLead);
    }
    wantsToLeave(dt) {
      if (this.shelterTime()) return true;
      this.migrateCheck -= dt;
      if (this.migrateCheck <= 0) {
        this.migrateCheck = 10;
        const perMin = this.eco.cfg.ecosystem.migrationPerMinute || 0;
        // (some species settle in for longer: minStay seconds before they
        // think of moving on, and migrateScale on the chance)
        const stay = this.p.minStay || 40;
        const k = this.p.migrateScale ?? 1;
        if (this.age > stay && Math.random() < (perMin / 6) * k) this.migrating = true;
      }
      return !!this.migrating;
    }

    // --- weapons ---
    // Circles a thrown rock or spear can hit: { x, y, r, part }.
    hitParts() {
      const m = this.mainPoint();
      return [{ x: m.x, y: m.y, r: 8, part: 'body' }];
    }
    stun(t, flip) {
      if (this.p.stunImmune || this.dead) return false;
      this.stunT = Math.max(this.stunT || 0, t);
      this.flipped = !!flip;
      if (this.holding) this.release();
      return true;
    }
    limp(dt) {}
    onRecovered() {}
    // Knocked off whatever it's clinging to (a waterfall's weight, say): it
    // lets go for a moment and drops.
    knockLoose() {
      this.dropT = Math.max(this.dropT || 0, 0.5);
      if ('vx' in this) this.vy = Math.max(this.vy, 80);
    }

    // ---- water ----
    // Is the downpour's flood up?
    flooding() {
      const S = this.W.waterSim;
      return !!S && S.flood > 0.05;
    }
    // How far below the surface a point is (-1: dry).
    depthOf(pt) {
      const S = this.W.waterSim;
      return S ? S.depthAt(pt.x, pt.y) : -1;
    }
    // Going in or coming out: a splash where it breaks the surface.
    noteWet(pt) {
      const S = this.W.waterSim;
      if (!S) return false;
      const s = S.surfaceY(pt.x, pt.y);
      const wet = s !== null;
      if (wet) this.wetSurf = s;
      if (wet !== !!this.wet) {
        this.wet = wet;
        const pal = this.eco.palette;
        if (this.age > 1 && this.wetSurf !== undefined) this.eco.burst(pt.x, this.wetSurf, U.rgba(U.mix((pal && pal.water) || '#6a8aa0', '#ffffff', 0.5)), 6);
      }
      return wet;
    }
    // In the water, limp (stunned or dead): the living float up to the
    // surface and lie along it; a corpse sinks slowly to the bottom.
    waterLimp(dt) {
      if (!this.W.waterSim || !('vx' in this)) return;
      const m = this.mainPoint();
      this.noteWet(m);
      const d = this.depthOf(m);
      if (d < 0) return;
      this.vy -= (this.grav || 900) * dt; // (no free fall in water)
      const want = this.corpse ? 26 : U.clamp((4 - d) * 5, -80, 40);
      this.vy += (want - this.vy) * U.approach(4, dt);
      this.vx *= Math.pow(0.15, dt);
      this.floatBody(dt, 2, !this.corpse);
    }
    // Body points under water: slowed by it, and (floating) drifting up
    // toward the surface, so a floating body lies along it rather than
    // hanging down.
    floatBody(dt, depth, floats) {
      for (const ch of [this.spine, this.chain, this.tail]) {
        if (!(ch instanceof RW.Chain)) continue;
        for (let i = 1; i < ch.pts.length; i++) {
          const q = ch.pts[i];
          const d = this.depthOf(q);
          if (d < 0) continue;
          q.py += (q.y - q.py) * 0.3; // drag
          if (floats && d > depth) {
            const k = Math.min(d - depth, 70 * dt);
            q.y -= k;
            q.py -= k;
          }
        }
      }
    }
    // Water-haters in the water: thrashing at the surface, paddling for the
    // nearest dry footing, hauling out as soon as they reach it.
    waterPanic(dt) {
      const W = this.W;
      const S = W.waterSim;
      const lead = this.pipeLead();
      this.noteWet(lead);
      this.panicT = (this.panicT || 0) - dt;
      if (this.panicT <= 0 || !this.dryGoal) {
        this.dryGoal = this.nearestDry(lead.x, lead.y);
        this.panicT = 0.8;
      }
      const g = this.dryGoal;
      const surf = S.surfaceY(lead.x, lead.y);
      let tx = g ? g.x : lead.x;
      let ty = (surf === null ? lead.y : surf) + 1;
      if (g && Math.abs(g.x - lead.x) < W.cell * 1.6 && g.y < ty + W.cell) ty = g.y; // up and out
      // The small and weak (dropwigs, small centipedes) can't keep up: they
      // struggle, slip under, and drown within a few seconds.
      if (this.drowns) {
        this.drownT = (this.drownT || 0) + dt;
        ty += Math.min(30, this.drownT * 6); // going under
        if (this.drownT > 1.5 && Math.random() < dt * 6) this.eco.burst(lead.x, (surf === null ? lead.y : surf) + 2, 'rgba(220,235,255,0.7)', 1); // bubbles
        if (this.drownT > 7) {
          this.drownT = 0;
          this.panicking = false;
          this.kill();
          return false;
        }
      }
      const dx = tx - lead.x;
      const dy = ty - lead.y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = U.clamp((this.p.speed || 60) * (this.drowns ? 0.25 : 0.55), 15, 70) * (0.4 + Math.abs(Math.sin(this.age * (this.drowns ? 14 : 9))));
      const st = Math.min(d, sp * dt);
      this.pipeMove((dx / d) * st, (dy / d) * st, dt);
      const ch = this.spine || this.chain;
      if (ch instanceof RW.Chain) {
        this.floatBody(dt, 1, true);
        this.tunnelWiggle(ch, this.age * 16);
      }
      if ('vx' in this) this.vx = this.vy = 0;
      if (this.pather) this.pather.clear();
      return false;
    }
    // The nearest dry cell it could stand or cling in, through open cells.
    nearestDry(x, y) {
      const W = this.W;
      const caps = this.caps;
      if (!caps) return null;
      const C = W.cols;
      const start = W.cellY(y) * C + W.cellX(x);
      const seen = new Set([start]);
      const q = [start];
      for (let h = 0; h < q.length && h < 900; h++) {
        const i = q[h];
        const cx = i % C;
        const cy = (i / C) | 0;
        if (!W.waterCell(cx, cy) && !W.waterCell(cx, cy + 1) && RW.Nav.valid(W, cx, cy, caps) && !(W.passageAt && W.passage(cx, cy) >= 0)) return { x: W.centerX(cx), y: W.centerY(cy) };
        for (const [nx, ny] of [[cx, cy - 1], [cx - 1, cy], [cx + 1, cy], [cx, cy + 1]]) {
          if (!W.inBounds(nx, ny) || W.solid(nx, ny)) continue;
          const j = ny * C + nx;
          if (seen.has(j)) continue;
          seen.add(j);
          q.push(j);
        }
      }
      return null;
    }
    // ---- passages ----
    // One-cell tunnels through the rock (experimental maps). A creature goes
    // through one end to end as through a pipe: head first, the body drawn
    // along the head's own trail, up and down as easily as along. Meeting
    // something bigger (or hungry) coming the other way, it has to squeeze
    // itself round, which takes a moment, and go back.
    tryTunnel() {
      const W = this.W;
      const lead = this.pipeLead();
      // already in one (fell or was flung in): out by the nearer end
      const here = this.tunnelCd > 0 ? -1 : W.passage(W.cellX(lead.x), W.cellY(lead.y));
      if (here >= 0) {
        const p = W.passages[here];
        const k = p.cells.findIndex(([cx, cy]) => cx === W.cellX(lead.x) && cy === W.cellY(lead.y));
        // on the way it's facing (turning back on itself would fold the
        // body in half); facing neither way, by the nearer end
        let toB = k >= p.cells.length / 2;
        const sp = this.spine || this.chain;
        if (sp instanceof RW.Chain && sp.pts.length > 1) {
          const fx = lead.x - sp.pts[1].x;
          const fy = lead.y - sp.pts[1].y;
          const nb = p.cells[Math.min(p.cells.length - 1, k + 1)];
          const na = p.cells[Math.max(0, k - 1)];
          const dB = (W.centerX(nb[0]) - W.centerX(na[0])) * fx + (W.centerY(nb[1]) - W.centerY(na[1])) * fy;
          if (Math.abs(dB) > 0.5) toB = dB > 0;
        }
        this.startTunnel(p, toB, toB ? k : p.cells.length - 1 - k);
        return true;
      }
      if (this.tunnelCd > 0 || !this.pather || !this.pather.nodes) return false;
      for (let k = 0; k < 3; k++) {
        const n = this.pather.peek(k);
        if (!n) break;
        const pid = W.passage(n.cx, n.cy);
        if (pid < 0) continue;
        const p = W.passages[pid];
        const a = p.cells[0];
        const b = p.cells[p.cells.length - 1];
        const da = Math.hypot(lead.x - W.centerX(a[0]), lead.y - W.centerY(a[1]));
        const db = Math.hypot(lead.x - W.centerX(b[0]), lead.y - W.centerY(b[1]));
        if (Math.min(da, db) > W.cell * 1.4) return false;
        this.startTunnel(p, da <= db, 0);
        return true;
      }
      return false;
    }
    // In at one end (fromA: the `a` end), from cell index `from` along it.
    startTunnel(p, fromA, from) {
      const W = this.W;
      const cells = fromA ? p.cells : p.cells.slice().reverse();
      const pt = ([cx, cy]) => ({ x: W.centerX(cx), y: W.centerY(cy) });
      const doorIn = fromA ? p.a : p.b;
      const doorOut = fromA ? p.b : p.a;
      const route = cells.slice(from || 0).map(pt);
      route.push(pt(doorOut));
      const sp = this.spine || this.chain;
      this.tunnel = {
        p,
        route,
        i: 0,
        doorIn,
        doorOut,
        trail: sp instanceof RW.Chain ? sp.pts.slice().reverse().map((q) => ({ x: q.x, y: q.y })) : null,
        turnT: 0,
      };
      if ('vx' in this) this.vx = this.vy = 0;
      if (this.turn) this.turn = null;
      this.label = '';
    }
    tunnelBodyLen() {
      const sp = this.spine || this.chain;
      return sp instanceof RW.Chain ? sp.seg.reduce((a, b) => a + b, 0) : 16;
    }
    tunnelStep(dt) {
      const T = this.tunnel;
      const W = this.W;
      const sp = this.spine || this.chain;
      const chain = sp instanceof RW.Chain;
      if (this.stunT > 0) {
        this.stunT -= dt;
        return false;
      }
      // squeezing round: a wriggle in place, then off back the other way
      if (T.turnT > 0) {
        T.turnT -= dt;
        if (chain) {
          const P = sp.pts;
          for (let i = 1; i < P.length; i++) {
            const w = Math.sin(this.age * 26 + i * 1.3) * 0.6;
            P[i].x += w;
            P[i].y -= w;
          }
        }
        if (T.turnT <= 0) this.tunnelReverse();
        return false;
      }
      const lead = this.pipeLead();
      // something in the way, coming at us down the same passage? (Jammed
      // for a few moments, whatever the reason, a pile-up or one stuck
      // ahead: it squeezes past, slipping by whatever's there for a bit.)
      // (held up: no real headway for a while, however the hold-up flickers)
      if (!T.mark || Math.hypot(lead.x - T.mark.x, lead.y - T.mark.y) > 6) {
        T.mark = { x: lead.x, y: lead.y };
        T.stallT = 0;
      } else T.stallT += dt;
      if (T.stallT > JAM_SLIP && !(T.slipT > 0)) {
        T.slipT = 1.5;
        T.stallT = 0;
      }
      if (T.slipT > 0) T.slipT -= dt;
      else for (const c of this.eco.creatures) {
        if (c === this || !c.tunnel || c.tunnel.p !== T.p || c.dead || c.corpse) continue;
        const o = c.pipeLead();
        const tgt = T.route[Math.min(T.i, T.route.length - 1)];
        const ahead = (o.x - lead.x) * (tgt.x - lead.x) + (o.y - lead.y) * (tgt.y - lead.y) > 0;
        if (!ahead || Math.hypot(o.x - lead.x, o.y - lead.y) > W.cell * 1.6) continue;
        const facing = c.tunnel.doorOut === T.doorIn;
        if (!facing) return false; // (just behind one going the same way: wait)
        // the smaller (or the one that's prey to the other) backs off
        const preyToIt = c.diet && c.diet.some((s2) => (s2.endsWith('*') ? this.species.startsWith(s2.slice(0, -1)) : s2 === this.species));
        const backOff = preyToIt || this.tunnelBodyLen() < c.tunnelBodyLen() || (this.tunnelBodyLen() === c.tunnelBodyLen() && this.id > c.id);
        // (turned round twice already, in a crowd: no more backing off and
        // forth; it holds its ground, and squeezes past when it's had enough)
        if (backOff && !(T.turns >= 2)) {
          T.turnT = 0.5 + this.tunnelBodyLen() / 110; // the longer, the slower round
          T.turns = (T.turns || 0) + 1;
        }
        return false;
      }
      const tgt = T.route[T.i];
      const dx = tgt.x - lead.x;
      const dy = tgt.y - lead.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.5) {
        T.i++;
        if (T.i >= T.route.length) return this.endTunnel();
        return false;
      }
      // in pushes, not a glide: surge, gather, surge
      T.phase = (T.phase || 0) + dt * 8;
      const surge = 0.35 + 1.25 * Math.max(0, Math.sin(T.phase));
      const speed = U.clamp((this.p.speed || 60) * 0.8, 42, 90) * surge;
      if (this.phase !== undefined) this.phase += dt * 12 * surge; // (a centipede's legs ripple)
      this.crawlPhase = T.phase;
      const st = Math.min(d, speed * dt);
      const mx = (dx / d) * st;
      const my = (dy / d) * st;
      if (chain) {
        const P = sp.pts;
        P[0].x += mx;
        P[0].y += my;
        T.trail.push({ x: P[0].x, y: P[0].y });
        this.layOnTrail(sp, T.trail);
        this.tunnelWiggle(sp, T.phase);
      } else {
        this.pipeMove(mx, my, dt);
      }
      return false;
    }
    // Every body point on the head's trail, at its distance back along it.
    layOnTrail(sp, trail) {
      const P = sp.pts;
      let ti = trail.length - 1;
      let along = 0;
      let need = 0;
      for (let i = 1; i < P.length; i++) {
        need += sp.seg[i - 1];
        while (ti > 0) {
          const a = trail[ti];
          const b = trail[ti - 1];
          const l = Math.hypot(a.x - b.x, a.y - b.y);
          if (along + l >= need) {
            const t = l > 0 ? (need - along) / l : 0;
            P[i].x = a.x + (b.x - a.x) * t;
            P[i].y = a.y + (b.y - a.y) * t;
            break;
          }
          along += l;
          ti--;
        }
        if (ti <= 0) {
          P[i].x = trail[0].x;
          P[i].y = trail[0].y;
        }
        P[i].px = P[i].x;
        P[i].py = P[i].y;
      }
      P[0].px = P[0].x;
      P[0].py = P[0].y;
      // (only as much trail as the body needs)
      if (trail.length > 400) trail.splice(0, trail.length - 300);
    }
    // Squeezing along: a wave runs down the body side to side (the head
    // stays on the line), and the legs paw at the tunnel walls in turn,
    // reaching forward and shoving back.
    tunnelWiggle(sp, phase) {
      const P = sp.pts;
      const n = P.length;
      const amp = Math.min(3, this.W.cell * 0.14);
      const off = [];
      for (let i = 0; i < n; i++) {
        const a = P[Math.max(0, i - 1)];
        const b = P[Math.min(n - 1, i + 1)];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl;
        dy /= dl;
        off.push({ dx, dy, nx: -dy, ny: dx });
        if (i === 0) continue;
        const k = Math.sin(phase * 1.3 - i * 0.9) * amp * Math.min(1, i / 2);
        P[i].x += -dy * k;
        P[i].y += dx * k;
        P[i].px = P[i].x;
        P[i].py = P[i].y;
      }
      if (this.legs) {
        this.legs.forEach((l, j) => {
          const at = Math.min(l.at || 0, n - 1);
          const a = P[at];
          const o = off[at];
          const f = l.leg.foot;
          if (!f) return;
          const side = l.near ? 1 : -1;
          const reach = (l.leg.l1 + l.leg.l2) * 0.55;
          const swing = Math.sin(phase + (l.leg.group || 0) * Math.PI + j * 0.4);
          const tx = a.x + o.dx * swing * reach + o.nx * side * this.W.cell * 0.4;
          const ty = a.y + o.dy * swing * reach + o.ny * side * this.W.cell * 0.4;
          f.x += (tx - f.x) * 0.5;
          f.y += (ty - f.y) * 0.5;
          l.leg.planted = false;
        });
      }
    }
    // Squeezed round: the other end leads now, back the way it came.
    tunnelReverse() {
      const T = this.tunnel;
      const W = this.W;
      const sp = this.spine || this.chain;
      if (sp instanceof RW.Chain) {
        if (this.reverse) this.reverse();
        else {
          sp.pts.reverse();
          sp.seg.reverse();
        }
        T.trail = sp.pts.slice().reverse().map((q) => ({ x: q.x, y: q.y }));
      } else if (this.facing !== undefined) {
        this.facing = -this.facing;
      }
      // back out from where the leading end now is (the old tail): the
      // route points it has already passed, nearest first, then the door
      // (only points ahead of the new lead, the way it now faces: one back
      // over its own body would fold it in half)
      const lead = this.pipeLead();
      const nb = sp instanceof RW.Chain ? sp.pts[1] : null;
      const fx = nb ? lead.x - nb.x : 0;
      const fy = nb ? lead.y - nb.y : 0;
      let k = -1;
      let bd = Infinity;
      for (let j = 0; j < Math.max(1, T.i); j++) {
        const q = T.route[j];
        if (nb && (q.x - lead.x) * fx + (q.y - lead.y) * fy < -2) continue;
        const d = Math.hypot(q.x - lead.x, q.y - lead.y);
        if (d < bd) {
          bd = d;
          k = j;
        }
      }
      // (nothing ahead and the new lead not in the passage: it had barely
      // gone in, and it's out already)
      if (k < 0 && W.passage(W.cellX(lead.x), W.cellY(lead.y)) < 0) {
        this.endTunnel();
        return;
      }
      const back = k >= 0 ? T.route.slice(0, k + 1).reverse() : [];
      back.push({ x: W.centerX(T.doorIn[0]), y: W.centerY(T.doorIn[1]) });
      const din = T.doorIn;
      T.doorIn = T.doorOut;
      T.doorOut = din;
      T.route = back;
      T.i = 0;
    }
    endTunnel() {
      this.tunnel = null;
      this.crawlPhase = undefined;
      this.tunnelCd = 1.2;
      if ('vx' in this) this.vx = this.vy = 0;
      if (this.pather) {
        this.pather.nodes = null;
        this.pather.timer = 0;
      }
      return false;
    }

    // Killed: a spray, then a corpse that lies where it falls (X'd-out eyes)
    // until a predator carries it off and swallows it.
    die(n) {
      const m = this.mainPoint();
      this.eco.burst(m.x, m.y, this.bloodColor || '#2a1418', n || 12, this.bulk());
      this.kill();
    }
    kill() {
      if (this.corpse || this.dead) return;
      this.tunnel = null;
      // who did it: whatever has hold of it, else whatever hit it just now
      const lh = this.lastHit;
      this.killedBy = this.grabbedBy || (lh && this.eco.t - lh.t < 8 ? lh.by : null);
      this.corpse = true;
      this.corpseT = 0;
      this.stunT = 0;
      this.flipped = Math.random() < 0.5;
      if (this.holding) this.release();
      this.state = 'dead';
      this.label = '';
    }

    // Window dragged under us: ride along.
    carry(dx, dy) {}
    // Move the whole body rigidly (used to dig out of solids).
    shiftAll(dx, dy) {
      this.carry(dx, dy);
    }
    onUnburrowed() {
      this.contactId = null;
      if ('vx' in this) this.vx = this.vy = 0;
      if (this.pather) {
        // keep the goal, but plan a fresh route from where we came out
        this.pather.nodes = null;
        this.pather.timer = 0;
      }
    }

    // --- unburrowing ---
    // A window dropped on a creature, or one dragged to pin it against the
    // taskbar or a screen edge, can leave it inside a solid, squeezed in a
    // crack thinner than its body, or pushed off the screen. Collision alone
    // can't fix that (it pushes points out to the nearest edge, which may be
    // more solid), so once trapped for a moment the creature wriggles its way
    // to the nearest open cell, ignoring collisions, then carries on.
    trapped() {
      const W = this.W;
      const m = this.mainPoint();
      if (!isFinite(m.x) || !isFinite(m.y)) return false;
      if (m.x < -2 || m.y < -2 || m.x > W.w + 2 || m.y > W.h + 2) {
        // (out past the edge of the screen: trapped only where that edge is
        // rock; the sky over an open top, or past an open side, is just air,
        // and digging a batfly out of it threw up dirt in mid-air)
        const cx = W.cellX(m.x);
        const cy = W.cellY(m.y);
        const ox = cx < 0 ? -1 : cx >= W.cols ? W.cols : null;
        const oy = cy < 0 ? -1 : cy >= W.rows ? W.rows : null;
        const ix = U.clamp(cx, 0, W.cols - 1);
        const iy = U.clamp(cy, 0, W.rows - 1);
        // (off a corner: air if either edge there is open)
        if (ox !== null && oy !== null) return W.solid(ix, oy) && W.solid(ox, iy);
        return W.solid(ox !== null ? ox : ix, oy !== null ? oy : iy);
      }
      if (W.isSolidPt(m.x, m.y)) return true;
      const c = this.squeezeClear || 3;
      return (
        (W.isSolidPt(m.x, m.y - c) && W.isSolidPt(m.x, m.y + c)) ||
        (W.isSolidPt(m.x - c, m.y) && W.isSolidPt(m.x + c, m.y))
      );
    }
    // Nearest open nav cell (not solid, on screen, with open neighbours so it
    // isn't another crack) to (x, y).
    findExit(x, y) {
      const W = this.W;
      const cx0 = U.clamp(W.cellX(x), 0, W.cols - 1);
      const cy0 = U.clamp(W.cellY(y), 0, W.rows - 1);
      const open = (cx, cy) => W.inBounds(cx, cy) && !W.solid(cx, cy);
      const maxR = Math.max(W.cols, W.rows);
      for (let r = 0; r <= maxR; r++) {
        let best = null;
        let bd = Infinity;
        for (let cy = cy0 - r; cy <= cy0 + r; cy++) {
          for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
            if (Math.max(Math.abs(cx - cx0), Math.abs(cy - cy0)) !== r || !open(cx, cy)) continue;
            let n = 0;
            if (open(cx - 1, cy)) n++;
            if (open(cx + 1, cy)) n++;
            if (open(cx, cy - 1)) n++;
            if (open(cx, cy + 1)) n++;
            if (n < 2) continue;
            const px = W.centerX(cx);
            const py = W.centerY(cy);
            if (W.isSolidPt(px, py)) continue;
            const d = (px - x) * (px - x) + (py - y) * (py - y);
            if (d < bd) {
              bd = d;
              best = { x: px, y: py };
            }
          }
        }
        if (best) return best;
      }
      return null;
    }
    // Returns true while digging out (the creature's own logic is skipped).
    unburrowStep(dt) {
      const ub = this.unburrow;
      if (!ub) {
        // (in a passage the body brushes the rock round its corners: that's
        // not being trapped, and digging it out fought the crawl)
        if (this.grabbedBy || this.alpha < 0.5 || this.coil || this.tunnel) {
          this.trappedT = 0;
          return false;
        }
        this.trapCheckT = (this.trapCheckT || 0) - dt;
        if (this.trapCheckT > 0) return false;
        this.trapCheckT = 0.1;
        if (!this.trapped()) {
          this.trappedT = 0;
          return false;
        }
        this.trappedT = (this.trappedT || 0) + 0.1;
        if (this.trappedT < 0.35) return false;
        this.trappedT = 0;
        const m = this.mainPoint();
        const exit = this.findExit(m.x, m.y);
        if (!exit) {
          this.burrowAway(true);
          return true;
        }
        if (this.holding) this.release();
        this.unburrow = { tx: exit.x, ty: exit.y, t: 0, phase: Math.random() * 6 };
        this.label = 'unburrow';
        return true;
      }
      ub.t += dt;
      const m = this.mainPoint();
      const dx = ub.tx - m.x;
      const dy = ub.ty - m.y;
      const d = Math.hypot(dx, dy);
      if (d < 1.5 || ub.t > 4) {
        this.unburrow = null;
        this.label = '';
        if (this.eco.burst) this.eco.burst(m.x, m.y, '#1a1612', 5);
        this.onUnburrowed();
        return false;
      }
      // digging: slow start, side-to-side wriggle across the direction of travel
      const speed = 60 + 220 * Math.min(1, ub.t * 2.5);
      const step = Math.min(d, speed * dt);
      const wig = Math.sin(ub.t * 28 + ub.phase) * 2.2 * Math.min(1, d / 20);
      const ux = dx / d;
      const uy = dy / d;
      this.shiftAll(ux * step - uy * wig * dt * 28, uy * step + ux * wig * dt * 28);
      return true;
    }

    // Screen area this creature may draw into, [x0, y0, x1, y1] in world
    // units (used to limit the per-frame pixel pass).
    bounds() {
      const m = this.mainPoint();
      return [m.x - 48, m.y - 48, m.x + 48, m.y + 48];
    }
    // Feeding on the wing: where to drift so the catch hanging off us stays
    // on screen (null when it already is).
    keepCatchOnScreen() {
      const c = this.holding;
      if (!c) return null;
      const m = 30;
      const W = this.W;
      let dx = 0;
      let dy = 0;
      if (c.x < m) dx = m - c.x;
      else if (c.x > W.w - m) dx = W.w - m - c.x;
      if (c.y < m) dy = m - c.y;
      else if (c.y > W.h - m) dy = W.h - m - c.y;
      return dx || dy ? { x: this.pos.x + dx * 2, y: this.pos.y + dy * 2 } : null;
    }
    static ptsBounds(pts, pad) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of pts) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
    }

    // Hunger, for the creature menu: the species that get hungry keep a
    // "full for so long" timer (fullT) or, slugcats, a hunger level.
    // (noodleflies: an adult hunts once its huntCd runs out)
    canHunger() {
      return this.fullT !== undefined || this.hunger !== undefined || (this.huntCd !== undefined && !!(this.diet && this.diet.length));
    }
    // How big it is, for scaling sprays (about 1 for a mid-sized lizard):
    // the length of its body chain; a Daddy Long Legs is simply big.
    bulk() {
      if (this.species === 'daddy') return 2.6;
      const pts = (this.spine && this.spine.pts) || (this.chain && this.chain.pts);
      if (!pts) return 0.5;
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return U.clamp(len / 60, 0.4, 3);
    }
    makeHungry() {
      if (this.fullT !== undefined) this.fullT = 0;
      if (this.huntCd !== undefined) this.huntCd = 0;
      if (this.hunger !== undefined) this.hunger = 1;
      if (this.meals !== undefined) this.meals = 0;
    }

    // (AI state labels are drawn over everything by Ecosystem.drawLabels)
    drawDebug(ctx) {}
    // its route: every creature's with debug.showPaths, or just this one's
    // (showPath, from the creature menu)
    drawPath(ctx, pather) {
      if (!(this.eco.cfg.debug.showPaths || this.showPath) || !pather || !pather.nodes) return;
      ctx.strokeStyle = 'rgba(255,220,80,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const m = this.mainPoint();
      ctx.moveTo(m.x, m.y);
      for (let i = pather.i; i < pather.nodes.length; i++) {
        const n = pather.nodes[i];
        ctx.lineTo(n.x, n.y);
      }
      ctx.stroke();
      for (let i = pather.i; i < pather.nodes.length; i++) {
        const n = pather.nodes[i];
        if (n.type === Nav.JUMP) ctx.fillStyle = '#5cf';
        else if (n.type === Nav.FALL) ctx.fillStyle = '#f75';
        else continue;
        ctx.fillRect(n.x - 3, n.y - 3, 6, 6);
      }
    }
  }

  RW.Creatures = RW.Creatures || {};
  RW.Pather = Pather;
  RW.Chain = Chain;
  RW.Leg = Leg;
  RW.Creature = Creature;
})();
