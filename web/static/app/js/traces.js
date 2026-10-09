/* traces.js -- circuit tracks that sprawl out of an element's edge and withdraw.

   Lifted from the sign-in button so the deck can use the same gesture. Tracks
   leave the perimeter along its normal -- orthogonal runs with 45-degree
   elbows, a square pad at each corner, a via at the tip -- sprawl, hold, then
   shrink the far end back toward the pad.

   Retract direction matters: consuming the polyline from the PAD end instead
   leaves the outer half hanging in space, detached from the source. That is a
   track breaking off, not one retracting.

   API
     const fx = Traces.attach(hostEl);      // hostEl must be position:relative
     fx.fire(rect, {bleed, color, hot, inward, tracks, grow, glare});
       inward: tracks run INTO the rect and write across it, instead of
       sprawling out of its edge into the bleed.
       tracks: false -- mk49: no circuit tracks at all, only the green glare
               off the box's four sides (the buttons use this).
       grow:   mk49: inflate the rect by this fraction of its size per side
               before drawing, clamped to the host (the section segue).
       glare:  mk49: gain on the glare's brightness (1 = as before); above 1
               it also lays a horizontal and a vertical streak through the box.
     fx.clear();

   The canvas covers the host, not the source, so the source is free to move,
   dock or unmount while the tracks play out. */
