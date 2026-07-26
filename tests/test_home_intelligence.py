import copy
import unittest

from scripts.home_intelligence import build_home_intelligence, game_signals


def game(game_id=1, team="AAA", opponent="BBB", *, location="Away", finished=False, schedule=None, start="2026-10-02T00:00:00Z"):
    return {
        "id": game_id, "date": "2026-10-01", "londonDate": "2026-10-02",
        "startTimeUTC": start, "state": "FINAL" if finished else "FUT",
        "status": "final" if finished else "scheduled", "statusLabel": "Final" if finished else "Scheduled",
        "scheduleState": "OK", "team": team, "opponent": opponent, "location": location,
        "finished": finished, "gf": 3 if finished else None, "ga": 2 if finished else None,
        "type": "Regular Season", "schedule": schedule or {},
    }


def tracker(rows):
    return {
        "meta": {"season": "20262027", "updatedAt": "2026-07-26T12:00:00+00:00"},
        "games": rows,
        "scheduleDifficulty": {"sourceSeason": "20252026"},
        "rosterChangeHistory": [],
        "scheduleRelease": {"season": "20262027", "complete": True, "recentChanges": []},
    }


class HomeIntelligenceTests(unittest.TestCase):
    def test_deduplicates_team_rows_and_emits_exact_game(self):
        evidence = {"opponentPointsPct": 62.5, "venue": "Test Arena", "burden": 48.2}
        rows = [game(schedule=evidence), game(team="BBB", opponent="AAA", location="Home", schedule={"opponentPointsPct": 50.0})]
        result = build_home_intelligence(tracker(rows))
        self.assertEqual(list(result["watchNext"]["teamBriefs"]), ["AAA", "BBB"])
        self.assertEqual(result["watchNext"]["teamBriefs"]["AAA"]["id"], "1")
        self.assertEqual(result["watchNext"]["teamBriefs"]["AAA"]["opponent"], "BBB")
        self.assertEqual(result["watchNext"]["sourceSeason"], "20252026")

    def test_prioritises_congestion_and_keeps_missing_values_missing(self):
        evidence = {"backToBack": True, "fourInSix": True, "travelKm": 1700, "restDifferential": -1}
        signals = game_signals({"away": "AAA", "home": "BBB", "schedule": {"AAA": evidence}}, "AAA", "20252026")
        self.assertEqual([row["value"] for row in signals], ["Back-to-back", "Four in six", "1-day deficit"])
        self.assertNotIn("Opponent baseline", [row["label"] for row in signals])

    def test_first_game_zero_rest_is_not_called_a_deficit(self):
        evidence = {"restDays": 0, "opponentRestDays": 0, "restDifferential": 0, "opponentPointsPct": 55.0}
        signals = game_signals({"away": "AAA", "home": "BBB", "schedule": {"AAA": evidence}}, "AAA", "20252026")
        self.assertNotIn("Rest", [row["label"] for row in signals])

    def test_archived_finished_schedule_has_truthful_empty_watch_next(self):
        rows = [game(finished=True), game(team="BBB", opponent="AAA", location="Home", finished=True)]
        result = build_home_intelligence(tracker(rows))
        self.assertEqual(result["watchNext"]["teamBriefs"], {})
        self.assertEqual(result["watchNext"]["leagueBriefs"], [])
        self.assertIn("1", result["continuity"]["finished"])

    def test_exception_state_remains_available_and_is_labelled(self):
        row = game()
        row.update({"status": "postponed", "statusLabel": "Postponed", "scheduleState": "POSTPONED"})
        other = game(team="BBB", opponent="AAA", location="Home")
        other.update({"status": "postponed", "statusLabel": "Postponed", "scheduleState": "POSTPONED"})
        result = build_home_intelligence(tracker([row, other]))
        self.assertEqual(result["watchNext"]["teamBriefs"]["AAA"]["status"], "exception")
        self.assertEqual(result["watchNext"]["teamBriefs"]["AAA"]["statusLabel"], "Postponed")

    def test_live_state_and_final_scores_survive_compaction(self):
        live = game()
        live.update({"state": "LIVE", "status": "live", "statusLabel": "2nd · 08:14"})
        live_other = game(team="BBB", opponent="AAA", location="Home")
        live_other.update({"state": "LIVE", "status": "live", "statusLabel": "2nd · 08:14"})
        result = build_home_intelligence(tracker([live, live_other]))
        self.assertEqual(result["watchNext"]["teamBriefs"]["AAA"]["status"], "live")
        final_rows = [game(2, finished=True), game(2, team="BBB", opponent="AAA", location="Home", finished=True)]
        final_rows[1].update({"gf": 2, "ga": 3})
        final = build_home_intelligence(tracker(final_rows))["continuity"]["finished"]["2"]
        self.assertEqual((final["awayScore"], final["homeScore"]), (3, 2))

    def test_output_is_deterministic_and_continuity_is_bounded(self):
        rows = []
        for index in range(80):
            rows.extend([
                game(index + 1, start=f"2026-10-{(index % 28) + 1:02d}T00:00:00Z"),
                game(index + 1, team="BBB", opponent="AAA", location="Home", start=f"2026-10-{(index % 28) + 1:02d}T00:00:00Z"),
            ])
        source = tracker(rows)
        self.assertEqual(build_home_intelligence(source), build_home_intelligence(copy.deepcopy(source)))
        self.assertLessEqual(len(build_home_intelligence(source)["continuity"]["upcoming"]), 4)


if __name__ == "__main__":
    unittest.main()
