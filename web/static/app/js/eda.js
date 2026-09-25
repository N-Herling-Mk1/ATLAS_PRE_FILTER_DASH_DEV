/* eda.js -- the EDA sheet on the hub (mk46). Plan: docs/EDA_PLAN_mk1.md.

   mk46: every card carries its MaxEnt case and best fits; the search box finds
   a feature and Enter opens it; clicking a plot opens the ENLARGED view, which
   replaces the grid with four panels (S/B overlay, MaxEnt fit per class,
   log-likelihood ratio, CDFs), the MaxEnt ladder for each class, and the full
   descriptive statistics. Esc or "All graphs" returns to the grid.

   Wakes on the hub's "hub:open" event for the eda section, once. Reads the
   file manifest (headers only), then any result this session already has for
   the selected region. Generate runs /api/eda/run as a job and polls it with a
   progress bar; the grid draws each plot only when it scrolls into view. */
"use strict";
(() => {
  const root = document.getElementById("eda");
  if (!root) return;
  const $ = id => document.getElementById(id);
  const {api} = PFD;

  let region = "barrel", started = false, result = null, manifest = null, observer = null;

  /* ------------------------------------------------------------ formatting */
  function f(x, d = 4) {
    if (x == null || Number.isNaN(x)) return "\u2014";
    const a = Math.abs(x);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return x.toExponential(2);
    return (+x.toPrecision(d)).toString();
  }
  const int = x => (x == null ? "\u2014" : x.toLocaleString());
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function msg(text, kind) {
    const m = $("eda-msg");
    m.className = "banner " + (kind || "") + (text ? "" : " hidden");
    m.textContent = text || "";
  }

  /* -------------------------------------------------------------- manifest */
  function tile(fr, rows) {
    const t = el("div", "mf-file" + (fr.found ? "" : " missing") + (fr.error ? " missing" : ""));
    t.dataset.key = fr.key;
    t.appendChild(el("span", "mf-sample", fr.group === "background" ? "background" :
                                      fr.group === "signal" ? fr.sample : fr.sample.replace("_", " ")));
    t.appendChild(el("span", "mf-name", fr.filename));
    const big = el("span", "mf-cols");
    big.appendChild(el("b", null, fr.n_columns == null ? "\u2014" : String(fr.n_columns)));
    big.appendChild(el("span", null, "columns"));
    t.appendChild(big);
    const meta = el("span", "mf-meta");
    const r = rows && rows[fr.key];
    meta.textContent = !fr.found ? "not found" : fr.error ? fr.error :
      `${r == null ? "\u2014" : int(r)} rows \u00b7 ${fr.mb} MB`;
    t.appendChild(meta);
    if (fr.missing_vs_region && fr.missing_vs_region.length) {
      const w = el("span", "mf-warn", `${fr.missing_vs_region.length} column(s) other files in this region have`);
      w.title = fr.missing_vs_region.join(", ");
      t.appendChild(w);
    }
    t.title = fr.path || "(no path in the locations file)";
    return t;
  }

  function drawManifest() {
    const host = $("eda-manifest");
    host.textContent = "";
    if (!manifest) return;
    const rows = {};
    if (result) result.files.forEach(x => { rows[x.key] = x.rows; });
    const groups = [["barrel", "Barrel"], ["endcap", "Endcap"]];
    for (const [r, label] of groups) {
      const fs = manifest.files.filter(x => x.region === r);
      if (!fs.length) continue;
      const row = el("div", "mf-row" + (r === region ? " on" : ""));
      const head = el("div", "mf-head");
      head.appendChild(el("span", "mf-region", label));
      const u = manifest.regions[r];
      const nf = fs.filter(x => x.found).length;
      head.appendChild(el("span", "mf-union", u ? `${u.union} distinct columns across ${nf} of ${fs.length} files`
                                              : nf ? "headers unreadable" : "no files found for this region"));
      row.appendChild(head);
      const strip = el("div", "mf-strip");
      fs.forEach(x => strip.appendChild(tile(x, rows)));
      row.appendChild(strip);
      host.appendChild(row);
    }
    const nn = manifest.files.filter(x => x.group === "nn-list");
    if (nn.length) {
      const row = el("div", "mf-row mf-nn");
      const head = el("div", "mf-head");
      head.appendChild(el("span", "mf-region", "NN lists"));
      head.appendChild(el("span", "mf-union", "feature lists, not graphed here"));
      row.appendChild(head);
      const strip = el("div", "mf-strip");
      nn.forEach(x => strip.appendChild(tile(x, rows)));
      row.appendChild(strip);
      host.appendChild(row);
    }
  }

  async function loadManifest() {
    try {
      manifest = await api("/api/eda/files");
      $("eda-loc").textContent = "locations file: " + manifest.locations;
      drawManifest();
    } catch (e) {
      $("eda-manifest").textContent = "";
      $("eda-manifest").appendChild(el("p", "small", e.message + (e.body && e.body.hint ? " \u2014 " + e.body.hint : "")));
      $("eda-go").disabled = true;
    }
  }

  /* ---------------------------------------------------------------- region */
  function setRegion(r) {
    closeFocus();
    region = r;
    root.querySelectorAll(".eda-region button").forEach(b => b.setAttribute("aria-checked", String(b.dataset.region === r)));
    result = null;
    $("eda-results").hidden = true;
    msg("");
    drawManifest();
    loadResult(true);
  }

  async function loadResult(quiet) {
    try {
      result = await api(`/api/eda/${region}`);
      render();
    } catch (e) {
      if (e.status === 404) {
        if (!quiet) msg(e.message, "warn");
        else msg(`No graphs for ${region} in this session yet. Generate them to start.`);
      } else msg(e.message, "bad");
    }
  }

  /* ------------------------------------------------------------------- run */
  async function run() {
    const go = $("eda-go");
    go.disabled = true;
    msg("");
    const prog = $("eda-prog");
    PFD.progressBar(prog, 0, "submitting");
    try {
      const {job} = await api("/api/eda/run", {json: {region, smoke: $("eda-smoke").checked}});
      while (true) {
        await new Promise(r => setTimeout(r, 700));
        const j = await api(`/api/jobs/${job.id}`, {poll: true});
        const q = j.queue_position ? ` (queue position ${j.queue_position})` : "";
        PFD.progressBar(prog, j.progress, `${j.msg}${q} \u00b7 ${j.elapsed_s}s`);
        if (j.status === "done") break;
        if (j.status === "error") throw new Error(j.error);
      }
      await loadResult(false);
      prog.textContent = "";
    } catch (e) {
      prog.textContent = "";
      msg(e.message, "bad");
    } finally {
      go.disabled = false;
    }
  }

  /* ------------------------------------------------------------ vocabulary */
  const RUNG = {gauss: "Gaussian", m3: "cubic", m4: "quartic", exp: "exponential", gamma: "gamma",
                lognorm: "lognormal", uniform: "uniform", beta: "beta", geom: "geometric",
                cmp: "COM-Poisson", dgauss: "discrete Gaussian", infl: "+ inflation"};
  const CASE = {binary: "binary", lattice: "integer lattice", real: "density on R",
                positive: "density on R+", unit: "density on [0, 1]", unsupported: "not fitted", error: "fit failed"};
  const pc = x => (x == null ? "\u2014" : Math.round(100 * x) + "%");
  // an entropy estimate below about -0.02 nats is the estimator failing (values too coarse
  // for 64 bins), not information: say so rather than print a negative
  const nats = x => (x == null ? "\u2014" : x < -0.02 ? "n/a" : Math.abs(x) < 0.005 ? "\u22480" : f(x, 3));

  /* ---------------------------------------------------------------- render */
  function summary(res) {
    const s = $("eda-summary");
    s.textContent = "";
    const nS = ["mS5", "mS16", "mS35", "mS55"].reduce((a, k) => a + (res.counts[k] || 0), 0);
    const cases = {};
    res.columns.forEach(c => { const k = (c.maxent && c.maxent.case && c.maxent.case.case) || "?"; cases[k] = (cases[k] || 0) + 1; });
    const items = [
      [res.n_graphed, "columns graphed"],
      [res.n_columns_total, "columns in the region"],
      [res.admin_columns.length, "admin (slice keys, not graphed)"],
      [res.skipped.length, "skipped"],
      [nS, "signal events"],
      [res.counts.bkg, "background events"],
    ];
    for (const [v, label] of items) {
      const d = el("div", "sm-cell");
      d.appendChild(el("b", null, int(v)));
      d.appendChild(el("span", null, label));
      s.appendChild(d);
    }
    s.appendChild(el("p", "sm-note small muted",
      `${res.region}, data ${res.data_hash.slice(0, 8)}${res.smoke ? ", SMOKE (2,000 rows per file)" : ""}, ` +
      `generated ${res.generated}, ${res.eda}, ${res.elapsed_s}s. Signal per mass point: ` +
      ["mS5", "mS16", "mS35", "mS55"].map(k => `${k} ${int(res.counts[k])}`).join(", ") + ". MaxEnt cases: " +
      Object.entries(cases).map(([k, n]) => `${n} ${CASE[k] || k}`).join(", ") + "."));
  }

  function statsTable(c) {
    const t = el("table", "st");
    const head = el("tr");
    ["", "n", "invalid", "mean", "variance", "std-dev"].forEach((h, i) => head.appendChild(el("th", i ? "num" : null, h)));
    t.appendChild(head);
    for (const [k, label, cls] of [["sig", "S", "k-sig"], ["bkg", "B", "k-bkg"]]) {
      const s = c.stats[k];
      const tr = el("tr");
      const th = el("td", "cls");
      th.appendChild(el("i", cls));
      th.appendChild(document.createTextNode(label));
      tr.appendChild(th);
      [int(s.n), int(s.n_invalid), f(s.mean), f(s.var), f(s.std)].forEach(v => tr.appendChild(el("td", "num", v)));
      t.appendChild(tr);
    }
    return t;
  }

  function row(host, label, parts, cls) {
    const r = el("div", "me-row" + (cls ? " " + cls : ""));
    r.appendChild(el("span", "me-k", label));
    parts.forEach(([k, v, c]) => {
      const s = el("span", "me-v" + (c ? " " + c : ""));
      if (k) s.appendChild(el("em", null, k));
      s.appendChild(document.createTextNode((k ? " " : "") + v));
      r.appendChild(s);
    });
    host.appendChild(r);
  }

  /* the MaxEnt line on a card: what the column is, which fit wins, how much of
     the separation the fits see, and the Gaussian's share for contrast */
  function maxentCard(c, d) {
    const me = c.maxent || {}, cs = me.case || {};
    if (cs.case === "binary" && me.binary) {
      row(d, "MaxEnt", [["", "binary, Bernoulli"], ["p S", f(me.binary.p_sig, 3)], ["p B", f(me.binary.p_bkg, 3)]], "me-case");
      return;
    }
    if (!me.headline) {
      row(d, "MaxEnt", [["", cs.label || "not fitted"]], "me-case");
      return;
    }
    const h = me.headline;
    const sameRung = h.bkg_rung === h.sig_rung;
    row(d, "MaxEnt", [["", (CASE[cs.case] || cs.case) + (cs.spike != null && cs.case !== "lattice" ? ", hurdle" : "")],
                      ["B", RUNG[h.bkg_rung] + (h.identified_bkg ? "" : "?")],
                      ["S", sameRung ? "same" : RUNG[h.sig_rung] + (h.identified_sig ? "" : "?")]], "me-case");
    row(d, "", [["captures", pc(h.captured)], ["Gaussian", pc(h.gauss_captured)], ["left out B", nats(h.left_out_bkg)]]);
  }

  function gaussRef(c, d) {
    const m = c.gauss_ref;
    if (!m.discrete) row(d, "Gaussian ref", [["J S", nats(m.sig.J)], ["J B", nats(m.bkg.J)]]);
    const above = m.DB_hist != null && m.DB_null != null && m.DB_hist > 2 * m.DB_null;
    row(d, "separation", m.disjoint
      ? [["DB hist", "\u221e disjoint \u2014 check for leakage", "flag"], ["null", f(m.DB_null, 3)]]
      : [["DB hist", f(m.DB_hist, 3), above ? "hot" : null], ["null", f(m.DB_null, 3)]]);
  }

  function card(c) {
    const k = el("article", "pc");
    k.dataset.col = c.column;
    const h = el("header", "pc-head");
    h.appendChild(el("h5", null, c.column));
    h.appendChild(el("span", "pc-type", c.type + (c.mode === "per_value" ? ", per value" : "")));
    const b = el("button", "pc-open", "Enlarge");
    b.type = "button";
    b.setAttribute("aria-label", "Enlarge " + c.column);
    b.addEventListener("click", e => { e.stopPropagation(); openFocus(c.column); });
    h.appendChild(b);
    k.appendChild(h);
    const cv = el("canvas", "pc-plot");
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", `${c.column}: signal and background histogram`);
    cv.addEventListener("click", () => openFocus(c.column));
    k.appendChild(cv);
    const hs = c.hist.sig_pooled, hb = c.hist.bkg;
    if (hs.under + hs.over + hb.under + hb.over) k.appendChild(el("p", "pc-tails small muted",
      `outside the axis: S ${int(hs.under)} below, ${int(hs.over)} above; B ${int(hb.under)} below, ${int(hb.over)} above`));
    if (c.missing_in.length) k.appendChild(el("p", "pc-tails small warn-ink", "absent from " + c.missing_in.join(", ")));
    k.appendChild(statsTable(c));
    const d = el("div", "me");
    maxentCard(c, d);
    gaussRef(c, d);
    k.appendChild(d);
    k._col = c;
    return k;
  }

  function logyFor(c) {
    const m = $("eda-y").value;
    return m === "log" || (m === "auto" && c.auto_logy);
  }

  function draw(k) {
    const c = k._col;
    Charts.hist(k.querySelector("canvas"), {mode: c.mode, edges: c.edges, centers: c.centers, hist: c.hist},
                {norm: $("eda-norm").checked, logy: logyFor(c)});
    k.dataset.drawn = "1";
  }

  function sortKey(c, how) {
    const m = c.gauss_ref, h = (c.maxent && c.maxent.headline) || {};
    if (how === "sep") return m.disjoint ? -Infinity : -((m.DB_hist ?? -1) - (m.DB_null ?? 0));
    if (how === "share") return m.moment_share ?? Infinity;
    if (how === "shape") return -(((h.captured ?? 0) - (h.gauss_captured ?? 0)) || -Infinity);
    if (how === "left") return -(h.left_out_bkg ?? -Infinity);
    return 0;
  }

  function ordered() {
    return [...$("eda-grid").children].filter(k => !k.hidden);
  }

  function layout() {
    const grid = $("eda-grid");
    const q = $("eda-filter").value.trim().toLowerCase();
    const how = $("eda-sort").value;
    const cards = [...grid.children];
    const order = how === "file" ? cards.sort((a, b) => a._i - b._i)
                                 : cards.sort((a, b) => sortKey(a._col, how) - sortKey(b._col, how) || a._i - b._i);
    order.forEach(k => { k.hidden = !!q && !k.dataset.col.toLowerCase().includes(q); grid.appendChild(k); });
  }

  function redrawAll() {
    $("eda-grid").querySelectorAll(".pc").forEach(k => {
      k.dataset.drawn = "";
      if (k._visible) draw(k);
    });
    if (focus.data) drawFocus();
  }

  function render() {
    const res = result;
    msg("");
    $("eda-results").hidden = false;
    closeFocus();
    summary(res);
    drawManifest();
    const grid = $("eda-grid");
    grid.textContent = "";
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        e.target._visible = e.isIntersecting;
        if (e.isIntersecting && !e.target.dataset.drawn) draw(e.target);
      }
    }, {root: document.getElementById("screen-body"), rootMargin: "300px 0px"});
    const dl = $("eda-cols");
    dl.textContent = "";
    res.columns.forEach((c, i) => {
      const k = card(c);
      k._i = i;
      grid.appendChild(k);
      observer.observe(k);
      const o = document.createElement("option");
      o.value = c.column;
      dl.appendChild(o);
    });
    layout();
    const sk = res.skipped;
    $("eda-skipped").textContent = sk.length
      ? "Not graphed: " + sk.map(s => `${s.column} (${s.reason})`).join("; ") + "."
      : "";
  }

  /* ================================================================ PLOTS ==
     A small canvas plotter for the enlarged view: white plate, the site's plot
     ink, nice ticks. Charts.hist stays the card renderer. */
  const INK = "#172033", INK2 = "#5A6478", RULE = "#D5DAE2";
  const C_S = "#FF2D6B", C_B = "#6E7890", C_BF = "rgba(140,149,165,.28)", C_SF = "rgba(255,45,107,.12)";
  const MASS = {mS5: "#440154", mS16: "#31688E", mS35: "#35B779", mS55: "#A8CC1F"};

  function niceTicks(lo, hi, n) {
    if (!(hi > lo)) return [lo];
    const s0 = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(s0)));
    const s = [1, 2, 5, 10].map(m => m * p).find(v => v >= s0) || s0;
    const out = [];
    for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-12 * Math.abs(hi || 1); v += s) out.push(+v.toPrecision(10));
    return out;
  }
  function tf(v) { const a = Math.abs(v); return a !== 0 && (a >= 1e5 || a < 1e-3) ? v.toExponential(1) : String(+v.toPrecision(4)); }

  function plot(canvas, o) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px "Share Tech Mono", monospace';
    const L = 52, R = 10, T = 10, B = 26, pw = w - L - R, ph = h - T - B;
    const {xlo, xhi} = o;
    let {ylo, yhi} = o;
    if (o.logy) { ylo = Math.max(ylo, 1e-6); }
    const X = x => L + pw * (x - xlo) / ((xhi - xlo) || 1);
    const Y = y => o.logy
      ? T + ph * (1 - (Math.log10(Math.max(y, ylo)) - Math.log10(ylo)) / ((Math.log10(yhi) - Math.log10(ylo)) || 1))
      : T + ph * (1 - (y - ylo) / ((yhi - ylo) || 1));
    ctx.strokeStyle = RULE; ctx.fillStyle = INK2; ctx.lineWidth = 1;
    const yt = o.logy ? (() => { const a = []; for (let e = Math.ceil(Math.log10(ylo)); e <= Math.log10(yhi); e++) a.push(10 ** e); return a; })()
                      : niceTicks(ylo, yhi, 4);
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const v of yt) { const y = Y(v); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillText(tf(v), L - 5, y); }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const xt = o.xticks || niceTicks(xlo, xhi, 6).map(v => [v, tf(v)]);
    for (const [v, t] of xt) ctx.fillText(t, X(v), T + ph + 6);
    if (o.zero && ylo < 0 && yhi > 0) {
      ctx.save(); ctx.strokeStyle = INK2; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(L + pw, Y(0)); ctx.stroke(); ctx.restore();
    }
    ctx.save(); ctx.translate(12, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillStyle = INK2;
    ctx.fillText(o.ylabel || "", 0, 0); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
    const api = {
      ctx, X, Y,
      step(edges, ys, stroke, fill, width) {
        const base = o.logy ? ylo : Math.max(ylo, 0);
        ctx.beginPath(); ctx.moveTo(X(edges[0]), Y(base));
        ys.forEach((y, i) => { ctx.lineTo(X(edges[i]), Y(y)); ctx.lineTo(X(edges[i + 1]), Y(y)); });
        ctx.lineTo(X(edges[edges.length - 1]), Y(base));
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        ctx.strokeStyle = stroke; ctx.lineWidth = width || 1.4; ctx.stroke();
      },
      line(xs, ys, stroke, width, dash) {
        ctx.save(); ctx.setLineDash(dash || []); ctx.beginPath();
        let on = false;
        xs.forEach((x, i) => {
          const y = ys[i];
          if (y == null || !isFinite(y) || (o.logy && y <= 0)) { on = false; return; }
          on ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)); on = true;
        });
        ctx.strokeStyle = stroke; ctx.lineWidth = width || 1.8; ctx.stroke(); ctx.restore();
      },
      points(xs, ys, fill, r) {
        ctx.fillStyle = fill;
        xs.forEach((x, i) => { const y = ys[i]; if (y == null || !isFinite(y)) return;
          ctx.beginPath(); ctx.arc(X(x), Y(y), r || 2.6, 0, 2 * Math.PI); ctx.fill(); });
      },
      vline(x, stroke, label) {
        ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = stroke; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(X(x), T); ctx.lineTo(X(x), T + ph); ctx.stroke(); ctx.restore();
        if (label) { ctx.fillStyle = stroke; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(label, X(x) + 4, T + 3); }
      },
    };
    api.done = () => { ctx.restore(); ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(L, T, pw, ph); };
    return api;
  }

  /* ========================================================= ENLARGED VIEW == */
  const focus = {col: null, data: null, rung: "best", cache: {}};

  function closeFocus() {
    const fx = $("eda-focus");
    if (!fx || fx.hidden) return false;
    fx.hidden = true;
    ["eda-grid", "eda-tools", "eda-legend", "eda-skipped", "eda-summary"].forEach(id => { $(id).hidden = false; });
    focus.col = null; focus.data = null;
    return true;
  }

  async function openFocus(col) {
    if (!result) return;
    focus.col = col; focus.rung = "best";
    ["eda-grid", "eda-tools", "eda-legend", "eda-skipped", "eda-summary"].forEach(id => { $(id).hidden = true; });
    const fx = $("eda-focus");
    fx.hidden = false;
    $("fx-name").textContent = col;
    const card = result.columns.find(c => c.column === col);
    $("fx-type").textContent = card ? card.type + (card.mode === "per_value" ? ", one bin per value" : "") : "";
    const list = ordered().map(k => k.dataset.col);
    const i = list.indexOf(col);
    $("fx-pos").textContent = i >= 0 ? `${i + 1} of ${list.length}` : "";
    fx.scrollIntoView({block: "start"});             // past the manifest, straight to the feature
    const key = region + "|" + col;
    if (!focus.cache[key]) {
      $("fx-load").textContent = "Loading " + col + " \u2026";
      try {
        focus.cache[key] = await api(`/api/eda/${region}/feature?col=${encodeURIComponent(col)}`);
      } catch (e) {
        $("fx-load").textContent = e.message;
        return;
      }
    }
    if (focus.col !== col) return;                       // the user moved on while it loaded
    $("fx-load").textContent = "";
    focus.data = focus.cache[key];
    buildFocus();
    drawFocus();
    $("fx-back").focus();
  }

  function stepFocus(d) {
    const list = ordered().map(k => k.dataset.col);
    if (!list.length) return;
    const i = list.indexOf(focus.col);
    openFocus(list[((i < 0 ? 0 : i + d) % list.length + list.length) % list.length]);
  }

  /* ---- what this feature IS, and what the fits say about it, in sentences */
  function reading(d) {
    const me = d.maxent || {}, cs = me.case || {}, g = d.gauss_ref, out = [];
    $("fx-case").textContent = "MaxEnt case: " + (cs.label || "\u2014");
    if (g.disjoint) out.push(["flag", "Signal and background share no bin: this column alone classifies every event. On a feature that is a leakage signature \u2014 check it is not a label or a truth quantity."]);
    if (cs.case === "binary" && me.binary) {
      const b = me.binary;
      out.push([null, `A flag: the MaxEnt model is exact (Bernoulli). It is ${f(b.value, 3)} for ${pc(b.p_sig)} of signal and ${pc(b.p_bkg)} of background, Bhattacharyya distance ${f(b.db, 3)}.`]);
      return out;
    }
    if (!me.headline) { out.push([null, "No MaxEnt fit: " + (cs.label || "not fitted") + "."]); return out; }
    const h = me.headline;
    if (cs.spike != null && cs.case !== "lattice")
      out.push([null, `${pc(cs.top_share)} of the column sits at exactly ${f(cs.spike, 4)}. No smooth density can put weight on one value, so it is a separate point mass with its own weight per class (a hurdle) and the ladder is fitted to the rest.`]);
    if (cs.case === "lattice" && cs.spike != null)
      out.push([null, `${pc(cs.top_share)} of the column is at ${f(cs.spike, 4)}; the ladder has an extra rung that adds an indicator on that value \u2014 the MaxEnt form of inflation.`]);
    out.push([null, h.bkg_rung === h.sig_rung
      ? `Both classes are best described by the ${RUNG[h.bkg_rung]} model (${h.bkg_label}).`
      : `Background is best described by ${h.bkg_label}; signal by ${h.sig_label}. The classes differ in shape, not only in location or spread.`]);
    if (!h.identified_bkg) out.push(["warn", `Background is not identified at the family level: ${h.within_2_bkg.map(r => RUNG[r]).join(", ")} are within \u0394BIC 2. Any of them serves as a baseline, and the choice will not move ABCD.`]);
    if (!h.identified_sig) out.push(["warn", `Signal is not identified: ${h.within_2_sig.map(r => RUNG[r]).join(", ")} are within \u0394BIC 2.`]);
    if (h.agree_bkg === false) out.push(["warn", "For background, AIC and BIC pick different rungs. The true distribution is not in the ladder; that disagreement is itself the finding."]);
    const lo = h.left_out_bkg;
    if (lo != null && lo >= -0.02) out.push([null, lo < 0.01
      ? "The background fit leaves essentially nothing out: its constraint set carries the column's information."
      : `The background fit still leaves ${f(lo, 3)} nats out: structure no rung here captures (sharp features, several modes).`]);
    if (h.captured != null && h.gauss_captured != null) {
      const gap = h.captured - h.gauss_captured;
      out.push([gap > 0.25 ? "good" : null, `The two best fits see ${pc(h.captured)} of the histogram separation; the Gaussian pair sees ${pc(h.gauss_captured)}.` +
        (h.captured > 1.05 ? " Over 100%: the smooth fits separate the classes more cleanly than the binned data can show — read it as all of it, not more than all." : "") +
        (gap > 0.25 ? " The separation lives in shape that mean and variance miss, and the MaxEnt fits recover it."
          : h.captured < 0.5 ? " Even the best fits see under half of it: the discriminating structure is finer than any rung in the ladder."
          : " Mean and variance already carry most of it.")]);
    }
    if (g.DB_hist != null && g.DB_null != null && g.DB_hist <= 2 * g.DB_null)
      out.push(["warn", "The histogram separation is within twice the permutation null: at these sample sizes this column does not separate signal from background."]);
    return out;
  }

  function buildFocus() {
    const d = focus.data, me = d.maxent || {};
    const ul = $("fx-read"); ul.textContent = "";
    reading(d).forEach(([cls, t]) => ul.appendChild(el("li", cls, t)));
    // rung chips: best, then every rung fitted
    const rh = $("fx-rungs"); rh.textContent = "";
    const rungs = me.curves ? Object.keys(me.curves.rungs) : [];
    if (rungs.length) {
      ["best", ...rungs].forEach(r => {
        const b = el("button", "fx-rung", r === "best" ? "best per class" : RUNG[r]);
        b.type = "button";
        b.setAttribute("aria-pressed", String(focus.rung === r));
        b.addEventListener("click", () => { focus.rung = r; rh.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); drawFocus(); });
        rh.appendChild(b);
      });
    }
    ladder($("fx-lad-b"), me, "bkg");
    ladder($("fx-lad-s"), me, "sig");
    describeTable($("fx-desc"), d);
  }

  function ladder(host, me, tag) {
    host.textContent = "";
    const cl = me.classes && me.classes[tag];
    if (!cl || !cl.rungs || !cl.rungs.length) {
      host.appendChild(el("p", "small muted", me.case && me.case.case === "binary" ? "Bernoulli: exact, no ladder." : "No ladder for this column."));
      return;
    }
    const t = el("table", "st lad");
    const hr = el("tr");
    ["rung", "k", "\u0394BIC", "\u0394AIC", "left out", "DB S vs B"].forEach((h, i) => hr.appendChild(el("th", i > 1 ? "num" : i ? "num" : null, h)));
    t.appendChild(hr);
    cl.rungs.forEach(r => {
      const tr = el("tr", r.rung === cl.best_bic ? "best" : cl.within_2.includes(r.rung) ? "near" : null);
      const name = el("td", null, r.label + (r.converged ? "" : " (did not converge)"));
      tr.appendChild(name);
      [String(r.k), f(r.d_bic, 3), f(r.d_aic, 3), nats(r.left_out), f(r.db_between, 3)].forEach(v => tr.appendChild(el("td", "num", v)));
      t.appendChild(tr);
    });
    host.appendChild(t);
    const bits = [`n = ${int(cl.n)}`];
    if (cl.w_spike) bits.push(`point mass ${pc(cl.w_spike)}`);
    if (me.skipped_rungs && Object.keys(me.skipped_rungs).length)
      bits.push("not fitted: " + Object.entries(me.skipped_rungs).map(([k, v]) => `${RUNG[k] || k} (${v})`).join(", "));
    host.appendChild(el("p", "small muted", bits.join("; ") + ". Best rung bold; rungs within \u0394BIC 2 marked."));
  }

  function describeTable(host, d) {
    host.textContent = "";
    const s = d.describe.sig, b = d.describe.bkg;
    const keys = [["n", "n", int], ["mean", "mean", f], ["sd", "std-dev", f], ["var", "variance", f], ["mad", "MAD", f],
                  ["min", "min", f], ["q01", "1%", f], ["q05", "5%", f], ["q25", "25%", f], ["median", "median", f],
                  ["q75", "75%", f], ["q95", "95%", f], ["q99", "99%", f], ["max", "max", f], ["iqr", "IQR", f],
                  ["skew", "skew", f], ["excess_kurtosis", "excess kurtosis", f], ["l_skew", "L-skew", f], ["l_kurtosis", "L-kurtosis", f]];
    const t = el("table", "st");
    const hr = el("tr"); ["", "S", "B"].forEach((h, i) => hr.appendChild(el("th", i ? "num" : null, h))); t.appendChild(hr);
    const get = (o, k) => k === "var" ? (o.sd == null ? null : o.sd * o.sd) : o[k];
    keys.forEach(([k, label, fm]) => {
      const tr = el("tr"); tr.appendChild(el("td", null, label));
      tr.appendChild(el("td", "num", fm(get(s, k)))); tr.appendChild(el("td", "num", fm(get(b, k))));
      t.appendChild(tr);
    });
    const tl = o => o.tail && o.tail.right_ratio != null ? `${f(o.tail.left_ratio, 3)} / ${f(o.tail.right_ratio, 3)}` : "\u2014";
    const tr = el("tr"); tr.appendChild(el("td", null, "tail mass vs Gaussian, L / R"));
    tr.appendChild(el("td", "num", tl(s))); tr.appendChild(el("td", "num", tl(b))); t.appendChild(tr);
    host.appendChild(t);
    const g = d.gauss_ref;
    const p = el("p", "small muted");
    p.textContent = g.discrete ? `Discrete: H S ${nats(g.sig.H)}, H B ${nats(g.bkg.H)} nats.`
      : `Gaussian reference: H S ${nats(g.sig.H)}, H_G ${nats(g.sig.H_G)}, J ${nats(g.sig.J)}; ` +
        `H B ${nats(g.bkg.H)}, H_G ${nats(g.bkg.H_G)}, J ${nats(g.bkg.J)} nats. DB hist ${g.disjoint ? "\u221e" : f(g.DB_hist, 3)}, ` +
        `null ${f(g.DB_null, 3)}, KS ${f(d.cdf.ks, 3)}.`;
    host.appendChild(p);
  }

  function drawFocus() {
    const d = focus.data;
    if (!d) return;
    const norm = true, logy = logyFor(d);
    const e = d.edges, nb = e.length - 1;
    const frac = h => h.counts.map(c => (h.n ? c / h.n : 0));
    const fs = frac(d.hist.sig_pooled), fb = frac(d.hist.bkg);
    const xt = d.mode === "per_value" && d.centers
      ? d.centers.map((c, i) => [(e[i] + e[i + 1]) / 2, tf(c)]).filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 10)) === 0)
      : null;
    const pos = arr => arr.filter(v => v > 0);

    // ---- 1: overlay
    const split = $("fx-mass").checked && d.hist_mass;
    const massOrder = k => parseInt(k.slice(2), 10);
    const series = split ? Object.entries(d.hist_mass).sort((a, b) => massOrder(a[0]) - massOrder(b[0])).map(([k, h]) => [k, frac(h), h.n])
                         : [["sig_pooled", fs, d.hist.sig_pooled.n]];
    let ymax = Math.max(...fb, ...series.flatMap(s => s[1])) * 1.1 || 1;
    let ymin = logy ? Math.max(1e-5, Math.min(...pos([...fb, ...series.flatMap(s => s[1])])) / 2) : 0;
    let p = plot($("fx-c1"), {xlo: e[0], xhi: e[nb], ylo: ymin, yhi: logy ? ymax * 1.5 : ymax, logy, xticks: xt,
                              ylabel: "fraction per bin" + (logy ? " (log)" : "")});
    p.step(e, fb, C_B, C_BF, 1.2);
    series.forEach(([k, y]) => p.step(e, y, k === "sig_pooled" ? C_S : MASS[k], null, 1.7));
    p.done();
    const l1 = $("fx-l1"); l1.textContent = "";
    const key = (color, text) => { const sp = el("span", "fx-key"); const i = el("i"); i.style.background = color;
                                   sp.appendChild(i); sp.appendChild(document.createTextNode(text)); l1.appendChild(sp); };
    key(C_B, `background (n ${int(d.hist.bkg.n)})`);
    series.forEach(([k, , n]) => key(k === "sig_pooled" ? C_S : MASS[k], `${k === "sig_pooled" ? "signal, pooled" : k} (n ${int(n)})`));

    // ---- 2: MaxEnt fit per class
    const me = d.maxent || {}, cv = me.curves;
    const half = (canvas, tag, y, color, fill, nH) => {
      const top = Math.max(...y) * 1.15 || 1;
      const lo = logy ? Math.max(1e-5, Math.min(...pos(y)) / 2) : 0;
      const q = plot(canvas, {xlo: e[0], xhi: e[nb], ylo: lo, yhi: logy ? top * 1.5 : top, logy, xticks: xt,
                              ylabel: (tag === "sig" ? "signal" : "background")});
      q.step(e, y, color, fill, 1.1);
      if (cv && me.classes && me.classes[tag] && me.classes[tag].rungs && me.classes[tag].rungs.length) {
        const cl = me.classes[tag];
        const r = focus.rung === "best" ? cl.best_bic : focus.rung;
        const g = {real: "gauss", positive: "gauss", unit: "gauss", lattice: "dgauss"}[me.case.case];
        const scale = (cv.discrete ? (d.mode === "per_value" ? 1 : (e[1] - e[0])) : (e[1] - e[0])) * (cl.n_body / nH);
        const curve = rr => cv.rungs[rr] ? cv.rungs[rr][tag].map(v => v * scale) : null;
        if (g && g !== r && curve(g)) q.line(cv.x, curve(g), "#1E88D8", 1.3, [5, 4]);
        if (curve(r)) q.line(cv.x, curve(r), INK, 2);
      }
      q.done();
    };
    if (me.curves) {
      half($("fx-c2b"), "bkg", fb, C_B, C_BF, d.hist.bkg.n);
      half($("fx-c2s"), "sig", fs, C_S, C_SF, d.hist.sig_pooled.n);
      const lb = me.classes.bkg, ls = me.classes.sig;
      const name = cl => RUNG[focus.rung === "best" ? cl.best_bic : focus.rung];
      $("fx-l2").textContent = `Solid: ${focus.rung === "best" ? "each class's best fit" : RUNG[focus.rung] + " for both classes"} ` +
        `(B ${name(lb)}, S ${name(ls)}). Dashed blue: the Gaussian rung, for reference.` +
        (me.case.spike != null && !cv.discrete ? ` The point mass at ${f(me.case.spike, 4)} is not drawn as a curve.` : "") +
        " Curves cover the fitted range only.";
    } else {
      [$("fx-c2b"), $("fx-c2s")].forEach(c => { const x = c.getContext("2d"); x.clearRect(0, 0, c.width, c.height); });
      $("fx-l2").textContent = me.case && me.case.case === "binary"
        ? "Binary: the MaxEnt model is the Bernoulli, exact \u2014 the histogram is the fit."
        : "No MaxEnt fit for this column: " + ((me.case && me.case.label) || "not fitted") + ".";
    }

    // ---- 3: log-likelihood ratio
    const cen = e.slice(0, -1).map((x, i) => (x + e[i + 1]) / 2);
    const emp = fs.map((s, i) => (s > 0 && fb[i] > 0 ? Math.log(s / fb[i]) : null));
    let ys = emp.filter(v => v != null);
    let bestL = null, gaussL = null;
    if (me.curves) {
      const cb = me.classes.bkg, cs = me.classes.sig;
      const off = Math.log((cs.n_body / d.hist.sig_pooled.n) / (cb.n_body / d.hist.bkg.n));
      const lg = (rs, rb) => (cv.rungs[rs] && cv.rungs[rb])
        ? cv.x.map((_, i) => Math.log(cv.rungs[rs].sig[i]) - Math.log(cv.rungs[rb].bkg[i]) + off) : null;
      const rs = focus.rung === "best" ? cs.best_bic : focus.rung, rb = focus.rung === "best" ? cb.best_bic : focus.rung;
      bestL = lg(rs, rb);
      const g = {real: "gauss", positive: "gauss", unit: "gauss", lattice: "dgauss"}[me.case.case];
      gaussL = g ? lg(g, g) : null;
      [bestL, gaussL].forEach(a => a && a.forEach(v => { if (isFinite(v)) ys.push(v); }));
    }
    if (ys.length) {
      ys.sort((a, b) => a - b);
      const lo3 = Math.max(ys[0], ys[Math.floor(ys.length * 0.02)] - 1), hi3 = Math.min(ys[ys.length - 1], ys[Math.ceil(ys.length * 0.98) - 1] + 1);
      p = plot($("fx-c3"), {xlo: e[0], xhi: e[nb], ylo: Math.min(lo3, -0.5), yhi: Math.max(hi3, 0.5), zero: true, xticks: xt,
                            ylabel: "ln pS / pB"});
      if (gaussL) p.line(cv.x, gaussL, "#1E88D8", 1.3, [5, 4]);
      if (bestL) p.line(cv.x, bestL, INK, 2);
      p.points(cen, emp, C_S, 2.6);
      p.done();
      $("fx-l3").textContent = "Points: per-bin ratio from the histograms (bins empty in either class are left out). " +
        (bestL ? "Solid: the MaxEnt fits' ratio" + (focus.rung === "best" ? " (each class on its best rung)" : "") +
                 ". Dashed blue: the Gaussian pair, a parabola. Where the solid line follows the points and the parabola does not, the separation is in shape."
               : "No model ratio: no MaxEnt fit for this column.");
    } else {
      const c = $("fx-c3").getContext("2d"); c.clearRect(0, 0, $("fx-c3").width, $("fx-c3").height);
      $("fx-l3").textContent = "No bin holds both classes: the supports are disjoint.";
    }

    // ---- 4: CDFs with the KS gap
    const cd = d.cdf;
    p = plot($("fx-c4"), {xlo: cd.x[0], xhi: cd.x[cd.x.length - 1], ylo: 0, yhi: 1, ylabel: "cumulative fraction"});
    p.line(cd.x, cd.bkg, C_B, 1.8);
    p.line(cd.x, cd.sig, C_S, 1.8);
    p.vline(cd.at, INK, `KS ${f(cd.ks, 3)}`);
    p.done();
    $("fx-l4").textContent = `Largest gap between the two CDFs: KS = ${f(cd.ks, 3)} at ${f(cd.at, 4)} (p ${cd.ks_p != null && cd.ks_p < 1e-300 ? "< 1e-300" : "= " + f(cd.ks_p, 3)}).`;
  }

  /* ----------------------------------------------------------------- wiring */
  function start() {
    if (started) return;
    started = true;
    root.querySelectorAll(".eda-region button").forEach(b => b.addEventListener("click", () => setRegion(b.dataset.region)));
    $("eda-go").addEventListener("click", run);
    $("eda-filter").addEventListener("input", layout);
    // Enter, or picking a name from the list, opens that feature
    $("eda-filter").addEventListener("keydown", e => {
      if (e.key !== "Enter" || !result) return;
      const q = e.target.value.trim();
      const exact = result.columns.find(c => c.column === q);
      const hits = ordered();
      if (exact) openFocus(exact.column); else if (hits.length) openFocus(hits[0].dataset.col);
      e.preventDefault();
    });
    $("eda-filter").addEventListener("change", e => {
      if (result && result.columns.some(c => c.column === e.target.value)) openFocus(e.target.value);
    });
    $("eda-sort").addEventListener("change", layout);
    $("eda-y").addEventListener("change", redrawAll);
    $("eda-norm").addEventListener("change", redrawAll);
    $("fx-back").addEventListener("click", () => { const c = focus.col; closeFocus(); const k = [...$("eda-grid").children].find(x => x.dataset.col === c); if (k) k.scrollIntoView({block: "center"}); });
    $("fx-prev").addEventListener("click", () => stepFocus(-1));
    $("fx-next").addEventListener("click", () => stepFocus(1));
    $("fx-mass").addEventListener("change", drawFocus);
    // capture phase: runs before the hub's Escape, so Esc leaves the enlarged view first
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !$("eda-focus").hidden) { closeFocus(); e.preventDefault(); }
    }, true);
    let rt = null;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(redrawAll, 200); });
    loadManifest();
    loadResult(true);
  }
  document.addEventListener("hub:open", e => { if (e.detail && e.detail.id === "eda") start(); });
})();
