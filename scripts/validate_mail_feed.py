#!/usr/bin/env python3
"""Validate the public, metadata-only mail feed independently of NHL refreshes."""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FEED = ROOT / "site" / "data" / "puckpedia-mail.json"


def iso_datetime(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def failures_for(feed: object) -> list[str]:
    failures: list[str] = []
    if not isinstance(feed, dict):
        return ["feed must be a JSON object"]
    if feed.get("schema") != 1:
        failures.append("schema must be 1")
    if not iso_datetime(feed.get("updatedAt")):
        failures.append("updatedAt must be an ISO-8601 timestamp")
    items = feed.get("items")
    if not isinstance(items, list):
        return failures + ["items must be an array"]
    seen: set[str] = set()
    for index, item in enumerate(items):
        label = f"items[{index}]"
        if not isinstance(item, dict):
            failures.append(f"{label} must be an object")
            continue
        for field in ("id", "title", "category"):
            if not isinstance(item.get(field), str) or not item[field].strip():
                failures.append(f"{label}.{field} must be a non-empty string")
        identifier = str(item.get("id") or "")
        if identifier in seen:
            failures.append(f"{label}.id duplicates {identifier}")
        seen.add(identifier)
        if not iso_datetime(item.get("publishedAt")):
            failures.append(f"{label}.publishedAt must be an ISO-8601 timestamp")
        parsed = urlsplit(str(item.get("url") or ""))
        if parsed.scheme != "https" or parsed.hostname not in {"puckpedia.com", "www.puckpedia.com"}:
            failures.append(f"{label}.url must be an HTTPS PuckPedia URL")
        forbidden = {"body", "html", "text", "sender", "recipient", "headers"}.intersection(item)
        if forbidden:
            failures.append(f"{label} contains private mail fields: {', '.join(sorted(forbidden))}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", type=Path, default=DEFAULT_FEED)
    args = parser.parse_args()
    feed = json.loads(args.path.read_text(encoding="utf-8"))
    failures = failures_for(feed)
    if failures:
        print("Mail feed validation failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print(f"Mail feed validation passed: {len(feed['items'])} metadata-only items")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
