"""The site-wide features: sharing tags, search index, sitemap and feed, 404 and search pages, shared chrome."""

import json
import re
import unittest

from beyondia_manager import build as builder
from beyondia_manager import chrome, config as cfg, extras, render
from beyondia_manager.errors import ConfigError
from .helpers import SITE_DIR, TempDirCase, copy_real_site, sample

URL = "https://example.org/site/"


def unstamp(text):
    """Pages on disk carry ?v=<hash> on their asset links (added by the build after syncing)."""
    return re.sub(r"\?v=[0-9a-f]+", "", text)


def with_url():
    c = sample()
    c["site"]["url"] = URL
    return c


class SiteUrlConfigTests(unittest.TestCase):
    def problems(self, value):
        c = sample()
        c["site"]["url"] = value
        return [p for p in cfg.validate(c) if p.startswith("site.url")]

    def test_valid_addresses(self):
        for value in ("", "https://example.org/", "https://name.github.io/repo/", "http://localhost:8000/"):
            with self.subTest(value=value):
                self.assertEqual(self.problems(value), [])

    def test_invalid_addresses(self):
        for value in ("example.org/", "https://example.org", "ftp://example.org/", "https://u:p@example.org/",
                      "https://example.org/?x=1", "https://example.org/#top", "https://exa mple.org/", 5):
            with self.subTest(value=value):
                self.assertTrue(self.problems(value), value)

    def test_the_address_is_optional(self):
        self.assertEqual(cfg.validate(sample()), [])


class HeadTests(unittest.TestCase):
    def test_every_page_has_a_description_and_sharing_tags(self):
        html = render.render_home(sample())
        self.assertIn('<meta name="description" content="A lead sentence.">', html)
        self.assertIn('<meta property="og:title" content="Testland — home">', html)
        self.assertIn('<meta property="og:description" content="A lead sentence.">', html)

    def test_without_an_address_there_are_no_absolute_tags(self):
        html = render.render_home(sample())
        for absent in ("canonical", "og:url", "og:image", "feed.xml"):
            self.assertNotIn(absent, html)

    def test_with_an_address_the_absolute_tags_appear(self):
        html = render.render_home(with_url())
        self.assertIn(f'<link rel="canonical" href="{URL}">', html)
        self.assertIn(f'<meta property="og:image" content="{URL}og-image.png">', html)
        self.assertIn('<link rel="alternate" type="application/atom+xml"', html)
        github = render.render_github(with_url())
        self.assertIn(f'<link rel="canonical" href="{URL}github.html">', github)

    def test_stories_and_posts_are_articles_described_by_their_summary(self):
        c = with_url()
        story = render.render_story(c, c["stories"]["items"][0])
        self.assertIn('<meta property="og:type" content="article">', story)
        self.assertIn('<meta name="description" content="An angel summary.">', story)

    def test_a_long_description_is_cut_at_a_word(self):
        text = "word " * 100
        out = render.describe(text)
        self.assertLessEqual(len(out), render.DESCRIPTION_LIMIT)
        self.assertTrue(out.endswith("…"))
        self.assertNotIn("wor…", out)
        self.assertEqual(render.describe("  short \n text "), "short text")

    def test_text_cannot_break_out_of_the_tags(self):
        c = sample()
        c["home"]["lead"] = '"><script>alert(1)</script>'
        html = render.render_home(c)
        self.assertNotIn("<script>alert", html)
        self.assertIn("&quot;&gt;&lt;script&gt;", html)

    def test_head_loads_no_third_party(self):
        head = render.render_head(sample(), "T", "D", "index.html")
        self.assertNotIn("googleapis", head)
        self.assertNotIn("gstatic", head)
        self.assertIn('href="beyondia.css"', head)
        self.assertIn('src="beyondia.js" defer', head)

    def test_shared_header_and_footer(self):
        header = render.render_header("blog")
        self.assertIn('<a class="skip" href="#main">', header)
        self.assertIn('aria-controls="main-nav"', header)
        self.assertIn('class="icon-btn theme-toggle"', header)
        self.assertEqual(header.count('aria-current="page"'), 1)
        self.assertIn('<use href="#bm-logo">', header)
        footer = render.render_footer(with_url())
        self.assertIn('href="feed.xml"', footer)
        self.assertNotIn("feed.xml", render.render_footer(sample()))


