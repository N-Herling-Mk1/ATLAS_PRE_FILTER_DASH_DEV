"""Scope §2: the lock. No real data needed -- these exercise the gate itself."""
import os
import re
import time

from conftest import make_app

PUBLIC = {"/login", "/health", "/favicon.ico"}


def _concrete(rule):
    url = rule.rule
    for arg in rule.arguments:
        url = re.sub(r"<(?:[^:<>]+:)?%s>" % arg, "x", url)
    return url


def test_every_route_is_locked_except_public(app_pw):
    app, _ = app_pw
    c = app.test_client()
    checked = 0
    for rule in app.url_map.iter_rules():
        url = _concrete(rule)
        if rule.endpoint == "static":
            continue
        for m in sorted(rule.methods - {"HEAD", "OPTIONS"}):
            r = c.open(url, method=m)
            if url in PUBLIC:
                assert r.status_code in (200, 302, 400, 401), (m, url, r.status_code)
                continue
            checked += 1
            if url.startswith("/api/"):
                assert r.status_code == 401, (m, url, r.status_code)
                assert r.get_json()["error"] == "login required"
            else:
                assert r.status_code == 302 and "/login" in r.headers["Location"], (m, url, r.status_code)
    assert checked > 25


def test_static_split(app_pw):
    app, _ = app_pw
    c = app.test_client()
    assert c.get("/static/public/css/pfd.css").status_code == 200
    assert c.get("/static/app/js/common.js").status_code == 302


def test_health_leaks_nothing(app_pw):
    app, _ = app_pw
    r = app.test_client().get("/health")
    assert r.status_code == 200 and r.data == b"ok" and r.mimetype == "text/plain"


def test_wrong_password_refused_and_logged(app_pw, tmp_path):
    app, _ = app_pw
    r = app.test_client().post("/login", data={"password": "not-it", "who": "tester"})
    assert r.status_code == 401
    log = open(os.path.join(app.extensions["pfd"]["cfg"].store_dir, "logs", "events.log")).read()
    assert "FAILED" in log


def _login(c, pw, nxt="/", who="tester"):
    return c.post("/login", data={"password": pw, "next": nxt, "who": who})


def test_login_cookie_flags_dev(app_pw):
    app, pw = app_pw
    c = app.test_client()
    r = _login(c, pw)
    assert r.status_code == 302
    sc = r.headers["Set-Cookie"]
    assert "HttpOnly" in sc and "SameSite=Lax" in sc and "Secure" not in sc
    assert c.get("/api/whoami").status_code == 200


def test_secure_cookie_in_parity_and_live(tmp_path):
    for mode in ("parity", "live"):
        app, pw = make_app(tmp_path / mode, mode=mode)
        r = _login(app.test_client(), pw)
        assert "Secure" in r.headers["Set-Cookie"], mode


def test_open_redirect_guard(app_pw):
    app, pw = app_pw
    r = _login(app.test_client(), pw, nxt="//evil.example/x")
    assert r.headers["Location"].startswith("/?login=1")


def test_rotating_secret_invalidates_cookies(tmp_path):
    store = tmp_path / "s"
    app1, pw = make_app(store, password="pw-for-test-only-000000")
    c = app1.test_client()
    _login(c, pw)
    assert c.get("/api/whoami").status_code == 200
    app2, _ = make_app(store, password="pw-for-test-only-000000")      # new SECRET_KEY
    c2 = app2.test_client()
    for ck in c._cookies.values():
        c2.set_cookie(ck.key, ck.value, domain=ck.domain)
    assert c2.get("/api/whoami").status_code == 401


def test_idle_timeout_and_poll_header(app_pw):
    app, pw = app_pw
    c = app.test_client()
    _login(c, pw)
    with c.session_transaction() as s:
        t0 = s["t"]
        sid = s["sid"]
    time.sleep(0.05)
    c.get("/api/whoami", headers={"X-PFD-Poll": "1"})
    with c.session_transaction() as s:
        assert s["t"] == t0, "a poll must not count as activity"
    c.get("/api/whoami")
    with c.session_transaction() as s:
        assert s["t"] > t0
        s["t"] = time.time() - app.extensions["pfd"]["cfg"].idle_hours * 3600 - 5
    ws = app.extensions["pfd"]["ws"]
    ws.touch(sid)
    r = c.get("/api/whoami")
    assert r.status_code == 401 and r.get_json()["reason"] == "timeout"
    assert not os.path.isdir(os.path.join(ws.root, sid)), "scratch must be discarded at timeout"


