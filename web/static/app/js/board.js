"use strict";
(() => {
  const {api, esc, pct, num} = PFD;
  let region = new URLSearchParams(location.search).get("region") || "endcap";
  let data = null;

  function s2cell(r) {
    const cls = {CLEAN: "ok", MASKABLE: "", UNUSABLE: "flag", ABSENT: "flag"}[r.s2] ?? "";
    return `<span class="${cls}">${esc(r.s2 || "—")}</span>${r.s2_worst ? ` ${pct(r.s2_worst, 1)}` : ""}${r.s2_pending ? ` <span class="flag">${r.s2_pending} to rule</span>` : ""}`;
  }

  function rows() {
    const q = document.getElementById("q").value.trim().toLowerCase();
    const fv = document.getElementById("fv").value, fl = document.getElementById("fl").value;
    const out = data.rows.filter(r => (!q || r.name.toLowerCase().includes(q)) && (!fv || r.verdict === fv) &&
      (!fl || (fl === "in" ? !!r.net : r.net === fl)));
    document.getElementById("shown").textContent = `${out.length} of ${data.rows.length} columns`;
    document.querySelector("#cols tbody").innerHTML = out.map(r => `<tr class="click" data-name="${esc(r.name)}" tabindex="0">
      <td>${esc(r.name)}</td><td>${r.net || ""}</td><td><span class="v ${r.verdict}">${r.verdict}</span></td>
      <td>${esc(r.type)}</td><td>${s2cell(r)}</td>
      <td class="${r.s3 === "ok" ? "" : "flag"}">${esc(r.s3)}</td>
      <td class="num">${r.s4 ?? "—"}${r.s4_low ? " low" : ""}</td>
      <td>${r.s5 ? '<span class="flag">fired</span>' : ""}</td>
      <td class="num ${r.s9_flag ? "flag" : ""}" title="${esc(r.s9_others.length ? "other scalers flagged: " + r.s9_others.join(", ") : "")}">${r.s9_pinned == null ? "—" : pct(r.s9_pinned, 0)}${r.s9_limited ? " lim" : ""}${r.s9_others.length && !r.s9_flag ? " *" : ""}</td>
      <td class="num ${r.s13_leak ? "flag" : r.s13_prov ? "flag" : ""}">${r.s13_sep == null ? "—" : r.s13_sep.toFixed(4)}</td>
      <td class="num">${r.s13_nan == null ? "—" : r.s13_nan.toFixed(4)}</td>
      <td class="num ${r.s13_mass_flag ? "flag" : ""}">${r.s13_mass_z == null ? "—" : r.s13_mass_z.toFixed(1)}</td>
      <td class="small">${esc(r.reasons.join("; "))}</td></tr>`).join("");
  }

  function banners(s) {
    const b = [];
    if (!s) return "";
    if (s.data_state === "STALE") b.push(`<div class="banner warn">The input files changed since this run. These results describe the old data. Re-run the gate.</div>`);
    if (s.data_state === "DATA_MISSING") b.push(`<div class="banner warn">Input files for this region are not reachable from this server, so freshness cannot be checked.</div>`);
    if (s.rulings_changed) b.push(`<div class="banner warn">Sentinel rulings changed since this run. Re-run the gate to apply them.</div>`);
    if (s.smoke) b.push(`<div class="banner warn">Smoke run: first 2,000 rows per file only.</div>`);
    return b.join("");
  }

  async function load() {
    document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.region === region));
    history.replaceState(null, "", `/board?region=${region}`);
    const empty = document.getElementById("empty"), board = document.getElementById("board");
    try { data = await api(`/api/gate/${region}`); }
    catch (e) {
      board.classList.add("hidden"); empty.classList.remove("hidden");
      empty.innerHTML = `${esc(e.message)}. <a href="/">Go to Run</a>.`;
      return;
    }
    empty.classList.add("hidden"); board.classList.remove("hidden");
    const s = data.status || {};
    document.getElementById("status-banners").innerHTML = banners(s);
    document.getElementById("runmeta").innerHTML = [
      ["Generated", data.generated], ["Data hash", data.data_hash],
      ["Events", Object.entries(data.counts).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(", ")],
      ["Row limit", data.nrows_limit ? `${data.nrows_limit} per file (smoke)` : "none"],
      ["Run by", data.identity || "—"], ["Code", `${data.engine || ""} ${data.code_commit || ""}`],
      ["S9 transforms", data.s9_source ? (data.s9_source.kind === "llp" ? "training path: " + data.s9_source.path : "reference (PFD_LLP_SRC not set)") : "—"],
      ["Admin columns", data.admin_present.join(", ") || "none found"],
      ["Pileup columns", data.pileup_present.length ? data.pileup_present.join(", ") : "none: the S15 run-period/pileup check is not testable on these files"]]
      .map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("");
    document.getElementById("tally").innerHTML = Object.entries(data.tally).map(([k, v]) => `<span class="v ${k}">${k} ${v}</span>`).join("");
    const ref = s.reference || {status: "—"};
    const refText = {UNVERIFIED: "No reference signed off for this data, settings and rulings. Every scan reads as unverified.",
      VERIFIED: "Matches the signed-off reference exactly.",
      REGRESSION: `Differs from the signed-off reference in ${ref.n_diffs} place(s).`,
      SMOKE: "Smoke runs cannot be signed off."}[ref.status] || "";
    document.getElementById("refstate").innerHTML = `<b class="${ref.status === "VERIFIED" ? "ok" : "flag"}">${ref.status}</b> ${refText}`;
    document.getElementById("signoff").disabled = ref.status !== "UNVERIFIED" || s.data_state !== "CURRENT" || s.rulings_changed;
    document.getElementById("refdiffs").innerHTML = (ref.diffs || []).length ?
      `<table><thead><tr><th>Column</th><th>Field</th><th>Reference</th><th>Now</th></tr></thead><tbody>${ref.diffs.map(d =>
        `<tr><td>${esc(d.column)}</td><td>${esc(d.field)}</td><td>${esc(JSON.stringify(d.ref))}</td><td>${esc(JSON.stringify(d.now))}</td></tr>`).join("")}</tbody></table>` : "None.";
    document.getElementById("canaries").innerHTML = data.canaries.map(c => `<tr><td>${esc(c.id)}</td><td>${esc(c.column)}</td><td>${esc(c.scan + ": " + c.expect)}</td>
      <td class="${c.status === "PASS" ? "ok" : "flag"}">${c.status === "NOT_FOUND" ? "NOT FOUND (check the header spelling)" : c.status}</td></tr>`).join("") ||
      `<tr><td colspan="4" class="muted">No canaries for this region.</td></tr>`;
    document.getElementById("listnote").textContent = data.active_list ?
      `Active list ${data.active_list.slug}@${data.active_list.version}` + (data.list_missing_in_data.length ? `. In the list but not in the data: ${data.list_missing_in_data.join(", ")}` : "") :
      "No active list. Pick one on the Catalogue page to see NN1/NN2 membership here.";
    renderCB(data.crossblock);
    renderSchema(data.schema);
    document.getElementById("notbuilt").textContent = "S9 pinned = realised fraction under the pinned scaler; lim = column-limited; * = another scaler would crush it. Not built in mk2: " + data.not_built.map(s => s.toUpperCase()).join(", ") + ".";
    rows();
  }

  function renderSchema(sc) {
    const el = document.getElementById("schema");
    if (!sc) { el.textContent = "Not in this result (re-run the gate)."; return; }
    const mm = sc.mass_point_mismatch || [];
    el.innerHTML = `<p>Columns per file: ${Object.entries(sc.ncols).map(([k, v]) => `${esc(k)} ${v}`).join(", ")}; ${sc.n_union} in the union.
      Columns missing from any file are META (provenance by construction): they identify which sample a row came from.</p>
      ${mm.length ? `<div class="banner bad">The mass points do not share one ntuple schema: ${mm.map(p => `${p.columns.length} column(s) missing from ${esc(p.missing_from.join(", "))}`).join("; ")}.</div>` : ""}
      <table><thead><tr><th class="num">Columns</th><th>Missing from</th><th>Names</th></tr></thead><tbody>
      ${sc.patterns.map(p => `<tr><td class="num">${p.columns.length}</td><td>${esc(p.missing_from.join(", "))}</td><td>${esc(p.columns.join(", "))}</td></tr>`).join("") || '<tr><td colspan="3">Every file carries every column.</td></tr>'}
      </tbody></table>`;
  }

  function renderCB(cb) {
    const el = document.getElementById("cb");
    if (!cb) { el.innerHTML = '<p class="small muted">Not run for this region in this session.</p>'; return; }
    const warn = [];
    if (cb.data_hash !== data.data_hash) warn.push("computed on different data than this gate run");
    if (cb.overlap && cb.overlap.length) warn.push("NN1 and NN2 share: " + cb.overlap.join(", "));
    if ((cb.missing_nn1 || []).length || (cb.missing_nn2 || []).length) warn.push("list features not in the data: " + [...(cb.missing_nn1 || []), ...(cb.missing_nn2 || [])].join(", "));
    el.innerHTML = `<table class="small"><tbody>
      <tr><th>List</th><td>${esc(cb.list)}</td></tr>
      <tr><th>dCor (mean ± sd over repeats)</th><td><b>${cb.dcor_mean.toFixed(4)}</b> ± ${cb.dcor_sd == null ? "—" : cb.dcor_sd.toFixed(4)}</td></tr>
      <tr><th>Permutation null</th><td>${cb.null_mean.toFixed(4)} ± ${cb.null_sd == null ? "—" : cb.null_sd.toFixed(4)}; z ${cb.z == null ? "—" : cb.z.toFixed(1)}</td></tr>
      <tr><th>Rows</th><td>${cb.n_used.toLocaleString()} valid background rows; ${cb.repeats} subsamples of ${cb.subsample}, ${cb.perms} permutations each</td></tr>
      <tr><th>Run</th><td>${esc(cb.generated)} by ${esc(cb.identity)}</td></tr></tbody></table>
      ${warn.map(w => `<p class="flag small">${esc(w)}</p>`).join("")}
      <p class="small"><a href="/api/crossblock/${region}" download>Per-feature breakdown (JSON)</a></p>`;
  }

  async function runCB() {
    const btn = document.getElementById("cbrun"), pr = document.getElementById("cbprog");
    btn.disabled = true;
    try {
      const j = (await api("/api/crossblock/run", {json: {region}})).job;
      for (;;) {
        const s = await api(`/api/jobs/${j.id}`, {poll: true});
        PFD.progressBar(pr, s.progress, s.status === "queued" ? `queued, position ${s.queue_position}` : s.msg);
        if (s.status === "done") break;
        if (s.status === "error") throw new Error(s.error);
        await new Promise(r => setTimeout(r, 1000));
      }
      pr.innerHTML = ""; await load(); PFD.refreshState();
    } catch (e) { pr.innerHTML = `<p class="flag small">${esc(e.message)}</p>`; }
    btn.disabled = false;
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("cbrun").addEventListener("click", runCB);
    document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => { region = b.dataset.region; load(); }));
    ["q", "fv", "fl"].forEach(id => document.getElementById(id).addEventListener("input", rows));
    document.querySelector("#cols tbody").addEventListener("click", e => {
      const tr = e.target.closest("tr[data-name]");
      if (tr) location.href = `/feature?region=${region}&name=${encodeURIComponent(tr.dataset.name)}`;
    });
    document.querySelector("#cols tbody").addEventListener("keydown", e => {
      const tr = e.target.closest("tr[data-name]");
      if (tr && e.key === "Enter") location.href = `/feature?region=${region}&name=${encodeURIComponent(tr.dataset.name)}`;
    });
    document.getElementById("signoff").addEventListener("click", async () => {
      if (!confirm("Sign this run off as the reference? Every later run on the same data, settings and rulings must reproduce it.")) return;
      try { await api(`/api/reference/${region}/signoff`, {json: {}}); } catch (e) { alert(e.message); }
      load(); PFD.refreshState();
    });
    load();
  });
})();
