// Passing clouds. Over a surface map's open sky they drift by in two layers
// (far ones slow and hazy, near ones faster), and over every room open to
// the sky their shadows sweep across whatever the sun reaches: the beams of
// light dim and flare and the lit rock and creatures darken in passing.
// Strongest in the clear morning; as the rain clouds close in the sky goes
// overcast, the shadows merge into one, and it fades out.
//
// The clouds are a tileable fractal noise field (value noise, five
// octaves, stretched wide), cut off at a cover level with a soft edge and
// lit from above by how much cloud lies over each pixel (thin tops bright,
// thick bellies grey), then snapped to a few dithered levels so they sit
// with the pixel art. The shadow on the ground is the same field summed
// down each column, slanted along the sun's beams.
//
//   const sky = new RW.Sky(); sky.build(bgCanvas, decor, pal, W);
//   sky.update(dt, phase, intensity); sky.drawClouds(ctx); ... sky.drawShade(ctx);
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

  // Value noise, periodic across x (period px lattice cells), smooth.
  function makeNoise(seed) {
    const R = U.mulberry32(seed >>> 0);
    const T = new Float32Array(4096);
    for (let i = 0; i < T.length; i++) T[i] = R();
    const h = (x, y) => T[((x * 73856093) ^ (y * 19349663)) & 4095];
    return (x, y, period) => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = x - xi;
      const fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const x0 = ((xi % period) + period) % period;
      const x1 = (x0 + 1) % period;
      const a = U.lerp(h(x0, yi), h(x1, yi), sx);
      const b = U.lerp(h(x0, yi + 1), h(x1, yi + 1), sx);
      return U.lerp(a, b, sy);
    };
  }

  // A cloud field w x h (tiling across x): density 0..1 per pixel.
  function field(w, h, seed, opts) {
    const n = makeNoise(seed);
    const d = new Float32Array(w * h);
    const cells = opts.cells; // lattice cells across the width (big shapes)
    const stretch = opts.stretch; // wider than tall
    for (let y = 0; y < h; y++) {
      const v = y / h;
      // a band where they gather, thinning to nothing at its edges
      const band = 1 - Math.pow(Math.abs(v - opts.band) / opts.spread, 2);
      for (let x = 0; x < w; x++) {
        let s = 0;
        let amp = 0.5;
        let f = 1;
        for (let o = 0; o < 5; o++) {
          const per = cells * f;
          s += amp * n((x / w) * per, (y / w) * per * stretch + o * 17.3, per);
          amp *= 0.5;
          f *= 2;
        }
        d[y * w + x] = s + 0.3 * band;
      }
    }
    // cut at the level that leaves `cover` of the sky clouded, with a soft
    // edge (a fraction of the field's own spread)
    const sample = [];
    for (let i = 0; i < d.length; i += 7) sample.push(d[i]);
    sample.sort((a, b) => a - b);
    const q = (f) => sample[Math.min(sample.length - 1, Math.floor(f * sample.length))];
    const t = q(1 - opts.cover);
    const soft = Math.max(1e-3, (q(0.95) - q(0.05)) * 0.1);
    for (let i = 0; i < d.length; i++) d[i] = U.clamp((d[i] - t) / soft, 0, 1);
    return d;
  }

  // Lit from above, dithered to a few levels, into a canvas.
  function paint(d, w, h, lit, dark, alpha, haze, hazeK) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const o = img.data;
    const L = U.hex(lit);
    const D = U.hex(dark);
    const Hz = U.hex(haze);
    for (let x = 0; x < w; x++) {
      let depth = 0;
      for (let y = 0; y < h; y++) {
        const i = y * w + x;
        const a = d[i];
        if (a > 0) {
          const th = BAYER[(y & 3) * 4 + (x & 3)];
          // the light left after the cloud above it: tops bright, bellies grey
          const b = Math.exp(-depth * 0.03);
          const lv = Math.floor(b * 6 + th) / 6; // (six tones)
          const av = Math.floor(a * 3 + th) / 3; // (three steps of edge)
          if (av > 0) {
            const k = 4 * i;
            for (let ch = 0; ch < 3; ch++) o[k + ch] = U.lerp(U.lerp(D[ch], L[ch], lv), Hz[ch], hazeK);
            o[k + 3] = 255 * alpha * av;
          }
        }
        depth += a;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  class Sky {
    constructor() {
      this.ok = false;
    }

    // canvas: the painted background (art pixels); W: the world's width.
    build(canvas, decor, pal, W) {
      this.ok = false;
      const room = decor && decor.room;
      if (!room || !room.lightDist) return;
      const aw = canvas.width;
      const ah = canvas.height;
      const k = aw / W;
      this.k = k;
      this.aw = aw;
      this.ah = ah;
      this.pal = pal;
      const seed = (room.C * 7919 + room.R * 104729 + (decor.dens || []).length * 31) >>> 0;
      const cover = decor.cloudCover || 0.3; // (the share of the sky clouded)
      // the near field, two screens wide (it wraps as it drifts)
      const fw = aw * 2;
      const skyH = decor.under && room.surf ? Math.ceil(room.underTop * room.cell * k) : 0;
      const fh = Math.max(24, skyH || Math.round(ah * 0.3));
      const near = field(fw, fh, seed, { cells: 6, stretch: 2.6, cover, band: 0.35, spread: 0.6 });
      this.fw = fw;
      // the shadow it casts: cloud summed down each column
      this.cover = new Float32Array(fw);
      for (let x = 0; x < fw; x++) {
        let s = 0;
        for (let y = 0; y < fh; y++) s += near[y * fw + x];
        this.cover[x] = U.clamp(s / (fh * 0.12), 0, 1);
      }
      // the clouds themselves, only where the sky shows (a surface map's)
      this.layers = [];
      if (decor.skyMask && skyH > 0) {
        const lit = U.mix(pal.light, '#ffffff', 0.35);
        const dark = U.mix(U.mix(pal.sky, pal.mass, 0.22), pal.fog, 0.25);
        const farF = field(fw, fh, seed + 99, { cells: 9, stretch: 3.4, cover: cover - 0.06, band: 0.6, spread: 0.45 });
        this.layers.push({ img: paint(farF, fw, fh, lit, dark, 0.5, pal.fog, 0.45), speed: 1.6, x: 0 });
        this.layers.push({ img: paint(near, fw, fh, lit, dark, 0.85, pal.fog, 0.15), speed: 4.5, x: 0 });
        // where the sky shows: the painted sky, less whatever stands in
        // front of it (the play layer: ground, ruins, poles)
        const m = document.createElement('canvas');
        m.width = aw;
        m.height = ah;
        const mg = m.getContext('2d');
        mg.drawImage(decor.skyMask, 0, 0);
        if (canvas._bg && canvas._bg.play) {
          mg.globalCompositeOperation = 'destination-out';
          mg.drawImage(canvas._bg.play, 0, 0);
        }
        this.mask = m;
        this.cloudCv = document.createElement('canvas');
        this.cloudCv.width = aw;
        this.cloudCv.height = skyH;
        this.skyH = skyH;
      }
      // where the sun reaches (the room's light map: bright by the
      // openings, nothing deep inside): the shadows only fall there
      const { C, cells } = room;
      const Rows = room.R;
      const lm = document.createElement('canvas');
      lm.width = C;
      lm.height = Rows;
      const lg = lm.getContext('2d');
      const li = lg.createImageData(C, Rows);
      const sunAt = (i) => {
        const dd = room.lightDist[i];
        return dd < 0 ? 0 : Math.pow(U.clamp(1 - dd / 12, 0, 1), 1.4);
      };
      for (let i = 0; i < C * Rows; i++) {
        let t = sunAt(i);
        // (rock: as lit as the open air beside it, its sunlit faces)
        if (cells[i] === 1) {
          const x = i % C;
          if (x > 0) t = Math.max(t, sunAt(i - 1));
          if (x < C - 1) t = Math.max(t, sunAt(i + 1));
          if (i >= C) t = Math.max(t, sunAt(i - C));
        }
        li.data[i * 4 + 3] = 255 * t;
      }
      lg.putImageData(li, 0, 0);
      const sm = document.createElement('canvas');
      sm.width = aw;
      sm.height = ah;
      const sg = sm.getContext('2d');
      sg.imageSmoothingEnabled = true;
      sg.drawImage(lm, 0, 0, C * room.cell * k, Rows * room.cell * k);
      this.sun = sm;
      this.slant = decor.beamSlant || 0.25;
      // the moving shade and the sunlit gaps: rebuilt a few times a second
      this.strip = document.createElement('canvas');
      this.strip.width = Math.ceil((aw + Math.abs(this.slant) * ah) / 2) + 4;
      this.strip.height = 1;
      this.shade = document.createElement('canvas');
      this.shade.width = aw;
      this.shade.height = ah;
      this.glint = document.createElement('canvas');
      this.glint.width = aw;
      this.glint.height = ah;
      this.off = 0;
      this.last = -1;
      this.strength = 0;
      this.ok = true;
    }

    // phase: the rain cycle (0 dawn .. 1 the downpour's end); intensity:
    // the rain (0..1). Sunny mornings: strong; overcast: none.
    update(dt, phase, intensity) {
      if (!this.ok) return;
      const overcast = U.clamp((phase - 0.35) / 0.45 + intensity * 0.8, 0, 1);
      this.overcast = overcast;
      this.strength = Math.pow(1 - overcast, 1.3);
      const wind = 1 + intensity * 1.5;
      for (const l of this.layers) l.x = (l.x + dt * l.speed * wind) % this.fw;
      this.off = (this.off + dt * 4.5 * wind) % this.fw;
      const key = Math.floor(this.off) + ':' + Math.round(this.strength * 40);
      if (key !== this.last) {
        this.last = key;
        this.rebuild();
      }
    }

    rebuild() {
      const { aw, ah } = this;
      // the clouds, drifting (wrapped), masked to the open sky; greyer and
      // thicker as it clouds over
      if (this.layers.length) {
        const g = this.cloudCv.getContext('2d');
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, aw, this.skyH);
        for (const l of this.layers) {
          const x = -Math.floor(l.x);
          g.drawImage(l.img, x, 0);
          g.drawImage(l.img, x + this.fw, 0);
        }
        if (this.overcast > 0.02) {
          g.globalCompositeOperation = 'source-atop';
          g.fillStyle = U.rgba(U.mix(this.pal.rain, this.pal.mass, 0.55), 0.6 * this.overcast);
          g.fillRect(0, 0, aw, this.skyH);
        }
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(this.mask, 0, 0);
      }
      const s = this.strength;
      if (s < 0.02) return;
      // the shadow strip under the near clouds (half resolution)
      const st = this.strip;
      const sx = st.getContext('2d');
      const img = sx.createImageData(st.width, 1);
      const sh = new Float32Array(st.width);
      // (strip pixel i lands at x = 2i + e at the top of the screen: the
      // shadow of the cloud right above it)
      const e = this.e0();
      for (let i = 0; i < st.width; i++) sh[i] = this.cover[(((Math.floor(this.off) + i * 2 + e) % this.fw) + this.fw) % this.fw];
      // shade: darkness where cloud covers the sun
      for (let i = 0; i < st.width; i++) {
        img.data[i * 4] = 8;
        img.data[i * 4 + 1] = 10;
        img.data[i * 4 + 2] = 16;
        img.data[i * 4 + 3] = 255 * U.clamp(sh[i] * 0.42 * s, 0, 1);
      }
      sx.putImageData(img, 0, 0);
      this.paintSlanted(this.shade);
      // glint: the gaps where the sun breaks through, brighter
      const L = U.hex(this.pal.light);
      for (let i = 0; i < st.width; i++) {
        img.data[i * 4] = L[0];
        img.data[i * 4 + 1] = L[1];
        img.data[i * 4 + 2] = L[2];
        img.data[i * 4 + 3] = 255 * U.clamp(Math.pow(1 - sh[i], 2) * 0.22 * s, 0, 1);
      }
      sx.putImageData(img, 0, 0);
      this.paintSlanted(this.glint);
    }
    // The strip stretched down the screen along the sun's slant, then kept
    // only where the sun reaches.
    paintSlanted(cv) {
      const g = cv.getContext('2d');
      const { aw, ah } = this;
      g.globalCompositeOperation = 'source-over';
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, aw, ah);
      g.imageSmoothingEnabled = true;
      // x' = 2x + e + slant * y (y over the whole height)
      g.setTransform(2, 0, this.slant * ah, ah, this.e0(), 0);
      g.drawImage(this.strip, 0, 0);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(this.sun, 0, 0);
      g.globalCompositeOperation = 'source-over';
    }

    // (where the strip starts, so it covers the screen top to bottom
    // whichever way the beams lean)
    e0() {
      return -Math.round(Math.max(0, this.slant) * this.ah);
    }

    // Straight after the background (art pixels, untransformed).
    drawClouds(ctx) {
      if (!this.ok || !this.layers.length) return;
      ctx.drawImage(this.cloudCv, 0, 0);
    }
    // Over everything the sun lights (creatures and plants too), before
    // the water and the rain.
    drawShade(ctx) {
      if (!this.ok || this.strength < 0.02) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.shade, 0, 0);
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(this.glint, 0, 0);
      ctx.restore();
    }
  }

  RW.Sky = Sky;
})();
