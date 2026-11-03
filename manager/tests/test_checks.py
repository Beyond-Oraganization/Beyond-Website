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

    def test_font_file_missing(self):
        (self.site / "fonts" / "archivo-black-400-latin.woff2").unlink()
        problems = self.problems()
        self.assertTrue(any("font file not found: fonts/archivo-black-400-latin.woff2" in p for p in problems))

    def test_font_without_font_face(self):
        css = self.site / "beyondia.css"
        css.write_text(css.read_text(encoding="utf-8").replace("font-family:'IBM Plex Mono';", "font-family:'Jost';"), encoding="utf-8")
        self.assertTrue(any("uses font 'IBM Plex Mono' but has no @font-face" in p for p in self.problems()))

    def test_a_page_may_not_ask_a_third_party_for_fonts(self):
        self.edit("plans.html", '<link rel="stylesheet" href="beyondia.css">',
                  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost"><link rel="stylesheet" href="beyondia.css">')
        self.assertTrue(any("asks a third party for fonts" in p and p.startswith("plans.html") for p in self.problems()))

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


class QualityTests(RealCopyCase):
    """What every page needs for search engines, sharing, keyboards and screen readers."""

    def test_missing_description(self):
        text = (self.site / "plans.html").read_text(encoding="utf-8")
        import re
        (self.site / "plans.html").write_text(re.sub(r'<meta name="description"[^>]*>\n', "", text), encoding="utf-8")
        self.assertIn("plans.html: has no meta description", self.problems())

    def test_overlong_description(self):
        import re
        text = (self.site / "plans.html").read_text(encoding="utf-8")
        (self.site / "plans.html").write_text(re.sub(r'(<meta name="description" content=")[^"]*', r"\g<1>" + "x" * 250, text), encoding="utf-8")
        self.assertTrue(any("plans.html: the meta description has 250 characters" in p for p in self.problems()))

    def test_missing_sharing_tags(self):
        self.edit("plans.html", 'property="og:title"', 'property="x:title"')
        self.assertIn("plans.html: has no og:title", self.problems())

    def test_missing_skip_link(self):
        self.edit("plans.html", '<a class="skip" href="#main">Skip to content</a>', "")
        self.assertTrue(any("plans.html: has no \"Skip to content\"" in p for p in self.problems()))

    def test_missing_main(self):
        self.edit("plans.html", '<main id="main" tabindex="-1">', "<div>")
        self.edit("plans.html", "</main>", "</div>")
        self.assertTrue(any("plans.html: must have exactly one <main" in p for p in self.problems()))

    def test_image_without_alt(self):
        self.edit("creator.html", ' alt="Portrait of Roman Patlai"', "")
        self.assertTrue(any("creator.html: image portrait.jpg has no alt text" in p for p in self.problems()))

    def test_image_without_size(self):
        self.edit("creator.html", ' width="640" height="640"', "")
        self.assertTrue(any("creator.html: image portrait.jpg has no width and height" in p for p in self.problems()))

    def test_alternative_image_format_must_exist(self):
        (self.site / "portrait.webp").unlink()
        self.assertTrue(any("file not found: portrait.webp" in p for p in self.problems()))

    def test_script_missing(self):
        (self.site / "beyondia.js").unlink()
        self.assertTrue(any("plans.html: file not found: beyondia.js" in p for p in self.problems()))

    def test_logo_symbol_must_exist(self):
        self.edit("plans.html", '<symbol id="bm-logo"', '<symbol id="other"')
        self.assertTrue(any('<use href="#bm-logo"> points to nothing' in p for p in self.problems()))

    def test_repeated_id(self):
        self.edit("plans.html", "</main>", '<i id="dup"></i><i id="dup"></i></main>')
        self.assertTrue(any("id used more than once: dup" in p for p in self.problems()))

    def test_required_files(self):
        for name in ("404.html", "robots.txt", "logo.svg", "search-index.js"):
            with self.subTest(name=name):
                path = self.site / name
                saved = path.read_bytes()
                path.unlink()
                self.assertTrue(any(p.startswith(f"{name}: file is missing") for p in self.problems()))
                path.write_bytes(saved)

    def test_sitemap_must_list_every_page(self):
        text = (self.site / "sitemap.xml").read_text(encoding="utf-8")
        line = [l for l in text.splitlines() if "treatise.html" in l][0]
        (self.site / "sitemap.xml").write_text(text.replace(line + "\n", ""), encoding="utf-8")
        self.assertTrue(any("sitemap.xml: does not list treatise.html" in p for p in self.problems()))

    def test_duplicate_titles_are_reported_only_when_strict(self):
        title = checks.parse_page(self.site / "plans.html").title
        self.edit("stories.html", "<title>" + checks.parse_page(self.site / "stories.html").title + "</title>", f"<title>{title}</title>")
        self.assertEqual(self.problems(), [])                                       # publishing is not blocked by it
        strict = checks.check_site(self.site, strict=True)
        self.assertTrue(any("share the same title" in p for p in strict))


class ContrastTests(unittest.TestCase):
    CSS = (SITE_DIR / "beyondia.css").read_text(encoding="utf-8")

    def test_known_ratios(self):
        self.assertAlmostEqual(checks.contrast_ratio("#000000", "#FFFFFF"), 21.0, places=1)
        self.assertAlmostEqual(checks.contrast_ratio("#FFFFFF", "#FFFFFF"), 1.0, places=2)

    def test_both_themes_pass(self):
        self.assertEqual(checks.check_contrast(self.CSS), [])

    def test_light_theme_uses_the_chosen_palette(self):
        tokens = checks.css_tokens(self.CSS)["light"]
        self.assertEqual(tokens["c-bg"], "#FCF5ED")        # cream
        self.assertEqual(tokens["d-bg"], "#F4BF96")        # peach
        self.assertEqual(tokens["band"], "#CE5A67")        # rose
        self.assertEqual(tokens["c-fg"], "#1F1717")        # ink

    def test_a_weak_colour_is_reported(self):
        weak = self.CSS.replace("--c-mute:#5A4646", "--c-mute:#E8D8C8")
        problems = checks.check_contrast(weak)
        self.assertTrue(any("light theme: muted text on a section" in p for p in problems))

    def test_missing_theme_is_reported(self):
        self.assertTrue(any("light theme's colour tokens are missing" in p for p in checks.check_contrast(":root{--c-fg:#000000}")))


class ParserTests(unittest.TestCase):
    def test_css_font_families(self):
        css = ":root { --f-d: 'Archivo Black', sans-serif; --f-t: \"IBM Plex Mono\", monospace; --x: 1; }"
        self.assertEqual(checks.css_font_families(css), ["Archivo Black", "IBM Plex Mono"])

    def test_css_font_faces(self):
        css = "@font-face{font-family:'Archivo Black';src:url(fonts/a.woff2) format('woff2')}@font-face{font-family:'Archivo Black';src:url(fonts/b.woff2)}"
        self.assertEqual(checks.css_font_faces(css), {"Archivo Black": ["fonts/a.woff2", "fonts/b.woff2"]})


if __name__ == "__main__":
    unittest.main()
