/* charts.js -- physics plots: viridis on white, drawn on canvas. */
"use strict";
const Charts = (() => {
  const COLORS = {bkg: "#8C95A5", mS5: "#440154", mS16: "#31688E", mS35: "#35B779", mS55: "#A8CC1F", sig_pooled: "#FF2D6B"};
  const INK = "#172033", INK2 = "#5A6478", RULE = "#D5DAE2";
  const FONT = '12px "Share Tech Mono", monospace';

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = FONT;
    return {ctx, w, h};
  }

  function niceTicks(lo, hi, n = 5) {
    if (!(hi > lo)) return [lo];
    const step0 = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 5, 10].map(m => m * p).find(s => s >= step0) || step0;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(+v.toPrecision(10));
    return out;
  }
  function fmt(v) { const a = Math.abs(v); return a !== 0 && (a >= 1e5 || a < 1e-3) ? v.toExponential(1) : String(+v.toPrecision(4)); }

  function hist(canvas, s7, opts) {
    const {ctx, w, h} = setup(canvas);
    const L = 58, R = 12, T = 12, B = 34, pw = w - L - R, ph = h - T - B;
    const edges = s7.edges, nb = edges.length - 1;
    const series = Object.entries(s7.hist).map(([k, v]) => {
      const y = v.counts.map(c => opts.norm ? (v.n ? c / v.n : 0) : c);
      return {k, y, n: v.n};
    });
    let ymax = Math.max(1e-12, ...series.flatMap(s => s.y));
    const positive = series.flatMap(s => s.y).filter(v => v > 0);
    let ymin = opts.logy ? Math.max(1e-6, Math.min(...positive, ymax) / 2) : 0;
    const X = i => L + pw * (edges[i] - edges[0]) / (edges[nb] - edges[0] || 1);
    const Y = v => opts.logy ? T + ph * (1 - (Math.log10(Math.max(v, ymin)) - Math.log10(ymin)) / (Math.log10(ymax * 1.3) - Math.log10(ymin) || 1))
                             : T + ph * (1 - v / (ymax * 1.08));
    // grid + axes
    ctx.strokeStyle = RULE; ctx.fillStyle = INK2; ctx.lineWidth = 1;
    const yt = opts.logy ? (() => { const a = []; for (let e = Math.ceil(Math.log10(ymin)); e <= Math.log10(ymax * 1.3); e++) a.push(10 ** e); return a; })()
                         : niceTicks(0, ymax * 1.08, 4);
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const v of yt) { const y = Y(v); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillText(fmt(v), L - 6, y); }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    if (s7.mode === "per_value" && s7.centers) {
      const every = Math.max(1, Math.ceil(s7.centers.length / 12));
      s7.centers.forEach((c, i) => { if (i % every === 0) ctx.fillText(fmt(c), (X(i) + X(i + 1)) / 2, T + ph + 6); });
    } else {
      for (const v of niceTicks(edges[0], edges[nb], 6)) { const x = L + pw * (v - edges[0]) / (edges[nb] - edges[0] || 1); ctx.fillText(fmt(v), x, T + ph + 6); }
    }
    ctx.strokeStyle = INK; ctx.strokeRect(L, T, pw, ph);
    // background filled, signal as steps
    for (const s of series) {
      ctx.beginPath();
      ctx.moveTo(X(0), Y(opts.logy ? ymin : 0));
      for (let i = 0; i < nb; i++) { ctx.lineTo(X(i), Y(s.y[i])); ctx.lineTo(X(i + 1), Y(s.y[i])); }
      ctx.lineTo(X(nb), Y(opts.logy ? ymin : 0));
      if (s.k === "bkg") { ctx.fillStyle = "rgba(140,149,165,.28)"; ctx.fill(); }
      ctx.strokeStyle = COLORS[s.k] || INK; ctx.lineWidth = s.k === "bkg" ? 1.2 : 1.8; ctx.stroke();
    }
    if (opts.working != null && opts.working >= edges[0] && opts.working <= edges[nb]) {
      const x = L + pw * (opts.working - edges[0]) / (edges[nb] - edges[0] || 1);
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = "#C10E4A"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.restore();
    }
    ctx.save(); ctx.translate(14, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillStyle = INK2;
    ctx.fillText((opts.norm ? "fraction per bin" : "events per bin") + (opts.logy ? " (log)" : ""), 0, 0); ctx.restore();
  }

  function box(canvas, boxes, order) {
    const {ctx, w, h} = setup(canvas);
    const L = 86, R = 14, T = 10, B = 26, pw = w - L - R;
    const rows = order.filter(k => boxes[k]);
    const live = rows.map(k => boxes[k]).filter(b => !b.suppressed);
    // axis = whiskers + 15% margin; outliers beyond the margin sit on the edge, counted
    const wlo = Math.min(...live.map(b => b.whisk_lo)), whi = Math.max(...live.map(b => b.whisk_hi));
    const pad = 0.15 * ((whi - wlo) || 1), lo = wlo - pad, hi = whi + pad;
    const rh = (h - T - B) / Math.max(rows.length, 1);
    const X = v => L + pw * (v - lo) / ((hi - lo) || 1);
    ctx.strokeStyle = RULE; ctx.fillStyle = INK2; ctx.textAlign = "center"; ctx.textBaseline = "top";
    if (live.length) for (const v of niceTicks(lo, hi, 6)) { const x = X(v); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, h - B); ctx.stroke(); ctx.fillText(fmt(v), x, h - B + 6); }
    rows.forEach((k, i) => {
      const b = boxes[k], yc = T + rh * (i + .5), bh = Math.min(22, rh * .6);
      ctx.fillStyle = INK; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(k === "sig_pooled" ? "sig (all)" : k, L - 8, yc);
      if (b.suppressed) { ctx.textAlign = "left"; ctx.fillStyle = INK2; ctx.fillText(`suppressed: ${b.reason}, median ${fmt(b.median)}`, L + 6, yc); return; }
      const c = COLORS[k] || INK;
      ctx.strokeStyle = c; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(X(b.whisk_lo), yc); ctx.lineTo(X(b.q1), yc); ctx.moveTo(X(b.q3), yc); ctx.lineTo(X(b.whisk_hi), yc);
      ctx.moveTo(X(b.whisk_lo), yc - bh / 3); ctx.lineTo(X(b.whisk_lo), yc + bh / 3); ctx.moveTo(X(b.whisk_hi), yc - bh / 3); ctx.lineTo(X(b.whisk_hi), yc + bh / 3); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.fillRect(X(b.q1), yc - bh / 2, X(b.q3) - X(b.q1), bh);
      ctx.strokeRect(X(b.q1), yc - bh / 2, X(b.q3) - X(b.q1), bh);
      ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(X(b.median), yc - bh / 2); ctx.lineTo(X(b.median), yc + bh / 2); ctx.stroke();
      ctx.lineWidth = 1; ctx.fillStyle = c; ctx.globalAlpha = 0.55;
      let off = 0;
      for (const v of [...(b.out_lo || []), ...(b.out_hi || [])]) {
        const vv = Math.min(hi, Math.max(lo, v)); if (vv !== v) off++;
        ctx.beginPath(); ctx.arc(X(vv), yc, 1.8, 0, 2 * Math.PI); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.fillStyle = INK2;
      const out = b.n_out_lo + b.n_out_hi;
      if (out) ctx.fillText(`${out.toLocaleString()} beyond 1.5 IQR${off ? ", drawn points off-scale pinned to the edge" : ""}`, L + 4, yc - bh / 2 - 2);
    });
  }

  function legend(el, keys) {
    el.innerHTML = keys.map(k => `<span><i style-color="${k}"></i>${k === "bkg" ? "background (data24VR)" : k + " signal (MC)"}</span>`).join("");
    el.querySelectorAll("i").forEach(i => { i.style.background = COLORS[i.getAttribute("style-color")] || INK; });
  }

  return {hist, box, legend, COLORS};
})();
