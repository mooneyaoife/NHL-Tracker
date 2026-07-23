import unittest

from scripts.validate_mail_feed import failures_for


class MailFeedValidationTests(unittest.TestCase):
    def test_accepts_metadata_only_feed(self):
        feed = {"schema": 1, "updatedAt": "2026-07-21T12:00:00Z", "items": [{
            "id": "abc", "title": "A signing", "category": "Contract",
            "publishedAt": "2026-07-21T11:00:00Z", "url": "https://puckpedia.com/signing/1",
        }]}
        self.assertEqual([], failures_for(feed))

    def test_rejects_private_content_and_duplicate_ids(self):
        feed = {"schema": 1, "updatedAt": "2026-07-21T12:00:00Z", "items": [
            {"id": "abc", "title": "One", "category": "Contract", "publishedAt": "bad",
             "url": "https://example.com/1", "body": "private"},
            {"id": "abc", "title": "Two", "category": "Contract",
             "publishedAt": "2026-07-21T11:00:00Z", "url": "https://puckpedia.com/signing/2"},
        ]}
        failures = "\n".join(failures_for(feed))
        self.assertIn("private mail fields", failures)
        self.assertIn("duplicates", failures)
        self.assertIn("PuckPedia URL", failures)


if __name__ == "__main__":
    unittest.main()
