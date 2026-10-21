import re
import unittest
from html.parser import HTMLParser

from beyondia_manager import render
from beyondia_manager.errors import ManagerError
from .helpers import sample, tile

HOSTILE = '<script>alert(1)</script> "quote" \'single\' & {{title}} {count}'


class Tags(HTMLParser):
    """Records tag names, so tests can assert that no foreign tag appeared."""
    def __init__(self):
        super().__init__()
        self.tags = []
        self.attrs = []
    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        self.attrs.extend(attrs)


def tags_of(html):
    parser = Tags()
    parser.feed(html)
    return parser


class HelperTests(unittest.TestCase):
    def test_escape(self):
        self.assertEqual(render.esc('<a href="x">&\'</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&#x27;&lt;/a&gt;")

    def test_number_word(self):
        self.assertEqual(render.number_word(7), "Seven")
        self.assertEqual(render.number_word(20), "Twenty")
        self.assertEqual(render.number_word(21), "21")

    def test_fill_replaces_in_one_pass(self):
        self.assertEqual(render.fill("a {{x}} b {{y}}", {"x": "{{y}}", "y": "Y"}, "t"), "a {{y}} b Y")

    def test_fill_detects_drift_between_template_and_code(self):
        with self.assertRaises(ManagerError):
            render.fill("{{x}} {{missing}}", {"x": "1"}, "t")
        with self.assertRaises(ManagerError):
            render.fill("{{x}}", {"x": "1", "extra": "2"}, "t")

    def test_link_attrs(self):
        self.assertEqual(render.link_attrs("plans.html"), 'href="plans.html"')
        self.assertEqual(render.link_attrs("https://x.com/?a=1&b=2"),
                         'href="https://x.com/?a=1&amp;b=2" target="_blank" rel="noopener"')

    def test_safe_url_is_a_second_line_of_defence(self):
        with self.assertRaises(ManagerError):
            render.safe_url("javascript:alert(1)")


class HomeTests(unittest.TestCase):
    def test_contains_the_content(self):
        html = render.render_home(sample())
        for text in ("Testland", "A test country", "A lead sentence.", "Alpha title", "Beta text.", "Rooms: a", "Two doors."):
            self.assertIn(text, html)

    def test_no_placeholders_left(self):
        self.assertIsNone(re.search(r"\{\{\w+\}\}", render.render_home(sample())))

    def test_count_follows_visible_tiles(self):
        c = sample()
        c["home"]["map"]["tiles"].append(tile())
        self.assertIn("Three doors.", render.render_home(c))
        c["home"]["map"]["tiles"][2]["visible"] = False
        self.assertIn("Two doors.", render.render_home(c))

    def test_hidden_tile_is_not_rendered(self):
        c = sample()
        c["home"]["map"]["tiles"][1]["visible"] = False
        html = render.render_home(c)
        self.assertNotIn("Beta title", html)
        self.assertIn("Alpha title", html)

    def test_tile_without_kids_has_no_kids_line(self):
        html = render.render_home(sample())
        self.assertEqual(html.count('class="kids"'), 1)

    def test_external_links_open_safely(self):
        c = sample()
        c["home"]["buttons"][0]["href"] = "https://example.com/x"
        html = render.render_home(c)
        self.assertIn('href="https://example.com/x" target="_blank" rel="noopener"', html)

    def test_tile_order_follows_config(self):
        c = sample()
        c["home"]["map"]["tiles"].reverse()
        html = render.render_home(c)
        self.assertLess(html.index("Beta title"), html.index("Alpha title"))

    def test_hostile_text_is_inert(self):
        c = sample()
        h = c["home"]
        h["kicker"] = h["title"] = h["lead"] = HOSTILE
        h["ticker"] = [HOSTILE]
        h["buttons"][0]["label"] = HOSTILE
        h["map"]["intro"] = HOSTILE
        t = h["map"]["tiles"][0]
        t.update(label=HOSTILE, title=HOSTILE, text=HOSTILE, kids=HOSTILE)
        html = render.render_home(c)
        self.assertNotIn("<script>alert", html)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)
        self.assertIn("{{title}}", html)                  # shown as text, not expanded
        self.assertEqual(tags_of(html).tags.count("script"), 0)

    def test_deterministic(self):
        self.assertEqual(render.render_home(sample()), render.render_home(sample()))

    def test_page_structure(self):
        parsed = tags_of(render.render_home(sample()))
        self.assertEqual(parsed.tags.count("h1"), 1)
        self.assertEqual(parsed.tags.count("title"), 1)


class GithubTests(unittest.TestCase):
    def test_contains_the_content(self):
        html = render.render_github(sample())
        for text in ("Code.", "First repo.", "Python", "https://github.com/test-org/one", "techsales.html", "github.com/test-org"):
            self.assertIn(text, html)
        self.assertIn("Testland — GitHub", html)

    def test_no_placeholders_left(self):
        self.assertIsNone(re.search(r"\{\{\w+\}\}", render.render_github(sample())))

    def test_repo_without_page_has_no_details_link(self):
        c = sample()
        del c["github"]["repos"][0]["page"]
        self.assertNotIn("Details", render.render_github(c))

    def test_hidden_repo_not_rendered_and_empty_state(self):
        c = sample()
        c["github"]["repos"][0]["visible"] = False
        html = render.render_github(c)
        self.assertNotIn("First repo.", html)
        self.assertIn("No repositories are listed yet.", html)

    def test_current_page_is_marked_in_navigation(self):
        html = render.render_github(sample())
        self.assertIn('<a href="github.html" class="on">GITHUB</a>', html)
        self.assertEqual(html.count('class="on"'), 1)

    def test_hostile_text_is_inert(self):
        c = sample()
        r = c["github"]["repos"][0]
        c["github"]["title"] = c["github"]["lead"] = r["name"] = r["description"] = HOSTILE
        r["stack"] = [HOSTILE]
        html = render.render_github(c)
        self.assertNotIn("<script>alert", html)
        self.assertEqual(tags_of(html).tags.count("script"), 0)

    def test_quote_in_url_cannot_break_out_of_the_attribute(self):
        c = sample()
        c["github"]["repos"][0]["url"] = 'https://x.com/"onmouseover="alert(1)'
        html = render.render_github(c)
        self.assertNotIn('"onmouseover', html)
        self.assertIn("&quot;onmouseover", html)
        self.assertNotIn("onmouseover", dict(tags_of(html).attrs))

    def test_unsafe_scheme_is_refused_even_if_validation_was_skipped(self):
        c = sample()
        c["github"]["repos"][0]["url"] = "javascript:alert(1)"
        with self.assertRaises(ManagerError):
            render.render_github(c)

    def test_deterministic(self):
        self.assertEqual(render.render_github(sample()), render.render_github(sample()))


if __name__ == "__main__":
    unittest.main()
