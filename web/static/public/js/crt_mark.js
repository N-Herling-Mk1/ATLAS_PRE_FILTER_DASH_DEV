/* crt_mark.js -- the burn-in mark on the gate console.

   A 64x64 pixel grid that holds two bitmaps: the proton mark, and the text
   "13.6 TeV". It sits on one, scrambles cell by cell into the other, sits on
   that, scrambles back, and loops. Each cell gets its own delay, so the change
   sweeps through as noise rather than a crossfade -- during its own moment a
   cell shows random phosphor, not an average of the two states.

   Timing: 9 s on the mark, 1.8 s scrambling, 6 s on the text, 1.8 s back. Both
   holds and the scramble are long enough to be read rather than caught.

   The canvas is 64x64 actual pixels and CSS scales it up with
   image-rendering: pixelated, so the blocks stay square at any size.

   Reduced motion draws the proton mark and stops. If the image cannot be
   loaded, nothing is drawn -- the mark is decoration. */
"use strict";
(() => {
  const cv = document.getElementById("crt-mark");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const N = 64;
  cv.width = N; cv.height = N;

  const SRC = cv.dataset.src;
  const INK = [77, 255, 122];
  const LEV = 4;                                   // 5 alpha levels, as the sprite
  const HOLD_A = 9000, MORPH = 1800, HOLD_B = 6000; // one full loop = 18.6 s
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const q = a => Math.round(a * LEV) / LEV;
  let A = null, B = null, delay = null, raf = null, t0 = 0;

  // per-cell scramble order, fixed for the session so the two directions rhyme
  function makeDelays() {
    delay = new Float32Array(N * N);
    for (let i = 0; i < delay.length; i++) delay[i] = Math.random();
  }

  // the text face: drawn into the same grid, then thresholded to the same levels
  function makeText() {
    const c = document.createElement("canvas");
    c.width = N; c.height = N;
    const g = c.getContext("2d");
    g.clearRect(0, 0, N, N);
    g.fillStyle = "#fff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = '700 17px "Share Tech Mono", ui-monospace, monospace';
    g.fillText("13.6", N / 2, N / 2 - 10);
    g.font = '700 17px "Share Tech Mono", ui-monospace, monospace';
    g.fillText("TeV", N / 2, N / 2 + 11);
    const d = g.getImageData(0, 0, N, N).data;
    const out = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const a = d[i * 4 + 3] / 255;
      out[i] = a < 0.34 ? 0 : q(Math.min(1, a * 1.25));
    }
    return out;
  }

  function fromImage(img) {
    const c = document.createElement("canvas");
    c.width = N; c.height = N;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    const out = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) out[i] = q(d[i * 4 + 3] / 255);
    return out;
  }

  function paint(grid) {
    const im = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      im.data[i * 4] = INK[0];
      im.data[i * 4 + 1] = INK[1];
      im.data[i * 4 + 2] = INK[2];
      im.data[i * 4 + 3] = Math.round(Math.min(1, grid[i]) * 235);
    }
    ctx.putImageData(im, 0, 0);
  }

  const frame = new Float32Array(N * N);

  function mix(from, to, p) {
    // p 0..1 across the whole grid; each cell flips inside its own window
    for (let i = 0; i < N * N; i++) {
      // with the longer morph, spread the starts wider and shorten each cell's
      // own noise window, or every cell just sits in static for half a second
      const start = delay[i] * 0.72, local = (p - start) / 0.28;
      if (local <= 0) frame[i] = from[i];
      else if (local >= 1) frame[i] = to[i];
      else frame[i] = Math.random() < 0.45 ? q(0.25 + Math.random() * 0.75) : 0;
    }
    paint(frame);
  }

  function loop(now) {
    const t = (now - t0) % (HOLD_A + MORPH + HOLD_B + MORPH);
    if (t < HOLD_A) paint(A);
    else if (t < HOLD_A + MORPH) mix(A, B, (t - HOLD_A) / MORPH);
    else if (t < HOLD_A + MORPH + HOLD_B) paint(B);
    else mix(B, A, (t - HOLD_A - MORPH - HOLD_B) / MORPH);
    raf = requestAnimationFrame(loop);
  }

  function start() {
    makeDelays();
    B = makeText();
    paint(A);
    if (reduce) return;
    t0 = performance.now();
    raf = requestAnimationFrame(loop);
  }

  const img = new Image();
  img.onload = () => {
    A = fromImage(img);
    // wait for the mono face if it is still loading, so the text face is right
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(start, start);
    else start();
  };
  img.onerror = () => {};
  img.src = SRC;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
    else if (!raf && A && !reduce) { t0 = performance.now(); raf = requestAnimationFrame(loop); }
  });
})();
