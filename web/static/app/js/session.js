"use strict";
(() => {
  const {api, esc} = PFD;
  async function render() {
    const s = await PFD.refreshState();
    if (!s) return;
    document.getElementById("savestate").innerHTML = s.dirty ? '<span class="flag">Unsaved changes in this session.</span>' :
      (s.last_saved ? `Last saved ${esc(s.last_saved)}.` : "Nothing saved yet.");
    const reg = r => s.regions[r] ? `${s.regions[r].data_hash} (${s.regions[r].data_state.toLowerCase()}${s.regions[r].smoke ? ", smoke" : ""})` : "no result";
    document.getElementById("sess").innerHTML = [
      ["Barrel result", reg("barrel")], ["Endcap result", reg("endcap")],
      ["Active list", s.active_list ? `${s.active_list.slug}@${s.active_list.version}` : "none"],
      ["Loaded from bundle", s.loaded_bundle || "no"], ["Locations file", s.locations || s.locations_error || "—"],
      ["Mode", s.mode]].map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join("");
  }
  async function initName() {
    const w = await api("/api/whoami");
    document.getElementById("who").value = w.who === "unnamed" ? "" : w.who;
    document.getElementById("setwho").addEventListener("click", async () => {
      const r = await api("/api/session/name", {json: {name: document.getElementById("who").value}});
      document.getElementById("whomsg").textContent = `Saved: runs are now signed ${r.who}.`;
      document.getElementById("tb-who").textContent = r.who;
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initName();
    document.getElementById("save").addEventListener("click", () => setTimeout(render, 1500));
    document.getElementById("load").addEventListener("click", async () => {
      const f = document.getElementById("bundle").files[0];
      const out = document.getElementById("loadmsg");
      if (!f) { out.textContent = "Choose a bundle file first."; return; }
      if (PFD.state && PFD.state.dirty && !confirm("Loading replaces this session's unsaved work. Continue?")) return;
      const fd = new FormData(); fd.append("bundle", f);
      try {
        const r = await api("/api/session/load", {form: fd});
        out.innerHTML = `<span class="ok">Loaded</span> bundle from ${esc(r.created)}: ${esc(r.regions.join(", ") || "no results")}.` +
          (r.restored_versions.length ? ` Restored list versions: ${esc(r.restored_versions.join(", "))}.` : "");
      } catch (e) { out.innerHTML = `<span class="flag">${esc(e.message)}</span>`; }
      render();
    });
    render();
  });
})();