"use strict";
(() => {
  const TAU = Math.PI * 2;
  const T_OUT = 360, T_HOLD = 110, T_BACK = 320;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function attach(host) {
    if (!host) return {fire() {}, clear() {}};
    let cv = host.querySelector(":scope > canvas.trace-fx");
    if (!cv) {
      cv = document.createElement("canvas");
      cv.className = "trace-fx";
      cv.setAttribute("aria-hidden", "true");
      host.appendChild(cv);
    }
    let tracks = [], endAt = 0, raf = null, rect = null, opt = {};

    /* ---- routing -------------------------------------------------------
       Tracks may not cross, and two that meet run parallel. Both fall out of
       ONE rule: no segment may come within PITCH of another. A crossing is
       distance zero, so forbidding the clearance forbids the crossing; and two
       tracks heading the same way get pushed to exactly PITCH apart, which is
       what running parallel looks like.

       A candidate run is re-rolled up to TRIES times; if nothing fits, the
       track STOPS there rather than being forced through something. Fewer,
       shorter tracks is the right failure - a board with a short trace is
       plausible, a board with two traces shorted together is not. */
    const TRIES = 14, START_TRIES = 24;

    function segDist(p, q, r2, s2) {
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
      const cr = (a, b) => a[0] * b[1] - a[1] * b[0];
      const dt = (a, b) => a[0] * b[0] + a[1] * b[1];
      const ptSeg = (p0, a, b) => {
        const ab = sub(b, a), L = dt(ab, ab);
        if (L === 0) return Math.hypot(...sub(p0, a));
        const t = Math.max(0, Math.min(1, dt(sub(p0, a), ab) / L));
        return Math.hypot(p0[0] - (a[0] + ab[0] * t), p0[1] - (a[1] + ab[1] * t));
      };
      const d1 = sub(q, p), d2 = sub(s2, r2), den = cr(d1, d2);
      if (Math.abs(den) > 1e-9) {
        const t = cr(sub(r2, p), d2) / den, u = cr(sub(r2, p), d1) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;   // they cross
      }
      return Math.min(ptSeg(p, r2, s2), ptSeg(q, r2, s2), ptSeg(r2, p, q), ptSeg(s2, p, q));
    }

    function build(r, bleed, inwardFlag) {
      tracks = [];
      const inward = !!inwardFlag;
      const n = inward ? 20 : 14;
      const room = inward ? Math.max(24, Math.min(r.w, r.h) * 0.42)
                          : Math.max(24, bleed - 10);
      const PITCH = Math.max(6, room * 0.075);
      const pad = 6;
      const clampX = v => Math.min(r.x + r.w - pad, Math.max(r.x + pad, v));
      const clampY = v => Math.min(r.y + r.h - pad, Math.max(r.y + pad, v));
      const placed = [], starts = [];
      const snap = v => Math.round(v / PITCH) * PITCH;   // runs land on the pitch

      for (let i = 0; i < n; i++) {
        const side = i % 4;
        let x = 0, y = 0, dx = 0, dy = 0, got = false;
        for (let a = 0; a < START_TRIES && !got; a++) {
          if (side === 0) { x = rnd(r.x + r.w * 0.10, r.x + r.w * 0.90); y = r.y; dx = 0; dy = -1; }
          else if (side === 2) { x = rnd(r.x + r.w * 0.10, r.x + r.w * 0.90); y = r.y + r.h; dx = 0; dy = 1; }
          else if (side === 1) { x = r.x + r.w; y = rnd(r.y + r.h * 0.15, r.y + r.h * 0.85); dx = 1; dy = 0; }
          else { x = r.x; y = rnd(r.y + r.h * 0.15, r.y + r.h * 0.85); dx = -1; dy = 0; }
          if (inward) { dx = -dx; dy = -dy; }
          /* A start needs clearance from other STARTS and from every segment
             already laid. Checking only against starts leaves a track free to
             begin right alongside someone else's run -- which is a short, just
             one that happens at the edge instead of in the middle. A degenerate
             segment [p, p] makes segDist do point-to-segment for us. */
          got = starts.every(s => Math.hypot(x - s[0], y - s[1]) >= PITCH * 1.5)
             && placed.every(([A, B]) => segDist([x, y], [x, y], A, B) >= PITCH);
        }
        if (!got) continue;
        starts.push([x, y]);

        const pts = [[x, y]];
        let cx = x, cy = y;
        const own = [];
        const runs = inward ? 4 : 3;
        for (let k = 0; k < runs; k++) {
          let laid = false;
          for (let a = 0; a < TRIES && !laid; a++) {
            const len = snap(inward ? rnd(room * 0.28, room * 0.60) : rnd(room * 0.15, room * 0.29));
            let mx = cx + dx * len, my = cy + dy * len;
            if (inward) { mx = clampX(mx); my = clampY(my); }
            const turn = Math.random() < 0.5 ? 1 : -1;
            const diag = snap(inward ? rnd(room * 0.14, room * 0.28) : rnd(room * 0.08, room * 0.16));
            const ndx = dx === 0 ? turn : dx, ndy = dy === 0 ? turn : dy;
            let ex = mx + (dx === 0 ? ndx : dx) * diag, ey = my + (dy === 0 ? ndy : dy) * diag;
            if (inward) { ex = clampX(ex); ey = clampY(ey); }
            if (Math.hypot(mx - cx, my - cy) < 2) continue;

            const cand = [[[cx, cy], [mx, my]], [[mx, my], [ex, ey]]];
            let ok = true;
            for (let si = 0; si < cand.length && ok; si++) {
              const [A, B] = cand[si];
              for (let j = 0; j < placed.length; j++) {
                /* Only the FIRST candidate shares a vertex with the track's
                   last segment, so only it is exempt. Exempting the second as
                   well let a track's elbow sit on top of its own previous
                   elbow -- not a crossing, but two of its own runs 2 px apart,
                   which on a board is the same short. */
                if (si === 0 && own.length && j === own[own.length - 1]) continue;
                if (segDist(A, B, placed[j][0], placed[j][1]) < PITCH) { ok = false; break; }
              }
            }
            if (!ok) continue;

            cand.forEach(c => { placed.push(c); own.push(placed.length - 1); });
            pts.push([mx, my], [ex, ey]);
            cx = ex; cy = ey;
            if (dx === 0) { dx = ndx; dy = 0; } else { dy = ndy; dx = 0; }
            laid = true;
          }
          if (!laid) break;     // stop the track rather than force it through
        }
        if (pts.length < 2) continue;

        const seg = [];
        let total = 0;
        for (let k = 1; k < pts.length; k++) {
          total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
          seg.push(total);
        }
        tracks.push({pts, seg, total, delay: Math.random() * 90, hot: Math.random() < 0.35});
      }
    }

    // walk the polyline between two length marks, emitting one path
    function span(g, t, from, to) {
      if (to <= from) return null;
      let started = false, tip = null;
      g.beginPath();
      for (let k = 1; k < t.pts.length; k++) {
        const a = t.seg[k - 2] || 0, b = t.seg[k - 1];
        if (b < from || a > to) continue;
        const p0 = t.pts[k - 1], p1 = t.pts[k], len = b - a;
        const u0 = Math.max(0, (from - a) / len), u1 = Math.min(1, (to - a) / len);
        const x0 = p0[0] + (p1[0] - p0[0]) * u0, y0 = p0[1] + (p1[1] - p0[1]) * u0;
        const x1 = p0[0] + (p1[0] - p0[0]) * u1, y1 = p0[1] + (p1[1] - p0[1]) * u1;
        if (!started) { g.moveTo(x0, y0); started = true; }
        g.lineTo(x1, y1);
        tip = [x1, y1];
      }
      g.stroke();
      return tip;
    }

    function frame(now) {
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
      if (now >= endAt) { tracks = []; cv.classList.remove("run"); return; }

      const t0 = endAt - (T_OUT + T_HOLD + T_BACK + 90);
      const ease = x => 1 - Math.pow(1 - x, 2.2);
      const col = opt.color || "98,255,147";
      g.save();
      g.lineCap = "square"; g.lineJoin = "miter";
      tracks.forEach(t => {
        const age = now - t0 - t.delay;
        if (age <= 0) return;
        let to;
        if (age < T_OUT) to = t.total * ease(age / T_OUT);
        else if (age < T_OUT + T_HOLD) to = t.total;
        else to = t.total * (1 - ease(Math.min(1, (age - T_OUT - T_HOLD) / T_BACK)));
        if (to < 1) return;
        const a = age < T_OUT + T_HOLD ? 1
                : 0.35 + 0.65 * (1 - (age - T_OUT - T_HOLD) / T_BACK);
        const c = t.hot ? (opt.hot || "255,255,255") : col;
        g.shadowBlur = 10; g.shadowColor = `rgba(${col},${(0.7 * a).toFixed(3)})`;
        g.strokeStyle = `rgba(${c},${(0.9 * a).toFixed(3)})`;
        g.lineWidth = t.hot ? 2 : 1.4;
        const tip = span(g, t, 0, to);
        g.shadowBlur = 0;
        g.fillStyle = `rgba(${c},${(0.8 * a).toFixed(3)})`;
        for (let k = 1; k < t.pts.length - 1; k++) {
          if (t.seg[k - 1] > to) continue;
          g.fillRect(t.pts[k][0] - 2, t.pts[k][1] - 2, 4, 4);
        }
        if (tip) {
          g.beginPath(); g.arc(tip[0], tip[1], t.hot ? 3 : 2.2, 0, TAU);
          g.fillStyle = `rgba(${c},${a.toFixed(3)})`; g.fill();
        }
      });

      // haze riding the source's own edge, swelling and settling with the sprawl
      if (rect) {
        const life = (now - t0) / (T_OUT + T_HOLD + T_BACK);
        const haze = Math.sin(Math.min(1, Math.max(0, life)) * Math.PI);
        if (haze > 0.01) {
          /* The breath: a green gradient pushed OUT of each edge, away from the
             box, and drawn back in as the tracks retract. One sine drives both
             the reach and the alpha, so it swells and settles as one movement
             rather than four independent fades.

             Four separate bands, not one big radial: a radial centred on the
             box washes the corners twice as hard as the edge midpoints, which
             reads as a glowing blob rather than as light coming off the sides.
             Each band leaves its own edge perpendicular. */
          const room = opt.bleed || 72;
          /* Grow INTO the cap rather than clipping against it: at
             min(room*.95, 14 + 86*haze) the reach hit the ceiling at haze 0.79
             and sat there for the middle 40% of the pulse -- the gradient
             stopped moving exactly when it should have been furthest out. */
          const far = Math.max(24, room * 0.95);
          const reach = 14 + (far - 14) * haze;
          const gain = opt.glare || 1;
          const a0 = Math.min(0.85, 0.34 * haze * gain);
          const band = (x, y, w, h, gx0, gy0, gx1, gy1) => {
            const gr = g.createLinearGradient(gx0, gy0, gx1, gy1);
            gr.addColorStop(0, `rgba(${col},${a0.toFixed(3)})`);
            gr.addColorStop(0.45, `rgba(${col},${(a0 * 0.30).toFixed(3)})`);
            gr.addColorStop(1, `rgba(${col},0)`);
            g.fillStyle = gr;
            g.fillRect(x, y, w, h);
          };
          const {x, y, w, h} = rect;
          band(x, y - reach, w, reach, 0, y, 0, y - reach);                 // up
          band(x, y + h, w, reach, 0, y + h, 0, y + h + reach);             // down
          band(x - reach, y, reach, h, x, 0, x - reach, 0);                 // left
          band(x + w, y, reach, h, x + w, 0, x + w + reach, 0);             // right

          /* mk49, gain > 1 only: one horizontal and one vertical streak through
             the box's centre, running past the bands. Each is two gradients
             back to back so it is brightest at the box edge and gone at its
             tip; thin, so it reads as glare along an axis, not as a fill. */
          if (gain > 1) {
            const cx = x + w / 2, cy = y + h / 2;
            const run = reach * 1.9, th = Math.max(3, Math.min(w, h) * 0.05);
            const as = Math.min(0.9, 0.5 * haze * gain);
            const streak = (sx, sy, sw, sh, g0x, g0y, g1x, g1y) => {
              const gr = g.createLinearGradient(g0x, g0y, g1x, g1y);
              gr.addColorStop(0, `rgba(224,255,236,${as.toFixed(3)})`);
              gr.addColorStop(0.25, `rgba(${col},${(as * 0.55).toFixed(3)})`);
              gr.addColorStop(1, `rgba(${col},0)`);
              g.fillStyle = gr; g.fillRect(sx, sy, sw, sh);
            };
            streak(x - run, cy - th / 2, run, th, x, 0, x - run, 0);
            streak(x + w, cy - th / 2, run, th, x + w, 0, x + w + run, 0);
            streak(cx - th / 2, y - run, th, run, 0, y, 0, y - run);
            streak(cx - th / 2, y + h, th, run, 0, y + h, 0, y + h + run);
          }

          // and the edge itself, so the box keeps a hard boundary to push from
          const ring = (inset, width, blur, sa, ga) => {
            g.lineWidth = width;
            g.shadowBlur = blur; g.shadowColor = `rgba(${col},${Math.min(1, ga * haze * gain).toFixed(3)})`;
            g.strokeStyle = `rgba(${col},${Math.min(1, sa * haze * gain).toFixed(3)})`;
            g.strokeRect(x - inset + 0.5, y - inset + 0.5, w + inset * 2 - 1, h + inset * 2 - 1);
          };
          g.shadowBlur = 16; g.shadowColor = `rgba(${col},${(0.9 * haze).toFixed(3)})`;
          g.lineWidth = 2; g.strokeStyle = `rgba(224,255,236,${(0.85 * haze).toFixed(3)})`;
          g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          ring(3, 7, 30, 0.13, 0.55);
          g.shadowBlur = 0;
        }
      }
      g.restore();
      raf = requestAnimationFrame(frame);
    }

    return {
      fire(r, o) {
        if (reduce || !r || !r.w) return;
        opt = o || {};
        if (opt.grow) {
          // inflate about the centre, then keep the box inside the host
          const hb = host.getBoundingClientRect(), m = 8;
          const gx = r.w * opt.grow, gy = r.h * opt.grow;
          const x0 = Math.max(m, r.x - gx), y0 = Math.max(m, r.y - gy);
          const x1 = Math.min(hb.width - m, r.x + r.w + gx), y1 = Math.min(hb.height - m, r.y + r.h + gy);
          if (x1 - x0 > 20 && y1 - y0 > 20) r = {x: x0, y: y0, w: x1 - x0, h: y1 - y0};
        }
        rect = r;
        if (opt.tracks === false) tracks = [];
        else build(r, opt.bleed || 72, !!opt.inward);
        endAt = performance.now() + T_OUT + T_HOLD + T_BACK + 90;
        cv.classList.add("run");
        if (!raf) raf = requestAnimationFrame(frame);
      },
      clear() {
        tracks = []; endAt = 0; cv.classList.remove("run");
        if (raf) { cancelAnimationFrame(raf); raf = null; }
      },
    };
  }

  window.Traces = {attach};
})();
