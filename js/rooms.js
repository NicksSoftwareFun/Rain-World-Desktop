// Experimental layout: maps built like real Rain World rooms (from a dataset
// of 32 rooms in Outskirts, Shoreline, Industrial and Shaded Citadel; see
// docs/EXPERIMENTAL_LAYOUT.md). Instead of rows of ledges, a map is carved out
// of a solid mass on the nav grid itself: one big irregular hollow with side
// chambers and shafts, stair-stepped walls, chamfered corners, blocks hung on
// poles, ladders, shelves, alcoves with dens. The solid tiles are merged
// into rectangles for the world, so physics and navigation work unchanged.
// A map is checked before it's used: every den must be reachable from every
// other by a pole-climbing lizard, adding ladders where needed.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;

  // ---- regions -------------------------------------------------------------
  // Each region's palette has the usual keys (creatures and weather use them)
  // plus `mass` (the solid rock) and `water`.
  const REGIONS = {
    outskirts: {
      label: 'Outskirts',
      archetypes: ['skyShaft', 'skyShaft', 'cruciform'],
      pal: {
        skyTop: '#bcc4cd', skyBot: '#8d96a5', fog: '#a3abb8', far: '#7b7690', mid: '#463a55',
        near: '#22182d', dark: '#0d0612', rust: '#8a5a4a', light: '#eef2f8', glow: '#c8f070',
        rain: '#dde4ec', mass: '#170b20', water: '#1b2a40', accent: '#4ccf3c',
        interior: '#4a4852', sky: '#a8b1bb',
      },
    },
    shoreline: {
      label: 'Shoreline',
      archetypes: ['cruciform', 'cruciform', 'stacked'],
      pal: {
        skyTop: '#33433f', skyBot: '#141d1b', fog: '#30413c', far: '#3f4d49', mid: '#26322f',
        near: '#141c19', dark: '#070b0a', rust: '#7a3a22', light: '#c2d6cb', glow: '#ff6a3a',
        rain: '#a9c0b8', mass: '#0c1310', water: '#1f6a45', accent: '#b8c24a',
        interior: '#2f403a', sky: '#5c7068',
      },
    },
    industrial: {
      label: 'Industrial',
      archetypes: ['stacked', 'stacked', 'skyShaft'],
      pal: {
        skyTop: '#b6b3a2', skyBot: '#8f8c7e', fog: '#a6a492', far: '#717480', mid: '#3c4050',
        near: '#1b1d29', dark: '#0a0a14', rust: '#9a4a5a', light: '#f1ebd4', glow: '#ffd29a',
        rain: '#e0ddd0', mass: '#0d0d1d', water: '#3c4c68', accent: '#c8456a',
        interior: '#49565a', sky: '#a6a291',
      },
    },
    shaded: {
      label: 'Shaded Citadel',
      archetypes: ['citadel', 'citadel', 'ruins', 'cruciform'],
      pal: {
        skyTop: '#2a2834', skyBot: '#0e0d12', fog: '#24222c', far: '#33313d', mid: '#1a1920',
        near: '#0d0c11', dark: '#050507', rust: '#5a3a2a', light: '#8a85a2', glow: '#ffb050',
        rain: '#75738a', mass: '#101015', water: '#1d2233', accent: '#ffb050',
        interior: '#1d1c25', sky: '#363443',
      },
    },
  };

  // How each region furnishes and shapes a room (from the dataset brief).
  const STYLE = {
    outskirts: { block: 'square', comb: 0, wall: [3, 7], floorRise: 3 },
    shoreline: { block: 'box', comb: 0.6, wall: [1, 3], floorRise: 2 },
    industrial: { block: 'crate', comb: 0.15, wall: [4, 8], floorRise: 3 },
    shaded: { block: 'octagon', comb: 0.8, wall: [1, 2], floorRise: 2 },
  };

  // ---- the tile grid -------------------------------------------------------
  class Grid {
    constructor(C, R) {
      this.C = C;
      this.R = R;
      this.a = new Uint8Array(C * R).fill(1);
    }
    solid(x, y) {
      if (x < 0 || x >= this.C || y < 0 || y >= this.R) return true;
      return this.a[y * this.C + x] === 1;
    }
    set(x, y, v) {
      if (x < 0 || x >= this.C || y < 0 || y >= this.R) return;
      this.a[y * this.C + x] = v;
    }
    // inclusive cell rectangles
    carve(x0, y0, x1, y1) {
      for (let y = Math.max(0, y0); y <= Math.min(this.R - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(this.C - 1, x1); x++) this.a[y * this.C + x] = 0;
    }
    fill(x0, y0, x1, y1) {
      for (let y = Math.max(0, y0); y <= Math.min(this.R - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(this.C - 1, x1); x++) this.a[y * this.C + x] = 1;
    }
    air(x0, y0, x1, y1) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.solid(x, y)) return false;
      return true;
    }
  }

  // One room's rectangle of a bigger map's grid: the archetypes carve in it
  // as if it were the whole screen (outside it counts as rock).
  class SubGrid {
    constructor(g, ox, oy, C, R) {
      this.g = g;
      this.ox = ox;
      this.oy = oy;
      this.C = C;
      this.R = R;
    }
    in(x, y) {
      return x >= 0 && y >= 0 && x < this.C && y < this.R;
    }
    solid(x, y) {
      return !this.in(x, y) || this.g.solid(x + this.ox, y + this.oy);
    }
    set(x, y, v) {
      if (this.in(x, y)) this.g.set(x + this.ox, y + this.oy, v);
    }
    carve(x0, y0, x1, y1) {
      this.g.carve(Math.max(0, x0) + this.ox, Math.max(0, y0) + this.oy, Math.min(this.C - 1, x1) + this.ox, Math.min(this.R - 1, y1) + this.oy);
    }
    fill(x0, y0, x1, y1) {
      this.g.fill(Math.max(0, x0) + this.ox, Math.max(0, y0) + this.oy, Math.min(this.C - 1, x1) + this.ox, Math.min(this.R - 1, y1) + this.oy);
    }
    air(x0, y0, x1, y1) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.solid(x, y)) return false;
      return true;
    }
  }

  // A 45-degree chamfer as a 1-cell stair-step, filling the corner of an
  // open area at (x, y) (the corner cell itself), k cells along each side;
  // sx/sy point from the corner into the open area.
  function chamfer(g, x, y, sx, sy, k) {
    for (let i = 0; i < k; i++) for (let j = 0; j < k - i; j++) g.set(x + sx * j, y + sy * i, 1);
  }

  // Stair-step the vertical walls of a carved span: notches 1-2 deep and
  // 2-5 tall every 4-10 rows (alcoves), and bulges 1 cell into the hollow.
  function relieveWalls(g, x0, x1, y0, y1, R, rhythm) {
    for (const side of [-1, 1]) {
      let y = y0 + 1 + Math.floor(R() * 3);
      const pitch = rhythm ? 6 + Math.floor(R() * 4) : 0;
      while (y < y1 - 1) {
        const h = 2 + Math.floor(R() * 4);
        const d = R() < 0.6 ? 1 : 2;
        const wx = side < 0 ? x0 : x1; // the hollow's edge column
        if (R() < 0.7) {
          // notch: carve into the wall
          for (let k = 1; k <= d; k++) g.carve(wx + side * k, y, wx + side * k, Math.min(y1 - 1, y + h - 1));
        } else {
          // bulge: the wall steps out
          g.fill(wx, y, wx, Math.min(y1 - 1, y + h - 1));
        }
        y += h + (pitch || 4 + Math.floor(R() * 7));
      }
    }
  }

  // A stepped floor: the height changes every 5-12 columns by 1-3 cells (a
  // step over 1 gets a pole beside it, so lizards can climb it), with a
  // plinth or a dip now and then. Never a dead-flat strip.
  function roughFloor(g, x0, x1, yFloor, R, maxRise, f) {
    let lift = Math.floor(R() * 2);
    let x = x0;
    let prev = lift;
    while (x <= x1) {
      const run = 5 + Math.floor(R() * 8);
      const step = 1 + Math.floor(Math.min(maxRise, 3) * R());
      let next = lift + (R() < 0.5 ? step : -step);
      if (next < 0) next = Math.min(maxRise, step);
      if (next > maxRise) next = Math.max(0, lift - step);
      lift = next;
      const xe = Math.min(x1, x + run - 1);
      if (lift > 0) g.fill(x, yFloor - lift, xe, yFloor - 1);
      if (f && Math.abs(lift - prev) > 1 && x > x0) {
        // a pole up the step, on the low side
        const lowLeft = lift > prev;
        const pcx = lowLeft ? x - 1 : x;
        const hi = yFloor - Math.max(lift, prev);
        f.poles.push({ cx: pcx, y0: hi - 2, y1: yFloor - Math.min(lift, prev) - 1, ladder: true });
      }
      // a plinth (2-3 wide, 1-2 tall) or a 1-cell dip
      if (R() < 0.25 && xe - x > 5) {
        const px = x + 1 + Math.floor(R() * (xe - x - 4));
        if (R() < 0.6) g.fill(px, yFloor - lift - 1, px + 1 + Math.floor(R() * 2), yFloor - lift - 1);
        else if (lift > 0) g.carve(px, yFloor - lift, px + 1, yFloor - lift);
      }
      prev = lift;
      x += run;
    }
  }

  // A comb ceiling: teeth hanging down from the ceiling row.
  function combCeiling(g, x0, x1, yCeil, R, poles) {
    const tw = 3 + Math.floor(R() * 3);
    const td = 2 + Math.floor(R() * 3);
    const pitch = tw + 3 + Math.floor(R() * 3);
    for (let x = x0 + 2 + Math.floor(R() * 3); x + tw <= x1 - 1; x += pitch) {
      g.fill(x, yCeil, x + tw - 1, yCeil + td - 1);
      // a pole hangs from the gap after each tooth now and then
      const gx = x + tw + 1;
      if (poles && R() < 0.5 && gx < x1) poles.push({ cx: gx, y0: yCeil, y1: yCeil + td + 3 + Math.floor(R() * 8), hang: true });
    }
  }

  // ---- archetypes ------------------------------------------------------------
  // Each carves the grid and returns its feature lists: hanging blocks
  // (cells), poles ({cx, y0, y1}), beams ({cy, x0, x1}), and the main floor
  // row. Sizes follow the dataset brief, scaled to the grid.

  // Outskirts "Sky Shaft": a wide hall below, a shaft open to the sky above
  // with stepped cliff edges, a cluster of blocks hanging on poles in it.
  function skyShaft(g, R, f) {
    const { C, R: Rows } = g;
    const floorY = Rows - (3 + Math.floor(R() * 3)); // floor thickness 3-5
    const wall = f.style.wall[0] + Math.floor(R() * (f.style.wall[1] - f.style.wall[0] + 1));
    const hallTop = Math.round(Rows * U.lerp(0.36, 0.5, R()));
    g.carve(wall, hallTop, C - 1 - wall, floorY - 1);
    // the shaft up to the sky, cliff edges stepping in and out
    let l = Math.round(C * U.lerp(0.18, 0.3, R()));
    let r = Math.round(C * U.lerp(0.7, 0.82, R()));
    for (let y = hallTop; y >= 0; y--) {
      g.carve(l, y, r, y);
      if (R() < 0.35) l = U.clamp(l + (R() < 0.5 ? -1 : 1), wall + 1, Math.round(C * 0.4));
      if (R() < 0.35) r = U.clamp(r + (R() < 0.5 ? -1 : 1), Math.round(C * 0.6), C - 2 - wall);
    }
    // chamfers on the lower corners only (the walls stay upright above)
    chamfer(g, wall, floorY - 1, 1, -1, 3 + Math.floor(R() * 3));
    chamfer(g, C - 1 - wall, floorY - 1, -1, -1, 3 + Math.floor(R() * 3));
    relieveWalls(g, wall, C - 1 - wall, hallTop + 1, floorY - 1, R, false);
    roughFloor(g, wall + 3, C - 4 - wall, floorY, R, f.style.floorRise, f);
    // a side chamber in the mass above the hall, with a neck down into it
    if (R() < 0.7) {
      const left = R() < 0.5;
      const cw = 7 + Math.floor(R() * 5);
      const ch = 4 + Math.floor(R() * 3);
      const cx0 = left ? wall + 1 : C - 2 - wall - cw;
      const cy1 = hallTop - 3;
      if (cy1 - ch > 1 && (left ? cx0 + cw < l - 1 : cx0 > r + 1)) {
        g.carve(cx0, cy1 - ch + 1, cx0 + cw - 1, cy1);
        const nx = left ? cx0 + cw - 3 : cx0 + 1;
        g.carve(nx, cy1, nx + 1, hallTop);
      }
    }
    // the hanging blocks: 4-7 in one or two clusters in the shaft
    hangBlocks(g, R, f, Math.round(C * 0.3), Math.round(C * 0.7), 2, hallTop + 2, 4 + Math.floor(R() * 4));
    return { floorY, hallTop, wall };
  }

  // Shoreline "Cruciform Hall": a hall across, a shaft down through it, the
  // corners chamfered; a ladder up the shaft, a comb ceiling, pillars.
  function cruciform(g, R, f) {
    const { C, R: Rows } = g;
    const wall = 1 + Math.floor(R() * 2);
    const top = Math.round(Rows * U.lerp(0.22, 0.32, R()));
    const floorY = Rows - (2 + Math.floor(R() * 3));
    const hb = Math.round(Rows * U.lerp(0.62, 0.72, R()));
    g.carve(wall, top, C - 1 - wall, hb);
    const sw = Math.round(C * U.lerp(0.16, 0.26, R()));
    const sx = Math.round(U.lerp(C * 0.3, C * 0.7 - sw, R()));
    g.carve(sx, 0, sx + sw - 1, floorY - 1);
    // the lower arm opens into a basin across part of the bottom
    const bl = Math.max(wall, sx - Math.round(C * U.lerp(0.05, 0.2, R())));
    const br = Math.min(C - 1 - wall, sx + sw - 1 + Math.round(C * U.lerp(0.05, 0.2, R())));
    g.carve(bl, hb, br, floorY - 1);
    // the hall's four corners chamfered (the bottom ones only outside the basin)
    chamfer(g, wall, top, 1, 1, 2 + Math.floor(R() * 3));
    chamfer(g, C - 1 - wall, top, -1, 1, 2 + Math.floor(R() * 3));
    if (bl > wall + 3) chamfer(g, wall, hb, 1, -1, 2 + Math.floor(R() * 2));
    if (br < C - 4 - wall) chamfer(g, C - 1 - wall, hb, -1, -1, 2 + Math.floor(R() * 2));
    if (R() < f.style.comb) combCeiling(g, wall + 2, C - 2 - wall, top, R, f.poles);
    else if (f.style.comb < 0.3) {
      // irregular blocky overhangs instead (Outskirts, Industrial)
      for (let x = wall + 2; x < C - 3 - wall; x += 5 + Math.floor(R() * 8)) if (R() < 0.5) g.fill(x, top, x + 2 + Math.floor(R() * 4), top + 1 + Math.floor(R() * 2));
    }
    relieveWalls(g, wall, C - 1 - wall, top + 2, hb, R, f.style.comb > 0.3);
    roughFloor(g, bl + 1, br - 1, floorY, R, 2, f);
    // a ladder up the shaft, all the way
    f.poles.push({ cx: sx + Math.floor(sw / 2), y0: 0, y1: floorY - 1, ladder: true });
    // a rhythmic row of pillars hanging from the ceiling on one side
    const pillars = Math.floor(R() * 3);
    for (let i = 0; i < pillars; i++) {
      const px = wall + 3 + i * 7 + Math.floor(R() * 2);
      if (px + 2 >= sx - 1) break;
      g.fill(px, top, px + 1, top + 3 + Math.floor(R() * 4));
    }
    hangBlocks(g, R, f, wall + 3, C - 4 - wall, top + 1, hb - 3, 3 + Math.floor(R() * 3));
    return { floorY, hallTop: top, wall };
  }

  // Industrial "Stacked Chambers": two or three chambers on thick floors,
  // joined by shafts with ladders; crates hanging on poles; sometimes one
  // side open to the sky.
  function stacked(g, R, f) {
    const { C, R: Rows } = g;
    const n = Rows >= 30 && R() < 0.5 ? 3 : 2;
    const floorY = Rows - (3 + Math.floor(R() * 2));
    const bands = [];
    let y = 1 + Math.floor(R() * 2);
    const total = floorY - y;
    const thick = 3 + Math.floor(R() * 2);
    const avail = total - thick * (n - 1);
    // chambers of different heights and widths, offset from each other
    const split = [];
    let rest = avail;
    for (let i = 0; i < n; i++) {
      const hgt = i === n - 1 ? rest : Math.round((avail / n) * U.lerp(0.75, 1.25, R()));
      split.push(hgt);
      rest -= hgt;
    }
    for (let i = 0; i < n; i++) {
      const ch = split[i];
      const x0 = 2 + Math.floor(R() * C * 0.16);
      const x1 = C - 3 - Math.floor(R() * C * 0.16);
      bands.push({ x0, x1, y0: y, y1: y + ch - 1 });
      g.carve(x0, y, x1, y + ch - 1);
      // a pillar or two standing in it
      for (let k = Math.floor(R() * 3); k > 0; k--) {
        const px = Math.round(U.lerp(x0 + 6, x1 - 8, R()));
        const ph = Math.round(ch * U.lerp(0.35, 0.6, R()));
        g.fill(px, y + ch - ph, px + 1 + Math.floor(R() * 2), y + ch - 1);
      }
      chamfer(g, x0, y, 1, 1, 2 + Math.floor(R() * 2));
      chamfer(g, x1, y, -1, 1, 2 + Math.floor(R() * 2));
      relieveWalls(g, x0, x1, y + 1, y + ch - 1, R, false);
      y += split[i] + thick;
    }
    // shafts through the floors between chambers, each with a ladder
    for (let i = 0; i < n - 1; i++) {
      const a = bands[i];
      const b = bands[i + 1];
      const k = 1 + (R() < 0.6 ? 1 : 0);
      for (let s = 0; s < k; s++) {
        const w = 3 + Math.floor(R() * 3);
        const x = Math.round(U.lerp(Math.max(a.x0, b.x0) + 3, Math.min(a.x1, b.x1) - w - 3, (s + R()) / k));
        g.carve(x, a.y1, x + w - 1, b.y0);
        f.poles.push({ cx: x + Math.floor(w / 2), y0: a.y1 - 3, y1: b.y1 - 1, ladder: true });
      }
      // the floor's segments between the shafts never line up: each one
      // raised or lowered 1-3 cells from its neighbour
      let x = Math.max(a.x0, b.x0);
      let lift = 0;
      while (x < Math.min(a.x1, b.x1)) {
        if (!g.solid(x, a.y1 + 1)) {
          x++;
          continue;
        }
        const s0 = x;
        while (x < a.x1 && g.solid(x, a.y1 + 1)) x++;
        lift = U.clamp(lift + (R() < 0.5 ? 1 : -1) * (1 + Math.floor(R() * 2)), -2, 3);
        if (lift > 0) g.fill(s0, a.y1 - lift + 1, x - 1, a.y1);
        else if (lift < 0) g.carve(s0, a.y1 + 1, x - 1, a.y1 - lift);
      }
    }
    // one side open to the sky (stair-cliff edge)
    if (R() < 0.4) {
      const left = R() < 0.5;
      let w = Math.round(C * U.lerp(0.12, 0.2, R()));
      for (let yy = 0; yy < bands[n - 1].y0; yy++) {
        if (left) g.carve(0, yy, w, yy);
        else g.carve(C - 1 - w, yy, C - 1, yy);
        if (R() < 0.3) w = Math.max(2, w + (R() < 0.6 ? -1 : 1));
      }
      f.open = left ? 'left' : 'right';
    }
    roughFloor(g, bands[n - 1].x0 + 2, bands[n - 1].x1 - 2, floorY, R, 2, f);
    for (const b of bands) hangBlocks(g, R, f, b.x0 + 3, b.x1 - 3, b.y0 + 2, b.y1 - 3, 2 + Math.floor(R() * 2));
    return { floorY, hallTop: bands[0].y0, wall: 2 };
  }

  // Shaded "Citadel Hall": a tall hall with a thin skin, a comb ceiling,
  // octagonal pendants on poles, thin shelves along the walls.
  function citadel(g, R, f) {
    const { C, R: Rows } = g;
    const floorY = Rows - 2;
    const top = 1 + Math.floor(R() * 2);
    // walls 3-6 cells thick each side (not a one-cell skin)
    const wl = 3 + Math.floor(R() * 4);
    const wr = 3 + Math.floor(R() * 4);
    g.carve(wl, top, C - 1 - wr, floorY - 1);
    combCeiling(g, wl + 1, C - 2 - wr, top, R, f.poles);
    chamfer(g, wl, floorY - 1, 1, -1, 4);
    chamfer(g, C - 1 - wr, floorY - 1, -1, -1, 4);
    relieveWalls(g, wl, C - 1 - wr, top + 4, floorY - 1, R, true);
    // shelves: thin slabs off the walls, all different lengths, stepping up
    // 3-4 cells at a time, alternating sides
    const lens = [5, 11, 16, 8].sort(() => R() - 0.5);
    let sy = floorY - 4;
    let left = R() < 0.5;
    for (let i = 0; i < 4 && sy > top + 5; i++) {
      const len = lens[i];
      if (left) g.fill(2, sy, 1 + len, sy);
      else g.fill(C - 2 - len, sy, C - 3, sy);
      sy -= 3 + Math.floor(R() * 2);
      left = !left;
    }
    f.wantPit = true; // the Citadel's drop shaft
    // a pair of tall pillars standing on the floor
    if (R() < 0.7) {
      const pw = 2 + Math.floor(R() * 2);
      const ph = Math.round((floorY - top) * U.lerp(0.4, 0.7, R()));
      const gap = Math.round(C * U.lerp(0.25, 0.4, R()));
      const c0 = Math.round(C / 2 - gap / 2 - pw / 2);
      for (const px of [c0, c0 + gap]) g.fill(px, floorY - ph, px + pw - 1, floorY - 1);
    }
    // pendants: octagons (3x3, corners clipped) hanging on poles
    const np = 3 + Math.floor(R() * 2);
    for (let i = 0; i < np; i++) {
      const cx = Math.round(U.lerp(C * 0.2, C * 0.8, (i + 0.5) / np));
      const cy = top + 6 + Math.floor(R() * 6);
      if (!g.air(cx - 3, cy - 3, cx + 3, cy + 3)) continue;
      g.fill(cx - 2, cy - 2, cx + 1, cy + 1);
      f.blocks.push({ x0: cx - 2, y0: cy - 2, x1: cx + 1, y1: cy + 1, octagon: true });
      f.poles.push({ cx, y0: top, y1: cy - 3, hang: true });
    }
    return { floorY, hallTop: top, wall: 1 };
  }

  // Shaded "Ruined Skyline" (SH_LEDGE, SH_D03): open to the dark sky, a low
  // broken floor of islands between wide gaps, ruined towers standing up
  // out of it and chunks of masonry left hanging in the air.
  function ruins(g, R, f) {
    const { C, R: Rows } = g;
    const floorTop = Rows - (4 + Math.floor(R() * 3));
    g.carve(0, 0, C - 1, floorTop - 1);
    roughFloor(g, 1, C - 2, floorTop, R, 2, f);
    // towers: 1-3, 3-6 wide, crenellated tops
    const nt = 1 + Math.floor(R() * 3);
    for (let i = 0; i < nt; i++) {
      const w = 3 + Math.floor(R() * 4);
      const x = Math.round(U.lerp(1, C - w - 2, (i + 0.2 + R() * 0.6) / nt));
      const top = Math.round(Rows * U.lerp(0.2, 0.5, R()));
      g.fill(x, top, x + w - 1, floorTop - 1);
      for (let k = x; k < x + w; k += 2) g.carve(k, top, k, top); // crenels
      // a window or two through it
      if (w >= 4 && R() < 0.6) g.carve(x + 1, top + 3, x + w - 2, top + 4);
    }
    // masonry chunks hanging in the air, jagged on top
    const nc = 3 + Math.floor(R() * 3);
    for (let i = 0, tries = 0; i < nc && tries < 60; tries++) {
      const w = 4 + Math.floor(R() * 7);
      const h = 2 + Math.floor(R() * 2);
      const x = 2 + Math.floor(R() * (C - w - 4));
      const y = 3 + Math.floor(R() * (floorTop - h - 7));
      if (!g.air(x - 2, y - 2, x + w + 1, y + h + 2)) continue;
      g.fill(x, y, x + w - 1, y + h - 1);
      for (let k = x; k < x + w; k++) if (R() < 0.3) g.carve(k, y, k, y);
      // half of them hang on a pole from the top of the screen
      if (R() < 0.5) f.poles.push({ cx: x + Math.floor(w / 2), y0: 0, y1: y - 1, hang: true });
      i++;
    }
    f.widePits = true;
    return { floorY: floorTop, hallTop: 0, wall: 0 };
  }

  const ARCHETYPES = { skyShaft, cruciform, stacked, citadel, ruins };

  // Every room: at least 8 vertical poles (hanging from ceilings, some down
  // to the floor) and 2 horizontal bars across open spans, clear of ladders.
  function furnish(g, R, f, k) {
    k = k || 1;
    const usedCols = new Set(f.poles.map((p) => p.cx));
    const vertical = () => f.poles.filter((p) => !p.stub).length;
    const want = Math.round((8 + Math.floor(R() * 5)) * k);
    // in bundles of 2-4, 1-2 cells apart, with 6-10 open cells between bundles
    const centres = [];
    for (let x = 3 + Math.floor(R() * 6); x < g.C - 3; x += 8 + Math.floor(R() * 8)) centres.push(x);
    for (let tries = 0; tries < 400 * k && vertical() < want; tries++) {
      const c0 = centres[Math.floor(R() * centres.length)];
      const x = c0 + Math.floor(R() * 5) - 2;
      if (x < 2 || x > g.C - 3) continue;
      if (usedCols.has(x) || usedCols.has(x - 1) || usedCols.has(x + 1)) continue;
      // a ceiling above an open column
      const y = 1 + Math.floor(R() * (g.R - 6));
      if (g.solid(x, y)) continue;
      let top = y;
      while (top > 0 && !g.solid(x, top - 1)) top--;
      if (top === 0 && R() < 0.9) continue; // (rarely from off the top of the screen)
      let bot = top;
      while (bot < g.R - 1 && !g.solid(x, bot + 1)) bot++;
      const span = bot - top;
      if (span < 6 || g.solid(x - 1, top) || g.solid(x + 1, top)) continue;
      // all the way down (a ladder) or stopping short, within a jump of the floor
      const full = R() < 0.35 || span < 9;
      const y1 = full ? bot : top + Math.min(span - 3, 6 + Math.floor(R() * 14));
      f.poles.push({ cx: x, y0: top, y1, hang: true });
      usedCols.add(x);
    }
    // horizontal bars: spans of 6-20 cells between solids, with headroom
    const bars = Math.round((2 + Math.floor(R() * 2)) * k);
    for (let tries = 0; tries < 200 * k && f.beams.length < bars; tries++) {
      const y = 3 + Math.floor(R() * (g.R - 8));
      const x = 2 + Math.floor(R() * (g.C - 4));
      if (g.solid(x, y)) continue;
      let a = x;
      while (a > 0 && !g.solid(a - 1, y)) a--;
      let b = x;
      while (b < g.C - 1 && !g.solid(b + 1, y)) b++;
      const len = b - a + 1;
      if (len < 6 || len > 20 || a === 0 || b === g.C - 1) continue;
      if (!g.air(a, y - 2, b, y - 1) || !g.air(a, y + 1, b, y + 2)) continue;
      let crosses = false;
      for (const p of f.poles) if (p.cx >= a && p.cx <= b && y >= Math.min(p.y0, p.y1) && y <= Math.max(p.y0, p.y1)) crosses = true;
      if (crosses) continue;
      f.beams.push({ cy: y, x0: a, x1: b });
    }
  }

  // Blocks hung on poles from whatever's above them, in one or two clusters
  // between x0..x1 and y0..y1.
  function hangBlocks(g, R, f, x0, x1, y0, y1, n) {
    const kind = f.style.block;
    if (x1 - x0 < 6 || y1 - y0 < 3) return;
    const clusters = n > 4 && R() < 0.5 ? 2 : 1;
    let placed = 0;
    for (let c = 0; c < clusters; c++) {
      const cx = Math.round(U.lerp(x0 + 4, x1 - 4, clusters === 1 ? R() : (c + 0.3 + R() * 0.4) / clusters));
      for (let tries = 0; tries < 40 && placed < Math.ceil((n * (c + 1)) / clusters); tries++) {
        // squares (Outskirts), crates (Industrial), upright boxes (Shoreline),
        // octagons (Shaded)
        const w = kind === 'crate' ? 4 + Math.floor(R() * 3) : kind === 'box' ? 2 + Math.floor(R() * 2) : kind === 'octagon' ? 3 : 2 + Math.floor(R() * 2);
        const h = kind === 'crate' ? 2 + Math.floor(R() * 2) : kind === 'box' ? 4 : w;
        const x = Math.round(cx + (R() - 0.5) * 14);
        const y = Math.round(U.lerp(y0, y1, R()));
        if (x < x0 || x + w - 1 > x1 || y + h - 1 > y1) continue;
        // clear around it, and room to stand on top
        if (!g.air(x - 1, y - 1, x + w, y + h + 1)) continue;
        // staggered: not level with a neighbour within 10 cells
        if (f.blocks.some((b) => Math.abs(b.y0 - y) < 2 && Math.abs(b.x0 - x) < 10)) continue;
        // what it hangs from: the first solid straight up from its middle
        const px = x + Math.floor(w / 2);
        let top = y - 1;
        while (top >= 0 && !g.solid(px, top)) top--;
        if (y - top > 14 && top >= 0) continue; // too long a pole
        if (top < 0 && (f.topPoles || 0) >= 2) continue; // (only a couple hung from off the top)
        if (top < 0) f.topPoles = (f.topPoles || 0) + 1;
        g.fill(x, y, x + w - 1, y + h - 1);
        f.blocks.push({ x0: x, y0: y, x1: x + w - 1, y1: y + h - 1, octagon: kind === 'octagon' });
        f.poles.push({ cx: px, y0: Math.max(0, top + 1), y1: y - 1, hang: true });
        // now and then a short stub below
        if (R() < 0.4) f.poles.push({ cx: px, y0: y + h, y1: y + h + 1 + Math.floor(R() * 3), stub: true });
        placed++;
      }
    }
  }

  // ---- big maps: several rooms -------------------------------------------------------
  // A Large or XL map is a few Rain World rooms side by side and stacked
  // (each about a screen of the dataset's), joined by doorways and shafts,
  // rather than one archetype stretched over a hall it was never meant for.
  function roomGrid(C, Rows, R) {
    let nx = C >= 100 ? (R() < 0.5 ? 3 : 2) : C >= 80 ? 2 : 1;
    let ny = Rows >= 44 ? 2 : 1;
    if (nx === 2 && ny === 2 && C < 100 && R() < 0.4) ny = 1; // (two tall rooms)
    const cut = (n, len) => {
      const out = [0];
      for (let i = 1; i < n; i++) out.push(Math.round((len * i) / n + (R() - 0.5) * 6));
      out.push(len);
      return out;
    };
    const xs = cut(nx, C);
    const ys = cut(ny, Rows);
    const rooms = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) rooms.push({ i, j, x0: xs[i], x1: xs[i + 1] - 1, y0: ys[j], y1: ys[j + 1] - 1 });
    return { nx, ny, rooms };
  }
  // A doorway between side-by-side rooms: a 3-tall corridor along a floor
  // through the wall between them (the shortest found), floored under.
  function connectH(g, R, bx, y0, y1) {
    let best = null;
    for (let y = y0 + 3; y <= y1 - 2; y++) {
      let xl = -1;
      for (let x = bx - 1; x >= bx - 16 && x > 0; x--) {
        if (!g.solid(x, y)) {
          if (g.solid(x, y + 1)) xl = x;
          break;
        }
      }
      let xr = -1;
      for (let x = bx; x <= bx + 16 && x < g.C - 1; x++) {
        if (!g.solid(x, y)) {
          if (g.solid(x, y + 1)) xr = x;
          break;
        }
      }
      if (xl < 0 || xr < 0) continue;
      if (!best || xr - xl < best.xr - best.xl) best = { y, xl, xr };
    }
    if (!best) return false;
    g.carve(best.xl, best.y - 2, best.xr, best.y);
    g.fill(best.xl, best.y + 1, best.xr, best.y + 1);
    return true;
  }
  // A shaft between stacked rooms: 3 wide, from a floor in the upper room
  // down into the lower one, with a ladder.
  function connectV(g, R, f, by, x0, x1) {
    let best = null;
    for (let x = x0 + 3; x <= x1 - 3; x++) {
      let yt = -1;
      for (let y = by - 1; y >= by - 16 && y > 0; y--) {
        if (!g.solid(x, y)) {
          if (g.solid(x, y + 1)) yt = y;
          break;
        }
      }
      let yb = -1;
      for (let y = by; y <= by + 16 && y < g.R - 1; y++) {
        if (!g.solid(x, y)) {
          yb = y;
          break;
        }
      }
      if (yt < 0 || yb < 0) continue;
      if (!best || yb - yt < best.yb - best.yt) best = { x, yt, yb };
    }
    if (!best) return false;
    g.carve(best.x - 1, best.yt + 1, best.x + 1, best.yb);
    let floorY = best.yb;
    while (floorY < g.R - 1 && !g.solid(best.x, floorY + 1)) floorY++;
    f.poles.push({ cx: best.x, y0: best.yt - 3, y1: floorY, ladder: true });
    return true;
  }
  // Free-standing ledges (a jungle gym on the bigger maps): 5-14 cells long,
  // 1-2 thick, clear all round, each with a ladder down to a floor.
  function addLedges(g, R, f, n) {
    let placed = 0;
    for (let tries = 0; tries < n * 40 && placed < n; tries++) {
      const w = 5 + Math.floor(R() * 10);
      const t = f.style.block === 'octagon' ? 1 : 1 + Math.floor(R() * 2);
      const x = 2 + Math.floor(R() * (g.C - w - 4));
      const y = 4 + Math.floor(R() * (g.R - 10));
      if (!g.air(x - 2, y - 3, x + w + 1, y + t + 2)) continue;
      // not level with another ledge close by
      if (f.ledges && f.ledges.some((q) => Math.abs(q.y - y) < 2 && Math.abs(q.x - x) < w + 8)) continue;
      g.fill(x, y, x + w - 1, y + t - 1);
      (f.ledges = f.ledges || []).push({ x, y, w });
      // a ladder off one end, down to whatever's below
      const cx = R() < 0.5 ? x - 1 : x + w;
      let yy = y - 1;
      while (yy < g.R - 1 && !g.solid(cx, yy + 1)) yy++;
      if (yy - y < 16 && yy < g.R - 1) f.poles.push({ cx, y0: y - 1, y1: yy, ladder: true });
      placed++;
    }
  }

  // ---- pits and water ------------------------------------------------------------
  // The main floor's platforms: standable runs whose floor is solid all the
  // way to the bottom of the screen (a pit can be cut down through them).
  function groundRuns(g) {
    return platforms(g).filter((p) => {
      for (let x = p.x0; x <= p.x1; x++) for (let y = p.y + 1; y < g.R; y++) if (!g.solid(x, y)) return false;
      return p.y > g.R * 0.5;
    });
  }
  // A bottomless pit, 3-5 cells wide, cut down through the floor, with
  // floor on both sides of it (and never under water).
  function addPit(g, R, f, wide) {
    const w = wide ? 8 + Math.floor(R() * 5) : 3 + Math.floor(R() * 3);
    const runs = groundRuns(g).filter((p) => p.x1 - p.x0 + 1 >= w + 6);
    if (!runs.length) return false;
    const p = runs[Math.floor(R() * runs.length)];
    const x = p.x0 + 2 + Math.floor(R() * Math.max(1, p.x1 - p.x0 - 3 - w));
    if (f.waterCols && [...Array(w).keys()].some((k) => f.waterCols.has(x + k))) return false;
    g.carve(x, p.y + 1, x + w - 1, g.R - 1);
    // a lip: one edge chamfered a step
    if (R() < 0.6) g.carve(R() < 0.5 ? x - 1 : x + w, p.y + 1, R() < 0.5 ? x - 1 : x + w, p.y + 1);
    f.pits.push({ cx0: x, cx1: x + w - 1, y: p.y });
    return true;
  }
  // Water (a placeholder: walk-through, slow): a flat surface 3-4 cells above
  // a floor, filling every open cell below that line that it can reach
  // without spilling out of the screen's sides or down a pit.
  function addWater(g, R, f, info) {
    const runs = groundRuns(g).filter((p) => p.x1 - p.x0 + 1 >= 4);
    if (!runs.length) return false;
    // the lowest floor
    runs.sort((a, b) => b.y - a.y);
    const p = runs[0];
    const depth = 3 + Math.floor(R() * 3);
    const ys = p.y - depth + 1;
    const xm = Math.floor((p.x0 + p.x1) / 2);
    if (ys < 3 || g.solid(xm, ys)) return false;
    const seen = new Uint8Array(g.C * g.R);
    const q = [[xm, ys]];
    seen[ys * g.C + xm] = 1;
    const cells = [];
    while (q.length) {
      const [x, y] = q.pop();
      if (x <= 0 || x >= g.C - 1) return false; // it would run off the side
      cells.push([x, y]);
      if (cells.length > g.C * g.R * 0.3) return false; // a flooded room is for later
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y + 1], [x, y - 1]]) {
        if (ny < ys || ny >= g.R || nx < 0 || nx >= g.C) continue;
        const i = ny * g.C + nx;
        if (seen[i] || g.solid(nx, ny)) continue;
        seen[i] = 1;
        q.push([nx, ny]);
      }
    }
    // runs of water per row (the top row's surface sits a little below its top)
    const rows = new Map();
    for (const [x, y] of cells) {
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(x);
    }
    f.water = [];
    f.waterCols = new Set();
    f.waterCells = new Set();
    for (const [y, xs] of rows) {
      xs.sort((a, b) => a - b);
      let a = xs[0];
      for (let i = 1; i <= xs.length; i++) {
        if (i < xs.length && xs[i] === xs[i - 1] + 1) continue;
        f.water.push({ cy: y, x0: a, x1: xs[i - 1], surface: y === ys });
        if (i < xs.length) a = xs[i];
      }
      for (const x of xs) {
        f.waterCols.add(x);
        f.waterCells.add(y * g.C + x);
      }
    }
    return true;
  }

  // No accidental one-cell slits: an air cell with rock either side (or
  // above and below) in a run of two or more is filled in. Creatures squeeze
  // into such gaps and jam; the only one-cell routes are real passages.
  function closeSlits(g) {
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      const vert = (x, y) => !g.solid(x, y) && g.solid(x - 1, y) && g.solid(x + 1, y);
      const horz = (x, y) => !g.solid(x, y) && g.solid(x, y - 1) && g.solid(x, y + 1);
      for (let y = 0; y < g.R; y++) {
        for (let x = 0; x < g.C; x++) {
          if ((vert(x, y) && (vert(x, y - 1) || vert(x, y + 1))) || (horz(x, y) && (horz(x - 1, y) || horz(x + 1, y)))) {
            g.set(x, y, 1);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }

  // ---- the flood's way in ------------------------------------------------------
  // Every room needs somewhere the downpour's flood comes in: an opening to
  // the sky (the rain pours down through it) or a bottomless pit (it wells
  // up out of it). A room with neither gets a side entrance: a big inlet
  // pipe low in its outer wall (a couple of cells above the lowest floor it
  // can find, so it fills the room from the bottom), gushing while the flood
  // rises. {cx, cy, side}: the open cell at its mouth, and the wall's
  // side (-1 left, 1 right).
  function addInlet(g, R, f) {
    f.inlets = [];
    let sky = 0;
    for (let x = 0; x < g.C; x++) {
      if (g.solid(x, 0)) sky = 0;
      else if (++sky >= 3) return;
    }
    if (f.pits.length) return;
    const tun = (x, y) => f.passageCells && f.passageCells.has(y * g.C + x);
    const sides = R() < 0.5 ? [-1, 1] : [1, -1];
    for (const side of sides) {
      for (let y = g.R - 3; y >= Math.floor(g.R * 0.4); y--) {
        // the outermost open cell on this row, from that side
        let x = side < 0 ? 0 : g.C - 1;
        while (x > 0 && x < g.C - 1 && g.solid(x, y)) x -= side;
        if (g.solid(x, y) || tun(x, y) || (f.waterCells && f.waterCells.has(y * g.C + x))) continue;
        // rock at its back for the pipe to come out of, a drop of a couple
        // of cells below its mouth
        if (!g.solid(x + side, y) || g.solid(x, y + 1) || g.solid(x, y + 2)) continue;
        f.inlets.push({ cx: x, cy: y, side });
        return;
      }
    }
    // no side wall to put it in: down out of a ceiling in the upper part
    // of the room, then (side 0)
    for (let y = g.R - 4; y >= 1; y--) {
      for (let k = 0; k < g.C; k++) {
        const x = Math.floor(g.C / 2 + ((k % 2 ? 1 : -1) * Math.ceil(k / 2)));
        if (x < 1 || x >= g.C - 1 || g.solid(x, y) || !g.solid(x, y - 1) || tun(x, y) || g.solid(x, y + 1) || g.solid(x, y + 2)) continue;
        f.inlets.push({ cx: x, cy: y, side: 0 });
        return;
      }
    }
  }

  // ---- passages ------------------------------------------------------------
  // One-cell tunnels through the rock between two doors (open floor cells
  // beside a wall) that are a long way apart through the open, or not
  // connected at all: escape routes, crawled like pipes. Routed through solid
  // only, keeping a wall at least a cell thick all round, with few turns (L
  // and Z shapes), never near water or a pit.
  function carvePassages(g, R, f) {
    const C = g.C;
    const Rows = g.R;
    const wet = (x, y) => f.waterCells && f.waterCells.has(y * C + x);
    const pitCol = (x) => f.pits.some((q) => x >= q.cx0 - 1 && x <= q.cx1 + 1);
    // doors: an open floor cell, the passage going off sideways into a wall
    // beside it (then up or down inside the rock as it likes; never a hole
    // in a floor, which anything walking past would drop into)
    const doors = [];
    for (let y = 2; y < Rows - 2; y++) {
      for (let x = 1; x < C - 1; x++) {
        if (g.solid(x, y) || !g.solid(x, y + 1) || wet(x, y) || g.solid(x, y - 1)) continue;
        for (const sd of [-1, 1]) {
          const wx = x + sd;
          if (g.solid(wx, y) && g.solid(wx + sd, y) && wx > 0 && wx < C - 1) doors.push({ x, y, sx: wx, sy: y });
        }
      }
    }
    // the walking distance between two open cells, through the open (-1: none)
    const airDist = (A, B) => {
      const seen = new Int16Array(C * Rows).fill(-1);
      const q = [A.y * C + A.x];
      seen[q[0]] = 0;
      for (let h = 0; h < q.length; h++) {
        const i = q[h];
        if (i === B.y * C + B.x) return seen[i];
        const x = i % C;
        const y = (i / C) | 0;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || ny < 0 || nx >= C || ny >= Rows) continue;
          const j = ny * C + nx;
          if (seen[j] >= 0 || g.solid(nx, ny)) continue;
          seen[j] = seen[i] + 1;
          q.push(j);
        }
      }
      return -1;
    };
    const carved = new Set();
    // A* through solid, 4-way, turns cost extra
    const route = (A, B) => {
      const start = A.sy * C + A.sx;
      const goal = B.sy * C + B.sx;
      const ok = (x, y, from) => {
        if (x < 1 || y < 1 || x > C - 2 || y > Rows - 2 || !g.solid(x, y) || wet(x, y) || pitCol(x)) return false;
        const i = y * C + x;
        if (i === goal) return true;
        // away from its doors, deep in the rock: two cells of it all round
        // (not a channel skimming the surface of a wall or a floor)
        const nearEnd = Math.abs(x - A.sx) + Math.abs(y - A.sy) <= 2 || Math.abs(x - B.sx) + Math.abs(y - B.sy) <= 2;
        if (!nearEnd) {
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (!g.solid(nx, ny) || carved.has(ny * C + nx)) return false;
            }
          }
        }
        // a wall all round (bar the way we came), clear of other passages
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          const j = ny * C + nx;
          if (j === from) continue;
          if (!g.solid(nx, ny) || carved.has(j)) return false;
        }
        return true;
      };
      const gs = new Map([[start, 0]]);
      const prev = new Map([[start, -1]]);
      const dirOf = new Map([[start, -1]]);
      const open = [[0, start]];
      let n = 0;
      while (open.length && n++ < 4000) {
        open.sort((a, b) => a[0] - b[0]);
        const [, i] = open.shift();
        if (i === goal) break;
        const x = i % C;
        const y = (i / C) | 0;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let k = 0; k < 4; k++) {
          const nx = x + dirs[k][0];
          const ny = y + dirs[k][1];
          if (!ok(nx, ny, i)) continue;
          const j = ny * C + nx;
          const turn = dirOf.get(i) >= 0 && dirOf.get(i) !== k ? 2.5 : 0;
          const ng = gs.get(i) + 1 + turn;
          if (gs.has(j) && gs.get(j) <= ng) continue;
          gs.set(j, ng);
          prev.set(j, i);
          dirOf.set(j, k);
          open.push([ng + Math.abs(nx - B.sx) + Math.abs(ny - B.sy), j]);
        }
      }
      if (!prev.has(goal)) return null;
      const cells = [];
      for (let i = goal; i >= 0; i = prev.get(i)) cells.push([i % C, (i / C) | 0]);
      return cells.reverse();
    };
    f.passages = [];
    const dbg = (f.passageDebug = { doors: doors.length, near: 0, easy: 0, noRoute: 0, long: 0 });
    const want = 2 + Math.floor(R() * 3);
    for (let tries = 0; tries < 80 && f.passages.length < want && doors.length > 1; tries++) {
      const A = doors[Math.floor(R() * doors.length)];
      const B = doors[Math.floor(R() * doors.length)];
      const md = Math.abs(A.sx - B.sx) + Math.abs(A.sy - B.sy);
      if (A === B || md < 6 || md > 36 || (A.x === B.x && A.y === B.y)) {
        dbg.near++;
        continue;
      }
      // only where it's a short cut: a long way round through the open
      const ad = airDist(A, B);
      // (a climb between floors is always worth a passage)
      if (ad >= 0 && ad < md * 1.3 + 8 && Math.abs(A.y - B.y) < 4) {
        dbg.easy++;
        continue;
      }
      const cells = route(A, B);
      if (!cells) dbg.noRoute++;
      else if (cells.length > 40) dbg.long++;
      if (!cells || cells.length > 30) continue;
      for (const [x, y] of cells) {
        g.set(x, y, 0);
        carved.add(y * C + x);
      }
      f.passages.push({ cells, a: [A.x, A.y], b: [B.x, B.y] });
    }
    f.passageCells = carved;
  }

  // ---- from grid to world ----------------------------------------------------
  // Solid cells merged into rectangles: runs along each row, then stacked
  // with identical runs below.
  function toRects(g, cell, H) {
    const rects = [];
    const open = new Map(); // "x0,x1" -> rect still growing downward
    for (let y = 0; y < g.R; y++) {
      const runs = [];
      let x = 0;
      while (x < g.C) {
        if (!g.solid(x, y)) {
          x++;
          continue;
        }
        const s = x;
        while (x < g.C && g.solid(x, y)) x++;
        runs.push([s, x - 1]);
      }
      const next = new Map();
      for (const [a, b] of runs) {
        const key = a + ',' + b;
        const r = open.get(key);
        if (r) {
          r.h += cell;
          next.set(key, r);
        } else {
          const nr = { id: 'rock-' + rects.length, kind: 'rock', x: a * cell, y: y * cell, w: (b - a + 1) * cell, h: cell };
          rects.push(nr);
          next.set(key, nr);
        }
      }
      open.clear();
      for (const [k, v] of next) open.set(k, v);
    }
    // the bottom row reaches the screen's bottom edge
    for (const r of rects) if (r.y + r.h >= g.R * cell - 0.5) r.h = Math.max(r.h, H - r.y);
    return rects;
  }

  // Standable cells in runs: [{y, x0, x1}] (air with solid below).
  function platforms(g) {
    const out = [];
    for (let y = 0; y < g.R - 1; y++) {
      let x = 0;
      while (x < g.C) {
        if (g.solid(x, y) || !g.solid(x, y + 1)) {
          x++;
          continue;
        }
        const s = x;
        while (x < g.C && !g.solid(x, y) && g.solid(x, y + 1)) x++;
        out.push({ y, x0: s, x1: x - 1 });
      }
    }
    return out;
  }

  function buildDecor(g, f, cell, W, H, region, R) {
    const ledges = toRects(g, cell, H);
    const poles = [];
    for (const p of f.poles) {
      const y0 = Math.max(0, Math.min(p.y0, p.y1));
      const y1 = Math.max(p.y0, p.y1);
      if (y1 < y0) continue;
      // poles run through air only: stop at the first solid
      let a = y0;
      while (a <= y1 && g.solid(p.cx, a)) a++;
      let b = a;
      while (b + 1 <= y1 && !g.solid(p.cx, b + 1)) b++;
      if (b - a < 1) continue;
      poles.push({ id: 'pole-' + poles.length, x: (p.cx + 0.5) * cell, y1: a * cell, y2: (b + 1) * cell, ladder: !!p.ladder });
    }
    const beams = [];
    for (const b of f.beams) beams.push({ id: 'beam-' + beams.length, kind: 'beam', x: b.x0 * cell, y: b.cy * cell + cell * 0.5 - 2, w: (b.x1 - b.x0 + 1) * cell, h: 4, seed: R() * 1000 });

    // Dens: on floors near walls and in alcoves, spread out; 3-6 of them.
    const onBlock = (p) => f.blocks.some((b) => p.y + 1 >= b.y0 && p.y + 1 <= b.y1 && p.x1 >= b.x0 && p.x0 <= b.x1);
    const plats = platforms(g).filter((p) => p.x1 - p.x0 >= 1 && g.solid(p.x0, p.y + 1) && g.solid(p.x1, p.y + 1) && !onBlock(p));
    const dens = [];
    const cand = [];
    for (const p of plats) {
      for (let x = p.x0; x <= p.x1; x++) {
        // a mouth needs two solid cells under it and headroom above
        if (!g.solid(x, p.y + 1) || !g.solid(x + 1, p.y + 1) || x + 1 > p.x1) continue;
        if (g.solid(x, p.y - 1) || g.solid(x + 1, p.y - 1)) continue;
        const wet = f.waterCells && (f.waterCells.has(p.y * g.C + x) || f.waterCells.has(p.y * g.C + x + 1));
        if (wet) continue;
        const inPassage = f.passageCells && (f.passageCells.has(p.y * g.C + x) || f.passageCells.has(p.y * g.C + x + 1));
        if (inPassage) continue;
        const nearWall = g.solid(x - 1, p.y) || g.solid(x + 2, p.y) || g.solid(x - 2, p.y) || g.solid(x + 3, p.y);
        cand.push({ x: (x + 1) * cell, y: (p.y + 1) * cell, cy: p.y, cx: x, w: nearWall ? 3 : 1 });
      }
    }
    const nDen = Math.round((3 + Math.floor(R() * 4)) * Math.pow(f.rooms || 1, 0.7));
    for (let k = 0; k < nDen * 6 && dens.length < nDen && cand.length; k++) {
      // weighted toward the walls, kept apart from each other
      let pick = cand[Math.floor(R() * cand.length)];
      if (pick.w < 3 && R() < 0.6) continue;
      if (dens.some((d) => Math.hypot(d.x - pick.x, d.y - pick.y) < cell * 9)) continue;
      let depth = 0;
      while (g.solid(pick.cx, pick.cy + 1 + depth) && depth < 3) depth++;
      dens.push({ x: pick.x, y: pick.y, dir: 0, wall: false, depth: depth * cell, cx: pick.cx, cy: pick.cy });
    }

    // Openings to the sky along the top edge: fliers come and go through
    // them (a den each, marked `sky`, invisible).
    for (let x = 0; x < g.C; ) {
      if (g.solid(x, 0)) {
        x++;
        continue;
      }
      const s0 = x;
      while (x < g.C && !g.solid(x, 0)) x++;
      if (x - s0 >= 3) dens.push({ x: ((s0 + x) / 2) * cell, y: 0, sky: true, dir: 0, wall: false });
    }

    // Fruit vines under ceilings, grass on floors, a nest under an overhang.
    const ceilings = [];
    const tun = (x, y) => f.passageCells && f.passageCells.has(y * g.C + x);
    for (let y = 1; y < g.R - 4; y++) for (let x = 1; x < g.C - 1; x++) if (g.solid(x, y - 1) && !g.solid(x, y) && !g.solid(x, y + 1) && !g.solid(x, y + 2) && !tun(x, y)) ceilings.push({ x, y });
    const fruitPlants = [];
    const nF = Math.round((3 + R() * 3) * Math.pow(f.rooms || 1, 0.7));
    for (let i = 0; i < nF && ceilings.length; i++) {
      const c = ceilings[Math.floor(R() * ceilings.length)];
      fruitPlants.push({ x: Math.round((c.x + 0.5) * cell), y: c.y * cell, len: U.lerp(26, 50, R()) });
    }
    // Under the water, now and then: a sea-fruit stalk standing up off the
    // bottom of the pool (a slugcat has to swim down for it).
    if (f.waterCells && f.waterCells.size && R() < 0.75) {
      const beds = [];
      for (const i of f.waterCells) {
        const x = i % g.C;
        const y = (i / g.C) | 0;
        if (!g.solid(x, y + 1)) continue;
        let d = 0;
        while (f.waterCells.has((y - d) * g.C + x)) d++;
        if (d >= 2) beds.push({ x, y, d });
      }
      const n = Math.min(beds.length, 1 + (R() < 0.4 ? 1 : 0) + Math.floor(Math.pow(f.rooms || 1, 0.5) - 1));
      for (let k = 0; k < n; k++) {
        const b = beds.splice(Math.floor(R() * beds.length), 1)[0];
        fruitPlants.push({ x: Math.round((b.x + 0.5) * cell), y: (b.y + 1) * cell, len: U.clamp((b.d - 0.8) * cell, 26, 90), under: true });
      }
    }
    const grass = [];
    for (const p of plats) if (p.x1 - p.x0 >= 2 && R() < 0.5 && !(f.waterCells && f.waterCells.has(p.y * g.C + p.x0)) && !tun(p.x0, p.y)) grass.push({ x: Math.round((U.lerp(p.x0, p.x1, R()) + 0.5) * cell), y: (p.y + 1) * cell, h: U.lerp(20, 34, R()), phase: R() * 10 });
    const roomy = ceilings.filter((c) => !g.solid(c.x, c.y + 3) && !g.solid(c.x - 1, c.y) && !g.solid(c.x + 1, c.y) && !(f.waterCells && f.waterCells.has((c.y + 3) * g.C + c.x)));
    const nests = [];
    for (let k = 0; k < Math.max(1, Math.round((f.rooms || 1) / 2)) && roomy.length; k++) {
      const c = roomy.splice(Math.floor(R() * roomy.length), 1)[0];
      nests.push({ x: Math.round((c.x + 0.5) * cell), y: c.y * cell });
    }
    if (!nests.length) nests.push({ x: Math.round(W / 2), y: 0 });
    // chains hang from ceilings (over open air, never across solid)
    const chains = [];
    for (let i = 0, tries = 0; i < 2 + Math.floor(R() * 3) && tries < 60 && ceilings.length; tries++) {
      const c = ceilings[Math.floor(R() * ceilings.length)];
      let air = 0;
      while (!g.solid(c.x, c.y + air)) air++;
      if (air < 4) continue;
      chains.push({ x: (c.x + 0.5) * cell, y0: c.y * cell, len: U.lerp(2, Math.min(12, air - 1), R()) * cell, phase: R() * 10, depth: U.lerp(0.25, 0.6, R()) });
      i++;
    }

    return {
      ledges,
      beams,
      poles,
      dens,
      fruitPlants,
      grass,
      nests,
      chains,
      debris: [],
      removed: [],
      floor: H,
      pits: f.pits.map((q) => ({ x0: q.cx0 * cell, x1: (q.cx1 + 1) * cell, y: (q.y + 1) * cell })),
      passages: (f.passages || []).map((q) => ({ cells: q.cells, a: q.a, b: q.b })),
      inlets: (f.inlets || []).map((q) => ({ cx: q.cx, cy: q.cy, side: q.side, x: q.side < 0 ? q.cx * cell : q.side > 0 ? (q.cx + 1) * cell : (q.cx + 0.5) * cell, y: q.side ? (q.cy + 0.5) * cell : q.cy * cell })),
      water: (f.water || []).map((w) => ({
        x: w.x0 * cell,
        y: w.cy * cell + (w.surface ? Math.round(cell * 0.35) : 0),
        w: (w.x1 - w.x0 + 1) * cell,
        h: w.surface ? cell - Math.round(cell * 0.35) : cell,
        surface: w.surface,
      })),
      region,
      room: { debug: f.passageDebug, C: g.C, R: g.R, cell, cells: g.a, blocks: f.blocks, open: f.open || null, arch: f.arch, passage: f.passageCells || new Set() },
    };
  }

  // ---- checking a map ----------------------------------------------------------
  // A scratch world with the map's statics; every den must reach every other
  // for a pole-climbing lizard. Unreachable platforms get a ladder down to the
  // floor below them where there's a clear column; then it's checked again.
  const CHECK_CAPS = { walls: false, ceil: false, poles: true, fall: true, jumpX: 3, jumpUp: 2, leapPoles: true, wallCost: 1.3, swim: 2 };
  CHECK_CAPS.key = RW.Nav.capsKey(CHECK_CAPS); // (the jump cache is keyed on it)
  function scratchWorld(decor, W, H, cell) {
    const w = new RW.World(cell);
    w.resize(W, H);
    w.setStatic(decor.ledges.concat(decor.beams), decor.poles);
    w.setPits(decor.pits);
    w.setWater(decor.water);
    w.setPassages(decor.passages);
    w.rebuild();
    return w;
  }
  function reach(w, from, to) {
    const p = RW.Nav.findPath(w, from.x, from.y - 4, to.x, to.y - 4, CHECK_CAPS, 30000);
    return !!(p && p.complete);
  }
  // (measured from the den that connects to the most others: one tucked
  // away in a cut-off pocket would make the whole map look unreachable)
  function check(decor, W, H, cell) {
    const pipes = decor.dens.filter((d) => !d.sky);
    if (pipes.length < 2) return { ok: false, w: null };
    const w = scratchWorld(decor, W, H, cell);
    let best = null;
    for (const d0 of pipes.slice(0, 3)) {
      // (one sweep: everything reachable from it, and everything that can reach it)
      const rs = RW.Nav.reachSets(w, d0.x, d0.y - 4, CHECK_CAPS);
      const both = (d) => {
        const i = rs.cellOf(d.x, d.y - 4);
        return i >= 0 && rs.fwd[i] && rs.back[i];
      };
      const bad = pipes.filter((d) => d !== d0 && !both(d));
      if (!best || bad.length < best.bad.length) best = { d0, bad };
      if (!bad.length) break;
    }
    decor.hubDen = best.d0;
    return { ok: !best.bad.length, bad: best.bad, w };
  }
  // Ladders from unreachable platforms down to the floor beneath them.
  function addLadders(g, f, decor, W, H, cell) {
    const w = scratchWorld(decor, W, H, cell);
    const d0 = decor.hubDen || decor.dens.find((d) => !d.sky);
    if (!d0) return 0; // (no dens at all: nothing to connect; the map is re-rolled)
    let added = 0;
    const cap = 6 + 7 * ((f.rooms || 1) - 1); // (a big map has more to join up)
    const rs = RW.Nav.reachSets(w, d0.x, d0.y - 4, CHECK_CAPS);
    for (const p of platforms(g)) {
      if (p.x1 - p.x0 < 1 || added > cap) continue;
      const mid = { x: ((p.x0 + p.x1) / 2 + 0.5) * cell, y: (p.y + 1) * cell };
      const mi = rs.cellOf(mid.x, mid.y - 4);
      if (mi >= 0 && rs.fwd[mi] && rs.back[mi]) continue;
      for (const cx of [p.x0 - 1, p.x1 + 1, p.x0, p.x1]) {
        if (cx < 1 || cx >= g.C - 1) continue;
        // from beside the platform (or through its end) straight down to a floor
        let y = p.y;
        if (g.solid(cx, y)) continue;
        let yy = y;
        while (yy < g.R - 1 && !g.solid(cx, yy + 1)) yy++;
        if (yy - y < 2 || yy >= g.R - 1) continue;
        f.poles.push({ cx, y0: y, y1: yy, ladder: true });
        added++;
        break;
      }
    }
    return added;
  }

  // ---- the entry point ---------------------------------------------------------
  function pickRegion(cfg, R) {
    const want = cfg.world.region;
    if (want && REGIONS[want]) return want;
    const keys = Object.keys(REGIONS);
    return keys[Math.floor(R() * keys.length)];
  }

  function generate(W, H, cfg, rnd, opts) {
    const cell = Math.min(40, Math.max(12, +cfg.world.cellSize || 20));
    const floor = Math.min(H, (opts && opts.floor) || H);
    const C = Math.ceil(W / cell);
    const Rows = Math.floor(floor / cell);
    const region = pickRegion(cfg, rnd);
    let best = null;
    // (a big map takes a while to check: fewer re-rolls, then the nearest miss)
    const maxTries = W * H > 2.5e6 ? 5 : 12;
    for (let tries = 0; tries < maxTries; tries++) {
      const R = U.mulberry32((rnd() * 4294967296) >>> 0);
      const g = new Grid(C, Rows);
      const pickArch = () => REGIONS[region].archetypes[Math.floor(R() * REGIONS[region].archetypes.length)];
      // A map of several rooms reads best as a bunker with an open roof:
      // the top row open to the sky (light and rain pouring in), the rooms
      // below it closed in (mostly), as the region builds them.
      const OPEN = ['skyShaft', 'cruciform', 'ruins'];
      const CLOSED = ['citadel', 'stacked'];
      const pickFor = (j) => {
        const own = REGIONS[region].archetypes;
        const want = j === 0 ? OPEN : CLOSED;
        if (j > 0 && R() < 0.25) return pickArch(); // (now and then, anything)
        let mine = own.filter((a) => want.includes(a));
        if (j === 0 && region === 'shaded') mine = ['ruins', 'ruins', 'cruciform']; // (wide open to the sky, mostly)
        const from = mine.length ? mine : j === 0 ? [region === 'shaded' ? 'ruins' : 'skyShaft'] : [region === 'shaded' ? 'citadel' : 'stacked'];
        return from[Math.floor(R() * from.length)];
      };
      const layout = roomGrid(C, Rows, R);
      const arch = pickArch();
      const f = { poles: [], beams: [], blocks: [], pits: [], arch, region, style: STYLE[region], rooms: layout.rooms.length };
      let info = null;
      if (layout.rooms.length === 1) {
        info = ARCHETYPES[arch](g, R, f);
      } else {
        // each room carved by its own archetype in its own rectangle
        for (const rm of layout.rooms) {
          const sub = new SubGrid(g, rm.x0, rm.y0, rm.x1 - rm.x0 + 1, rm.y1 - rm.y0 + 1);
          const lf = { poles: [], beams: [], blocks: [], pits: [], region, style: STYLE[region] };
          const a = layout.ny > 1 ? pickFor(rm.j) : pickArch();
          rm.arch = a;
          const ri = ARCHETYPES[a](sub, R, lf);
          if (!info || rm.j === layout.ny - 1) info = ri;
          for (const q of lf.poles) f.poles.push(Object.assign({}, q, { cx: q.cx + rm.x0, y0: q.y0 + rm.y0, y1: q.y1 + rm.y0 }));
          for (const q of lf.blocks) f.blocks.push(Object.assign({}, q, { x0: q.x0 + rm.x0, x1: q.x1 + rm.x0, y0: q.y0 + rm.y0, y1: q.y1 + rm.y0 }));
          for (const q of lf.beams) f.beams.push(Object.assign({}, q, { cy: q.cy + rm.y0, x0: q.x0 + rm.x0, x1: q.x1 + rm.x0 }));
          if (lf.open && rm.j === 0 && ((lf.open === 'left' && rm.i === 0) || (lf.open === 'right' && rm.i === layout.nx - 1))) f.open = lf.open;
          if (lf.widePits && rm.j === layout.ny - 1) f.widePits = true;
          if (lf.wantPit && rm.j === layout.ny - 1) f.wantPit = true;
        }
        f.arch = layout.rooms.map((rm) => rm.arch).join('+');
        // join neighbours: doorways side by side, shafts top to bottom
        for (const a of layout.rooms) {
          for (const b of layout.rooms) {
            if (b.i === a.i + 1 && b.j === a.j) connectH(g, R, b.x0, Math.max(a.y0, b.y0), Math.min(a.y1, b.y1)) || connectH(g, R, b.x0, Math.max(a.y0, b.y0), Math.min(a.y1, b.y1));
            if (b.j === a.j + 1 && b.i === a.i) connectV(g, R, f, b.y0, Math.max(a.x0, b.x0), Math.min(a.x1, b.x1));
          }
        }
      }
      // free-standing ledges: now and then on a screen-sized map, more (a
      // jungle gym) on the big ones
      const nLedge = layout.rooms.length > 1 ? Math.round(layout.rooms.length * (1 + R() * 1.5)) : C * Rows > 2000 ? (R() < 0.6 ? 1 + Math.floor(R() * 3) : 0) : R() < 0.35 ? 1 + Math.floor(R() * 2) : 0;
      addLedges(g, R, f, nLedge);
      // no flat floor longer than ~12 cells anywhere
      for (const p of platforms(g)) if (p.x1 - p.x0 + 1 > 12 && p.y > 3 && !f.blocks.some((b) => p.y + 1 >= b.y0 && p.y + 1 <= b.y1 && p.x1 >= b.x0 && p.x0 <= b.x1)) roughFloor(g, p.x0 + 2, p.x1 - 2, p.y + 1, R, 2, f);
      // water on about a third of maps (more in Shoreline), a pit on about a
      // third (the Citadel's drop shaft more often), never both
      const wetChance = region === 'shoreline' ? 0.5 : region === 'shaded' ? 0.15 : 0.33;
      const roll = R();
      if (f.widePits) {
        // gaps between floor islands
        addPit(g, R, f, true);
        addPit(g, R, f, R() < 0.5);
      } else if (f.wantPit || roll < 0.33) {
        if (addPit(g, R, f) && R() < 0.2) addPit(g, R, f);
      } else if (roll < 0.33 + wetChance) addWater(g, R, f, info);
      // a pole within 2 cells of each pit's edge, standing on the floor
      for (const q of f.pits) {
        const side = R() < 0.5 ? q.cx0 - 2 : q.cx1 + 2;
        if (!g.solid(side, q.y) && g.solid(side, q.y + 1)) f.poles.push({ cx: side, y0: q.y - 6 - Math.floor(R() * 4), y1: q.y, ladder: true });
      }
      furnish(g, R, f, layout.rooms.length);
      closeSlits(g);
      carvePassages(g, R, f);
      addInlet(g, R, f);
      let decor = buildDecor(g, f, cell, W, H, region, R);
      let res = check(decor, W, H, cell);
      if (!res.ok && f.pits.length) {
        // a pit cuts the map in two: bridge it with a bar just above the floor
        for (const q of f.pits) f.beams.push({ cy: q.y, x0: q.cx0 - 1, x1: q.cx1 + 1, bridge: true });
        const dens = decor.dens;
        decor = buildDecor(g, f, cell, W, H, region, U.mulberry32(5));
        decor.dens = dens;
        res = check(decor, W, H, cell);
      }
      for (let round = 0; !res.ok && round < Math.min(5, 2 + layout.rooms.length); round++) {
        const hub = decor.hubDen;
        if (!addLadders(g, f, decor, W, H, cell)) break;
        const dens = decor.dens;
        decor = buildDecor(g, f, cell, W, H, region, U.mulberry32(7));
        decor.dens = dens; // (keep the same dens)
        decor.hubDen = hub;
        res = check(decor, W, H, cell);
      }
      decor.tries = tries + 1;
      decor.ok = res.ok;
      if (res.ok) return decor;
      // (the nearest miss so far, with the dens that didn't connect)
      // (no list at all: fewer than two dens, the worst miss)
      const missed = res.bad ? res.bad.length : 999;
      if (!best || missed < best.missed) best = { decor, bad: res.bad || [], missed };
    }
    // nothing passed: the nearest miss, keeping only the dens that connect
    // (nothing comes out of, or heads for, a pipe in a cut-off pocket)
    const d = best.decor;
    d.dens = d.dens.filter((q) => !best.bad.includes(q));
    return d;
  }

  // ---- painting ----------------------------------------------------------------
  // The backdrop behind the room, per region, as crisp silhouette layers
  // (`layer` is Background.paint's: draw, snap to pixels, composite).
  // (R is Background.paint's R(a, b); called bare it gives 0..1 here)
  const either = (R) => (a, b) => (a === undefined ? R(0, 1) : R(a, b));
  function paintBackdrop(ctx, W, H, pal, decor, R0, layer) {
    const R = either(R0);
    const region = decor.region;
    const room = decor.room;
    // The light: the room's own dim interior colour, brightening to the sky's
    // only within about 14 cells of an opening to the outside (the top edge
    // where the hollow reaches it, an open side).
    const { C, cell, cells } = room;
    const Rows = room.R;
    const dist = new Int16Array(C * Rows).fill(-1);
    const q = [];
    const src = (x, y) => {
      const i = y * C + x;
      if (cells[i] !== 1 && dist[i] < 0) {
        dist[i] = 0;
        q.push(i);
      }
    };
    for (let x = 0; x < C; x++) src(x, 0);
    if (room.open === 'left' || room.open === 'right') for (let y = 0; y < Rows; y++) src(room.open === 'left' ? 0 : C - 1, y);
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % C;
      const y = (i / C) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= C || ny >= Rows) continue;
        const j = ny * C + nx;
        if (cells[j] === 1 || dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
    const lm = document.createElement('canvas');
    lm.width = C;
    lm.height = Rows;
    const lx = lm.getContext('2d');
    // (harsh: bright right by the openings, falling off fast, and the deep
    // insides darker than the room's own colour)
    room.lightDist = dist;
    const lit = U.mix(pal.sky, pal.light, 0.4);
    const deep = U.mix(pal.interior, pal.mass, 0.18);
    for (let y = 0; y < Rows; y++) {
      for (let x = 0; x < C; x++) {
        const d = dist[y * C + x];
        const t = d < 0 ? 0 : Math.pow(U.clamp(1 - d / 12, 0, 1), 1.7);
        const near = d < 0 ? 0 : U.clamp(1 - d / 22, 0, 1);
        lx.fillStyle = U.rgba(U.mix(U.mix(deep, pal.interior, near), lit, t));
        lx.fillRect(x, y, 1, 1);
      }
    }
    ctx.fillStyle = pal.interior;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(lm, 0, 0, C * cell, Rows * cell);
    ctx.restore();

    // Silhouettes darken whatever light is behind them (so they read as
    // shapes in the haze whether the room is lit or dim).
    const dark = U.rgba(pal.mass);
    if (region === 'outskirts') {
      // pump towers and tanks far off, a couple of huge fans nearer
      layer((l) => {
        l.fillStyle = dark;
        for (let x = R(-40, 40); x < W; x += R(70, 160)) {
          const w = R(16, 46);
          const h = R(H * 0.25, H * 0.7);
          l.fillRect(x, H - h, w, h);
          if (R() < 0.6) l.fillRect(x - w * 0.4, H - h - R(10, 30), w * 1.8, R(8, 16)); // a tank on top
          if (R() < 0.5) l.fillRect(x + w * 0.4, H - h - R(30, 70), 3, R(30, 70)); // a mast
        }
      }, 0.16);
      layer((l) => {
        l.fillStyle = dark;
        for (let i = 0; i < 2; i++) fan(l, R(W * 0.1, W * 0.9), R(H * 0.3, H * 0.75), R(40, 75), R);
      }, 0.26);
    } else if (region === 'industrial') {
      // huge gears at the open side (or an edge), pipe conduits crossing
      layer((l) => {
        l.fillStyle = dark;
        const side = room.open === 'right' ? 1 : room.open === 'left' ? 0 : R() < 0.5 ? 1 : 0;
        for (let i = 0; i < 3; i++) gear(l, side ? R(W * 0.78, W * 1.05) : R(-W * 0.05, W * 0.22), R(H * 0.15, H * 0.9), R(70, 130), R);
      }, 0.22);
      layer((l) => {
        l.fillStyle = dark;
        for (let i = 0; i < 4; i++) {
          const y = R(H * 0.1, H * 0.9);
          const t = R(8, 18);
          l.fillRect(0, y, W, t);
          for (let x = R(0, 60); x < W; x += R(50, 110)) l.fillRect(x, y - 3, 6, t + 6); // flanges
        }
      }, 0.2);
    } else if (region === 'shoreline') {
      // a rhythmic lattice of columns and window frames
      layer((l) => {
        l.fillStyle = dark;
        const pitch = R(46, 70);
        for (let x = R(0, pitch); x < W; x += pitch) {
          l.fillRect(x, 0, R(10, 18), H);
          for (let y = R(10, 40); y < H; y += R(50, 80)) l.fillRect(x + 22, y, pitch - 34, R(20, 34));
        }
      }, 0.3);
    } else {
      // Shaded Citadel: faint fluted pillars, a touch lighter than the dark
      layer((l) => {
        l.fillStyle = U.rgba(U.mix(pal.interior, pal.light, 0.08));
        for (let i = 0; i < 3; i++) {
          const x = R(W * 0.1, W * 0.85);
          const w = R(40, 70);
          l.fillRect(x, 0, w, H);
        }
      }, 0.7);
      layer((l) => {
        l.fillStyle = dark;
        for (let x = 0; x < W; x += 9) l.fillRect(x, 0, 2, H); // fluting
      }, 0.25);
    }
    // glows: Shoreline's red, Shaded's warm points
    const glow = (x, y, r, col, a) => {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, U.rgba(col, a));
      rg.addColorStop(1, U.rgba(col, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    if (region === 'shoreline') {
      for (let i = 0; i < 2; i++) {
        const x = i === 0 ? R(0, W * 0.2) : R(W * 0.8, W);
        const y = R(H * 0.6, H * 0.95);
        const r = R(9, 13) * cell;
        // a smooth (quadratic) falloff, and a small hot core
        const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, U.rgba('#ff5a22', 0.42));
        rg.addColorStop(0.35, U.rgba('#ff5a22', 0.42 * 0.42));
        rg.addColorStop(0.7, U.rgba('#ff5a22', 0.42 * 0.09));
        rg.addColorStop(1, U.rgba('#ff5a22', 0));
        ctx.fillStyle = rg;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        glow(x, y, 2.5 * cell, '#ffb060', 0.25);
      }
    } else if (region === 'shaded') {
      for (let i = 0; i < 5; i++) glow(R(0, W), R(H * 0.3, H), 14, pal.glow, 0.5);
    }

    // Shafts of daylight down through the open top: slanting, stopped by
    // the rock, strongest in a few distinct beams.
    const slant = (R() < 0.5 ? -1 : 1) * R(0.15, 0.4);
    const ph = R(0, 10);
    const beam = U.mix(pal.light, '#ffffff', 0.35);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let x = 0; x < C; x++) {
      if (cells[x] === 1) continue;
      let y = 0;
      let cx = x + 0.5;
      while (y < Rows) {
        const ix = Math.floor(cx);
        if (ix < 0 || ix >= C || cells[y * C + ix] === 1) break;
        y++;
        cx += slant;
      }
      const len = y * cell;
      if (len < cell * 2) continue;
      const str = 0.12 + 0.88 * Math.pow(0.5 + 0.5 * Math.sin(x * 0.5 + ph) * Math.sin(x * 0.17 + ph * 2), 3);
      const gr = ctx.createLinearGradient(0, 0, 0, len);
      const dark = region === 'shaded' ? 1.35 : 1;
      gr.addColorStop(0, U.rgba(beam, Math.min(0.6, 0.42 * str * dark)));
      gr.addColorStop(0.45, U.rgba(beam, 0.2 * str * dark));
      gr.addColorStop(1, U.rgba(beam, 0));
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(x * cell, 0);
      ctx.lineTo((x + 1) * cell, 0);
      ctx.lineTo((x + 1) * cell + slant * len, len);
      ctx.lineTo(x * cell + slant * len, len);
      ctx.fill();
    }
    ctx.restore();

    // Shaded Citadel: pale blue bioluminescence in the dark: fungus on the
    // back walls and hanging off the ceilings, glowing plants on the floors.
    // (placed here, haloes painted here behind everything; the growths
    // themselves are drawn in front by paintAccents)
    decor.biolum = [];
    if (region === 'shaded') {
      const solid = (x, y) => (x < 0 || x >= C || y < 0 || y >= Rows ? true : cells[y * C + x] === 1);
      for (let y = 1; y < Rows - 1; y++) {
        for (let x = 1; x < C - 1; x++) {
          if (solid(x, y)) continue;
          const d = dist[y * C + x];
          const dim = d < 0 ? 1 : U.clamp((d - 4) / 10, 0, 1); // (it grows in the dark)
          if (dim <= 0) continue;
          // (in colonies: much likelier next to one already started)
          const near = decor.biolum.some((q) => Math.abs(q.x - (x + 0.5) * cell) < cell * 2.5 && Math.abs(q.y - (y + 0.5) * cell) < cell * 2.5);
          const k = dim * (near ? 1.8 : 0.6);
          let kind = null;
          if (solid(x, y - 1) && R() < 0.22 * k) kind = 'ceiling';
          else if (solid(x, y + 1) && R() < 0.1 * k) kind = 'plant';
          else if ((solid(x - 1, y) || solid(x + 1, y)) && R() < 0.08 * k) kind = 'wall';
          if (!kind) continue;
          const b = { kind, x: (x + R(0.15, 0.85)) * cell, y: kind === 'ceiling' ? y * cell : kind === 'plant' ? (y + 1) * cell : (y + R(0.2, 0.8)) * cell, seed: R(0, 1000), side: solid(x - 1, y) ? -1 : 1 };
          decor.biolum.push(b);
          glow(b.x, kind === 'ceiling' ? b.y + 5 : kind === 'plant' ? b.y - 12 : b.y, R(14, 24), '#8fc6e0', 0.2);
        }
      }
    }
  }

  function fan(l, x, y, r, R) {
    l.beginPath();
    l.arc(x, y, r, 0, U.TAU);
    l.arc(x, y, r * 0.86, 0, U.TAU, true);
    l.fill();
    const n = 7 + Math.floor(R() * 4);
    const a0 = R() * U.TAU;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * U.TAU;
      l.beginPath();
      l.moveTo(x, y);
      l.arc(x, y, r * 0.84, a, a + (U.TAU / n) * 0.45);
      l.fill();
    }
  }
  function gear(l, x, y, r, R) {
    const teeth = 12 + Math.floor(R() * 8);
    l.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * U.TAU;
      const rr = i % 2 ? r : r * 0.9;
      l.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    l.closePath();
    l.arc(x, y, r * 0.3, 0, U.TAU, true);
    l.fill('evenodd');
    l.save();
    l.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * U.TAU + R();
      l.beginPath();
      l.arc(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.16, 0, U.TAU);
      l.fill();
    }
    l.restore();
  }

  // Soft shade cast into the hollow along every solid face (onto the
  // backdrop: the play layer is snapped to hard pixels, which would lose it).
  function paintShade(l, decor, pal) {
    const room = decor.room;
    const { C, cell, cells } = room;
    const Rows = room.R;
    const solid = (x, y) => (x < 0 || x >= C || y < 0 || y >= Rows ? true : cells[y * C + x] === 1);
    for (let y = 0; y < Rows; y++) {
      for (let x = 0; x < C; x++) {
        if (solid(x, y)) continue;
        const px = x * cell;
        const py = y * cell;
        // one hard-edged band against the face
        l.fillStyle = U.rgba(pal.mass, 0.22);
        if (solid(x - 1, y)) l.fillRect(px, py, 3, cell);
        if (solid(x + 1, y)) l.fillRect(px + cell - 3, py, 3, cell);
        if (solid(x, y - 1)) l.fillRect(px, py, cell, 4);
      }
    }
  }

  // Passages: a darker tube through the rock with a faint lighter rim, and
  // at each door the three-mark sign the game puts on shortcut mouths.
  function paintPassages(l, decor, pal) {
    const room = decor.room;
    const { cell } = room;
    const fill = U.rgba(U.mix(pal.interior, pal.mass, 0.45));
    const rim = U.rgba(U.mix(pal.mass, pal.light, 0.1));
    for (const q of decor.passages || []) {
      const set = new Set(q.cells.map(([x, y]) => x + ',' + y));
      for (const [x, y] of q.cells) {
        l.fillStyle = fill;
        l.fillRect(x * cell, y * cell, cell, cell);
        l.fillStyle = rim;
        if (!set.has(x + ',' + (y - 1))) l.fillRect(x * cell, y * cell, cell, 1);
        if (!set.has(x + ',' + (y + 1))) l.fillRect(x * cell, (y + 1) * cell - 1, cell, 1);
        if (!set.has(x - 1 + ',' + y)) l.fillRect(x * cell, y * cell, 1, cell);
        if (!set.has(x + 1 + ',' + y)) l.fillRect((x + 1) * cell - 1, y * cell, 1, cell);
      }
      // the marks, on the first cell in from each door
      l.fillStyle = U.rgba('#ffffff', 0.55);
      for (const [door, end] of [[q.a, q.cells[0]], [q.b, q.cells[q.cells.length - 1]]]) {
        const cx = (end[0] + 0.5) * cell;
        const cy = (end[1] + 0.5) * cell;
        const horiz = end[1] === door[1];
        for (let k = -1; k <= 1; k++) {
          if (horiz) l.fillRect(cx - 1, cy + k * 4 - 1, 2, 2);
          else l.fillRect(cx + k * 4 - 1, cy - 1, 2, 2);
        }
      }
    }
  }

  // A bottomless pit darkens toward the bottom of the screen: depth, a void.
  function paintPits(l, decor, pal, H) {
    for (const q of decor.pits || []) {
      const g = l.createLinearGradient(0, q.y, 0, H);
      g.addColorStop(0, U.rgba(pal.mass, 0));
      g.addColorStop(1, U.rgba('#000000', 0.75));
      l.fillStyle = g;
      l.fillRect(q.x0, q.y, q.x1 - q.x0, H - q.y);
    }
  }

  // The room's solid mass: flat near-black, a faint texture, a lighter lip
  // on top faces only, soft shade into the hollow, roots hanging off the
  // ceilings. Blocks are drawn as pieces of their own (octagons for the
  // Citadel's pendants).
  function paintMass(l, decor, pal, R0) {
    const R = either(R0);
    const room = decor.room;
    const { C, cell, cells } = room;
    const Rows = room.R;
    const solid = (x, y) => (x < 0 || x >= C || y < 0 || y >= Rows ? true : cells[y * C + x] === 1);
    const inBlock = new Uint8Array(C * Rows);
    for (const b of room.blocks) for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) inBlock[y * C + x] = 1;
    const mass = U.rgba(pal.mass);
    l.fillStyle = mass;
    for (let y = 0; y < Rows; y++) {
      let x = 0;
      while (x < C) {
        if (!solid(x, y) || inBlock[y * C + x]) {
          x++;
          continue;
        }
        const s = x;
        while (x < C && solid(x, y) && !inBlock[y * C + x]) x++;
        l.fillRect(s * cell, y * cell, (x - s) * cell, cell + (y === Rows - 1 ? 400 : 0));
      }
    }
    // texture: masonry courses every 3 cells, brick dashes, and a few buried
    // conduits running through the thick of it
    const tex = U.rgba(U.mix(pal.mass, pal.light, 0.08));
    const course = U.rgba(U.mix(pal.mass, pal.light, 0.06));
    const mottle = [U.rgba(U.mix(pal.mass, pal.light, 0.035)), U.rgba(U.mix(pal.mass, '#000000', 0.25))];
    for (let y = 0; y < Rows; y++) {
      for (let x = 0; x < C; x++) {
        if (!solid(x, y) || inBlock[y * C + x]) continue;
        if (y % 3 === 0) {
          l.fillStyle = course;
          l.fillRect(x * cell, y * cell + 1, cell, 1);
        }
        // mottling: a few soft-edged patches a shade lighter or darker
        for (let k = 0; k < 2; k++) {
          l.fillStyle = mottle[Math.floor(R() * 2)];
          l.fillRect(x * cell + R() * (cell - 6), y * cell + R() * (cell - 6), 3 + R() * 6, 3 + R() * 5);
        }
        l.fillStyle = tex;
        // brick dashes staggered along the course
        if (R() < 0.7) l.fillRect(x * cell + ((y % 2) * cell) / 2 + R() * 4, y * cell + (y % 3) * 6 + 4, cell * 0.4 + R() * cell * 0.4, 1.5);
        if (R() < 0.15) l.fillRect(x * cell + R() * (cell - 2), y * cell + R() * (cell - 2), 1.5, 1.5);
      }
    }
    const conduit = U.rgba(U.mix(pal.mass, pal.light, 0.06));
    for (let k = 0, tries = 0; k < 3 && tries < 60; tries++) {
      const y = 1 + Math.floor(R() * (Rows - 2));
      const x0 = Math.floor(R() * C);
      let x1 = x0;
      while (x1 + 1 < C && solid(x1 + 1, y) && solid(x1 + 1, y - 1) && solid(x1 + 1, y + 1)) x1++;
      if (x1 - x0 < 10) continue;
      l.fillStyle = conduit;
      l.fillRect(x0 * cell, y * cell + 6, (x1 - x0 + 1) * cell, 6);
      for (let x = x0 + 1; x < x1; x += 3 + Math.floor(R() * 3)) l.fillRect(x * cell, y * cell + 4, 3, 10); // flanges
      k++;
    }
    // the lip on top faces, and roots off the ceilings
    const lip = U.rgba(U.mix(pal.mass, pal.light, 0.16));
    const root = U.rgba(U.mix(pal.mass, pal.near, 0.4));
    for (let y = 0; y < Rows; y++) {
      for (let x = 0; x < C; x++) {
        if (!solid(x, y)) continue;
        if (!solid(x, y - 1) && !inBlock[y * C + x]) {
          l.fillStyle = lip;
          l.fillRect(x * cell, y * cell, cell, 2);
        }
        if (!solid(x, y + 1) && !room.passage.has((y + 1) * C + x) && R() < 0.22) {
          l.strokeStyle = root;
          l.lineWidth = R() < 0.3 ? 2 : 1.2;
          let rx = x * cell + R() * cell;
          let ry = (y + 1) * cell;
          const len = (2 + R() * (R() < 0.2 ? 10 : 4)) * cell * 0.5;
          l.beginPath();
          l.moveTo(rx, ry);
          for (let k = 0; k < len; k += 4) {
            rx += (R() - 0.5) * 3;
            ry += 4;
            if (solid(Math.floor(rx / cell), Math.floor(ry / cell))) break;
            l.lineTo(rx, ry);
          }
          l.stroke();
        }
      }
    }
    // the hanging blocks
    for (const b of room.blocks) {
      const x = b.x0 * cell;
      const y = b.y0 * cell;
      const w = (b.x1 - b.x0 + 1) * cell;
      const h = (b.y1 - b.y0 + 1) * cell;
      l.fillStyle = mass;
      if (b.octagon) {
        const c = Math.min(w, h) * 0.3;
        l.beginPath();
        l.moveTo(x + c, y);
        l.lineTo(x + w - c, y);
        l.lineTo(x + w, y + c);
        l.lineTo(x + w, y + h - c);
        l.lineTo(x + w - c, y + h);
        l.lineTo(x + c, y + h);
        l.lineTo(x, y + h - c);
        l.lineTo(x, y + c);
        l.closePath();
        l.fill();
        l.strokeStyle = U.rgba(U.mix(pal.mass, pal.light, 0.18));
        l.lineWidth = 1;
        l.stroke();
      } else {
        l.fillRect(x, y, w, h);
        l.fillStyle = lip;
        l.fillRect(x, y, w, 2);
        l.fillStyle = U.rgba(U.mix(pal.mass, pal.light, 0.08));
        l.fillRect(x + 3, y + 5, w - 6, 1.5);
      }
    }
  }

  // Region accents and hanging detail, over the mass: Outskirts' acid-green
  // vines on the blocks and floor tufts, Industrial's pink coral, Shoreline's
  // long yellow-green strands; sagging cables slung between walls and blocks.
  function paintAccents(l, decor, pal, R0, fg) {
    const F = fg || l;
    const R = either(R0);
    const room = decor.room;
    const { C, cell, cells } = room;
    const Rows = room.R;
    const solid = (x, y) => (x < 0 || x >= C || y < 0 || y >= Rows ? true : cells[y * C + x] === 1);
    const acc = pal.accent;
    const region = decor.region;
    const vine = (x, y, len, col, w) => {
      if (fg) fg.plant(x, y, true);
      F.strokeStyle = col;
      F.lineWidth = w;
      F.beginPath();
      F.moveTo(x, y);
      let vx = x;
      for (let k = 0; k < len; k += 3) {
        vx += Math.sin(k * 0.3 + x) * 0.8;
        if (solid(Math.floor(vx / cell), Math.floor((y + k) / cell))) break;
        F.lineTo(vx, y + k);
      }
      F.stroke();
    };
    const accCol = U.rgba(U.mix(acc, pal.mass, 0.25));
    if (region === 'outskirts' || region === 'shoreline') {
      // vines off block undersides (Outskirts) or long strands off ceilings
      for (const b of room.blocks) {
        if (region !== 'outskirts') break;
        const n = 3 + Math.floor(R() * 4);
        for (let i = 0; i < n; i++) vine(R(b.x0, b.x1 + 1) * cell, (b.y1 + 1) * cell, R(4, 8) * cell, accCol, 1.6);
      }
      for (let y = 1; y < Rows - 2; y++) {
        for (let x = 0; x < C; x++) {
          if (!solid(x, y - 1) || solid(x, y)) continue;
          const p = region === 'shoreline' ? (y > Rows * 0.5 ? 0.12 : 0.03) : 0.025;
          if (R() < p) vine((x + R()) * cell, y * cell, R(20, region === 'shoreline' ? 110 : 60), accCol, 1.2);
        }
      }
    }
    // floor clumps: green tufts (Outskirts, Shoreline), coral (Industrial)
    for (let y = 1; y < Rows; y++) {
      for (let x = 0; x < C; x++) {
        if (!solid(x, y) || solid(x, y - 1)) continue;
        if (region === 'industrial' ? R() > 0.05 : region === 'shaded' ? true : R() > 0.07) continue;
        const bx = (x + R()) * cell;
        const by = y * cell;
        if (fg) fg.plant(bx, by);
        F.strokeStyle = accCol;
        F.lineWidth = region === 'industrial' ? 3 : 1.4;
        if (region === 'industrial') {
          // coral: a branching fan, 3-5 cells tall
          const nb = 5 + Math.floor(R() * 5);
          for (let k = 0; k < nb; k++) {
            const a = -Math.PI / 2 + (k - (nb - 1) / 2) * 0.24;
            const len = R(1.5, 2.5) * cell;
            F.beginPath();
            F.moveTo(bx, by);
            F.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len);
            F.lineTo(bx + Math.cos(a + 0.4) * len * 1.4, by + Math.sin(a + 0.4) * len * 1.4);
            F.stroke();
          }
        } else {
          for (let k = 0; k < 9; k++) {
            F.beginPath();
            F.moveTo(bx + k * 2 - 8, by);
            F.lineTo(bx + k * 2 - 8 + R(-4, 4), by - R(6, 22));
            F.stroke();
          }
        }
      }
    }
    // cables: 2-4 sagging swags between two solid anchors 10-20 cells apart
    const anchors = [];
    for (let y = 1; y < Rows - 4; y++) for (let x = 1; x < C - 1; x++) if (solid(x, y) && (!solid(x + 1, y) || !solid(x - 1, y) || !solid(x, y + 1))) anchors.push([x, y]);
    const nCab = region === 'shaded' ? 1 : 2 + Math.floor(R() * 3);
    l.strokeStyle = U.rgba(U.mix(pal.mass, pal.near, 0.3));
    l.lineWidth = 1.6;
    for (let k = 0, tries = 0; k < nCab && tries < 300 && anchors.length; tries++) {
      const [ax, ay] = anchors[Math.floor(R() * anchors.length)];
      const [bx, by] = anchors[Math.floor(R() * anchors.length)];
      const dx = bx - ax;
      if (Math.abs(dx) < 10 || Math.abs(dx) > 20 || Math.abs(by - ay) > 5) continue;
      const sag = R(2, 5) * cell;
      const x0 = (ax + 0.5) * cell;
      const y0 = (ay + 0.9) * cell;
      const x1 = (bx + 0.5) * cell;
      const y1 = (by + 0.9) * cell;
      // the cable must hang in open air along its length
      let clear = true;
      for (let t = 0.1; t < 0.9; t += 0.1) {
        const x = U.lerp(x0, x1, t);
        const y = U.lerp(y0, y1, t) + sag * 4 * t * (1 - t);
        if (solid(Math.floor(x / cell), Math.floor(y / cell))) clear = false;
      }
      if (!clear) continue;
      l.beginPath();
      l.moveTo(x0, y0);
      l.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag * 2, x1, y1);
      l.stroke();
      k++;
    }
  }

  // Plant life round the water: reeds and cattails crowding the banks,
  // kelp ribbons swaying up from the bottom, moss on the wet rock. (On a
  // pit map, round the pits' rims: that's where the flood wells up.)
  // Background props: purely decorative machinery on the back wall, behind
  // everything that moves: wall-mounted cogs (now and then a meshing pair),
  // machine housings with panels, rivets, vents and a gauge, pipe runs with
  // flanges and a valve wheel, and junk piles heaped on the floors (crates,
  // a barrel, a tyre, scrap plates and rods). Each casts a soft shadow down
  // the wall and catches a rim of light on its upper edges, brighter the
  // nearer the room's openings it is.
  //   ctx: the backdrop (the shadows go straight onto it, soft); layer: draws
  //   crisp shapes onto it (see Background.paint).
  function paintProps(ctx, layer, decor, pal, R0) {
    const R = either(R0);
    const room = decor.room;
    const { C, cell, cells } = room;
    const Rows = room.R;
    const solid = (x, y) => (x < 0 || x >= C || y < 0 || y >= Rows ? true : cells[y * C + x] === 1);
    const dist = room.lightDist;
    const lightAt = (x, y) => {
      const d = dist ? dist[U.clamp(Math.floor(y / cell), 0, Rows - 1) * C + U.clamp(Math.floor(x / cell), 0, C - 1)] : -1;
      return d < 0 ? 0 : Math.pow(U.clamp(1 - d / 14, 0, 1), 1.3);
    };
    // open space round a cell (how big a prop can sit there)
    const room4 = (cx, cy, rw, rh) => {
      for (let y = cy - rh; y <= cy + rh; y++) for (let x = cx - rw; x <= cx + rw; x++) if (solid(x, y)) return false;
      return true;
    };
    const props = [];
    const taken = (x, y, r) => props.some((q) => Math.hypot(q.x - x, q.y - y) < q.r + r + cell);
    const open = C * Rows;
    const want = U.clamp(Math.round(open / 140), 4, 22);
    for (let tries = 0; tries < want * 30 && props.length < want; tries++) {
      const cx = 2 + Math.floor(R() * (C - 4));
      const cy = 2 + Math.floor(R() * (Rows - 4));
      if (solid(cx, cy)) continue;
      const roll = R();
      if (roll < 0.35 && solid(cx, cy + 1)) {
        // a junk pile on the floor
        const w = R(2.5, 5) * cell;
        if (taken(cx * cell, (cy + 1) * cell, w / 2)) continue;
        props.push({ kind: 'junk', x: (cx + 0.5) * cell, y: (cy + 1) * cell, w, r: w / 2, seed: R(0, 1000) });
      } else if (roll < 0.6 && room4(cx, cy, 2, 2)) {
        const r = R(0.9, 2) * cell;
        if (taken(cx * cell, cy * cell, r)) continue;
        props.push({ kind: 'cog', x: (cx + 0.5) * cell, y: (cy + 0.5) * cell, r, pair: R() < 0.35, seed: R(0, 1000) });
      } else if (roll < 0.82 && room4(cx, cy, 3, 2)) {
        const w = R(2.5, 4.5) * cell;
        const h = R(1.8, 3.2) * cell;
        if (taken(cx * cell, cy * cell, Math.max(w, h) / 2)) continue;
        props.push({ kind: 'machine', x: (cx + 0.5) * cell, y: (cy + 0.5) * cell, w, h, r: Math.max(w, h) / 2, seed: R(0, 1000) });
      } else {
        // a pipe run: along the wall from rock to rock (horizontal or up)
        const vert = R() < 0.4;
        let a = vert ? cy : cx;
        let b = a;
        if (vert) {
          while (a > 0 && !solid(cx, a - 1)) a--;
          while (b < Rows - 1 && !solid(cx, b + 1)) b++;
        } else {
          while (a > 0 && !solid(a - 1, cy)) a--;
          while (b < C - 1 && !solid(b + 1, cy)) b++;
        }
        if (b - a < 4 || b - a > 40) continue;
        const pr = { kind: 'pipe', vert, x: (cx + 0.5) * cell, y: (cy + 0.5) * cell, a: a * cell, b: (b + 1) * cell, t: R(4, 8), r: 6, seed: R(0, 1000) };
        if (props.some((q) => q.kind === 'pipe' && q.vert === vert && Math.abs(vert ? q.x - pr.x : q.y - pr.y) < 3 * cell)) continue;
        props.push(pr);
      }
    }
    // colours: darker than the wall, a rusty accent, the lit rim
    const base = U.mix(pal.interior, pal.mass, 0.55);
    const deep = U.mix(pal.interior, pal.mass, 0.82);
    const mid = U.mix(pal.interior, pal.mass, 0.35);
    const rust = U.mix(pal.rust, pal.mass, 0.45);
    const draw = (l, q, shadow) => {
      const RR = U.mulberry32((q.seed * 997) >>> 0);
      const r = (a, b) => a + RR() * (b - a);
      const lit = U.rgba(U.mix(base, pal.light, 0.18 + 0.5 * lightAt(q.x, q.y)));
      const C_ = (c) => (shadow ? shadow : U.rgba(c));
      const rim = shadow || lit;
      if (q.kind === 'cog') {
        const cogs = [[q.x, q.y, q.r]];
        if (q.pair) cogs.push([q.x + q.r * 1.7, q.y + q.r * 0.6, q.r * 0.62]);
        for (const [x, y, R_] of cogs) {
          const teeth = Math.max(8, Math.round(R_ / 2.6));
          l.fillStyle = C_(base);
          l.beginPath();
          for (let i = 0; i < teeth * 2; i++) {
            const a = (i / (teeth * 2)) * U.TAU;
            const rr = i % 2 ? R_ : R_ * 0.84;
            const a2 = ((i + 1) / (teeth * 2)) * U.TAU;
            l.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
            l.lineTo(x + Math.cos(a2) * rr, y + Math.sin(a2) * rr);
          }
          l.closePath();
          l.fill();
          if (shadow) continue;
          // rim light along the top teeth
          l.strokeStyle = rim;
          l.lineWidth = 1.2;
          l.beginPath();
          l.arc(x, y, R_ * 0.9, Math.PI * 1.1, Math.PI * 1.9);
          l.stroke();
          // spokes and holes, the hub
          l.fillStyle = C_(deep);
          const holes = 4 + Math.floor(r(0, 3));
          for (let i = 0; i < holes; i++) {
            const a = (i / holes) * U.TAU + q.seed;
            l.beginPath();
            l.arc(x + Math.cos(a) * R_ * 0.5, y + Math.sin(a) * R_ * 0.5, R_ * 0.17, 0, U.TAU);
            l.fill();
          }
          l.fillStyle = C_(mid);
          l.beginPath();
          l.arc(x, y, R_ * 0.2, 0, U.TAU);
          l.fill();
          l.fillStyle = C_(deep);
          l.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      } else if (q.kind === 'machine') {
        const x0 = q.x - q.w / 2;
        const y0 = q.y - q.h / 2;
        l.fillStyle = C_(base);
        l.fillRect(x0, y0, q.w, q.h);
        // pipe stubs off the sides
        l.fillRect(x0 - 6, q.y + r(-q.h * 0.3, q.h * 0.2), 6, 5);
        l.fillRect(x0 + q.w, q.y + r(-q.h * 0.3, q.h * 0.2), 6, 5);
        if (shadow) return;
        l.fillStyle = rim;
        l.fillRect(x0, y0, q.w, 1.5);
        l.fillRect(x0, y0, 1.5, q.h * 0.6);
        // panel seams
        l.fillStyle = C_(deep);
        const nPanels = 2 + Math.floor(r(0, 2));
        for (let i = 1; i < nPanels; i++) l.fillRect(x0 + (q.w * i) / nPanels, y0 + 2, 1, q.h - 4);
        // rivets along the top and bottom
        l.fillStyle = C_(mid);
        for (let x = x0 + 4; x < x0 + q.w - 3; x += 7) {
          l.fillRect(x, y0 + 3, 1.5, 1.5);
          l.fillRect(x, y0 + q.h - 4, 1.5, 1.5);
        }
        // vent slats in one panel
        l.fillStyle = C_(deep);
        const vx = x0 + q.w * r(0.08, 0.4);
        for (let y = y0 + q.h * 0.3; y < y0 + q.h * 0.8; y += 3.5) l.fillRect(vx, y, q.w * 0.22, 1.8);
        // a gauge with its needle, rusted at the rim
        const gx = x0 + q.w * r(0.62, 0.82);
        const gy = y0 + q.h * r(0.3, 0.5);
        const gr = Math.min(q.w, q.h) * 0.15;
        l.fillStyle = C_(rust);
        l.beginPath();
        l.arc(gx, gy, gr + 1.5, 0, U.TAU);
        l.fill();
        l.fillStyle = C_(deep);
        l.beginPath();
        l.arc(gx, gy, gr, 0, U.TAU);
        l.fill();
        l.strokeStyle = rim;
        l.lineWidth = 1;
        const na = r(-2.4, -0.7);
        l.beginPath();
        l.moveTo(gx, gy);
        l.lineTo(gx + Math.cos(na) * gr * 0.9, gy + Math.sin(na) * gr * 0.9);
        l.stroke();
      } else if (q.kind === 'pipe') {
        const t = q.t;
        l.fillStyle = C_(base);
        if (q.vert) l.fillRect(q.x - t / 2, q.a, t, q.b - q.a);
        else l.fillRect(q.a, q.y - t / 2, q.b - q.a, t);
        if (shadow) return;
        l.fillStyle = rim;
        if (q.vert) l.fillRect(q.x - t / 2, q.a, 1.2, q.b - q.a);
        else l.fillRect(q.a, q.y - t / 2, q.b - q.a, 1.2);
        // flanges every few cells, a valve wheel on one
        l.fillStyle = C_(deep);
        const len = q.b - q.a;
        const step = r(2.5, 4.5) * cell;
        for (let d = step * 0.5; d < len; d += step) {
          if (q.vert) l.fillRect(q.x - t / 2 - 2, q.a + d, t + 4, 3);
          else l.fillRect(q.a + d, q.y - t / 2 - 2, 3, t + 4);
        }
        const vd = q.a + len * r(0.25, 0.75);
        const vx = q.vert ? q.x + t / 2 + 5 : vd;
        const vy = q.vert ? vd : q.y - t / 2 - 6;
        l.strokeStyle = C_(rust);
        l.lineWidth = 1.6;
        l.beginPath();
        l.arc(vx, vy, 4.5, 0, U.TAU);
        l.moveTo(vx - 4.5, vy);
        l.lineTo(vx + 4.5, vy);
        l.moveTo(vx, vy - 4.5);
        l.lineTo(vx, vy + 4.5);
        l.stroke();
      } else {
        // a junk pile: the heap's silhouette, then the things in it
        const w = q.w;
        const x0 = q.x - w / 2;
        const hh = w * r(0.35, 0.55);
        l.fillStyle = C_(base);
        l.beginPath();
        l.moveTo(x0, q.y);
        for (let i = 0; i <= 8; i++) {
          const u = i / 8;
          l.lineTo(x0 + u * w, q.y - Math.sin(u * Math.PI) * hh * r(0.7, 1.15));
        }
        l.lineTo(x0 + w, q.y);
        l.closePath();
        l.fill();
        // a crate or two, tilted
        const nc = 1 + Math.floor(r(0, 2.4));
        for (let i = 0; i < nc; i++) {
          const s = r(7, 13);
          const cx = x0 + w * r(0.2, 0.8);
          const cy = q.y - hh * r(0.3, 0.75);
          l.save();
          l.translate(cx, cy);
          l.rotate(r(-0.4, 0.4));
          l.fillStyle = C_(mid);
          l.fillRect(-s / 2, -s / 2, s, s);
          if (!shadow) {
            l.fillStyle = C_(deep);
            l.fillRect(-s / 2, -0.5, s, 1);
            l.fillStyle = rim;
            l.fillRect(-s / 2, -s / 2, s, 1);
          }
          l.restore();
        }
        if (r(0, 1) < 0.6) {
          // a barrel on its end, banded
          const bw = r(7, 10);
          const bh = r(10, 15);
          const bx = x0 + w * (r(0, 1) < 0.5 ? r(0.05, 0.2) : r(0.75, 0.9));
          l.fillStyle = C_(rust);
          l.fillRect(bx - bw / 2, q.y - bh, bw, bh);
          if (!shadow) {
            l.fillStyle = C_(deep);
            l.fillRect(bx - bw / 2, q.y - bh * 0.7, bw, 1.2);
            l.fillRect(bx - bw / 2, q.y - bh * 0.3, bw, 1.2);
            l.fillStyle = rim;
            l.fillRect(bx - bw / 2, q.y - bh, bw, 1);
          }
        }
        if (r(0, 1) < 0.45) {
          // a tyre leaning in the heap
          const tx = x0 + w * r(0.3, 0.7);
          const tr = r(5, 8);
          l.strokeStyle = C_(deep);
          l.lineWidth = 3;
          l.beginPath();
          l.ellipse(tx, q.y - tr, tr, tr * 0.9, r(-0.3, 0.3), 0, U.TAU);
          l.stroke();
        }
        if (!shadow) {
          // rods and plates sticking out
          l.strokeStyle = C_(mid);
          l.lineWidth = 1.4;
          for (let i = 0; i < 3; i++) {
            const sx = x0 + w * r(0.15, 0.85);
            const sy = q.y - hh * r(0.2, 0.6);
            const a = r(-2.6, -0.5);
            const len = r(6, 16);
            l.beginPath();
            l.moveTo(sx, sy);
            l.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
            l.stroke();
          }
          l.fillStyle = rim;
          l.fillRect(x0 + w * 0.3, q.y - hh * 0.95, w * 0.3, 1);
        }
      }
    };
    // soft shadows straight onto the wall, a little down and away from the light
    ctx.save();
    ctx.translate(2.5, 4);
    for (const q of props) draw(ctx, q, U.rgba(pal.mass, 0.38));
    ctx.restore();
    layer((l) => {
      for (const q of props) draw(l, q, null);
    });
    decor.props = props;
  }

  // The Shaded Citadel's bioluminescence (placed by paintBackdrop, with its
  // haloes): pale blue fungus bracketing the ceilings with glowing threads
  // hanging off them, speckled patches on the walls, and glowing plants on
  // the floors: curved stalks with bulbs.
  function paintBiolum(l, decor, fg) {
    const F = fg || l;
    const core = '#e2f8ff';
    const glowC = 'rgba(159, 220, 240, 0.75)';
    const stem = 'rgba(70, 130, 160, 0.85)';
    for (const b of decor.biolum || []) {
      const R = U.mulberry32((b.seed * 1000) >>> 0);
      const r = (a, c) => a + R() * (c - a);
      if (b.kind === 'ceiling') {
        // bracket caps along the underside, threads hanging from them
        const n = 2 + Math.floor(R() * 3);
        for (let i = 0; i < n; i++) {
          const x = b.x + r(-7, 7);
          const w = r(3, 7);
          l.fillStyle = glowC;
          l.beginPath();
          l.ellipse(x, b.y, w, r(1.6, 2.8), 0, 0, Math.PI);
          l.fill();
          if (R() < 0.4) {
            l.fillStyle = core;
            l.fillRect(x - w * 0.3, b.y, w * 0.6, 1);
          }
          if (R() < 0.7) {
            const len = r(3, 13);
            l.fillStyle = stem;
            l.fillRect(x + r(-2, 2), b.y + 2, 1, len);
            l.fillStyle = core;
            l.fillRect(x - 0.5 + r(-2, 2), b.y + 1 + len, 2, 2);
          }
        }
      } else if (b.kind === 'wall') {
        // a speckled patch, a few tiny caps sticking out of it
        const n = 4 + Math.floor(R() * 6);
        for (let i = 0; i < n; i++) {
          l.fillStyle = R() < 0.4 ? core : glowC;
          const s = R() < 0.3 ? 2 : 1;
          l.fillRect(b.x + r(-6, 6), b.y + r(-6, 6), s, s);
        }
        const caps = 1 + Math.floor(R() * 3);
        for (let i = 0; i < caps; i++) {
          const x = b.x + r(-4, 4);
          const y = b.y + r(-4, 4);
          l.fillStyle = stem;
          l.fillRect(x, y, 1, 3);
          l.fillStyle = glowC;
          l.beginPath();
          l.ellipse(x + 0.5, y, r(1.8, 3), 1.4, 0, Math.PI, U.TAU);
          l.fill();
        }
      } else {
        // a plant: a few curved stalks with glowing bulbs at the tips
        const n = 1 + Math.floor(R() * 3);
        if (fg) fg.plant(b.x, b.y);
        for (let i = 0; i < n; i++) {
          const h = r(10, 26);
          const lean = r(-6, 6);
          const x0 = b.x + r(-4, 4);
          F.strokeStyle = stem;
          F.lineWidth = 1.2;
          F.beginPath();
          F.moveTo(x0, b.y);
          F.quadraticCurveTo(x0 + lean * 0.2, b.y - h * 0.6, x0 + lean, b.y - h);
          F.stroke();
          F.fillStyle = glowC;
          F.beginPath();
          F.arc(x0 + lean, b.y - h, r(1.6, 2.6), 0, U.TAU);
          F.fill();
          F.fillStyle = core;
          F.fillRect(x0 + lean - 0.5, b.y - h - 0.5, 1.5, 1.5);
          if (R() < 0.6) {
            F.fillStyle = glowC;
            F.fillRect(x0 + lean * 0.45 + 1, b.y - h * 0.5, 2, 2);
          }
        }
      }
    }
  }

  // (fg: the foreground plants' recorder, RW.Foliage; without one they're
  // painted straight onto the layer as before)
  function paintWaterPlants(l, decor, pal, R0, fg) {
    const F = fg || l;
    const R = either(R0);
    const room = decor.room;
    const { C, cell, cells } = room;
    const Rows = room.R;
    const solid = (x, y) => (x < 0 || x >= C || y < 0 || y >= Rows ? true : cells[y * C + x] === 1);
    const wet = new Uint8Array(C * Rows);
    for (const r of decor.water || []) {
      for (let y = Math.floor(r.y / cell); y < Math.ceil((r.y + r.h) / cell); y++) for (let x = Math.floor(r.x / cell); x < Math.ceil((r.x + r.w) / cell); x++) if (x >= 0 && y >= 0 && x < C && y < Rows) wet[y * C + x] = 1;
    }
    // where the plants grow from: the water, or the pits' rims
    const seeds = [];
    for (let i = 0; i < wet.length; i++) if (wet[i]) seeds.push(i);
    for (const p of decor.pits || []) {
      const y = Math.floor(p.y / cell) - 1;
      for (let x = Math.floor(p.x0 / cell) - 1; x <= Math.ceil(p.x1 / cell); x++) if (x >= 0 && x < C && y >= 0 && !solid(x, y)) seeds.push(y * C + x);
    }
    if (!seeds.length) return;
    // how far (through the open) each cell is from the water
    const dist = new Int16Array(C * Rows).fill(-1);
    const q = seeds.slice();
    for (const i of q) dist[i] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (dist[i] >= 6) continue;
      const x = i % C;
      const y = (i / C) | 0;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (solid(nx, ny)) continue;
        const j = ny * C + nx;
        if (dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
    // reeds grow in clumps: runs of 3-5 columns with gaps of 2-4 between
    const clump = new Uint8Array(C);
    for (let x = 0, on = R() < 0.5; x < C; on = !on) {
      const n = on ? 3 + Math.floor(R() * 3) : 2 + Math.floor(R() * 3);
      for (let k = 0; k < n && x < C; k++, x++) clump[x] = on ? 1 : 0;
    }
    const green = decor.region === 'outskirts' || decor.region === 'shoreline' ? pal.accent : U.mix(pal.accent, '#4f7a3a', 0.6);
    const stalk = U.rgba(U.mix(green, pal.mass, 0.35));
    const leaf = U.rgba(U.mix(green, pal.mass, 0.15));
    const dark = U.rgba(U.mix(green, pal.mass, 0.65));
    const head = U.rgba(U.mix('#5a3a24', pal.mass, 0.35));
    for (let y = 1; y < Rows; y++) {
      for (let x = 0; x < C; x++) {
        const i = y * C + x;
        if (solid(x, y) || !solid(x, y + 1) || dist[i] < 0) continue;
        const bx = x * cell;
        const by = (y + 1) * cell;
        if (wet[i]) {
          // under water: kelp ribbons, swaying up toward the surface
          let top = y;
          while (top > 0 && wet[(top - 1) * C + x]) top--;
          const n = R() < 0.85 ? 2 + Math.floor(R() * 3) : 0;
          if (fg && n) fg.plant(bx + cell / 2, by, false, { wet: true });
          for (let k = 0; k < n; k++) {
            const h = (by - top * cell) * R(0.45, 0.95);
            let px = bx + R(2, cell - 2);
            F.strokeStyle = k % 2 ? dark : stalk;
            F.lineWidth = R(1.5, 3);
            F.beginPath();
            F.moveTo(px, by);
            for (let t = 4; t < h; t += 4) {
              px += Math.sin(t * 0.18 + x) * 1.4;
              F.lineTo(px, by - t);
            }
            F.stroke();
          }
          // shallows: reeds standing up out of the water
          if (by - top * cell <= 3 * cell && clump[x]) {
            if (fg) fg.plant(bx + cell / 2, by);
            for (let k = 0; k < 6 + Math.floor(R() * 7); k++) {
              const sx = bx + R(0, cell);
              const h = by - top * cell + R(0.4, 1.6) * cell;
              const lean = R(-5, 5);
              F.strokeStyle = R() < 0.5 ? leaf : stalk;
              F.lineWidth = R(1, 2);
              F.beginPath();
              F.moveTo(sx, by);
              F.quadraticCurveTo(sx + lean * 0.2, by - h * 0.6, sx + lean, by - h);
              F.stroke();
              if (R() < 0.3) {
                F.fillStyle = head;
                F.fillRect(sx + lean - 1.5, by - h - 1, 3, 7);
              }
            }
          }
          continue;
        }
        // on the bank: reeds, thicker the closer to the water
        const near = 1 - dist[i] / 7;
        if (!clump[x] || R() > 0.4 + near * 0.6) continue;
        const n = 4 + Math.floor(R() * 7 * near + R() * 3);
        if (fg) fg.plant(bx + cell / 2, by);
        for (let k = 0; k < n; k++) {
          const sx = bx + R(0, cell);
          const h = R(0.8, 1.8 + near * 1.8) * cell;
          const lean = R() < 0.2 ? R(-14, 14) : R(-6, 6); // (some bent over)
          F.strokeStyle = R() < 0.4 ? leaf : stalk;
          F.lineWidth = R(1, 2);
          F.beginPath();
          F.moveTo(sx, by);
          F.quadraticCurveTo(sx + lean * 0.3, by - h * 0.6, sx + lean, by - h);
          F.stroke();
          // a cattail head on some
          if (R() < 0.25 * near) {
            F.fillStyle = head;
            F.fillRect(sx + lean - 1.5, by - h - 1, 3, 7);
          }
        }
        // broad leaves arching over
        if (R() < near * 0.6) {
          F.fillStyle = leaf;
          const lx = bx + R(0, cell);
          const s = R() < 0.5 ? 1 : -1;
          F.beginPath();
          F.moveTo(lx, by);
          F.quadraticCurveTo(lx + s * 8, by - 16, lx + s * 16, by - 6);
          F.quadraticCurveTo(lx + s * 8, by - 10, lx, by);
          F.fill();
        }
      }
    }
    // vines and roots hanging down over the water from the ceilings above
    for (let y = 1; y < Rows; y++) {
      for (let x = 0; x < C; x++) {
        if (solid(x, y) || !solid(x, y - 1) || R() > 0.6) continue;
        let yy = y;
        while (yy < Rows && !solid(x, yy) && !wet[yy * C + x] && yy - y < 14) yy++;
        if (yy >= Rows || !wet[yy * C + x]) continue;
        const len = (yy - y) * cell * R(0.3, 0.9);
        let px = x * cell + R(2, cell - 2);
        if (fg) fg.plant(px, y * cell, true);
        F.strokeStyle = R() < 0.5 ? leaf : stalk;
        F.lineWidth = R(1, 1.8);
        F.beginPath();
        F.moveTo(px, y * cell);
        for (let t = 4; t < len; t += 4) {
          px += Math.sin(t * 0.25 + x * 3) * 0.9;
          F.lineTo(px, y * cell + t);
        }
        F.stroke();
        if (R() < 0.5) {
          F.fillStyle = leaf;
          F.fillRect(px - 2, y * cell + len - 2, 4, 3);
        }
      }
    }
    // moss in clumps on the rock round the water and just above it
    for (let y = 0; y < Rows; y++) {
      for (let x = 0; x < C; x++) {
        if (!solid(x, y)) continue;
        for (const [ax, ay] of [[x - 1, y], [x + 1, y], [x, y - 1]]) {
          const j = ay * C + ax;
          if (ax < 0 || ay < 0 || ax >= C || ay >= Rows || solid(ax, ay) || dist[j] < 0 || dist[j] > 3 || R() > 0.5) continue;
          // a clump of a few blobs on that face, spilling a little over it
          const fx = ax < x ? x * cell : ax > x ? (x + 1) * cell : null;
          const cx0 = fx === null ? x * cell + R(2, cell - 2) : fx;
          const cy0 = fx === null ? y * cell : y * cell + R(2, cell - 2);
          for (let k = 0; k < 4 + Math.floor(R() * 5); k++) {
            l.fillStyle = R() < 0.6 ? dark : leaf;
            const s = R(3, 7);
            l.fillRect(cx0 + R(-8, 8) - s / 2, cy0 + R(-5, 5) - s / 2, s, s);
          }
        }
      }
    }
  }

  // Manmade junk over the rock's edges, to break up its hard outlines:
  // pipes run down wall faces and along under ceilings, girders brace the
  // inside corners, grates and vents and glyph panels are set into the
  // rock face, rebar pokes out of broken edges, and rubble collects in the
  // floor corners. (Decor only: none of it is anything to stand on.)
  function paintJunk(l, decor, pal, R0) {
    const R = either(R0);
    const room = decor.room;
    const { C, cell, cells } = room;
    const Rows = room.R;
    const solid = (x, y) => (x < 0 || x >= C || y < 0 || y >= Rows ? true : cells[y * C + x] === 1);
    // the flood's inlet pipes: a big bore out of the wall, a dark mouth
    for (const q of decor.inlets || []) {
      if (!q.side) {
        // down out of the ceiling
        const d = 30;
        const out = 12;
        l.fillStyle = U.rgba(U.mix(pal.mass, pal.light, 0.08));
        l.fillRect(q.x - d / 2 + 3, q.y - 3 * cell, d - 6, 3 * cell);
        l.fillStyle = U.rgba(U.mix(pal.mass, pal.light, 0.16));
        l.fillRect(q.x - d / 2, q.y, d, out);
        l.fillStyle = U.rgba(U.mix(pal.mass, pal.light, 0.3));
        l.fillRect(q.x - d / 2 - 3, q.y + out - 3, d + 6, 3);
        l.fillStyle = U.rgba(U.mix(pal.mass, '#000000', 0.6));
        l.beginPath();
        l.ellipse(q.x, q.y + out, d / 2 - 4, 3.5, 0, 0, U.TAU);
        l.fill();
        continue;
      }
      const face = q.x;
      const cy = q.y;
      const d = 30; // the bore
      const out = 12; // how far it stands out of the wall
      const body = U.rgba(U.mix(pal.mass, pal.light, 0.16));
      const rim = U.rgba(U.mix(pal.mass, pal.light, 0.3));
      const dark = U.rgba(U.mix(pal.mass, '#000000', 0.6));
      // its run back through the rock
      l.fillStyle = U.rgba(U.mix(pal.mass, pal.light, 0.08));
      l.fillRect(q.side < 0 ? face - 3 * cell : face, cy - d / 2 + 3, 3 * cell, d - 6);
      // the end standing out, a flange, the open mouth
      const x0 = q.side < 0 ? face : face - out;
      l.fillStyle = body;
      l.fillRect(x0, cy - d / 2, out, d);
      l.fillStyle = rim;
      l.fillRect(q.side < 0 ? face + out - 3 : face - out, cy - d / 2 - 3, 3, d + 6);
      l.fillStyle = dark;
      l.beginPath();
      l.ellipse(q.side < 0 ? face + out : face - out, cy, 3.5, d / 2 - 4, 0, 0, U.TAU);
      l.fill();
      // a streak of rust and weed down the wall below it
      l.fillStyle = U.rgba(U.mix(U.mix(pal.mass, '#6a4a2a', 0.4), pal.near, 0.2));
      l.fillRect(q.side < 0 ? face : face - 6, cy + d / 2, 6, 2 * cell);
    }
    const tun = (x, y) => room.passage.has(y * C + x);
    const metal = U.rgba(U.mix(pal.mass, pal.near, 0.6));
    const metalD = U.rgba(U.mix(pal.mass, pal.near, 0.35));
    const metalL = U.rgba(U.mix(pal.mass, pal.light, 0.42));
    const rust = U.rgba(U.mix(U.mix(pal.mass, '#7a4a2a', 0.35), pal.near, 0.25));
    const used = new Uint8Array(C * Rows);
    const area = C * Rows;
    // big pipes running down wall faces, straddling the edge (half in the
    // rock, standing a few px proud of it), lighter than the face, with
    // flanges every few cells and an elbow back into the rock at each end
    const pipeB = U.rgba(U.mix(pal.mass, pal.light, 0.13));
    const pipeH = U.rgba(U.mix(pal.mass, pal.light, 0.24));
    const pipeS = U.rgba(U.mix(pal.mass, '#000000', 0.3));
    for (let k = 0, tries = 0; k < area / 130 && tries < 900; tries++) {
      const x = Math.floor(R() * C);
      const y0 = Math.floor(R() * Rows);
      const side = R() < 0.5 ? -1 : 1; // the rock's side
      if (solid(x, y0) || !solid(x + side, y0) || used[y0 * C + x] || tun(x, y0)) continue;
      let y1 = y0;
      while (y1 + 1 < Rows && !solid(x, y1 + 1) && solid(x + side, y1 + 1)) y1++;
      if (y1 - y0 < 2) continue;
      const w = Math.round(R(11, 16));
      const out = Math.round(R(3, 6)); // proud of the face
      const face = side > 0 ? (x + 1) * cell : x * cell;
      const px = side > 0 ? face - out : face + out - w;
      const top = Math.max(0, y0 - Math.floor(R(0, 3))) * cell;
      const bot = (y1 + 1) * cell;
      l.fillStyle = pipeB;
      l.fillRect(px, top, w, bot - top);
      l.fillStyle = pipeH;
      l.fillRect(px + 2, top, 2, bot - top);
      l.fillStyle = pipeS;
      l.fillRect(px + w - 2, top, 2, bot - top);
      for (let y = top + R(10, 40); y < bot - 6; y += R(60, 90)) {
        l.fillStyle = pipeH;
        l.fillRect(px - 2, y, w + 4, 4); // a flange
        l.fillStyle = pipeS;
        l.fillRect(px - 2, y + 4, w + 4, 1.5);
      }
      // elbows back into the rock
      l.fillStyle = pipeB;
      if (y1 + 1 < Rows) l.fillRect(side > 0 ? px : face - cell * 0.6, bot - w, w + cell * 0.6, w);
      for (let y = y0; y <= y1; y++) used[y * C + x] = 1;
      k++;
    }
    // stubs: short pipe ends poking out of rock faces into the open, some
    // dripping
    for (let k = 0, tries = 0; k < area / 160 && tries < 900; tries++) {
      const x = 1 + Math.floor(R() * (C - 2));
      const y = 1 + Math.floor(R() * (Rows - 2));
      if (!solid(x, y)) continue;
      const dirs = [];
      if (!solid(x - 1, y) && !solid(x - 2, y)) dirs.push([-1, 0]);
      if (!solid(x + 1, y) && !solid(x + 2, y)) dirs.push([1, 0]);
      if (!solid(x, y + 1) && !solid(x, y + 2)) dirs.push([0, 1]);
      if (!dirs.length) continue;
      const [dx, dy] = dirs[Math.floor(R() * dirs.length)];
      const len = R(14, 34);
      const w = R(6, 10);
      const cx = (x + 0.5) * cell + dx * cell * 0.5;
      const cy = (y + 0.5) * cell + dy * cell * 0.5;
      l.fillStyle = pipeB;
      if (dx) l.fillRect(dx > 0 ? cx - 4 : cx - len + 4, cy - w / 2, len, w);
      else l.fillRect(cx - w / 2, cy - 4, w, len);
      l.fillStyle = pipeH;
      // the rim of the open end
      if (dx) l.fillRect(dx > 0 ? cx + len - 6 : cx - len + 4, cy - w / 2 - 1.5, 2.5, w + 3);
      else l.fillRect(cx - w / 2 - 1.5, cy + len - 6, w + 3, 2.5);
      k++;
    }
    // recessed panels in the big masses: a sunken plate with a lit top and
    // left rim, holding a grille, a round vent or a column of glyphs
    const plate = U.rgba(U.mix(pal.mass, pal.light, 0.06));
    const rimL = U.rgba(U.mix(pal.mass, pal.light, 0.17));
    const rimD = U.rgba(U.mix(pal.mass, '#000000', 0.35));
    const hole = U.rgba(U.mix(pal.mass, '#000000', 0.45));
    let rockN = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i] === 1) rockN++;
    for (let k = 0, tries = 0; k < rockN / 220 && tries < 1500; tries++) {
      const w = 6 + Math.floor(R() * 5);
      const h = 4 + Math.floor(R() * 3);
      const x0 = Math.floor(R() * (C - w));
      const y0 = Math.floor(R() * (Rows - h));
      let ok = true;
      for (let y = y0; y < y0 + h && ok; y++) for (let x = x0; x < x0 + w; x++) if (!solid(x, y) || used[y * C + x] === 2) ok = false;
      if (!ok) continue;
      // inset half a cell, so it sits inside the rock
      const px = x0 * cell + cell / 2;
      const py = y0 * cell + cell / 2;
      const pw = (w - 1) * cell;
      const ph = (h - 1) * cell;
      l.fillStyle = plate;
      l.fillRect(px, py, pw, ph);
      l.fillStyle = rimL;
      l.fillRect(px, py, pw, 2);
      l.fillRect(px, py, 2, ph);
      l.fillStyle = rimD;
      l.fillRect(px, py + ph - 2, pw, 2);
      l.fillRect(px + pw - 2, py, 2, ph);
      const kind = R();
      if (kind < 0.4) {
        l.fillStyle = hole;
        for (let y = py + 6; y < py + ph - 6; y += 5) l.fillRect(px + 6, y, pw - 12, 2.5);
      } else if (kind < 0.7) {
        const r = Math.min(pw, ph) * 0.32;
        l.fillStyle = hole;
        l.beginPath();
        l.arc(px + pw / 2, py + ph / 2, r, 0, U.TAU);
        l.fill();
        l.fillStyle = rimL;
        for (let a = 0; a < 6; a++) {
          const ang = (a / 6) * U.TAU;
          l.fillRect(px + pw / 2 + Math.cos(ang) * r * 0.6 - 1, py + ph / 2 + Math.sin(ang) * r * 0.6 - 1, 2, 2);
        }
      } else {
        l.fillStyle = rimL;
        for (let gx = px + 8; gx < px + pw - 8; gx += 9) {
          for (let gy = py + 7; gy < py + ph - 10; gy += 11) {
            l.fillRect(gx, gy, 2, R(4, 8));
            if (R() < 0.6) l.fillRect(gx - 2, gy + R(0, 5), 6, 2);
          }
        }
      }
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) used[y * C + x] = 2;
      k++;
    }
    // pipes along under ceilings, on brackets
    for (let k = 0, tries = 0; k < area / 220 && tries < 600; tries++) {
      const x0 = Math.floor(R() * C);
      const y = 1 + Math.floor(R() * (Rows - 2));
      if (solid(x0, y) || !solid(x0, y - 1) || used[y * C + x0] || tun(x0, y)) continue;
      let x1 = x0;
      while (x1 + 1 < C && !solid(x1 + 1, y) && solid(x1 + 1, y - 1)) x1++;
      if (x1 - x0 < 4) continue;
      const w = R() < 0.5 ? 7 : 4.5;
      const py = y * cell + 2;
      l.fillStyle = metalD;
      l.fillRect(x0 * cell, py, (x1 - x0 + 1) * cell, w);
      l.fillStyle = metal;
      l.fillRect(x0 * cell, py + w - 1.2, (x1 - x0 + 1) * cell, 1.2);
      l.fillStyle = metalL;
      for (let x = x0 * cell + R(6, 20); x < (x1 + 1) * cell; x += R(30, 60)) l.fillRect(x, y * cell, 2, w + 3); // brackets
      // a leak, now and then: a broken end hanging down
      if (R() < 0.4) {
        l.fillStyle = rust;
        l.fillRect((x1 + 1) * cell - 3, py, 3, w + R(4, 10));
      }
      for (let x = x0; x <= x1; x++) used[y * C + x] = 1;
      k++;
    }
    // girders bracing inside corners (floor to wall, ceiling to wall)
    const brace = (ax, ay, bx, by) => {
      l.strokeStyle = metal;
      l.lineWidth = 2.5;
      l.beginPath();
      l.moveTo(ax, ay);
      l.lineTo(bx, by);
      l.stroke();
      // a lattice: little crossbars along it
      l.strokeStyle = metalD;
      l.lineWidth = 1.2;
      const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 8));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = U.lerp(ax, bx, t);
        const y = U.lerp(ay, by, t);
        l.beginPath();
        l.moveTo(x - (by - ay) / n / 2, y + (bx - ax) / n / 2);
        l.lineTo(x + (by - ay) / n / 2, y - (bx - ax) / n / 2);
        l.stroke();
      }
    };
    for (let y = 1; y < Rows - 1; y++) {
      for (let x = 1; x < C - 1; x++) {
        if (solid(x, y) || tun(x, y)) continue;
        for (const s of [-1, 1]) {
          if (!solid(x + s, y)) continue;
          const wallX = s > 0 ? (x + 1) * cell : x * cell;
          // floor corner
          if (solid(x, y + 1) && !solid(x, y - 1) && !solid(x - s, y) && R() < 0.07) brace(wallX, (y - 1) * cell + R(0, 8), wallX - s * R(1.4, 2.2) * cell, (y + 1) * cell);
          // ceiling corner
          if (solid(x, y - 1) && !solid(x, y + 1) && R() < 0.06) brace(wallX, (y + 1.5) * cell, wallX - s * R(1.4, 2.4) * cell, y * cell);
        }
      }
    }
    // grates, vents, glyph panels and machine boxes set into rock faces
    for (let k = 0, tries = 0; k < area / 110 && tries < 900; tries++) {
      const x = Math.floor(R() * C);
      const y = Math.floor(R() * Rows);
      if (!solid(x, y)) continue;
      // a face: rock here, open air beside (left, right or below)
      const face = !solid(x - 1, y) ? 'l' : !solid(x + 1, y) ? 'r' : !solid(x, y + 1) ? 'b' : !solid(x, y - 1) ? 't' : null;
      if (!face || face === 't') continue;
      // (one or two cells across, standing a few px proud of the face, so
      // the rock's outline isn't a clean line)
      const big = R() < 0.4 && (face === 'b' ? solid(x + 1, y) && !solid(x + 1, y + 1) : solid(x, y + 1) && (face === 'l' ? !solid(x - 1, y + 1) : !solid(x + 1, y + 1)));
      const proud = face === 'b' ? 0 : R(2, 5); // (under a ledge, flush: nothing hangs in mid-air)
      const bx = x * cell + 2 + (face === 'l' ? -proud : face === 'r' ? proud : 0);
      const by = y * cell + 2 + (face === 'b' ? proud : 0);
      const w = (big && face === 'b' ? 2 * cell : cell) - 4;
      const h = (big && face !== 'b' ? 2 * cell : cell) - 4;
      const kind = R();
      l.fillStyle = metalD;
      l.fillRect(bx, by, w, h);
      if (kind < 0.35) {
        // a grate: slats in a rim
        l.fillStyle = U.rgba(U.mix(pal.mass, '#000000', 0.4));
        for (let i = 2; i < w - 1; i += 3) l.fillRect(bx + i, by + 2, 1.5, h - 4);
        l.strokeStyle = metal;
        l.lineWidth = 1.5;
        l.strokeRect(bx, by, w, h);
      } else if (kind < 0.6 && face !== 'b') {
        // a round vent
        l.fillStyle = U.rgba(U.mix(pal.mass, '#000000', 0.45));
        l.beginPath();
        l.arc(bx + w / 2, by + h / 2, w * 0.35, 0, U.TAU);
        l.fill();
        l.strokeStyle = metalL;
        l.lineWidth = 1;
        l.beginPath();
        l.moveTo(bx + w / 2 - w * 0.35, by + h / 2);
        l.lineTo(bx + w / 2 + w * 0.35, by + h / 2);
        l.stroke();
      } else if (kind < 0.8) {
        // a panel of old glyphs
        l.fillStyle = metalL;
        for (let i = 0; i < 3; i++) {
          const gx = bx + 2 + i * 4;
          l.fillRect(gx, by + 3, 1.5, R(3, 8));
          if (R() < 0.6) l.fillRect(gx - 1, by + 3 + R(0, 6), 3, 1.5);
        }
      } else {
        // a machine box with a bolted rim and a dead lamp
        l.fillStyle = metal;
        l.fillRect(bx, by, w, 2);
        l.fillRect(bx, by + h - 2, w, 2);
        l.fillStyle = rust;
        l.fillRect(bx + w - 5, by + 5, 3, 3);
      }
    }
    // rebar poking out of broken edges
    l.strokeStyle = rust;
    l.lineWidth = 1.2;
    for (let y = 1; y < Rows - 1; y++) {
      for (let x = 1; x < C - 1; x++) {
        if (!solid(x, y) || R() > 0.035) continue;
        const dirs = [];
        if (!solid(x, y + 1)) dirs.push([0, 1]);
        if (!solid(x - 1, y)) dirs.push([-1, 0]);
        if (!solid(x + 1, y)) dirs.push([1, 0]);
        if (!dirs.length) continue;
        const [dx, dy] = dirs[Math.floor(R() * dirs.length)];
        const ox = (x + 0.5 + dx * 0.5) * cell + (dy ? R(-7, 7) : 0);
        const oy = (y + 0.5 + dy * 0.5) * cell + (dx ? R(-7, 7) : 0);
        for (let i = 0; i < 1 + Math.floor(R() * 3); i++) {
          const len = R(4, 12);
          const a = Math.atan2(dy, dx) + R(-0.6, 0.6);
          l.beginPath();
          l.moveTo(ox + i * 3 * Math.abs(dy), oy + i * 3 * Math.abs(dx));
          l.lineTo(ox + i * 3 * Math.abs(dy) + Math.cos(a) * len, oy + i * 3 * Math.abs(dx) + Math.sin(a) * len);
          l.stroke();
        }
      }
    }
    // catwalk railings along the edges of ledge tops: posts and a rail,
    // some broken off short, some bent
    for (let y = 1; y < Rows - 1; y++) {
      for (let x = 1; x < C - 1; x++) {
        // the open end of a floor: rock below, a drop beside
        if (solid(x, y) || !solid(x, y + 1) || tun(x, y)) continue;
        const s = !solid(x + 1, y) && !solid(x + 1, y + 1) ? 1 : !solid(x - 1, y) && !solid(x - 1, y + 1) ? -1 : 0;
        if (!s || R() > 0.45) continue;
        let x0 = x;
        let n = 0;
        while (n < 4 && !solid(x0 - s, y) && solid(x0 - s, y + 1)) {
          x0 -= s;
          n++;
        }
        const gy = (y + 1) * cell;
        const a = Math.min(x, x0) * cell + 2;
        const b = (Math.max(x, x0) + 1) * cell - 2;
        const h = R(9, 13);
        l.fillStyle = metal;
        for (let px = a; px <= b; px += R(9, 14)) l.fillRect(px, gy - (R() < 0.15 ? h * 0.5 : h), 1.6, R() < 0.15 ? h * 0.5 : h);
        l.fillRect(a, gy - h, b - a, 1.6);
        if (R() < 0.5) l.fillRect(a, gy - h * 0.55, b - a, 1.2);
        // the end at the drop: a bent post leaning out
        if (R() < 0.4) {
          l.strokeStyle = metal;
          l.lineWidth = 1.6;
          const ex = s > 0 ? b : a;
          l.beginPath();
          l.moveTo(ex, gy);
          l.lineTo(ex + s * R(4, 9), gy - h * R(0.7, 1.1));
          l.stroke();
        }
      }
    }
    // rubble in floor corners: broken slabs, a pipe end, bits
    for (let y = 1; y < Rows - 1; y++) {
      for (let x = 1; x < C - 1; x++) {
        if (solid(x, y) || !solid(x, y + 1) || tun(x, y)) continue;
        const corner = solid(x - 1, y) || solid(x + 1, y);
        if (R() > (corner ? 0.4 : 0.05)) continue;
        const gy = (y + 1) * cell;
        const toWall = solid(x - 1, y) ? -1 : 1;
        let px = x * cell + (toWall < 0 ? 0 : cell * 0.3);
        for (let i = 0; i < 3 + Math.floor(R() * 5); i++) {
          const w = R(4, 12);
          const h = R(3, corner ? 11 : 7);
          l.fillStyle = [metalD, U.rgba(U.mix(pal.mass, pal.light, 0.12)), rust][Math.floor(R() * 3)];
          l.fillRect(px, gy - h, w, h);
          px += w * R(0.4, 0.9);
        }
      }
    }
  }

  RW.Rooms = { REGIONS, generate, paintBackdrop, paintShade, paintPits, paintPassages, paintMass, paintAccents, paintWaterPlants, paintJunk, paintBiolum, paintProps, palette: (region) => (REGIONS[region] || REGIONS.outskirts).pal };
})();
