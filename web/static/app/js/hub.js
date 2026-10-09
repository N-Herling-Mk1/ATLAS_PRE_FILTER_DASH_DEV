/* hub.js -- the navigation surface. mk25; mk47 adds the section-view side panel.

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
  /* Circuit tracks, same gesture as the sign-in button. The canvas lives on the
     stage rather than on the deck, so the tracks stay where the face was while
     the deck glides off to the dock. */
  const stageEl = document.querySelector(".stage");
  const trace = window.Traces ? window.Traces.attach(stageEl) : {fire() {}, clear() {}};
  const btnfx = window.BtnFx ? window.BtnFx.mount(stageEl) : {watch() {}};

  // where the front face sits, in stage coordinates
  function faceRect() {
    const f = document.querySelector(".deck-face.face, .placard.face");
    if (!f || !stageEl) return null;
    const a = f.getBoundingClientRect(), b = stageEl.getBoundingClientRect();
    if (!a.width) return null;
    return {x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height};
  }

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

  /* The gimbal's own controls get the sign-in button's gesture: static on
     hover, static driven to full on press, tracks sprawling out of the edge.
     btnfx draws the field, traces.js draws the tracks -- one effect, one owner,
     rather than a second copy of either. */
  function armButton(el, bleed) {
    if (!el) return;
    // mk49: no circuit sprawl off the buttons -- only the green glare
    btnfx.watch(el, r => trace.fire(r, {bleed: bleed || 56, tracks: false}));
  }

  const prev = document.getElementById("deck-prev");
  const next = document.getElementById("deck-next");
  armButton(prev, 48); armButton(next, 48);
  if (prev) prev.addEventListener("click", () => setSel(sel - 1));
  if (next) next.addEventListener("click", () => setSel(sel + 1));
  const go = document.getElementById("deck-go");
  armButton(go, 64);
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
    // mk46: in section view the cards are the section switcher -- a click opens
    // that section in place rather than closing back to the deck
    c.addEventListener("click", () => {
      if (i !== sel) Sfx.deal();
      setSel(i);
      if (open) showFace();
    });
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

  /* Show the stub for this section and hide the rest. Every sheet is in the
     DOM from render; swapping `hidden` is cheaper and steadier than building
     markup per open, and it means a half-built sheet can keep its own state. */
  function showSheet(id) {
    const sheets = document.querySelectorAll(".screen-body .sheet");
    let found = false;
    sheets.forEach(el => {
      const on = el.dataset.sheet === id;
      el.hidden = !on;
      if (on && el.children.length) found = true;
    });
    const fb = document.getElementById("sheet-fallback");
    if (fb) fb.hidden = found;
  }

  /* mk46 section view: the rail and the band fold into one top bar (half-size
     TV, the cards as a switcher, the nav) and the section takes the full width.
     The deck no longer glides into the dock -- it stays on the landing view,
     hidden with it, and is exactly where it was when Home brings it back. */
  // ---------------------------------------------------------- side panel --
  /* mk47: the section view keeps a side panel under the half-size TV. It holds
     the open section's outline: sections/_side/<id>.html when there is one
     (EDA: the Hygiene / Exploration layers), otherwise a list built here from
     the sheet's own "Planned" items so no section comes up with an empty rail. */
  const sideBody = document.getElementById("side-body");
  const sideName = document.getElementById("side-name");
  const sideGlyph = document.getElementById("side-glyph");

  function buildOutline(box, id) {
    const sheet = document.querySelector(`.screen-body .sheet[data-sheet="${id}"]`);
    const items = sheet ? [...sheet.querySelectorAll(".stub-plan > li")] : [];
    if (!items.length) {
      box.innerHTML = '<p class="ol-note">No outline for this section yet.</p>';
      return;
    }
    const ol = document.createElement("ol"); ol.className = "ol-layers";
    const layer = document.createElement("li"); layer.className = "ol-layer";
    layer.innerHTML = '<div class="ol-lh"><span class="ol-n">&middot;</span><b>Planned</b></div>';
    const ul = document.createElement("ul"); ul.className = "ol-items";
    items.forEach((li, k) => {
      if (!li.id) li.id = `${id}-plan-${k}`;
      const b = li.querySelector("b");
      const row = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button"; btn.dataset.jump = "#" + li.id;
      const t = document.createElement("span"); t.textContent = b ? b.textContent : `item ${k + 1}`;
      const st = document.createElement("i"); st.className = "st st-planned"; st.textContent = "planned";
      btn.append(t, st); row.appendChild(btn); ul.appendChild(row);
    });
    layer.appendChild(ul); ol.appendChild(layer); box.appendChild(ol);
  }

  function showOutline(f) {
    if (sideName) sideName.textContent = f.name;
    if (sideGlyph) sideGlyph.textContent = f.glyph;
    if (!sideBody) return;
    sideBody.querySelectorAll(".outline").forEach(box => {
      const on = box.dataset.outline === f.id;
      if (on && !box.firstElementChild) buildOutline(box, f.id);
      box.hidden = !on;
    });
    sideBody.scrollTop = 0;
  }

  // flash the thing the outline pointed at, so the eye lands on it
  function ping(el) {
    if (!el) return;
    el.classList.remove("ol-ping"); void el.offsetWidth; el.classList.add("ol-ping");
    clearTimeout(el._pingT); el._pingT = setTimeout(() => el.classList.remove("ol-ping"), 1300);
  }
  function jumpTo(sel) {
    const body = document.getElementById("screen-body");
    const el = body && body.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({behavior: reduce ? "auto" : "smooth", block: "start"});
    ping(el);
    return el;
  }
  if (sideBody) sideBody.addEventListener("click", e => {
    const btn = e.target.closest("button[data-jump], button[data-sort]");
    if (!btn) return;
    sideBody.querySelectorAll("[aria-current]").forEach(x => x.removeAttribute("aria-current"));
    btn.setAttribute("aria-current", "true");
    if (btn.dataset.sort) {
      /* a sort only means something once there are graphs: before the first
         run, point at the Generate button instead of sorting an empty grid */
      const results = document.getElementById("eda-results");
      const sortSel = document.getElementById("eda-sort");
      if (!results || results.hidden || !sortSel) { jumpTo("#eda-go"); return; }
      sortSel.value = btn.dataset.sort;
      sortSel.dispatchEvent(new Event("change", {bubbles: true}));
      jumpTo("#eda-tools");
      return;
    }
    const target = btn.dataset.jump;
    if (target === "#eda-grid") {
      const results = document.getElementById("eda-results");
      if (!results || results.hidden) { jumpTo("#eda-go"); return; }
    }
    jumpTo(target);
  });

  function showFace() {
    const f = faces[sel];
    if (scrName) scrName.textContent = f.name;
    if (scrGlyph) scrGlyph.textContent = f.glyph;
    if (scrBlurb) scrBlurb.textContent = f.blurb;
    showSheet(f.id);
    showOutline(f);
    document.dispatchEvent(new CustomEvent("hub:open", {detail: {id: f.id, name: f.name}}));
  }

  function openSection() {
    if (open) { showFace(); return; }
    // inward: the tracks write themselves across the panel the section is
    // opening into, rather than spraying off its edges
    // mk49: a bigger box (half again per side) and a harder glare with streaks
    trace.fire(faceRect(), {bleed: 190, inward: true, grow: 0.5, glare: 1.9});
    open = true;
    hub.dataset.state = "screen";
    if (screen) screen.hidden = false;
    showFace();
    Sfx.dock();
    if (back) back.focus();
  }
  function closeSection() {
    if (!open) return;
    open = false;
    hub.dataset.state = "deck";
    if (screen) screen.hidden = true;
    Sfx.dock();
    document.dispatchEvent(new CustomEvent("hub:close"));
    cards[sel].focus();
  }
  if (back) back.addEventListener("click", closeSection);
  const navHome = document.getElementById("nav-home");
  if (navHome) navHome.addEventListener("click", closeSection);
  // the half-size TV in the top bar is Home too
  const railTv = document.getElementById("rail-tv");
  if (railTv) railTv.addEventListener("click", () => { if (open) closeSection(); });
  if (dock) {
    dock.addEventListener("click", () => { if (open) closeSection(); });
    dock.addEventListener("keydown", e => {
      if (open && (e.key === "Enter" || e.key === " ")) { closeSection(); e.preventDefault(); }
    });
  }
  // Escape closes the section unless something inside it (an enlarged
  // feature, say) handled it first and called preventDefault
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && open && !e.defaultPrevented) closeSection();
  });

  setSel(0, true);

  // ------------------------------------------------------- framed pages --
  /* mk49: a framed external page is shown whole, scaled down, so nothing in it
     needs scrolling. The frame is laid out at its declared size (data-vw x
     data-vh, the page's own full size -- it is another origin, so it cannot be
     measured from here) and scaled to the height the sheet has. Sizes go on
     through the CSSOM because the CSP rules out style attributes. */
  document.querySelectorAll(".embed").forEach(box => {
    const view = box.querySelector(".embed-view");
    const fr = view && view.querySelector("iframe[data-vw]");
    if (!fr) return;
    const vw = +fr.dataset.vw, vh = +fr.dataset.vh;
    const fit = () => {
      const H = box.clientHeight, W = box.clientWidth;
      if (!H || !W) return;                       // sheet not on screen yet
      const side = W > 700 ? 250 : 0;              // room kept for the link column
      const s = Math.max(0.2, Math.min(1, (H - 2) / vh, (W - side - 2) / vw));
      fr.style.width = vw + "px"; fr.style.height = vh + "px";
      fr.style.transform = `scale(${s.toFixed(4)})`;
      view.style.width = Math.round(vw * s) + "px";
      view.style.height = Math.round(vh * s) + "px";
    };
    if (window.ResizeObserver) new ResizeObserver(fit).observe(box);
    window.addEventListener("resize", fit);
    document.addEventListener("hub:open", () => requestAnimationFrame(fit));
    fit();
  });

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
  /* RGB shear: a short tear. Restarting the class needs a reflow in between or
     the animation will not rerun. Scheduled by the glitch budget below -- it no
     longer runs on a loop of its own, which is what made it periodic. */
  function shear(ms) {
    if (reduce || !tvScreen || document.hidden) return;
    tvScreen.classList.remove("shear"); void tvScreen.offsetWidth; tvScreen.classList.add("shear");
    setTimeout(() => tvScreen.classList.remove("shear"), ms || 280);
  }
  const fx = document.getElementById("tv-fx");
  const chOut = document.getElementById("tv-ch");
  const tvName = document.getElementById("tv-name");
  const countOut = document.getElementById("tv-count");
  const DWELL = 10000, BREAK = 620;

  let shots = [], ch = -1, noise = 1, raf = null, field = 0, timer = null;
  let roll = null, glitches = [];

  /* How the tube behaves once a picture is up. Static belongs to the CHANGE,
     not to the picture -- so between changes the screen is clear, apart from a
     budget of brief glitches. CLEAR is the share of the dwell with nothing on
     it at all; the rest is spent on tears and rolls placed at random, so the
     interval between them is never the same twice. A fixed-period loop is what
     makes an effect read as a loop. */
  const CLEAR = 0.75;
  const rnd2 = (a, b) => a + Math.random() * (b - a);

  function clearGlitches() {
    glitches.forEach(clearTimeout);
    glitches = [];
    roll = null;
  }

  function scheduleGlitches(msLeft) {
    clearGlitches();
    if (reduce || msLeft < 800) return;
    let budget = msLeft * (1 - CLEAR);
    const plan = [];
    while (budget > 200) {
      const isShear = Math.random() < 0.55;
      const dur = isShear ? rnd2(180, 320) : rnd2(420, 1000);
      if (dur > budget) break;
      budget -= dur;
      plan.push({isShear, dur});
    }
    /* Placement: rather than picking random starts and shoving collisions
       apart -- which drops any event landing too late, and measured 20%
       coverage with some dwells as low as 5% -- take the time NOT spent on
       effects and cut it into n+1 random gaps. Every event then fits by
       construction, coverage equals the budget, and the gaps are still
       different every time. */
    const spent = plan.reduce((t, q) => t + q.dur, 0);
    const gaps = plan.map(() => Math.random()).concat([Math.random(), Math.random()]);
    const gSum = gaps.reduce((a, b) => a + b, 0) || 1;
    const free = Math.max(0, msLeft - spent);
    let at = free * (gaps[0] / gSum);
    plan.forEach((q, k) => {
      const start = at;
      at += q.dur + free * (gaps[k + 1] / gSum);
      glitches.push(setTimeout(() => {
        if (document.hidden) return;
        if (q.isShear) shear(q.dur);
        else { roll = {t0: performance.now(), dur: q.dur}; kick(); }
      }, start));
    });
  }
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

    /* Cathode roll: the bright seam of a frame that did not quite lock,
       travelling down the tube. Drawn as a soft band plus a thin hot line at
       its leading edge, with a little static riding along so it reads as the
       picture losing hold rather than a light sweeping over it. */
    let rollY = -1;
    if (roll) {
      const k = (performance.now() - roll.t0) / roll.dur;
      if (k >= 1) { roll = null; }
      else {
        rollY = (k * 1.25 - 0.12) * r.height;
        noise = Math.max(noise, 0.10 + 0.06 * Math.sin(k * Math.PI));
      }
    }

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
    if (rollY >= 0) {
      const bandH = r.height * 0.16;
      const grd = g.createLinearGradient(0, rollY - bandH, 0, rollY + bandH * 0.4);
      grd.addColorStop(0, "rgba(180,255,214,0)");
      grd.addColorStop(0.62, "rgba(180,255,214,.10)");
      grd.addColorStop(0.88, "rgba(226,255,238,.20)");
      grd.addColorStop(1, "rgba(180,255,214,0)");
      g.fillStyle = grd;
      g.fillRect(0, rollY - bandH, r.width, bandH * 1.4);
      g.fillStyle = "rgba(233,255,243,.35)";
      g.fillRect(0, rollY, r.width, 1.5);
    }
    if ((noise > 0.01 || roll) && !reduce) raf = requestAnimationFrame(drawNoise);
  }
  const kick = () => { if (!raf && !reduce) raf = requestAnimationFrame(drawNoise); };

  function show(i) {
    if (!shots.length) return;
    ch = ((i % shots.length) + shots.length) % shots.length;
    const src = shots[ch];
    noise = 1; kick();
    clearGlitches();
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
        // all the way to zero: the residual 0.05 left a permanent crawl on the
        // picture, which is what made the static feel like a property of the
        // TV rather than of the change
        if (k < 1) requestAnimationFrame(fade); else noise = 0;
        kick();
      })();
      scheduleGlitches(DWELL - BREAK);
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
    if (document.hidden) { clearTimeout(timer); clearGlitches();
      if (raf) { cancelAnimationFrame(raf); raf = null; } }
    else { kick(); if (shots.length) timer = setTimeout(() => show(ch + 1), DWELL); }
  });

  bootTV();
})();
