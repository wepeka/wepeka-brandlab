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

PORT = 8743


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


Handler = functools.partial(NoCacheHandler, directory=".")

with http.server.ThreadingHTTPServer(("", PORT), Handler) as httpd:
    print(f"Serving Wepeka Brandlab at http://localhost:{PORT} (caching disabled)")
    httpd.serve_forever()
