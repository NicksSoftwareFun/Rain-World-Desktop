// Engine: fixed-timestep simulation + rendering. It knows nothing about
// where geometry comes from — a "geometry provider" supplies the solid
// rectangles (windows, icons, taskbar), the cursor and clicks. The browser
// prototype uses a mock desktop; the Windows port swaps in a provider fed by
// a native helper.
//
// provider.poll() -> { rects: [{id, kind, x, y, w, h}], cursor: {x, y, inside}, clicks: [{x, y}] }
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;

  const STEP = 1 / 60;

  class Engine {
    constructor(canvas, cfg, provider) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cfg = cfg;
      this.provider = provider;
      this.acc = 0;
      this.last = 0;
      this.running = false;
      this.fps = 60;
      this.frameMs = 0;
      this.bgCanvas = document.createElement('canvas');
      this.spriteCanvas = document.createElement('canvas');
      this.spriteCtx = this.spriteCanvas.getContext('2d', { willReadFrequently: true });
      this.seed = 0;
      this.init();
    }

    // Creature scale works by simulating a smaller world and drawing it
    // magnified, so creatures, poles, ledges and physics all scale together.
    poll() {
      const g = this.provider.poll();
      const z = this.zoom;
      if (z === 1) return g;
      const s = (o) => Object.assign({}, o, { x: o.x / z, y: o.y / z });
      return {
        rects: g.rects.map((r) => ({ id: r.id, kind: r.kind, x: r.x / z, y: r.y / z, w: r.w / z, h: r.h / z })),
        cursor: g.cursor ? s(g.cursor) : null,
        clicks: (g.clicks || []).map(s),
        releases: (g.releases || []).map(s),
        pointer: g.pointer ? s(g.pointer) : null,
        paused: g.paused,
      };
    }

    // ---- the player's hand ----------------------------------------------------
    get hand() {
      if (!this._hand) {
        const eng = this;
        this._hand = {
          isHand: true,
          species: 'hand',
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          holding: null,
          dead: false,
          holdPoint() {
            return { x: this.x, y: this.y };
          },
          release() {
            eng.dropHand();
          },
        };
      }
      return this._hand;
    }
    // The creature (living or dead) whose body is nearest the press, if any.
    tryGrab(x, y) {
      const hand = this.hand;
      let best = null;
      let bd = Infinity;
      for (const c of this.eco.creatures) {
        if (c.dead || c.leaving || c.alpha < 0.3 || c.grabbedBy === hand) continue;
        for (const p of c.hitParts()) {
          const d = Math.hypot(p.x - x, p.y - y) - p.r;
          if (d < 10 && d < bd) {
            bd = d;
            best = c;
          }
        }
      }
      if (!best) return false;
      this.dropHand();
      if (best.grabbedBy) best.grabbedBy.release(); // snatched from a predator's jaws
      best.grabbedBy = hand;
      best.stunT = 0;
      best.unburrow = null;
      if (best.pather) best.pather.clear();
      if (best.onGrabbed) best.onGrabbed(hand);
      hand.holding = best;
      hand.x = x;
      hand.y = y;
      hand.vx = hand.vy = 0;
      return true;
    }
    // New wildlife: a fresh set of creatures and a rain cycle starting over.
    restartWildlife() {
      this.dropHand();
      this.eco.repopulate();
      this.weather.t = 0;
    }

    // Let go: it drops (or flies a little, if the mouse was moving).
    dropHand() {
      const hand = this.hand;
      const c = hand.holding;
      hand.holding = null;
      if (!c || c.grabbedBy !== hand) return;
      c.grabbedBy = null;
      const sp = Math.hypot(hand.vx, hand.vy);
      const k = sp > 700 ? 700 / sp : 1;
      if ('vx' in c) {
        c.vx = hand.vx * k * 0.8;
        c.vy = hand.vy * k * 0.8;
      }
      if (c.species === 'dropwig' && c.setState) c.setState('recover');
      if (c.pather) c.pather.version = -1;
    }

    init(keepSeed) {
      const cfg = this.cfg;
      // Map size 1 shows the world at 2x magnification; a bigger map zooms out.
      const map = +cfg.world.mapSize || (cfg.world.creatureScale ? 2 / cfg.world.creatureScale : 1);
      this.zoom = U.clamp(2 / map, 0.5, 3);
      this.W = Math.max(320, window.innerWidth) / this.zoom;
      this.H = Math.max(240, window.innerHeight) / this.zoom;
      this.world = new RW.World(cfg.world.cellSize || 20);
      this.world.resize(this.W, this.H);
      if (!keepSeed || !this.seed) this.seed = cfg.world.seed || Math.floor(Math.random() * 1e9);
      const rnd = U.mulberry32(this.seed);
      const g = this.poll();
      const opts = { floor: this.floorOf(g.rects) };
      this.decor = cfg.world.layout === 'experimental' && RW.Rooms ? RW.Rooms.generate(this.W, this.H, cfg, rnd, opts) : RW.Background.generateDecor(this.W, this.H, cfg, rnd, opts);
      this.world.setStatic(this.decor.ledges.concat(this.decor.beams || []), this.decor.poles);
      this.world.setPits(this.decor.pits);
      this.world.setOpenings(...this.openings());
      this.world.setWater(this.decor.water);
      this.world.setPassages(this.decor.passages);
      this.world.setDynamic(g.rects);
      this.world.rebuild();
      this.world.waterSim = RW.Water && this.decor.room ? new RW.Water(this.world, this.decor) : null;
      this.eco = new RW.Ecosystem(cfg, this.world);
      this.weather = this.weather || new RW.Background.Weather();
      this.weather.reset(this.W, this.H);
      this.weather.decor = this.decor;
      this.eco.weather = this.weather;
      this.eco.setDecor(this.decor);
      this.applyPalette();
    }

    // A room's openings in its outer wall (see World.setOpenings).
    openings() {
      const room = this.decor && this.decor.room;
      const W = this.world;
      if (!room || room.C !== W.cols) return [null, null, null];
      const top = new Uint8Array(W.cols);
      for (let x = 0; x < room.C; x++) top[x] = room.cells[x] !== 1 ? 1 : 0;
      const side = (x) => {
        const a = new Uint8Array(W.rows);
        for (let y = 0; y < room.R; y++) a[y] = room.cells[y * room.C + x] !== 1 ? 1 : 0;
        return a;
      };
      return [top, room.open === 'left' ? side(0) : null, room.open === 'right' ? side(room.C - 1) : null];
    }

    applyPalette() {
      // (an experimental map brings its region's palette)
      this.pal = this.decor && this.decor.region && RW.Rooms ? RW.Rooms.palette(this.decor.region) : RW.PALETTES[this.cfg.world.palette] || RW.PALETTES.industrial;
      this.eco.palette = this.pal;
      this.ps = U.clamp(+this.cfg.world.pixelScale || 2, 1, 4);
      this.canvas.width = Math.ceil((this.W * this.zoom) / this.ps);
      this.canvas.height = Math.ceil((this.H * this.zoom) / this.ps);
      this.spriteCanvas.width = this.canvas.width;
      this.spriteCanvas.height = this.canvas.height;
      this.eco.artPx = this.ps / this.zoom; // world units per art pixel
      this.weather.artPx = this.eco.artPx;
      this.light = this.currentLight();
      this.lightKey = RW.Background.Light.key(this.light);
      this.paintBackground();
    }
    paintBackground() {
      RW.Background.paint(this.bgCanvas, this.W, this.H, this.ps / this.zoom, this.pal, this.decor, this.seed % 100000, this.light);
    }
    // The light for now: the rain cycle's clock (or the preview hour); null
    // when the day-night light is off.
    currentLight() {
      const w = this.cfg.world;
      if (!w.realTimeLight) return null;
      return RW.Background.Light.at(+w.timeOfDay >= 0 ? +w.timeOfDay : this.cycleHour());
    }
    // The rain cycle is the day: 6:00 as it starts, 19:30 as the downpour
    // hits, and the downpour is the night, running round to dawn again.
    cycleHour() {
      const R = this.cfg.rain;
      const dp = U.clamp(+R.downpourFraction || 0.12, 0.02, 0.6);
      const ph = this.weather ? this.weather.phase : 0;
      const end = 1 - dp;
      return ph < end ? 6 + (ph / end) * 13.5 : 19.5 + ((ph - end) / dp) * 10.5;
    }
    // Every couple of seconds: the wash follows smoothly; the shadows (baked
    // into the background) only get repainted when they've moved enough.
    updateLight(dt) {
      this.lightT = (this.lightT || 0) - dt;
      if (this.lightT > 0) return;
      this.lightT = 0.5;
      this.light = this.currentLight();
      const key = RW.Background.Light.key(this.light);
      if (key !== this.lightKey) {
        this.lightKey = key;
        RW.Background.compose(this.bgCanvas, this.light); // just the shadows moving
      }
    }

    // New background and decor; keeps the creatures that still fit.
    regenerate(newSeed) {
      if (newSeed) this.cfg.world.seed = 0;
      const keep = this.eco ? this.eco.creatures : [];
      const keepItems = this.eco ? this.eco.items : [];
      const keepStash = this.eco ? this.eco.shelterStash : [];
      const t = this.weather ? this.weather.t : 0;
      const oldZoom = this.zoom;
      this.init(!newSeed);
      this.weather.t = t;
      // anyone sitting out the rain comes back out of the new map's pipes
      if (!newSeed) {
        for (const c of keepStash) {
          c.eco = this.eco;
          c.W = this.world;
          if (c.pather) c.pather.version = -1;
          c.shelterDen = null;
          this.eco.shelterStash.push(c);
        }
      }
      if (!newSeed && this.zoom !== oldZoom) {
        // Map resized: everyone stays put on screen and simply becomes
        // bigger or smaller relative to it (unburrowing sorts out anyone who
        // lands inside the rebuilt ledges).
        const r = oldZoom / this.zoom;
        for (const c of keep) {
          if (c.dead || c.leaving) continue;
          const m = c.mainPoint();
          c.eco = this.eco;
          c.W = this.world;
          c.shiftAll(m.x * r - m.x, m.y * r - m.y);
          if (c.pather) {
            c.pather.version = -1;
            c.pather.clear();
          }
          c.home = null;
          this.eco.creatures.push(c);
        }
        for (const it of keepItems) {
          if (it.dead || !(it instanceof RW.Fruit || it instanceof RW.Weapon)) continue;
          it.eco = this.eco;
          if (!it.heldBy && it.state !== 'embedded') {
            it.x *= r;
            it.y *= r;
            if (it.state === 'stuck') it.state = 'free';
          }
          this.eco.items.push(it);
        }
        this.eco.populated = true;
      } else if (!newSeed && this.zoom === oldZoom) {
        for (const c of keep) {
          if (c.x >= 0 && c.y >= 0 && c.x < this.W && c.y < this.H && !this.world.isSolidPt(c.x, c.y)) {
            c.eco = this.eco;
            c.W = this.world;
            if (c.pather) c.pather.version = -1;
            this.eco.creatures.push(c);
          }
        }
        this.eco.populated = true;
      }
    }

    resize() {
      const w = Math.max(320, window.innerWidth) / this.zoom;
      const h = Math.max(240, window.innerHeight) / this.zoom;
      if (Math.abs(w - this.W) < 1 && Math.abs(h - this.H) < 1) return;
      this.regenerate(false);
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.last = performance.now();
      const token = (this.loopToken = (this.loopToken || 0) + 1);
      const loop = (now) => {
        if (!this.running || token !== this.loopToken) return;
        const real = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        this.fps += (1 / Math.max(real, 1e-3) - this.fps) * 0.05;
        const t0 = performance.now();
        this.acc += real * U.clamp(+this.cfg.world.timeScale || 1, 0, 4);
        let steps = 0;
        while (this.acc >= STEP && steps < 5) {
          this.tick(STEP);
          this.acc -= STEP;
          steps++;
        }
        if (steps >= 5) this.acc = 0;
        // optional 30 fps cap: the sim stays fixed-step, only drawing is halved
        this.frameN = (this.frameN || 0) + 1;
        const skip = +this.cfg.world.maxFps === 30 && this.frameN % 2 === 1;
        if (!this.paused && !skip) this.render();
        this.frameMs += (performance.now() - t0 - this.frameMs) * 0.05;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    stop() {
      this.running = false;
      this.loopToken = (this.loopToken || 0) + 1; // orphan any pending frame
    }

    // Deterministic stepping for tests and screenshots.
    step(n) {
      for (let i = 0; i < n; i++) this.tick(STEP);
      this.render();
    }

    // The walkable floor: the top of a taskbar spanning the bottom of the
    // screen, else the screen's bottom edge.
    floorOf(rects) {
      let f = this.H;
      for (const r of rects || []) if (r.kind === 'taskbar' && r.w > this.W * 0.5 && r.y > this.H * 0.6) f = Math.min(f, r.y);
      return f;
    }
    tick(dt) {
      this.updateLight(dt);
      const g = this.poll();
      // (on a real desktop the taskbar is reported a moment after start: once
      // it is, the ground gets rebuilt to sit on it)
      if (this.decor && Math.abs(this.floorOf(g.rects) - this.decor.floor) > 4 && !this.refloorT) {
        this.refloorT = 1;
        setTimeout(() => {
          this.regenerate(false);
          this.refloorT = 0;
        }, 0);
      }
      this.paused = !!g.paused;
      if (g.paused) return; // wallpaper hidden behind a fullscreen app
      const moves = this.world.setDynamic(g.rects);
      if (this.world.rebuild()) {
        // nothing else to do: paths notice the version bump themselves
      }
      if (moves.length) this.eco.carry(moves);
      const c = g.cursor || { x: -9999, y: -9999, inside: false };
      this.eco.setCursor(c.x, c.y, !!c.inside, dt);
      // Press on a creature to pick it up (it hangs limp from the cursor);
      // let go to drop it. A press on empty wallpaper drops food if enabled.
      for (const k of g.clicks || []) {
        if (!this.tryGrab(k.x, k.y) && this.cfg.ecosystem.clickDropsFood) this.eco.dropFood(k.x, k.y);
      }
      const hand = this.hand;
      if (hand.holding) {
        const pt = g.pointer || c;
        hand.vx += ((pt.x - hand.x) / dt - hand.vx) * 0.3;
        hand.vy += ((pt.y - hand.y) / dt - hand.vy) * 0.3;
        hand.x = pt.x;
        hand.y = pt.y;
        const h = hand.holding;
        if (h.dead || h.leaving || h.grabbedBy !== hand) hand.holding = null;
      }
      if ((g.releases || []).length) this.dropHand();
      this.weather.update(dt, this.cfg, this.W, this.H, this.world);
      if (this.world.waterSim) this.world.waterSim.update(dt, this.weather, this.cfg.rain);
      this.eco.update(dt);
    }

    render() {
      const ctx = this.ctx;
      const cfg = this.cfg;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.bgCanvas, 0, 0);
      const k = this.zoom / this.ps;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      this.weather.drawFog(ctx, this.pal);
      this.weather.drawChains(ctx, this.decor, this.pal, this.eco.t);
      // Creatures go on their own layer, snapped to hard pixel edges.
      const sc = this.spriteCtx;
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(0, 0, this.spriteCanvas.width, this.spriteCanvas.height);
      sc.setTransform(k, 0, 0, k, 0, 0);
      this.eco.draw(sc);
      const rects = this.eco.dirty.map((r) => [r[0] * k - 1, r[1] * k - 1, r[2] * k + 1, r[3] * k + 1]);
      U.crispRects(this.spriteCanvas, rects);
      this.eco.drawLate(this.spriteCanvas, k);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.spriteCanvas, 0, 0);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      this.drawWater(ctx);
      this.weather.drawRain(ctx, this.pal);
      // the time of day over everything: warm at dawn and dusk, dim at night
      const L = this.light;
      if (L && L.washA > 0.005) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = U.rgba(U.mix('#ffffff', L.washCol, L.washA));
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.restore();
      }
      if (cfg.rain.enabled && cfg.rain.showCycleHud) this.weather.drawHud(ctx, this.W, this.H, this.pal);
      if (cfg.debug.showGrid) this.drawGrid(ctx);
      // the water max height slider being dragged: a dotted line at the
      // height the flood will reach
      if (this.floodPreviewUntil && performance.now() < this.floodPreviewUntil) {
        const y = Math.round(this.H * (1 - (+cfg.rain.floodHeight || 0)));
        const a = Math.min(1, (this.floodPreviewUntil - performance.now()) / 500);
        ctx.fillStyle = U.rgba(U.mix((this.pal && this.pal.water) || '#6a8aa0', '#ffffff', 0.7), 0.9 * a);
        const dash = 8 / (this.zoom / this.ps);
        for (let x = 0; x < this.W; x += dash * 2) ctx.fillRect(x, y - 1, dash, 2);
        ctx.font = `${Math.round(12 / (this.zoom / this.ps))}px monospace`;
        ctx.fillText(`water max ${Math.round((+cfg.rain.floodHeight || 0) * 100)}%`, 12, y - 6);
      }
      if (cfg.debug.showFps) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '12px monospace';
        ctx.fillText(`${this.fps.toFixed(0)} fps  ${this.frameMs.toFixed(1)} ms  ${this.eco.creatures.length} creatures`, 10, 16);
      }
    }

    // Water (a placeholder for now): a see-through body in front of whatever
    // is in it, a lighter surface line rippling gently.
    drawWater(ctx) {
      if (this.world.waterSim) return this.world.waterSim.draw(ctx, this.pal);
      const L = this.decor && this.decor.water;
      if (!L || !L.length) return;
      const pal = this.pal;
      const wc = pal.water || '#3d5b70';
      const t = this.eco.t;
      // darker the deeper it goes (from the surface down)
      const top = Math.min(...L.map((r) => r.y));
      const bot = Math.max(...L.map((r) => r.y + r.h));
      const g = ctx.createLinearGradient(0, top, 0, Math.max(top + 1, bot));
      g.addColorStop(0, U.rgba(wc, 0.62));
      g.addColorStop(1, U.rgba(U.mix(wc, '#02040a', 0.55), 0.85));
      ctx.fillStyle = g;
      for (const r of L) ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = U.rgba(U.mix(wc, pal.light, 0.5), 0.9);
      for (const r of L) {
        if (!r.surface) continue;
        for (let x = r.x; x < r.x + r.w; x += 5) {
          const dy = Math.round(Math.sin(x * 0.09 + t * 1.7) + Math.sin(x * 0.031 - t * 1.1));
          ctx.fillRect(x, r.y + dy * 0.5 - 1, Math.min(5, r.x + r.w - x), 2);
        }
      }
    }

    drawGrid(ctx) {
      const W = this.world;
      const c = W.cell;
      for (let cy = 0; cy < W.rows; cy++) {
        for (let cx = 0; cx < W.cols; cx++) {
          if (W.solid(cx, cy)) {
            ctx.fillStyle = 'rgba(255,60,60,0.18)';
            ctx.fillRect(cx * c, cy * c, c, c);
          } else if (W.pole(cx, cy)) {
            ctx.fillStyle = 'rgba(60,220,255,0.3)';
            ctx.fillRect(cx * c, cy * c, c, c);
          }
        }
      }
      ctx.strokeStyle = 'rgba(255,255,0,0.6)';
      ctx.lineWidth = 2;
      for (const s of W.dynamicSolids) ctx.strokeRect(s.x, s.y, s.w, s.h);
    }
  }

  RW.Engine = Engine;
})();
