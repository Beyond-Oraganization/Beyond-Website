"""Blog: validation, edits, rendering (dates, links, order, pager), and post pages coming and going."""

import copy
import re
import unittest

from beyondia_manager import build as builder
from beyondia_manager import config as cfg
from beyondia_manager import model, render
from beyondia_manager.errors import EditError
from .helpers import TempDirCase, sample
from .test_render import tags_of

HOSTILE = '<script>alert(1)</script> "quote" & {{title}}'
NEW = dict(id="third", title="A third post", date="2026-10-10", summary="Third summary.", body_text="Third body.\n\nMore.", tags=["Ideas"])


def ids(c):
    return [p["id"] for p in c["blog"]["items"]]


def problems_for(mutate):
    data = sample()
    mutate(data)
    return cfg.validate(data)


class ValidationTests(unittest.TestCase):
    def test_sample_is_valid(self):
        self.assertEqual(cfg.validate(sample()), [])

    def test_section_required(self):
        data = sample()
        del data["blog"]
        self.assertTrue(any("blog" in p for p in cfg.validate(data)))

    def test_dates_must_be_real_calendar_dates(self):
        for bad in ("2026-02-30", "2026-13-01", "26-10-23", "2026/10/23", "2026-1-1", "", None, 20261023, "today", "2026-10-23T10:00"):
            with self.subTest(date=bad):
                problems = problems_for(lambda d: d["blog"]["items"][0].update(date=bad))
                self.assertTrue(any(".date" in p for p in problems), problems)
        self.assertEqual(problems_for(lambda d: d["blog"]["items"][0].update(date="2028-02-29")), [])      # a leap day

    def test_file_names_are_confined_to_post_pages(self):
        for bad in ("blog.html", "index.html", "stories.html", "storyangel.html", "plans.html", "blog-.html", "blog--a.html", "Blog-a.html",
                    "../blog-a.html", "blog-a.txt", "blog-a/b.html", "", None, "blog-" + "x" * 60 + ".html"):
            with self.subTest(file=bad):
                problems = problems_for(lambda d: d["blog"]["items"][0].update(file=bad))
                self.assertTrue(any(".file" in p for p in problems), problems)

    def test_duplicates(self):
        self.assertTrue(any("used twice" in p for p in problems_for(lambda d: d["blog"]["items"][1].update(id="hello"))))
        self.assertTrue(any("already used" in p for p in problems_for(lambda d: d["blog"]["items"][1].update(file="blog-hello.html"))))

    def test_tags(self):
        self.assertTrue(problems_for(lambda d: d["blog"]["items"][0].update(tags=["a", "b", "c", "d", "e"])))
        self.assertTrue(problems_for(lambda d: d["blog"]["items"][0].update(tags=["x" * 30])))
        self.assertTrue(problems_for(lambda d: d["blog"]["items"][0].update(tags=[""])))
        self.assertTrue(any("twice" in p for p in problems_for(lambda d: d["blog"]["items"][0].update(tags=["News", "news"]))))
        self.assertEqual(problems_for(lambda d: d["blog"]["items"][0].update(tags=[])), [])

    def test_chapters_and_verses_are_for_stories(self):
        for block in ({"type": "chapter", "text": "C"}, {"type": "verse", "ref": "1:1", "paras": ["x"]}):
            problems = problems_for(lambda d: d["blog"]["items"][0].update(body=[block]))
            self.assertTrue(any("for stories" in p for p in problems), problems)

    def test_links_inside_text_are_checked(self):
        for bad in ("[x](javascript:alert(1))", "[x](//evil.com)", "[x](data:text/html,hi)", "[x](ftp://a.com/f)", "[x](https://user:pw@a.com)", "[x](../secret.html)"):
            with self.subTest(link=bad):
                problems = problems_for(lambda d: d["blog"]["items"][0].update(body=[{"type": "p", "text": "See " + bad + " now"}]))
                self.assertTrue(any("is not allowed" in p for p in problems), problems)
        for good in ("[x](https://example.com/a?b=1)", "[x](http://example.com)", "[x](stories.html)", "[x](stories.html#top)"):
            with self.subTest(link=good):
                self.assertEqual(problems_for(lambda d: d["blog"]["items"][0].update(body=[{"type": "p", "text": good}])), [])

    def test_empty_blog_is_allowed(self):
        self.assertEqual(problems_for(lambda d: d["blog"].update(items=[])), [])

    def test_body_and_text_rules(self):
        self.assertTrue(problems_for(lambda d: d["blog"]["items"][0].update(body=[])))
        for name, bad in (("title", ""), ("summary", "a\nb"), ("summary", "x" * 500)):
            self.assertTrue(problems_for(lambda d: d["blog"]["items"][0].update({name: bad})))


