// The foreground: plants (reeds, kelp, vines, tufts, coral, glowing bulbs,
// the batfly grass), hanging chains and the cables slung between walls.
// Drawn in front of the creatures, they sway with the rain (a little in
// light rain, hard in the downpour) and get bumped aside by anything that
// pushes through them; they never block anything. Each casts a soft shadow
// onto the wall behind, down and to the right like the background props',
// which moves with it.
//
// The plant code paints each clump through a recorder (fol.rec) just as it
// would onto a canvas, calling rec.plant(x, y, hang) first to say where the
// clump is rooted (hang: rooted at the top, a vine hanging down; opts.swag:
// a cable slung between two points, swinging about the line between them).
// Each clump is then drawn a few times over, bent a little further each
// time (its strokes re-drawn through the bend, so every pose is clean pixel
// art: no rows of pixels sliding sideways), all onto one sprite sheet. Each
// frame shows the pose nearest its lean: one plain copy a plant (two with
// its shadow).
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;

  const PROPS = ['strokeStyle', 'fillStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha', 'globalCompositeOperation'];
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
      const sw = o.swag || null;
      this.cur = {
        x, y, hang: !!hang || !!sw,
        // the line it bends about: through (x, y), level, or along a
        // cable's two ends
        m: sw ? (sw.y1 - sw.y0) / (sw.x1 - sw.x0 || 1) : 0,
        swag: sw,
        // how readily it moves: underwater kelp and hanging vines are slack,
        // a cable held at both ends stiffer
        give: o.give || (sw ? 0.5 : hang ? 1.25 : 1),
        wet: !!o.wet,
        tip: o.tip || null, // (told how far its bottom has swung: a chain's drips follow it)
        len: o.len || 0,
        rigid: !!o.rigid, // (swings straight, like a chain, rather than curving)
        ops: [], state: { lineWidth: 1 },
        x0: x, y0: y, x1: x, y1: y,
        a: 0, v: 0, phase: Math.random() * 10,
      };
      this.plants.push(this.cur);
      return this.cur;
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
    //   shadow: the colour of the shadows (the room's darkest)
    build(k, shadow) {
      if (this.built === k) return;
      this.built = k;
      this.cur = null;
      // each plant's reach (root to tip, or a cable's sag) and its poses:
      // from leaning hard one way to the other, the tip moving up to M art
      // pixels, in 2n + 1 steps
      for (const p of this.plants) {
        p.reach = Math.max(1, p.swag ? p.swag.sag : p.hang ? p.y1 - p.y : p.y - p.y0);
        p.M = U.clamp(p.reach * k * 0.25, 1, 6);
        p.n = Math.min(3, Math.ceil(p.M));
        p.pad = Math.ceil(p.M) + 1;
        p.w = Math.max(1, Math.ceil((p.x1 - p.x0) * k) + 2 + 2 * p.pad);
        p.h = Math.max(1, Math.ceil((p.y1 - p.y0) * k) + 2);
        p.pose = 0;
      }
      // shelves on one sheet, a row of poses per plant
      const gap = 2;
      const SW = Math.max(1024, ...this.plants.map((p) => (2 * p.n + 1) * (p.w + gap)));
      let x = 0;
      let y = 0;
      let row = 0;
      for (const p of this.plants) {
        const need = (2 * p.n + 1) * (p.w + gap);
        if (x + need > SW) {
          x = 0;
          y += row + gap;
          row = 0;
        }
        p.sx = x;
        p.sy = y;
        x += need;
        row = Math.max(row, p.h);
      }
      const SH = Math.max(1, y + row);
      const c = document.createElement('canvas');
      c.width = SW;
      c.height = SH;
      const g = c.getContext('2d', { willReadFrequently: true });
      for (const p of this.plants) {
        for (let j = -p.n; j <= p.n; j++) {
          const T = (j / p.n) * (p.M / k); // the tip's shift, world units
          const bend = this.bender(p, T);
          const ox = p.sx + (j + p.n) * (p.w + gap);
          g.save();
          g.beginPath();
          g.rect(ox, p.sy, p.w, p.h);
          g.clip();
          g.setTransform(k, 0, 0, k, ox + 1 + p.pad - p.x0 * k, p.sy + 1 - p.y0 * k);
          for (const [m, a] of p.ops) {
            if (typeof g[m] !== 'function') g[m] = a;
            else g[m](...bend(m, a));
          }
          g.restore();
        }
      }
      U.crisp(c, 128);
      // (plain copies to draw from: the crisped one is kept in memory for
      // reading back, which makes drawing from it slow)
      const sheet = document.createElement('canvas');
      sheet.width = SW;
      sheet.height = SH;
      sheet.getContext('2d').drawImage(c, 0, 0);
      this.sheet = sheet;
      this.shadowSheet = null;
      if (shadow) {
        // the shadows: the same shapes, flat (none drawn under water)
        const sd = document.createElement('canvas');
        sd.width = SW;
        sd.height = SH;
        const sx = sd.getContext('2d');
        sx.drawImage(sheet, 0, 0);
        sx.globalCompositeOperation = 'source-in';
        sx.fillStyle = shadow;
        sx.fillRect(0, 0, SW, SH);
        this.shadowSheet = sd;
      }
      this.gap = gap;
    }
    // The bend for one pose: each point shifted sideways by T times how far
    // along the plant it is (squared: a stem curves, stiff at the root; a
    // chain or cable swings straight). Shapes (leaves, bulbs, links) move
    // whole with their centre.
    bender(p, T) {
      const sw = p.swag;
      const along = (x, y) => {
        let u;
        if (sw) {
          const t = U.clamp((x - sw.x0) / (sw.x1 - sw.x0 || 1), 0, 1);
          u = (y - U.lerp(sw.y0, sw.y1, t)) / p.reach;
        } else u = p.hang ? (y - p.y) / p.reach : (p.y - y) / p.reach;
        u = U.clamp(u, 0, 1.2);
        return T * (p.rigid || sw ? u : u * u);
      };
      return (m, a) => {
        if (m === 'moveTo' || m === 'lineTo' || m === 'quadraticCurveTo' || m === 'bezierCurveTo') {
          const b = a.slice();
          for (let i = 0; i + 1 < b.length; i += 2) b[i] += along(b[i], b[i + 1]);
          return b;
        }
        if (m === 'arc' || m === 'ellipse') {
          const b = a.slice();
          b[0] += along(a[0], a[1]);
          return b;
        }
        if (m === 'fillRect') {
          const b = a.slice();
          b[0] += along(a[0] + a[2] / 2, a[1] + a[3] / 2);
          return b;
        }
        return a;
      };
    }

    // The wall fans' draughts (props with .blow, the way each blows, and
    // .reach, how far): each plant's lean in them, signed, strongest right
    // in front of a fast fan and falling off downwind and to the sides.
    setFans(fans) {
      for (const p of this.plants) {
        const px = (p.x0 + p.x1) / 2;
        const py = p.swag || p.hang ? (p.y + p.y1) / 2 : (p.y0 + p.y) / 2;
        let w = 0;
        for (const q of fans) {
          const d = (px - q.x) * q.blow; // (downwind)
          const far = q.reach + q.r;
          if (d < -q.r * 0.3 || d > far) continue;
          const spread = q.r * 1.3 + Math.max(0, d) * 0.35;
          const dy = Math.abs(py - q.y);
          if (dy > spread) continue;
          w += q.blow * (1 - Math.max(0, d) / far) * (1 - (dy / spread) ** 2) * (0.3 + Math.abs(q.spin || 0.3)) * 0.22;
        }
        p.fan = U.clamp(w, -0.2, 0.2);
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
        let sway = p.wet ? 0.05 * Math.sin(t * 0.8 + p.phase) : wind * Math.sin(t * (1.7 + 0.3 * Math.sin(p.phase)) + p.phase) + wind * 0.5;
        // (a fan's draught: a steady lean, fluttering)
        if (p.fan && !p.wet) sway += p.fan * (0.75 + 0.2 * Math.sin(t * 6.3 + p.phase) + 0.12 * Math.sin(t * 11.7 + p.phase * 3));
        let push = 0;
        for (let i = 0; i < pts.length; i += 3) {
          const x = pts[i];
          const y = pts[i + 1];
          if (!(x > p.x0 - 3 && x < p.x1 + 3 && y > p.y0 - 3 && y < p.y1 + 3)) continue;
          if (p.swag) {
            // (a cable: only right at it, not anywhere under it)
            const w = p.swag;
            const u = (x - w.x0) / (w.x1 - w.x0 || 1);
            if (u < 0 || u > 1 || Math.abs(y - (U.lerp(w.y0, w.y1, u) + 4 * u * (1 - u) * w.sag)) > 8) continue;
          }
          push += pts[i + 2];
        }
        const target = sway * g;
        p.v += ((target - p.a) * 26 - p.v * 5) * dt + U.clamp(push * 0.0009 * g, -0.12, 0.12);
        p.a = U.clamp(p.a + p.v * dt, -0.6, 0.6);
        if (p.tip) p.tip.dx = p.a * p.len;
        // the pose nearest its lean (the tip's shift, a * reach)
        if (p.n) p.pose = Math.round(U.clamp((p.a * p.reach * this.built) / p.M, -1, 1) * p.n);
      }
    }

    // Each in its pose: a plain copy off the sheet (ox, oy: an offset in art
    // pixels, for the shadows).
    blit(ctx, img, k, ox, oy, skipWet) {
      const gap = this.gap;
      for (const p of this.plants) {
        if (skipWet && p.wet) continue;
        ctx.drawImage(img, p.sx + (p.pose + p.n) * (p.w + gap), p.sy, p.w, p.h, Math.round(p.x0 * k) - 1 - p.pad + ox, Math.round(p.y0 * k) - 1 + oy, p.w, p.h);
      }
    }
    draw(ctx, k) {
      if (!this.plants.length || !this.sheet) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.88; // (a creature behind still shows through a little)
      this.blit(ctx, this.sheet, k, 0, 0, false);
      ctx.restore();
    }
    // The shadows, on the wall: drawn before the creatures (which pass
    // between the plant and its shadow).
    drawShadows(ctx, k) {
      if (!this.plants.length || !this.shadowSheet) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.38;
      this.blit(ctx, this.shadowSheet, k, Math.max(1, Math.round(2.5 * k)), Math.max(1, Math.round(4 * k)), true);
      ctx.restore();
    }
  }

  RW.Foliage = Foliage;
})();
