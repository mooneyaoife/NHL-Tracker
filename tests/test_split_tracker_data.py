import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("split_tracker_data", Path(__file__).parents[1] / "scripts" / "split_tracker_data.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SplitTrackerDataTests(unittest.TestCase):
    def test_split_preserves_capability_contracts_and_compacts_false_evidence(self):
        payload = {"meta": {"season": "20262027", "dataHash": "sha256:test", "trackedTeams": ["MTL"]}, "standings": [], "teams": {}, "daily": {"games": []}, "schedulePressure": {"teams": []},
                   "games": [{"id": 1, "team": "MTL", "opponent": "TOR", "date": "2026-10-01", "schedule": {"restDays": 0, "backToBack": False, "travelKm": 900}}],
                   "rosters": {"MTL": []}, "gameCentre": {"1": {"landing": {}}}}
        shards = MODULE.split_payload(payload)
        self.assertEqual(set(shards), {"core", "calendar", "schedule", "players", "analytics"})
        self.assertEqual(shards["core"]["games"], shards["schedule"]["games"])
        self.assertEqual(shards["calendar"]["games"][0]["id"], shards["schedule"]["games"][0]["id"])
        self.assertNotIn("schedule", shards["calendar"]["games"][0])
        self.assertEqual(shards["schedule"]["games"][0]["schedule"], {"travelKm": 900})
        self.assertEqual(shards["schedule"]["schedulePressure"], {"teams": []})
        self.assertIn("rosters", shards["players"])
        self.assertIn("gameCentre", shards["analytics"])

    def test_written_manifest_has_hashes_and_valid_json(self):
        payload = {"meta": {"season": "20262027", "dataHash": "sha256:test"}, "standings": [], "teams": {}, "daily": {"games": []}, "games": []}
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "tracker.json"
            source.write_text(json.dumps(payload))
            original_data = MODULE.DATA
            try:
                MODULE.DATA = Path(directory)
                manifest = MODULE.write_capability_artifacts(source)
            finally:
                MODULE.DATA = original_data
            self.assertEqual(manifest["schema"], 1)
            self.assertEqual(set(manifest["capabilities"]), {"core", "calendar", "schedule", "players", "analytics"})
            self.assertTrue(all(len(item["sha256"]) == 64 for item in manifest["capabilities"].values()))

    def test_core_game_window_keeps_daily_and_bounds_followed_games(self):
        games = [{"id": index, "team": "MTL", "opponent": "TOR", "date": f"2026-10-{index:02d}", "finished": False}
                 for index in range(1, 13)]
        games += [{"id": 90 + index, "team": "MTL", "opponent": "BOS", "date": f"2026-09-{index:02d}", "finished": True}
                  for index in range(1, 7)]
        games.append({"id": 999, "team": "CAR", "opponent": "SJS", "date": "2026-10-01", "finished": False})
        payload = {"meta": {"trackedTeams": ["MTL"]}, "daily": {"games": [{"id": 999}]}, "games": games}
        window = MODULE.compact_game_window(payload)
        ids = {row["id"] for row in window}
        self.assertEqual(len(window), 15)
        self.assertIn(999, ids)
        self.assertEqual(len(ids & set(range(1, 13))), 10)
        self.assertEqual(len(ids & set(range(91, 97))), 4)

    def test_calendar_deduplicates_paired_rows_and_drops_schedule_evidence(self):
        rows = [
            {"id": 1, "team": "MTL", "opponent": "TOR", "location": "Away", "date": "2026-10-01", "schedule": {"travelKm": 500}},
            {"id": 1, "team": "TOR", "opponent": "MTL", "location": "Home", "date": "2026-10-01", "schedule": {"travelKm": 0}},
        ]
        calendar = MODULE.compact_calendar_games(rows)
        self.assertEqual(len(calendar), 1)
        self.assertNotIn("schedule", calendar[0])
        self.assertEqual(calendar[0]["team"], "MTL")


if __name__ == "__main__":
    unittest.main()
