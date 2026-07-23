import importlib.util
import json
import tempfile
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

    def test_83_game_schedule_does_not_roll_season(self):
        games = [{"gameType": 2, "gameDate": "2026-10-06"}] * 83
        with patch.object(TRACKER, "fetch_json", return_value={"games": games}):
            self.assertEqual(TRACKER.schedule_is_published("20262027"), (False, 83))

    def test_rollover_waits_for_every_tracked_team(self):
        full = [{"gameType": 2, "gameDate": "2026-10-06"}] * 84
        partial = full[:-1]

        def response(url):
            return {"games": partial if "/CAR/" in url else full}

        with patch.object(TRACKER, "fetch_json", side_effect=response):
            self.assertEqual(TRACKER.schedule_is_published("20262027"), (False, 83))

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

    def test_schedule_completeness_identifies_undercovered_teams(self):
        games = [self.schedule_game(index, away="BUF", home="BOS") for index in range(83)]
        status = TRACKER.schedule_completeness(games, ["BUF", "BOS"], "20262027")
        self.assertFalse(status["complete"])
        self.assertEqual(status["failedTeams"], ["BOS", "BUF"])
        self.assertEqual(status["expectedGamesPerTeam"], 84)

    def test_incomplete_schedule_retains_and_labels_complete_fallback(self):
        previous = {"meta": {"updatedAt": "2026-07-20T12:00:00+00:00"},
            "scheduleRelease": {"complete": True}, "sources": {"nhl": {"status": "Ready"}}}
        fallback = TRACKER.stale_schedule_fallback(previous, {"failedTeams": ["BUF"]})
        self.assertEqual(fallback["meta"]["freshness"]["status"], "stale")
        self.assertEqual(fallback["meta"]["freshness"]["failedTeams"], ["BUF"])
        self.assertEqual(fallback["sources"]["nhl"]["status"], "Stale fallback")

    def test_incomplete_schedule_without_fallback_fails_safely(self):
        with self.assertRaises(RuntimeError):
            TRACKER.stale_schedule_fallback({}, {"failedTeams": ["BUF"]})

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

    def test_new_season_standings_fallback_keeps_identities_but_zeros_results(self):
        previous = {"standings": [{"team": "BUF", "name": "Buffalo Sabres", "conference": "Eastern",
            "division": "Atlantic", "gp": 82, "w": 50, "l": 24, "otl": 8, "points": 108,
            "rw": 42, "gf": 290, "ga": 235, "gd": 55, "divisionRank": 1, "wildcardRank": 0,
            "streak": "W3"}]}
        with patch.object(TRACKER, "fetch_json", return_value={"standings": []}):
            rows = TRACKER.load_standings(previous)
        self.assertEqual(rows[0]["team"], "BUF")
        for key in ("gp", "w", "l", "otl", "points", "gf", "ga", "gd"):
            self.assertEqual(rows[0][key], 0)

    def test_new_schedule_starts_team_summaries_at_zero(self):
        regular = self.schedule_game(101)
        regular["gameState"] = "FUT"
        preseason = self.schedule_game(102)
        preseason["gameType"] = 1
        preseason["gameState"] = "FINAL"
        preseason["awayTeam"]["score"] = 4
        preseason["homeTeam"]["score"] = 1
        rows = TRACKER.tracked_game_rows([regular, preseason], ["BUF"])
        summary = TRACKER.team_summaries(rows, ["BUF"])["BUF"]
        self.assertEqual(summary["gp"], 0)
        self.assertEqual(summary["points"], 0)

    def test_calendar_contains_preseason_and_regular_games_in_utc(self):
        preseason = self.schedule_game(201, date="2026-09-25", start="2026-09-25T23:00:00Z")
        preseason["gameType"] = 1
        regular = self.schedule_game(202)
        feed = TRACKER.calendar_feed("Buffalo Sabres - NHL Tracker", [preseason, regular],
            {"BUF": "Buffalo Sabres", "BOS": "Boston Bruins"}, "#003087")
        self.assertEqual(feed.count("BEGIN:VEVENT"), 2)
        self.assertIn("X-WR-TIMEZONE:Europe/London", feed)
        self.assertIn("X-APPLE-CALENDAR-COLOR:#003087", feed)
        self.assertIn("DTSTART:20260925T230000Z", feed)
        self.assertIn("DTSTART:20261006T230000Z", feed)
        self.assertIn("Preseason", feed)
        self.assertIn("Regular season", feed)

    def test_daily_slate_keeps_only_the_scoreboard_date(self):
        games = [
            {"id": 1, "date": "2026-09-29"},
            {"id": 2, "date": "2026-09-29"},
            {"id": 3, "date": "2026-09-30"},
        ]
        date, slate = TRACKER.select_daily_slate(games, "2026-09-29")
        self.assertEqual(date, "2026-09-29")
        self.assertEqual([game["id"] for game in slate], [1, 2])

    def test_daily_slate_falls_forward_to_the_next_playable_date(self):
        games = [
            {"id": 1, "date": "2026-10-01"},
            {"id": 2, "date": "2026-10-03"},
            {"id": 3, "date": "2026-10-03"},
        ]
        date, slate = TRACKER.select_daily_slate(games, "2026-10-02")
        self.assertEqual(date, "2026-10-03")
        self.assertEqual([game["id"] for game in slate], [2, 3])

    def test_daily_loader_preserves_nhl_slate_date_after_utc_midnight(self):
        score = {"currentDate": "2026-09-29"}
        schedule = {"gameWeek": [{"date": "2026-09-29", "games": [{
            "id": 7, "startTimeUTC": "2026-09-30T02:30:00Z", "awayTeam": {"abbrev": "CHI"},
            "homeTeam": {"abbrev": "VGK"}, "venue": {"default": "Arena"}
        }]}]}
        with patch.object(TRACKER, "fetch_json", side_effect=[score, schedule]):
            daily = TRACKER.load_daily()
        self.assertEqual(daily["currentDate"], "2026-09-29")
        self.assertEqual(len(daily["games"]), 1)
        self.assertEqual(daily["games"][0]["date"], "2026-09-29")
        self.assertEqual(daily["games"][0]["londonDate"], "2026-09-30")

    def test_live_refresh_only_selects_followed_team_games(self):
        now = TRACKER.datetime(2026, 10, 6, 23, 0, tzinfo=TRACKER.timezone.utc)
        daily = {"games": [
            {"id": 1, "away": "BUF", "home": "BOS", "state": "LIVE", "startTimeUTC": "2026-10-06T23:00:00Z"},
            {"id": 2, "away": "NYR", "home": "NJD", "state": "LIVE", "startTimeUTC": "2026-10-06T23:00:00Z"},
        ]}
        self.assertEqual(TRACKER.active_game_ids(daily, now, ["BUF"]), ["1"])

    def test_exceptional_games_do_not_trigger_live_refresh(self):
        now = TRACKER.datetime(2026, 10, 6, 23, 0, tzinfo=TRACKER.timezone.utc)
        games = [{"id": index, "away": "BUF", "home": "BOS", "state": state,
            "startTimeUTC": "2026-10-06T23:00:00Z"}
            for index, state in enumerate(("POSTPONED", "DELAYED", "SUSPENDED", "CANCELLED"), 1)]
        self.assertEqual(TRACKER.active_game_ids({"games": games}, now, ["BUF"]), [])

    def test_season_index_preserves_old_archive_and_marks_new_current(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "data" / "tracker.json"
            seasons = output.parent / "seasons"
            seasons.mkdir(parents=True)
            for season in ("20252026", "20262027"):
                (seasons / f"{season}.json").write_text(json.dumps({
                    "meta": {"season": season, "updatedAt": "2026-07-15T12:00:00Z"}
                }))
            with patch.object(TRACKER, "OUTPUT", output):
                TRACKER.write_season_index("20262027")
            index = json.loads((seasons / "index.json").read_text())
        self.assertEqual(index["current"], "20262027")
        self.assertEqual({row["season"] for row in index["seasons"]}, {"20252026", "20262027"})
        self.assertTrue(next(row for row in index["seasons"] if row["season"] == "20262027")["current"])

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

    def test_daily_history_stores_category_ranks(self):
        standings = [
            {"team": "BUF", "gp": 10, "points": 14, "gf": 35, "ga": 25, "gd": 10},
            {"team": "BOS", "gp": 10, "points": 12, "gf": 28, "ga": 27, "gd": 1},
        ]
        moneypuck = {"teams": [
            {"team": "BUF", "games": 10, "xgPct": .55, "corsiPct": .54, "hdFor": 60, "hdAgainst": 40,
                "xgf": 32, "xga": 24, "gf": 35, "ga": 25},
            {"team": "BOS", "games": 10, "xgPct": .49, "corsiPct": .50, "hdFor": 45, "hdAgainst": 55,
                "xgf": 29, "xga": 28, "gf": 28, "ga": 27},
        ], "simulations": []}
        special = [
            {"team": "BUF", "ppPct": 25, "pkPct": 82},
            {"team": "BOS", "ppPct": 20, "pkPct": 78},
        ]
        history = TRACKER.daily_history({}, standings, moneypuck, special)
        buffalo = next(row for row in history[-1]["teams"] if row["team"] == "BUF")
        self.assertEqual(buffalo["ranks"]["overall"], 1)
        self.assertEqual(buffalo["ranks"]["special"], 1)
        self.assertEqual(buffalo["ranks"]["defence"], 1)
        self.assertAlmostEqual(buffalo["specialIndex"], 7)

    def test_daily_history_does_not_rank_teams_before_games_are_played(self):
        standings = [
            {"team": "BUF", "gp": 0, "points": 0, "gf": 0, "ga": 0, "gd": 0},
            {"team": "BOS", "gp": 0, "points": 0, "gf": 0, "ga": 0, "gd": 0},
        ]
        previous = {
            "meta": {"season": TRACKER.SEASON},
            "history": [{"date": "2026-07-17", "teams": [
                {"team": "BUF", "gp": 0, "pointsPct": 0, "powerIndex": -22.5,
                    "ranks": {"overall": 1, "results": 1}},
            ]}],
        }
        self.assertEqual(TRACKER.daily_history(previous, standings, {"teams": []}, []), [])


if __name__ == "__main__":
    unittest.main()
