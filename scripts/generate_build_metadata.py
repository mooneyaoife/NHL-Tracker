#!/usr/bin/env python3
"""Describe the exact code and committed data used by a deployable site artifact."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"


def digest(path: Path) -> str:
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


def commit() -> str:
    supplied = str(os.environ.get("GITHUB_SHA") or "").strip()
    if supplied:
        return supplied
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    return result.stdout.strip() or "unknown"


def main() -> None:
    tracker_path = SITE / "data" / "tracker.json"
    tracker = json.loads(tracker_path.read_text())
    metadata = {
        "schema": 1,
        "sourceCommit": commit(),
        "artifactGeneratedAt": datetime.now(timezone.utc).isoformat(),
        "dataGeneratedAt": tracker.get("meta", {}).get("updatedAt"),
        "dataHash": digest(tracker_path),
        "season": tracker.get("meta", {}).get("season"),
        "version": tracker.get("meta", {}).get("version"),
        "freshness": tracker.get("meta", {}).get("freshness") or {
            "status": "static", "lastSuccessfulAt": tracker.get("meta", {}).get("updatedAt")},
    }
    home = {
        "schema": 1,
        "sourceCommit": metadata["sourceCommit"],
        "dataGeneratedAt": metadata["dataGeneratedAt"],
        "season": metadata["season"],
        "version": metadata["version"],
        "trackedTeams": tracker.get("meta", {}).get("trackedTeams", []),
        "teams": {row.get("team"): row.get("name") for row in tracker.get("standings", []) if row.get("team")},
        "daily": tracker.get("daily", {"games": []}),
    }
    for path, payload in ((SITE / "build-meta.json", metadata), (SITE / "data" / "home.json", home)):
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temporary.replace(path)
    print(f"Generated site/build-meta.json for {metadata['sourceCommit']}")


if __name__ == "__main__":
    main()
