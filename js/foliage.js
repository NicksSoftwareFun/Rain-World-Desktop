// Foreground plants: reeds, kelp, vines, tufts, coral, glowing bulbs, the
// batfly grass. Drawn in front of the creatures, they sway with the rain (a
// little in light rain, hard in the downpour) and get bumped aside by
// anything that pushes through them; they never block anything.
//
// The plant code paints each clump through a recorder (fol.rec) just as it
// would onto a canvas, calling rec.plant(x, y, hang) first to say where the
// clump is rooted (hang: rooted at the top, a vine hanging down). Each clump
// is then drawn once onto its own little crisp sprite, and every frame it's
// drawn bent about its root: a shear, which is one drawImage a plant.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;

  const PROPS = ['strokeStyle', 'fillStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha'];
  const METHODS = ['beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'closePath', 'stroke', 'fill', 'fillRect', 'arc', 'ellipse', 'save', 'restore'];

  class Foliage {
    constructor() {
      this.plants = [];
      this.cur = null;
      const self = this;
      // A stand-in canvas context: records what's drawn, plant by plant.
      const rec = { plant: (x, y, hang, opts) => self.begin(x, y, hang, opts) };
      for (const p of PROPS) {
        Object.defineProperty(rec, p, {
          get: () => (self.cur ? self.cur.state[p] : undefined),
          set: (v) => {
            if (!self.cur) return;
            self.cur.state[p] = v;
            self.cur.ops.push([p, v]);
          },
        });
      }
      for (const m of METHODS) {
        rec[m] = (...a) => {
          const c = self.cur;
          if (!c) return;
          c.ops.push([m, a]);
          self.extend(c, m, a);
        };
      }
      this.rec = rec;
      this.built = null;
    }
    begin(x, y, hang, opts) {
      const o = opts || {};
      this.cur = {
        x, y, hang: !!hang,
        // how readily it moves: underwater kelp and hanging vines are slack
        give: o.give || (hang ? 1.25 : 1),
        wet: !!o.wet,
        ops: [], state: { lineWidth: 1 },
        x0: x, y0: y, x1: x, y1: y,
        a: 0, v: 0, phase: Math.random() * 10,
      };
      this.plants.push(this.cur);
    }
    extend(c, m, a) {
      const w = (c.state.lineWidth || 1) + 2;
      const pts = [];
      if (m === 'fillRect') pts.push([a[0], a[1]], [a[0] + a[2], a[1] + a[3]]);
      else if (m === 'arc') pts.push([a[0] - a[2], a[1] - a[2]], [a[0] + a[2], a[1] + a[2]]);
      else if (m === 'ellipse') pts.push([a[0] - a[2], a[1] - a[3]], [a[0] + a[2], a[1] + a[3]]);
      else for (let i = 0; i + 1 < a.length; i += 2) pts.push([a[i], a[i + 1]]);
      for (const [x, y] of pts) {
        c.x0 = Math.min(c.x0, x - w);
        c.y0 = Math.min(c.y0, y - w);
        c.x1 = Math.max(c.x1, x + w);
        c.y1 = Math.max(c.y1, y + w);
      }
    }

    // Each plant onto its own crisp sprite at the art-pixel scale (k: art
    // pixels per world unit).
    build(k) {
      if (this.built === k) return;
      this.built = k;
      this.cur = null;
      for (const p of this.plants) {
        const w = Math.max(1, Math.ceil((p.x1 - p.x0) * k) + 2);
        const h = Math.max(1, Math.ceil((p.y1 - p.y0) * k) + 2);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.setTransform(k, 0, 0, k, (1 - p.x0 * k), (1 - p.y0 * k));
        for (const [m, a] of p.ops) {
          if (typeof x[m] === 'function') x[m](...a);
          else x[m] = a;
        }
        U.crisp(c, 128);
        // (a plain copy to draw from: the crisped one is kept in memory for
        // reading back, which makes drawing it every frame slow)
        const d = document.createElement('canvas');
        d.width = w;
        d.height = h;
        d.getContext('2d').drawImage(c, 0, 0);
        p.img = d;
      }
    }

    // Sway and bumps: each plant a damped spring about upright, pushed by
    // the rain's wind and by whatever moves through it.
    update(dt, creatures, intensity, t) {
      if (!this.plants.length) return;
      // the points creatures push plants with, and how fast they're going
      const pts = [];
      const prev = (this.prev = this.prev || new WeakMap());
      for (const c of creatures) {
        if (c.dead || c.leaving || c.alpha < 0.3) continue;
        const m = c.mainPoint();
        const q = prev.get(c);
        const vx = q ? (m.x - q.x) / Math.max(dt, 1e-3) : 0;
        prev.set(c, { x: m.x, y: m.y });
        if (Math.abs(vx) < 8) continue;
        const body = (c.spine && c.spine.pts) || (c.chain && c.chain.pts) || null;
        pts.push(m.x, m.y, vx);
        if (body) for (let i = 3; i < body.length; i += 4) pts.push(body[i].x, body[i].y, vx);
      }
      const gust = 0.5 + 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);
      const wind = (0.015 + 0.07 * intensity) * (0.6 + 0.8 * gust);
      for (const p of this.plants) {
        const g = p.give;
        // (underwater: a slow drift in the current, whatever the rain)
        const sway = p.wet ? 0.05 * Math.sin(t * 0.8 + p.phase) : wind * Math.sin(t * (1.7 + 0.3 * Math.sin(p.phase)) + p.phase) + wind * 0.5;
        let push = 0;
        for (let i = 0; i < pts.length; i += 3) {
          const x = pts[i];
          const y = pts[i + 1];
          if (x > p.x0 - 3 && x < p.x1 + 3 && y > p.y0 - 3 && y < p.y1 + 3) push += pts[i + 2];
        }
        const target = sway * g;
        p.v += ((target - p.a) * 26 - p.v * 5) * dt + U.clamp(push * 0.0009 * g, -0.12, 0.12);
        p.a = U.clamp(p.a + p.v * dt, -0.6, 0.6);
      }
    }

    // Bent about the root: x shifts in proportion to the distance from it.
    draw(ctx, k) {
      if (!this.plants.length) return;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.88; // (a creature behind still shows through a little)
      for (const p of this.plants) {
        if (!p.img) continue;
        const s = p.hang ? -p.a : p.a;
        const ry = p.y * k;
        // x' = x + s * (ry - y): leaning away from the root
        ctx.setTransform(1, 0, -s, 1, s * ry, 0);
        ctx.drawImage(p.img, Math.round(p.x0 * k) - 1, Math.round(p.y0 * k) - 1);
      }
      ctx.restore();
    }
  }

  RW.Foliage = Foliage;
})();
