"use strict";
(() => {
  const {api, esc, pct, num, progressBar} = PFD;
  const REGIONS = ["barrel", "endcap"];
  let polling = null;

  function card(region, st, job) {
    const r = st && st.regions ? st.regions[region] : null;
    const tally = r ? Object.entries(r.tally).map(([k, v]) => `<span class="v ${k}">${k} ${v}</span>`).join(" ") : "";
    const counts = r ? Object.entries(r.counts).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(", ") : "";
    const warn = r && r.data_state !== "CURRENT" ? `<p class="flag small">Result is ${r.data_state}: the input files changed since this run.</p>` : "";
    const rul = r && r.rulings_changed ? `<p class="flag small">Rulings changed since this run. Re-run to apply them.</p>` : "";
    const busy = job && (job.status === "queued" || job.status === "running");
    return `<section class="panel" data-region="${region}">
      <h2>${region[0].toUpperCase() + region.slice(1)}</h2>
      ${r ? `<p class="small">Last run ${esc(r.generated)}${r.smoke ? " (smoke)" : ""}${r.cache_hit ? ", from cache" : ""}<br>
             Data ${esc(r.data_hash)}<br>${esc(counts)}</p><div class="chips">${tally}</div>${warn}${rul}
             <p class="small">Reference: ${esc(r.reference ? r.reference.status : "—")}<br><a href="/board?region=${region}">Open the verdict board</a></p>`
           : `<p class="small muted">No result in this session yet.</p>`}
      <p><button type="button" class="primary" data-run="${region}" ${busy ? "disabled" : ""}>Run gate</button>
         <button type="button" data-smoke="${region}" ${busy ? "disabled" : ""}>Smoke run</button></p>
      <div class="jobprog"></div>
    </section>`;
  }

  async function render() {
    const [st, jobs] = await Promise.all([PFD.refreshState(), api("/api/jobs", {poll: true})]);
    const latest = {};
    for (const j of jobs.jobs) { const reg = j.kind.split(":")[1]; if (!latest[reg] || j.id > latest[reg].id) latest[reg] = j; }
    const box = document.getElementById("regions");
    box.innerHTML = REGIONS.map(r => card(r, st, latest[r])).join("");
    for (const r of REGIONS) {
      const j = latest[r];
      const el = box.querySelector(`[data-region="${r}"] .jobprog`);
      if (j && (j.status === "running" || j.status === "queued"))
        progressBar(el, j.progress, j.status === "queued" ? `queued, position ${j.queue_position}` : j.msg);
      else if (j && j.status === "error") el.innerHTML = `<p class="flag small">Failed: ${esc(j.error)}</p>`;
    }
    const tb = document.querySelector("#jobs tbody");
    tb.innerHTML = jobs.jobs.slice().reverse().map(j => `<tr><td>${j.id}</td><td>${esc(j.label)}</td>
      <td>${j.status === "error" ? `<span class="flag">error</span>: ${esc(j.error)}` : j.status}</td>
      <td>${pct(j.progress, 0)} ${esc(j.msg)}</td><td class="num">${j.elapsed_s}s</td></tr>`).join("") ||
      `<tr><td colspan="5" class="muted">No jobs yet.</td></tr>`;
    document.getElementById("workers").textContent = `${jobs.workers} worker slot(s) on this server.`;
    const active = jobs.jobs.some(j => j.status === "running" || j.status === "queued");
    if (active && !polling) polling = setInterval(render, 1000);
    if (!active && polling) { clearInterval(polling); polling = null; }
  }

  async function inventory() {
    const ban = document.getElementById("loc-banner");
    try {
      const inv = await api("/api/inventory");
      document.getElementById("loc-path").textContent = "Locations file: " + inv.locations;
      document.querySelector("#inv tbody").innerHTML = inv.rows.map(r => `<tr>
        <td>${esc(r.key)}</td><td>${esc(r.filename)}</td>
        <td>${r.found ? '<span class="ok">found</span>' : '<span class="flag">NOT FOUND</span>'}</td>
        <td class="num">${r.mb ?? ""}</td><td class="small">${esc(r.path || "(no path in locations file)")}</td></tr>`).join("");
      const miss = inv.rows.filter(r => !r.found && !r.key.startsWith("NN_"));
      if (miss.length) { ban.textContent = `${miss.length} data file(s) not found. A region only runs when all five of its files are present.`; ban.classList.remove("hidden"); }
    } catch (e) {
      ban.textContent = e.message + (e.body && e.body.hint ? ` (${e.body.hint})` : "");
      ban.classList.remove("hidden");
    }
  }

  document.addEventListener("click", async e => {
    if (!e.target.dataset) return;
    const reg = e.target.dataset.run || e.target.dataset.smoke;
    if (!reg) return;
    e.target.disabled = true;
    try { await api("/api/gate/run", {json: {region: reg, smoke: !!e.target.dataset.smoke}}); }
    catch (err) { alert(err.message); }
    render();
  });

  async function meta() {
    const w = await api("/api/whoami");
    const s = w.s9_source;
    document.getElementById("s9src").innerHTML = s.error ? `<span class="flag">Broken: ${esc(s.error)}. Gate runs will stop until this is fixed.</span>` :
      s.kind === "llp" ? `<span class="ok">Training path</span>: ${esc(s.path)}` :
      `<span class="flag">Reference transforms</span> (PFD_LLP_SRC not set). S9 results are labelled as such.`;
    const n = w.notifier;
    document.getElementById("alerts").innerHTML = `Enabled: ${esc(n.transports.join(", "))}` +
      (n.problems.length ? `<br><span class="flag">Preflight failed: ${esc(n.problems.join("; "))}</span>` : "");
  }

  document.addEventListener("DOMContentLoaded", () => {
    inventory(); render(); meta();
    document.getElementById("testalert").addEventListener("click", async () => {
      const out = document.getElementById("testmsg");
      try { const r = await api("/api/notify/test", {json: {}}); out.textContent = r.sent ? "Sent: " + Object.entries(r.results).map(([k, v]) => `${k} ${v}`).join(", ") : "Not sent: " + r.reason; }
      catch (e) { out.textContent = e.message; }
    });
  });
})();