def test_security_headers(app_pw):
    app, pw = app_pw
    c = app.test_client()
    _login(c, pw)
    r = c.get("/board")
    assert r.status_code == 200
    assert "default-src 'self'" in r.headers["Content-Security-Policy"]
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Cache-Control"] == "no-store"


def test_pages_render_logged_in(app_pw):
    app, pw = app_pw
    c = app.test_client()
    _login(c, pw)
    for p in ("/", "/board", "/feature", "/catalogue", "/session"):
        r = c.get(p)
        assert r.status_code == 200, p
        if p == "/":
            # mk24 took the title block off the hub on purpose; the hub's own
            # landmarks are what prove it rendered
            assert b'id="hub"' in r.data and b'id="gimbal"' in r.data
            assert b'class="titleblock"' not in r.data
        else:
            assert b'class="titleblock"' in r.data, p


def test_jobs_are_per_session(app_pw):
    app, pw = app_pw
    a, b = app.test_client(), app.test_client()
    _login(a, pw)
    _login(b, pw)
    with a.session_transaction() as s:
        sid_a = s["sid"]
    job = app.extensions["pfd"]["jobs"].submit(sid_a, "noop", "noop", lambda p: None)
    for _ in range(50):
        if a.get(f"/api/jobs/{job.id}").get_json()["status"] == "done":
            break
        time.sleep(0.02)
    assert a.get(f"/api/jobs/{job.id}").status_code == 200
    assert b.get(f"/api/jobs/{job.id}").status_code == 404


def test_login_is_password_only(app_pw):
    app, pw = app_pw
    c = app.test_client()
    assert c.post("/login", data={"password": pw}).status_code == 302
    assert c.get("/api/whoami").get_json()["who"] == "unnamed"


def test_identity_is_stamped(app_pw):
    app, pw = app_pw
    c = app.test_client()
    _login(c, pw)
    assert c.post("/api/session/name", json={"name": " Steve\x07 "}).get_json()["who"] == "Steve"
    w = c.get("/api/whoami").get_json()
    assert w["who"] == "Steve" and "code_commit" in w and w["engine"].startswith("pfd-engine")


def test_crossblock_needs_an_active_list(app_pw):
    app, pw = app_pw
    c = app.test_client()
    _login(c, pw)
    r = c.post("/api/crossblock/run", json={"region": "endcap"})
    assert r.status_code == 400 and "active list" in r.get_json()["error"]


def test_broken_llp_source_is_loud(tmp_path, monkeypatch):
    from engine import transforms
    monkeypatch.setenv("PFD_LLP_SRC", str(tmp_path / "nowhere"))
    transforms._reset_for_tests()
    try:
        src = transforms.source()
        assert src["error"] and "llp" in src["error"]
        import pytest
        with pytest.raises(transforms.TransformSourceError):
            transforms.transform(__import__("numpy").arange(3.0), "minmax")
    finally:
        monkeypatch.delenv("PFD_LLP_SRC")
        transforms._reset_for_tests()


def test_fetch_login_returns_json(app_pw):
    app, pw = app_pw
    c = app.test_client()
    r = c.post("/login", data={"password": "wrong"}, headers={"X-PFD-Login": "1"})
    assert r.status_code == 401 and r.get_json() == {"ok": False}
    assert c.get("/api/whoami").status_code == 401
    r = c.post("/login", data={"password": pw, "next": "/board"}, headers={"X-PFD-Login": "1"})
    assert r.status_code == 200 and r.get_json()["ok"] is True
    assert r.get_json()["next"].startswith("/board")
    assert c.get("/api/whoami").status_code == 200


def test_hub_side_panel_and_root2csv(app_pw):
    """mk47: every tile has an outline slot in the side panel, EDA's outline
    names both layers, and the root2csv sheet links to the repo."""
    from server.pages import EXTERNAL, TILES
    app, pw = app_pw
    c = app.test_client()
    _login(c, pw)
    html = c.get("/").get_data(as_text=True)
    assert 'id="side"' in html
    for tid, *_ in TILES:
        assert f'data-outline="{tid}"' in html, tid
    assert "Hygiene" in html and "Exploration" in html
    assert 'data-sheet="root2csv"' in html
    r2c = EXTERNAL["root2csv"]
    assert r2c["site"] == "https://n-herling-mk1.github.io/root_to_csv/"
    assert r2c["repo"].startswith("https://github.com/N-Herling-Mk1/root_to_csv")
    assert f'href="{r2c["site"]}"' in html and f'href="{r2c["repo"]}"' in html
    assert 'rel="noopener noreferrer"' in html
