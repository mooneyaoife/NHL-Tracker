import json
import unittest
from pathlib import Path

from scripts.game_state import normalize_game_state


class GameStateContractTests(unittest.TestCase):
    def test_shared_state_and_date_fixtures(self):
        fixtures = json.loads((Path(__file__).parent / "fixtures" / "game_states.json").read_text())
        for fixture in fixtures:
            with self.subTest(fixture["name"]):
                result = normalize_game_state(fixture["game"])
                self.assertEqual(result["code"], fixture["code"])
                if fixture.get("label"):
                    self.assertEqual(result["label"], fixture["label"])
                if fixture.get("londonDate"):
                    self.assertEqual(result["londonDate"], fixture["londonDate"])
                if fixture["code"] in {"delayed", "postponed", "suspended"}:
                    self.assertFalse(result["completed"])


if __name__ == "__main__":
    unittest.main()
