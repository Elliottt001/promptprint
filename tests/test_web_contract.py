import json
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
REQUIRED_IDS = {
    "share-preview", "share-dialog", "share-kind", "share-size", "share-form", "share-export",
    "recap-kind", "recap-anchor", "recap-view-cloud", "compare-apply", "compare-a-start", "compare-b-end", "heatmap-grid",
    "mode-toggle",
    "source-filters",
    "word-limit",
    "word-search",
    "export-png",
    "word-cloud",
    "detail-panel",
    "period-kind", "period-anchor", "period-prev", "period-next", "period-summary", "source-cloud",
}


class IdParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.labels = []
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if "id" in values:
            self.ids.add(values["id"])
        if "aria-label" in values:
            self.labels.append(values["aria-label"])
        if tag == "script":
            self.scripts.append(values)


class WebContractTests(unittest.TestCase):
    def setUp(self):
        parser = IdParser()
        parser.feed((WEB / "index.html").read_text(encoding="utf-8"))
        self.parser = parser

    def test_page_exposes_required_controls(self):
        self.assertTrue(REQUIRED_IDS <= self.parser.ids)
        self.assertTrue(any(script.get("type") == "module" for script in self.parser.scripts))
        self.assertGreaterEqual(len(self.parser.labels), 4)

    def test_removed_sections_are_absent(self):
        self.assertTrue({"settings-panel", "product-section", "share-panel", "hide-word"}.isdisjoint(self.parser.ids))

    def test_styles_support_reduced_motion_and_focus(self):
        css = (WEB / "styles.css").read_text(encoding="utf-8")

        self.assertIn("prefers-reduced-motion", css)
        self.assertIn(":focus-visible", css)
        self.assertIn("@media", css)

    def test_frontend_modules_are_local_and_packaged(self):
        for script in WEB.glob('*.*'):
            if script.suffix not in ('.js', '.mjs'):
                continue
            for module in re.findall(r"from ['\"](\./[^'\"]+)['\"]", script.read_text()):
                self.assertTrue((script.parent / module).is_file(), module)
        html = (WEB / 'index.html').read_text()
        self.assertNotIn('<iframe', html)
        self.assertNotIn('https://cdn', html)

    def test_placeholder_data_matches_schema(self):
        payload = json.loads((WEB / "data.json").read_text(encoding="utf-8"))

        self.assertEqual(set(payload), {"meta", "sources", "modes", "stopwords", "buckets"})
        self.assertEqual(payload["meta"]["uniqueMessages"], 0)
        self.assertEqual(payload["buckets"], [])
        self.assertIn("raw", payload["modes"])
        self.assertIn("refined", payload["modes"])


if __name__ == "__main__":
    unittest.main()
