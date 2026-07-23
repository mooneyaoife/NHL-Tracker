#!/usr/bin/env python3
"""Enforce deterministic payload and offline-install budgets."""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
BUDGETS = json.loads((ROOT / "performance-budgets.json").read_text())


def local_path(value: str) -> Path:
    clean = urlsplit(value).path.removeprefix("./").lstrip("/")
    return SITE / (clean or "index.html")


def total(paths: list[Path]) -> int:
    missing = [str(path.relative_to(ROOT)) for path in paths if not path.is_file()]
    if missing:
        raise RuntimeError(f"Budget references missing files: {', '.join(missing)}")
    return sum(path.stat().st_size for path in paths)


def main() -> int:
    index = (SITE / "index.html").read_text()
    scripts = [local_path(value) for value in re.findall(r'<script[^>]+src="([^"]+)"', index)]
    initial_js = total(scripts)
    initial_data = total([SITE / "data" / "home.json", SITE / "build-meta.json"])
    worker = (SITE / "sw.js").read_text()
    shell_match = re.search(r"const SHELL=(\[[^;]+\]);", worker)
    if not shell_match:
        raise RuntimeError("Could not read the service-worker shell")
    shell = json.loads(shell_match.group(1))
    offline_cache = total(list(dict.fromkeys(local_path(value) for value in shell)))
    measurements = {"initialJavaScriptBytes": initial_js, "initialDataBytes": initial_data,
        "offlineCacheBytes": offline_cache}
    failures = [f"{name}: {value} > {BUDGETS[name]}" for name, value in measurements.items()
        if value > BUDGETS[name]]
    for name, value in measurements.items():
        print(f"{name}={value} budget={BUDGETS[name]}")
    if failures:
        print("Performance budget failed: " + "; ".join(failures))
        return 1
    print("Static performance budgets passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