class PagesTests(unittest.TestCase):
    def test_not_found_page(self):
        html = extras.render_not_found(with_url())
        self.assertIn(f'<base href="{URL}">', html)
        self.assertIn("<h1", html)
        self.assertEqual(html.count("<h1"), 1)
        self.assertNotIn("<base", extras.render_not_found(sample()))

    def test_search_page_loads_the_index_before_the_script(self):
        html = extras.render_search(sample())
        self.assertIn('id="search-form"', html)
        self.assertLess(html.index('src="search-index.js"'), html.index("</main>") + 200)
        self.assertLess(html.index('src="beyondia.js" defer'), html.index('src="search-index.js"'))   # deferred scripts run last

    def test_home_has_a_take_part_section(self):
        html = render.render_home(sample())
        self.assertIn('id="join-title"', html)
        self.assertIn('href="https://github.com/test-org"', html)
        self.assertNotIn(">Blog feed<", html)
        self.assertIn("Blog feed", render.render_home(with_url()))

    def test_blog_page_offers_the_feed_only_when_there_is_one(self):
        self.assertNotIn("feed.xml", render.render_blog(sample()).split("<main")[1])
        self.assertIn('href="feed.xml" class="download"', render.render_blog(with_url()))

    def test_stories_show_reading_time(self):
        c = sample()
        self.assertIn("1 min read", render.render_story(c, c["stories"]["items"][0]))
        self.assertIn("1 min read", render.render_stories(c))


class SiteFilesTests(unittest.TestCase):
    def test_robots_without_and_with_an_address(self):
        self.assertNotIn("Sitemap", extras.render_robots(sample()))
        self.assertIn(f"Sitemap: {URL}sitemap.xml", extras.render_robots(with_url()))
        self.assertIn("User-agent: *", extras.render_robots(sample()))

    def test_sitemap(self):
        names = ["index.html", "stories.html", "404.html", "search.html", "ideology.html"]
        xml = extras.render_sitemap(with_url(), names)
        locs = re.findall(r"<loc>([^<]*)</loc>", xml)
        self.assertEqual(locs, [URL, URL + "ideology.html", URL + "stories.html"])     # home first, tools left out

    def test_feed_lists_posts_newest_first(self):
        xml = extras.render_feed(with_url())
        self.assertLess(xml.index("Second"), xml.index("Hello"))
        self.assertIn(f"<id>{URL}blog-second.html</id>", xml)
        self.assertIn("<updated>2026-10-20T00:00:00Z</updated>", xml)
        self.assertIn('<category term="News"/>', xml)

    def test_feed_text_is_escaped(self):
        c = with_url()
        c["blog"]["items"][0]["title"] = "A & <b>"
        self.assertIn("A &amp; &lt;b&gt;", extras.render_feed(c))

    def test_feed_without_posts_is_still_valid(self):
        c = with_url()
        c["blog"]["items"] = []
        self.assertIn(f"<updated>{extras.EPOCH}</updated>", extras.render_feed(c))

    def test_files_depend_on_the_address(self):
        self.assertEqual(sorted(extras.render_site_files(sample(), ["index.html"])), ["robots.txt"])
        self.assertEqual(sorted(extras.render_site_files(with_url(), ["index.html"])), ["feed.xml", "robots.txt", "sitemap.xml"])


