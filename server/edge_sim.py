"""Local stand-in for the Cloudflare edge, so the local test server behaves like
the hosted site (parity mode). It reproduces what the app can actually see of
Cloudflare:

  * CF-Connecting-IP / CF-Ray / X-Forwarded-Proto: https headers on every request
  * 100 s origin timeout  -> 524 page
  * 100 MB request cap    -> 413 page
  * origin down           -> 502 page

What it cannot reproduce: TLS (Cloudflare terminates it; locally this is plain
http on localhost) and Cloudflare's own bot filtering.
"""
import http.client
import os
import secrets
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
       "trailer", "transfer-encoding", "upgrade"}


def _page(code, title, body):
    return (f"<!doctype html><html><head><title>{code} {title} (edge_sim)</title></head><body>"
            f"<h1>Error {code}</h1><p>{title}</p><p>{body}</p><p>edge_sim, standing in for "
            f"Cloudflare</p></body></html>").encode()


def make_handler(upstream_host, upstream_port, timeout_s, max_body):
    class Edge(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            pass

        def _send(self, code, title, body):
            data = _page(code, title, body)
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Server", "cloudflare (edge_sim)")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)
            self.close_connection = True

        def _proxy(self):
            t0 = time.time()
            n = int(self.headers.get("Content-Length") or 0)
            if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                return self._send(411, "Length required", "chunked uploads are not proxied")
            if n > max_body:
                return self._send(413, "Request entity too large",
                                  f"body {n / 1e6:.1f} MB exceeds the {max_body / 1e6:.0f} MB edge limit")
            body = self.rfile.read(n) if n else None
            ray = secrets.token_hex(8) + "-SIM"
            hdrs = {k: v for k, v in self.headers.items() if k.lower() not in HOP}
            ip = self.client_address[0]
            hdrs.update({"CF-Connecting-IP": ip, "CF-Ray": ray, "X-Forwarded-For": ip,
                         "X-Forwarded-Proto": "https", "CF-Visitor": '{"scheme":"https"}'})
            conn = http.client.HTTPConnection(upstream_host, upstream_port, timeout=timeout_s)
            try:
                conn.request(self.command, self.path, body=body, headers=hdrs)
                resp = conn.getresponse()
                data = resp.read()
            except (socket.timeout, TimeoutError):
                return self._send(524, "A timeout occurred",
                                  f"the origin did not answer within {timeout_s:.0f} s")
            except (ConnectionRefusedError, OSError) as e:
                return self._send(502, "Bad gateway", f"origin unreachable ({e})")
            finally:
                conn.close()
            self.send_response(resp.status, resp.reason)
            for k, v in resp.getheaders():
                if k.lower() not in HOP and k.lower() != "content-length":
                    self.send_header(k, v)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("CF-Ray", ray)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
            print(f"[edge ] {resp.status} {self.command} {self.path[:70]}  {1000 * (time.time() - t0):.0f} ms",
                  flush=True)

        do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = do_PATCH = _proxy

    return Edge


def serve(listen_port, upstream_port, host="127.0.0.1", timeout_s=None, max_body=None):
    timeout_s = timeout_s or float(os.environ.get("PFD_EDGE_TIMEOUT", "100"))
    max_body = max_body or int(os.environ.get("PFD_EDGE_MAX_BODY", str(100 * 1000 * 1000)))
    srv = ThreadingHTTPServer((host, listen_port),
                              make_handler("127.0.0.1", upstream_port, timeout_s, max_body))
    srv.daemon_threads = True
    return srv


if __name__ == "__main__":
    serve(int(sys.argv[1]), int(sys.argv[2])).serve_forever()
