#!/usr/bin/env python3
"""Validate deployable tracker freshness and write a concise Actions summary."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_METADATA = ROOT / "site" / "build-meta.json"
DEFAULT_TRACKER = ROOT / "site" / "data" / "tracker.json"
FALLBACK_STATUSES = {"stale", "partial-stale"}


def parse_timestamp(value: object) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError("data timestamp is missing")
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def digest(path: Path) -> str:
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


def clean(value: object) -> str:
    return str(value if value is not None else "").replace("\n", " ").replace("\r", " ").replace("|", "\\|")


def assess_artifact(metadata: dict, tracker: dict, tracker_path: Path,
        now: datetime | None = None, max_fresh_age_hours: float = 24,
        max_fallback_age_hours: float = 72) -> dict:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    freshness = metadata.get("freshness") if isinstance(metadata.get("freshness"), dict) else {}
    tracker_meta = tracker.get("meta") if isinstance(tracker.get("meta"), dict) else {}
    status = str(freshness.get("status") or "unknown").strip().lower()
    errors: list[str] = []

    try:
        generated_at = parse_timestamp(metadata.get("dataGeneratedAt"))
        age_hours = max(0.0, (now - generated_at).total_seconds() / 3600)
        if generated_at > now + timedelta(minutes=5):
            errors.append("data timestamp is in the future")
    except (TypeError, ValueError) as exc:
        generated_at = None
        age_hours = float("inf")
        errors.append(str(exc))

    expected_hash = str(metadata.get("dataHash") or "")
    actual_hash = digest(tracker_path)
    if not expected_hash:
        errors.append("data hash is missing")
    elif expected_hash != actual_hash:
        errors.append("tracker hash does not match build metadata")

    source_commit = str(metadata.get("sourceCommit") or "").strip()
    if not source_commit or source_commit == "unknown":
        errors.append("source commit is missing")

    schedule = freshness.get("schedule") if isinstance(freshness.get("schedule"), dict) else {}
    schedule_release = tracker.get("scheduleRelease") if isinstance(tracker.get("scheduleRelease"), dict) else {}
    schedule_complete = bool(schedule.get("complete", schedule_release.get("complete", False)))
    schedule_failed = schedule.get("failedTeams") if isinstance(schedule.get("failedTeams"), list) else []
    counts = schedule.get("counts") if isinstance(schedule.get("counts"), dict) else {}

    rosters = freshness.get("rosters") if isinstance(freshness.get("rosters"), dict) else {}
    tracker_rosters = tracker.get("rosters") if isinstance(tracker.get("rosters"), dict) else {}
    rosters_complete = bool(rosters.get("complete", bool(tracker_rosters)))
    roster_failed = rosters.get("failedTeams") if isinstance(rosters.get("failedTeams"), list) else []
    failed_teams = sorted({clean(team) for team in (
        (freshness.get("failedTeams") if isinstance(freshness.get("failedTeams"), list) else [])
        + schedule_failed + roster_failed) if clean(team)})

    if status == "fresh":
        age_limit = max_fresh_age_hours
        if failed_teams:
            errors.append("fresh data reports failed teams")
    elif status in FALLBACK_STATUSES:
        age_limit = max_fallback_age_hours
    else:
        age_limit = max_fresh_age_hours
        errors.append(f"unsupported freshness status: {status}")

    if not schedule_complete:
        errors.append("artifact has no complete schedule snapshot")
    if not rosters_complete:
        errors.append("artifact has no complete roster snapshot or safe fallback")
    if age_hours > age_limit:
        errors.append(f"artifact age {age_hours:.1f}h exceeds the {age_limit:g}h {status} limit")

    expected_games = schedule.get("expectedGamesPerTeam")
    schedule_detail = "complete" if schedule_complete else "incomplete"
    if counts:
        schedule_detail += f"; {len(counts)} teams"
    if expected_games:
        schedule_detail += f"; {expected_games} games/team expected"

    return {
        "passed": not errors,
        "errors": errors,
        "status": status,
        "sourceCommit": source_commit,
        "dataGeneratedAt": generated_at.isoformat() if generated_at else "unknown",
        "ageHours": age_hours,
        "ageLimitHours": age_limit,
        "dataHash": actual_hash,
        "schedule": schedule_detail,
        "rosters": "complete" if rosters_complete else "incomplete",
        "failedTeams": failed_teams,
    }


def markdown(report: dict) -> str:
    result = "PASS" if report["passed"] else "FAIL"
    failed = ", ".join(report["failedTeams"]) or "None"
    lines = [
        "## NHL artifact health",
        "",
        "| Check | Result |",
        "| --- | --- |",
        f"| Gate | **{result}** |",
        f"| Freshness | `{clean(report['status'])}` |",
        f"| Data generated | `{clean(report['dataGeneratedAt'])}` |",
        f"| Data age | {report['ageHours']:.1f}h / {report['ageLimitHours']:g}h limit |",
        f"| Source commit | `{clean(report['sourceCommit'])}` |",
        f"| Data hash | `{clean(report['dataHash'])}` |",
        f"| Schedule | {clean(report['schedule'])} |",
        f"| Rosters | {clean(report['rosters'])} |",
        f"| Failed teams | {clean(failed)} |",
    ]
    if report["errors"]:
        lines.extend(["", "### Blocking findings", ""])
        lines.extend(f"- {clean(error)}" for error in report["errors"])
    return "\n".join(lines) + "\n"


def positive_hours(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("age limits must be positive")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metadata", type=Path, default=DEFAULT_METADATA)
    parser.add_argument("--tracker", type=Path, default=DEFAULT_TRACKER)
    parser.add_argument("--max-fresh-age-hours", type=positive_hours, default=24)
    parser.add_argument("--max-fallback-age-hours", type=positive_hours, default=72)
    args = parser.parse_args()

    try:
        metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
        tracker = json.loads(args.tracker.read_text(encoding="utf-8"))
        report = assess_artifact(metadata, tracker, args.tracker,
            max_fresh_age_hours=args.max_fresh_age_hours,
            max_fallback_age_hours=args.max_fallback_age_hours)
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        print(f"artifact health check failed: {exc}", file=sys.stderr)
        return 1

    summary = markdown(report)
    summary_path = str(os.environ.get("GITHUB_STEP_SUMMARY") or "").strip()
    if summary_path:
        with Path(summary_path).open("a", encoding="utf-8") as handle:
            handle.write(summary)
    print(f"artifactHealth={'passed' if report['passed'] else 'failed'} "
          f"status={report['status']} ageHours={report['ageHours']:.1f}")
    for error in report["errors"]:
        print(f"error: {error}", file=sys.stderr)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
