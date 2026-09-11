"use strict";
(() => {
  const {api, esc, pct, num} = PFD;
  const qs = new URLSearchParams(location.search);
  const region = qs.get("region") || "endcap", name = qs.get("name") || "";
  let D = null;

  function kv(rows) { return rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join(""); }

  function drawCharts() {
    const s7 = D.result.s7;
    if (!s7 || s7.skipped) {
      document.getElementById("histnote").textContent = `No figures: column type is ${s7 ? s7.skipped : "unknown"}.`;
      return;
    }
    const norm = document.getElementById("norm").checked;
    const wp = s7.working ? s7.working.bkg_median : null;
    Charts.hist(document.getElementById("hist"), s7, {norm, logy: false, working: wp});
    Charts.hist(document.getElementById("histlog"), s7, {norm, logy: true, working: wp});
    Charts.legend(document.getElementById("legend"), Object.keys(s7.hist));
    const over = Object.entries(s7.hist).filter(([, v]) => v.under || v.over).map(([k, v]) => `${k}: ${v.under} under, ${v.over} over`);
    document.getElementById("histnote").textContent = (s7.mode === "per_value" ? "One bin per value. " : "Range: pooled 0.1–99.9% quantiles. ") + (over.length ? "Outside range: " + over.join("; ") : "");
    const order = [...D.samples, "sig_pooled"];
    Charts.box(document.getElementById("box"), s7.box, order);
    document.getElementById("boxnote").textContent = "Points beyond 1.5 IQR are drawn (up to 300 per side, evenly thinned; the total is printed). " +
      (D.result.s5 && D.result.s5.fired ? "S5 fired on this column: a spike distorts the quartiles." : "");
  }

  function render() {
    const r = D.result, v = r.verdict;
    document.getElementById("fname").textContent = D.name;
    document.getElementById("fregion").textContent = region;
    document.getElementById("fverdict").innerHTML = `<span class="v ${v.verdict}">${v.verdict}</span>`;
    const net = document.getElementById("fnet");
    if (D.net) { net.textContent = D.net; net.classList.remove("hidden"); }
    document.getElementById("back").href = `/board?region=${region}`;
    const st = D.status || {};
    document.getElementById("fstatus").innerHTML =
      (st.data_state === "STALE" ? `<div class="banner warn">Stale: the input files changed since this run.</div>` : "") +
      (st.rulings_changed ? `<div class="banner warn">Rulings changed since this run. Re-run the gate on the Run page to apply them.</div>` : "") +
      (st.reference && st.reference.status !== "VERIFIED" ? `<div class="banner small">Reference status: ${esc(st.reference.status)}.</div>` : "");
    document.getElementById("reasons").innerHTML = v.reasons.map(x => `<li><span class="v ${x.level}">${x.level}</span> ${esc(x.gate)}: ${esc(x.why)}</li>`).join("") || "<li>No gate objected.</li>";
    document.getElementById("notes").innerHTML = v.notes.map(n => `<li>${esc(n)}</li>`).join("");

    // S2
    const s2 = r.s2;
    document.getElementById("s2").innerHTML = D.samples.map(smp => {
      const p = s2.per_sample[smp];
      if (!p || !p.present) return `<tr><td>${smp}</td><td colspan="5" class="flag">column absent from this file</td></tr>`;
      const sent = Object.entries(p.sentinels).map(([k, n]) => `${esc(k)}: ${n.toLocaleString()}`).join(", ") || "—";
      return `<tr><td>${smp}</td><td class="num">${p.n.toLocaleString()}</td><td class="num">${p.nan.toLocaleString()}</td><td class="num">${p.inf.toLocaleString()}</td><td>${sent}</td><td class="num">${pct(p.invalid_frac, 2)}</td></tr>`;
    }).join("") + `<tr><th colspan="5">Class (worst sample)</th><td class="num"><b>${esc(s2.class)}</b></td></tr>`;
    const seen = {};
    for (const smp of D.samples) {
      const p = s2.per_sample[smp];
      for (const c of (p && p.candidates) || []) (seen[c.value] = seen[c.value] || []).push(`${smp} ${pct(c.share, 1)}`);
    }
    const rul = D.rulings || {};
    const ruled = [...(rul.sentinel || []).map(x => [x, "sentinel"]), ...(rul.genuine || []).map(x => [x, "genuine"])];
    const vals = [...new Set([...Object.keys(seen).map(Number), ...ruled.map(x => x[0])])].sort((a, b) => a - b);
    document.getElementById("cands").innerHTML = vals.map(val => {
      const cur = (ruled.find(x => x[0] === val) || [null, "pending"])[1];
      return `<tr><td class="num">${num(val)}</td><td>${esc((seen[val] || ["(not seen in this run)"]).join(", "))}</td>
        <td class="${cur === "pending" ? "flag" : ""}">${cur}</td>
        <td><button type="button" data-rule="sentinel" data-val="${val}">Sentinel</button>
            <button type="button" data-rule="genuine" data-val="${val}">Genuine</button>
            ${cur !== "pending" ? `<button type="button" data-rule="clear" data-val="${val}">Clear</button>` : ""}</td></tr>`;
    }).join("") || `<tr><td colspan="4" class="muted">None.${r.s1.type !== "continuous" ? " Candidate detection runs on continuous columns only." : ""}</td></tr>`;

    // S13
    const s13 = r.s13;
    document.getElementById("s13").innerHTML = kv([
      ["Value AUC, sig vs bkg", s13.value_auc == null ? "—" : s13.value_auc.toFixed(4)],
      ["Separation max(AUC, 1−AUC)", s13.value_sep == null ? "—" : `${s13.value_sep.toFixed(4)}${s13.provenance_flag ? ' <span class="flag">provenance flag</span>' : ""}`],
      ["Invalid-pattern separation", s13.nan_sep == null ? "—" : s13.nan_sep.toFixed(4)],
      ["Known exclusion", esc(s13.known_exclusion || "no")],
      ["Constant in one sample", esc(s13.constant_in_one || "no")],
      ["Mass-point dependence (S13.2)", s13.mass_mi ? `MI ${num(s13.mass_mi.mi_bits, 4)} bits vs null ${num(s13.mass_mi.null_mean, 4)} ± ${num(s13.mass_mi.null_sd, 4)}, z ${s13.mass_mi.z == null ? "—" : s13.mass_mi.z.toFixed(1)}${s13.mass_mi.flag ? ' <span class="flag">flag</span>' : ""} (n ${s13.mass_mi.n})` : "—"],
      ["Exclusion reason", esc(s13.exclusion_reason || "—")],
      ["Data vs MC comparability", esc(s13.comparability)],
      ["Leak candidate", s13.leak ? '<b class="flag">yes</b>' : "no"],
    ]) + `<tr><td colspan="2" class="small muted">Signal is MC and background is data: separation here can be mismodeling, not physics.</td></tr>`;

    const s3 = r.s3, s4 = r.s4, s5 = r.s5;
    const spikes = (s5.spikes || []).map(sp => `${num(sp.value)} holds ${pct(sp.share, 1)} (${sp.kind})`).join("; ");
    const zi = s5.zi;
    document.getElementById("s345").innerHTML = kv([
      ["Type (S1)", esc(r.s1.type)],
      ["Top value", s3.top_value == null ? "—" : `${num(s3.top_value)} (${pct(s3.top_share, 3)})`],
      ["Constant / near-constant", `${s3.constant ? "constant" : "no"} / ${s3.near_constant ? "yes" : "no"}`],
      ["Family menu (S1)", esc((r.s1.family_menu || []).join(", ") || "—")],
      ["Distinct values (S4)", s4.skipped ? "—" : `${s4.n_unique}${s4.low_card ? " (low cardinality)" : ""}${s4.dequant_candidate ? ", dequantization candidate: " + esc(s4.treatment) : ""}`],
      ["Tie fraction (events sharing a value)", pct(s5.tie_frac, 2)],
      ["Spikes (> 1%)", spikes || "—"],
      ["Zero-inflation (counts)", !zi ? "—" : `P(0) ${pct(zi.zero_share, 1)} vs Poisson ${zi.poisson_p0 == null ? "—" : pct(zi.poisson_p0, 1)}, NB ${zi.nb_p0 == null ? "n/a (not overdispersed)" : pct(zi.nb_p0, 1)}; van den Broek z ${zi.vdb_z == null ? "—" : zi.vdb_z.toFixed(1)}${zi.zero_inflated ? ' <span class="flag">zero-inflated</span>' : ""}`],
    ]);

    // S6
    const s6 = r.s6;
    const t6 = document.getElementById("s6");
    if (!s6 || s6.skipped) { t6.querySelector("tbody").innerHTML = `<tr><td class="muted">Not computed for type ${esc(s6 && s6.skipped)}.</td></tr>`; }
    else {
      const cols = Object.keys(s6.per_sample);
      const F = [["n", d => d.n?.toLocaleString() ?? "—"], ["mean", d => num(d.mean)], ["sd", d => num(d.sd)], ["min", d => num(d.min)],
        ["0.5%", d => num(d.q005)], ["1%", d => num(d.q01)], ["5%", d => num(d.q05)], ["25%", d => num(d.q25)], ["median", d => num(d.median)],
        ["75%", d => num(d.q75)], ["95%", d => num(d.q95)], ["99%", d => num(d.q99)], ["99.5%", d => num(d.q995)], ["max", d => num(d.max)],
        ["IQR", d => num(d.iqr)], ["MAD", d => num(d.mad)],
        ["skew", d => num(d.skew, 3)], ["excess kurtosis", d => num(d.excess_kurtosis, 3)], ["L-skew", d => num(d.l_skew, 3)], ["L-kurtosis", d => num(d.l_kurtosis, 3)],
        ["tail ratio left", d => d.tail ? num(d.tail.left_ratio, 2) : "—"], ["tail ratio right", d => d.tail ? num(d.tail.right_ratio, 2) : "—"],
        ["tail basis", d => d.tail ? esc(d.tail.basis) : "—"],
        ["Hill tail index α (k)", d => d.hill && d.hill.alpha != null ? `${num(d.hill.alpha, 2)} (${d.hill.k})` : "—"]];
      t6.querySelector("thead").innerHTML = `<tr><th></th>${cols.map(c => `<th class="num">${c === "sig_pooled" ? "sig (all)" : c}</th>`).join("")}</tr>`;
      t6.querySelector("tbody").innerHTML = F.map(([lab, f]) => `<tr><th>${lab}</th>${cols.map(c => `<td class="num">${f(s6.per_sample[c] || {})}</td>`).join("")}</tr>`).join("");
    }
    // S9
    const s9 = r.s9 || {};
    document.getElementById("s9src").innerHTML = s9.skipped ? `Not run: ${esc(s9.skipped)}.` :
      (s9.source === "llp" ? `Transforms from the training path: ${esc(s9.source_path)}.` : '<span class="flag">Reference transforms</span>: PFD_LLP_SRC not set, so these are not the training path\'s scaler.') +
      ` Achievable ceiling ${num(s9.ceiling_bits, 2)} bits${s9.column_limited ? ' <span class="flag">column-limited</span>: no scaler can add resolution' : ""}. Pinned scaler: ${esc(s9.pinned || "—")}.`;
    document.getElementById("s9").innerHTML = s9.scalers ? Object.entries(s9.scalers).map(([m, x]) => `<tr>
      <td>${esc(m)}${m === s9.pinned ? " (pinned)" : ""}${x.source === "reference" && s9.source === "llp" ? " (reference)" : ""}</td>
      <td class="num">${num(x.entropy_bits, 2)}</td><td class="num">${pct(x.realised_frac, 1)}</td>
      <td class="num">${num(x.central_span)}</td><td class="num">${num(x.eff_resolution)}</td><td>${x.clips ? "yes" : "no"}</td>
      <td class="${x.flag ? "flag" : ""}">${x.grid_mismatch ? `grid mismatch: ${pct(x.outside_grid, 1)} of output outside the declared range, not scored` : x.flag ? "crushing" : "ok"}</td></tr>`).join("") :
      `<tr><td colspan="7" class="muted">—</td></tr>`;

    // prev / next
    const i = D.columns.indexOf(D.name);
    const go = j => { if (j >= 0 && j < D.columns.length) location.href = `/feature?region=${region}&name=${encodeURIComponent(D.columns[j])}`; };
    document.getElementById("prev").onclick = () => go(i - 1);
    document.getElementById("next").onclick = () => go(i + 1);
    document.getElementById("prev").disabled = i <= 0;
    document.getElementById("next").disabled = i >= D.columns.length - 1;
    drawCharts();
  }

  async function load() {
    const empty = document.getElementById("empty"), card = document.getElementById("card");
    if (!name) { empty.innerHTML = 'Pick a column on the <a href="/board">verdict board</a>.'; empty.classList.remove("hidden"); return; }
    try { D = await api(`/api/gate/${region}/column?name=${encodeURIComponent(name)}`); }
    catch (e) { empty.innerHTML = `${esc(e.message)}. <a href="/board?region=${region}">Back to the board</a>.`; empty.classList.remove("hidden"); return; }
    card.classList.remove("hidden");
    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("norm").addEventListener("change", drawCharts);
    window.addEventListener("resize", () => D && drawCharts());
    document.getElementById("cands").addEventListener("click", async e => {
      const b = e.target.closest("button[data-rule]");
      if (!b) return;
      try {
        const res = await api(`/api/gate/${region}/ruling`, {json: {column: name, value: Number(b.dataset.val), ruling: b.dataset.rule}});
        D.rulings = res.rulings; D.status = D.status || {}; D.status.rulings_changed = true;
        render(); PFD.refreshState();
      } catch (err) { alert(err.message); }
    });
    load();
  });
})();