class SearchIndexTests(unittest.TestCase):
    PAGE = (
        '<html><head><title>T</title></head><body><header><nav aria-label="Main navigation">'
        '<a href="stories.html" class="on" aria-current="page">STORIES</a></nav></header>'
        '<main><nav class="crumbs">Home / Here</nav><h1>The Title</h1><p>First <b>bold</b> text.</p>'
        '<h2>A heading</h2><p>Second</p><svg><text>drawing</text></svg><script>var x = "code";</script></main>'
        '<footer>Footer words</footer></body></html>'
    )

    def test_entry(self):
        entry = extras.page_entry("a.html", self.PAGE)
        self.assertEqual(entry["title"], "The Title")
        self.assertEqual(entry["section"], "Stories")
        self.assertEqual(entry["headings"], ["A heading"])
        self.assertEqual(entry["text"], "The Title First bold text. A heading Second")

    def test_navigation_footer_and_code_are_left_out(self):
        text = extras.page_entry("a.html", self.PAGE)["text"]
        for absent in ("Footer", "Home /", "drawing", "code", "STORIES"):
            self.assertNotIn(absent, text)

    def test_index_is_a_script_with_valid_json_per_line(self):
        pages = {"b.html": self.PAGE, "a.html": self.PAGE, "404.html": self.PAGE, "search.html": self.PAGE, "x.css": "x"}
        script = extras.build_search_index(pages)
        self.assertTrue(script.startswith("/* Generated by the Beyondia site manager"))
        self.assertIn("window.BEYONDIA_INDEX=[", script)
        rows = [json.loads(line.rstrip(",")) for line in script.splitlines() if line.startswith("{")]
        self.assertEqual([r["url"] for r in rows], ["a.html", "b.html"])         # sorted, tools and non-pages excluded

    def test_index_is_deterministic_and_cannot_close_a_script(self):
        page = self.PAGE.replace("Second", "</script> and   line")
        script = extras.build_search_index({"a.html": page})
        self.assertEqual(script, extras.build_search_index({"a.html": page}))
        self.assertNotIn("</script>", script)
        self.assertNotIn(" ", script)

    def test_text_is_limited(self):
        page = self.PAGE.replace("Second", "word " * 20000)
        self.assertLessEqual(len(extras.page_entry("a.html", page)["text"]), extras.MAX_INDEXED_CHARS)


class ChromeSyncTests(TempDirCase):
    """Hand-written pages keep their content; the head, header and footer come from the templates."""

    def setUp(self):
        super().setUp()
        self.site = copy_real_site(self.tmp / "site")
        self.config = cfg.load(SITE_DIR / "site.config.json")

    def sync(self, name, text):
        synced = chrome.sync_page(self.config, name, text)
        return None if synced is None else unstamp(synced)

    def test_sync_is_idempotent(self):
        for name in ("ideology.html", "treatise.html", "creator.html"):
            with self.subTest(name=name):
                text = (self.site / name).read_text(encoding="utf-8")
                once = self.sync(name, text)
                self.assertEqual(self.sync(name, once), once)

    def test_the_real_hand_written_pages_are_in_step(self):
        for name in ("community.html", "conclusions.html", "creator.html", "ideology.html", "principles.html",
                     "rules.html", "techbot.html", "technologies.html", "techsales.html", "treatise.html"):
            with self.subTest(name=name):
                text = unstamp((self.site / name).read_text(encoding="utf-8"))
                self.assertEqual(self.sync(name, text), text)

    def test_content_is_untouched(self):
        text = (self.site / "rules.html").read_text(encoding="utf-8")
        body = re.search(r'<main[^>]*>\s*(.*?)\s*</main>', text, re.S).group(1)
        marked = text.replace("</section>", "<!-- my note --></section>", 1)
        new = self.sync("rules.html", marked)
        self.assertIn("<!-- my note -->", new)
        self.assertEqual(re.search(r'<main[^>]*>\s*(.*?)\s*</main>', new, re.S).group(1), body.replace("</section>", "<!-- my note --></section>", 1))

    def test_navigation_change_reaches_every_page(self):
        text = unstamp((self.site / "rules.html").read_text(encoding="utf-8"))
        old = text.replace('<li><a href="blog.html" class="">BLOG</a></li>', "")
        self.assertNotEqual(old, text)
        self.assertEqual(self.sync("rules.html", old), text)

    def test_current_page_and_title_and_description_are_kept(self):
        text = (self.site / "rules.html").read_text(encoding="utf-8")
        new = self.sync("rules.html", text.replace("Beyondia — The rules", "Beyondia — Other rules"))
        self.assertIn("<title>Beyondia — Other rules</title>", new)
        self.assertEqual(re.findall(r'class="on" aria-current="page">([A-Z]+)<', new), ["IDEOLOGY"])

    def test_a_missing_description_comes_from_the_lead(self):
        text = unstamp((self.site / "creator.html").read_text(encoding="utf-8"))
        stripped = re.sub(r'<meta name="description"[^>]*>\n', "", text)
        self.assertEqual(self.sync("creator.html", stripped), text)

    def test_a_page_of_another_shape_is_left_alone(self):
        text = (self.site / "rules.html").read_text(encoding="utf-8")
        self.assertIsNone(self.sync("rules.html", text + "<!-- after the end -->"))
        self.assertIsNone(self.sync("rules.html", "<html><body>no header</body></html>"))

    def test_generated_pages_are_not_hand_written(self):
        self.assertFalse(chrome.is_handwritten((self.site / "index.html").read_text(encoding="utf-8")))
        self.assertTrue(chrome.is_handwritten((self.site / "rules.html").read_text(encoding="utf-8")))
        self.assertNotIn(render.GENERATED_MARK, render.SYNCED_NOTE)

    def test_build_rewrites_a_stale_hand_written_page_and_check_notices(self):
        config = cfg.load(self.site / "site.config.json")
        page = self.site / "rules.html"
        text = page.read_text(encoding="utf-8")
        page.write_text(text.replace('<a class="skip" href="#main">Skip to content</a>', ""), encoding="utf-8")
        self.assertEqual(builder.build(self.site, config, check=True).changed, ["rules.html"])
        builder.build(self.site, config)
        self.assertEqual(page.read_text(encoding="utf-8"), text)

    def test_build_covers_the_whole_site(self):
        config = cfg.load(self.site / "site.config.json")
        self.assertEqual(builder.build(self.site, config, check=True).changed, [])
        names = builder.synced_page_names(self.site, config)
        self.assertIn("treatise.html", names)
        self.assertNotIn("index.html", names)


