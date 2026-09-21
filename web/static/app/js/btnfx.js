/* btnfx.js -- the sign-in button's static, for any button.

   One canvas over a host element, not one per button: the buttons sit inside a
   host that already exists, and drawing each button's field in host
   coordinates avoids wrapping every button in a positioned div just to give a
   canvas something to be absolute against.

   Hover raises a thin field over the button's face -- every cell re-rolled
   every frame, light and dark speckle both, kept faint enough to read the label
   through. Press drives the same field to full: coarser cells, near-opaque.
   Nothing travels; only the strength changes.

   Tracks are NOT drawn here. Press calls the onPress hook with the button's
   rect, so the caller can fire traces.js with it -- one effect, one owner.

   API
     const fx = BtnFx.mount(hostEl);        // hostEl must be position:relative
     fx.watch(buttonEl, onPress);           // onPress(rect) -- optional
*/
"use strict";
(() => {
  const PX_HAZE = 6, PX_FIRE = 13, HOVER_LVL = 0.30;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hash = (i, r) => {
    const x = Math.sin(i * 127.1 + r * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  function mount(host, opts) {
    if (!host) return {watch() {}};
    opts = opts || {};
    let cv = host.querySelector(":scope > canvas.btn-fx");
    if (!cv) {
      cv = document.createElement("canvas");
      cv.className = "btn-fx";
      cv.setAttribute("aria-hidden", "true");
      host.appendChild(cv);
    }
    const items = [];           // {el, lvl, hover}
    let raf = null, field = 0;

    function frame() {
      raf = null;
      const hr = host.getBoundingClientRect();
      if (!hr.width) return;
      const d2 = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(hr.width * d2)) {
        cv.width = Math.round(hr.width * d2); cv.height = Math.round(hr.height * d2);
      }
      const g = cv.getContext("2d");
      g.setTransform(d2, 0, 0, d2, 0, 0);
      g.clearRect(0, 0, hr.width, hr.height);

      let live = false;
      field++;
      items.forEach(it => {
        const target = it.hover ? HOVER_LVL : 0;
        // up fast, down fast: this is a button, not a mood
        it.lvl += (target - it.lvl) * (it.lvl > HOVER_LVL ? 0.16 : 0.30);
        if (Math.abs(target - it.lvl) < 0.008) it.lvl = target;
        if (it.lvl <= 0.008) return;
        live = true;

        const b = it.el.getBoundingClientRect();
        if (!b.width) return;
        const x0 = b.left - hr.left, y0 = b.top - hr.top;
        const over = Math.max(0, (it.lvl - HOVER_LVL) / (1 - HOVER_LVL));
        const px = PX_HAZE + (PX_FIRE - PX_HAZE) * over;
        const cols = Math.max(1, Math.round(b.width / px));
        const rows = Math.max(1, Math.round(b.height / px));
        const cw = b.width / cols, ch = b.height / rows;
        const peak = 0.06 + 0.98 * it.lvl;

        for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
          const n = hash(x * rows + y, field + it.seed);
          // quantised to four levels and weighted dim: grain, not glare
          const a = Math.round(Math.pow(n, 1.6) * peak * 4) / 4;
          if (a < 0.04) continue;
          g.fillStyle = n < 0.46 ? `rgba(0,0,0,${(a * 0.62).toFixed(3)})`
                       : n < 0.86 ? `rgba(190,255,214,${(a * 0.72).toFixed(3)})`
                                  : `rgba(255,255,255,${a.toFixed(3)})`;
          g.fillRect(x0 + x * cw, y0 + y * ch, cw, ch);
        }
        if (over > 0) {
          g.fillStyle = `rgba(226,232,240,${(0.24 * over).toFixed(3)})`;
          g.fillRect(x0, y0, b.width, b.height);
        }
      });

      cv.classList.toggle("run", live);
      if (live) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && !reduce) raf = requestAnimationFrame(frame); };

    function rectOf(el) {
      const hr = host.getBoundingClientRect(), b = el.getBoundingClientRect();
      return {x: b.left - hr.left, y: b.top - hr.top, w: b.width, h: b.height};
    }

    return {
      watch(el, onPress) {
        if (!el || reduce) return;
        const it = {el, lvl: 0, hover: false, seed: Math.floor(Math.random() * 9999)};
        items.push(it);
        el.addEventListener("mouseenter", () => { it.hover = true; kick(); });
        el.addEventListener("mouseleave", () => { it.hover = false; kick(); });
        el.addEventListener("focus", () => { it.hover = true; kick(); });
        el.addEventListener("blur", () => { it.hover = false; kick(); });
        el.addEventListener("pointerdown", () => {
          it.lvl = 1;                       // same field, driven all the way up
          kick();
          if (onPress) onPress(rectOf(el));
        });
      },
    };
  }

  window.BtnFx = {mount};
})();
