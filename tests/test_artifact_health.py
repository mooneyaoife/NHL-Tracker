import hashlib
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("artifact_health", ROOT / "scripts" / "check_artifact_health.py")
HEALTH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HEALTH)
NOW = datetime(2026, 7, 24, 12, 0, tzinfo=timezone.utc)


class ArtifactHealthTests(unittest.TestCase):
    def assess(self, status="fresh", age_hours=2, schedule_complete=True,
            rosters_complete=True, failed_teams=None, valid_hash=True):
        failed_teams = failed_teams or []
        freshness = {
            "status": status,
            "failedTeams": failed_teams,
            "schedule": {"complete": schedule_complete, "expectedGamesPerTeam": 84,
                "counts": {"BUF": 84}, "failedTeams": failed_teams},
            "rosters": {"complete": rosters_complete, "failedTeams": failed_teams,
                "fallbackTeams": failed_teams},
        }
        tracker = {"meta": {"freshness": freshness},
            "scheduleRelease": {"complete": schedule_complete}, "rosters": {"BUF": [{"id": "1"}]}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tracker.json"
            path.write_text(json.dumps(tracker), encoding="utf-8")
            data_hash = f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"
            metadata = {"sourceCommit": "abc123", "dataGeneratedAt": (NOW - timedelta(hours=age_hours)).isoformat(),
                "dataHash": data_hash if valid_hash else "sha256:wrong", "freshness": freshness}
            return HEALTH.assess_artifact(metadata, tracker, path, NOW, 24, 72)

    def test_fresh_complete_artifact_passes(self):
        report = self.assess()
        self.assertTrue(report["passed"])
        self.assertEqual(report["ageLimitHours"], 24)

    def test_complete_stale_fallback_has_bounded_longer_window(self):
        report = self.assess(status="stale", age_hours=48, failed_teams=["BUF"])
        self.assertTrue(report["passed"])
        self.assertEqual(report["ageLimitHours"], 72)

    def test_partial_stale_roster_fallback_is_supported(self):
        report = self.assess(status="partial-stale", age_hours=12, failed_teams=["BUF"])
        self.assertTrue(report["passed"])

    def test_expired_fallback_is_blocked(self):
        report = self.assess(status="stale", age_hours=73, failed_teams=["BUF"])
        self.assertFalse(report["passed"])
        self.assertTrue(any("exceeds" in error for error in report["errors"]))

    def test_incomplete_artifact_without_safe_snapshot_is_blocked(self):
        report = self.assess(status="stale", schedule_complete=False)
        self.assertFalse(report["passed"])
        self.assertTrue(any("complete schedule" in error for error in report["errors"]))

    def test_hash_mismatch_is_blocked(self):
        report = self.assess(valid_hash=False)
        self.assertFalse(report["passed"])
        self.assertTrue(any("hash" in error for error in report["errors"]))

    def test_fresh_status_cannot_hide_failed_teams(self):
        report = self.assess(status="fresh", failed_teams=["BUF"])
        self.assertFalse(report["passed"])
        self.assertTrue(any("reports failed teams" in error for error in report["errors"]))

    def test_summary_escapes_untrusted_table_content(self):
        report = self.assess()
        report["failedTeams"] = ["BUF|injected\nrow"]
        summary = HEALTH.markdown(report)
        self.assertIn("BUF\\|injected row", summary)


if __name__ == "__main__":
    unittest.main()
