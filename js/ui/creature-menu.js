// The creature menu: tap a creature and a small arc of buttons fans out
// above it (below it near the top of the screen), following it about:
// kill it, make it hungry, watch it (its path and its AI state: per
// creature, on until switched off). Tap the creature again,
// or anywhere else, to close it (Escape too); dragging a creature never
// opens it (see Engine.tick: a tap is a quick press that doesn't move).
//
//   const menu = new RW.CreatureMenu(mount, engine);
//   engine.onCreatureTap = (c) => menu.toggle(c);
//   engine.onPress = (c) => { if (c !== menu.c) menu.close(); };
//
// Sized for fingers: 46 px buttons with a gap between them.
(function () {
  'use strict';
  const RW = window.RW;
  const U = RW.U;

  // Line icons on a 24-unit grid, drawn in the text colour.
  const ICONS = {
    kill: '<path d="M12 3.5a7 7 0 0 0-7 7v2.6l2 1.9v3.5h2.2v-2h1.6v2h2.4v-2h1.6v2H17v-3.5l2-1.9v-2.6a7 7 0 0 0-7-7z"/><circle cx="9.2" cy="11" r="1.7" class="fill"/><circle cx="14.8" cy="11" r="1.7" class="fill"/>',
    hungry: '<path d="M7 3v6.5M5 3v4.2a2 2 0 0 0 4 0V3M7 9.5V21M17 21V3c-2.2 1.4-3.3 4.6-3.3 8.2H17"/>',
    // an eye over a dotted route
    watch: '<path d="M3 10s3.3-5 9-5 9 5 9 5-3.3 5-9 5-9-5-9-5z"/><circle cx="12" cy="10" r="2.3" class="fill"/><path d="M4 20.5h16" stroke-dasharray="1.6 2.4"/>',
  };
  const SIZE = 46;
  const R = 62; // centre of the body to the centre of a button

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  class CreatureMenu {
    constructor(mount, engine) {
      this.eng = engine;
      this.c = null;
      this.root = el('div', 'rw-radial rw-cmenu');
      this.root.setAttribute('role', 'menu');
      this.root.setAttribute('aria-label', 'Creature');
      const eco = () => engine.eco;
      this.items = [
        {
          key: 'kill', label: 'kill', title: 'Kill it',
          ok: (c) => !c.corpse,
          run: (c) => {
            c.kill();
            this.close();
          },
        },
        {
          key: 'hungry', label: 'hungry', title: 'Make it hungry',
          ok: (c) => !c.corpse && c.canHunger(),
          run: (c) => c.makeHungry(),
        },
        {
          key: 'watch', label: 'path + AI', title: 'Show where it is going and what it is doing (its AI state)', toggle: true,
          ok: () => true,
          on: (c) => !!c.labelPinned,
          run: (c) => {
            const on = !c.labelPinned;
            c.labelPinned = on;
            c.showPath = on; // (fliers have no route: just the label)
            if (!on) c.labelUntil = Math.min(c.labelUntil || 0, eco().t);
          },
        },
      ];
      for (const it of this.items) {
        const b = el('button', 'rw-radial-item ' + (it.toggle ? 'rw-radial-toggle' : 'rw-radial-action'));
        b.type = 'button';
        b.title = it.title;
        b.setAttribute('role', it.toggle ? 'menuitemcheckbox' : 'menuitem');
        b.setAttribute('aria-label', it.title);
        b.style.width = b.style.height = SIZE + 'px';
        const face = el('span', 'face');
        const icon = el('span', 'icon');
        icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[it.key] + '</svg>';
        face.appendChild(icon);
        b.appendChild(face);
        b.appendChild(el('span', 'lbl', it.label));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const c = this.c;
          if (!c || b.disabled) return;
          it.run(c);
          b.classList.add('flash');
          setTimeout(() => b.classList.remove('flash'), 220);
          this.refresh();
        });
        it.el = b;
        this.root.appendChild(b);
      }
      mount.appendChild(this.root);
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.c) this.close();
      });
      const follow = () => {
        requestAnimationFrame(follow);
        if (this.c) this.place();
      };
      follow();
    }

    toggle(c) {
      if (this.c === c) this.close();
      else this.open(c);
    }
    open(c) {
      if (this.c) this.c.menuOpen = false;
      this.c = c;
      c.menuOpen = true;
      this.flipped = null;
      this.place();
      this.refresh();
      this.root.classList.add('open');
    }
    close() {
      if (this.c) this.c.menuOpen = false;
      this.c = null;
      this.root.classList.remove('open');
    }
    refresh() {
      const c = this.c;
      if (!c) return;
      for (const it of this.items) {
        it.el.disabled = !it.ok(c);
        if (it.toggle) {
          const on = !!it.on(c);
          it.el.classList.toggle('on', on);
          it.el.setAttribute('aria-checked', String(on));
        }
      }
    }

    // Over the creature, wherever it has got to; gone with it.
    place() {
      const c = this.c;
      const eco = this.eng.eco;
      if (c.dead || c.leaving || c.piping || !eco.creatures.includes(c) || c.grabbedBy === this.eng.hand) {
        this.close();
        return;
      }
      const z = this.eng.zoom;
      const m = c.mainPoint();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = U.clamp(m.x * z, R + SIZE / 2 + 4, vw - R - SIZE / 2 - 4);
      const y = m.y * z;
      // (an arc above it, unless that would run off the top; decided once
      // per opening so it doesn't flip back and forth)
      if (this.flipped === null) this.flipped = y < R + SIZE + 10;
      this.root.style.transform = `translate(${Math.round(x)}px, ${Math.round(U.clamp(y, 0, vh))}px)`;
      const n = this.items.length;
      const spread = 110;
      this.items.forEach((it, k) => {
        const deg = -90 - spread / 2 + (spread * k) / (n - 1);
        const a = ((this.flipped ? -deg : deg) * Math.PI) / 180;
        it.el.style.left = Math.round(Math.cos(a) * R - SIZE / 2) + 'px';
        it.el.style.top = Math.round(Math.sin(a) * R - SIZE / 2) + 'px';
      });
      this.refresh();
    }
  }

  RW.CreatureMenu = CreatureMenu;
})();
