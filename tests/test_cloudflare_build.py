import json
import tempfile
import unittest
from pathlib import Path

from scripts import build_cloudflare, verify_cloudflare_build


class CloudflareBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "site"
        self.source.mkdir()
        (self.source / "index.html").write_text(
            '<link rel="canonical" href="https://mooneyaoife.github.io/NHL-Tracker/">'
            '<meta property="og:url" content="https://mooneyaoife.github.io/NHL-Tracker/">',
            encoding="utf-8",
        )
        (self.source / "app.js").write_text("const base = 'https://mooneyaoife.github.io/NHL-Tracker/';", encoding="utf-8")
        (self.source / "manifest.webmanifest").write_text(
            json.dumps({"id": "/NHL-Tracker/", "start_url": "./", "scope": "./"}), encoding="utf-8"
        )
        (self.source / "robots.txt").write_text("User-agent: *\nAllow: /\n", encoding="utf-8")
        self.headers = self.root / "deployment" / "cloudflare-pages"
        self.headers.mkdir(parents=True)
        (self.headers / "_headers").write_text(
            "/*\n  X-Robots-Tag: noindex\n  X-Frame-Options: DENY\n  X-Content-Type-Options: nosniff\n",
            encoding="utf-8",
        )
        self.old_source = build_cloudflare.SOURCE
        self.old_root = build_cloudflare.ROOT
        build_cloudflare.SOURCE = self.source
        build_cloudflare.ROOT = self.root

    def tearDown(self):
        build_cloudflare.SOURCE = self.old_source
        build_cloudflare.ROOT = self.old_root
        self.temporary.cleanup()

    def test_private_root_artifact(self):
        output = self.root / "build"
        build_cloudflare.build(output, "https://nhl-tracker-private.pages.dev")
        self.assertEqual([], verify_cloudflare_build.failures_for(output, "https://nhl-tracker-private.pages.dev/"))
        self.assertNotIn(build_cloudflare.GITHUB_PAGES_URL, (output / "app.js").read_text(encoding="utf-8"))

    def test_rejects_insecure_or_credential_bearing_urls(self):
        for value in ("http://example.com", "https://example.com/?token=secret"):
            with self.assertRaises(ValueError):
                build_cloudflare.normalise_production_url(value)


if __name__ == "__main__":
    unittest.main()
