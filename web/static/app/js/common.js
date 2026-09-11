/* common.js -- shared by every page. */
"use strict";
const PFD = (() => {
  let idleMs = 8 * 3600e3, expiresAt = null, dirty = false, lastState = null;

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  }
  function pct(x, d = 2) { return x == null ? "—" : (100 * x).toFixed(d) + "%"; }
  function num(x, d = 4) {
    if (x == null) return "—";
    const a = Math.abs(x);
    if (a !== 0 && (a >= 1e6 || a < 1e-3)) return x.toExponential(3);
    return Number.isInteger(x) ? x.toLocaleString() : x.toFixed(d);
  }

  /* Every fetch goes through here. An HTML answer (error page, proxy page)
     becomes a readable sentence instead of "Unexpected token '<'". */
  async function api(path, opts = {}) {
    const o = {method: opts.method || "GET", headers: {}, credentials: "same-origin"};
    if (opts.poll) o.headers["X-PFD-Poll"] = "1";
    if (opts.json !== undefined) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(opts.json); o.method = opts.method || "POST"; }
    if (opts.form) { o.body = opts.form; o.method = "POST"; }
    let r;
    try { r = await fetch(path, o); }
    catch (e) { throw new Error("server unreachable (" + e.message + ")"); }
    if (r.status === 401) { location.href = "/login?why=timeout&next=" + encodeURIComponent(location.pathname + location.search); throw new Error("signed out"); }
    if (!opts.poll) expiresAt = Date.now() + idleMs;
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      const t = await r.text();
      const title = (t.match(/<title>([^<]*)<\/title>/i) || [])[1];
      throw new Error(`HTTP ${r.status} from ${path}: ${title || t.slice(0, 120).replace(/\s+/g, " ")}`);
    }
    const j = await r.json();
    if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; e.body = j; throw e; }
    return j;
  }

  function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

  function regionCell(r) {
    if (!r) return "not run";
    const bits = [r.data_hash.slice(0, 8)];
    if (r.smoke) bits.push("smoke");
    if (r.data_state !== "CURRENT") bits.push(r.data_state);
    return bits.join(" ");
  }

  async function refreshState() {
    try {
      const s = await api("/api/state", {poll: true});
      lastState = s; dirty = !!s.dirty;
      const st = document.getElementById("tb-state");
      if (st) {
        const stale = Object.values(s.regions || {}).some(r => r && r.data_state !== "CURRENT");
        st.textContent = stale ? "stale data" : dirty ? "unsaved" : (s.last_saved ? "saved" : "empty");
        st.className = stale ? "state-stale" : dirty ? "state-unsaved" : "";
      }
      setText("tb-barrel", regionCell(s.regions.barrel));
      setText("tb-endcap", regionCell(s.regions.endcap));
      setText("tb-list", s.active_list ? `${s.active_list.slug}@${s.active_list.version.slice(0, 7)}` : "none");
      const refs = ["barrel", "endcap"].map(k => s.regions[k] && s.regions[k].reference ? `${k[0]}:${s.regions[k].reference.status.toLowerCase()}` : null).filter(Boolean);
      setText("tb-ref", refs.length ? refs.join(" ") : "—");
      return s;
    } catch (e) { console.warn(e); return null; }
  }

  function tick() {
    if (!expiresAt) return;
    const left = Math.max(0, expiresAt - Date.now());
    const h = Math.floor(left / 3600e3), m = Math.floor(left % 3600e3 / 60e3), sec = Math.floor(left % 60e3 / 1e3);
    setText("tb-idle", h ? `${h} h ${m} min` : `${m}:${String(sec).padStart(2, "0")}`);
    const ban = document.getElementById("idle");
    if (ban) {
      ban.classList.toggle("hidden", left > 10 * 60e3);
      setText("idle-left", `${m}:${String(sec).padStart(2, "0")}`);
    }
    if (left <= 0) location.href = "/login?why=timeout";
  }

  async function boot() {
    try {
      const w = await api("/api/whoami");
      idleMs = w.idle_hours * 3600e3; expiresAt = Date.now() + w.expires_in_s * 1000;
      setText("tb-who", w.who);
      setText("tb-rev", `mk4 ${w.code_commit}`);
    } catch (e) { console.warn(e); }
    await refreshState();
    setInterval(tick, 1000); tick();
    const stay = document.getElementById("idle-stay");
    if (stay) stay.addEventListener("click", () => api("/api/ping", {json: {}}));
    // drop the ?login=1 marker once the cookie has proved itself
    if (new URLSearchParams(location.search).get("login") === "1") {
      const u = new URL(location.href); u.searchParams.delete("login"); history.replaceState(null, "", u);
    }
  }

  window.addEventListener("beforeunload", e => {
    const internal = document.activeElement && document.activeElement.closest && document.activeElement.closest("nav.plates, a[href^='/']");
    if (dirty && !internal) { e.preventDefault(); e.returnValue = ""; }
  });

  document.addEventListener("submit", e => {
    if (e.target.action && e.target.action.endsWith("/logout") && dirty &&
        !confirm("This session has unsaved work. Signing out discards it. Sign out anyway?")) e.preventDefault();
  });

  function progressBar(el, frac, msg) {
    el.innerHTML = `<div class="prog"><i></i></div><div class="progmsg"></div>`;
    el.querySelector("i").style.width = (100 * frac).toFixed(1) + "%";
    el.querySelector(".progmsg").textContent = msg || "";
  }

  document.addEventListener("DOMContentLoaded", boot);
  return {api, esc, pct, num, refreshState, progressBar, get state() { return lastState; }};
})();