class ModelTests(unittest.TestCase):
    def test_input_never_changed(self):
        original = sample()
        frozen = copy.deepcopy(original)
        model.set_blog(original, title="New")
        model.add_post(original, **NEW)
        model.update_post(original, "hello", title="Changed")
        model.remove_post(original, "hello")
        self.assertEqual(original, frozen)

    def test_add_derives_the_file_and_cleans_tags(self):
        c = model.add_post(sample(), **{**NEW, "tags": [" News ", "", "Ideas"]})
        post = c["blog"]["items"][-1]
        self.assertEqual((post["file"], post["tags"], post["visible"]), ("blog-third.html", ["News", "Ideas"], True))
        self.assertEqual(post["body"], [{"type": "p", "text": "Third body."}, {"type": "p", "text": "More."}])

    def test_add_errors(self):
        for change in ({"id": "hello"}, {"id": "Bad Id"}, {"date": "2026-02-30"}, {"title": ""}, {"body_text": "  "},
                       {"body_text": "# Chapter"}, {"body_text": "[1:1] verse"}, {"tags": ["a", "b", "c", "d", "e"]},
                       {"body_text": "bad [x](javascript:alert(1))"}, {"body_text": "+ stray"}):
            with self.subTest(change=change):
                with self.assertRaises(EditError):
                    model.add_post(sample(), **{**NEW, **change})

    def test_update(self):
        c = model.update_post(sample(), "hello", title="New", date="2026-11-01", tags=["A", "B"], body_text="New text.")
        post = c["blog"]["items"][0]
        self.assertEqual((post["title"], post["date"], post["tags"], post["file"]), ("New", "2026-11-01", ["A", "B"], "blog-hello.html"))
        self.assertEqual(post["body"], [{"type": "p", "text": "New text."}])

    def test_update_refuses(self):
        for fields in ({"file": "x.html"}, {"id": "x"}, {"visible": False}, {}):
            with self.subTest(fields=fields):
                with self.assertRaises(EditError):
                    model.update_post(sample(), "hello", **fields)
        with self.assertRaises(EditError):
            model.update_post(sample(), "hello", date="nope")
        with self.assertRaises(EditError):
            model.update_post(sample(), "nope", title="x")

    def test_remove_visible_set_blog(self):
        self.assertEqual(ids(model.remove_post(sample(), "hello")), ["second"])
        self.assertFalse(model.set_post_visible(sample(), "hello", False)["blog"]["items"][0]["visible"])
        self.assertEqual(model.set_blog(sample(), lead="New lead.")["blog"]["lead"], "New lead.")
        with self.assertRaises(EditError):
            model.set_blog(sample(), colour="x")


