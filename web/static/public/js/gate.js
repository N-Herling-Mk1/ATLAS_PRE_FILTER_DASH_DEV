/* gate.js -- sign-in page only.
   A transverse (r-phi) view of a barrel detector drawn in the browser.

   Load:        the detector lights up in a spiral sweep, then idles "at rest":
                faint calorimeter noise, stray chamber hits, the inner-tracker
                readout circling, the toroid breathing, an occasional cosmic muon.
   Sign in:     the password goes to the server by fetch; an event fires either way.
     correct -> an LLP event: the long-lived particle crosses the calorimeter unseen
                and decays in the muon spectrometer (MS displaced vertex). Alert
                "LLP detected", then the dashboard opens.
     wrong   -> an ordinary event with no displaced vertex. The detector rumbles,
                the muon system flashes red, alert "no LLP detected".
   Every event is illustrative, generated in the browser, and labelled as not data.
   Reduced motion: still frames only, same alerts. Without JavaScript the form
   posts normally. */
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
  };

  function layout() {
    dpr = window.devicePixelRatio || 1;
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (W >= 900) { cx = W * 0.68; cy = H * 0.5; R = Math.min(H * 0.46, W * 0.32); faint = 1; }
    else {                                               // phones: detector between the title and the plate
      const head = document.querySelector(".gate-head");
      const top = head ? head.getBoundingClientRect().bottom : 0;
      R = Math.min(W * 0.44, H * 0.26); cx = W / 2; cy = top + R + 10; faint = 0.75;
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
  function draw(sweep, e, t, rej) {
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = faint;
    ring(0.012, 1, C.beam, 1.2);
    G.idRings.forEach((r, i) => ring(r, sweep, `rgba(${C.id},.55)`, 1, [3, 3 + i]));
    ring(G.solenoid, sweep, `rgba(${C.tile},.35)`, 1);
    const nOn = Math.floor(sweep * G.ncell);
    for (let k = 0; k < nOn; k++) {
      cell(G.em[0], G.em[1], k, G.ncell, null, `rgba(${C.em},.10)`);
      for (let l = 0; l < 3; l++) {
        const a = G.tile[0] + (G.tile[1] - G.tile[0]) * l / 3, b = G.tile[0] + (G.tile[1] - G.tile[0]) * (l + 1) / 3;
        cell(a, b, k, G.ncell, `rgba(${C.tile},.05)`, `rgba(${C.tile},.16)`);
      }
    }
    for (let k = 0; k < 8; k++) {
      if (k / 8 >= sweep) break;
      const phi = (k + 0.5) / 8 * TAU, [x0, y0] = P(G.coils[0], phi), [x1, y1] = P(G.coils[1], phi);
      ctx.beginPath(); ctx.strokeStyle = `rgba(${C.coil},.22)`; ctx.lineWidth = 5; ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    const chOn = Math.floor(sweep * G.nch);
    const {muHit, vHit} = hitSets(e);
    for (let s = 0; s < 3; s++) for (let k = 0; k < chOn; k++) {
      const key = `${s}:${k}`;
      let fill = `rgba(${C.chamber},.06)`;
      if (e && muHit.has(key) && t > 1350) fill = `rgba(${C.hit},${.75 * ramp(t, 1350, 1600)})`;
      if (e && vHit.has(key) && t > 1550) fill = `rgba(${C.hit},${.85 * ramp(t, 1550, 1850)})`;
      if (rej) fill = `rgba(${C.muon},.28)`;
      chamber(s, k, fill, rej ? `rgba(${C.muon},.95)` : `rgba(${C.chamber},.5)`);
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
  // A live detector is never quite still: noise hits in the calorimeter, stray
  // chamber hits, the inner-tracker readout cycling, the toroid breathing, and now
  // and then a cosmic muon straight through. Sparse but bright; drawn at ~30 fps.
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
    // inner tracker: a readout sweep circling each layer, alternate directions
    G.idRings.forEach((r, i) => {
      const a0 = (i % 2 ? -1 : 1) * now / (6500 + 1900 * i) * TAU;
      for (let j = 0; j < 4; j++) {
        ctx.beginPath(); ctx.strokeStyle = `rgba(${C.id},${0.8 - 0.18 * j})`; ctx.lineWidth = 2;
        const b0 = a0 - j * 0.18 * (i % 2 ? -1 : 1);
        ctx.arc(cx, cy, r * R, -b0 - 0.18, -b0); ctx.stroke();
      }
    });
    // toroid coils breathing
    const br = 0.5 + 0.5 * Math.sin(now / 6000 * TAU);
    for (let k = 0; k < 8; k++) {
      const phi = (k + 0.5) / 8 * TAU, [x0, y0] = P(G.coils[0], phi), [x1, y1] = P(G.coils[1], phi);
      ctx.beginPath(); ctx.strokeStyle = `rgba(${C.coil},${0.03 + 0.09 * br})`; ctx.lineWidth = 9;
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    // calorimeter noise cells
    if (now > fx.nextCell) {
      // a small deposit: 1-3 neighbouring cells, the centre one brightest
      const em = Math.random() < 0.55, k0 = Math.floor(Math.random() * G.ncell), l = Math.floor(Math.random() * 3);
      const n = 1 + Math.floor(Math.random() * 3), life = rnd(1600, 2600), peak = rnd(0.75, 1);
      for (let d = 0; d < n; d++)
        fx.cells.push({em, k: (k0 + d) % G.ncell, l, t0: now, life, peak: peak * (d === 1 || n === 1 ? 1 : 0.55)});
      fx.nextCell = now + rnd(quiet ? 2600 : 1100, quiet ? 4800 : 2400);
    }
    fx.cells = fx.cells.filter(c => now - c.t0 < c.life);
    ctx.save(); ctx.shadowBlur = 14;
    fx.cells.forEach(c => {
      const a = flash((now - c.t0) / c.life) * c.peak;
      if (c.em) {
        ctx.shadowColor = `rgba(${C.em},${a})`;
        cell(G.em[0], G.em[1], c.k, G.ncell, `rgba(${C.em},${0.85 * a})`, `rgba(${C.em},${a})`);
      } else {
        const lo = G.tile[0] + (G.tile[1] - G.tile[0]) * c.l / 3, hi = G.tile[0] + (G.tile[1] - G.tile[0]) * (c.l + 1) / 3;
        ctx.shadowColor = `rgba(${C.hit},${a})`;
        cell(lo, hi, c.k, G.ncell, `rgba(${C.hit},${0.75 * a})`, `rgba(${C.hit},${a})`);
      }
    });
    ctx.restore();
    // stray muon-chamber hits
    if (now > fx.nextBlip) {
      fx.blips.push({s: Math.floor(Math.random() * 3), k: Math.floor(Math.random() * G.nch), t0: now, life: 1400});
      fx.nextBlip = now + rnd(quiet ? 4500 : 2600, quiet ? 8000 : 5200);
    }
    fx.blips = fx.blips.filter(b => now - b.t0 < b.life);
    ctx.save(); ctx.shadowBlur = 18;
    fx.blips.forEach(b => {
      const a = flash((now - b.t0) / b.life);
      ctx.shadowColor = `rgba(${C.hit},${a})`;
      chamber(b.s, b.k, `rgba(${C.hit},${0.95 * a})`, `rgba(${C.hit},${a})`);
    });
    ctx.restore();
    // a cosmic muon, straight through, every 11-19 s
    if (!quiet && now > fx.nextCosmic && !fx.cosmic) {
      fx.cosmic = {phi: rnd(Math.PI * 0.3, Math.PI * 0.7), off: rnd(-0.32, 0.32), t0: now};
      fx.nextCosmic = now + rnd(14000, 24000);
    }
    if (fx.cosmic) {
      const age = now - fx.cosmic.t0, grow = ease(Math.min(1, age / 450)), fade = 1 - ramp(age, 1200, 2800);
      if (fade <= 0) fx.cosmic = null;
      else {
        const {phi, off} = fx.cosmic, d = [Math.cos(phi), Math.sin(phi)], n = [-d[1], d[0]], L = 1.05;
        const a = [off * n[0] + L * d[0], off * n[1] + L * d[1]];
        const b = [off * n[0] - L * d[0] * (2 * grow - 1), off * n[1] - L * d[1] * (2 * grow - 1)];
        ctx.save(); ctx.shadowBlur = 16; ctx.shadowColor = `rgba(${C.muon},${fade})`;
        ctx.beginPath(); ctx.strokeStyle = `rgba(${C.muon},${0.95 * fade})`; ctx.lineWidth = 2.2;
        ctx.moveTo(cx + a[0] * R, cy - a[1] * R); ctx.lineTo(cx + b[0] * R, cy - b[1] * R); ctx.stroke();
        ctx.shadowColor = `rgba(${C.hit},${fade})`; ctx.shadowBlur = 18;
        if (grow >= 1) crossings(off, phi).forEach(([s, k]) =>
          chamber(s, k, `rgba(${C.hit},${0.95 * fade})`, `rgba(${C.hit},${fade})`));
        ctx.restore();
      }
    }
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
      fx.nextCosmic = now + 3500;                       // first cosmic early, then sparse
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
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && raf) { cancelAnimationFrame(raf); raf = null; } else kick();
  });

  // --------------------------------------------------------------- alert ----
  function placeAlert() {
    if (!alertEl) return;
    alertEl.style.left = `${cx}px`;
    alertEl.style.top = `${W >= 900 ? cy + R * 0.62 : cy - 24}px`;   // below the calorimeter; centred on phones
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

  // ------------------------------------------------------------- sign in ----
  const form = document.querySelector("form.gate-plate");
  const btn = form && form.querySelector("button[type=submit]");
  const pw = document.getElementById("pw");
  const stateEl = document.getElementById("gate-state");
  const metaEl = document.getElementById("gate-meta-state");
  const setState = (plate, meta) => { if (stateEl) stateEl.textContent = plate; if (metaEl) metaEl.textContent = meta; };
  let busy = false;
  if (form) form.addEventListener("submit", async e => {
    e.preventDefault();
    if (busy) return;
    busy = true; btn.disabled = true;
    alertEl.className = "gate-alert";
    form.classList.remove("denied");
    setState("trigger fired", "checking");
    let res;
    try {
      const r = await fetch("/login", {method: "POST", body: new FormData(form),
                                       headers: {"X-PFD-Login": "1"}, credentials: "same-origin"});
      res = await r.json();
    } catch (err) {
      setState("server unreachable", "offline");
      busy = false; btn.disabled = false;
      return;
    }
    fireEvent(!!res.ok, () => {
      showAlert(!!res.ok);
      if (res.ok) {
        setState("LLP detected", "open");
        setTimeout(() => { location.href = res.next || "/"; }, reduce ? 600 : 1300);
      } else {
        setState("no LLP detected", "rejected");
        form.classList.add("denied");
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
