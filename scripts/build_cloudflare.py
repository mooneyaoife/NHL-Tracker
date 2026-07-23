#!/usr/bin/env python3
"""Build a private, root-hosted Cloudflare Pages copy of the static site."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "site"
DEFAULT_OUTPUT = ROOT / ".cloudflare-build"
GITHUB_PAGES_URL = "https://mooneyaoife.github.io/NHL-Tracker/"
TEXT_SUFFIXES = {".html", ".webmanifest", ".txt", ".xml", ".ics", ".js", ".json"}


def normalise_production_url(value: str) -> str:
    value = value.strip().rstrip("/") + "/"
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError("production URL must be absolute HTTPS without a query or fragment")
    return value


def build(output: Path, production_url: str) -> None:
    production_url = normalise_production_url(production_url)
    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(SOURCE, output, ignore=shutil.ignore_patterns(".DS_Store", "*.map"))

    for path in output.rglob("*"):
        if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES:
            body = path.read_text(encoding="utf-8")
            if GITHUB_PAGES_URL in body:
                path.write_text(body.replace(GITHUB_PAGES_URL, production_url), encoding="utf-8")

    manifest_path = output / "manifest.webmanifest"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.update({"id": "/", "start_url": "/", "scope": "/"})
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    index_path = output / "index.html"
    index = index_path.read_text(encoding="utf-8")
    marker = ('  <meta name="robots" content="noindex,nofollow,noarchive">\n'
        '  <meta name="nhl-cloudflare-api" content="/api">\n')
    if marker not in index:
        theme = '  <meta name="theme-color" content="#f3f1ea">\n'
        if theme in index:
            index = index.replace(theme, theme + marker, 1)
        elif "</head>" in index:
            index = index.replace("</head>", marker + "</head>", 1)
        else:
            index = marker + index
    index_path.write_text(index, encoding="utf-8")

    (output / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    shutil.copy2(ROOT / "deployment" / "cloudflare-pages" / "_headers", output / "_headers")
    shutil.copy2(ROOT / "deployment" / "cloudflare-pages" / "_routes.json", output / "_routes.json")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--production-url", required=True)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build(args.output.resolve(), args.production_url)
    print(args.output.resolve())


if __name__ == "__main__":
    main()