class AssetVersionTests(TempDirCase):
    """New pages must never be shown with an old cached stylesheet or script."""

    def test_stamp_adds_and_replaces_versions(self):
        html = '<link rel="stylesheet" href="beyondia.css"><script src="beyondia.js?v=0123456789" defer></script>'
        out = builder.stamp_assets(html, {"beyondia.css": "aaaaaaaaaa", "beyondia.js": "bbbbbbbbbb"})
        self.assertEqual(out, '<link rel="stylesheet" href="beyondia.css?v=aaaaaaaaaa"><script src="beyondia.js?v=bbbbbbbbbb" defer></script>')
        self.assertEqual(builder.stamp_assets(out, {"beyondia.css": "aaaaaaaaaa", "beyondia.js": "bbbbbbbbbb"}), out)

    def test_a_stylesheet_change_makes_every_page_stale(self):
        site = copy_real_site(self.tmp / "site")
        config = cfg.load(site / "site.config.json")
        css = site / "beyondia.css"
        css.write_text(css.read_text(encoding="utf-8") + "\n/* changed */\n", encoding="utf-8")
        stale = builder.build(site, config, check=True).changed
        self.assertIn("index.html", stale)
        self.assertIn("treatise.html", stale)
        builder.build(site, config)
        version = builder.asset_version(css.read_bytes())
        self.assertIn(f'href="beyondia.css?v={version}"', (site / "treatise.html").read_text(encoding="utf-8"))

    def test_the_real_pages_link_the_current_versions(self):
        for name in ("beyondia.css", "beyondia.js", "search-index.js"):
            version = builder.asset_version((SITE_DIR / name).read_bytes())
            page = "search.html" if name == "search-index.js" else "index.html"
            self.assertIn(f"{name}?v={version}", (SITE_DIR / page).read_text(encoding="utf-8"), name)

    def test_icons_have_a_size_without_css(self):
        header = render.render_header()
        for svg in re.findall(r"<svg[^>]*>", header):
            if "use" in svg or 'width="0"' in svg:
                continue
            self.assertRegex(svg, r'width="\d+" height="\d+"')


