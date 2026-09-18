/* deck.js -- the rotating deck. CSS 3D, no renderer.

   N faces on a cylinder. Drag it horizontally, throw it and it coasts, let go
   and it snaps to the nearest face. Prev/next step one face the short way.
   Whatever ends up front is the selection, and the host is told about it.

   Radius comes from the face count, not a fixed number: at N faces the chord
   between neighbours is 2*R*sin(pi/N), so R = (w*GAP)/(2*tan(pi/N)) puts a gap
   of GAP*w between face centres and stops faces overlapping as N grows. The
   0.82*w floor keeps small N (3, 4) from collapsing onto the camera.

   API
     Deck.mount(el, {faces:[{id,name,glyph,blurb}], onSelect, onOpen})
       -> {select(i, {snap}), open(), index(), destroy()}
*/
"use strict";
(() => {
  /* Coast distance is vel/(1 - FRICTION), so these two numbers are one decision:
   7 / (1 - 0.90) = 70 degrees, about a face and a half after the fingers leave.
   At 18 and 0.94 a flick coasted 300 degrees -- most of a full turn, landing
   somewhere unrelated to the gesture. */
  const GAP = 1.16, FLOOR = 0.82, FRICTION = 0.90, SNAP = 0.18, MAX_VEL = 7;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function mount(host, opts) {
    const faces = opts.faces || [];
    const N = faces.length;
    if (!host || !N) return null;
    const stepDeg = 360 / N;

    host.innerHTML = "";
    const stage = document.createElement("div");
    stage.className = "deck-stage";
    const ring = document.createElement("div");
    ring.className = "deck-ring";
    stage.appendChild(ring);
    host.appendChild(stage);

    const cards = faces.map((f, i) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "deck-face";
      c.dataset.id = f.id;
      c.dataset.i = String(i);
      c.innerHTML =
        `<span class="df-glyph"></span><span class="df-name"></span><span class="df-blurb"></span>` +
        `<span class="df-open">open &rarr;</span>`;
      c.querySelector(".df-glyph").textContent = f.glyph;
      c.querySelector(".df-name").textContent = f.name;
      c.querySelector(".df-blurb").textContent = f.blurb || "";
      ring.appendChild(c);
      return c;
    });

    let R = 0;
    function layout() {
      const w = cards[0].offsetWidth || 220;
      R = Math.max(FLOOR * w, (w * GAP) / (2 * Math.tan(Math.PI / N)));
      cards.forEach((c, i) => {
        c.style.transform = `rotateY(${i * stepDeg}deg) translateZ(${R.toFixed(1)}px)`;
      });
      stage.style.perspective = `${Math.round(R * 3.2)}px`;
      paint();
    }

    // angle is where the ring is turned TO, in degrees, unwrapped
    let angle = 0, vel = 0, dragging = false, lastX = 0, lastT = 0, raf = null, idx = 0;

    const facing = () => Math.round(-angle / stepDeg);
    const wrap = i => ((i % N) + N) % N;

    function paint() {
      ring.style.transform = `translateZ(${(-R).toFixed(1)}px) rotateY(${angle.toFixed(2)}deg)`;
      const f = wrap(facing());
      cards.forEach((c, i) => {
        // how square-on this face is, 1 at the front: drives dim and blur
        const d = Math.abs(((i * stepDeg + angle) % 360 + 540) % 360 - 180) / 180;
        c.style.opacity = (0.22 + 0.78 * Math.pow(d, 2.2)).toFixed(3);
        c.classList.toggle("front", i === f);
        c.setAttribute("aria-hidden", i === f ? "false" : "true");
        c.tabIndex = i === f ? 0 : -1;
      });
      if (f !== idx) { idx = f; if (opts.onSelect) opts.onSelect(idx); }
    }

    function tick() {
      raf = null;
      if (!dragging) {
        if (Math.abs(vel) > 0.02) { angle += vel; vel *= FRICTION; }
        else {
          const want = -facing() * stepDeg;
          const d = want - angle;
          if (Math.abs(d) > 0.05) angle += d * SNAP; else { angle = want; vel = 0; paint(); return; }
        }
      }
      paint();
      raf = requestAnimationFrame(tick);
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

    // ------------------------------------------------------------- drag --
    stage.addEventListener("pointerdown", e => {
      if (e.button != null && e.button !== 0) return;
      dragging = true; lastX = e.clientX; lastT = performance.now(); vel = 0;
      stage.classList.add("dragging");
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", e => {
      if (!dragging) return;
      const now = performance.now(), dx = e.clientX - lastX;
      // dt floors at 8 ms and the throw is clamped: a fast flick, or a synthetic
      // event arriving in under a millisecond, would otherwise hand the ring a
      // velocity of several hundred degrees per frame and spin it blind.
      const dt = Math.max(8, now - lastT);
      const dA = dx * 0.32;                       // px -> degrees
      angle += dA;
      vel = Math.max(-MAX_VEL, Math.min(MAX_VEL, dA * (16 / dt)));
      lastX = e.clientX; lastT = now;
      paint();
    });
    const drop = e => {
      if (!dragging) return;
      dragging = false;
      stage.classList.remove("dragging");
      if (stage.hasPointerCapture && stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
      kick();
    };
    stage.addEventListener("pointerup", drop);
    stage.addEventListener("pointercancel", drop);

    // a click on the front face is the door; a click on any other face turns to it
    cards.forEach((c, i) => c.addEventListener("click", e => {
      e.preventDefault();
      if (Math.abs(vel) > 0.6) return;            // it was a throw, not a click
      if (wrap(facing()) === i) { if (opts.onOpen) opts.onOpen(i); }
      else select(i);
    }));

    stage.addEventListener("keydown", e => {
      if (e.key === "ArrowRight") { select(idx + 1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { select(idx - 1); e.preventDefault(); }
      else if (e.key === "Enter" || e.key === " ") { if (opts.onOpen) opts.onOpen(idx); e.preventDefault(); }
    });

    /* Turn to face i by the SHORTEST arc. angle is unwrapped, so going from the
       last face to the first turns one step forward rather than N-1 back. */
    function select(i, o) {
      const want = wrap(i);
      let d = (-want * stepDeg - angle) % 360;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      vel = 0;
      if (reduce || (o && o.snap)) { angle += d; paint(); return; }
      const to = angle + d, from = angle, t0 = performance.now(), MS = 420;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      (function ease() {
        const k = Math.min(1, (performance.now() - t0) / MS);
        angle = from + (to - from) * (1 - Math.pow(1 - k, 3));
        paint();
        if (k < 1) raf = requestAnimationFrame(ease); else { raf = null; angle = to; paint(); }
      })();
    }

    layout();
    window.addEventListener("resize", layout);
    if (!reduce) kick();

    return {
      select, index: () => idx,
      open: () => { if (opts.onOpen) opts.onOpen(idx); },
      relayout: layout,
      destroy() { if (raf) cancelAnimationFrame(raf); host.innerHTML = ""; },
    };
  }

  window.Deck = {mount};
})();
