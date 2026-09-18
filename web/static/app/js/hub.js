/* hub.js -- the navigation surface. mk25.

   Three sets, one selection.

     rail   TV, nav, dock -- down the left. Never moves.
     band   section cards across the top. A card SELECTS; it does not open.
     stage  the deck and its control box, or the section the deck opened.

   `sel` is the only selection state. Cards, deck, gimbal and readout all read
   it. Opening a section parks the deck in the rail's dock slot, minimised and
   drifting -- the site's L4 behaviour -- and clicking it there comes back.
*/
"use strict";
(() => {
  const hub = document.getElementById("hub");
  if (!hub) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const Sfx = window.Sfx || {snap() {}, deal() {}, dock() {}, on: () => false, set() {}};

  const cards = [...document.querySelectorAll(".card")];
  const N = cards.length;
  if (!N) return;

  const faces = cards.map(c => ({
    id: c.dataset.id, name: c.dataset.name,
    glyph: c.querySelector(".card-glyph").textContent,
    blurb: c.title || "",
  }));

  let sel = 0, open = false, deck = null;
  const pad = n => String(n).padStart(2, "0");

  const nameOut = document.getElementById("deck-name");
  const idxOut = document.getElementById("deck-idx");
  const gimbal = document.getElementById("gimbal");

  function paint() {
    cards.forEach((c, i) => {
      const on = i === sel;
      c.setAttribute("aria-selected", on ? "true" : "false");
      c.tabIndex = on ? 0 : -1;
    });
    const f = faces[sel];
    if (nameOut && nameOut.textContent !== f.name) {
      nameOut.textContent = f.name;
      // replay the underline's draw-in: drop the animation for a frame
      nameOut.classList.add("redraw"); void nameOut.offsetWidth; nameOut.classList.remove("redraw");
    }
    if (idxOut) idxOut.textContent = `${pad(sel + 1)} / ${pad(N)}`;
    if (gimbal) gimbal.setAttribute("aria-valuenow", String(sel + 1));
    if (gimbal) gimbal.setAttribute("aria-valuetext", f.name);
  }

  /* fromDeck stops the round trip: the deck reports a new front face, we
     paint, and we must not turn the deck again in response to our own paint. */
  function setSel(i, fromDeck) {
    sel = ((i % N) + N) % N;
    paint();
    if (!fromDeck && deck && deck.index() !== sel) deck.select(sel);
  }

  // ---------------------------------------------------------------- deck --
  const host = document.getElementById("deck");
  const arm = document.getElementById("g-arm");
  if (host && window.Deck) {
    deck = window.Deck.mount(host, {
      faces,
      onSelect: i => setSel(i, true),
      onOpen: i => { setSel(i, true); openSection(); },
      onPass: () => { if (!open) Sfx.snap(); },       // one detent per face
      // the knob sits where the front face is: face i at i*step clockwise
      onAngle: a => { if (arm) arm.setAttribute("transform", `rotate(${(-a).toFixed(2)} 60 60)`); },
    });
  }

  /* click feedback on the control box: re-add .hit so the ring replays on
     every press, drop it when the ring is done */
  function hit(el, ms) {
    if (!el) return;
    el.classList.remove("hit"); void el.getBoundingClientRect(); el.classList.add("hit");
    clearTimeout(el._hitT); el._hitT = setTimeout(() => el.classList.remove("hit"), ms || 420);
  }
  ["deck-prev", "deck-next", "deck-go"].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.addEventListener("pointerdown", () => hit(b));
  });
  if (gimbal) gimbal.addEventListener("pointerdown", () => hit(gimbal, 260));

  const prev = document.getElementById("deck-prev");
  const next = document.getElementById("deck-next");
  if (prev) prev.addEventListener("click", () => setSel(sel - 1));
  if (next) next.addEventListener("click", () => setSel(sel + 1));
  const go = document.getElementById("deck-go");
  if (go) go.addEventListener("click", openSection);

  // -------------------------------------------------------------- gimbal --
  /* Grab the knob (or anywhere on the dial) and drag it round. One full turn of
     the knob is one full turn of the deck, so each section is 360/N degrees of
     knob travel and the tick marks are the faces. Let go and it snaps. */
  if (gimbal && deck) {
    const ticks = document.getElementById("g-ticks");
    const NS = "http://www.w3.org/2000/svg";
    for (let i = 0; i < N; i++) {
      const t = document.createElementNS(NS, "line");
      t.setAttribute("x1", "60"); t.setAttribute("y1", "11");
      t.setAttribute("x2", "60"); t.setAttribute("y2", i === 0 ? "3" : "6");
      t.setAttribute("transform", `rotate(${(i * 360 / N).toFixed(2)} 60 60)`);
      ticks.appendChild(t);
    }
    const bearing = e => {
      const r = gimbal.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      return Math.atan2(dx, -dy) * 180 / Math.PI;       // clockwise from 12 o'clock
    };
    let grabbing = false, last = 0;
    gimbal.addEventListener("pointerdown", e => {
      if (open || (e.button != null && e.button !== 0)) return;
      grabbing = true; last = bearing(e);
      deck.grab();
      gimbal.classList.add("held");
      gimbal.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    gimbal.addEventListener("pointermove", e => {
      if (!grabbing) return;
      const b = bearing(e);
      let d = b - last;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      last = b;
      deck.turn(-d);                                    // knob clockwise = deck forward
    });
    const letGo = e => {
      if (!grabbing) return;
      grabbing = false;
      gimbal.classList.remove("held");
      if (gimbal.hasPointerCapture && gimbal.hasPointerCapture(e.pointerId)) gimbal.releasePointerCapture(e.pointerId);
      deck.release();
    };
    gimbal.addEventListener("pointerup", letGo);
    gimbal.addEventListener("pointercancel", letGo);
    gimbal.addEventListener("keydown", e => {
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { setSel(sel + 1); e.preventDefault(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { setSel(sel - 1); e.preventDefault(); }
      else if (e.key === "Home") { setSel(0); e.preventDefault(); }
      else if (e.key === "End") { setSel(N - 1); e.preventDefault(); }
      else if (e.key === "Enter") { openSection(); e.preventDefault(); }
    });
  }

  // --------------------------------------------------------------- cards --
  cards.forEach((c, i) => {
    c.addEventListener("click", () => { if (i !== sel) Sfx.deal(); if (open) closeSection(); setSel(i); });
    c.addEventListener("dblclick", () => { setSel(i); openSection(); });
    c.addEventListener("keydown", e => {
      if (e.key === "Enter" && e.shiftKey) { setSel(i); openSection(); e.preventDefault(); }
      else if (e.key === "ArrowRight") { setSel(i + 1); cards[sel].focus(); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { setSel(i - 1); cards[sel].focus(); e.preventDefault(); }
    });
  });

  // ---------------------------------------------------------- dock / screen --
  const screen = document.getElementById("screen");
  const back = document.getElementById("screen-back");
  const scrName = document.getElementById("screen-name");
  const scrGlyph = document.getElementById("screen-glyph");
  const scrBlurb = document.getElementById("screen-blurb");
  const wrap = document.getElementById("deck-wrap");
  const dock = document.getElementById("dock-slot");
  const dockEmpty = document.getElementById("dock-empty");

  /* Move the deck element between the stage and the dock, FLIP-style: measure
     where it is, reparent, measure where it landed, start it at the old box and
     let it glide to the new one. Reparenting keeps one deck, one state. */
  function moveDeck(to, before) {
    if (!host || !to) return;
    const a = host.getBoundingClientRect();
    to.insertBefore(host, before || null);
    if (deck) deck.setMini(to === dock);
    if (reduce) return;
    const b = host.getBoundingClientRect();
    if (!b.width || !b.height) return;
    const sx = a.width / b.width, sy = a.height / b.height;
    host.style.transformOrigin = "0 0";
    host.style.transition = "none";
    host.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${sx}, ${sy})`;
    host.getBoundingClientRect();                        // commit the start frame
    host.style.transition = "transform .62s cubic-bezier(.36,.05,.16,1)";
    host.style.transform = "none";
    const done = () => { host.style.transition = ""; host.style.transform = ""; host.removeEventListener("transitionend", done); };
    host.addEventListener("transitionend", done);
  }

  function openSection() {
    if (open) return;
    const f = faces[sel];
    open = true;
    hub.dataset.state = "screen";
    if (screen) screen.hidden = false;
    if (scrName) scrName.textContent = f.name;
    if (scrGlyph) scrGlyph.textContent = f.glyph;
    if (scrBlurb) scrBlurb.textContent = f.blurb;
    if (dockEmpty) dockEmpty.hidden = true;
    moveDeck(dock);
    if (dock) { dock.classList.add("live"); dock.setAttribute("role", "button");
                dock.tabIndex = 0; dock.setAttribute("aria-label", "Back to deck"); }
    Sfx.dock();
    document.dispatchEvent(new CustomEvent("hub:open", {detail: {id: f.id, name: f.name}}));
    if (back) back.focus();
  }
  function closeSection() {
    if (!open) return;
    open = false;
    hub.dataset.state = "deck";
    if (screen) screen.hidden = true;
    moveDeck(wrap, wrap && wrap.firstChild);
    if (dock) { dock.classList.remove("live"); dock.removeAttribute("role");
                dock.removeAttribute("tabindex"); dock.removeAttribute("aria-label"); }
    if (dockEmpty) dockEmpty.hidden = false;
    Sfx.dock();
    document.dispatchEvent(new CustomEvent("hub:close"));
    cards[sel].focus();
  }
  if (back) back.addEventListener("click", closeSection);
  if (dock) {
    dock.addEventListener("click", () => { if (open) closeSection(); });
    dock.addEventListener("keydown", e => {
      if (open && (e.key === "Enter" || e.key === " ")) { closeSection(); e.preventDefault(); }
    });
  }
  document.addEventListener("keydown", e => { if (e.key === "Escape" && open) closeSection(); });

  setSel(0, true);

  // --------------------------------------------------------------- sound --
  /* Same control as nathanherling.com's #sndToggle, but a real mute: off means
     every cue is silent, not just the hover bed. The setting persists. */
  const snd = document.getElementById("sndToggle");
  if (snd) {
    const show = on => {
      const label = on ? "Sound on" : "Sound off";
      snd.setAttribute("aria-pressed", on ? "true" : "false");
      snd.setAttribute("aria-label", label);
      snd.title = label;
    };
    show(Sfx.on());
    snd.addEventListener("click", () => { Sfx.set(!Sfx.on()); show(Sfx.on()); if (Sfx.on()) Sfx.deal(); });
  }

  // ------------------------------------------------------------------ TV --
  /* Ten seconds a picture, static break on the change -- the same grain the
     sign-in button uses. Nothing to show: it just stays on. */
  const img = document.getElementById("tv-img");
  const pic = document.getElementById("tv-pic");
  const layers = [...document.querySelectorAll(".tv-l")];
  const tvScreen = document.querySelector(".tv-screen");
  /* RGB shear: a 260 ms tear every 3-8 s, plus one on every channel change.
     Restarting the class needs a reflow in between or the animation won't rerun. */
  function shear() {
    if (reduce || !tvScreen || document.hidden) return;
    tvScreen.classList.remove("shear"); void tvScreen.offsetWidth; tvScreen.classList.add("shear");
    setTimeout(() => tvScreen.classList.remove("shear"), 280);
  }
  (function shearLoop() { setTimeout(() => { shear(); shearLoop(); }, 3000 + Math.random() * 5000); })();
  const fx = document.getElementById("tv-fx");
  const chOut = document.getElementById("tv-ch");
  const tvName = document.getElementById("tv-name");
  const countOut = document.getElementById("tv-count");
  const DWELL = 10000, BREAK = 620;

  let shots = [], ch = -1, noise = 1, raf = null, field = 0, timer = null;
  const hash = (i, r) => { const x = Math.sin(i * 127.1 + r * 311.7) * 43758.5453; return x - Math.floor(x); };

  function drawNoise() {
    raf = null;
    if (!fx) return;
    const r = fx.getBoundingClientRect();
    if (!r.width) return;
    const d2 = window.devicePixelRatio || 1;
    if (fx.width !== Math.round(r.width * d2)) {
      fx.width = Math.round(r.width * d2); fx.height = Math.round(r.height * d2);
    }
    const g = fx.getContext("2d");
    g.setTransform(d2, 0, 0, d2, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    if (noise > 0.01) {
      const px = 3 + 4 * noise;
      const cols = Math.max(1, Math.round(r.width / px)), rows = Math.max(1, Math.round(r.height / px));
      const cw = r.width / cols, chh = r.height / rows;
      const peak = 0.10 + 0.85 * noise;
      field++;
      for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
        const n = hash(x * rows + y, field);
        const a = Math.round(Math.pow(n, 1.6) * peak * 4) / 4;
        if (a < 0.04) continue;
        g.fillStyle = n < 0.46 ? `rgba(0,0,0,${(a * 0.7).toFixed(3)})`
                     : n < 0.88 ? `rgba(150,255,190,${(a * 0.5).toFixed(3)})`
                                : `rgba(255,255,255,${a.toFixed(3)})`;
        g.fillRect(x * cw, y * chh, cw, chh);
      }
    }
    if (noise > 0.01 && !reduce) raf = requestAnimationFrame(drawNoise);
  }
  const kick = () => { if (!raf && !reduce) raf = requestAnimationFrame(drawNoise); };

  function show(i) {
    if (!shots.length) return;
    ch = ((i % shots.length) + shots.length) % shots.length;
    const src = shots[ch];
    noise = 1; kick();
    if (pic) pic.classList.remove("on");
    setTimeout(() => {
      layers.forEach(l => { l.src = src; });
      if (pic) pic.classList.add("on");
      shear();
      if (chOut) chOut.textContent = "CH " + String(ch + 1).padStart(2, "0");
      if (tvName) tvName.textContent = src.split("/").pop();
      const t0 = performance.now();
      (function fade() {
        const k = Math.min(1, (performance.now() - t0) / 420);
        noise = 0.18 * (1 - k);
        if (k < 1) requestAnimationFrame(fade); else noise = 0.05;
        kick();
      })();
    }, reduce ? 0 : BREAK * 0.45);
    clearTimeout(timer);
    timer = setTimeout(() => show(ch + 1), DWELL);
  }

  async function bootTV() {
    noise = 1; kick();
    try { shots = (await PFD.api("/api/tv")).images || []; }
    catch (e) { shots = []; }
    if (countOut) countOut.textContent = `${shots.length} src`;
    if (!shots.length) {
      if (tvName) tvName.textContent = "no signal";
      if (chOut) chOut.textContent = "CH --";
      noise = 0.85; kick();
      return;
    }
    show(0);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { clearTimeout(timer); if (raf) { cancelAnimationFrame(raf); raf = null; } }
    else { kick(); if (shots.length) timer = setTimeout(() => show(ch + 1), DWELL); }
  });

  bootTV();
})();
