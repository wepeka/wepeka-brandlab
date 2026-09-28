#!/usr/bin/env python3
# Local dev server for Wepeka Brandlab — identical to `python3 -m http.server`
# except every response gets Cache-Control: no-store. Plain http.server sends
# no cache header at all, and this browser was still reusing old cached
# copies of main.js and its dependents across reloads (confirmed directly:
# the server had the current file, but the browser kept serving a stale one
# from disk cache) — which silently hides every code change until a full
# cache clear. No-store removes that whole class of "why isn't my edit
# showing" confusion for good.
#
# Usage: python3 serve.py  (always serves this same folder, on port 8743)
import http.server
import functools
import urllib.error
import urllib.request

PORT = 8743

# The /api functions only exist on Vercel, so locally every AI button used
# to hit a 501 page and show "AI sent back a response the app couldn't
# read". These paths are forwarded to production instead (same Firebase
# project, so the signed-in user's token works there). Payments are NOT on
# this list on purpose — local testing must never create a real Midtrans
# transaction.
API_ORIGIN = "https://planner.wepeka.com"
PROXIED_API = ("/api/ai", "/api/guide-videos")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def _is_proxied(self):
        return self.path.split("?")[0] in PROXIED_API

    def _proxy(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() in ("content-type", "authorization", "accept")}
        req = urllib.request.Request(API_ORIGIN + self.path, data=body, headers=headers, method=self.command)
        try:
            upstream = urllib.request.urlopen(req, timeout=150)
        except urllib.error.HTTPError as err:
            upstream = err
        except Exception:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"network"}')
            return
        with upstream:
            self.send_response(upstream.status)
            for k in ("Content-Type",):
                if upstream.headers.get(k):
                    self.send_header(k, upstream.headers[k])
            self.end_headers()
            # Chunk by chunk so the chat's SSE stream still arrives live.
            while True:
                chunk = upstream.read1(4096) if hasattr(upstream, "read1") else upstream.read(4096)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()

    def do_GET(self):
        if self._is_proxied():
            return self._proxy()
        return super().do_GET()

    def do_POST(self):
        if self._is_proxied():
            return self._proxy()
        self.send_error(501)


Handler = functools.partial(NoCacheHandler, directory=".")

class Server(http.server.ThreadingHTTPServer):
    # The app loads ~100 ES modules at once; the stdlib default listen
    # backlog of 5 made the kernel reset some of those connections, which
    # showed up as random "Failed to fetch dynamically imported module".
    request_queue_size = 256
    daemon_threads = True


with Server(("", PORT), Handler) as httpd:
    print(f"Serving Wepeka Brandlab at http://localhost:{PORT} (caching disabled)")
    httpd.serve_forever()
