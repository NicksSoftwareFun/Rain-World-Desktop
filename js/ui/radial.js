// A corner radial menu: a hub button tucked into a corner of the screen;
// clicking it fans the menu's items out round the corner in arcs (buttons
// and toggles on the inner ring, dials further out). Reusable: give it a
// corner, a hub element and a list of items.
//
//   const menu = new RW.RadialMenu(mount, {
//     corner: 'bottom-left',        // or bottom-right, top-left, top-right
//     hub,                          // the always-visible element that opens it
//     title: 'Rain',                // read out by screen readers
//     items: [
//       { type: 'toggle', label: 'rain', icon: '☂', get: () => on, set: (v) => {} },
//       { type: 'action', label: 'downpour', icon: '⛈', run: () => {} },
//       { type: 'dial', label: 'cycle', min: 1, max: 30, step: 0.5, get, set,
//         format: (v) => v + 'm', onDrag: (v) => {} },
//     ],
//     onChange: () => {},           // after any change (save the config, say)
//   });
//
// A dial turns by dragging (up or right to raise it), the mouse wheel, or
// the arrow keys when focused. Escape, a click on the hub or anywhere
// outside closes the menu.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;

  const SVG = 'http://www.w3.org/2000/svg';
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  class RadialMenu {
    constructor(mount, opts) {
      this.opts = opts;
      this.corner = opts.corner || 'bottom-left';
      this.margin = opts.margin || 20;
      this.hubSize = opts.hubSize || 72;
      this.isOpen = false;
      this.root = el('div', 'rw-radial rw-radial-' + this.corner);
      this.root.setAttribute('role', 'menu');
      this.root.setAttribute('aria-label', opts.title || 'menu');
      this.shade = el('div', 'rw-radial-shade');
      this.root.appendChild(this.shade);
      this.hub = opts.hub;
      this.hub.classList.add('rw-radial-hub');
      this.hub.setAttribute('aria-haspopup', 'menu');
      this.hub.setAttribute('aria-expanded', 'false');
      this.place(this.hub, 0, 0, this.hubSize);
      this.hub.addEventListener('click', () => this.toggle());
      mount.appendChild(this.root);
      mount.appendChild(this.hub);
      this.items = (opts.items || []).map((it) => this.build(it));
      this.layout();
      document.addEventListener('pointerdown', (e) => {
        if (this.isOpen && !this.root.contains(e.target) && !this.hub.contains(e.target)) this.close();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) this.close();
      });
      window.addEventListener('resize', () => this.layout());
    }

    // Position an element of size s with its centre at (dx, dy) from the
    // hub's centre, measured away from the corner (dx: along the bottom or
    // top edge, dy: up or down the side).
    place(e, dx, dy, s) {
      const c = this.margin + this.hubSize / 2;
      const [v, hz] = this.corner.split('-');
      e.style.position = 'fixed';
      e.style.width = e.style.height = s + 'px';
      e.style[hz] = Math.round(c + dx - s / 2) + 'px';
      e.style[v] = Math.round(c + dy - s / 2) + 'px';
    }

    build(it) {
      const b = el('button', 'rw-radial-item rw-radial-' + it.type);
      b.type = 'button';
      b.setAttribute('role', it.type === 'toggle' ? 'menuitemcheckbox' : 'menuitem');
      b.title = it.title || it.label;
      const face = el('span', 'face');
      const lbl = el('span', 'lbl', it.label);
      if (it.type === 'dial') {
        // a gauge arc round the knob, and the value in the middle
        const svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('viewBox', '0 0 60 60');
        svg.setAttribute('class', 'gauge');
        const track = document.createElementNS(SVG, 'path');
        track.setAttribute('class', 'track');
        const fill = document.createElementNS(SVG, 'path');
        fill.setAttribute('class', 'fill');
        svg.appendChild(track);
        svg.appendChild(fill);
        track.setAttribute('d', arcPath(30, 30, 25, -225, 45));
        it._fill = fill;
        face.appendChild(svg);
        it._val = el('span', 'val');
        face.appendChild(it._val);
        this.bindDial(b, it);
      } else {
        face.appendChild(el('span', 'icon', it.icon || '•'));
        b.addEventListener('click', () => {
          if (it.type === 'toggle') it.set(!it.get());
          else it.run();
          b.classList.add('flash');
          setTimeout(() => b.classList.remove('flash'), 220);
          this.changed();
        });
      }
      b.appendChild(face);
      b.appendChild(lbl);
      this.root.appendChild(b);
      it._el = b;
      return it;
    }

    bindDial(b, it) {
      const range = it.max - it.min;
      const setV = (v, dragging) => {
        const step = it.step || range / 100;
        v = U.clamp(Math.round((v - it.min) / step) * step + it.min, it.min, it.max);
        v = +v.toFixed(4);
        if (v !== it.get()) {
          it.set(v);
          this.changed();
        }
        if (dragging && it.onDrag) it.onDrag(v);
        this.refresh(it);
      };
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('turning');
        const x0 = e.clientX;
        const y0 = e.clientY;
        const v0 = it.get();
        const move = (ev) => setV(v0 + ((ev.clientX - x0 - (ev.clientY - y0)) / 160) * range, true);
        const up = () => {
          b.classList.remove('turning');
          b.removeEventListener('pointermove', move);
          b.removeEventListener('pointerup', up);
          b.removeEventListener('pointercancel', up);
        };
        b.addEventListener('pointermove', move);
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        if (it.onDrag) it.onDrag(v0);
      });
      b.addEventListener('wheel', (e) => {
        e.preventDefault();
        setV(it.get() - Math.sign(e.deltaY) * (it.step || range / 100), true);
      }, { passive: false });
      b.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        setV(it.get() + d * (it.step || range / 100), true);
      });
      b.setAttribute('role', 'slider');
      b.setAttribute('aria-valuemin', it.min);
      b.setAttribute('aria-valuemax', it.max);
    }

    // Spread the items round the corner: buttons and toggles on the inner
    // ring, dials outside them, a ring adding itself whenever one fills up.
    layout() {
      const a0 = (8 * Math.PI) / 180;
      const a1 = (82 * Math.PI) / 180;
      const rings = [];
      const groups = [this.items.filter((i) => i.type !== 'dial'), this.items.filter((i) => i.type === 'dial')];
      let r = this.hubSize / 2 + 72;
      for (const g of groups) {
        let rest = g.slice();
        while (rest.length) {
          const size = rest[0].type === 'dial' ? 64 : 50;
          // (room for each item and its label along the arc)
          const fit = Math.max(1, Math.floor((r * (a1 - a0)) / (size + 22)) + 1);
          rings.push({ r, size, items: rest.slice(0, fit) });
          rest = rest.slice(fit);
          r += size + 34;
        }
      }
      for (const ring of rings) {
        const n = ring.items.length;
        ring.items.forEach((it, k) => {
          const a = n === 1 ? (a0 + a1) / 2 : a0 + ((a1 - a0) * k) / (n - 1);
          it._el.style.setProperty('--d', k * 22 + ring.r / 4 + 'ms');
          this.place(it._el, Math.cos(a) * ring.r, Math.sin(a) * ring.r, ring.size);
        });
      }
      const outer = rings.length ? rings[rings.length - 1].r + 70 : 160;
      this.place(this.shade, 0, 0, outer * 2);
    }

    refresh(it) {
      if (it.type === 'toggle') {
        const on = !!it.get();
        it._el.classList.toggle('on', on);
        it._el.setAttribute('aria-checked', String(on));
      } else if (it.type === 'dial') {
        const v = it.get();
        const f = U.clamp((v - it.min) / (it.max - it.min), 0, 1);
        it._fill.setAttribute('d', arcPath(30, 30, 25, -225, -225 + 270 * f));
        it._val.textContent = it.format ? it.format(v) : String(v);
        it._el.setAttribute('aria-valuenow', v);
      }
    }
    changed() {
      if (this.opts.onChange) this.opts.onChange();
      for (const it of this.items) this.refresh(it);
    }

    open() {
      for (const it of this.items) this.refresh(it);
      this.isOpen = true;
      this.root.classList.add('open');
      this.hub.classList.add('open');
      this.hub.setAttribute('aria-expanded', 'true');
    }
    close() {
      this.isOpen = false;
      this.root.classList.remove('open');
      this.hub.classList.remove('open');
      this.hub.setAttribute('aria-expanded', 'false');
    }
    toggle() {
      if (this.isOpen) this.close();
      else this.open();
    }
  }

  // An SVG arc on a circle (degrees, 0 = east, clockwise on screen).
  function arcPath(cx, cy, r, d0, d1) {
    const p = (d) => [cx + r * Math.cos((d * Math.PI) / 180), cy + r * Math.sin((d * Math.PI) / 180)];
    if (d1 - d0 < 0.5) d1 = d0 + 0.5;
    const [x0, y0] = p(d0);
    const [x1, y1] = p(d1);
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }

  RW.RadialMenu = RadialMenu;
})();
