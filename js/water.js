// Water: a simple fluid on the nav grid (one cell = 20px), so it can rise,
// spill over a lip into the next hollow and drain away again. Each cell holds
// an amount (1 = full; a little more deep down, under pressure). Every tick
// water runs down, then levels out sideways, then pushes up when squeezed
// (the classic falling-water cellular automaton).
//
// The rain drives it. On a map with a pool, the pool rises as the downpour
// builds and sinks back to where it was after. On a map with bottomless pits
// and no pool, the downpour wells up out of the pits and floods the low
// ground, then drains back down them. Anything that's not a pool or a pit
// map stays dry.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;

  const COMP = 0.02; // how much more a cell holds per cell of water above it
  const MIN_FLOW = 0.005;
  const MIN_MASS = 0.002;
  const WET = 0.05; // less than this is a dry cell

  // How much the lower of two stacked cells holds when they share `t`.
  function stable(t) {
    if (t <= 1) return 1;
    if (t < 2 + COMP) return (1 + t * COMP) / (1 + COMP);
    return (t + COMP) / 2;
  }

  class Water {
    constructor(world, decor) {
      const W = (this.W = world);
      this.cols = W.cols;
      this.rows = W.rows;
      this.cell = W.cell;
      const n = W.cols * W.rows;
      this.m = new Float32Array(n);
      this.next = new Float32Array(n);
      this.base = new Float32Array(n);
      this.block = new Uint8Array(n);
      // the room's own rock (thin bars and poles let water through)
      const room = decor && decor.room;
      // (the room can be a row short of the world: the screen's last part-cell)
      this.rock = room && room.C === W.cols && room.R <= W.rows ? room : null;
      this.refreshBlock();
      // the pool as generated: each cell as full as the rects cover it
      const cell = this.cell;
      for (const r of world.water || []) {
        for (let cy = Math.floor(r.y / cell); cy < Math.ceil((r.y + r.h) / cell); cy++) {
          for (let cx = Math.floor(r.x / cell); cx < Math.ceil((r.x + r.w) / cell); cx++) {
            if (!W.inBounds(cx, cy)) continue;
            const i = cy * this.cols + cx;
            if (this.block[i]) continue;
            const top = Math.max(r.y, cy * cell);
            const bot = Math.min(r.y + r.h, (cy + 1) * cell);
            this.m[i] = Math.max(this.m[i], U.clamp((bot - top) / cell, 0, 1));
          }
        }
      }
      this.base.set(this.m);
      // side entrances: the open cell at each inlet pipe's mouth
      this.inlets = ((decor && decor.inlets) || []).map((q) => q.cy * this.cols + q.cx).filter((i) => i >= 0 && i < n && !this.block[i]);
      // where a flood wells up from: the bottom of each pit shaft
      this.sources = [];
      if (world.pitCols) {
        for (let cx = 0; cx < this.cols; cx++) {
          const i = (this.rows - 1) * this.cols + cx;
          if (world.pitCols[cx] && !this.block[i]) this.sources.push(i);
        }
      }
      this.vbase = this.sum();
      // a pool rises; a dry map with pits floods up out of them; any other
      // room fills from the rain pouring in through its openings (if it has
      // none, it stays dry)
      this.mode = this.vbase > 0.5 ? 'pool' : this.sources.length ? 'pit' : decor && decor.room ? 'rain' : 'none';
      let open = 0;
      for (let i = 0; i < n; i++) if (!this.block[i]) open++;
      this.open = open;
      // where the water sits normally (a row), and the flood's high mark: a
      // quarter of the way down from the top (75% of the map under water)
      this.baseRow = this.rows;
      for (let i = 0; i < n; i++) {
        if (this.base[i] > 0.3) {
          this.baseRow = (i / this.cols) | 0;
          break;
        }
      }
      this.highRow = Math.round(this.rows * 0.25); // (rain.floodHeight sets it: see update)
      this.vol = this.vbase;
      this.flood = 0;
      this.top = this.topRow();
      this.t = 0;
      this.falls = []; // spilling streams' landing points, for the spray
    }
    // Rock and passages hold no water (passages are sealed tubes).
    refreshBlock() {
      const W = this.W;
      const rock = this.rock;
      for (let cy = 0; cy < this.rows; cy++) {
        for (let cx = 0; cx < this.cols; cx++) {
          const i = cy * this.cols + cx;
          const solid = !rock ? W.solid(cx, cy) : cy < rock.R ? rock.cells[cy * rock.C + cx] === 1 : !(W.pitCols && W.pitCols[cx]);
          this.block[i] = solid || (W.passageAt && W.passage(cx, cy) >= 0) ? 1 : 0;
          if (this.block[i]) this.m[i] = 0;
        }
      }
      this.version = W.version;
    }
    sum() {
      let s = 0;
      for (let i = 0; i < this.m.length; i++) s += this.m[i];
      return s;
    }
    topRow() {
      const C = this.cols;
      for (let i = 0; i < this.m.length; i++) if (this.m[i] > MIN_MASS) return Math.max(0, ((i / C) | 0) - 1);
      return this.rows;
    }
    active() {
      return this.mode !== 'none' || this.vol > 0.5;
    }

    // How far the flood should have come (0 to 1) for this moment in the
    // rain cycle: nothing in the light rain; rising hard from when the
    // creatures start making for shelter; full through the downpour; then
    // it drains away.
    floodFor(weather, rc) {
      if (!weather || !rc || !rc.enabled) return 0;
      const warn = rc.shelterWarnSeconds ?? 45;
      if (weather.downpour) return 1;
      if (weather.toDownpour < warn) return 0.85 * (1 - weather.toDownpour / Math.max(1, warn));
      return 0;
    }
    // The top of the water: the first row holding a settled, full cell.
    // (of the main body, when there is one)
    levelRow() {
      const m = this.m;
      const C = this.cols;
      const b = this.body;
      for (let i = this.top * C; i < m.length; i++) if (m[i] >= 0.9 && !this.block[i] && (!b || b[i])) return (i / C) | 0;
      return this.rows;
    }
    // dt: seconds; weather: the Weather (where the rain cycle is, and the
    // open tops' waterfalls); rc: the rain settings.
    update(dt, weather, rc) {
      if (!this.active()) return;
      this.t += dt;
      if (this.W.version !== this.version) this.refreshBlock();
      this.weather = weather;
      if (rc && rc.floodHeight !== undefined) this.highRow = this.rows * (1 - U.clamp(+rc.floodHeight, 0, 0.98));
      // (never below where the pool sits anyway)
      const high = Math.min(this.highRow, this.baseRow);
      const want = this.floodFor(weather, rc);
      // (and once the downpour's over it goes quickly, so the room's pipes
      // are clear again for everything coming back out)
      this.flood += (want - this.flood) * U.approach(want > this.flood ? 1.5 : 1.4, dt);
      // the level the flood is at, and the water's own top
      this.body = this.vol > 0.5 || this.flood > 0.001 ? this.findBody() : null;
      const row = U.lerp(this.baseRow, high, this.flood);
      const level = this.levelRow();
      this.targetRow = row;
      const rate = (this.open / 40) * dt; // (fast: the room fills in well under a minute)
      // (pour only while a flood is on: at rest the pool's own top cell can
      // sit just under "full", which read as a row too low, so it poured
      // and drained by turns every frame and the surface jittered)
      const flooding = this.flood > 0.02;
      if (flooding && level > row + 0.5) this.pour(rate);
      else if (flooding ? level < row - 0.5 : this.vol > this.vbase + 0.5) this.drain(rate * 3);
      // a few rounds a tick, so it levels out about as fast as water does
      for (let k = 0; k < 5; k++) this.step();
      this.level();
      this.vol = this.sum();
      this.top = this.topRow();
    }
    // Rain into the pool (spread over its surface), or up out of the pits
    // (into the top of what's already welled up in each shaft: poured in
    // at the bottom, it would only squeeze up slowly under pressure).
    pour(v) {
      const m = this.m;
      // into the main body's surface (not a separate chamber's: that only
      // fills when the main body spills over into it); before there's a
      // body, into where it comes from
      // (a side entrance: it gushes out of the inlet pipe and falls)
      let list = this.inlets.length ? this.inlets.slice() : this.body ? this.surfaceCells(false, this.body) : [];
      if (!list.length) list = this.seedCells();
      if (!list.length) return;
      for (const i of list) m[i] += v / list.length;
    }
    // Where the flood comes from: the pool's surface, the top of what has
    // welled up in each pit shaft (poured in at the bottom, it would only
    // squeeze up slowly under pressure), where the open tops' waterfalls
    // land, or (a room closed to the sky) seeping up through the lowest floor.
    seedCells() {
      const m = this.m;
      const C = this.cols;
      if (this.inlets.length && this.mode !== 'pool') return this.inlets.slice();
      if (this.mode === 'pool') {
        const out = [];
        for (let i = 0; i < m.length; i++) if (this.base[i] > 0.3 && (i < C || this.base[i - C] <= 0.3)) out.push(i);
        return out;
      }
      if (this.mode === 'pit') {
        return this.sources.map((i) => {
          while (i - C >= 0 && !this.block[i - C] && m[i] >= 0.97) i -= C;
          return i;
        });
      }
      const list = [];
      for (const f of (this.weather && this.weather.fallSpans) || []) {
        const cy = Math.min(this.rows - 1, Math.floor((f.bot - 1) / this.cell));
        for (let x = f.x0; x <= f.x1; x += this.cell) {
          const i = cy * C + U.clamp(Math.floor(x / this.cell), 0, C - 1);
          if (!this.block[i]) list.push(i);
        }
      }
      if (list.length) return list;
      if (!this.seeps) {
        this.seeps = [];
        let low = -1;
        for (let i = m.length - 1; i >= 0 && low < 0; i--) if (!this.block[i]) low = (i / C) | 0;
        for (let x = 0; x < C; x++) {
          for (let y = low; y >= Math.max(0, low - 2); y--) {
            if (!this.block[y * C + x]) {
              this.seeps.push(y * C + x);
              break;
            }
          }
        }
      }
      return this.seeps.slice();
    }
    // The main body of water: everything wet connected to where the flood
    // comes from (a mark per cell, or null when there's none yet).
    findBody() {
      const m = this.m;
      const C = this.cols;
      const R = this.rows;
      const mark = this.bodyMark || (this.bodyMark = new Uint8Array(m.length));
      const q = this.bodyQ || (this.bodyQ = new Int32Array(m.length));
      mark.fill(0);
      let n = 0;
      for (const i of this.seedCells()) {
        if (m[i] >= WET && !mark[i]) {
          mark[i] = 1;
          q[n++] = i;
        }
      }
      if (!n) return null;
      for (let h = 0; h < n; h++) {
        const i = q[h];
        const x = i % C;
        const y = (i / C) | 0;
        if (x > 0 && !mark[i - 1] && m[i - 1] >= WET) (mark[i - 1] = 1), (q[n++] = i - 1);
        if (x < C - 1 && !mark[i + 1] && m[i + 1] >= WET) (mark[i + 1] = 1), (q[n++] = i + 1);
        if (y > 0 && !mark[i - C] && m[i - C] >= WET) (mark[i - C] = 1), (q[n++] = i - C);
        if (y < R - 1 && !mark[i + C] && m[i + C] >= WET) (mark[i + C] = 1), (q[n++] = i + C);
      }
      return mark;
    }
    // Back down: off the top of anything above where it started (and out
    // the bottom of the pits).
    drain(v) {
      const m = this.m;
      const list = this.surfaceCells(true);
      if (this.mode === 'pit') for (const i of this.sources) if (m[i] > WET) list.push(i);
      if (!list.length) return;
      const each = v / list.length;
      for (const i of list) m[i] = Math.max(this.base[i], m[i] - each);
    }
    // The cells at the top of the water (with nothing wet above them);
    // `above` only those holding more than they did to begin with.
    surfaceCells(above, only) {
      const m = this.m;
      const C = this.cols;
      const out = [];
      for (let i = this.top * C; i < m.length; i++) {
        if (m[i] < WET || this.block[i] || (only && !only[i])) continue;
        if (i >= C && !this.block[i - C] && m[i - C] >= WET) continue;
        // (not a stream pouring down through the air)
        if (i + C < m.length && !this.block[i + C] && m[i + C] < 0.9 && m[i] < 0.9) continue;
        if (above && m[i] <= this.base[i] + 0.001) continue;
        out.push(i);
      }
      return out;
    }

    step() {
      const m = this.m;
      const nm = this.next;
      const B = this.block;
      const C = this.cols;
      const R = this.rows;
      nm.set(m);
      for (let y = this.top; y < R; y++) {
        for (let x = 0; x < C; x++) {
          const i = y * C + x;
          if (B[i]) continue;
          let rem = m[i];
          if (rem <= 0) continue;
          let f;
          // down
          if (y + 1 < R && !B[i + C]) {
            f = stable(rem + m[i + C]) - m[i + C];
            if (f > MIN_FLOW) f *= 0.5;
            f = U.clamp(f, 0, Math.min(1, rem));
            nm[i] -= f;
            nm[i + C] += f;
            rem -= f;
            if (rem <= 0) continue;
          }
          // sideways, toward the lower neighbour
          if (x > 0 && !B[i - 1]) {
            f = (m[i] - m[i - 1]) / 4;
            if (f > MIN_FLOW) f *= 0.5;
            f = U.clamp(f, 0, rem);
            nm[i] -= f;
            nm[i - 1] += f;
            rem -= f;
            if (rem <= 0) continue;
          }
          if (x < C - 1 && !B[i + 1]) {
            f = (m[i] - m[i + 1]) / 4;
            if (f > MIN_FLOW) f *= 0.5;
            f = U.clamp(f, 0, rem);
            nm[i] -= f;
            nm[i + 1] += f;
            rem -= f;
            if (rem <= 0) continue;
          }
          // up, when squeezed
          if (y > 0 && !B[i - C]) {
            f = rem - stable(rem + m[i - C]);
            if (f > MIN_FLOW) f *= 0.5;
            f = U.clamp(f, 0, Math.min(1, rem));
            nm[i] -= f;
            nm[i - C] += f;
          }
        }
      }
      for (let i = 0; i < nm.length; i++) if (nm[i] < MIN_MASS) nm[i] = 0;
      this.next = m;
      this.m = nm;
    }

    // Water resting on something (rock, or full water below) shares its
    // level along each row: the automaton alone spreads it sideways too
    // slowly for a room filling this fast, and the surface slopes. Moves
    // half the way to the run's mean each tick; nothing is gained or lost.
    level() {
      const m = this.m;
      const B = this.block;
      const C = this.cols;
      const R = this.rows;
      for (let y = this.top; y < R; y++) {
        let x = 0;
        while (x < C) {
          const sup = (q) => !B[y * C + q] && (y + 1 >= R || B[(y + 1) * C + q] || m[(y + 1) * C + q] >= 0.95);
          if (!sup(x)) {
            x++;
            continue;
          }
          const x0 = x;
          let sum = 0;
          let wet = 0;
          while (x < C && sup(x)) {
            const a = m[y * C + x];
            sum += Math.min(a, 1);
            if (a >= WET) wet++;
            x++;
          }
          if (wet < 2 || x - x0 < 2) continue;
          const mean = sum / (x - x0);
          for (let q = x0; q < x; q++) {
            const i = y * C + q;
            if (m[i] > 1) continue; // (under pressure: leave it to the automaton)
            m[i] += (mean - m[i]) * 0.5;
          }
        }
      }
    }

    // ---- asking about it ----
    amt(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return 0;
      return this.m[cy * this.cols + cx];
    }
    // A thin stream spilling down through the air (not somewhere to swim).
    falling(cx, cy) {
      const a = this.amt(cx, cy);
      if (a < WET || a >= 0.9 || cy + 1 >= this.rows) return false;
      const j = (cy + 1) * this.cols + cx;
      return !this.block[j] && this.m[j] < 0.9;
    }
    // The y of the water's surface over (x, y), or null when (x, y) is dry.
    surfaceY(x, y) {
      const cell = this.cell;
      const cx = Math.floor(x / cell);
      let cy = Math.floor(y / cell);
      const a = this.amt(cx, cy);
      if (a < WET || this.falling(cx, cy)) return null;
      // up through the full cells to the top one
      let k = 0;
      while (cy > 0 && k++ < 40 && !this.block[(cy - 1) * this.cols + cx] && this.amt(cx, cy - 1) >= WET) cy--;
      const top = cy * cell + (1 - Math.min(1, this.amt(cx, cy))) * cell;
      return y >= top ? top : null;
    }
    depthAt(x, y) {
      const s = this.surfaceY(x, y);
      return s === null ? -1 : y - s;
    }
    wet(cx, cy) {
      return this.amt(cx, cy) >= 0.5 && !this.falling(cx, cy);
    }

    // ---- drawing ----
    // A see-through body in front of whatever is in it, darker the deeper,
    // with a rippling lighter line along the top; streams pour over lips
    // and kick up spray where they land.
    draw(ctx, pal) {
      if (this.vol < 0.3) return;
      const m = this.m;
      const B = this.block;
      const C = this.cols;
      const R = this.rows;
      const cell = this.cell;
      const t = this.t;
      const wc = pal.water || '#3d5b70';
      let bot = this.top;
      for (let i = m.length - 1; i >= 0; i--) {
        if (m[i] >= WET) {
          bot = (i / C) | 0;
          break;
        }
      }
      const g = ctx.createLinearGradient(0, this.top * cell, 0, Math.max(this.top + 2, bot + 1) * cell);
      g.addColorStop(0, U.rgba(wc, 0.3));
      g.addColorStop(1, U.rgba(U.mix(wc, '#02040a', 0.55), 0.62));
      const surf = [];
      const streams = [];
      const body = new Path2D();
      for (let y = this.top; y < R; y++) {
        let run = -1;
        for (let x = 0; x <= C; x++) {
          const i = y * C + x;
          const a = x < C ? m[i] : 0;
          const wetAbove = x < C && y > 0 && !B[i - C] && m[i - C] >= WET;
          const full = x < C && a >= WET && (a >= 0.97 || wetAbove);
          if (full && run < 0) run = x;
          if (!full && run >= 0) {
            body.rect(run * cell, y * cell, (x - run) * cell, cell);
            run = -1;
          }
          if (x >= C || full || a < WET) continue;
          if (this.falling(x, y)) {
            streams.push(x, y, a);
            continue;
          }
          // (a settled run levels out: neighbours share their mean height)
          let h = Math.min(1, a) * cell;
          let sum = 0;
          let n = 0;
          for (let j = x - 3; j <= x + 3; j++) {
            if (j < 0 || j >= C) continue;
            const q = y * C + j;
            if (B[q] || m[q] < WET || this.falling(j, y)) continue;
            sum += Math.min(1, m[q]);
            n++;
          }
          if (n > 1 && Math.abs(sum / n - Math.min(1, a)) < 0.25) h = (sum / n) * cell;
          body.rect(x * cell, (y + 1) * cell - h, cell, h);
          surf.push(x, (y + 1) * cell - h);
        }
        // the top of a run of full cells under open air is a surface too
        for (let x = 0; x < C; x++) {
          const i = y * C + x;
          if (m[i] >= 0.97 && (y === 0 || B[i - C] || m[i - C] < WET) && !B[i]) surf.push(x, y * cell);
        }
      }
      // Everything under the surface (creatures and all) goes dark and
      // muted: the colour drained out, then darkened toward the water's own
      // tint, then the water itself over it. Above the line, untouched.
      ctx.save();
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = 'rgba(128,128,128,0.75)';
      ctx.fill(body);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = U.rgba(U.mix(wc, '#b0b0b0', 0.5));
      ctx.fill(body);
      // (but never quite black: on a dark map the water still shows)
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = U.rgba(U.mix(wc, pal.light || '#ffffff', 0.35), 0.1);
      ctx.fill(body);
      ctx.restore();
      ctx.fillStyle = g;
      ctx.fill(body);
      // streams spilling over: narrow, paler, wavering
      const sc = U.mix(wc, pal.light || '#ffffff', 0.45);
      this.falls.length = 0;
      for (let k = 0; k < streams.length; k += 3) {
        const x = streams[k];
        const y = streams[k + 1];
        const a = streams[k + 2];
        const w = U.clamp(a * cell * 2, 2, cell * 0.7);
        const cx = (x + 0.5) * cell + Math.sin(t * 7 + y * 1.7) * 1.2;
        ctx.fillStyle = U.rgba(sc, 0.75);
        ctx.fillRect(Math.round(cx - w / 2), y * cell, Math.max(2, Math.round(w)), cell);
        // where it lands: on water or a floor
        const j = (y + 1) * C + x;
        if (y + 1 < R && (B[j] || !this.falling(x, y + 1))) this.falls.push(cx, (y + 1) * cell + (B[j] ? 0 : (1 - Math.min(1, m[j])) * cell), w);
      }
      // spray where streams land
      ctx.fillStyle = U.rgba(sc, 0.6);
      for (let k = 0; k < this.falls.length; k += 3) {
        const fx = this.falls[k];
        const fy = this.falls[k + 1];
        const w = this.falls[k + 2];
        for (let d = 0; d < 4; d++) {
          const ph = (t * 3 + d * 0.25 + fx * 0.01) % 1;
          const dx = (d % 2 ? 1 : -1) * (w * 0.5 + ph * 8);
          ctx.fillRect(Math.round(fx + dx), Math.round(fy - 6 * Math.sin(ph * Math.PI)), 2, 2);
        }
      }
      // the surface line, rippling
      ctx.fillStyle = U.rgba(U.mix(wc, pal.light || '#ffffff', 0.65), 0.95);
      for (let k = 0; k < surf.length; k += 2) {
        const x0 = surf[k] * cell;
        const sy = surf[k + 1];
        for (let x = x0; x < x0 + cell; x += 5) {
          const dy = Math.round(Math.sin(x * 0.09 + t * 1.7) + Math.sin(x * 0.031 - t * 1.1));
          ctx.fillRect(x, sy + dy * 0.5 - 1, 5, 2);
        }
      }
    }
  }

  RW.Water = Water;
})();
