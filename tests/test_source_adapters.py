import json
import unittest
import urllib.error

from scripts.source_adapters import SourceClient


class Response:
    def __init__(self, body): self.body = body
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self): return self.body


class SourceAdapterTests(unittest.TestCase):
    def test_json_sets_contract_headers_and_decodes_object(self):
        requests = []
        def opener(request, timeout):
            requests.append((request, timeout)); return Response(b'{"ok":true}')
        result = SourceClient(opener, lambda _: None).json("https://source.test/data")
        self.assertTrue(result["ok"])
        self.assertEqual(requests[0][0].get_header("Accept"), "application/json")
        self.assertEqual(requests[0][1], 30)

    def test_retry_is_bounded_and_uses_injected_sleep(self):
        attempts, sleeps = [], []
        def opener(_request, timeout):
            attempts.append(True)
            if len(attempts) < 3: raise urllib.error.URLError("temporary")
            return Response(b'{"ok":true}')
        self.assertTrue(SourceClient(opener, sleeps.append).json("https://source.test/data", attempts=3)["ok"])
        self.assertEqual(sleeps, [1, 2])

    def test_csv_rejects_html_and_accepts_a_table(self):
        bodies = iter([b"<html>blocked</html>", b"team,value\nBUF,1\n"])
        rows = SourceClient(lambda *_args, **_kwargs: Response(next(bodies)), lambda _: None).csv("https://source.test/data", attempts=2)
        self.assertEqual(rows, [{"team": "BUF", "value": "1"}])

    def test_json_requires_an_object_contract(self):
        client = SourceClient(lambda *_args, **_kwargs: Response(json.dumps([1]).encode()), lambda _: None)
        with self.assertRaisesRegex(RuntimeError, "must be an object"):
            client.json("https://source.test/data")


if __name__ == "__main__":
    unittest.main()
