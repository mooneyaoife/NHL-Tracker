import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "split_season_evidence", Path(__file__).parents[1] / "scripts" / "split_season_evidence.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SplitSeasonEvidenceTests(unittest.TestCase):
    def payload(self):
        game = {
            "id": 7, "date": "2026-04-01", "startTimeUTC": "2026-04-01T23:00:00Z",
            "away": "BUF", "home": "CAR", "players": [{"id": "9"}],
            "goalies": [{"id": "1", "team": "BUF", "name": "Goalie", "saves": 30}],
        }
        log = [{"date": "2026-04-01", "team": "BUF", "opponent": "CAR", "points": 2}]
        return {
            "meta": {"season": "20252026"}, "standings": [{"team": "BUF"}],
            "teams": {"BUF": {"gp": 82, "last10": [{"finished": True}], "games": [{"id": 7}]}},
            "players": {"BUF": [{"id": "9", "name": "Skater", "teams": ["BUF", "CAR"], "totals": {"points": 80}, "games": log}]},
            "rosters": {"BUF": []}, "moneypuck": {"teams": [{"team": "BUF"}]},
            "naturalStatTrick": {"teams": [{"team": "BUF"}]}, "gameLibrary": [game],
        }

    def test_compact_evidence_keeps_analytics_and_defers_full_logs(self):
        payload = self.payload()
        compact = MODULE.compact_evidence(payload)
        self.assertEqual(compact["moneypuck"], payload["moneypuck"])
        self.assertEqual(compact["naturalStatTrick"], payload["naturalStatTrick"])
        self.assertNotIn("games", compact["teams"]["BUF"])
        self.assertNotIn("games", compact["players"]["BUF"][0])
        self.assertEqual(compact["gameLibrary"][0]["goalies"], payload["gameLibrary"][0]["goalies"])
        self.assertNotIn("players", compact["gameLibrary"][0])

    def test_player_logs_are_available_for_every_affiliated_team(self):
        shards = MODULE.player_game_shards(self.payload()["players"])
        self.assertEqual(shards["BUF"]["9"], shards["CAR"]["9"])

    def test_manifest_has_verified_sizes_hashes_and_stable_urls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "20252026.json"
            source.write_text(json.dumps(self.payload()), encoding="utf-8")
            old = MODULE.SEASONS
            try:
                MODULE.SEASONS = root
                manifest = MODULE.write_season_evidence(source)
            finally:
                MODULE.SEASONS = old
            evidence = root / "20252026-evidence.json"
            self.assertEqual(manifest["evidence"]["bytes"], evidence.stat().st_size)
            self.assertEqual(len(manifest["evidence"]["sha256"]), 64)
            self.assertIn("BUF", manifest["playerGames"])
            self.assertIn("CAR", manifest["playerGames"])
            self.assertLess(evidence.stat().st_size, source.stat().st_size)


if __name__ == "__main__":
    unittest.main()
