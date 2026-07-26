import importlib.util
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location("schedule_pressure", Path(__file__).parents[1] / "scripts" / "schedule_pressure.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def game(game_id, team, date, burden, **evidence):
    return {"id": game_id, "team": team, "opponent": "BOS", "date": date, "startTimeUTC": f"{date}T18:00:00Z",
            "location": "Away", "finished": False, "schedule": {"burden": burden, **evidence}}


class SchedulePressureTests(unittest.TestCase):
    def test_current_window_uses_next_seven_london_dates_and_ranks_load(self):
        rows = [game(1, "BUF", "2026-10-01", 20), game(2, "BUF", "2026-10-07", 70, backToBack=True),
                game(3, "BUF", "2026-10-08", 40), game(4, "BOS", "2026-10-02", 50)]
        result = MODULE.build_schedule_pressure(rows, ["BUF"], "20252026", "2026-10-01")
        window = result["teams"][0]
        self.assertEqual(window["mode"], "current")
        self.assertEqual(window["gameCount"], 2)
        self.assertEqual(window["games"][1]["leaguePercentile"], 100)
        self.assertIn("Back-to-back", window["games"][1]["signals"])

    def test_offseason_window_begins_at_next_game(self):
        result = MODULE.build_schedule_pressure([game(1, "BUF", "2026-10-01", 30)], ["BUF"], "20252026", "2026-07-26")
        window = result["teams"][0]
        self.assertEqual((window["mode"], window["startDate"], window["endDate"]),
                         ("next", "2026-10-01", "2026-10-07"))

    def test_complete_season_and_missing_evidence_are_truthful(self):
        finished = game(1, "BUF", "2026-04-10", 40)
        finished["finished"] = True
        result = MODULE.build_schedule_pressure([finished], ["BUF", "CAR"], None, "2026-07-26")
        self.assertTrue(all(window["mode"] == "complete" and not window["games"] for window in result["teams"]))
        self.assertIsNone(result["sourceSeason"])

    def test_signal_list_is_bounded_and_plain_language(self):
        row = game(1, "BUF", "2026-10-01", 70, backToBack=True, fourInSix=True, restDifferential=-2,
                   travelKm=3000, timeZoneChange=3, roadTripLength=5, roadTripGame=4, opponentPointsPct=65)
        signals = MODULE.build_schedule_pressure([row], ["BUF"], "20252026", "2026-10-01")["teams"][0]["games"][0]["signals"]
        self.assertEqual(signals, ["Back-to-back", "Fourth game in six days", "Rest disadvantage"])

    def test_window_dates_follow_london_time(self):
        row = game(1, "BUF", "2026-10-24", 40)
        row["startTimeUTC"] = "2026-10-24T23:30:00Z"
        window = MODULE.build_schedule_pressure([row], ["BUF"], "20252026", "2026-10-25")["teams"][0]
        self.assertEqual(window["games"][0]["date"], "2026-10-25")
        self.assertEqual(window["mode"], "current")


if __name__ == "__main__":
    unittest.main()
