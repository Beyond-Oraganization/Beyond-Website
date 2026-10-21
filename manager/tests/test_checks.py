import unittest

from beyondia_manager import checks
from .helpers import SITE_DIR, TempDirCase, copy_real_site


class RealCopyCase(TempDirCase):
    def setUp(self):
        super().setUp()
        self.site = copy_real_site(self.tmp / "site")

    def edit(self, name, old, new, count=1):
        path = self.site / name
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text, f"test setup: {old!r} not in {name}")
        path.write_text(text.replace(old, new, count), encoding="utf-8")

    def problems(self):
        return checks.check_site(self.site)


class HealthyTests(RealCopyCase):
    def test_the_real_site_is_healthy(self):
        self.assertEqual(self.problems(), [])


class DetectionTests(RealCopyCase):
    """Each test breaks one thing and expects exactly that to be reported."""

    def test_broken_link(self):
        self.edit("plans.html", 'href="community.html"', 'href="nowhere.html"')
        self.assertTrue(any("broken link: nowhere.html" in p for p in self.problems()))

    def test_missing_anchor(self):
        self.edit("plans.html", "</body>", '<a href="ideology.html#no-such-anchor">x</a></body>')
        self.assertTrue(any("anchor #no-such-anchor" in p for p in self.problems()))

    def test_existing_anchor_is_fine(self):
        ids = checks.parse_page(self.site / "ideology.html").ids
        self.assertTrue(ids, "test setup: ideology.html should have ids")
        self.edit("plans.html", "</body>", f'<a href="ideology.html#{sorted(ids)[0]}">x</a></body>')
        self.assertEqual(self.problems(), [])

    def test_navigation_missing_an_item(self):
        self.edit("plans.html", '<li><a href="github.html" class="">GITHUB</a></li>', "")
        self.assertTrue(any("differs from the site navigation" in p and p.startswith("plans.html") for p in self.problems()))

    def test_footer_navigation_missing_an_item(self):
        self.edit("plans.html", '<li><a href="github.html">GITHUB</a></li>', "")
        self.assertTrue(any("Footer navigation" in p for p in self.problems()))

    def test_stylesheet_missing(self):
        (self.site / "beyondia.css").unlink()
        problems = self.problems()
        self.assertTrue(any("beyondia.css: file is missing" in p for p in problems))
        self.assertTrue(any("file not found: beyondia.css" in p for p in problems))

    def test_font_not_loaded(self):
        self.edit("plans.html", "Archivo+Black", "Jost")
        self.assertTrue(any("'Archivo Black'" in p and p.startswith("plans.html") for p in self.problems()))

    def test_no_fonts_link(self):
        text = (self.site / "plans.html").read_text(encoding="utf-8")
        start = text.index("fonts.googleapis.com")
        a, b = text.rfind("<link", 0, start), text.index(">", start) + 1
        (self.site / "plans.html").write_text(text[:a] + text[b:], encoding="utf-8")
        self.assertTrue(any("no Google Fonts link" in p for p in self.problems()))

    def test_two_h1(self):
        self.edit("plans.html", "<h1", "<h1>x</h1><h1", count=1)
        self.assertTrue(any("exactly one <h1>" in p for p in self.problems()))

    def test_missing_title(self):
        text = (self.site / "plans.html").read_text(encoding="utf-8")
        import re
        (self.site / "plans.html").write_text(re.sub(r"<title>.*?</title>", "", text, flags=re.S), encoding="utf-8")
        self.assertTrue(any("no <title>" in p for p in self.problems()))

    def test_missing_image(self):
        (self.site / "portrait.jpg").unlink()
        self.assertTrue(any("portrait.jpg" in p for p in self.problems()))

    def test_unsupported_scheme_link(self):
        self.edit("plans.html", 'href="community.html"', 'href="javascript:alert(1)"')
        self.assertTrue(any("unsupported link scheme" in p for p in self.problems()))

    def test_empty_folder(self):
        empty = self.tmp / "empty"
        empty.mkdir()
        self.assertEqual(len(checks.check_site(empty)), 1)


class ParserTests(unittest.TestCase):
    def test_css_font_families(self):
        css = ":root { --f-d: 'Archivo Black', sans-serif; --f-t: \"IBM Plex Mono\", monospace; --x: 1; }"
        self.assertEqual(checks.css_font_families(css), ["Archivo Black", "IBM Plex Mono"])

    def test_google_font_families(self):
        href = "https://fonts.googleapis.com/css2?family=Archivo+Black&family=IBM+Plex+Mono:wght@400;500&display=swap"
        self.assertEqual(checks.google_font_families(href), ["Archivo Black", "IBM Plex Mono"])


if __name__ == "__main__":
    unittest.main()
