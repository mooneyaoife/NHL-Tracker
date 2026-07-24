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
        payload = {"meta": {"season": "20262027", "dataHash": "sha256:test"}, "standings": [], "teams": {}, "daily": {"games": []},
                   "games": [{"id": 1, "team": "MTL", "opponent": "TOR", "date": "2026-10-01", "schedule": {"restDays": 0, "backToBack": False, "travelKm": 900}}],
                   "rosters": {"MTL": []}, "gameCentre": {"1": {"landing": {}}}}
        shards = MODULE.split_payload(payload)
        self.assertEqual(set(shards), {"core", "schedule", "players", "analytics"})
        self.assertEqual(shards["schedule"]["games"][0]["schedule"], {"travelKm": 900})
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
            self.assertEqual(set(manifest["capabilities"]), {"core", "schedule", "players", "analytics"})
            self.assertTrue(all(len(item["sha256"]) == 64 for item in manifest["capabilities"].values()))


if __name__ == "__main__":
    unittest.main()
