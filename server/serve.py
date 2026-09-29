"""Run the site.

    python -m server.serve --mode dev       Flask dev server, auto-reload, plain cookie
    python -m server.serve --mode parity    waitress + edge_sim: behaves like the hosted site
    python -m server.serve --mode live      waitress on 127.0.0.1:5710 for cloudflared

--home / --office / --locations pick the data locations file (else PFD_LOCATIONS).
Every mode binds 127.0.0.1, except live mode inside the container image, where
--host (or PFD_BIND_HOST) is 0.0.0.0 so the cloudflared sidecar can reach it
over the private compose network. Nothing is published to the host.
"""
import argparse
import os
import socket
import sys
import threading
import webbrowser

LIVE_PORT = 5710


def free_port(start, span=60):
    for p in range(start, start + span):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise SystemExit(f"no free port in {start}..{start + span - 1}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["dev", "parity", "live"], default="parity")
    ap.add_argument("--home", action="store_true")
    ap.add_argument("--office", action="store_true")
    ap.add_argument("--locations")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--host", default=os.environ.get("PFD_BIND_HOST", "127.0.0.1"),
                    help="bind address; live mode only (the container sets 0.0.0.0)")
    a = ap.parse_args()
    if a.host != "127.0.0.1" and a.mode != "live":
        sys.exit("[serve] --host is for live mode only; dev and parity stay on loopback")

    from engine import loader
    from . import envfile
    envfile.load_into_environ()
    os.environ["PFD_MODE"] = a.mode
    if a.home or a.office or a.locations:
        try:
            os.environ["PFD_LOCATIONS"] = loader.resolve_locations(a.home, a.office, a.locations)
        except loader.MissingInput as e:
            print(f"[serve] WARNING: {e}. The site starts, but no region can run.")

    from .app import ConfigError, create_app
    try:
        app = create_app()
    except ConfigError as e:
        sys.exit(f"[serve] cannot start: {e}")
    cfg = app.extensions["pfd"]["cfg"]

    app_port = LIVE_PORT if a.mode == "live" else free_port(5710)
    edge_port = free_port(8710) if a.mode == "parity" else None
    url = f"http://127.0.0.1:{edge_port or app_port}/"

    print("=" * 72)
    print(f"  ATLAS_PRE_FILTER_DASH  mode={a.mode}")
    print(f"  app      http://{a.host}:{app_port}   " + ("(loopback only)" if a.host == "127.0.0.1"
                                                       else "(container network; not published)"))
    if edge_port:
        print(f"  edge_sim {url}   <- open this one: it behaves like the hosted site")
    print(f"  store    {cfg.store_dir}")
    print(f"  data     {os.environ.get('PFD_LOCATIONS') or '(no locations file set)'}")
    print(f"  cookie   Secure={cfg.secure_cookie}  trust CF-Connecting-IP={cfg.trust_cf}  idle={cfg.idle_hours} h")
    print(f"  workers  {cfg.workers} job slot(s)")
    from engine import transforms
    from engine.provenance import code_commit
    ts = transforms.source()
    print(f"  S9       {ts['kind']}" + (f"  {ts['path']}" if ts['path'] else "  (PFD_LLP_SRC not set)")
          + (f"  ERROR: {ts['error']}" if ts['error'] else ""))
    print(f"  code     {code_commit()}")
    if a.mode != "dev":
        print("  differs from hosted: no TLS here (Cloudflare terminates it live)")
    if cfg.password_weak:
        bar = "!" * 72
        print(bar + "\n  WEAK PASSWORD: under 20 characters and there is no lockout.\n"
              "  Fine on localhost. Change it (python -m server.set_password) before going live.\n" + bar)
        if a.mode == "live":
            print("  (live mode with a weak password: continuing because you started it)")
    print("=" * 72, flush=True)

    if a.mode == "dev":
        if not a.no_browser:
            threading.Timer(1.2, lambda: webbrowser.open(url)).start()
        app.run(host="127.0.0.1", port=app_port, debug=True, use_reloader=True, threaded=True)
        return

    from waitress import serve as wserve
    if edge_port:
        from .edge_sim import serve as edge
        srv = edge(edge_port, app_port)
        threading.Thread(target=srv.serve_forever, daemon=True, name="edge_sim").start()
    if not a.no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    wserve(app, host=a.host, port=app_port, threads=16, ident="pfd",
           channel_timeout=300, max_request_body_size=cfg.max_upload_mb * 1024 * 1024 + 65536)


if __name__ == "__main__":
    main()
