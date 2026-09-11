"""Parity mode end to end: the real app under waitress behind edge_sim, driven
over HTTP the way a browser would be. No data is needed for the lock path."""
import http.client
import re
import socket
import threading
import time
import urllib.parse

from waitress.server import create_server

from conftest import make_app
from server.edge_sim import serve


def _free():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _req(port, method, path, body=None, cookie=None, ctype=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    h = {}
    if cookie:
        h["Cookie"] = cookie
    if ctype:
        h["Content-Type"] = ctype
    c.request(method, path, body=body, headers=h)
    r = c.getresponse()
    return r.status, r.read(), r.getheaders()


def test_parity_login_through_edge(tmp_path):
    app, pw = make_app(tmp_path / "store", mode="parity")
    app_port, edge_port = _free(), _free()
    ws = create_server(app, host="127.0.0.1", port=app_port, threads=4)
    threading.Thread(target=ws.run, daemon=True).start()
    edge = serve(edge_port, app_port)
    threading.Thread(target=edge.serve_forever, daemon=True).start()
    time.sleep(0.3)

    st, _, hd = _req(edge_port, "GET", "/board")
    assert st == 302
    st, body, _ = _req(edge_port, "GET", "/health")
    assert (st, body) == (200, b"ok")

    st, _, hd = _req(edge_port, "POST", "/login", urllib.parse.urlencode({"password": pw, "next": "/board", "who": "tester"}),
                     ctype="application/x-www-form-urlencoded")
    assert st == 302
    sc = [v for k, v in hd if k.lower() == "set-cookie"][0]
    assert "Secure" in sc and "HttpOnly" in sc
    cookie = sc.split(";", 1)[0]
    st, body, _ = _req(edge_port, "GET", "/board", cookie=cookie)
    assert st == 200 and b"titleblock" in body
    st, body, _ = _req(edge_port, "GET", "/api/whoami", cookie=cookie)
    assert st == 200 and b'"mode":"parity"' in body.replace(b" ", b"")

    _req(edge_port, "POST", "/login", urllib.parse.urlencode({"password": "nope", "who": "tester"}),
         ctype="application/x-www-form-urlencoded")
    log = open(tmp_path / "store" / "logs" / "events.log").read()
    assert re.search(r"FAILED from 127\.0\.0\.1", log), "IP must come from CF-Connecting-IP"
    edge.shutdown()
    ws.close()