class DateAndLinkTests(unittest.TestCase):
    def test_format_date(self):
        self.assertEqual(render.format_date("2026-10-23"), "23 October 2026")
        self.assertEqual(render.format_date("2026-01-05"), "5 January 2026")
        self.assertEqual(render.format_date("2028-02-29"), "29 February 2028")

    def test_format_date_never_depends_on_the_clock(self):
        import datetime
        real = datetime.date
        class Frozen(real):
            @classmethod
            def today(cls):
                raise AssertionError("the renderer must not read today's date")
        datetime.date = Frozen
        try:
            render.render_blog(sample())
            render.render_post(sample(), sample()["blog"]["items"][0])
        finally:
            datetime.date = real

    def test_inline_links(self):
        self.assertEqual(render.render_inline("a [b](https://x.com/?q=1&r=2) c"),
                         'a <a href="https://x.com/?q=1&amp;r=2" target="_blank" rel="noopener">b</a> c')
        self.assertEqual(render.render_inline("see [home](index.html)"), 'see <a href="index.html">home</a>')

    def test_a_url_with_parentheses_is_kept_whole(self):
        html = render.render_inline("[w](https://en.wikipedia.org/wiki/Foo_(bar)) end")
        self.assertIn('href="https://en.wikipedia.org/wiki/Foo_(bar)"', html)
        self.assertTrue(html.endswith("</a> end"))

    def test_inline_text_is_escaped_and_bad_links_stay_text(self):
        self.assertEqual(render.render_inline("<b>x</b> & [y](javascript:alert(1))"), "&lt;b&gt;x&lt;/b&gt; &amp; [y](javascript:alert(1))")
        self.assertEqual(render.render_inline('[<img src=x onerror=alert(1)>](https://a.com)'),
                         '<a href="https://a.com" target="_blank" rel="noopener">&lt;img src=x onerror=alert(1)&gt;</a>')

    def test_reading_time(self):
        post = {"body": [{"type": "p", "text": "word " * 450}]}
        self.assertEqual(render.reading_minutes(post), 2)
        self.assertEqual(render.reading_minutes({"body": [{"type": "p", "text": "one"}]}), 1)
        self.assertEqual(render.reading_minutes({"body": [{"type": "p", "text": "word " * 1000}]}), 5)


class RenderTests(unittest.TestCase):
    def test_list_page_content_and_order(self):
        html = render.render_blog(sample())
        for text in ("Blog title.", "Blog lead.", "A hello summary.", "1 October 2026", "20 October 2026", "News", "Ideas", "Read the post", "blog-hello.html", "1 min read"):
            self.assertIn(text, html)
        self.assertLess(html.index("Second"), html.index("Hello"))                    # newest first
        self.assertIn('<a href="blog.html" class="on">BLOG</a>', html)
        self.assertIsNone(re.search(r"\{\{\w+\}\}", html))

    def test_equal_dates_keep_the_order_of_the_config(self):
        c = model.update_post(sample(), "hello", date="2026-10-20")
        html = render.render_blog(c)
        self.assertLess(html.index(">Hello<"), html.index(">Second<"))

    def test_empty_list(self):
        c = sample()
        c["blog"]["items"] = []
        self.assertIn("No posts are published yet.", render.render_blog(c))

    def test_drafts_are_not_listed_and_have_no_page(self):
        c = model.set_post_visible(sample(), "second", False)
        self.assertNotIn(">Second<", render.render_blog(c))
        self.assertEqual(sorted(render.render_post_pages(c)), ["blog-hello.html"])

    def test_post_page(self):
        c = sample()
        html = render.render_post(c, c["blog"]["items"][0])
        self.assertIn("<title>Testland — Hello</title>", html)
        self.assertIn("1 October 2026", html)
        self.assertIn('<a href="https://example.com/page" target="_blank" rel="noopener">link</a>', html)
        self.assertIn('<h2 class="h3" style="margin: 56px 0 24px">A heading</h2>', html)
        self.assertIn('<li class="pill">News</li>', html)
        self.assertIn("Generated by the Beyondia site manager", html)
        self.assertEqual(tags_of(html).tags.count("h1"), 1)

    def test_post_without_tags_has_no_empty_pill_list(self):
        c = sample()
        html = render.render_post(c, c["blog"]["items"][1])
        self.assertNotIn('<ul class="pills"', html)

    def test_pager_runs_newest_to_oldest(self):
        c = model.add_post(sample(), **NEW)                       # dates: second 10-20, third 10-10, hello 10-01
        second, third, hello = (render.render_post(c, p) for p in sorted(c["blog"]["items"], key=lambda p: p["date"], reverse=True))
        self.assertIn(">All posts<", second); self.assertIn(">A third post<", second)
        self.assertIn(">Second<", third); self.assertIn(">Hello<", third)
        self.assertIn(">A third post<", hello); self.assertEqual(hello.count(">All posts<"), 1)

    def test_hostile_text_is_inert(self):
        c = sample()
        p = c["blog"]["items"][0]
        c["blog"]["title"] = c["blog"]["lead"] = p["title"] = p["summary"] = HOSTILE
        p["tags"] = [HOSTILE[:24]]
        p["body"] = [{"type": "heading", "text": HOSTILE}, {"type": "note", "text": HOSTILE}, {"type": "p", "text": HOSTILE}]
        for html in (render.render_blog(c), render.render_post(c, p)):
            self.assertNotIn("<script>alert", html)
            self.assertEqual(tags_of(html).tags.count("script"), 0)

    def test_deterministic(self):
        self.assertEqual(render.render_post_pages(sample()), render.render_post_pages(sample()))
        self.assertEqual(render.render_blog(sample()), render.render_blog(sample()))

    def test_navigation_has_the_blog_item_after_stories(self):
        keys = [key for key, _label, _href in render.NAV]
        self.assertEqual(keys[keys.index("stories") + 1], "blog")
        self.assertIn('<li><a href="blog.html">BLOG</a></li>', render.render_footer())


