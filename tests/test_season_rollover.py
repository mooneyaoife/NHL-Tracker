import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("update_tracker", ROOT / "scripts" / "update_tracker.py")
TRACKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TRACKER)


class SeasonRolloverTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
