import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("update_tracker", ROOT / "scripts" / "update_tracker.py")
TRACKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TRACKER)


class SeasonRolloverTests(unittest.TestCase):
    @staticmethod
    def schedule_game(game_id, date="2026-10-06", start="2026-10-06T23:00:00Z", away="BUF", home="BOS"):
        return {"id": game_id, "gameType": 2, "gameDate": date, "startTimeUTC": start,
            "awayTeam": {"abbrev": away}, "homeTeam": {"abbrev": home}, "venue": {"default": "Arena"}}

    def test_schedule_lengths_change_in_2026_27(self):
        self.assertEqual(TRACKER.regular_season_games("20252026"), 82)
        self.assertEqual(TRACKER.regular_season_games("20262027"), 84)

    def test_opening_night_preview_does_not_roll_season(self):
        games = [{"gameType": 2, "gameDate": "2026-10-06"}] * 3
        with patch.object(TRACKER, "fetch_json", return_value={"games": games}):
            self.assertEqual(TRACKER.schedule_is_published("20262027"), (False, 3))

    def test_full_84_game_schedule_is_ready(self):
        games = [{"gameType": 2, "gameDate": "2026-10-06"}] * 84
        with patch.object(TRACKER, "fetch_json", return_value={"games": games}):
            self.assertEqual(TRACKER.schedule_is_published("20262027"), (True, 84))

    def test_auto_mode_waits_then_rolls_forward(self):
        config = {**TRACKER.CONFIG, "season": "20252026", "seasonMode": "auto"}
        with patch.object(TRACKER, "CONFIG", config), patch.object(TRACKER, "calendar_season", return_value="20262027"):
            with patch.object(TRACKER, "schedule_is_published", return_value=(False, 3)):
                self.assertEqual(TRACKER.resolve_active_season()[0], "20252026")
            with patch.object(TRACKER, "schedule_is_published", return_value=(True, 84)):
                self.assertEqual(TRACKER.resolve_active_season()[0], "20262027")

    def test_release_state_counts_tracked_games_and_uses_84_game_target(self):
        state = TRACKER.schedule_release_state("20262027", [self.schedule_game(1)])
        self.assertEqual(state["expectedGamesPerTeam"], 84)
        self.assertEqual(state["counts"]["BUF"], 1)
        self.assertFalse(state["complete"])

    def test_release_state_detects_time_changes_without_duplicate_history(self):
        first = TRACKER.schedule_release_state("20262027", [self.schedule_game(1)])
        changed = TRACKER.schedule_release_state("20262027", [self.schedule_game(1, start="2026-10-07T00:00:00Z")], first)
        self.assertEqual(len(changed["recentChanges"]), 1)
        self.assertEqual(changed["recentChanges"][0]["kind"], "changed")
        unchanged = TRACKER.schedule_release_state("20262027", [self.schedule_game(1, start="2026-10-07T00:00:00Z")], changed)
        self.assertEqual(len(unchanged["recentChanges"]), 1)

    def test_preseason_is_published_separately_from_standings_rows(self):
        preseason = self.schedule_game(91)
        preseason["gameType"] = 1
        preseason["gameState"] = "FINAL"
        preseason["awayTeam"]["score"] = 3
        preseason["homeTeam"]["score"] = 2
        self.assertEqual(TRACKER.tracked_game_rows([preseason], ["BUF"]), [])
        rows = TRACKER.preseason_schedule_rows([preseason])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["type"], "Preseason")
        self.assertEqual(rows[0]["awayScore"], 3)

    def test_official_special_teams_percentages_are_normalised_and_ranked(self):
        standings = [{"team": "BUF", "name": "Buffalo Sabres"}, {"team": "BOS", "name": "Boston Bruins"}]
        response = {"data": [
            {"teamAbbrevs": "BUF", "teamFullName": "Buffalo Sabres", "gamesPlayed": 82,
                "powerPlayPct": 0.25, "penaltyKillPct": 0.80},
            {"teamAbbrevs": "BOS", "teamFullName": "Boston Bruins", "gamesPlayed": 82,
                "powerPlayPct": 0.20, "penaltyKillPct": 0.85},
        ]}
        with patch.object(TRACKER, "fetch_json", return_value=response):
            rows = TRACKER.load_special_teams(standings)
        buffalo = next(row for row in rows if row["team"] == "BUF")
        self.assertEqual(buffalo["ppPct"], 25.0)
        self.assertEqual(buffalo["pkPct"], 80.0)
        self.assertEqual(buffalo["ppRank"], 1)
        self.assertEqual(buffalo["pkRank"], 2)


if __name__ == "__main__":
    unittest.main()