class PostPagesLeaveTests(TempDirCase):
    def test_removed_and_hidden_posts_lose_their_page(self):
        builder.build(self.tmp, sample())
        self.assertTrue((self.tmp / "blog-hello.html").exists())
        result = builder.build(self.tmp, model.remove_post(sample(), "hello"))
        self.assertEqual(result.removed, ["blog-hello.html"])
        self.assertFalse((self.tmp / "blog-hello.html").exists())
        builder.build(self.tmp, model.set_post_visible(sample(), "second", False))
        self.assertFalse((self.tmp / "blog-second.html").exists())
        builder.build(self.tmp, sample())
        self.assertTrue((self.tmp / "blog-second.html").exists())

    def test_check_mode_reports_a_pending_post_deletion(self):
        builder.build(self.tmp, sample())
        result = builder.build(self.tmp, model.remove_post(sample(), "hello"), check=True)
        self.assertIn("blog-hello.html (to delete)", result.stale)
        self.assertTrue((self.tmp / "blog-hello.html").exists())

    def test_hand_written_pages_and_the_list_page_are_never_deleted(self):
        builder.build(self.tmp, sample())
        (self.tmp / "blog-mine.html").write_text("<html>hand written, no comment</html>", encoding="utf-8")
        (self.tmp / "blogger.html").write_text(builder.render_all(sample())["blog.html"], encoding="utf-8")   # has the comment, wrong shape
        builder.build(self.tmp, model.remove_post(model.remove_post(sample(), "hello"), "second"))
        self.assertTrue((self.tmp / "blog-mine.html").exists())
        self.assertTrue((self.tmp / "blogger.html").exists())
        self.assertTrue((self.tmp / "blog.html").exists())

    def test_the_two_families_do_not_touch_each_other(self):
        builder.build(self.tmp, sample())
        builder.build(self.tmp, model.remove_story(sample(), "roman"))
        self.assertTrue((self.tmp / "blog-hello.html").exists())
        builder.build(self.tmp, model.remove_post(model.remove_story(sample(), "roman"), "hello"))
        self.assertTrue((self.tmp / "storyangel.html").exists())


if __name__ == "__main__":
    unittest.main()
