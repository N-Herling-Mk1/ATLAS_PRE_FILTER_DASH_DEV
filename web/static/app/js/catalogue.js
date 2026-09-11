"use strict";
(() => {
  const {api, esc} = PFD;
  const SLOTS = [["barrel", "NN1"], ["barrel", "NN2"], ["endcap", "NN1"], ["endcap", "NN2"]];
  let lists = [], preview = null, pyFound = [], cur = null, ops = [];

  // ------------------------------------------------------------ lists ----
  async function loadLists() {
    lists = (await api("/api/catalogue")).lists;
    const active = (PFD.state && PFD.state.active_list) || null;
    document.querySelector("#lists tbody").innerHTML = lists.map(l => `<tr>
      <td><button type="button" class="link" data-open="${esc(l.slug)}">${esc(l.name)}</button>${active && active.slug === l.slug ? ' <span class="chip small">on board</span>' : ""}</td>
      <td>${l.head}</td><td class="num">${l.counts.barrel.NN1}/${l.counts.barrel.NN2}</td><td class="num">${l.counts.endcap.NN1}/${l.counts.endcap.NN2}</td>
      <td class="num">${l.n_versions}</td><td class="small">${esc(l.updated)}</td>
      <td><button type="button" data-open="${esc(l.slug)}">Open</button></td></tr>`).join("");
    document.getElementById("nolists").textContent = lists.length ? "" : "No lists yet. Upload the registries you use (KJ July sheet, legacy, mk3_v3, pipeline partitions) below.";
    document.getElementById("pv-target").innerHTML = lists.map(l => `<option value="${esc(l.slug)}">${esc(l.name)}</option>`).join("");
    const opts = (await Promise.all(lists.map(l => api(`/api/catalogue/${encodeURIComponent(l.slug)}`))))
      .flatMap(d => d.history.map(h => `<option value="${esc(d.slug)}@${h.version}">${esc(d.slug)}@${h.version}${h.version === d.head ? " (head)" : ""}</option>`)).join("");
    document.getElementById("cmp-a").innerHTML = opts; document.getElementById("cmp-b").innerHTML = opts;
    loadMatrix();
  }

  function netsHTML(content, missing, editable) {
    return SLOTS.map(([r, n]) => {
      const miss = new Set((missing && missing[r]) || []);
      const items = content[r][n];
      return `<div class="col"><h3>${r} ${n} <span class="muted">(${items.length})</span></h3><ul>${items.map(f => {
        const pend = ops.some(o => o.feature === f && o.region === r);
        return `<li class="${miss.has(f) ? "missing" : ""} ${pend ? "pending" : ""}"><span>${esc(f)}${miss.has(f) ? " (not in data)" : ""}</span>${editable ?
          `<span><button type="button" data-mv="${esc(f)}" data-r="${r}" data-n="${n}" title="move to the other net">⇄</button><button type="button" data-rm="${esc(f)}" data-r="${r}" data-n="${n}" title="remove">×</button></span>` : ""}</li>`;
      }).join("")}</ul></div>`;
    }).join("") + (missing && Object.values(missing).some(v => v === null) ?
      `<p class="small muted nets-note">Data headers for ${Object.entries(missing).filter(([, v]) => v === null).map(([k]) => k).join(" and ")} are not reachable from this server, so names there are not checked against the data.</p>` : "");
  }

  // ------------------------------------------------------------ matrix ---
  let MX = null;
  async function loadMatrix() {
    MX = lists.length ? await api("/api/catalogue_matrix") : null;
    renderMatrix();
  }
  function renderMatrix() {
    const t = document.getElementById("mx");
    if (!MX || !MX.lists.length) { t.querySelector("thead").innerHTML = ""; t.querySelector("tbody").innerHTML = '<tr><td class="muted">Upload two or more lists to compare them.</td></tr>'; document.getElementById("mx-count").textContent = ""; return; }
    const only = document.getElementById("mx-only").checked, reg = document.getElementById("mx-region").value;
    const rows = MX.rows.filter(r => (!only || r.conflict) && (!reg || r.region === reg));
    document.getElementById("mx-count").textContent = `${MX.n_conflicts} conflict(s); showing ${rows.length}`;
    t.querySelector("thead").innerHTML = `<tr><th>Region</th><th>Feature</th>${MX.lists.map(l => `<th>${esc(l)}</th>`).join("")}</tr>`;
    t.querySelector("tbody").innerHTML = rows.map(r => `<tr class="${r.conflict ? "" : "muted"}"><td>${r.region}</td><td>${esc(r.feature)}</td>${r.cells.map(c => `<td class="${c ? "" : "flag"}">${c || "absent"}</td>`).join("")}</tr>`).join("") ||
      '<tr><td colspan="9" class="muted">No conflicts.</td></tr>';
  }

  // ------------------------------------------------------------ upload ---
  function showPreview(content, missing) {
    preview = content;
    document.getElementById("preview").classList.remove("hidden");
    document.getElementById("pv-nets").innerHTML = netsHTML(content, missing, false);
  }

  async function parseCSV() {
    const fd = new FormData();
    const a = document.getElementById("f-nn1").files[0], b = document.getElementById("f-nn2").files[0];
    if (a) fd.append("nn1", a); if (b) fd.append("nn2", b);
    fd.append("region", document.getElementById("f-region").value);
    try { const r = await api("/api/catalogue/parse_csv", {form: fd}); showPreview(r.content, r.missing_in_data); }
    catch (e) { alert(e.message); }
  }

  async function parsePy() {
    const f = document.getElementById("f-py").files[0];
    if (!f) return alert("Choose a .py file first.");
    const fd = new FormData(); fd.append("file", f);
    try { pyFound = (await api("/api/catalogue/discover_py", {form: fd})).found; }
    catch (e) { return alert(e.message); }
    document.querySelector("#pymap tbody").innerHTML = pyFound.map((x, i) => `<tr><td><code>${esc(x.path)}</code></td><td class="num">${x.items.length}</td>
      <td><select data-map="${i}"><option value="">ignore</option>${SLOTS.map(([r, n]) => `<option value="${r}|${n}">${r} ${n}</option>`).join("")}</select></td>
      <td class="small muted">${esc(x.items.slice(0, 4).join(", "))}${x.items.length > 4 ? ", …" : ""}</td></tr>`).join("");
    document.getElementById("py-apply").classList.remove("hidden");
  }

  async function applyPy() {
    const c = {barrel: {NN1: [], NN2: []}, endcap: {NN1: [], NN2: []}};
    document.querySelectorAll("#pymap select").forEach(s => {
      if (!s.value) return;
      const [r, n] = s.value.split("|");
      for (const f of pyFound[+s.dataset.map].items) if (!c[r][n].includes(f)) c[r][n].push(f);
    });
    const v = await api("/api/catalogue/validate", {json: {content: c}});
    showPreview(c, v.missing_in_data);
  }

  async function commitPreview() {
    const mode = document.getElementById("pv-mode").value;
    const name = mode === "new" ? document.getElementById("pv-name").value : document.getElementById("pv-target").value;
    const note = document.getElementById("pv-note").value;
    if (!name.trim()) return alert("Give the list a name.");
    if (!note.trim()) return alert("A note is required: what this list is and where it came from.");
    const body = {name, note, content: preview, create: mode === "new"};
    if (mode === "version") body.base = lists.find(l => l.slug === name)?.head;
    try {
      const r = await api("/api/catalogue/commit", {json: body});
      if (!r.changed) alert("Identical to the current head: no new version written.");
      document.getElementById("preview").classList.add("hidden");
      await loadLists(); openList(r.slug);
    } catch (e) { alert(e.message); }
  }

  // ------------------------------------------------------------ detail ---
  function applyLocal(content) {
    const c = JSON.parse(JSON.stringify(content));
    for (const o of ops) {
      const L = c[o.region];
      if (o.op === "add") { if (!L[o.net].includes(o.feature)) L[o.net].push(o.feature); }
      if (o.op === "remove") L[o.net] = L[o.net].filter(x => x !== o.feature);
      if (o.op === "move") { L[o.net] = L[o.net].filter(x => x !== o.feature); if (!L[o.to_net].includes(o.feature)) L[o.to_net].push(o.feature); }
    }
    return c;
  }

  function renderDetail() {
    const editable = cur.version.version === cur.head;
    document.getElementById("d-nets").innerHTML = netsHTML(applyLocal(cur.version.content), cur.missing_in_data, editable);
    document.getElementById("d-editbar").classList.toggle("hidden", !editable);
    document.getElementById("d-pending").textContent = ops.length ? `${ops.length} pending change(s): ` + ops.map(o => `${o.op} ${o.feature} (${o.region} ${o.net}${o.to_net ? " → " + o.to_net : ""})`).join("; ") : (editable ? "No pending changes." : "Viewing an old version: open the head to edit.");
    document.getElementById("d-save").disabled = !ops.length; document.getElementById("d-discard").disabled = !ops.length;
  }

  async function openList(slug, v) {
    ops = [];
    cur = await api(`/api/catalogue/${encodeURIComponent(slug)}${v ? "?v=" + v : ""}`);
    const panel = document.getElementById("detail"); panel.classList.remove("hidden");
    document.getElementById("d-title").textContent = `List: ${cur.slug}`;
    document.getElementById("d-ver").innerHTML = cur.history.map(h => `<option value="${h.version}" ${h.version === cur.version.version ? "selected" : ""}>${h.version}${h.version === cur.head ? " (head)" : ""}, ${esc(h.created)}</option>`).join("");
    document.getElementById("d-meta").textContent = `Version ${cur.version.version}, parent ${cur.version.parent || "none"}, by ${cur.version.author || "—"}. Note: ${cur.version.note}`;
    document.getElementById("d-export").href = `/api/catalogue/${encodeURIComponent(cur.slug)}/${cur.version.version}/export`;
    document.querySelector("#d-hist tbody").innerHTML = cur.history.map(h => `<tr><td>${h.version}</td><td>${h.parent || "—"}</td><td>${esc(h.created)}</td><td>${esc(h.author || "—")}</td><td>${esc(h.note)}</td></tr>`).join("");
    renderDetail();
    panel.scrollIntoView({behavior: "smooth", block: "start"});
  }

  async function saveEdits() {
    const note = document.getElementById("d-note").value;
    if (!note.trim()) return alert("A note is required.");
    try {
      await api(`/api/catalogue/${encodeURIComponent(cur.slug)}/edit`, {json: {base: cur.version.version, ops, note}});
      document.getElementById("d-note").value = "";
      await loadLists(); openList(cur.slug);
    } catch (e) {
      if (e.status === 409) { alert(e.message + "\nThe head has moved. Re-opening the new head; your pending changes were not saved."); openList(cur.slug); }
      else alert(e.message);
    }
  }

  async function compare() {
    const a = document.getElementById("cmp-a").value, b = document.getElementById("cmp-b").value;
    if (!a || !b) return;
    const d = (await api(`/api/catalogue_diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)).diff;
    document.getElementById("cmp-out").innerHTML = Object.entries(d).map(([r, x]) => `<h2>${r}</h2><table><tbody>
      <tr><th>Added</th><td>${esc(x.added.join(", ") || "—")}</td></tr>
      <tr><th>Removed</th><td>${esc(x.removed.join(", ") || "—")}</td></tr>
      <tr><th>Moved</th><td>${esc(x.moved.join(", ") || "—")}</td></tr></tbody></table>`).join("");
  }

  document.addEventListener("DOMContentLoaded", async () => {
    document.querySelectorAll(".tabs button[data-fmt]").forEach(b => b.addEventListener("click", () => {
      document.querySelectorAll(".tabs button[data-fmt]").forEach(x => x.setAttribute("aria-pressed", x === b));
      document.getElementById("up-csv").classList.toggle("hidden", b.dataset.fmt !== "csv");
      document.getElementById("up-py").classList.toggle("hidden", b.dataset.fmt !== "py");
    }));
    document.getElementById("parse-csv").addEventListener("click", parseCSV);
    document.getElementById("parse-py").addEventListener("click", parsePy);
    document.getElementById("py-apply").addEventListener("click", applyPy);
    document.getElementById("pv-commit").addEventListener("click", commitPreview);
    document.getElementById("pv-mode").addEventListener("change", e => {
      document.getElementById("pv-name-l").classList.toggle("hidden", e.target.value !== "new");
      document.getElementById("pv-target-l").classList.toggle("hidden", e.target.value === "new");
    });
    document.getElementById("lists").addEventListener("click", e => { const b = e.target.closest("[data-open]"); if (b) openList(b.dataset.open); });
    document.getElementById("d-ver").addEventListener("change", e => openList(cur.slug, e.target.value));
    document.getElementById("d-nets").addEventListener("click", e => {
      const mv = e.target.closest("[data-mv]"), rm = e.target.closest("[data-rm]");
      if (mv) ops.push({op: "move", region: mv.dataset.r, net: mv.dataset.n, feature: mv.dataset.mv, to_net: mv.dataset.n === "NN1" ? "NN2" : "NN1"});
      if (rm) ops.push({op: "remove", region: rm.dataset.r, net: rm.dataset.n, feature: rm.dataset.rm});
      if (mv || rm) renderDetail();
    });
    document.getElementById("d-add-btn").addEventListener("click", () => {
      const f = document.getElementById("d-add").value.trim(); if (!f) return;
      const [r, n] = document.getElementById("d-add-to").value.split(" ");
      ops.push({op: "add", region: r, net: n, feature: f}); document.getElementById("d-add").value = ""; renderDetail();
    });
    document.getElementById("d-save").addEventListener("click", saveEdits);
    document.getElementById("d-discard").addEventListener("click", () => { ops = []; renderDetail(); });
    document.getElementById("d-use").addEventListener("click", async () => {
      await api("/api/session/active_list", {json: {slug: cur.slug, version: cur.version.version}});
      await PFD.refreshState(); loadLists();
    });
    document.getElementById("cmp-go").addEventListener("click", compare);
    document.getElementById("mx-only").addEventListener("change", renderMatrix);
    document.getElementById("mx-region").addEventListener("change", renderMatrix);
    await PFD.refreshState();
    loadLists();
  });
})();
