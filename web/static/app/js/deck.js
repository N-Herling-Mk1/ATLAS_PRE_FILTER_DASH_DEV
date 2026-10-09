/* deck.js -- the rotating deck. mk25. CSS 3D, no renderer.

   Rebuilt to match the deck on nathanherling.com (js/deck.js there):

     - a RAKED carousel, not a flat ring. The ring is tipped -12deg about X, so
       the far placards ride higher and you look down across the deck; each
       placard is counter-rotated +12deg so it still stands upright to camera.
     - placards, not tiles: index number, display-face label, blurb, all
       bottom-aligned. Every placard stays lit (the site prints all four); depth
       is carried by a light dim, not by fading the sides to ghosts.
     - only the face flush to camera takes the pointer. On the site the rear
       card overlapping the front card's centre was a hit-testing problem, and
       this is the fix it settled on. Dragging works anywhere on the stage.
     - DOCK mode. The site minimises the deck into a rail slot while a panel is
       open and lets it drift. setMini(true) does the same here; the host page
       moves the element, the deck just resizes and drifts.

   Radius from the face count, as before: chord between neighbours is
   2R*sin(pi/N), so R = pw*GAP / (2*tan(pi/N)) keeps faces from overlapping as N
   grows, floored at 0.82*pw (the site's radius) for small N.

   API
     Deck.mount(el, {faces:[{id,name,glyph,blurb}], onSelect(i), onOpen(i),
                     onAngle(deg), onPass(i)})
       -> {select(i,{snap}), index(), angle(), grab(), turn(dDeg), release(),
           setMini(bool), relayout(), open(), destroy()}

     onAngle fires on every paint with the ring angle -- the gimbal reads it.
     onPass fires each time a new face comes to the front, however it got
     there -- one detent click per face.
*/
"use strict";
(() => {
  const GAP = 1.16, FLOOR = 0.82, TILT = -12, ASPECT = 0.72;
  /* How much of the host's width the ring may span, and the smallest card still
     worth reading. Past ~16 sections pw pins to PW_MIN and the ring starts
     growing again -- that is the signal to group the sections, not to lower
     PW_MIN. See DROP_NOTES_mk27. */
  const RING_FIT = 0.92, PW_MIN = 120;
  /* Depth by size as well as by opacity: the face square to camera is drawn a
     little over full size, the rest shrink toward SIDE_S.

     The exponent is the whole decision. At 0.85 the first neighbour sits at
     0.93 -- a 7% difference nobody reads as depth. At 0.45 it is 0.84 against
     the front's 1.06, which is a fifth smaller and plainly a step back. The
     rear face lands at SIDE_S either way; what changes is how quickly the drop
     happens over the first few degrees, which is the only part on screen.

     Note it does NOT relieve crowding at high N, which was my first guess: the
     neighbour's angular distance SHRINKS as sections are added, so it scales
     back up toward the front size. Spacing is mk27's ring bound's job. */
  const FRONT_S = 1.06, SIDE_S = 0.68, DEPTH_EXP = 0.45;
  // coast distance = MAX_VEL / (1 - FRICTION) = 70deg: a flick carries about
  // one and a half faces, not most of a turn
  const FRICTION = 0.90, MAX_VEL = 7, SNAP = 0.16, DRIFT = 0.12;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function mount(host, opts) {
    const faces = opts.faces || [];
    const N = faces.length;
    if (!host || !N) return null;
    const step = 360 / N;

    host.innerHTML = "";
    const stage = document.createElement("div");
    stage.className = "deck-stage";
    stage.tabIndex = 0;
    stage.setAttribute("role", "listbox");
    stage.setAttribute("aria-label", "Sections deck. Drag or use arrow keys to turn, Enter to open.");
    const ring = document.createElement("div");
    ring.className = "deck-ring";
    stage.appendChild(ring);
    host.appendChild(stage);

    const pad = n => String(n + 1).padStart(2, "0");
    const cards = faces.map((f, i) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "placard";
      c.dataset.i = String(i);
      c.setAttribute("role", "option");
      c.innerHTML = '<span class="pc-top"><span class="pc-n"></span><span class="pc-g"></span></span>' +
                    '<span class="pc-l"></span><span class="pc-b"></span><span class="pc-o">Open section</span>';
      c.querySelector(".pc-n").textContent = pad(i);
      c.querySelector(".pc-g").textContent = f.glyph;
      c.querySelector(".pc-l").textContent = f.name;
      c.querySelector(".pc-b").textContent = f.blurb || "";
      ring.appendChild(c);
      return c;
    });

    let R = 0, pw = 200, mini = false;
    function layout() {
      /* clientWidth/Height, NOT getBoundingClientRect: the host carries a FLIP
         transform while it glides between stage and dock, and the bounding rect
         includes that scale. mk25 measured mid-glide on the way back, solved the
         card size from the shrunken box, and the deck came home small. */
      const w = host.clientWidth || 600, h = host.clientHeight || 300;
      /* Solve the card width from the box, like the site's sizeCards(): the
         deck's visible extent is about 3.3 card widths at N=7, and the card
         must fit the height with room for the rake. */
      pw = mini ? Math.max(56, Math.min(w * 0.30, (h * 0.62) / ASPECT, 120))
                : Math.max(110, Math.min(w * 0.40, (h * 0.66) / ASPECT, 420));
      /* Bound the RING, not just the card. R = pw*GAP / (2*tan(pi/N)) grows
         roughly linearly in N while the box does not: at a 900x300 host the
         ring clears the box at N=10 and is 2000 px wide by N=20, so the deck
         would simply hang off both sides as sections are added. Inverting the
         same formula gives the card width that keeps the ring inside the box:
         pw = D*tan(pi/N) / GAP. Below N=9 the box cap is smaller and wins, so
         this changes nothing at today's seven. */
      if (!mini) {
        const bound = (w * RING_FIT) * Math.tan(Math.PI / N) / GAP;
        pw = Math.max(PW_MIN, Math.min(pw, bound));
      }
      R = Math.max(FLOOR * pw, (pw * GAP) / (2 * Math.tan(Math.PI / N)));
      stage.style.setProperty("--pw", pw.toFixed(1) + "px");
      stage.style.setProperty("--ph", (pw * ASPECT).toFixed(1) + "px");
      stage.style.perspective = Math.round(R * 3.4) + "px";
      // under ~190 px a placard can't hold name + blurb; drop the blurb
      stage.classList.toggle("compact", !mini && pw < 190);
      cards.forEach((c, i) => {
        // base transform kept on the node: paint() appends the depth scale to
        // it every frame, and rebuilding this string there would be wasteful
        c._base = `rotateY(${(i * step).toFixed(2)}deg) translateZ(${R.toFixed(1)}px) rotateX(${-TILT}deg)`;
        c.style.transform = c._base;
      });
      paint();
    }

    // angle: where the ring is turned TO, degrees, unwrapped. Face i is front
    // when angle = -i*step.
    let angle = 0, vel = 0, dragging = false, held = false, lastX = 0, lastT = 0;
    let raf = null, tween = null, idx = 0, front = 0;
    const wrap = i => ((i % N) + N) % N;
    const facing = () => wrap(Math.round(-angle / step));

    function paint() {
      ring.style.transform = `translateZ(${(-R).toFixed(1)}px) rotateX(${TILT}deg) rotateY(${angle.toFixed(2)}deg)`;
      const f = facing();
      cards.forEach((c, i) => {
        /* distance round the ring from the front: 0 square to camera, 1 directly
           behind. (mk23 had this inverted -- the FRONT face got the 0.22 floor
           and the rear face full opacity, which is why the front looked like a
           ghost in the mk24 screenshot.) */
        const dist = Math.abs(((i * step + angle) % 360 + 540) % 360 - 180) / 180;
        c.style.opacity = (1 - 0.62 * Math.pow(dist, 1.3)).toFixed(3);
        const spread = mini ? 0.5 : 1;        // the docked deck stays tidy
        const s = FRONT_S - (FRONT_S - SIDE_S) * spread * Math.pow(dist, DEPTH_EXP);
        if (c._base) c.style.transform = `${c._base} scale(${s.toFixed(3)})`;
        const on = i === f;
        c.classList.toggle("face", on);
        c.setAttribute("aria-selected", on ? "true" : "false");
        c.tabIndex = -1;
      });
      if (f !== front) { front = f; if (opts.onPass) opts.onPass(f); }
      if (!mini && f !== idx) { idx = f; if (opts.onSelect) opts.onSelect(idx); }
      if (opts.onAngle) opts.onAngle(angle);
    }

    function tick() {
      raf = null;
      if (tween) return;
      if (mini) {
        if (!reduce) { angle -= DRIFT; paint(); raf = requestAnimationFrame(tick); }
        return;
      }
      if (!dragging && !held) {
        if (Math.abs(vel) > 0.02) { angle += vel; vel *= FRICTION; }
        else {
          const want = -Math.round(-angle / step) * step;
          const d = want - angle;
          if (Math.abs(d) > 0.05) angle += d * SNAP;
          else { angle = want; vel = 0; paint(); return; }
        }
        paint();
        raf = requestAnimationFrame(tick);
      }
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const stopTween = () => { if (tween) { cancelAnimationFrame(tween); tween = null; } };

    // ------------------------------------------------------------- drag --
    let downX = 0, downY = 0, travelled = 0, downCard = -1, tapAt = -1e9;
    stage.addEventListener("pointerdown", e => {
      if (mini || (e.button != null && e.button !== 0)) return;
      stopTween();
      dragging = true; lastX = e.clientX; lastT = performance.now(); vel = 0;
      // mk49: remember what was pressed and where, to tell a tap from a drag
      downX = e.clientX; downY = e.clientY; travelled = 0;
      downCard = e.target.closest ? cards.indexOf(e.target.closest(".placard")) : -1;
      stage.classList.add("dragging");
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", e => {
      if (!dragging) return;
      const now = performance.now(), dx = e.clientX - lastX;
      travelled = Math.max(travelled, Math.hypot(e.clientX - downX, e.clientY - downY));
      const dt = Math.max(8, now - lastT);   // a sub-ms synthetic event would fling it
      const dA = dx * 0.32;                   // px -> degrees
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
      /* mk49: a tap on the front placard opens it. The click listener below
         never saw these: the stage captures the pointer on press, and a
         captured pointer's click is delivered to the stage, not the placard.
         So the tap is recognised here -- pressed on the front face, released
         without having travelled. */
      if (e.type === "pointerup" && !mini && travelled < 6 && downCard >= 0
          && downCard === facing() && opts.onOpen) {
        tapAt = performance.now();
        opts.onOpen(downCard);
      }
    };
    stage.addEventListener("pointerup", drop);
    stage.addEventListener("pointercancel", drop);

    // only the front placard takes a click (CSS gives the others no pointer)
    cards.forEach((c, i) => c.addEventListener("click", e => {
      e.preventDefault();
      if (mini || Math.abs(vel) > 0.6) return;  // a throw, not a click
      if (performance.now() - tapAt < 400) return;   // the tap above already opened it
      if (facing() === i && opts.onOpen) opts.onOpen(i);
    }));

    stage.addEventListener("keydown", e => {
      if (mini) return;
      if (e.key === "ArrowRight") { select(idx + 1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { select(idx - 1); e.preventDefault(); }
      else if (e.key === "Enter" || e.key === " ") { if (opts.onOpen) opts.onOpen(idx); e.preventDefault(); }
    });

    /* Turn to face i by the SHORTEST arc -- angle is unwrapped, so going from
       the last face to the first turns one step forward, not N-1 back. */
    function select(i, o) {
      const want = wrap(i);
      let d = (-want * step - angle) % 360;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      vel = 0;
      stopTween();
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      if (reduce || (o && o.snap)) { angle += d; paint(); return; }
      const from = angle, to = angle + d, t0 = performance.now(), MS = 460;
      (function ease() {
        const k = Math.min(1, (performance.now() - t0) / MS);
        angle = from + (to - from) * (1 - Math.pow(1 - k, 3));
        paint();
        if (k < 1) tween = requestAnimationFrame(ease);
        else { tween = null; angle = to; paint(); }
      })();
    }

    /* The gimbal drives the ring directly: grab() stops any coast or tween,
       turn() adds degrees live, release() lets it snap to the nearest face. */
    function grab() { stopTween(); if (raf) { cancelAnimationFrame(raf); raf = null; } held = true; vel = 0; }
    function turn(dDeg) { if (mini) return; angle += dDeg; paint(); }
    function release() { held = false; vel = 0; kick(); }

    function setMini(on) {
      mini = !!on;
      stage.classList.toggle("mini", mini);
      stage.tabIndex = mini ? -1 : 0;
      stopTween();
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      layout();
      if (mini) kick();
      else select(idx, {snap: true});      // come back square on the selection
    }

    // the deal-in: placards land one after another, once, at mount
    cards.forEach((c, i) => {
      if (reduce) { c.classList.add("dealt"); return; }
      setTimeout(() => c.classList.add("dealt"), 80 + i * 70);
    });

    layout();
    window.addEventListener("resize", layout);
    if (typeof ResizeObserver === "function") new ResizeObserver(() => layout()).observe(host);

    return {
      select, grab, turn, release, setMini, relayout: layout,
      index: () => idx, angle: () => angle, step: () => step,
      open: () => { if (opts.onOpen) opts.onOpen(idx); },
      destroy() { stopTween(); if (raf) cancelAnimationFrame(raf); host.innerHTML = ""; },
    };
  }

  window.Deck = {mount};
})();
