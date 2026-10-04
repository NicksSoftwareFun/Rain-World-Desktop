// Rocks and spears (Rain World wiki): slugcats pick them up and throw them.
// A rock stuns (a hit on a lizard's head flips it over; red lizards shrug it
// off), makes a creature drop what it holds and clatters loudly enough to
// draw predators. A spear bounces off a lizard's armoured head but sticks
// into bodies for real damage, skewers batflies and small centipedes, and
// lodges in walls. Both knock ripe fruit off vines.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;

  const SPEAR_LEN = 30;
  const ROCK_COLS = ['#6f6a63', '#5d5853', '#7a7064', '#5b5f63', '#6d5f55'];

  class Weapon {
    constructor(eco, kind, x, y) {
      this.eco = eco;
      this.kind = kind; // 'rock' | 'spear'
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.ang = U.rand(-0.15, 0.15) + (Math.random() < 0.5 ? 0 : Math.PI);
      this.rot = U.rand(0, U.TAU);
      this.state = 'free'; // free | held | flying | stuck | embedded
      this.dead = false;
      this.heldBy = null;
      this.thrower = null;
      this.contactId = null;
      this.grounded = false;
      this.flyT = 0;
      this.pickupCd = 0;
      this.stuckT = 0;
      this.skewer = null; // species skewered on a spear
      this.claimedBy = null;
      this.r = kind === 'rock' ? 3 : 2;
      if (kind === 'rock') {
        // rocks come in many shapes: bricks, stones, nuts, bits of pipe
        const n = U.randInt(5, 7);
        const sq = U.rand(0.6, 1);
        this.shape = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * U.TAU;
          const rr = U.rand(2.4, 3.6);
          this.shape.push([Math.cos(a) * rr, Math.sin(a) * rr * sq]);
        }
        this.col = U.pick(ROCK_COLS);
      }
    }
    get pickable() {
      return this.state === 'free' && this.pickupCd <= 0 && !this.dead;
    }
    tip() {
      return { x: this.x + Math.cos(this.ang) * SPEAR_LEN * 0.5, y: this.y + Math.sin(this.ang) * SPEAR_LEN * 0.5 };
    }
    carry(dx, dy) {
      if (this.state === 'free' || this.state === 'stuck') {
        this.x += dx;
        this.y += dy;
      }
    }
    bounds() {
      const e = this.kind === 'spear' ? SPEAR_LEN * 0.6 + 4 : 8;
      return [this.x - e, this.y - e, this.x + e, this.y + e];
    }

    pickUp(by) {
      this.state = 'held';
      this.heldBy = by;
      this.claimedBy = null;
      this.vx = this.vy = 0;
    }
    drop(vx, vy) {
      this.state = 'free';
      this.heldBy = null;
      this.host = null;
      this.vx = vx || U.rand(-40, 40);
      this.vy = vy === undefined ? -60 : vy;
      this.pickupCd = 0.4;
    }
    throwAt(vx, vy, by) {
      this.state = 'flying';
      this.heldBy = null;
      this.thrower = by;
      this.vx = vx;
      this.vy = vy;
      this.flyT = 0;
      this.pickupCd = 0.375; // the wiki's 15-frame cooldown
      if (this.kind === 'spear') this.ang = Math.atan2(vy, vx);
    }

    update(dt) {
      const W = this.eco.world;
      this.pickupCd -= dt;
      // a claim lapses once its slugcat is no longer coming for it
      const cl = this.claimedBy;
      if (cl && (cl.dead || cl.leaving || cl.fetch !== this)) this.claimedBy = null;
      if (this.state === 'held') {
        const h = this.heldBy;
        if (!h || h.dead) {
          this.drop();
          return;
        }
        const p = h.weaponPoint(this);
        this.x = p.x;
        this.y = p.y;
        this.ang = h.weaponAngle(this);
        return;
      }
      if (this.state === 'embedded') {
        const c = this.host;
        this.stuckT -= dt;
        if (!c || c.dead || c.leaving || this.stuckT <= 0) {
          this.drop(0, -40);
          return;
        }
        const parts = c.hitParts();
        const p = parts[Math.min(this.hostIdx, parts.length - 1)];
        this.x = p.x - Math.cos(this.ang) * SPEAR_LEN * 0.25;
        this.y = p.y - Math.sin(this.ang) * SPEAR_LEN * 0.25;
        return;
      }
      if (this.state === 'stuck') {
        // lodged in a surface; falls out after a while or if the window moves off it
        this.stuckT -= dt;
        const t = this.tip();
        if (this.stuckT <= 0 || !W.isSolidPt(t.x + Math.cos(this.ang) * 2, t.y + Math.sin(this.ang) * 2)) this.drop(0, 0);
        return;
      }
      if (this.state === 'flying') {
        this.flyT += dt;
        const sp = Math.hypot(this.vx, this.vy);
        const n = Math.max(1, Math.ceil((sp * dt) / 3));
        const h = dt / n;
        for (let i = 0; i < n && this.state === 'flying'; i++) this.flyStep(h);
        if (this.state === 'flying' && (this.flyT > 3 || this.y > W.h + 40)) this.state = 'free';
        return;
      }
      // free: lying about, or tumbling after a bounce (gone if it drops out
      // through a bottomless pit)
      if (this.y > W.h + 60) {
        this.dead = true;
        return;
      }
      this.vy += 900 * dt;
      this.vx *= this.grounded ? Math.pow(0.02, dt) : 0.995;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const c = W.collideCircle(this, this.r);
      this.grounded = false;
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx * 1.3;
          this.vy -= vn * c.ny * 1.3;
        }
        if (c.ny < -0.6) {
          this.grounded = true;
          this.contactId = c.id;
          if (this.kind === 'rock') this.rot += this.vx * dt * 0.3;
          // a spear settles flat
          else this.ang = Math.cos(this.ang) >= 0 ? this.ang * 0.8 : Math.PI + (this.ang - Math.PI) * 0.8;
        }
      }
      if (this.kind === 'spear' && !this.grounded) this.ang = U.lerpAngle(this.ang, this.ang + 0.3, 0.1);
      if (this.x < -50 || this.x > W.w + 50 || this.y > W.h + 50) this.dead = true;
    }

    flyStep(h) {
      const W = this.eco.world;
      const eco = this.eco;
      // spears fly flat for a moment, then drop like anything else
      const g = this.kind === 'spear' ? (this.flyT < 0.45 ? 260 : 900) : 900;
      this.vy += g * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
      if (this.kind === 'spear') this.ang = Math.atan2(this.vy, this.vx);
      const lead = this.kind === 'spear' ? this.tip() : this;

      // creatures (never slugcats; the thrower is safe for a moment)
      for (const c of eco.creatures) {
        if (c.dead || c.corpse || c.leaving || c.alpha < 0.5 || c.species === 'slugcat') continue;
        if (c === this.thrower && this.flyT < 0.25) continue;
        const parts = c.hitParts();
        let hit = -1;
        let hd = Infinity;
        for (let k = 0; k < parts.length; k++) {
          const p = parts[k];
          const d = U.dist(lead.x, lead.y, p.x, p.y);
          if (d < p.r + this.r && d < hd) {
            hd = d;
            hit = k;
          }
        }
        if (hit >= 0) {
          this.strike(c, hit, parts[hit].part);
          return;
        }
      }
      // fruit hanging on a vine
      for (const p of eco.plants) {
        if (!p.ripe()) continue;
        const t = p.tip();
        if (U.dist(lead.x, lead.y, t.x, t.y + 5) < 7) {
          p.knockOff(this.vx, this.vy);
          this.vx *= 0.5;
        }
      }
      // the world
      if (W.isSolidPt(lead.x, lead.y)) {
        const sp = Math.hypot(this.vx, this.vy);
        if (this.kind === 'spear' && sp > 260) {
          // lodge: back out to the surface, then sink the point in a little
          const ux = this.vx / sp;
          const uy = this.vy / sp;
          for (let k = 0; k < 20 && W.isSolidPt(this.tip().x, this.tip().y); k++) {
            this.x -= ux;
            this.y -= uy;
          }
          this.x += ux * 4;
          this.y += uy * 4;
          this.state = 'stuck';
          this.stuckT = U.rand(40, 90);
          const c = W.collideCircle({ x: this.tip().x, y: this.tip().y }, 0.1);
          this.contactId = c ? c.id : null;
          return;
        }
        // bounce off
        this.x -= this.vx * h;
        this.y -= this.vy * h;
        const probe = { x: lead.x, y: lead.y };
        const c = W.collideCircle(probe, this.r + 1);
        if (c) {
          const vn = this.vx * c.nx + this.vy * c.ny;
          this.vx = (this.vx - 1.5 * vn * c.nx) * 0.45;
          this.vy = (this.vy - 1.5 * vn * c.ny) * 0.45;
        } else {
          this.vx *= -0.3;
          this.vy *= -0.3;
        }
        if (this.kind === 'rock' && sp > 200) eco.noise(this.x, this.y);
        this.state = 'free';
      }
    }

    // Hit creature c on part index k.
    strike(c, k, part) {
      const eco = this.eco;
      if (this.thrower) c.lastHit = { by: this.thrower, t: eco.t };
      if (this.kind === 'rock') {
        if (c.onRockHit) c.onRockHit(this, part);
        else c.stun(1);
        if (c.holding) c.release();
        eco.noise(this.x, this.y);
        this.vx *= -0.25;
        this.vy = -140;
        this.state = 'free';
        return;
      }
      const res = c.onSpearHit ? c.onSpearHit(this, part) : 'bounce';
      if (res === 'skewer') {
        // spitted on the spear: it falls with its catch
        this.skewer = c.species;
        this.vx *= 0.25;
        this.vy = Math.min(this.vy, 0) * 0.3;
        this.state = 'free';
      } else if (res === 'embed') {
        this.state = 'embedded';
        this.host = c;
        this.hostIdx = k;
        this.stuckT = U.rand(6, 12);
      } else {
        // glanced off (armoured head, or the hit killed it outright)
        this.vx *= res === 'drop' ? 0.1 : -0.25;
        this.vy = res === 'drop' ? 0 : -150;
        this.state = 'free';
      }
    }

    draw(ctx) {
      if (this.kind === 'rock') {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rot);
        ctx.fillStyle = this.col;
        ctx.beginPath();
        this.shape.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(-1.5, -2, 1.2, 1.2);
        ctx.restore();
        return;
      }
      // spear: a length of rusty rebar with a sharpened point
      const c = Math.cos(this.ang);
      const s = Math.sin(this.ang);
      const hx = SPEAR_LEN / 2;
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.strokeStyle = '#2e2622';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.x - c * hx, this.y - s * hx);
      ctx.lineTo(this.x + c * (hx - 4), this.y + s * (hx - 4));
      ctx.stroke();
      ctx.fillStyle = '#5b4b40';
      ctx.beginPath();
      ctx.moveTo(this.x + c * hx, this.y + s * hx);
      ctx.lineTo(this.x + c * (hx - 5) - s * 1.4, this.y + s * (hx - 5) + c * 1.4);
      ctx.lineTo(this.x + c * (hx - 5) + s * 1.4, this.y + s * (hx - 5) - c * 1.4);
      ctx.fill();
      if (this.skewer) {
        ctx.fillStyle = this.skewer === 'batfly' ? '#22222c' : '#8a4a1c';
        const k = hx - 9;
        ctx.beginPath();
        ctx.ellipse(this.x + c * k, this.y + s * k, this.skewer === 'batfly' ? 3 : 5, 2.2, this.ang, 0, U.TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // A red lizard's spine, spat from the open mouth: a long needle of red
  // bone, nearly spear length. Whatever it hits is knocked over and stunned
  // briefly, like a rock (an armoured creature only takes a wound), and it
  // lodges there, riding along in the body; a miss sticks in the terrain.
  // Either way it's gone after 40 s (or when its host leaves).
  const SPINE_LEN = 24;
  const SPINE_LIFE = 40;
  class Spine {
    constructor(eco, x, y, vx, vy, shooter) {
      this.eco = eco;
      this.kind = 'spine';
      this.x = x;
      this.y = y;
      this.vx = vx;
      this.vy = vy;
      this.ang = Math.atan2(vy, vx);
      this.thrower = shooter;
      this.state = 'flying'; // flying | stuck (terrain) | embedded (creature)
      this.flyT = 0;
      this.stuckT = 0;
      this.dead = false;
      this.r = 2;
      this.contactId = null;
      this.host = null;
      this.col = (shooter && shooter.p && shooter.p.headColor) || '#ff1e2a';
    }
    update(dt) {
      if (this.state === 'flying') {
        // sub-steps so a fast spine can't skip through a thin body
        const n = 4;
        for (let i = 0; i < n && this.state === 'flying' && !this.dead; i++) this.step(dt / n);
        this.flyT += dt;
        if (this.flyT > 3 || this.x < -40 || this.x > this.eco.world.w + 40 || this.y > this.eco.world.h + 40) this.dead = true;
        return;
      }
      this.stuckT += dt;
      if (this.stuckT > SPINE_LIFE) this.dead = true;
      if (this.state === 'embedded') {
        const c = this.host;
        if (!c || c.dead || c.leaving || c.piping) {
          this.dead = true;
          return;
        }
        // the point stays buried in the same part, the shaft sticking out
        // at the angle it went in
        const parts = c.hitParts();
        const p = parts[Math.min(this.hostIdx, parts.length - 1)];
        this.x = p.x - Math.cos(this.ang) * (SPINE_LEN * 0.5 - p.r * 0.6);
        this.y = p.y - Math.sin(this.ang) * (SPINE_LEN * 0.5 - p.r * 0.6);
        return;
      }
      // stuck in terrain: gone if what it's in moves away (a dragged window)
      const t = this.tip();
      if (!this.eco.world.isSolidPt(t.x + Math.cos(this.ang) * 2, t.y + Math.sin(this.ang) * 2)) this.dead = true;
    }
    // carried along with the window or ledge it's lodged in
    carry(dx, dy) {
      if (this.state !== 'stuck') return;
      this.x += dx;
      this.y += dy;
    }
    tip() {
      return { x: this.x + Math.cos(this.ang) * SPINE_LEN * 0.5, y: this.y + Math.sin(this.ang) * SPINE_LEN * 0.5 };
    }
    step(h) {
      const W = this.eco.world;
      this.vy += 260 * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
      this.ang = Math.atan2(this.vy, this.vx);
      const t = this.tip();
      for (const c of this.eco.creatures) {
        if (c === this.thrower || c.dead || c.corpse || c.leaving || c.alpha < 0.5 || c.piping || c.unpiping || c.burrow) continue;
        const parts = c.hitParts();
        const k = parts.findIndex((q) => U.dist(t.x, t.y, q.x, q.y) < q.r + this.r);
        if (k < 0) continue;
        this.strike(c, k, parts[k].part);
        return;
      }
      if (W.isSolidPt(t.x, t.y)) {
        // lodge point first: back out to the surface, then sink in a little
        const ux = Math.cos(this.ang);
        const uy = Math.sin(this.ang);
        for (let k = 0; k < 12 && W.isSolidPt(this.tip().x, this.tip().y); k++) {
          this.x -= ux;
          this.y -= uy;
        }
        this.x += ux * 5;
        this.y += uy * 5;
        const c = W.collideCircle({ x: this.tip().x, y: this.tip().y }, 0.1);
        this.contactId = c ? c.id : null;
        this.state = 'stuck';
      }
    }
    strike(c, k, part) {
      if (this.thrower) c.lastHit = { by: this.thrower, t: this.eco.t };
      if (c.p && c.p.armored) {
        c.takeHit(0.35, this.thrower);
      } else {
        // knocked over and briefly stunned, like a rock
        if (c.onRockHit) c.onRockHit(this, part);
        else c.stun(U.rand(0.9, 1.3), true);
        if (c.holding) c.release();
        if ('vx' in c) {
          c.vx += this.vx * 0.3;
          c.vy -= 90;
        }
      }
      this.eco.burst(this.tip().x, this.tip().y, c.bloodColor || '#2a1418', 4);
      // and it stays in
      this.state = 'embedded';
      this.host = c;
      this.hostIdx = k;
    }
    bounds() {
      const h = SPINE_LEN / 2 + 3;
      return [this.x - h, this.y - h, this.x + h, this.y + h];
    }
    draw(ctx) {
      const c = Math.cos(this.ang);
      const s = Math.sin(this.ang);
      const h = SPINE_LEN / 2;
      ctx.save();
      if (this.stuckT > SPINE_LIFE - 1) ctx.globalAlpha = Math.max(0, SPINE_LIFE - this.stuckT);
      ctx.fillStyle = this.col;
      // a long red barb: widest a third of the way back, needle-sharp at
      // the point, tapering to a thin root
      const w = 1.8;
      const bx = this.x - c * h * 0.35;
      const by = this.y - s * h * 0.35;
      ctx.beginPath();
      ctx.moveTo(this.x + c * h, this.y + s * h);
      ctx.lineTo(bx - s * w, by + c * w);
      ctx.lineTo(this.x - c * h - s * 0.6, this.y - s * h + c * 0.6);
      ctx.lineTo(this.x - c * h + s * 0.6, this.y - s * h - c * 0.6);
      ctx.lineTo(bx + s * w, by - c * w);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  RW.Weapon = Weapon;
  RW.Spine = Spine;
  RW.SPEAR_LEN = SPEAR_LEN;
})();
