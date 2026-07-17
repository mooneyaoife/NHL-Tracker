import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("update_tracker_schedule", ROOT / "scripts" / "update_tracker.py")
TRACKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TRACKER)


class ScheduleModelTests(unittest.TestCase):
    def test_venue_reference_and_weights_are_complete(self):
        reference = TRACKER.load_schedule_venues()
        self.assertEqual(len(reference["venues"]), 37)
        self.assertEqual(len(reference["homeVenues"]), 32)
        self.assertAlmostEqual(sum(TRACKER.SCHEDULE_WEIGHTS.values()), 1)

    def test_published_schedule_reconciliation_fails_closed(self):
        teams = [f"T{i:02d}" for i in range(32)]
        games = [{"id": index, "gameType": 2, "gameDate": "2026-10-01"} for index in range(1344)]
        games[0]["gameDate"] = "2026-09-29"
        games[-1]["gameDate"] = "2027-04-10"
        rows = []
        for team in teams:
            rows.extend({"team": team, "officialHome": index < 42, "venue": "Test Arena", "venueMissing": False}
                for index in range(84))
        strength = {team: .5 for team in teams}
        result = TRACKER.schedule_reconciliation(games, rows, teams, {}, strength, "20262027")
        self.assertEqual(result["status"], "pass")
        rows[0]["venueMissing"] = True
        with self.assertRaisesRegex(RuntimeError, "Missing venue coordinates"):
            TRACKER.schedule_reconciliation(games, rows, teams, {}, strength, "20262027")

    def test_generated_baseline_matches_workbook_benchmarks(self):
        payload = json.loads((ROOT / "site" / "data" / "tracker.json").read_text())
        model = payload["scheduleDifficulty"]
        actual = {row["team"]: row["score"] for row in model["teams"]}
        self.assertEqual(model["reconciliation"]["status"], "pass")
        self.assertEqual(actual["SEA"], 66.7)
        self.assertEqual(actual["BUF"], 45.6)
        self.assertEqual(actual["VGK"], 27.8)
        self.assertTrue(all(row["status"] == "pass" for row in model["benchmarkComparison"]))


if __name__ == "__main__":
    unittest.main()
