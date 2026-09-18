/* hub.js -- the navigation surface. mk23.

   Three sets, one selection.

     rail   TV over console, down the left. Never changes, whatever else does.
     band   small cards across the top. A card SELECTS; it does not open.
     stage  the deck, or the section the deck opened.

   The card is the selector and the deck face is the door -- the same split the
   personal site uses, and the reason the band can stay put while the stage
   swaps: you never lose the selector to open something.

   `sel` is the only selection state. The cards, the deck, the readout and the
   console line all read it.
*/
"use strict";
(() => {
  const hub = document.getElementById("hub");
  if (!hub) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const cards = [...document.querySelectorAll(".card")];
  const N = cards.length;
  if (!N) return;

  const faces = cards.map(c => ({
    id: c.dataset.id, name: c.dataset.name,
    glyph: c.querySelector(".card-glyph").textContent,
    blurb: c.title || "",
  }));

  let sel = 0, open = false, deck = null;

  const nameOut = document.getElementById("deck-name");
  const idxOut = document.getElementById("deck-idx");
  const selOut = document.getElementById("hub-sel");

  function paint() {
    cards.forEach((c, i) => c.setAttribute("aria-selected", i === sel ? "true" : "false"));
    const f = faces[sel];
    if (nameOut) nameOut.textContent = f.name;
    if (idxOut) idxOut.textContent = `${sel + 1} / ${N}`;
    if (selOut) selOut.textContent = f.name;
  }

  /* fromDeck stops the round trip: the deck reports a new front face, we paint,
     and we must not turn the deck again in response to our own paint. */
  function setSel(i, fromDeck) {
    sel = ((i % N) + N) % N;
    paint();
    if (!fromDeck && deck && deck.index() !== sel) deck.select(sel);
  }

  // ---------------------------------------------------------------- deck --
  const host = document.getElementById("deck");
  if (host && window.Deck) {
    deck = window.Deck.mount(host, {
      faces,
      onSelect: i => setSel(i, true),
      onOpen: i => { setSel(i, true); openSection(); },
    });
  }

  const prev = document.getElementById("deck-prev");
  const next = document.getElementById("deck-next");
  if (prev) prev.addEventListener("click", () => setSel(sel - 1));
  if (next) next.addEventListener("click", () => setSel(sel + 1));
  const go = document.getElementById("deck-go");
  if (go) go.addEventListener("click", openSection);

  // --------------------------------------------------------------- cards --
  cards.forEach((c, i) => {
    c.addEventListener("click", () => setSel(i));       // selector only
    c.addEventListener("dblclick", () => { setSel(i); openSection(); });
    c.addEventListener("keydown", e => {
      if (e.key === "Enter" && e.shiftKey) { setSel(i); openSection(); e.preventDefault(); }
      else if (e.key === "ArrowRight") { cards[(i + 1) % N].focus(); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { cards[(i - 1 + N) % N].focus(); e.preventDefault(); }
    });
  });

  // -------------------------------------------------------------- screen --
  const screen = document.getElementById("screen");
  const back = document.getElementById("screen-back");
  const scrName = document.getElementById("screen-name");
  const scrGlyph = document.getElementById("screen-glyph");
  const scrBlurb = document.getElementById("screen-blurb");

  function openSection() {
    const f = faces[sel];
    open = true;
    hub.dataset.state = "screen";
    if (screen) screen.hidden = false;
    if (scrName) scrName.textContent = f.name;
    if (scrGlyph) scrGlyph.textContent = f.glyph;
    if (scrBlurb) scrBlurb.textContent = f.blurb;
    document.dispatchEvent(new CustomEvent("hub:open", {detail: {id: f.id, name: f.name}}));
    if (back) back.focus();
  }
  function closeSection() {
    open = false;
    hub.dataset.state = "deck";
    if (screen) screen.hidden = true;
    document.dispatchEvent(new CustomEvent("hub:close"));
    if (deck) deck.relayout();                          // it was display:none; re-measure
    cards[sel].focus();
  }
  if (back) back.addEventListener("click", closeSection);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && open) closeSection(); });

  setSel(0, true);

  // ------------------------------------------------------------------ TV --
  /* Ten seconds a picture, static break on the change -- the same grain the
     sign-in button uses. Nothing to show: it just stays on. */
  const img = document.getElementById("tv-img");
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
    if (img) img.classList.remove("on");
    setTimeout(() => {
      if (img) { img.src = src; img.classList.add("on"); }
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

  // the console mirrors what the title block already tracks
  const mirror = (from, to) => {
    const a = document.getElementById(from), b = document.getElementById(to);
    if (!a || !b) return;
    const sync = () => { b.textContent = a.textContent; };
    new MutationObserver(sync).observe(a, {childList: true, characterData: true, subtree: true});
    sync();
  };
  mirror("tb-who", "hub-who");
  mirror("tb-idle", "hub-idle");

  bootTV();
})();
