"""App factory. The lock (scope §2) lives here so it wraps every route.

Public (no login): /login, /health, /favicon.ico, /static/public/*.
Everything else -- every page and every /api route -- requires a session.
"""
import os
import secrets
import threading
import time
import traceback
from datetime import timedelta
from urllib.parse import urlparse

from flask import (Flask, g, jsonify, redirect, render_template, request, send_from_directory,
                   session, url_for)
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash

from catalogue.store import Catalogue

from . import notifier
from .jobs import JobQueue
from .settings import Settings
from .workspace import Workspaces

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_PATHS = {"/login", "/health", "/favicon.ico"}
PUBLIC_PREFIXES = ("/static/public/",)
POLL_HEADER = "X-PFD-Poll"
UNNAMED = "unnamed"             # attribution is optional; set it on the Session page          # automated polls do not count as activity


class ConfigError(Exception):
    pass


def client_ip(cfg):
    if cfg.trust_cf:
        return request.headers.get("CF-Connecting-IP") or request.remote_addr
    return request.remote_addr


def clean_identity(s):
    """Attribution tag, not authentication: printable, trimmed, 40 chars max."""
    s = "".join(ch for ch in (s or "") if ch.isprintable()).strip()
    return s[:40]


def _safe_next(n):
    if not n or not n.startswith("/") or n.startswith("//"):
        return "/"
    u = urlparse(n)
    return u.path + (("?" + u.query) if u.query else "")


def create_app(**overrides):
    cfg = Settings(**overrides)
    probs = cfg.problems()
    if probs:
        raise ConfigError("; ".join(probs))
    os.makedirs(cfg.store_dir, exist_ok=True)
    notifier.init(cfg.store_dir)

    app = Flask(__name__, root_path=ROOT,
                template_folder=os.path.join(ROOT, "web", "templates"),
                static_folder=os.path.join(ROOT, "web", "static"), static_url_path="/static")
    app.secret_key = cfg.secret_key
    app.config.update(
        SESSION_COOKIE_NAME="pfd_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=cfg.secure_cookie,
        PERMANENT_SESSION_LIFETIME=timedelta(hours=cfg.idle_hours),
        SESSION_REFRESH_EACH_REQUEST=True,
        MAX_CONTENT_LENGTH=cfg.max_upload_mb * 1024 * 1024,
        TEMPLATES_AUTO_RELOAD=cfg.mode == "dev",
    )
    ws = Workspaces(cfg.store_dir, cfg.idle_hours)
    app.extensions["pfd"] = {
        "cfg": cfg, "ws": ws,
        "jobs": JobQueue(cfg.workers, on_error=lambda job: notifier.notify(
            "job", f"{job.label} failed for {job.who}: {job.error}", alert=True, key=f"job:{job.kind}")),
        "catalogue": Catalogue(cfg.store_dir), "started": time.time(),
    }
    idle_s = cfg.idle_hours * 3600

    # ---------------------------------------------------------------- lock --
    @app.before_request
    def lock():
        p = request.path
        if p in PUBLIC_PATHS or p.startswith(PUBLIC_PREFIXES):
            return None
        why = "login"
        if session.get("auth"):
            last = float(session.get("t", 0))
            if time.time() - last <= idle_s and session.get("sid"):
                g.sid = session["sid"]
                g.who = session.get("who") or UNNAMED
                if not request.headers.get(POLL_HEADER):
                    session["t"] = time.time()
                    ws.touch(g.sid)
                return None
            ws.discard(session.get("sid", "none"))
            session.clear()
            why = "timeout"
        elif request.args.get("login") == "1":
            why = "cookie"         # login succeeded but the browser did not send the cookie back
        if p.startswith("/api/"):
            return jsonify(error="login required", reason=why), 401
        nxt = "/" if why == "cookie" else request.full_path.rstrip("?")
        return redirect(url_for("login", why=why, next=nxt))

    @app.after_request
    def headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
            "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'")
        if not request.path.startswith(PUBLIC_PREFIXES):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.route("/login", methods=["GET", "POST"])
    def login():
        msg = {"timeout": "Signed out after inactivity.",
               "logout": "Signed out.",
               "cookie": ("The browser did not keep the login cookie. Over plain http only "
                          "localhost accepts Secure cookies: open the site as http://127.0.0.1:... (or localhost), "
                          "or run in dev mode.")}.get(request.args.get("why", ""), "")
        if request.method == "POST":
            pw = request.form.get("password", "")
            nxt = _safe_next(request.form.get("next"))
            # the sign-in page submits by fetch (X-PFD-Login: 1) so it can play the
            # trigger animation before navigating; a plain form POST still works
            as_json = request.headers.get("X-PFD-Login") == "1"
            if pw and check_password_hash(cfg.password_hash, pw):
                session.clear()
                session.permanent = True
                session.update(auth=True, sid=secrets.token_hex(12), t=time.time(), who=None)
                ws.touch(session["sid"])
                notifier.notify("login", f"ok from {client_ip(cfg)}")
                dest = nxt + ("&" if "?" in nxt else "?") + "login=1"
                return jsonify(ok=True, next=dest) if as_json else redirect(dest)
            notifier.notify("login", f"FAILED from {client_ip(cfg)}", alert=True, key="login_failed")
            if as_json:
                return jsonify(ok=False), 401
            return render_template("login.html", msg="Wrong password.", nxt=nxt,
                                   mode=cfg.mode), 401
        return render_template("login.html", msg=msg, nxt=_safe_next(request.args.get("next")),
                               mode=cfg.mode)

    @app.route("/logout", methods=["POST"])
    def logout():
        ws.discard(session.get("sid", "none"))
        session.clear()
        return redirect(url_for("login", why="logout"))

    @app.route("/health")
    def health():
        return app.response_class("ok", mimetype="text/plain")

    @app.route("/favicon.ico")
    def favicon():
        return send_from_directory(os.path.join(ROOT, "web", "static", "public", "assets", "images"),
                                   "favicon.svg", mimetype="image/svg+xml")

    # ------------------------------------------------------------- errors --
    @app.errorhandler(Exception)
    def on_error(e):
        if isinstance(e, HTTPException):
            code, text = e.code, e.description
            if code == 413:
                text = f"upload is larger than the {cfg.max_upload_mb} MB limit"
        else:
            traceback.print_exc()
            code, text = 500, f"{type(e).__name__}: {e}"
        if request.path.startswith("/api/"):
            return jsonify(error=text, code=code), code
        return render_template("error.html", code=code, text=text), code

    from .api import bp as api_bp
    from .pages import bp as pages_bp
    app.register_blueprint(api_bp)
    app.register_blueprint(pages_bp)

    def janitor():
        while True:
            time.sleep(300)
            try:
                ws.sweep()
            except Exception:
                traceback.print_exc()

    threading.Thread(target=janitor, daemon=True, name="pfd-janitor").start()
    return app
