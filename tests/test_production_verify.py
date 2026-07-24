import hashlib
import importlib.util
import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("production_verify", ROOT / "scripts" / "verify_production.py")
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)
NOW = datetime(2026, 7, 24, 12, 0, tzinfo=timezone.utc)


def fixtures(commit="abc123", status="fresh", age=2):
    freshness = {
        "status": status,
        "schedule": {"complete": True, "counts": {"BUF": 84}, "expectedGamesPerTeam": 84},
        "rosters": {"complete": True},
    }
    tracker = {"meta": {"freshness": freshness}, "scheduleRelease": {"complete": True}, "rosters": {"BUF": [{}]}}
    tracker_body = json.dumps(tracker, separators=(",", ":")).encode()
    metadata = {
        "sourceCommit": commit,
        "dataGeneratedAt": (NOW - timedelta(hours=age)).isoformat(),
        "dataHash": f"sha256:{hashlib.sha256(tracker_body).hexdigest()}",
        "freshness": freshness,
    }
    return {
        "": (b"<!doctype html><title>NHL Tracker</title><main></main>", "text/html"),
        "build-meta.json": (json.dumps(metadata).encode(), "application/json"),
        "data/tracker.json": (tracker_body, "application/json"),
        "api/health": (b'{"ok":true}', "application/json"),
    }


class ProductionVerifyTests(unittest.TestCase):
    def fetcher(self, sites):
        def fetch(url, headers):
            for base, rows in sites.items():
                if url.startswith(base):
                    if "private" in base:
                        self.assertEqual(headers["CF-Access-Client-Id"], "id")
                        self.assertEqual(headers["CF-Access-Client-Secret"], "secret")
                    return rows[url.removeprefix(base)]
            raise OSError("unexpected URL")
        return fetch

    def test_public_and_private_artifacts_match_and_pass(self):
        rows = fixtures()
        report = VERIFY.verify_production("https://public.test/app/", "https://private.test/",
            "id", "secret", self.fetcher({"https://public.test/app/": rows, "https://private.test/": rows}), NOW)
        self.assertTrue(report["passed"])
        self.assertEqual(len(report["sites"]), 2)
        self.assertTrue(report["sites"][1]["apiHealth"]["ok"])

    def test_hash_mismatch_fails_closed(self):
        rows = fixtures()
        metadata = json.loads(rows["build-meta.json"][0])
        metadata["dataHash"] = "sha256:wrong"
        rows = {**rows, "build-meta.json": (json.dumps(metadata).encode(), "application/json")}
        report = VERIFY.verify_production("https://public.test/", fetch=self.fetcher({"https://public.test/": rows}), now=NOW)
        self.assertFalse(report["passed"])
        self.assertTrue(any("hash" in error for error in report["sites"][0]["errors"]))

    def test_private_drift_is_reported_without_exposing_credentials(self):
        public = fixtures()
        private = fixtures(commit="different")
        report = VERIFY.verify_production("https://public.test/", "https://private.test/", "id", "secret",
            self.fetcher({"https://public.test/": public, "https://private.test/": private}), NOW)
        self.assertFalse(report["passed"])
        summary = VERIFY.markdown(report)
        self.assertIn("private source commit differs", summary)
        self.assertNotIn("secret", summary)

    def test_expired_data_fails_daily_verification(self):
        rows = fixtures(age=25)
        report = VERIFY.verify_production("https://public.test/", fetch=self.fetcher({"https://public.test/": rows}), now=NOW)
        self.assertFalse(report["passed"])
        self.assertTrue(any("exceeds" in error for error in report["sites"][0]["errors"]))


if __name__ == "__main__":
    unittest.main()
