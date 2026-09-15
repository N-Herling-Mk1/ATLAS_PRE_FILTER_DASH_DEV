/* gate.js -- sign-in page only. mk10.
   A transverse (r-phi) view of a barrel detector drawn in the browser.

   Load:        the detector lights up in a spiral sweep, then idles "at rest":
                the structure sits LIGHT and readable, with sparse, bright,
                edge-glowing activity over it -- occasional calorimeter cells,
                stray chamber hits, a pixelated readout gradient circling the
                inner detector layers, the toroid breathing, a rare cosmic muon.
   Hover:       the pointer probes the detector. Whatever is under it -- an inner
                detector layer, a calorimeter band, a muon station, a toroid coil --
                lights in a quantised pixel gradient centred on the cursor, and is
                named next to it.
   Sign in:     the password goes to the server by fetch; an event fires either way.
     correct -> an LLP event: the long-lived particle crosses the calorimeter unseen
                and decays in the muon spectrometer (MS displaced vertex). The lock
                opens, the console reads STATUS: SIGNED IN, and a vertical line
                wipes across the screen with a flare on its leading edge before the
                dashboard loads.
     wrong   -> an ordinary event with no displaced vertex. The detector rumbles,
                the muon system flashes red, the console reads STATUS: REJECTED.
   Every event is illustrative, generated in the browser, and labelled as not data.
   Reduced motion: still frames only, same alerts, no wipe. Without JavaScript the
   form posts normally. */
