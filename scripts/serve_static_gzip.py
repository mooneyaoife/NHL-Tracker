#!/usr/bin/env python3
"""Serve the static artifact with production-like text compression for audits."""

from __future__ import annotations

import argparse
import gzip
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class CompressedHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = Path(self.translate_path(self.path))
        if path.is_dir():
            path /= "index.html"
        if not path.is_file():
            self.send_error(404, "File not found")
            return None
        body = path.read_bytes()
        content_type = self.guess_type(str(path))
        compressible = content_type.startswith("text/") or content_type.split(";", 1)[0] in {
            "application/javascript", "application/json", "application/manifest+json", "image/svg+xml"}
        encoded = compressible and "gzip" in self.headers.get("Accept-Encoding", "").lower()
        if encoded:
            body = gzip.compress(body, compresslevel=6, mtime=0)
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Vary", "Accept-Encoding")
        if encoded:
            self.send_header("Content-Encoding", "gzip")
        self.end_headers()
        from io import BytesIO
        return BytesIO(body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--directory", type=Path, default=Path("site"))
    args = parser.parse_args()
    handler = partial(CompressedHandler, directory=str(args.directory.resolve()))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"Serving compressed static files on http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
