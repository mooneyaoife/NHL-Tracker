import unittest
from unittest.mock import patch

from scripts import update_tracker


def game(game_id, date, away, home):
    return {
        "id": game_id,
        "gameType": 2,
        "gameState": "FINAL",
        "gameDate": date,
        "awayTeam": {"abbrev": away},
        "homeTeam": {"abbrev": home},
    }


class PlayerPipelineTests(unittest.TestCase):
    def setUp(self):
        self.games = [
            game(1, "2025-10-01", "BUF", "CAR"),
            game(2, "2026-02-01", "NYR", "CAR"),
        ]
        self.official = {
            "skaters": [{
                "id": "10", "name": "Traded Skater", "position": "C", "shoots": "L",
                "teams": ["BUF", "NYR"],
                "totals": {"gp": 2, "goals": 1, "assists": 1, "points": 2, "shots": 4, "saves": 0},
            }, {
                "id": "11", "name": "Depth Defenceman", "position": "D", "shoots": "R",
                "teams": ["CAR"],
                "totals": {"gp": 0, "goals": 0, "assists": 0, "points": 0, "shots": 0, "saves": 0},
            }, {
                "id": "12", "name": "Dressed Skater", "position": "L", "shoots": "L",
                "teams": ["BUF"],
                "totals": {"gp": 0, "goals": 0, "assists": 0, "points": 0, "shots": 0, "saves": 0},
            }],
            "goalies": [{
                "id": "20", "name": "Starting Goalie", "position": "G", "shoots": "L",
                "teams": ["CAR"],
                "totals": {"gp": 2, "goals": 0, "assists": 0, "points": 0, "shots": 0, "saves": 50,
                    "starts": 2, "wins": 2, "losses": 0, "otl": 0, "shotsAgainst": 53,
                    "goalsAgainst": 3, "savePct": .9434, "shutouts": 0},
            }, {
                "id": "21", "name": "Backup Goalie", "position": "G", "shoots": "R",
                "teams": ["CAR"],
                "totals": {"gp": 0, "goals": 0, "assists": 0, "points": 0, "shots": 0, "saves": 0,
                    "starts": 0, "wins": 0, "losses": 0, "otl": 0, "shotsAgainst": 0,
                    "goalsAgainst": 0, "savePct": None, "shutouts": 0},
            }],
        }

    @staticmethod
    def boxscore(game_id):
        skater_team = "awayTeam"
        return {"playerByGameStats": {
            skater_team: {
                "forwards": [{
                    "playerId": 10, "name": {"default": "T. Skater"}, "position": "C",
                    "goals": 1 if game_id == 1 else 0, "assists": 0 if game_id == 1 else 1,
                    "points": 1, "sog": 2, "hits": 0, "toi": "15:00",
                }, {
                    "playerId": 12, "name": {"default": "D. Skater"}, "position": "L",
                    "goals": 0, "assists": 0, "points": 0, "sog": 0, "hits": 0, "toi": "00:00",
                }],
                "defense": [], "goalies": [],
            },
            "homeTeam": {
                "forwards": [], "defense": [],
                "goalies": [{
                    "playerId": 20, "name": {"default": "S. Goalie"}, "position": "G",
                    "saves": 25, "shotsAgainst": 27 if game_id == 1 else 26,
                    "savePctg": .93, "toi": "60:00", "starter": True,
                }, {
                    "playerId": 21, "name": {"default": "B. Goalie"}, "position": "G",
                    "saves": 0, "shotsAgainst": 0, "savePctg": 0, "toi": "00:00", "starter": False,
                }],
            },
        }}

    @patch.object(update_tracker, "boxscore", side_effect=boxscore.__func__)
    def test_league_wide_history_reconciles_trades_and_goalie_appearances(self, _):
        players = update_tracker.build_players(self.games, ["BUF", "CAR", "NYR"], self.official)

        traded = next(row for row in players["BUF"] if row["id"] == "10")
        self.assertEqual([row["team"] for row in traded["games"]], ["BUF", "NYR"])
        self.assertEqual(traded["totals"]["gp"], 2)
        self.assertEqual(traded["totals"]["points"], 2)
        self.assertTrue(any(row["id"] == "10" for row in players["NYR"]))

        starter = next(row for row in players["CAR"] if row["id"] == "20")
        backup = next(row for row in players["CAR"] if row["id"] == "21")
        self.assertEqual(len(starter["games"]), 2)
        self.assertEqual(starter["totals"]["gp"], 2)
        self.assertTrue(all(game["starter"] is True for game in starter["games"]))
        self.assertEqual(backup["games"], [])
        self.assertEqual(backup["totals"]["gp"], 0)
        dressed = next(row for row in players["BUF"] if row["id"] == "12")
        self.assertEqual(dressed["games"], [])
        self.assertEqual(dressed["totals"]["gp"], 0)

    @patch.object(update_tracker, "boxscore", side_effect=boxscore.__func__)
    def test_official_player_without_game_log_remains_available(self, _):
        players = update_tracker.build_players(self.games, ["BUF", "CAR", "NYR"], self.official)
        depth = next(row for row in players["CAR"] if row["id"] == "11")
        self.assertEqual(depth["name"], "Depth Defenceman")
        self.assertEqual(depth["games"], [])
        self.assertEqual(depth["totals"]["gp"], 0)

    def test_toi_parser_rejects_non_playing_goalies(self):
        self.assertEqual(update_tracker.toi_seconds("00:00"), 0)
        self.assertEqual(update_tracker.toi_seconds("59:41"), 3581)
        self.assertEqual(update_tracker.toi_seconds(None), 0)

    def test_coverage_reports_reconciliation_failures(self):
        official = {"skaters": [{"id": "10", "totals": {"gp": 2}}], "goalies": []}
        players = {"BUF": [{"id": "10", "games": [{"date": "2025-10-01"}]}]}
        coverage = update_tracker.player_data_coverage({}, players, official, {}, {})
        self.assertEqual(coverage["reconciledOfficialPlayers"], 0)
        self.assertEqual(coverage["officialReconciliationFailures"], 1)


if __name__ == "__main__":
    unittest.main()