"use strict";
(() => {
  const cv = document.getElementById("det");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const C = {
    beam: "#5E7288", id: "46,140,110", em: "242,201,30", tile: "30,136,216",
    coil: "30,136,216", chamber: "47,181,126", hit: "63,195,255",
    track: "255,154,31", muon: "227,38,46", met: "255,255,255", llp: "63,195,255",
  };
  const alertEl = document.getElementById("gate-alert");
  const TAU = Math.PI * 2;
  const SWEEP_MS = 900, EV_START = 650, EV_END = 2100, EV_SPEED = 1.7;
  let W, H, cx, cy, R, dpr, faint = 1;
  let ev = null, mode = "sweep", t0 = 0, evStart = 0, rejectUntil = 0, raf = null, cache = null, idleBase = null, onEventDone = null;

  const G = {
    idRings: [0.065, 0.105, 0.145, 0.19], idOuter: 0.21, solenoid: 0.235,
    em: [0.26, 0.34], tile: [0.36, 0.52], ncell: 64,
    coils: [0.56, 0.985], stations: [0.60, 0.76, 0.93], nch: 16, chT: 0.028,
    // inner-detector layers as discrete modules: count, module thickness,
    // number of bright lobes in the readout gradient, colour.
    idMods: [
      {n: 44, t: 0.017, lobes: 3, col: C.hit},     // pixel
      {n: 64, t: 0.016, lobes: 4, col: C.hit},     // pixel
      {n: 84, t: 0.015, lobes: 5, col: C.id},      // SCT
      {n: 104, t: 0.014, lobes: 7, col: C.track},  // TRT
    ],
  };

  function layout() {
    dpr = window.devicePixelRatio || 1;
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // desktop: the wheel is deliberately oversized and bleeds off the top and
    // bottom edges; it clears the sign-in plate at wide widths and passes behind
    // it at narrow ones.
    if (W >= 900) { cx = W * 0.72; cy = H * 0.52; R = Math.min(H * 0.54, W * 0.38); faint = 1; }
    else {                                               // phones: detector between the title and the plate
      const head = document.querySelector(".gate-head");
      const top = head ? head.getBoundingClientRect().bottom : 0;
      R = Math.min(W * 0.46, H * 0.30); cx = W / 2; cy = top + R + 10; faint = 0.8;
    }
    cache = null; idleBase = null;
    placeAlert();
  }

  // --------------------------------------------------------------- event ----
  const rnd = (a, b) => a + Math.random() * (b - a);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(TAU * Math.random());
  const angDist = (a, b) => { const d = Math.abs(((a - b) % TAU + TAU) % TAU); return Math.min(d, TAU - d); };
  function makeEvent(withLLP) {
    const j1 = rnd(0, TAU), j2 = j1 + Math.PI + 0.4 * gauss();
    const jets = [{phi: j1, e: rnd(0.7, 1)}, {phi: j2, e: rnd(0.5, 0.9)}];
    const tracks = [];
    for (let i = 0; i < 56; i++) {
      const inJet = Math.random() < 0.6, j = jets[i % 2];
      tracks.push({phi: inJet ? j.phi + 0.18 * gauss() : rnd(0, TAU),
                   rc: inJet ? rnd(0.6, 4) : rnd(0.07, 0.9), q: Math.random() < 0.5 ? -1 : 1,
                   delay: rnd(0, 0.25)});
    }
    let mu;
    do { mu = rnd(0, TAU); } while (jets.some(j => angDist(j.phi, mu) < 0.7));
    let llp = null, rv = 0;
    const tracklets = [];
    if (withLLP) {
      let tries = 0;
      do { llp = rnd(0, TAU); tries++; } while (tries < 50 &&
        (jets.some(j => angDist(j.phi, llp) < 0.8) || angDist(mu, llp) < 0.8));
      rv = rnd(0.655, 0.72);
      for (let i = 0, n = 10 + Math.floor(Math.random() * 5); i < n; i++)
        tracklets.push({phi: llp + 0.2 * gauss(), len: rnd(0.11, 0.3), delay: rnd(0, 0.3)});
    }
    const vx = jets.reduce((s, j) => s + j.e * Math.cos(j.phi), 0) + 0.6 * Math.cos(mu);
    const vy = jets.reduce((s, j) => s + j.e * Math.sin(j.phi), 0) + 0.6 * Math.sin(mu);
    const noise = Array.from({length: 22}, () => ({band: Math.random() < 0.6 ? "em" : "tile",
                                                    k: Math.floor(Math.random() * G.ncell)}));
    return {jets, tracks, mu, llp, rv, tracklets, met: Math.atan2(-vy, -vx), noise};
  }

  // ----------------------------------------------------------- primitives ---
  const P = (r, phi) => [cx + r * R * Math.cos(phi), cy - r * R * Math.sin(phi)];
  const ramp = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
  const ease = x => 1 - Math.pow(1 - x, 3);
  const fract = x => x - Math.floor(x);
  /* ---- pixel gradients -------------------------------------------------
     Anything that lights up is filled with a grid of small blocks whose alpha
     falls off from a source point and is QUANTISED into a few levels. The steps
     are what make it read as pixels rather than a soft glow; a per-block jitter
     keeps the bands from looking like contour lines. PXS is the block size in
     CSS pixels, QSTEPS the number of brightness levels. */
  const PXS = 7, QSTEPS = 5;
  const qa = a => Math.round(a * QSTEPS) / QSTEPS;
  const jitter = (i, k) => 0.70 + 0.45 * fract(Math.sin(i * 97.13 + k * 31.77) * 43758.5453);

  // an annular sector (calorimeter cells, ring segments) as pixel blocks
  function pixelSector(r0, r1, a0, a1, col, peak, gx, gy, rad) {
    const rm = (r0 + r1) / 2;
    const nr = Math.max(1, Math.round((r1 - r0) * R / PXS));
    const na = Math.max(1, Math.round(Math.abs(a1 - a0) * rm * R / PXS));
    const gr = ((r1 - r0) / nr) * 0.13, ga = ((a1 - a0) / na) * 0.13;
    for (let i = 0; i < nr; i++) {
      const ra = r0 + (r1 - r0) * i / nr + gr, rb = r0 + (r1 - r0) * (i + 1) / nr - gr;
      for (let j = 0; j < na; j++) {
        const aa = a0 + (a1 - a0) * j / na + ga, ab = a0 + (a1 - a0) * (j + 1) / na - ga;
        const [sx, sy] = P((ra + rb) / 2, (aa + ab) / 2);
        const d = Math.hypot(sx - gx, sy - gy) / rad;
        const a = qa(peak * Math.exp(-1.7 * d * d) * jitter(i, j));
        if (a < 0.04) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, rb * R, -ab, -aa);
        ctx.arc(cx, cy, ra * R, -aa, -ab, true);
        ctx.closePath();
        ctx.fillStyle = `rgba(${col},${Math.min(1, a)})`;
        ctx.fill();
      }
    }
  }

  // a rectangular element (modules, chambers, coils) as pixel blocks
  function pixelRect(px, py, rot, w, h, col, peak, gx, gy, rad) {
    const nw = Math.max(1, Math.round(w / PXS)), nh = Math.max(1, Math.round(h / PXS));
    const cw = w / nw, ch = h / nh, co = Math.cos(rot), si = Math.sin(rot);
    ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
    for (let i = 0; i < nw; i++) for (let j = 0; j < nh; j++) {
      const lx = -w / 2 + cw * (i + 0.5), ly = -h / 2 + ch * (j + 0.5);
      const sx = px + lx * co - ly * si, sy = py + lx * si + ly * co;
      const d = Math.hypot(sx - gx, sy - gy) / rad;
      const a = qa(peak * Math.exp(-1.7 * d * d) * jitter(i, j));
      if (a < 0.04) continue;
      ctx.fillStyle = `rgba(${col},${Math.min(1, a)})`;
      ctx.fillRect(-w / 2 + cw * i + cw * 0.12, -h / 2 + ch * j + ch * 0.12, cw * 0.76, ch * 0.76);
    }
    ctx.restore();
  }

  // a muon chamber, lit as pixels, with the outline kept hot
  function pixelChamber(s, k, col, peak, gx, gy, rad) {
    const big = k % 2 === 0, r = G.stations[s] + (big ? 0 : 0.026);
    const phi = k / G.nch * TAU, w = r * (big ? 0.33 : 0.24) * R, h = G.chT * R;
    const [x, y] = P(r, phi);
    const g = gx === undefined ? [x, y] : [gx, gy];
    pixelRect(x, y, -phi + Math.PI / 2, w, h, col, peak, g[0], g[1], rad || Math.max(w, h) * 0.62);
    const d = Math.hypot(g[0] - x, g[1] - y) / (rad || Math.max(w, h) * 0.62);
    const edge = peak * Math.exp(-1.7 * d * d);
    if (edge < 0.05) return;
    ctx.save(); ctx.shadowBlur = 26; ctx.shadowColor = `rgba(${col},${edge})`;
    chamber(s, k, null, `rgba(255,255,255,${0.8 * edge})`);
    ctx.restore();
  }

  function ring(r, frac, style, width, dash) {
    ctx.beginPath(); ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash || []);
    ctx.arc(cx, cy, r * R, -Math.PI / 2, -Math.PI / 2 + TAU * frac); ctx.stroke(); ctx.setLineDash([]);
  }
  function cell(r0, r1, k, n, fill, stroke) {
    const a0 = k / n * TAU, a1 = (k + 1) / n * TAU;
    ctx.beginPath(); ctx.arc(cx, cy, r1 * R, -a1, -a0); ctx.arc(cx, cy, r0 * R, -a0, -a1, true); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }
  function chamber(s, k, fill, stroke) {
    const big = k % 2 === 0, r = G.stations[s] + (big ? 0 : 0.026);
    const phi = k / G.nch * TAU, w = r * (big ? 0.33 : 0.24), h = G.chT;
    const [x, y] = P(r, phi);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-phi + Math.PI / 2);
    ctx.beginPath(); ctx.rect(-w * R / 2, -h * R / 2, w * R, h * R);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  }
  const nearestChamber = phi => ((Math.round(phi / TAU * G.nch) % G.nch) + G.nch) % G.nch;

  // one inner-detector module: a short tangential block on layer radius r
  function idModule(r, phi, arc, th, fill, stroke) {
    const [x, y] = P(r, phi);
    const w = arc * r * R, h = th * R;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-phi + Math.PI / 2);
    ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.restore();
  }

  /* The inner detector is drawn as discrete modules, not smooth rings, and their
     brightness follows a gradient around each layer -- a few bright lobes, a
     deterministic per-module jitter, and a slow phase that alternates direction
     layer to layer. amp scales the whole thing: the base pass draws the modules
     dim (unlit pixels), the at-rest pass redraws the same modules lit. */
  function idPixels(sweep, phaseT, amp, glow) {
    G.idRings.forEach((r, i) => {
      const m = G.idMods[i], arc = TAU / m.n * 0.74;
      const dir = i % 2 ? -1 : 1;
      const phase = phaseT / (11000 + 2600 * i) * TAU * dir;
      ring(r, sweep, `rgba(${m.col},${0.13 * amp})`, 1);
      const on = Math.floor(sweep * m.n);
      if (glow) { ctx.save(); ctx.shadowBlur = 12; }
      for (let k = 0; k < on; k++) {
        const phi = (k + 0.5) / m.n * TAU;
        const g = 0.5 + 0.5 * Math.sin(phi * m.lobes - phase);
        const j = 0.72 + 0.28 * fract(Math.sin(i * 97.13 + k * 31.77) * 43758.5453);
        const a = amp * j * (0.16 + 0.84 * Math.pow(g, 1.7));
        if (a < 0.02) continue;
        if (glow) ctx.shadowColor = `rgba(${m.col},${Math.min(1, a)})`;
        idModule(r, phi, arc, m.t, `rgba(${m.col},${0.78 * a})`, `rgba(${m.col},${Math.min(1, 1.0 * a)})`);
      }
      if (glow) ctx.restore();
    });
  }

  function hitSets(e) {
    const muHit = new Set(), vHit = new Set();
    if (!e) return {muHit, vHit};
    G.stations.forEach((_, s) => muHit.add(`${s}:${nearestChamber(e.mu)}`));
    if (e.llp !== null) {
      const V = [e.rv * Math.cos(e.llp), e.rv * Math.sin(e.llp)];
      e.tracklets.forEach(tl => G.stations.forEach((rs, s) => {
        const d = [Math.cos(tl.phi), Math.sin(tl.phi)];
        const bq = V[0] * d[0] + V[1] * d[1], cq = V[0] * V[0] + V[1] * V[1] - rs * rs;
        const disc = bq * bq - cq;
        if (disc < 0) return;
        const u = -bq + Math.sqrt(disc);                 // outward crossing, units of R
        if (u < 0 || u > tl.len) return;
        vHit.add(`${s}:${nearestChamber(Math.atan2(V[1] + u * d[1], V[0] + u * d[0]))}`);
      }));
    }
    return {muHit, vHit};
  }

  // ---------------------------------------------------------------- scene ---
  // sweep: 0..1 detector build-in. e: event or null. t: event clock (ms). rej: muon system red.
  // Structure alphas are the "at rest" weights: the detector reads as a lit
  // drawing, with the activity layer supplying contrast rather than visibility.
  function draw(sweep, e, t, rej) {
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = faint;
    ring(0.012, 1, C.beam, 1.4);
    idPixels(sweep, 0, 0.42, false);                     // unlit module bed
    ring(G.solenoid, sweep, `rgba(${C.tile},.55)`, 1.2);
    const nOn = Math.floor(sweep * G.ncell);
    for (let k = 0; k < nOn; k++) {
      cell(G.em[0], G.em[1], k, G.ncell, `rgba(${C.em},.028)`, `rgba(${C.em},.22)`);
      for (let l = 0; l < 3; l++) {
        const a = G.tile[0] + (G.tile[1] - G.tile[0]) * l / 3, b = G.tile[0] + (G.tile[1] - G.tile[0]) * (l + 1) / 3;
        cell(a, b, k, G.ncell, `rgba(${C.tile},.10)`, `rgba(${C.tile},.30)`);
      }
    }
    for (let k = 0; k < 8; k++) {
      if (k / 8 >= sweep) break;
      const phi = (k + 0.5) / 8 * TAU, [x0, y0] = P(G.coils[0], phi), [x1, y1] = P(G.coils[1], phi);
      ctx.beginPath(); ctx.strokeStyle = `rgba(${C.coil},.34)`; ctx.lineWidth = 6; ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    const chOn = Math.floor(sweep * G.nch);
    const {muHit, vHit} = hitSets(e);
    for (let s = 0; s < 3; s++) for (let k = 0; k < chOn; k++) {
      const key = `${s}:${k}`;
      let fill = `rgba(${C.chamber},.15)`;
      if (e && muHit.has(key) && t > 1350) fill = `rgba(${C.hit},${.75 * ramp(t, 1350, 1600)})`;
      if (e && vHit.has(key) && t > 1550) fill = `rgba(${C.hit},${.85 * ramp(t, 1550, 1850)})`;
      if (rej) fill = `rgba(${C.muon},.28)`;
      chamber(s, k, fill, rej ? `rgba(${C.muon},.95)` : `rgba(${C.chamber},.78)`);
    }
    if (!e) { ctx.globalAlpha = 1; return; }
    // calorimeter deposits
    const cal = ramp(t, 1250, 1750);
    if (cal > 0) {
      e.noise.forEach(n => {
        const [a, b] = n.band === "em" ? G.em : G.tile;
        cell(a, b, n.k, G.ncell, null, `rgba(${C.em},${.35 * cal})`);
      });
      e.jets.forEach(j => {
        const k0 = j.phi / TAU * G.ncell;
        for (let d = -4; d <= 4; d++) {
          const kk = Math.round(k0) + d, k = ((kk % G.ncell) + G.ncell) % G.ncell;
          const en = j.e * Math.exp(-((kk - k0) ** 2) / 3.2);
          if (en < 0.08) continue;
          cell(G.em[0], G.em[1], k, G.ncell, `rgba(${C.em},${.85 * en * cal})`, `rgba(${C.em},${.9 * cal})`);
          cell(G.tile[0], G.tile[0] + (G.tile[1] - G.tile[0]) * en, k, G.ncell, `rgba(${C.em},${.35 * en * cal})`, null);
          const phi = (k + 0.5) / G.ncell * TAU, [x0, y0] = P(G.tile[1], phi), [x1, y1] = P(G.tile[1] + 0.13 * en * cal, phi);
          ctx.beginPath(); ctx.strokeStyle = `rgba(${C.chamber},${.9 * cal})`; ctx.lineWidth = Math.max(2, 0.018 * R);
          ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
      });
    }
    // prompt tracks: helices in the solenoid field project to circles through the origin
    const tr = ramp(t, 650, 1450);
    ctx.lineWidth = 1.2;
    e.tracks.forEach(k => {
      const f = ease(Math.max(0, Math.min(1, (tr - k.delay) / (1 - k.delay))));
      if (f <= 0) return;
      const thMax = 2 * k.rc >= G.idOuter ? 2 * Math.asin(G.idOuter / (2 * k.rc)) : 1.7 * Math.PI;
      const d = [Math.cos(k.phi), Math.sin(k.phi)], n = [-d[1], d[0]];
      ctx.beginPath(); ctx.strokeStyle = `rgba(${C.track},.9)`;
      for (let i = 0; i <= 28; i++) {
        const th = thMax * f * i / 28;
        const px = k.rc * (Math.sin(th) * d[0] + k.q * (1 - Math.cos(th)) * n[0]);
        const py = k.rc * (Math.sin(th) * d[1] + k.q * (1 - Math.cos(th)) * n[1]);
        if (i) ctx.lineTo(cx + px * R, cy - py * R); else ctx.moveTo(cx + px * R, cy - py * R);
      }
      ctx.stroke();
    });
    // muon
    const mf = ease(ramp(t, 700, 1500));
    if (mf > 0) {
      const [x, y] = P(1.03 * mf, e.mu);
      ctx.beginPath(); ctx.strokeStyle = `rgb(${C.muon})`; ctx.lineWidth = 2; ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    }
    if (e.llp !== null) {
      // LLP: invisible until it decays -- a faint dotted guide only
      const lf = ease(ramp(t, 700, 1300));
      if (lf > 0) {
        const [x0, y0] = P(0.02, e.llp), [x1, y1] = P(0.02 + (e.rv - 0.02) * lf, e.llp);
        ctx.beginPath(); ctx.setLineDash([2, 5]); ctx.strokeStyle = `rgba(${C.llp},.35)`; ctx.lineWidth = 1;
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]);
      }
      const vf = ramp(t, 1300, 1850);
      if (vf > 0) {
        const [x0, y0] = P(e.rv, e.llp);
        e.tracklets.forEach(tl => {
          const f = ease(Math.max(0, Math.min(1, (vf - tl.delay) / (1 - tl.delay))));
          if (f <= 0) return;
          ctx.beginPath(); ctx.strokeStyle = `rgba(${C.llp},.95)`; ctx.lineWidth = 1.6;
          ctx.moveTo(x0, y0); ctx.lineTo(x0 + tl.len * f * R * Math.cos(tl.phi), y0 - tl.len * f * R * Math.sin(tl.phi)); ctx.stroke();
        });
        ctx.beginPath(); ctx.fillStyle = `rgba(${C.track},${vf})`; ctx.arc(x0, y0, 3.2, 0, TAU); ctx.fill();
      }
    }
    // missing ET
    const ef = ease(ramp(t, 1600, 2000));
    if (ef > 0) {
      const [x, y] = P(0.9 * ef, e.met);
      ctx.beginPath(); ctx.setLineDash([6, 6]); ctx.strokeStyle = `rgba(${C.met},.85)`; ctx.lineWidth = 1.6;
      ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  function vertexRing(e, pulse) {
    if (!e || e.llp === null) return;
    const [vx, vy] = P(e.rv, e.llp);
    ctx.globalAlpha = faint;
    ctx.beginPath(); ctx.strokeStyle = `rgba(${C.track},${0.25 + 0.55 * pulse})`; ctx.lineWidth = 1.4;
    ctx.arc(vx, vy, 9 + 7 * (1 - pulse), 0, TAU); ctx.stroke();
    ctx.font = '11px "Share Tech Mono", monospace'; ctx.fillStyle = `rgba(${C.track},.9)`;
    const right = Math.cos(e.llp) >= 0;
    ctx.textAlign = right ? "left" : "right";
    ctx.fillText("MS vertex", vx + (right ? 16 : -16), vy - 12);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ timeline ----
  function snapshot() {
    const c = document.createElement("canvas");
    c.width = cv.width; c.height = cv.height;
    c.getContext("2d").drawImage(cv, 0, 0);
    return c;
  }
  function blit(img) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ------------------------------------------------------------- at rest ----
  // A live detector is never quite still, but at rest it should read as a lit
  // drawing with rare, bright events on it -- not a light show. Activity is
  // sparse; what fires is drawn hot, with a heavy edge glow against the lighter
  // structure underneath. Drawn at ~30 fps.
  const FX_FRAME_MS = 33;
  const fx = {cells: [], blips: [], cosmic: null, nextCell: 0, nextBlip: 0, nextCosmic: 0};
  let lastFx = 0;
  function crossings(off, phi) {
    // straight line: perpendicular offset `off` (units of R), direction phi; hits per station
    const d = [Math.cos(phi), Math.sin(phi)], n = [-d[1], d[0]], out = [];
    G.stations.forEach((rs, s) => {
      if (rs <= Math.abs(off)) return;
      const u = Math.sqrt(rs * rs - off * off);
      [u, -u].forEach(v => out.push([s, nearestChamber(Math.atan2(off * n[1] + v * d[1], off * n[0] + v * d[0]))]));
    });
    return out;
  }
  // fast rise (first 10%), slow decay: reads as a hit, not a fade-in
  const flash = x => x < 0.1 ? x / 0.1 : Math.pow((1 - x) / 0.9, 1.4);
  function drawFx(now, quiet) {
    ctx.globalAlpha = faint;
    // inner detector: the module bed lit by a slow gradient, layer by layer
    idPixels(1, now, 1, true);
    // toroid coils breathing
    const br = 0.5 + 0.5 * Math.sin(now / 6000 * TAU);
    for (let k = 0; k < 8; k++) {
      const phi = (k + 0.5) / 8 * TAU, [x0, y0] = P(G.coils[0], phi), [x1, y1] = P(G.coils[1], phi);
      ctx.beginPath(); ctx.strokeStyle = `rgba(${C.coil},${0.05 + 0.10 * br})`; ctx.lineWidth = 10;
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    // calorimeter noise cells -- rare
    if (now > fx.nextCell) {
      // a small deposit: 1-3 neighbouring cells, the centre one brightest
      const em = Math.random() < 0.55, k0 = Math.floor(Math.random() * G.ncell), l = Math.floor(Math.random() * 3);
      const n = 1 + Math.floor(Math.random() * 3), life = rnd(2200, 3400), peak = rnd(0.8, 1);
      for (let d = 0; d < n; d++)
        fx.cells.push({em, k: (k0 + d) % G.ncell, l, t0: now, life, peak: peak * (d === 1 || n === 1 ? 1 : 0.55)});
      fx.nextCell = now + rnd(quiet ? 5000 : 2800, quiet ? 9000 : 5600);
    }
    fx.cells = fx.cells.filter(c => now - c.t0 < c.life);
    fx.cells.forEach(c => {
      const a = flash((now - c.t0) / c.life) * c.peak;
      const col = c.em ? C.em : C.hit;
      const lo = c.em ? G.em[0] : G.tile[0] + (G.tile[1] - G.tile[0]) * c.l / 3;
      const hi = c.em ? G.em[1] : G.tile[0] + (G.tile[1] - G.tile[0]) * (c.l + 1) / 3;
      const a0 = c.k / G.ncell * TAU, a1 = (c.k + 1) / G.ncell * TAU;
      const [gx, gy] = P((lo + hi) / 2, (a0 + a1) / 2);
      // the deposit blooms outward from the middle of the cell, in pixel steps
      pixelSector(lo, hi, a0, a1, col, 1.05 * a, gx, gy, (hi - lo) * R * 1.15);
      ctx.save(); ctx.shadowBlur = 26; ctx.shadowColor = `rgba(${col},${a})`;
      cell(lo, hi, c.k, G.ncell, null, `rgba(255,255,255,${0.5 * a})`);   // hot edge
      ctx.restore();
    });
    // stray muon-chamber hits -- rare
    if (now > fx.nextBlip) {
      fx.blips.push({s: Math.floor(Math.random() * 3), k: Math.floor(Math.random() * G.nch), t0: now, life: 1700});
      fx.nextBlip = now + rnd(quiet ? 9000 : 6000, quiet ? 15000 : 11000);
    }
    fx.blips = fx.blips.filter(b => now - b.t0 < b.life);
    fx.blips.forEach(b => pixelChamber(b.s, b.k, C.hit, flash((now - b.t0) / b.life)));
    // a cosmic muon, straight through, every 26-42 s
    if (!quiet && now > fx.nextCosmic && !fx.cosmic) {
      fx.cosmic = {phi: rnd(Math.PI * 0.3, Math.PI * 0.7), off: rnd(-0.32, 0.32), t0: now};
      fx.nextCosmic = now + rnd(26000, 42000);
    }
    if (fx.cosmic) {
      const age = now - fx.cosmic.t0, grow = ease(Math.min(1, age / 450)), fade = 1 - ramp(age, 1400, 3200);
      if (fade <= 0) fx.cosmic = null;
      else {
        const {phi, off} = fx.cosmic, d = [Math.cos(phi), Math.sin(phi)], n = [-d[1], d[0]], L = 1.05;
        const a = [off * n[0] + L * d[0], off * n[1] + L * d[1]];
        const b = [off * n[0] - L * d[0] * (2 * grow - 1), off * n[1] - L * d[1] * (2 * grow - 1)];
        ctx.save(); ctx.shadowBlur = 24; ctx.shadowColor = `rgba(${C.muon},${fade})`;
        ctx.beginPath(); ctx.strokeStyle = `rgba(${C.muon},${0.95 * fade})`; ctx.lineWidth = 2.2;
        ctx.moveTo(cx + a[0] * R, cy - a[1] * R); ctx.lineTo(cx + b[0] * R, cy - b[1] * R); ctx.stroke();
        ctx.shadowColor = `rgba(${C.hit},${fade})`; ctx.shadowBlur = 30;
        ctx.restore();
        if (grow >= 1) crossings(off, phi).forEach(([s, k]) => pixelChamber(s, k, C.hit, fade));
      }
    }
    drawHover(now);
    ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------- hover ----
  /* The pointer probes the detector. Whatever sits under it is identified by
     radius, then that component and its neighbours are lit with the same pixel
     gradient the at-rest hits use, centred on the cursor: bright under the
     pointer, stepping down and out. The canvas stays pointer-events:none, so
     the form above it is unaffected; positions come from the window. */
  const ID_NAME = ["pixel layer 1", "pixel layer 2", "SCT", "TRT"];
  let hover = null;

  function componentAt(x, y) {
    if (!R) return null;
    const dx = x - cx, dy = cy - y;
    const rr = Math.hypot(dx, dy) / R, phi = Math.atan2(dy, dx);
    if (rr > 1.02) return null;
    if (rr < 0.035) return {kind: "beam", phi, label: "beam pipe", col: "94,114,136"};
    for (let i = 0; i < G.idRings.length; i++)
      if (Math.abs(rr - G.idRings[i]) < 0.024)
        return {kind: "id", i, phi, label: ID_NAME[i], col: G.idMods[i].col};
    if (Math.abs(rr - G.solenoid) < 0.022) return {kind: "sol", phi, label: "solenoid", col: C.tile};
    if (rr >= G.em[0] - 0.012 && rr <= G.em[1] + 0.012)
      return {kind: "em", phi, label: "EM calorimeter", col: C.em};
    if (rr >= G.tile[0] - 0.012 && rr <= G.tile[1] + 0.012)
      return {kind: "tile", phi, label: "tile calorimeter", col: C.tile};
    for (let s = 0; s < G.stations.length; s++)
      if (Math.abs(rr - G.stations[s]) < 0.05)
        return {kind: "ms", s, phi, label: `muon station ${s + 1}`, col: C.chamber};
    if (rr >= G.coils[0] && rr <= G.coils[1])
      return {kind: "coil", phi, label: "toroid coil", col: C.coil};
    return null;
  }

  function drawHover(now) {
    if (!hover || reduce) return;
    const c = componentAt(hover.x, hover.y);
    document.body.classList.toggle("probing", !!c);
    if (!c) return;
    const gx = hover.x, gy = hover.y, rad = 0.20 * R;
    const peak = Math.min(1, 0.95 + 0.12 * Math.sin(now / 420));
    ctx.save();
    ctx.globalAlpha = faint;
    if (c.kind === "id") {
      const m = G.idMods[c.i], r = G.idRings[c.i], arc = TAU / m.n * 0.74;
      const k0 = Math.round(c.phi / TAU * m.n), span = Math.ceil(m.n * 0.22);
      for (let d = -span; d <= span; d++) {
        const k = ((k0 + d) % m.n + m.n) % m.n, ph = (k + 0.5) / m.n * TAU;
        const [x, y] = P(r, ph);
        pixelRect(x, y, -ph + Math.PI / 2, arc * r * R, m.t * R, m.col, peak, gx, gy, rad);
      }
    } else if (c.kind === "em" || c.kind === "tile") {
      const band = c.kind === "em" ? G.em : G.tile;
      const k0 = Math.round(c.phi / TAU * G.ncell);
      for (let d = -5; d <= 5; d++) {
        const k = ((k0 + d) % G.ncell + G.ncell) % G.ncell;
        const a0 = k / G.ncell * TAU, a1 = (k + 1) / G.ncell * TAU;
        if (c.kind === "em") pixelSector(band[0], band[1], a0, a1, c.col, peak, gx, gy, rad);
        else for (let l = 0; l < 3; l++)
          pixelSector(band[0] + (band[1] - band[0]) * l / 3,
                      band[0] + (band[1] - band[0]) * (l + 1) / 3, a0, a1, c.col, peak, gx, gy, rad);
      }
    } else if (c.kind === "ms") {
      const k0 = Math.round(c.phi / TAU * G.nch);
      for (let s = 0; s < G.stations.length; s++)
        for (let d = -3; d <= 3; d++) {
          const k = ((k0 + d) % G.nch + G.nch) % G.nch;
          pixelChamber(s, k, c.col, peak, gx, gy, rad);
        }
    } else if (c.kind === "coil") {
      const k0 = Math.round(c.phi / TAU * 8 - 0.5);
      for (let d = -1; d <= 1; d++) {
        const k = ((k0 + d) % 8 + 8) % 8, ph = (k + 0.5) / 8 * TAU;
        const rm = (G.coils[0] + G.coils[1]) / 2;
        const [x, y] = P(rm, ph);
        pixelRect(x, y, -ph, (G.coils[1] - G.coils[0]) * R, 0.026 * R, c.col, peak, gx, gy, rad);
      }
    } else if (c.kind === "sol") {
      const a0 = c.phi - 0.5, a1 = c.phi + 0.5;
      pixelSector(G.solenoid - 0.012, G.solenoid + 0.012, a0, a1, c.col, peak, gx, gy, rad);
    } else if (c.kind === "beam") {
      pixelSector(0, 0.03, 0, TAU, c.col, peak, cx, cy, 0.05 * R);
    }
    // name it, the way an event display labels what you point at
    const right = hover.x <= cx;
    ctx.font = '11px "Share Tech Mono", monospace';
    ctx.textAlign = right ? "left" : "right";
    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.fillText(c.label, hover.x + (right ? 18 : -18), hover.y - 12);
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${c.col},.5)`;
    ctx.lineWidth = 1;
    ctx.moveTo(hover.x + (right ? 6 : -6), hover.y - 6);
    ctx.lineTo(hover.x + (right ? 15 : -15), hover.y - 10);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    raf = null;
    if (mode === "sweep") {
      const k = (now - t0) / SWEEP_MS;
      draw(ease(Math.min(1, k)), null, 0, false);
      if (k < 1) { raf = requestAnimationFrame(loop); return; }
      mode = "idle";
      idleBase = null;
      fx.nextCosmic = now + 6000;                       // first cosmic early, then sparse
    }
    if (mode === "idle") {
      if (now - lastFx >= FX_FRAME_MS) {
        lastFx = now;
        if (!idleBase) { draw(1, null, 0, false); idleBase = snapshot(); }
        blit(idleBase);
        drawFx(now);
      }
      raf = requestAnimationFrame(loop);
      return;
    }
    if (mode === "event") {
      const t = Math.min(EV_END, EV_START + (now - evStart) * EV_SPEED);
      draw(1, ev, t, false);
      if (t >= 1850) vertexRing(ev, 1);
      if (t < EV_END) { raf = requestAnimationFrame(loop); return; }
      mode = "shown";
      const cb = onEventDone; onEventDone = null;
      if (cb) cb();
      cache = null;
    }
    if (mode === "shown") {
      const rej = now < rejectUntil;
      if (rej) { draw(1, ev, EV_END, true); if (!raf) raf = requestAnimationFrame(loop); return; }
      if (now - lastFx >= FX_FRAME_MS) {
        lastFx = now;
        if (!cache) { draw(1, ev, EV_END, false); cache = snapshot(); }
        blit(cache);
        drawFx(now, true);
        if (ev && ev.llp !== null) vertexRing(ev, 0.5 + 0.5 * Math.cos(now / 2400 * TAU));
      }
      if (!raf) raf = requestAnimationFrame(loop);
    }
  }
  const kick = () => { if (!raf && !reduce) raf = requestAnimationFrame(loop); };

  function fireEvent(withLLP, done) {
    ev = makeEvent(withLLP);
    cache = null;
    if (reduce) { mode = "shown"; draw(1, ev, EV_END, false); vertexRing(ev, 1); done(); return; }
    mode = "event"; evStart = performance.now(); onEventDone = done;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function redrawStill() {
    if (mode === "sweep" || mode === "idle") draw(1, null, 0, false);
    else { draw(1, ev, EV_END, false); vertexRing(ev, 1); }
  }

  layout();
  if (reduce) { mode = "idle"; draw(1, null, 0, false); }
  else { t0 = performance.now(); raf = requestAnimationFrame(loop); }
  window.addEventListener("resize", () => { layout(); redrawStill(); kick(); });
  window.addEventListener("mousemove", e => { hover = {x: e.clientX, y: e.clientY}; kick(); },
                          {passive: true});
  window.addEventListener("mouseleave", () => { hover = null; document.body.classList.remove("probing"); });
  window.addEventListener("blur", () => { hover = null; document.body.classList.remove("probing"); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && raf) { cancelAnimationFrame(raf); raf = null; } else kick();
  });

  // --------------------------------------------------------------- alert ----
  function placeAlert() {
    if (!alertEl) return;
    alertEl.style.left = `${cx}px`;
    alertEl.style.top = `${W >= 900 ? Math.min(cy + R * 0.62, H - 96) : cy - 24}px`;
  }
  function showAlert(ok) {
    alertEl.className = `gate-alert show ${ok ? "ok" : "bad"}`;
    alertEl.querySelector("b").textContent = ok ? "LLP detected" : "no LLP detected";
    alertEl.querySelector("span").textContent = ok ? "MS displaced vertex found. Opening the dashboard."
                                                   : "No displaced vertex. Password rejected.";
  }
  function rumble() {
    if (reduce) return;
    cv.classList.remove("rumble"); void cv.offsetWidth; cv.classList.add("rumble");
    rejectUntil = performance.now() + 700; kick();
  }

  // ------------------------------------------------- vertical line wipe -----
  // Leaves the gate on a vertical line sweeping left to right: a hot core, a
  // flare ahead of it, sparks shed off the edge, and the page dark behind.
  // The dashboard is loaded when the line clears the right edge.
  const wipeCv = document.getElementById("wipe");
  function wipeOut(done) {
    if (!wipeCv || reduce) { done(); return; }
    wipeCv.classList.add("run");
    const w = wipeCv.getContext("2d");
    const d2 = window.devicePixelRatio || 1;
    const WW = wipeCv.clientWidth, HH = wipeCv.clientHeight;
    wipeCv.width = Math.round(WW * d2); wipeCv.height = Math.round(HH * d2);
    w.setTransform(d2, 0, 0, d2, 0, 0);
    const DUR = 1000, LEAD = 190, start = performance.now();
    const sparks = [];
    let prev = start, fired = false;
    function frame(now) {
      const dt = Math.min(48, now - prev); prev = now;
      const k = Math.min(1, (now - start) / DUR);
      const x = -LEAD + (WW + 2 * LEAD) * (k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
      w.clearRect(0, 0, WW, HH);
      // everything behind the line goes dark
      const veil = w.createLinearGradient(x - 220, 0, x, 0);
      veil.addColorStop(0, "rgba(1,3,6,1)");
      veil.addColorStop(1, "rgba(1,3,6,.35)");
      w.fillStyle = "rgba(1,3,6,1)"; w.fillRect(0, 0, Math.max(0, x - 220), HH);
      w.fillStyle = veil; w.fillRect(Math.max(0, x - 220), 0, Math.min(220, x + 220), HH);
      // flare ahead of the line
      const fl = w.createLinearGradient(x, 0, x + LEAD, 0);
      fl.addColorStop(0, "rgba(63,195,255,.55)");
      fl.addColorStop(0.35, "rgba(63,195,255,.14)");
      fl.addColorStop(1, "rgba(63,195,255,0)");
      w.fillStyle = fl; w.fillRect(x, 0, LEAD, HH);
      // sparks shed off the edge
      for (let i = 0; i < 5; i++)
        sparks.push({x, y: Math.random() * HH, vx: -rnd(140, 900), vy: rnd(-140, 140),
                     life: rnd(260, 720), t0: now, hot: Math.random() < 0.35});
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i], age = now - s.t0;
        if (age > s.life) { sparks.splice(i, 1); continue; }
        s.x += s.vx * dt / 1000; s.y += s.vy * dt / 1000;
        const a = 1 - age / s.life, len = Math.max(3, Math.abs(s.vx) * 0.012);
        w.beginPath();
        w.strokeStyle = s.hot ? `rgba(255,154,31,${a})` : `rgba(63,195,255,${a})`;
        w.lineWidth = s.hot ? 1.6 : 1;
        w.moveTo(s.x, s.y); w.lineTo(s.x + len, s.y); w.stroke();
      }
      // the core
      w.save(); w.shadowBlur = 30; w.shadowColor = "rgba(63,195,255,.95)";
      w.fillStyle = "rgba(63,195,255,.9)"; w.fillRect(x - 2.5, 0, 5, HH);
      w.fillStyle = "#EAF8FF"; w.fillRect(x - 1, 0, 2, HH);
      w.restore();
      if (!fired && k > 0.82) { fired = true; done(); }   // navigate under the cover
      if (k < 1) requestAnimationFrame(frame);
      else { w.fillStyle = "rgba(1,3,6,1)"; w.fillRect(0, 0, WW, HH); }
    }
    requestAnimationFrame(frame);
  }

  // -------------------------------------------------------------- status ----
  // One call drives the console, the lock, the plate word and the run-block
  // line, so the four cannot disagree.
  const form = document.querySelector("form.gate-plate");
  const btn = form && form.querySelector("button[type=submit]");
  const pw = document.getElementById("pw");
  const crtEl = document.getElementById("crt");
  const crtLines = document.getElementById("crt-lines");
  const rdNote = document.getElementById("rd-note");
  const stateEl = document.getElementById("gate-state");
  const metaEl = document.getElementById("gate-meta-state");
  const say = (t, cls) => { if (window.CRT) window.CRT.line(t, cls); };

  const STATES = {
    busy: {
      tone: "busy", plate: "trigger fired", meta: "checking", note: "checking password", cls: "",
      lines: [["> auth: sending", "dim"], ["trigger ..... fired", "dim"]],
    },
    in: {
      tone: "ok", plate: "gate open", meta: "open", note: "LLP detected", cls: "open",
      lines: [["trigger ..... LLP", "ok"], ["vertex ...... MS displaced", "ok"],
              ["STATUS: SIGNED IN", "hot"], ["opening dashboard ...", "dim"]],
    },
    bad: {
      tone: "bad", plate: "no LLP detected", meta: "rejected", note: "password rejected", cls: "denied",
      lines: [["trigger ..... no LLP", "bad"], ["vertex ...... none", "dim"],
              ["STATUS: REJECTED", "bad"]],
    },
    offline: {
      tone: "bad", plate: "server unreachable", meta: "offline", note: "no answer from the server", cls: "denied",
      lines: [["server ...... no answer", "bad"], ["STATUS: OFFLINE", "bad"]],
    },
  };

  function setState(key) {
    const st = STATES[key];
    if (!st) return;
    if (window.CRT) window.CRT.tone(st.tone);
    st.lines.forEach(([t, c]) => say(t, c));
    if (rdNote) rdNote.textContent = st.note;
    if (stateEl) stateEl.textContent = st.plate;
    if (metaEl) metaEl.textContent = st.meta;
    if (form) {
      form.classList.remove("open", "denied");
      void form.offsetWidth;                            // restart the reject animation
      if (st.cls) form.classList.add(st.cls);
    }
  }

  // boot the console from the state the server rendered
  if (window.CRT && crtLines) {
    window.CRT.mount(crtLines);
    const st0 = crtEl ? crtEl.dataset.state : "out";
    const why = crtEl ? crtEl.dataset.reason : "none";
    say("pfd gate // ATLAS-Dashboard-mk_1", "dim");
    say("link ........ up", "dim");
    say("detector .... r-phi view ready", "dim");
    if (why && why !== "none") say(`last ........ ${why}`, "dim");
    if (st0 === "rejected") say("STATUS: REJECTED", "bad");
    else say("STATUS: SIGNED OUT", "hot");
  }

  // ------------------------------------------------------------- sign in ----
  let busy = false;
  if (form) form.addEventListener("submit", async e => {
    e.preventDefault();
    if (busy) return;
    busy = true; btn.disabled = true;
    alertEl.className = "gate-alert";
    setState("busy");
    let res;
    try {
      const r = await fetch("/login", {method: "POST", body: new FormData(form),
                                       headers: {"X-PFD-Login": "1"}, credentials: "same-origin"});
      res = await r.json();
    } catch (err) {
      setState("offline");
      busy = false; btn.disabled = false;
      return;
    }
    fireEvent(!!res.ok, () => {
      showAlert(!!res.ok);
      if (res.ok) {
        setState("in");
        setTimeout(() => wipeOut(() => { location.href = res.next || "/"; }), reduce ? 400 : 1500);
      } else {
        setState("bad");
        rumble();
        pw.value = "";
        setTimeout(() => { busy = false; btn.disabled = false; pw.focus(); }, 900);
      }
    });
  });

  // title spans the whole top: scale the font so the line fills the band
  const title = document.getElementById("gate-title");
  function fitTitle() {
    if (!title) return;
    const span = title.querySelector("span");
    title.style.fontSize = "";
    if (window.innerWidth < 900) return;                 // phones: CSS wraps it
    const avail = title.clientWidth * 0.96;
    title.style.fontSize = "100px";
    const w = span.getBoundingClientRect().width;
    if (w > 0) title.style.fontSize = `${Math.max(28, Math.min(120, 100 * avail / w))}px`;
  }
  fitTitle();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitle);
  window.addEventListener("resize", fitTitle);

  // clock, like the run/event block on an event display
  const clk = document.getElementById("gate-clock");
  const pad = n => String(n).padStart(2, "0");
  const tick = () => {
    const d = new Date();
    if (clk) clk.textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  tick(); setInterval(tick, 1000);
  if (pw) pw.focus();
})();
