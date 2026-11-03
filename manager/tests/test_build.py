import os
import unittest

from beyondia_manager import build as builder
from .helpers import TempDirCase, sample


PAGES = ["404.html", "blog-hello.html", "blog-second.html", "blog.html", "github.html", "index.html", "plans.html", "search.html", "stories.html", "storyangel.html", "storyroman.html"]
# Files made from the pages themselves. The sample config has no site address, so there is no sitemap or feed.
SITE_FILES = ["robots.txt", "search-index.js"]
ALL_PAGES = sorted(PAGES + SITE_FILES)


class BuildTests(TempDirCase):
    def test_writes_all_pages(self):
        result = builder.build(self.tmp, sample())
        self.assertEqual(sorted(result.changed), ALL_PAGES)
        self.assertTrue((self.tmp / "index.html").read_text(encoding="utf-8").startswith("<!doctype html>"))
        self.assertTrue((self.tmp / "github.html").exists())
        self.assertTrue((self.tmp / "plans.html").exists())

    def test_second_build_is_a_no_op(self):
        builder.build(self.tmp, sample())
        before = {n: (self.tmp / n).stat().st_mtime_ns for n in ALL_PAGES}
        result = builder.build(self.tmp, sample())
        self.assertEqual(result.changed, [])
        self.assertEqual(sorted(result.unchanged), ALL_PAGES)
        after = {n: (self.tmp / n).stat().st_mtime_ns for n in ALL_PAGES}
        self.assertEqual(before, after)             # files were not even touched

    def test_only_the_affected_page_is_rewritten(self):
        builder.build(self.tmp, sample())
        c = sample()
        c["github"]["title"] = "Different."
        result = builder.build(self.tmp, c)
        self.assertEqual(sorted(result.changed), ["github.html", "search-index.js"])   # the search index follows the page text

    def test_check_mode_writes_nothing(self):
        result = builder.build(self.tmp, sample(), check=True)
        self.assertEqual(sorted(result.changed), ALL_PAGES)
        self.assertEqual(list(self.tmp.iterdir()), [])

    def test_check_mode_detects_a_hand_edit(self):
        builder.build(self.tmp, sample())
        page = self.tmp / "index.html"
        page.write_text(page.read_text(encoding="utf-8") + "<!-- hand edit -->", encoding="utf-8")
        self.assertEqual(builder.build(self.tmp, sample(), check=True).changed, ["index.html"])

    def test_build_repairs_a_hand_edit(self):
        builder.build(self.tmp, sample())
        (self.tmp / "index.html").write_text("broken", encoding="utf-8")
        builder.build(self.tmp, sample())
        self.assertEqual(builder.build(self.tmp, sample(), check=True).changed, [])

    def test_no_stray_temp_files(self):
        builder.build(self.tmp, sample())
        self.assertEqual(sorted(p.name for p in self.tmp.iterdir()), ALL_PAGES)

    def test_managed_files_are_exactly_config_and_generated(self):
        self.assertEqual(set(builder.MANAGED_FILES), {
            "site.config.json", "index.html", "github.html", "plans.html", "stories.html", "blog.html", "404.html", "search.html",
            "robots.txt", "sitemap.xml", "feed.xml", "search-index.js",
        })


if __name__ == "__main__":
    unittest.main()
