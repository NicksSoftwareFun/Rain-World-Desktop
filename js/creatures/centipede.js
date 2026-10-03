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
      this.pather.update(dt, h.x, h.y);
      this.pather.advance(h.x, h.y, W.cell * 0.8);
      // Poles only count when the path uses one (see lizard.js). Grip range
      // covers path nodes that sit up to a cell from a partly covered wall.
      const pn = this.pather.current();
      const mask = pn && W.pole(pn.cx, pn.cy) && !W.solid(pn.cx, pn.cy + 1) ? this.mask : this.maskNoPole;
      const S = this.size;
      let g = W.nearestSurface(h.x, h.y, 24 * S, mask);
      if (this.dropT > 0) {
        this.dropT -= dt;
        g = null;
      }
      const node = this.pather.current();
      let dvx = 0;
      let dvy = 0;
      let leaving = false;
      if (node) {
        let ty = node.y;
        if (node.type === Nav.FALL && g) {
          if (Math.abs(node.x - h.x) < W.cell * 0.6) this.dropT = 0.35;
          else ty = h.y;
        }
        const dx = node.x - h.x;
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
      h.x += this.vx * dt;
      h.y += this.vy * dt;
      if (g && !leaving) {
        const e = g.d - 5 * S;
        h.x -= g.nx * e * 0.3;
        h.y -= g.ny * e * 0.3;
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
          const e = s.d - 5 * S;
          P[i].x -= s.nx * e * 0.35;
          P[i].y -= s.ny * e * 0.35;
        }
        W.collideCircle(P[i], 3 * S);
      }
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
      for (let i = 0; i < n; i++) {
        const t = tangent(i);
        for (const s of [-1, 1]) {
          const w = Math.sin(this.phase + i * 0.9 + (s > 0 ? Math.PI : 0));
          const st = this.corpse ? 0 : w * 2.2;
          const lift = this.corpse ? 0 : Math.max(0, w) * 1.2;
          const kx = P[i].x - this.ux * (3.4 - lift) * S + t.x * (s * 2.4 + st * 0.5) * S;
          const ky = P[i].y - this.uy * (3.4 - lift) * S + t.y * (s * 2.4 + st * 0.5) * S;
          ctx.moveTo(P[i].x, P[i].y);
          ctx.lineTo(kx, ky);
          ctx.lineTo(P[i].x - this.ux * (7 - lift) * S + t.x * (s * 3.4 + st) * S, P[i].y - this.uy * (7 - lift) * S + t.y * (s * 3.4 + st) * S);
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
        const endTaper = i === 0 ? 1.08 : i === n - 1 ? 0.78 : 1.02 - 0.17 * k;
        const hh = 2.5 * S * endTaper; // half height: long, flat plates
        const hl = seg * 0.5 * (i === 0 ? 1.05 : i === n - 1 ? 0.85 : 1); // half length
        // which local side faces the surface: the belly band goes there
        const belly = -Math.sin(ang) * -this.ux + Math.cos(ang) * -this.uy > 0 ? 1 : -1;
        const cap = i === 0 || i === n - 1;
        const col = cap ? (i === 0 ? '#2a1410' : '#24120e') : U.mix(front, back, k * 0.6);
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
          roundRect(-hl + 0.8 * S, belly > 0 ? -hh + 0.5 * S : -hh * 0.25, hl * 2 - 1.6 * S, hh * 1.25 - 0.5 * S, hh * 0.3);
          ctx.fill();
        }
        if (i === 0) {
          // mandibles: two hooks reaching forward and curling down
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
