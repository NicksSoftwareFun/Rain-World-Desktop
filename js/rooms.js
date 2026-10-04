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
  function furnish(g, R, f) {
    const usedCols = new Set(f.poles.map((p) => p.cx));
    const vertical = () => f.poles.filter((p) => !p.stub).length;
    const want = 8 + Math.floor(R() * 5);
    // in bundles of 2-4, 1-2 cells apart, with 6-10 open cells between bundles
    const centres = [];
    for (let x = 3 + Math.floor(R() * 6); x < g.C - 3; x += 8 + Math.floor(R() * 8)) centres.push(x);
    for (let tries = 0; tries < 400 && vertical() < want; tries++) {
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
    const bars = 2 + Math.floor(R() * 2);
    for (let tries = 0; tries < 200 && f.beams.length < bars; tries++) {
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
    const nDen = 3 + Math.floor(R() * 4);
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
    const nF = Math.round(3 + R() * 3);
    for (let i = 0; i < nF && ceilings.length; i++) {
      const c = ceilings[Math.floor(R() * ceilings.length)];
      fruitPlants.push({ x: Math.round((c.x + 0.5) * cell), y: c.y * cell, len: U.lerp(26, 50, R()) });
    }
    const grass = [];
    for (const p of plats) if (p.x1 - p.x0 >= 2 && R() < 0.5 && !(f.waterCells && f.waterCells.has(p.y * g.C + p.x0)) && !tun(p.x0, p.y)) grass.push({ x: Math.round((U.lerp(p.x0, p.x1, R()) + 0.5) * cell), y: (p.y + 1) * cell, h: U.lerp(20, 34, R()), phase: R() * 10 });
    const roomy = ceilings.filter((c) => !g.solid(c.x, c.y + 3) && !g.solid(c.x - 1, c.y) && !g.solid(c.x + 1, c.y) && !(f.waterCells && f.waterCells.has((c.y + 3) * g.C + c.x)));
    const nests = [];
    if (roomy.length) {
      const c = roomy[Math.floor(R() * roomy.length)];
      nests.push({ x: Math.round((c.x + 0.5) * cell), y: c.y * cell });
    } else nests.push({ x: Math.round(W / 2), y: 0 });
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
  const CHECK_CAPS = { walls: false, ceil: false, poles: true, fall: true, jumpX: 3, jumpUp: 2, leapPoles: true, wallCost: 1.3 };
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
    const p = RW.Nav.findPath(w, from.x, from.y - 4, to.x, to.y - 4, CHECK_CAPS, 8000);
    return !!(p && p.complete);
  }
  function check(decor, W, H, cell) {
    const pipes = decor.dens.filter((d) => !d.sky);
    if (pipes.length < 2) return { ok: false, w: null };
    const w = scratchWorld(decor, W, H, cell);
    const d0 = pipes[0];
    const bad = pipes.filter((d, i) => i > 0 && !(reach(w, d0, d) && reach(w, d, d0)));
    return { ok: !bad.length, bad, w };
  }
  // Ladders from unreachable platforms down to the floor beneath them.
  function addLadders(g, f, decor, W, H, cell) {
    const w = scratchWorld(decor, W, H, cell);
    const d0 = decor.dens.find((d) => !d.sky);
    if (!d0) return 0; // (no dens at all: nothing to connect; the map is re-rolled)
    let added = 0;
    for (const p of platforms(g)) {
      if (p.x1 - p.x0 < 1 || added > 6) continue;
      const mid = { x: ((p.x0 + p.x1) / 2 + 0.5) * cell, y: (p.y + 1) * cell };
      if (reach(w, d0, mid) && reach(w, mid, d0)) continue;
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
    for (let tries = 0; tries < 12; tries++) {
      const R = U.mulberry32((rnd() * 4294967296) >>> 0);
      const g = new Grid(C, Rows);
      const arch = REGIONS[region].archetypes[Math.floor(R() * REGIONS[region].archetypes.length)];
      const f = { poles: [], beams: [], blocks: [], pits: [], arch, region, style: STYLE[region] };
      const info = ARCHETYPES[arch](g, R, f);
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
      furnish(g, R, f);
      closeSlits(g);
      carvePassages(g, R, f);
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
      for (let round = 0; !res.ok && round < 3; round++) {
        if (!addLadders(g, f, decor, W, H, cell)) break;
        const dens = decor.dens;
        decor = buildDecor(g, f, cell, W, H, region, U.mulberry32(7));
        decor.dens = dens; // (keep the same dens)
        res = check(decor, W, H, cell);
      }
      decor.tries = tries + 1;
      decor.ok = res.ok;
      if (res.ok) return decor;
      if (!best) best = decor;
    }
    // nothing passed: the first one, with just the dens that connect
    return best;
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
    for (let y = 0; y < Rows; y++) {
      for (let x = 0; x < C; x++) {
        const d = dist[y * C + x];
        const t = d < 0 ? 0 : Math.pow(U.clamp(1 - d / 14, 0, 1), 1.3);
        lx.fillStyle = U.rgba(U.mix(pal.interior, pal.sky, t));
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
  function paintAccents(l, decor, pal, R0) {
    const R = either(R0);
    const room = decor.room;
    const { C, cell, cells } = room;
    const Rows = room.R;
    const solid = (x, y) => (x < 0 || x >= C || y < 0 || y >= Rows ? true : cells[y * C + x] === 1);
    const acc = pal.accent;
    const region = decor.region;
    const vine = (x, y, len, col, w) => {
      l.strokeStyle = col;
      l.lineWidth = w;
      l.beginPath();
      l.moveTo(x, y);
      let vx = x;
      for (let k = 0; k < len; k += 3) {
        vx += Math.sin(k * 0.3 + x) * 0.8;
        if (solid(Math.floor(vx / cell), Math.floor((y + k) / cell))) break;
        l.lineTo(vx, y + k);
      }
      l.stroke();
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
        l.strokeStyle = accCol;
        l.lineWidth = region === 'industrial' ? 3 : 1.4;
        if (region === 'industrial') {
          // coral: a branching fan, 3-5 cells tall
          const nb = 5 + Math.floor(R() * 5);
          for (let k = 0; k < nb; k++) {
            const a = -Math.PI / 2 + (k - (nb - 1) / 2) * 0.24;
            const len = R(1.5, 2.5) * cell;
            l.beginPath();
            l.moveTo(bx, by);
            l.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len);
            l.lineTo(bx + Math.cos(a + 0.4) * len * 1.4, by + Math.sin(a + 0.4) * len * 1.4);
            l.stroke();
          }
        } else {
          for (let k = 0; k < 9; k++) {
            l.beginPath();
            l.moveTo(bx + k * 2 - 8, by);
            l.lineTo(bx + k * 2 - 8 + R(-4, 4), by - R(6, 22));
            l.stroke();
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

  RW.Rooms = { REGIONS, generate, paintBackdrop, paintShade, paintPits, paintPassages, paintMass, paintAccents, palette: (region) => (REGIONS[region] || REGIONS.outskirts).pal };
})();