class RealSiteFeatureTests(unittest.TestCase):
    def test_the_light_theme_toggle_script_and_styles_exist(self):
        css = (SITE_DIR / "beyondia.css").read_text(encoding="utf-8")
        js = (SITE_DIR / "beyondia.js").read_text(encoding="utf-8")
        self.assertIn(':root[data-theme="light"]', css)
        self.assertIn("@media print", css)
        self.assertIn("beyondia-theme", js)

    def test_the_search_index_covers_the_hand_written_pages(self):
        script = (SITE_DIR / "search-index.js").read_text(encoding="utf-8")
        for name in ("treatise.html", "rules.html", "storyants.html", "index.html"):
            self.assertIn(f'"url":"{name}"', script)

    def test_titles_and_descriptions_are_unique(self):
        from beyondia_manager import checks
        self.assertEqual([p for p in checks.check_site(SITE_DIR, strict=True) if "share the same" in p], [])

    def test_fonts_are_self_hosted_and_small(self):
        files = list((SITE_DIR / "fonts").glob("*.woff2"))
        self.assertGreaterEqual(len(files), 8)
        self.assertLess(sum(f.stat().st_size for f in files), 400 * 1024)

    def test_the_treatise_offers_a_pdf(self):
        self.assertIn('href="treatise.pdf"', (SITE_DIR / "treatise.html").read_text(encoding="utf-8"))
        self.assertTrue((SITE_DIR / "treatise.pdf").read_bytes().startswith(b"%PDF"))


class ApplicationFormTests(unittest.TestCase):
    """The form on the community page opens an email to Beyondia (no server, no outside service), and the
    page and its script (beyondia.js) agree on the fields and their limits."""

    FIELDS = ["name", "email", "phone", "message"]
    ADDRESS = "beyondia.official@gmail.com"

    @classmethod
    def setUpClass(cls):
        page = (SITE_DIR / "community.html").read_text(encoding="utf-8")
        cls.form = re.search(r'<form id="apply-form"[^>]*>.*?</form>', page, re.S).group(0)
        cls.script = (SITE_DIR / "beyondia.js").read_text(encoding="utf-8")

    def test_it_opens_an_email_to_beyondia(self):
        self.assertRegex(self.form, rf'action="mailto:{re.escape(self.ADDRESS)}\?subject=[^"]+" method="post" enctype="text/plain"')

    def test_every_address_on_the_page_is_the_same(self):
        page = (SITE_DIR / "community.html").read_text(encoding="utf-8")
        addresses = re.findall(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", page)    # in links and in the text alike
        self.assertGreaterEqual(len(addresses), 6)
        self.assertEqual(set(addresses), {self.ADDRESS})

    def test_without_script_a_plain_email_link_takes_the_place_of_the_form(self):
        page = (SITE_DIR / "community.html").read_text(encoding="utf-8")
        noscript = re.search(r"<noscript>(.*?)</noscript>", page, re.S).group(1)
        self.assertIn(f'href="mailto:{self.ADDRESS}?subject=', noscript)
        css = (SITE_DIR / "beyondia.css").read_text(encoding="utf-8")
        self.assertIn("html:not(.js) .apply{display:none}", css)

    def test_every_field_is_labelled_required_and_known_to_the_script(self):
        fields = json.loads(re.search(r"var FIELDS = (\[[^\]]*\]);", self.script).group(1))
        self.assertEqual(fields, self.FIELDS)
        for name in self.FIELDS:
            control = re.search(rf'<(?:input|textarea) id="apply-{name}" name="{name}"[^>]*>', self.form)
            self.assertIsNotNone(control, name)
            self.assertIn(" required", control.group(0), name)
            self.assertIn(f'<label for="apply-{name}">', self.form, name)
        self.assertEqual(re.findall(r' name="([^"]+)"', self.form), self.FIELDS)   # nothing else goes into the email

    def test_the_length_limits_match(self):
        found = re.search(r"var LIMITS = \{([^}]*)\};", self.script).group(1)
        limits = {key: int(value) for key, value in re.findall(r"(\w+): (\d+)", found)}
        self.assertEqual(sorted(limits), sorted(self.FIELDS))
        for name in self.FIELDS:
            control = re.search(rf'id="apply-{name}"[^>]*>', self.form).group(0)
            self.assertIn(f'maxlength="{limits[name]}"', control, name)

if __name__ == "__main__":
    unittest.main()
