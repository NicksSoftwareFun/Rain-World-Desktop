// Food: dangle fruit grows on vines under ledges and ripens. It only drops
// when something hits it (a thrown rock or spear, or a creature barging
// through), then gets carried off and eaten by slugcats, or rots away.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;

  const FRUIT_LIFE = 60; // seconds a dropped fruit lasts unclaimed
  const SHRIVEL = 4; // ...the last few of them spent shrinking away

  class Fruit {
    constructor(eco, x, y) {
      this.eco = eco;
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.r = 4.5;
      this.dead = false;
      this.heldBy = null;
      this.contactId = null;
      this.grounded = false;
      this.rot = U.rand(-0.4, 0.4);
      this.age = 0;
      this.claimedBy = null;
    }
    carry(dx, dy) {
      this.x += dx;
      this.y += dy;
    }
    update(dt) {
      this.age += dt;
      if (this.heldBy) {
        if (this.heldBy.dead) this.heldBy = null;
        else {
          const h = this.heldBy.itemPoint();
          this.x = h.x;
          this.y = h.y;
          return;
        }
      }
      if (this.y > this.eco.world.h + 60) this.dead = true; // (down a bottomless pit)
      this.vy += 900 * dt;
      this.vx *= this.grounded ? 0.8 : 0.995;
      // fruit floats: up to the surface, bobbing there
      const W = this.eco.world;
      const wd = W.waterSim ? W.waterSim.depthAt(this.x, this.y) : -1;
      if (wd >= 0) {
        this.vy -= 900 * dt;
        this.vy += (U.clamp((2 - wd) * 6, -70, 30) - this.vy) * U.approach(5, dt);
        this.vx *= Math.pow(0.3, dt);
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const c = this.eco.world.collideCircle(this, this.r);
      this.grounded = false;
      if (c) {
        const vn = this.vx * c.nx + this.vy * c.ny;
        if (vn < 0) {
          this.vx -= vn * c.nx * 1.35;
          this.vy -= vn * c.ny * 1.35;
        }
        if (c.ny < -0.6) {
          this.grounded = true;
          this.contactId = c.id;
          this.rot += this.vx * dt * 0.2;
        }
      }
      // Drop a claim whose slugcat gave up, fled, left or was eaten.
      const cl = this.claimedBy;
      if (cl && (cl.dead || cl.leaving || (cl.item !== this && (cl.food !== this || cl.state !== 'forage')))) this.claimedBy = null;
      // rots away if nobody comes for it (a claim holds it a while longer)
      if (this.age > FRUIT_LIFE * (this.claimedBy ? 2 : 1)) this.dead = true;
    }
    draw(ctx) {
      const left = FRUIT_LIFE * (this.claimedBy ? 2 : 1) - this.age;
      if (left < SHRIVEL && !this.heldBy) {
        const k = Math.max(0.2, left / SHRIVEL);
        ctx.save();
        ctx.translate(this.x, this.y + 5 * (1 - k)); // shrivels down onto the floor
        ctx.scale(k, k);
        drawFruit(ctx, 0, 0, this.rot, 1);
        ctx.restore();
      } else {
        drawFruit(ctx, this.x, this.y, this.rot, 1);
      }
    }
  }

  function drawFruit(ctx, x, y, rot, a) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha *= a;
    ctx.fillStyle = '#1f3fd1';
    ctx.beginPath();
    ctx.ellipse(0, 0.5, 4.2, 5.2, 0, 0, U.TAU);
    ctx.fill();
    ctx.fillStyle = '#5b86ff';
    ctx.beginPath();
    ctx.ellipse(-1.2, -1, 1.8, 2.4, -0.3, 0, U.TAU);
    ctx.fill();
    ctx.fillStyle = '#0d1a4d';
    ctx.fillRect(-0.6, -5.5, 1.2, 2);
    ctx.restore();
  }

  // A vine hanging from a ceiling that grows a fruit and holds it once ripe
  // until something knocks it off, then regrows.
  class FruitPlant {
    constructor(eco, x, y, len) {
      this.eco = eco;
      this.x = x;
      this.y = y;
      this.len = len;
      this.grow = U.rand(0.3, 1);
      this.phase = U.rand(0, 10);
      this.regrowRate = 1 / U.rand(35, 80);
    }
    tip() {
      const sway = Math.sin(this.eco.t * 0.9 + this.phase) * 4;
      return { x: this.x + sway, y: this.y + this.len };
    }
    ripe() {
      return this.grow >= 1;
    }
    // Hit by a thrown rock or spear, or a creature: a ripe fruit drops.
    knockOff(vx, vy) {
      if (!this.ripe()) return;
      const t = this.tip();
      const f = new Fruit(this.eco, t.x, t.y + 5);
      f.vx = (vx || 0) * 0.3;
      f.vy = 40 + Math.max(0, (vy || 0) * 0.3);
      this.eco.items.push(f);
      this.grow = 0;
    }
    update(dt) {
      if (this.eco.world.isSolidPt(this.x, this.y + 4)) return; // covered by a window
      this.grow = Math.min(1, this.grow + dt * this.regrowRate);
      if (!this.ripe()) return;
      // a creature barging into the ripe fruit knocks it loose (a slugcat
      // swimming down to an underwater one picks it instead)
      const t = this.tip();
      const fy = t.y + 5;
      for (const c of this.eco.creatures) {
        if (c.dead || c.burrow || !c.hitParts || (this.under && c.species === 'slugcat')) continue;
        const sp = Math.hypot(c.vx || 0, c.vy || 0);
        if (sp < 120 || Math.abs(c.x - t.x) > 80 || Math.abs(c.y - fy) > 80) continue;
        for (const pt of c.hitParts()) {
          if (U.dist(pt.x, pt.y, t.x, fy) < pt.r + 5) {
            this.knockOff(c.vx, c.vy);
            return;
          }
        }
      }
    }
    draw(ctx) {
      const pal = this.eco.palette;
      if (!pal) return;
      const t = this.tip();
      ctx.strokeStyle = U.rgba(U.mix(pal.near, '#55703f', 0.3));
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.quadraticCurveTo(this.x, this.y + this.len * 0.6, t.x, t.y);
      ctx.stroke();
      // small leaves
      ctx.fillStyle = U.rgba(U.mix(pal.near, '#55703f', 0.35));
      for (let k = 1; k <= 3; k++) {
        const ly = this.y + (this.len * k) / 4;
        ctx.beginPath();
        ctx.ellipse(this.x + (k % 2 ? 3 : -3), ly, 3, 1.3, k % 2 ? 0.5 : -0.5, 0, U.TAU);
        ctx.fill();
      }
      const g = Math.min(1, this.grow);
      if (g > 0.15) {
        ctx.save();
        ctx.translate(t.x, t.y + 5 * g);
        ctx.scale(g, g);
        drawFruit(ctx, 0, 0, 0, 1);
        ctx.restore();
      }
    }
  }

  // The underwater kind: a kelp-like stalk standing up off the bottom of a
  // pool with the fruit at its top. Thrown things stall in water, so the
  // only way to get one is to swim down and pluck it. Knocked loose, the
  // fruit floats up to the surface.
  class SeaFruitPlant extends FruitPlant {
    constructor(eco, x, y, len) {
      super(eco, x, y, len);
      this.under = true;
      this.claimedBy = null;
    }
    tip() {
      const sway = Math.sin(this.eco.t * 0.7 + this.phase) * 5;
      return { x: this.x + sway, y: this.y - this.len };
    }
    // Picked by hand (a swimming slugcat): the fruit comes away in it.
    pluck(by) {
      if (!this.ripe()) return null;
      const t = this.tip();
      const f = new Fruit(this.eco, t.x, t.y);
      this.eco.items.push(f);
      f.heldBy = by;
      this.grow = 0;
      this.claimedBy = null;
      return f;
    }
    knockOff(vx, vy) {
      if (!this.ripe()) return;
      const t = this.tip();
      const f = new Fruit(this.eco, t.x, t.y);
      f.vx = (vx || 0) * 0.2;
      f.vy = -20;
      this.eco.items.push(f);
      this.grow = 0;
    }
    update(dt) {
      const c = this.claimedBy;
      if (c && (c.dead || c.leaving || c.seaPlant !== this)) this.claimedBy = null;
      super.update(dt);
    }
    draw(ctx) {
      const pal = this.eco.palette;
      if (!pal) return;
      const t = this.tip();
      const stem = U.rgba(U.mix(pal.near, '#3f7a5a', 0.4));
      ctx.strokeStyle = stem;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.quadraticCurveTo(this.x - (t.x - this.x) * 0.8, this.y - this.len * 0.5, t.x, t.y + 3);
      ctx.stroke();
      // ribbon leaves off the stalk, waving
      ctx.fillStyle = U.rgba(U.mix(pal.near, '#4f9a6a', 0.45));
      for (let k = 1; k <= 4; k++) {
        const u = k / 5;
        const ly = this.y - this.len * u;
        const lx = U.lerp(this.x, t.x, u * u);
        const s = k % 2 ? 1 : -1;
        const w = Math.sin(this.eco.t * 1.3 + this.phase + k) * 2;
        ctx.beginPath();
        ctx.ellipse(lx + s * (5 + w), ly, 5, 1.6, s * 0.4, 0, U.TAU);
        ctx.fill();
      }
      const g = Math.min(1, this.grow);
      if (g > 0.15) {
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.scale(g, g);
        // a pale glow round it: it catches the eye down there
        ctx.fillStyle = 'rgba(140,180,255,0.18)';
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, U.TAU);
        ctx.fill();
        drawFruit(ctx, 0, 0, 0, 1);
        ctx.restore();
      }
    }
  }

  RW.Fruit = Fruit;
  RW.FruitPlant = FruitPlant;
  RW.SeaFruitPlant = SeaFruitPlant;
  RW.drawFruit = drawFruit;
})();
