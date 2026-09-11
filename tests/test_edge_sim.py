"""edge_sim reproduces what the app can see of Cloudflare (headers, 100 s cut,
100 MB cap, origin down). The upstream here is a stub HTTP server: it serves
no data, it only sleeps or echoes headers."""
import http.client
import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from server.edge_sim import serve


def _free():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Up(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/slow":
            time.sleep(2)
        body = json.dumps({k: v for k, v in self.headers.items()}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _start(srv):
    threading.Thread(target=srv.serve_forever, daemon=True).start()


def _get(port, path, method="GET", headers=None, body=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    c.request(method, path, body=body, headers=headers or {})
    r = c.getresponse()
    return r.status, r.read(), dict(r.getheaders())


def test_edge_behaviour():
    up_port, edge_port = _free(), _free()
    up = ThreadingHTTPServer(("127.0.0.1", up_port), Up)
    _start(up)
    edge = serve(edge_port, up_port, timeout_s=1.0, max_body=1000)
    _start(edge)
    st, body, hd = _get(edge_port, "/echo")
    seen = json.loads(body)
    assert st == 200 and seen["CF-Connecting-IP"] == "127.0.0.1"
    assert seen["X-Forwarded-Proto"] == "https" and "CF-Ray" in hd
    assert _get(edge_port, "/slow")[0] == 524
    assert _get(edge_port, "/x", "POST", {"Content-Length": "5000"}, b"")[0] == 413
    up.shutdown()
    up.server_close()
    assert _get(edge_port, "/echo")[0] == 502
    edge.shutdown()
