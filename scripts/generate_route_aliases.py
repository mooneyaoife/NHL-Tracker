#!/usr/bin/env python3
"""Generate static hand-off pages for the tracker's public, non-hash URLs."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
ROUTES = {
    "tonight": "tonight",
    "games": "games",
    "lineups": "availability",
    "season": "schedule",
    "trends": "trends",
    "playoffs": "playoffs",
    "teams": "teams",
    "players": "players",
    "compare": "compare",
    "league": "league",
    "power": "power",
    "movement": "news",
    "workspace": "watchlist",
    "reference": "guide",
    "status": "status",
    "policies": "policies",
}


def alias_page(slug: str, route: str) -> str:
    return f"""<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,follow">
  <meta http-equiv="refresh" content="0;url=../#{route}">
  <title>Opening {slug.replace('-', ' ').title()} · NHL Tracker</title>
  <script>
    const target = new URL("../", location.href);
    target.search = location.search;
    target.hash = "#{route}";
    location.replace(target.href);
  </script>
</head>
<body>
  <main><p>Opening <a href="../#{route}">NHL Tracker</a>…</p></main>
</body>
</html>
"""


def main() -> None:
    for slug, route in ROUTES.items():
        destination = SITE / slug / "index.html"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(alias_page(slug, route), encoding="utf-8")


if __name__ == "__main__":
    main()
