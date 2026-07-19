#!/usr/bin/env python3
"""Verify the Cloudflare artifact before it is uploaded."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def failures_for(output: Path, production_url: str) -> list[str]:
    production_url = production_url.rstrip("/") + "/"
    failures: list[str] = []
    required = ("index.html", "app.js", "cloudflare-live.js", "manifest.webmanifest", "robots.txt", "_headers", "_routes.json")
    for relative in required:
        if not (output / relative).is_file():
            failures.append(f"missing {relative}")
    if failures:
        return failures

    index = (output / "index.html").read_text(encoding="utf-8")
    if f'href="{production_url}"' not in index or f'content="{production_url}"' not in index:
        failures.append("root canonical and Open Graph URLs must use the Cloudflare origin")
    if '<meta name="nhl-cloudflare-api" content="/api">' not in index:
        failures.append("Cloudflare live API marker is missing")
    manifest = json.loads((output / "manifest.webmanifest").read_text(encoding="utf-8"))
    if any(manifest.get(key) != "/" for key in ("id", "start_url", "scope")):
        failures.append("manifest id, start_url and scope must be root-hosted")
    if (output / "robots.txt").read_text(encoding="utf-8") != "User-agent: *\nDisallow: /\n":
        failures.append("private deployment must deny crawler indexing")
    headers = (output / "_headers").read_text(encoding="utf-8").lower()
    for token in ("x-robots-tag: noindex", "x-frame-options: deny", "x-content-type-options: nosniff"):
        if token not in headers:
            failures.append(f"headers policy missing {token}")
    routes = json.loads((output / "_routes.json").read_text(encoding="utf-8"))
    if routes != {"version": 1, "include": ["/api/*"], "exclude": []}:
        failures.append("Functions routing must be limited to /api/*")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--production-url", required=True)
    parser.add_argument("--output", type=Path, default=ROOT / ".cloudflare-build")
    args = parser.parse_args()
    failures = failures_for(args.output.resolve(), args.production_url)
    if failures:
        print("Cloudflare artifact verification failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print(f"Cloudflare artifact verification passed: {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
