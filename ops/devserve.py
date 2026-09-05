#!/usr/bin/env python3
"""Local preview server. Same as http.server but with caching off, so a CSS
edit is visible on the next reload instead of two reloads later."""
import functools, http.server, os, sys

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    http.server.ThreadingHTTPServer(
        ("127.0.0.1", port),
        functools.partial(H, directory=root)).serve_forever()
