#!/usr/bin/env python3
"""Verify deployed NHL Tracker artifacts without contacting upstream providers."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from check_artifact_health import assess_payload, clean, digest_bytes

Fetch = Callable[[str, dict[str, str]], tuple[bytes, str]]


def base_url(value: str) -> str:
    parsed = urlparse(str(value or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("deployment URL must use http or https")
    return value.rstrip("/") + "/"


def fetch_bytes(url: str, headers: dict[str, str], timeout: float = 12) -> tuple[bytes, str]:
    request = Request(url, headers={"Accept": "*/*", "User-Agent": "NHL-Tracker-Production-Verify/1", **headers})
    with urlopen(request, timeout=timeout) as response:
        return response.read(), response.headers.get("content-type", "")


def decode_json(body: bytes, label: str) -> dict:
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{label} is not valid JSON") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def verify_site(url: str, fetch: Fetch, headers: dict[str, str] | None = None,
        now: datetime | None = None, require_health: bool = False,
        max_fresh_age_hours: float = 24, max_fallback_age_hours: float = 72) -> dict:
    root = base_url(url)
    headers = headers or {}
    errors: list[str] = []

    html, _ = fetch(root, headers)
    if b"NHL Tracker" not in html or b"<main" not in html:
        errors.append("root page does not contain the expected NHL Tracker shell")

    metadata_body, _ = fetch(urljoin(root, "build-meta.json"), headers)
    tracker_body, _ = fetch(urljoin(root, "data/tracker.json"), headers)
    metadata = decode_json(metadata_body, "build metadata")
    tracker = decode_json(tracker_body, "tracker data")
    health = assess_payload(metadata, tracker, digest_bytes(tracker_body), now,
        max_fresh_age_hours, max_fallback_age_hours)
    errors.extend(health["errors"])

    api_health = None
    if require_health:
        health_body, _ = fetch(urljoin(root, "api/health"), headers)
        api_health = decode_json(health_body, "API health")
        if api_health.get("ok") is not True:
            errors.append("API health did not report ok")

    return {
        "url": root,
        "passed": not errors,
        "errors": errors,
        "sourceCommit": health["sourceCommit"],
        "dataHash": health["dataHash"],
        "dataGeneratedAt": health["dataGeneratedAt"],
        "status": health["status"],
        "ageHours": health["ageHours"],
        "apiHealth": api_health,
    }


def verify_production(public_url: str, private_url: str = "", access_id: str = "",
        access_secret: str = "", fetch: Fetch = fetch_bytes, now: datetime | None = None,
        max_fresh_age_hours: float = 24, max_fallback_age_hours: float = 72) -> dict:
    sites = [verify_site(public_url, fetch, now=now,
        max_fresh_age_hours=max_fresh_age_hours,
        max_fallback_age_hours=max_fallback_age_hours)]
    if private_url:
        if not access_id or not access_secret:
            raise ValueError("Cloudflare Access credentials are required for the private deployment")
        headers = {
            "CF-Access-Client-Id": access_id,
            "CF-Access-Client-Secret": access_secret,
        }
        private = verify_site(private_url, fetch, headers, now, True,
            max_fresh_age_hours, max_fallback_age_hours)
        sites.append(private)
        public = sites[0]
        if private["sourceCommit"] != public["sourceCommit"]:
            private["errors"].append("private source commit differs from public deployment")
        if private["dataHash"] != public["dataHash"]:
            private["errors"].append("private tracker hash differs from public deployment")
        private["passed"] = not private["errors"]
    return {"passed": all(site["passed"] for site in sites), "sites": sites}


def markdown(report: dict) -> str:
    lines = ["## Production verification", "", "| Deployment | Gate | Freshness | Age | Source commit |", "| --- | --- | --- | ---: | --- |"]
    for site in report["sites"]:
        result = "PASS" if site["passed"] else "FAIL"
        lines.append(f"| {clean(site['url'])} | **{result}** | `{clean(site['status'])}` | {site['ageHours']:.1f}h | `{clean(site['sourceCommit'])}` |")
    errors = [(site["url"], error) for site in report["sites"] for error in site["errors"]]
    if errors:
        lines.extend(["", "### Blocking findings", ""])
        lines.extend(f"- {clean(url)}: {clean(error)}" for url, error in errors)
    return "\n".join(lines) + "\n"


def positive(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("value must be positive")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--public-url", required=True)
    parser.add_argument("--private-url", default="")
    parser.add_argument("--access-id", default=os.environ.get("CLOUDFLARE_ACCESS_CLIENT_ID", ""))
    parser.add_argument("--access-secret", default=os.environ.get("CLOUDFLARE_ACCESS_CLIENT_SECRET", ""))
    parser.add_argument("--max-fresh-age-hours", type=positive, default=24)
    parser.add_argument("--max-fallback-age-hours", type=positive, default=72)
    parser.add_argument("--attempts", type=int, default=1)
    parser.add_argument("--retry-delay", type=positive, default=5)
    args = parser.parse_args()
    if args.attempts < 1 or args.attempts > 10:
        parser.error("attempts must be between 1 and 10")

    report = None
    for attempt in range(1, args.attempts + 1):
        try:
            report = verify_production(args.public_url, args.private_url, args.access_id,
                args.access_secret, max_fresh_age_hours=args.max_fresh_age_hours,
                max_fallback_age_hours=args.max_fallback_age_hours)
            if report["passed"] or attempt == args.attempts:
                break
        except (HTTPError, URLError, OSError, TypeError, ValueError) as exc:
            if attempt == args.attempts:
                print(f"production verification failed: {exc}", file=sys.stderr)
                return 1
        time.sleep(args.retry_delay)

    if report is None:
        return 1
    summary = markdown(report)
    summary_path = str(os.environ.get("GITHUB_STEP_SUMMARY") or "").strip()
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write(summary)
    for site in report["sites"]:
        print(f"productionHealth={'passed' if site['passed'] else 'failed'} "
              f"url={site['url']} status={site['status']} ageHours={site['ageHours']:.1f}")
        for error in site["errors"]:
            print(f"error: {site['url']}: {error}", file=sys.stderr)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
