/* arrive.js -- the sign-in wipe. The whole of it.
   The gate fades to black and navigates; this page opens still covered, and one
   vertical line sweeps across to REVEAL it -- hot core, flare ahead of the edge,
   sparks shed behind. The line crosses the screen exactly once in the whole
   sign-in, which is why the gate no longer draws one of its own.
   Runs only when the URL carries the ?login=1 marker set by /login, and only
   once -- common.js strips the marker straight after. No dependencies. */
"use strict";
(() => {
  if (new URLSearchParams(location.search).get("login") !== "1") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const cv = document.createElement("canvas");
  cv.setAttribute("aria-hidden", "true");
  Object.assign(cv.style, {position: "fixed", inset: "0", width: "100%", height: "100%",
                           pointerEvents: "none", zIndex: "60"});
  document.body.appendChild(cv);

  const g = cv.getContext("2d");
  const d2 = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = Math.round(W * d2); cv.height = Math.round(H * d2);
  g.setTransform(d2, 0, 0, d2, 0, 0);

  const DUR = 1150, LEAD = 240, rnd = (a, b) => a + Math.random() * (b - a);
  const sparks = [];
  let start = 0, prev = 0;

  function frame(now) {
    if (!start) { start = now; prev = now; }
    const dt = Math.min(48, now - prev); prev = now;
    const k = Math.min(1, (now - start) / DUR);
    const x = -LEAD + (W + 2 * LEAD) * (k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
    g.clearRect(0, 0, W, H);
    // everything AHEAD of the line is still covered; behind it the page shows
    g.fillStyle = "rgba(1,3,6,1)";
    g.fillRect(x, 0, Math.max(0, W - x), H);
    const fade = g.createLinearGradient(x - 240, 0, x, 0);
    fade.addColorStop(0, "rgba(1,3,6,0)");
    fade.addColorStop(1, "rgba(1,3,6,.78)");
    g.fillStyle = fade; g.fillRect(Math.max(0, x - 240), 0, Math.min(240, x + 240), H);
    // flare riding just ahead of the edge, over the black still to be lifted
    const fl = g.createLinearGradient(x, 0, x + LEAD, 0);
    fl.addColorStop(0, "rgba(63,195,255,.42)");
    fl.addColorStop(0.4, "rgba(63,195,255,.10)");
    fl.addColorStop(1, "rgba(63,195,255,0)");
    g.fillStyle = fl; g.fillRect(x, 0, LEAD, H);
    for (let i = 0; i < 7; i++)
      sparks.push({x, y: Math.random() * H, vx: -rnd(140, 820), vy: rnd(-120, 120),
                   life: rnd(240, 640), t0: now, hot: Math.random() < 0.35});
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i], age = now - s.t0;
      if (age > s.life) { sparks.splice(i, 1); continue; }
      s.x += s.vx * dt / 1000; s.y += s.vy * dt / 1000;
      const a = 1 - age / s.life, len = Math.max(3, Math.abs(s.vx) * 0.012);
      g.beginPath();
      g.strokeStyle = s.hot ? `rgba(255,154,31,${a})` : `rgba(63,195,255,${a})`;
      g.lineWidth = s.hot ? 1.6 : 1;
      g.moveTo(s.x, s.y); g.lineTo(s.x + len, s.y); g.stroke();
    }
    g.save(); g.shadowBlur = 38; g.shadowColor = "rgba(63,195,255,.95)";
    g.fillStyle = "rgba(63,195,255,.85)"; g.fillRect(x - 4, 0, 8, H);
    g.fillStyle = "#EAF8FF"; g.fillRect(x - 1.25, 0, 2.5, H);
    g.restore();
    if (k < 1) requestAnimationFrame(frame);
    else cv.remove();
  }
  requestAnimationFrame(frame);
})();
