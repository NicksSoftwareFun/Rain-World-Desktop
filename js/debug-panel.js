// Ecosystem panel (toggle with ` or the button): spawn weights, caps and
// world/rain/debug settings. Changes apply live and are saved to localStorage.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;

  // The world menu's line art (24x24): ruins under a cloud on the hub; a die
  // over the ruins (a new map) and over a lizard's open jaws (new wildlife).
  const RUINS =
    '<path d="M2.5 21.5h19"/><path d="M5 21.5v-9h3v9M4 12.5h5"/>' +
    '<path d="M8 14.2c1.7-2.6 4.4-3.5 6.6-2.7l-.7 1.2.9.8-.5.8"/>' +
    '<path d="M15.8 21.5v-6.4l1-.9.8.8 1.4-1.1v7.6"/><path d="M10.8 21.5v-1.7h2.5v1.7"/>';
  const CLOUD = '<path d="M7.6 8.6h8.9a2.4 2.4 0 0 0 .2-4.8 3.7 3.7 0 0 0-6.9-.9 2.9 2.9 0 0 0-2.2 5.7z"/>';
  const HEAD =
    '<path class="fill" d="M1.8 9.6C1.6 6.6 3.6 4.4 7 4.1L16.6 3.6C19.8 3.5 22.2 5 22.3 7.4L22.2 8.4 12.2 9.9 2.4 11.1Z"/>' +
    '<path class="fill" d="M2.8 12.6 12.2 11.6 20.6 15.2C19.1 17.1 15.9 17.8 12.6 17.3L5.2 16.2C3.5 15.8 2.6 14.4 2.8 12.6Z"/>' +
    '<circle class="hole" cx="7.2" cy="6.9" r="1.35"/>';
  const DIE =
    '<rect class="occ" x="12.5" y="12" width="10" height="10" rx="2.2"/>' +
    '<circle class="fill" cx="15.2" cy="14.7" r="0.95"/><circle class="fill" cx="17.5" cy="17" r="0.95"/><circle class="fill" cx="19.8" cy="19.3" r="0.95"/>';
  const WORLD_ICONS = {
    hub: CLOUD + RUINS,
    rollMap: '<g transform="translate(-1.4 -3.6) scale(.82)" style="stroke-width:1.85">' + RUINS + '</g>' + DIE,
    rollWild: '<g transform="translate(-0.9 0.6) scale(.86)">' + HEAD + '</g>' + DIE,
  };

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of kids) if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  }

  class Panel {
    constructor(engine, mount, opts) {
      opts = opts || {};
      this.engine = engine;
      this.mount = mount;
      this.cfg = engine.cfg;
      this.open = false;
      this.liveEls = [];
      this.noToggleButton = !!opts.noToggleButton;
      this.build();
      setInterval(() => this.refreshLive(), 400);
      window.addEventListener('keydown', (e) => {
        if (e.key === '`' || e.key === '~') this.toggle();
      });
    }

    toggle(force) {
      this.open = force === undefined ? !this.open : force;
      this.el.classList.toggle('open', this.open);
    }

    save() {
      RW.saveConfig(this.cfg);
      if (this.onSave) this.onSave(this.cfg);
    }

    // ---- controls ----------------------------------------------------------
    slider(label, obj, key, min, max, step, onChange) {
      const val = h('span', { class: 'val', text: String(obj[key]) });
      const input = h('input', { type: 'range', min, max, step, value: obj[key] });
      input.addEventListener('input', () => {
        obj[key] = +input.value;
        val.textContent = input.value;
        this.save();
        if (onChange) onChange();
      });
      return h('label', { class: 'row' }, h('span', { class: 'lbl', text: label }), input, val);
    }
    toggleCtl(label, obj, key, onChange) {
      const input = h('input', { type: 'checkbox' });
      input.checked = !!obj[key];
      input.addEventListener('change', () => {
        obj[key] = input.checked;
        this.save();
        if (onChange) onChange();
      });
      return h('label', { class: 'row chk' }, input, h('span', { text: label }));
    }
    select(label, obj, key, options, onChange) {
      const s = h('select');
      for (const o of options) {
        const opt = h('option', { value: o, text: o });
        if (String(obj[key]) === String(o)) opt.selected = true;
        s.appendChild(opt);
      }
      s.addEventListener('change', () => {
        obj[key] = isNaN(+s.value) ? s.value : +s.value;
        this.save();
        if (onChange) onChange();
      });
      return h('label', { class: 'row' }, h('span', { class: 'lbl', text: label }), s);
    }
    census() {
      const n = {};
      for (const c of this.engine.eco.creatures) {
        if (c.dead || c.corpse) continue;
        const k = c.species.startsWith('lizard') ? 'lizards' : c.species.startsWith('centipede') ? 'centipedes' : c.species.startsWith('noodlefly') ? 'noodleflies' : c.species === 'daddy' ? 'daddy' : c.species === 'batfly' ? 'batflies (free)' : c.species + 's';
        n[k] = (n[k] || 0) + 1;
      }
      return Object.entries(n)
        .map(([k, v]) => `${k} ${v}`)
        .join('  ');
    }
    button(text, fn, cls) {
      return h('button', { class: cls || '', onclick: fn, text });
    }

    // A section whose title opens and closes it (remembered per browser).
    section(title, ...kids) {
      const body = h('div', { class: 'sb' }, ...kids);
      const open = this.openSecs.has(title);
      const caret = h('span', { class: 'caret', text: open ? '\u25be' : '\u25b8' });
      const sec = h('div', { class: 'sec' + (open ? '' : ' collapsed') });
      const head = h('button', { class: 'st', type: 'button', 'aria-expanded': String(open) }, caret, h('span', { text: title }));
      head.addEventListener('click', () => {
        const now = sec.classList.toggle('collapsed');
        caret.textContent = now ? '\u25b8' : '\u25be';
        head.setAttribute('aria-expanded', String(!now));
        if (now) this.openSecs.delete(title);
        else this.openSecs.add(title);
        try {
          localStorage.setItem('rw-panel-open', JSON.stringify([...this.openSecs]));
        } catch (e) {
          /* storage blocked: sections just start closed */
        }
      });
      sec.appendChild(head);
      sec.appendChild(body);
      return sec;
    }

    // Size and wildlife presets: one pick sets everything they govern.
    presetPicker(label, presets, kind, apply) {
      const s = h('select', { 'aria-label': label + ' preset' });
      const cur = (this.cfg.presets || {})[kind] || 'custom';
      for (const k of Object.keys(presets).concat(['custom'])) {
        const opt = h('option', { value: k, text: k === 'custom' ? 'Custom' : presets[k].label });
        if (k === cur) opt.selected = true;
        s.appendChild(opt);
      }
      s.addEventListener('change', () => {
        if (s.value === 'custom') {
          this.cfg.presets[kind] = 'custom';
          this.save();
          return;
        }
        apply(s.value);
      });
      return h('label', { class: 'row' }, h('span', { class: 'lbl', text: label }), s);
    }
    // A hand-edited value a preset governs: the preset no longer describes it.
    custom(kind) {
      const p = (this.cfg.presets = this.cfg.presets || {});
      if (p[kind] === 'custom') return;
      p[kind] = 'custom';
      const sel = this.el.querySelector('select[aria-label="' + (kind === 'size' ? 'Size' : 'Wildlife') + ' preset"]');
      if (sel) sel.value = 'custom';
      if (this.noteEl && kind === 'wildlife') this.noteEl.textContent = '';
    }

    build() {
      this.el = h('div', { class: 'rw-panel' });
      this.mount.appendChild(this.el);
      if (!this.noToggleButton) {
        this.mount.appendChild(h('button', { class: 'rw-panel-toggle', title: 'Ecosystem panel (`)', onclick: () => this.toggle(), text: '\u2261' }));
      }
      this.openSecs = new Set();
      try {
        for (const t of JSON.parse(localStorage.getItem('rw-panel-open') || '[]')) this.openSecs.add(t);
      } catch (e) {
        /* storage blocked or corrupt: all sections start closed */
      }
      this.render();
      if (RW.RadialMenu) {
        this.buildRainMenu();
        this.buildWorldMenu();
      }
      // Tap a creature: its menu (kill, hungry, path, AI state); tap it
      // again, or press anywhere else, to close it.
      if (RW.CreatureMenu) {
        const menu = (this.creatureMenu = new RW.CreatureMenu(this.mount, this.engine));
        this.engine.onCreatureTap = (c) => menu.toggle(c);
        this.engine.onPress = (c) => {
          if (c !== menu.c) menu.close();
        };
      }
    }

    // The world menu, top left: ruins under a cloud, fanning out two
    // rerolls (a new map, a new wildlife mix) and the size (a RadialMenu,
    // like the rain one). Each reroll puts the map's and wildlife's names
    // along the top for a few seconds.
    buildWorldMenu() {
      const eng = this.engine;
      const cfg = this.cfg;
      const Wc = cfg.world;
      const hub = h('button', { class: 'rw-world', type: 'button', title: 'World: a new map, new wildlife, size' });
      hub.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + WORLD_ICONS.hub + '</svg>';
      // (every change goes through here: saved, and the side panel redrawn
      // to match)
      const done = () => {
        this.save();
        this.render();
      };
      const rollMap = () => {
        if (Wc.layout !== 'experimental') {
          // (rooms are the default now; an old ledges setting moves over)
          Wc.layout = 'experimental';
          eng.regenerate(true);
          eng.restartWildlife();
        } else eng.regenerate(true);
        done();
        this.showBanner();
      };
      const rollWildlife = () => {
        const now = (cfg.presets || {}).wildlife;
        const names = Object.keys(RW.WILDLIFE_PRESETS).filter((k) => k !== now);
        const name = names[Math.floor(Math.random() * names.length)];
        const before = Wc.mapSize;
        RW.applyWildlifePreset(cfg, name);
        if (Wc.mapSize !== before) eng.regenerate(false);
        eng.restartWildlife();
        done();
        this.showBanner();
      };
      const size = (name, icon, ring) => ({
        type: 'toggle', ring, label: RW.SIZE_PRESETS[name].label.toLowerCase(), icon, title: RW.SIZE_PRESETS[name].label + ' size',
        get: () => (cfg.presets || {}).size === name,
        set: () => {
          if ((cfg.presets || {}).size === name) return;
          // (as the panel's size picker, but keeping the world type)
          const keep = { layout: Wc.layout, region: Wc.region };
          RW.resetWorldAndRain(cfg);
          Object.assign(Wc, keep);
          RW.applySizePreset(cfg, name);
          eng.regenerate(false);
          done();
        },
      });
      this.worldMenu = new RW.RadialMenu(this.mount, {
        corner: 'top-left',
        hub,
        hubSize: 52,
        margin: 16,
        title: 'World',
        items: [
          { type: 'action', ring: 0, label: 'new map', svg: WORLD_ICONS.rollMap, title: 'Roll a new map', run: rollMap },
          { type: 'action', ring: 0, label: 'wildlife', svg: WORLD_ICONS.rollWild, title: 'Roll a new wildlife mix', run: rollWildlife },
          size('compact', 'S', 1),
          size('normal', 'M', 1),
          size('large', 'L', 1),
          size('xl', 'XL', 1),
        ],
      });
    }

    // "Outskirts Bunker - Lizard Turf Wars" along the top: shown at full
    // strength, fading after a few seconds (a new reroll starts it over).
    showBanner() {
      const eng = this.engine;
      const d = eng.decor || {};
      const reg = d.region && RW.Rooms && RW.Rooms.REGIONS[d.region];
      const where = reg ? reg.label + (d.under ? ' Surface' : ' Bunker') : 'Ledges';
      const wp = RW.WILDLIFE_PRESETS[(this.cfg.presets || {}).wildlife];
      const titled = (t) => t.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
      const text = where + ' - ' + (wp ? titled(wp.label) : 'Custom Wildlife');
      if (!this.banner) {
        this.banner = h('div', { class: 'rw-banner', role: 'status' });
        this.bannerCv = document.createElement('canvas');
        this.banner.appendChild(this.bannerCv);
        this.mount.appendChild(this.banner);
      }
      const b = this.banner;
      b.setAttribute('aria-label', text);
      // Drawn small and scaled up, every letter hard-edged: chunky pixels
      // like the labels drawn in the game. (Scaled by the screen, not the
      // map's pixel size, which shrinks on large and XL maps: the same size
      // on the screen whatever the map.)
      const ps = Math.max(2, Math.round(window.innerHeight / 360));
      const cv = this.bannerCv;
      const c = cv.getContext('2d');
      const font = '11px "Cascadia Mono", Consolas, monospace';
      c.font = font;
      // (letter by letter, each on a whole pixel with one more between: run
      // together at this size, some pairs merged into one blob)
      const adv = c.measureText('M').width;
      const step = Math.round(adv) + 1;
      const w = step * text.length + 2;
      const hgt = 15;
      cv.width = w;
      cv.height = hgt;
      cv.style.width = w * ps + 'px';
      cv.style.height = hgt * ps + 'px';
      c.font = font;
      c.textBaseline = 'middle';
      c.fillStyle = '#e8e2c8';
      for (let i = 0; i < text.length; i++) c.fillText(text[i], 1 + i * step, hgt / 2 + 0.5);
      const img = c.getImageData(0, 0, w, hgt);
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 100 ? 255 : 0;
      c.putImageData(img, 0, 0);
      b.classList.add('show');
      clearTimeout(this.bannerT);
      this.bannerT = setTimeout(() => b.classList.remove('show'), 3500);
    }

    // The rain cycle timer, bottom left: a ring of pips emptying toward the
    // downpour and the time left in the middle. Clicking it fans the rain
    // settings out round the corner (a RadialMenu).
    buildRainMenu() {
      const eng = this.engine;
      const R = this.cfg.rain;
      const hub = h('button', { class: 'rw-cycle', type: 'button', title: 'Rain cycle: click for the rain settings' });
      const cv = document.createElement('canvas');
      hub.appendChild(cv);
      const cycle = () => Math.max(0.5, R.cycleMinutes) * 60;
      this.rainMenu = new RW.RadialMenu(this.mount, {
        corner: 'bottom-left',
        hub,
        title: 'Rain cycle',
        onChange: () => this.save(),
        items: [
          // a fresh cycle and the downpour on the inner ring, where the cycle
          // is now on the diagonal past them, the dials outside
          { type: 'action', label: 'clear', icon: '\u2600', title: 'Clear skies: start a fresh cycle', run: () => {
            eng.weather.t = Math.ceil(eng.weather.t / cycle()) * cycle() + 1;
          } },
          { type: 'action', label: 'downpour', icon: '\u21ca', title: 'Bring the downpour on now', run: () => {
            const w = eng.weather;
            w.t = Math.floor(w.t / cycle()) * cycle() + cycle() * (1 - R.downpourFraction * 0.95);
          } },
          // where the cycle is now, out of its full length: click to step on
          // to the next stage (calm, light rain, build-up, downpour)
          { type: 'action', label: 'now', title: 'Where the rain cycle is, out of its full length (click: on to the next stage)', icon: () => {
            const w = eng.weather;
            const total = cycle();
            const now = w ? (w.t % total) : 0;
            const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
            return mmss(now) + '/' + mmss(total);
          }, run: () => {
            const w = eng.weather;
            const total = cycle();
            const ph = (w.t % total) / total;
            const stops = [0.25, 0.42, 1 - R.downpourFraction - 0.3, 1 - R.downpourFraction * 0.95, 1.001];
            const next = stops.find((q) => q > ph + 0.01);
            w.t = Math.floor(w.t / total) * total + next * total;
          } },
          { type: 'dial', label: 'cycle', title: 'Length of one rain cycle (minutes)', min: 1, max: 30, step: 0.5, get: () => R.cycleMinutes, set: (v) => (R.cycleMinutes = v), format: (v) => v + 'm' },
          // (while it's being turned, a dotted line marks the height on the map)
          { type: 'dial', label: 'flood', title: 'How high the water rises in the downpour (each new map picks 40-80%)', min: 0, max: 0.95, step: 0.05, get: () => R.floodHeight ?? 0.75, set: (v) => (R.floodHeight = v), format: (v) => Math.round(v * 100) + '%', onDrag: () => (eng.floodPreviewUntil = performance.now() + 1500) },
        ],
      });
      eng.domHud = true; // (the engine no longer draws its own on the canvas)
      const draw = () => {
        requestAnimationFrame(draw);
        hub.style.display = R.showCycleHud === false ? 'none' : '';
        const dpr = window.devicePixelRatio || 1;
        const s = hub.clientWidth || 72;
        if (cv.width !== Math.round(s * dpr)) {
          cv.width = cv.height = Math.round(s * dpr);
          cv.style.width = cv.style.height = s + 'px';
        }
        const w = eng.weather;
        if (!w) return;
        const c = cv.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, s, s);
        const pips = 16;
        const left = R.enabled ? Math.ceil((1 - w.phase) * pips) : pips;
        const r = s * 0.36;
        for (let i = 0; i < pips; i++) {
          const a = -Math.PI / 2 + (i / pips) * Math.PI * 2;
          c.fillStyle = i < left ? (w.downpour ? '#9fc7e8' : '#e8e2c8') : 'rgba(232,226,200,0.18)';
          c.fillRect(Math.round(s / 2 + Math.cos(a) * r) - 2.5, Math.round(s / 2 + Math.sin(a) * r) - 2.5, 5, 5);
        }
        c.fillStyle = w.downpour ? '#9fc7e8' : '#e8e2c8';
        c.font = '600 11px "Cascadia Mono", Consolas, monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        let txt = 'off';
        if (R.enabled) {
          const secs = w.downpour ? 0 : Math.max(0, w.toDownpour);
          txt = w.downpour ? 'RAIN' : Math.floor(secs / 60) + ':' + String(Math.floor(secs % 60)).padStart(2, '0');
        }
        c.fillText(txt, s / 2, s / 2 + 0.5);
      };
      draw();
    }

    // (Re)draw the panel's contents from the config, e.g. after a preset.
    render() {
      const cfg = this.cfg;
      const eng = this.engine;
      const scroll = this.el.scrollTop;
      this.el.textContent = '';
      this.liveEls = [];

      this.el.appendChild(h('div', { class: 'ph' }, h('b', { text: 'ECOSYSTEM' }), this.button('✕', () => this.toggle(false), 'x')));

      // Presets first: the quick way to set everything up.
      const W = RW.WILDLIFE_PRESETS;
      this.noteEl = h('div', { class: 'note', text: (W[(cfg.presets || {}).wildlife] || {}).note || '' });
      this.el.appendChild(
        h('div', { class: 'presets' },
          this.presetPicker('Size', RW.SIZE_PRESETS, 'size', (name) => {
            // a new size: world and rain settings back to their defaults
            RW.resetWorldAndRain(cfg);
            RW.applySizePreset(cfg, name);
            this.save();
            eng.regenerate(false);
            this.render();
          }),
          this.presetPicker('Wildlife', W, 'wildlife', (name) => {
            const before = cfg.world.mapSize;
            RW.applyWildlifePreset(cfg, name);
            this.save();
            if (cfg.world.mapSize !== before) eng.regenerate(false);
            eng.restartWildlife();
            this.render();
          }),
          this.noteEl
        )
      );
      this.stats = h('div', { class: 'stats' });
      this.el.appendChild(this.stats);

      // Species table
      const sp = [];
      const head = h('div', { class: 'sp sp-h' }, h('span'), h('span', { text: 'creature' }), h('span', { text: 'weight' }), h('span', { text: 'max' }), h('span', { text: 'now' }), h('span'));
      sp.push(head);
      for (const key of Object.keys(cfg.species)) {
        const s = cfg.species[key];
        const en = h('input', { type: 'checkbox' });
        en.checked = s.enabled && (s.weight > 0 || key === 'noodlefly_infant');
        const wv = h('span', { class: 'val', text: String(s.weight) });
        const w = h('input', { type: 'range', min: 0, max: 10, step: 0.5, value: s.weight });
        en.addEventListener('change', () => {
          s.enabled = en.checked;
          // ticking a creature that's at zero gives it its usual weight back
          if (en.checked && !(s.weight > 0) && key !== 'noodlefly_infant') {
            const base = RW.BASE_CONFIG.species[key];
            s.weight = base && base.weight > 0 ? base.weight : 1;
            w.value = s.weight;
            wv.textContent = String(s.weight);
          }
          this.custom('wildlife');
          this.save();
        });
        w.addEventListener('input', () => {
          s.weight = +w.value;
          wv.textContent = w.value;
          // the box follows the slider to and from zero
          if (key !== 'noodlefly_infant') en.checked = s.enabled = s.weight > 0;
          this.custom('wildlife');
          this.save();
        });
        const mx = h('input', { type: 'number', min: 0, max: 60, value: s.max, class: 'num' });
        mx.addEventListener('change', () => {
          s.max = Math.max(0, +mx.value | 0);
          this.custom('size');
          this.save();
        });
        const now = h('span', { class: 'now', text: '0' });
        this.liveEls.push(() => (now.textContent = String(eng.eco.count(key))));
        const add = this.button('+', () => {
          const c = eng.eco.spawn(key);
          if (!c) this.flash('no open den');
        }, 'add');
        add.title = 'Spawn one now (ignores caps)';
        sp.push(h('div', { class: 'sp' }, en, h('span', { class: 'nm', text: s.label || key }), h('span', { class: 'wcell' }, w, wv), mx, now, add));
      }
      this.el.appendChild(this.section('Spawn weights', ...sp));

      const E = cfg.ecosystem;
      const sized = () => this.custom('size');
      this.el.appendChild(
        this.section('Population',
          this.slider('max population', E, 'maxPopulation', 0, 80, 1, sized),
          this.slider('spawns /min', E, 'spawnPerMinute', 0.5, 30, 0.5, sized),
          this.slider('migration /min', E, 'migrationPerMinute', 0, 1, 0.05),
          this.slider('rocks', E, 'rocks', 0, 120, 1, sized),
          this.slider('spears', E, 'spears', 0, 30, 1, sized),
          this.toggleCtl('predators eat prey', E, 'predation'),
          this.toggleCtl('creatures react to cursor', E, 'cursorInteraction'),
          this.toggleCtl('click wallpaper drops fruit', E, 'clickDropsFood'),
          h('div', { class: 'btns' },
            this.button('Clear all', () => {
              for (const c of eng.eco.creatures) c.remove();
            }),
            this.button('Fill now', () => eng.eco.populate()),
            this.button('Drop 5 fruit', () => {
              for (let i = 0; i < 5; i++) eng.eco.dropFood(U.rand(100, eng.W - 100), U.rand(20, 80));
            })
          )
        )
      );

      // (the rain cycle's settings live in the radial menu off the cycle
      // timer, bottom left: see buildRainMenu)

      const Wc = cfg.world;
      this.el.appendChild(
        this.section('World',
          this.select('palette', Wc, 'palette', Object.keys(RW.PALETTES), () => eng.applyPalette()),
          this.select('pixel scale', Wc, 'pixelScale', [1, 1.5, 2, 2.5, 3], () => {
            this.custom('size');
            eng.applyPalette();
          }),
          this.slider('map size', Wc, 'mapSize', 0.7, 3, 0.05, () => {
            this.custom('size');
            // rebuild once the slider settles, not on every pixel of the drag
            clearTimeout(this.mapT);
            this.mapT = setTimeout(() => eng.regenerate(false), 250);
          }),
          this.slider('time scale', Wc, 'timeScale', 0, 3, 0.05),
          // light: the rain cycle's clock, or held at an hour (-1 = follow the cycle)
          this.toggleCtl('day-night light', Wc, 'realTimeLight', () => (eng.lightT = 0)),
          this.slider('time of day (-1 = rain cycle)', Wc, 'timeOfDay', -1, 24, 0.25, () => (eng.lightT = 0)),
          this.select('max fps', Wc, 'maxFps', [60, 30]),
          // a new layout is a new world: a new map and everyone respawned
          this.select('layout', Wc, 'layout', ['experimental', 'ledges'].concat(Wc.layout === 'tiers' || Wc.layout === 'scatter' ? [Wc.layout] : []), () => {
            eng.regenerate(false);
            eng.restartWildlife();
          }),
          this.select('region (experimental)', Wc, 'region', ['auto'].concat(Object.keys(RW.Rooms ? RW.Rooms.REGIONS : {})), () => {
            if (Wc.layout !== 'experimental') return;
            eng.regenerate(true);
            eng.restartWildlife();
          }),
          // open ground on top, a complex of rooms below
          // the ground's colour: earthy strata under the floors, or plain rock
          this.select('ground', Wc, 'terrain', ['strata', 'flat'], () => {
            if (Wc.layout !== 'experimental') return;
            eng.paintBackground();
          }),
          this.select('surface maps', Wc, 'surface', ['auto', 'always', 'never'], () => {
            if (Wc.layout !== 'experimental') return;
            eng.regenerate(true);
            eng.restartWildlife();
          }),
          this.slider('ledges', Wc, 'decorLedges', 0, 14, 1),
          this.slider('poles', Wc, 'decorPoles', 0, 16, 1),
          this.slider('ledge poles', Wc, 'ledgePoles', 0, 1, 0.05),
          this.slider('passages', Wc, 'passages', 0, 1, 0.05),
          this.slider('horizontal poles', Wc, 'beams', 0, 1, 0.05),
          this.slider('fruit plants', Wc, 'fruitPlants', 0, 14, 1),
          this.slider('ground clutter', Wc, 'groundDecor', 0, 2, 0.1),
          h('div', { class: 'btns' }, this.button('New background', () => eng.regenerate(true)), this.button('Rebuild decor', () => eng.regenerate(false)))
        )
      );

      const D = cfg.debug;
      this.el.appendChild(
        this.section('Debug',
          this.toggleCtl('nav grid', D, 'showGrid'),
          this.toggleCtl('paths', D, 'showPaths'),
          this.toggleCtl('AI state labels', D, 'showLabels'),
          this.toggleCtl('fps', D, 'showFps')
        )
      );

      // Advanced: raw JSON
      const ta = h('textarea', { spellcheck: 'false' });
      this.el.appendChild(
        this.section('Config JSON (all creature parameters)',
          ta,
          h('div', { class: 'btns' },
            this.button('Load current', () => (ta.value = JSON.stringify(cfg, null, 2))),
            this.button('Apply', () => {
              try {
                const parsed = JSON.parse(ta.value);
                U.deepMerge(cfg, parsed);
                this.save();
                this.flash('applied — reloading');
                setTimeout(() => location.reload(), 400);
              } catch (e) {
                this.flash('bad JSON: ' + e.message);
              }
            }),
            // Hosts that can't save files (e.g. a shared artifact page) set RW.noFileDownloads.
            RW.noFileDownloads
              ? null
              : this.button('Download', () => {
                  const a = h('a', { download: 'rain-world-desktop-config.json' });
                  a.href = URL.createObjectURL(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }));
                  a.click();
                }),
            this.button('Reset defaults', () => {
              RW.clearSavedConfig();
              location.reload();
            }, 'warn')
          )
        )
      );
      this.msg = h('div', { class: 'msg' });
      this.el.appendChild(this.msg);
      this.el.scrollTop = scroll;
      this.refreshLive();
    }

    flash(text) {
      this.msg.textContent = text;
      clearTimeout(this.msgT);
      this.msgT = setTimeout(() => (this.msg.textContent = ''), 3000);
    }

    refreshLive() {
      if (!this.open) return;
      const eco = this.engine.eco;
      for (const f of this.liveEls) f();
      const w = this.engine.weather;
      const left = Math.max(0, (1 - w.phase) * this.cfg.rain.cycleMinutes);
      this.stats.textContent =
        `population ${eco.population().toFixed(1)} / ${this.cfg.ecosystem.maxPopulation}   ` +
        // what's alive, by kind (lizards 1.2-2 each, centipedes by size; batflies free)
        '\n' + this.census() + '\n' +
        `born ${eco.stats.born}  eaten ${eco.stats.eaten}  left ${eco.stats.left}\n` +
        (w.downpour
          ? `DOWNPOUR — ${eco.shelterStash.length} sheltering in the pipes`
          : eco.shouldShelter()
            ? 'rain coming — creatures heading for the pipes'
            : eco.shelterStash.length
              ? `rain passed — ${eco.shelterStash.length} still to come back out`
              : `rain in ~${left.toFixed(1)} min`) +
        (this.engine.provider.status ? '\n' + this.engine.provider.status() : '');
    }
  }

  RW.Panel = Panel;
})();
