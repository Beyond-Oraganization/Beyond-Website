"""The command line, end to end: real commands, real files, real Git."""

import contextlib
import io
import json
import unittest

from beyondia_manager import cli
from beyondia_manager import config as cfg
from beyondia_manager.build import build
from .helpers import GitCase, SITE_DIR, TempDirCase, copy_fixture_site, git


def run(site, *argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stderr(err):          # argparse prints usage errors to the real stderr
        code = cli.main(["--site-dir", str(site), *argv], out=out, err=err)
    return code, out.getvalue(), err.getvalue()


class CliCase(TempDirCase):
    def setUp(self):
        super().setUp()
        self.site = copy_fixture_site(self.tmp / "site")

    def ok(self, *argv):
        code, out, err = run(self.site, *argv)
        self.assertEqual(code, 0, f"{argv}: {err}")
        return out

    def fails(self, *argv):
        code, out, err = run(self.site, *argv)
        self.assertEqual(code, 1, f"{argv} should have failed; out={out}")
        return err

    def config(self):
        return cfg.load(self.site / "site.config.json")

    def page(self, name):
        return (self.site / name).read_text(encoding="utf-8")


class ReadCommandTests(CliCase):
    def test_validate_and_build_check_on_a_fresh_copy(self):
        self.assertIn("valid", self.ok("validate"))
        self.assertIn("up to date", self.ok("build", "--check"))
        self.assertIn("passed", self.ok("check"))

    def test_listings(self):
        self.assertIn("stories", self.ok("tile", "list"))
        self.assertIn("beyond-sales", self.ok("repo", "list"))
        self.assertIn("Constant expansion", self.ok("ticker", "list"))
        self.assertIn("ideology.html", self.ok("button", "list"))
        self.assertIn("Beyondia", self.ok("home", "show"))
        self.assertIn("The code, in the open.", self.ok("github", "show"))
        self.assertIn("href", self.ok("tile", "info", "stories"))

    def test_unknown_tile_info(self):
        self.assertIn("no tile", self.fails("tile", "info", "nope"))

    def test_status_without_git(self):
        out = self.ok("status")
        self.assertIn("up to date", out)
        self.assertIn("not a Git repository", out)

    def test_usage_errors_exit_2(self):
        self.assertEqual(run(self.site, "tile")[0], 2)
        self.assertEqual(run(self.site, "bogus")[0], 2)


class EditCommandTests(CliCase):
    def test_tile_lifecycle_updates_config_and_page(self):
        self.ok("tile", "add", "journal", "--label", "Journal", "--title", "Notes from the road",
                "--text", "Short posts.", "--href", "stories.html", "--position", "2")
        self.assertEqual([t["id"] for t in self.config()["home"]["map"]["tiles"]][:3], ["stories", "journal", "blog"])
        self.assertIn("Notes from the road", self.page("index.html"))
        self.assertIn("Ten doors", self.page("index.html"))

        self.ok("tile", "hide", "journal")
        self.assertNotIn("Notes from the road", self.page("index.html"))
        self.assertIn("Nine doors", self.page("index.html"))

        self.ok("tile", "unhide", "journal")
        self.ok("tile", "move", "journal", "1")
        self.assertEqual(self.config()["home"]["map"]["tiles"][0]["id"], "journal")

        self.ok("tile", "set", "journal", "--title", "Road notes")
        self.assertIn("Road notes", self.page("index.html"))

        self.ok("tile", "remove", "journal")
        self.assertNotIn("Road notes", self.page("index.html"))
        self.assertIn("Nine doors", self.page("index.html"))
        self.assertIn("up to date", self.ok("build", "--check"))

    def test_repo_lifecycle_updates_the_github_page(self):
        self.ok("repo", "add", "beyond-docs", "--name", "Beyond-Docs", "--url", "https://github.com/Beyond-Oraganization/Beyond-Docs",
                "--description", "Documents.", "--stack", "Markdown, Python")
        html = self.page("github.html")
        self.assertIn("Beyond-Docs", html)
        self.assertIn("Markdown", html)
        self.assertEqual(self.config()["github"]["repos"][-1]["stack"], ["Markdown", "Python"])
        self.ok("repo", "hide", "beyond-docs")
        self.assertNotIn("Beyond-Docs", self.page("github.html"))
        self.ok("repo", "unhide", "beyond-docs")
        self.ok("repo", "set", "beyond-docs", "--description", "Better docs.", "--stack", "")
        self.assertEqual(self.config()["github"]["repos"][-1]["stack"], [])
        self.ok("repo", "remove", "beyond-docs")
        self.assertNotIn("Beyond-Docs", self.page("github.html"))

    def test_home_ticker_button_github_edits(self):
        self.ok("home", "set", "--lead", "A new lead.", "--map-intro", "A new intro.")
        self.assertIn("A new lead.", self.page("index.html"))
        self.ok("ticker", "add", "Fresh phrase", "--position", "1")
        self.assertIn("Fresh phrase", self.page("index.html"))
        self.ok("ticker", "remove", "1")
        self.assertNotIn("Fresh phrase", self.page("index.html"))
        self.ok("button", "add", "Read stories", "stories.html", "--style", "ghost")
        self.assertIn("Read stories", self.page("index.html"))
        self.ok("button", "remove", "3")
        self.ok("github", "set", "--title", "Open source.")
        self.assertIn("Open source.", self.page("github.html"))

    def test_hostile_input_is_escaped_on_the_page(self):
        self.ok("home", "set", "--lead", "<script>alert(1)</script>")
        self.assertNotIn("<script>alert", self.page("index.html"))
        self.assertIn("&lt;script&gt;", self.page("index.html"))

    def test_unicode_survives(self):
        self.ok("home", "set", "--lead", "Ідея — понад усе")
        self.assertIn("Ідея — понад усе", self.page("index.html"))


class RefusalTests(CliCase):
    def snapshot(self):
        return {p.name: p.read_bytes() for p in self.site.iterdir() if p.is_file()}

    def test_refused_edits_change_nothing_at_all(self):
        before = self.snapshot()
        cases = [
            ("tile", "add", "stories", "--label", "x", "--title", "x", "--text", "x", "--href", "plans.html"),   # duplicate id
            ("tile", "add", "evil", "--label", "x", "--title", "x", "--text", "x", "--href", "javascript:alert(1)"),
            ("tile", "remove", "nope"),
            ("tile", "move", "stories", "99"),
            ("tile", "set", "stories", "--title", ""),
            ("repo", "add", "bad", "--name", "Bad", "--url", "http://", "--description", "d"),
            ("home", "set", "--title", "x" * 100),
            ("ticker", "remove", "99"),
            ("button", "remove", "99"),
        ]
        for argv in cases:
            with self.subTest(argv=argv):
                self.fails(*argv)
                self.assertEqual(self.snapshot(), before)

    def test_corrupt_config_is_reported_and_left_alone(self):
        (self.site / "site.config.json").write_text("{ broken", encoding="utf-8")
        self.assertIn("not valid JSON", self.fails("validate"))
        self.assertIn("not valid JSON", self.fails("tile", "list"))
        self.assertEqual((self.site / "site.config.json").read_text(), "{ broken")

    def test_a_held_lock_blocks_edits(self):
        (self.site / cli.LOCK_NAME).write_text("123\n")
        before = self.config()
        self.assertIn("another manager command", self.fails("tile", "hide", "stories"))
        self.assertEqual(self.config(), before)

    def test_lock_is_released_after_success_and_after_failure(self):
        self.ok("tile", "hide", "stories")
        self.assertFalse((self.site / cli.LOCK_NAME).exists())
        self.fails("tile", "remove", "nope")
        self.assertFalse((self.site / cli.LOCK_NAME).exists())

    def test_missing_config(self):
        (self.site / "site.config.json").unlink()
        self.assertIn("not found", self.fails("validate"))


class BuildCommandTests(CliCase):
    def test_no_build_flag_leaves_pages_stale_and_check_notices(self):
        code, out, err = run(self.site, "--no-build", "tile", "hide", "stories")
        self.assertEqual(code, 0, err)
        self.assertIn("not rebuilt", out)
        self.assertIn("Out of date", self.fails("build", "--check"))
        self.ok("build")
        self.assertIn("up to date", self.ok("build", "--check"))

    def test_build_repairs_a_hand_edited_page(self):
        (self.site / "index.html").write_text("vandalised", encoding="utf-8")
        self.assertIn("Out of date", self.fails("build", "--check"))
        self.ok("build")
        self.assertIn("up to date", self.ok("build", "--check"))

    def test_check_reports_every_problem(self):
        self.ok("tile", "set", "stories", "--href", "missing-page.html")
        err = self.fails("check")
        self.assertIn("broken link: missing-page.html", err)


class PublishCommandTests(GitCase):
    def setUp(self):
        super().setUp()
        self.site = copy_fixture_site(self.work)
        (self.site / ".gitignore").write_text(".bm.lock\n")
        self.commit_all(self.work, "initial")
        git(self.work, "push", "-u", "origin", "main")

    def ok(self, *argv):
        code, out, err = run(self.site, *argv)
        self.assertEqual(code, 0, f"{argv}: {err}")
        return out

    def test_edit_then_publish_reaches_the_remote(self):
        self.ok("tile", "hide", "creator")
        self.assertIn("unpublished changes", self.ok("status"))
        out = self.ok("publish", "-m", "Hide the creator door")
        self.assertIn("Published", out)
        self.assertEqual(self.remote_log()[0], "Hide the creator door")
        remote = self.clone_remote()
        self.assertFalse(json.loads((remote / "site.config.json").read_text())["home"]["map"]["tiles"][-1]["visible"])
        self.assertNotIn("Created by Roman Patlai</h3>", (remote / "index.html").read_text())
        self.assertIn("nothing to publish", self.ok("status"))
        self.assertIn("Nothing to publish", self.ok("publish", "-m", "again"))

    def test_publish_rebuilds_pages_that_were_edited_with_no_build(self):
        self.ok("--no-build", "tile", "hide", "creator")
        self.ok("publish", "-m", "go")
        remote = self.clone_remote()
        self.assertNotIn("Created by Roman Patlai</h3>", (remote / "index.html").read_text())

    def test_dry_run_changes_nothing(self):
        self.ok("tile", "hide", "creator")
        remote_head = git(self.remote, "rev-parse", "main")
        head = git(self.work, "rev-parse", "HEAD")
        out = self.ok("publish", "-m", "x", "--dry-run")
        self.assertIn("Dry run", out)
        self.assertEqual(git(self.remote, "rev-parse", "main"), remote_head)
        self.assertEqual(git(self.work, "rev-parse", "HEAD"), head)

    def test_publish_is_refused_when_site_checks_fail(self):
        self.ok("tile", "set", "stories", "--href", "missing-page.html")
        remote_head = git(self.remote, "rev-parse", "main")
        code, _out, err = run(self.site, "publish", "-m", "should not go")
        self.assertEqual(code, 1)
        self.assertIn("site checks failed", err)
        self.assertEqual(git(self.remote, "rev-parse", "main"), remote_head)

    def test_unrelated_work_is_never_published(self):
        (self.work / "draft.txt").write_text("private\n")
        self.ok("tile", "hide", "creator")
        self.ok("publish", "-m", "only managed files")
        self.assertNotIn("draft.txt", self.remote_files())


if __name__ == "__main__":
    unittest.main()


class PlansCommandTests(CliCase):
    def test_listings(self):
        self.assertIn("book-of-myths", self.ok("plan", "list"))
        self.assertIn("writing", self.ok("lane", "list"))
        self.assertIn("new-edit", self.ok("step", "list"))
        self.assertIn("Built slowly", self.ok("plans", "show"))
        self.assertIn("status", self.ok("plan", "info", "treatise"))
        self.assertIn("when", self.ok("step", "info", "new-edit"))
        self.assertIn("no plan", self.fails("plan", "info", "nope"))

    def test_plan_lifecycle_updates_config_and_page(self):
        self.ok("plan", "add", "bot-v2", "--lane", "building", "--title", "Bot version two",
                "--text", "A rewrite.", "--status", "Planned", "--position", "1")
        self.assertIn("Bot version two", self.page("plans.html"))
        self.ok("plan", "set", "bot-v2", "--status", "In progress")
        self.assertIn("In progress", self.page("plans.html"))
        self.ok("plan", "to-lane", "bot-v2", "horizon")
        lanes = {l["id"]: [p["id"] for p in l["items"]] for l in self.config()["plans"]["lanes"]}
        self.assertIn("bot-v2", lanes["horizon"])
        self.assertNotIn("bot-v2", lanes["building"])
        self.ok("plan", "move", "bot-v2", "1")
        self.ok("plan", "hide", "bot-v2")
        self.assertNotIn("Bot version two", self.page("plans.html"))
        self.ok("plan", "unhide", "bot-v2")
        self.ok("plan", "remove", "bot-v2")
        self.assertNotIn("Bot version two", self.page("plans.html"))
        self.assertIn("up to date", self.ok("build", "--check"))

    def test_lane_lifecycle(self):
        self.assertIn("between 1 and 3", self.fails("lane", "add", "ideas", "--label", "Ideas"))   # the real page has three
        for plan in ("nearest-plan", "video-edit-release", "decade-plan"):
            self.ok("plan", "to-lane", plan, "building")
        self.ok("lane", "remove", "horizon")
        self.ok("lane", "add", "ideas", "--label", "Ideas")
        self.assertIn("Ideas", self.page("plans.html"))
        self.ok("lane", "set", "ideas", "--label", "Thoughts")
        self.ok("lane", "move", "ideas", "1")
        self.assertEqual(self.config()["plans"]["lanes"][0]["label"], "Thoughts")
        self.assertIn("still has", self.fails("lane", "remove", "writing"))
        self.ok("lane", "remove", "ideas")

    def test_step_lifecycle_and_plans_text(self):
        self.ok("step", "add", "launch", "--when", "Autumn", "--title", "Launch day", "--text", "We launch.", "--status", "Planned")
        self.assertIn("Launch day", self.page("plans.html"))
        self.ok("step", "set", "launch", "--when", "Winter")
        self.ok("step", "move", "launch", "1")
        self.ok("step", "hide", "launch")
        self.assertNotIn("Launch day", self.page("plans.html"))
        self.ok("step", "unhide", "launch")
        self.ok("step", "remove", "launch")
        self.ok("plans", "set", "--title", "New plans title.", "--roadmap-title", "New road.")
        self.assertIn("New plans title.", self.page("plans.html"))
        self.assertIn("New road.", self.page("plans.html"))

    def test_refused_plan_edits_change_nothing(self):
        before = {p.name: p.read_bytes() for p in self.site.iterdir() if p.is_file()}
        for argv in (
            ("plan", "add", "x", "--lane", "nope", "--title", "t", "--text", "t", "--status", "s"),
            ("plan", "add", "this-website", "--lane", "writing", "--title", "t", "--text", "t", "--status", "s"),
            ("plan", "remove", "nope"), ("plan", "move", "treatise", "9"), ("plan", "to-lane", "treatise", "nope"),
            ("plan", "set", "treatise", "--status", "x" * 40), ("step", "remove", "nope"),
            ("step", "add", "new-edit", "--when", "w", "--title", "t", "--text", "t", "--status", "s"),
        ):
            with self.subTest(argv=argv):
                self.fails(*argv)
                self.assertEqual({p.name: p.read_bytes() for p in self.site.iterdir() if p.is_file()}, before)


class StoryCommandTests(CliCase):
    def write(self, name, text):
        path = self.tmp / name
        path.write_text(text, encoding="utf-8")
        return str(path)

    def test_listings(self):
        out = self.ok("story", "list")
        self.assertIn("angel", out)
        self.assertIn("[verses]", out)
        self.assertIn("storyangel.html", out)
        self.assertIn("The Angel Beyond", self.ok("story", "info", "angel"))
        self.assertIn("Myths that carry", self.ok("stories", "show"))
        self.assertIn("no story", self.fails("story", "info", "nope"))

    def test_the_body_round_trips_through_a_file_without_changes(self):
        body = self.ok("story", "body", "roman")
        self.assertIn("[1:1]", body)
        before = self.page("storyroman.html")
        self.ok("story", "set", "roman", "--body-file", self.write("roman.txt", body))
        self.assertEqual(self.page("storyroman.html"), before)
        self.assertIn("up to date", self.ok("build", "--check"))

    def test_add_edit_move_hide_remove(self):
        self.ok("story", "add", "lighthouse", "--title", "The Lighthouse", "--summary", "A keeper and a light.", "--aside", "A light that stays.",
                "--tag", "Myth", "--body-file", self.write("l.txt", "A keeper lived alone.\n\nThe light never went out."))
        self.assertIn("A keeper lived alone.", self.page("storylighthouse.html"))
        self.assertIn("The Lighthouse", self.page("stories.html"))
        self.assertIn("Eight stories so far", self.page("index.html"))
        self.assertIn("Rooms: eight stories", self.page("index.html"))
        self.assertIn("storylighthouse.html", self.page("storyroman.html"))                      # the previous last story now has a next

        self.ok("story", "set", "lighthouse", "--title", "The Old Lighthouse", "--body-file", self.write("l2.txt", "A new text."))
        self.assertIn("The Old Lighthouse", self.page("storylighthouse.html"))
        self.assertIn("A new text.", self.page("storylighthouse.html"))
        self.assertNotIn("A keeper lived alone.", self.page("storylighthouse.html"))

        self.ok("story", "move", "lighthouse", "1")
        self.assertEqual(self.config()["stories"]["items"][0]["id"], "lighthouse")

        self.ok("story", "hide", "lighthouse")
        self.assertFalse((self.site / "storylighthouse.html").exists())
        self.assertNotIn("The Old Lighthouse", self.page("stories.html"))
        self.assertIn("Seven stories so far", self.page("index.html"))
        self.ok("story", "unhide", "lighthouse")
        self.assertTrue((self.site / "storylighthouse.html").exists())

        self.ok("story", "remove", "lighthouse")
        self.assertFalse((self.site / "storylighthouse.html").exists())
        self.assertIn("up to date", self.ok("build", "--check"))
        self.assertIn("passed", self.ok("check"))

    def test_body_from_standard_input(self):
        import sys
        old = sys.stdin
        sys.stdin = io.StringIO("From stdin.")
        try:
            self.ok("story", "add", "piped", "--title", "Piped", "--summary", "s", "--aside", "a", "--body-file", "-")
        finally:
            sys.stdin = old
        self.assertIn("From stdin.", self.page("storypiped.html"))

    def test_the_stories_page_text(self):
        self.ok("stories", "set", "--title", "New stories title.")
        self.assertIn("New stories title.", self.page("stories.html"))

    def test_removing_a_story_leaves_a_hand_written_page_alone(self):
        marker = [l for l in self.page("storygirl.html").splitlines() if "Generated by" in l][0]
        (self.site / "storymine.html").write_text(self.page("storygirl.html").replace(marker, "<!-- mine -->"), encoding="utf-8")
        self.ok("story", "remove", "girl")
        self.assertFalse((self.site / "storygirl.html").exists())
        self.assertTrue((self.site / "storymine.html").exists())

    def test_refusals_change_nothing(self):
        before = {p.name: p.read_bytes() for p in self.site.iterdir() if p.is_file()}
        ok_body = self.write("ok.txt", "Text.")
        for argv in (
            ("story", "add", "angel", "--title", "t", "--summary", "s", "--aside", "a", "--body-file", ok_body),               # duplicate id
            ("story", "add", "x", "--title", "t", "--summary", "s", "--aside", "a", "--body-file", self.write("e.txt", "  \n")),   # empty body
            ("story", "add", "x", "--title", "t", "--summary", "s", "--aside", "a", "--body-file", self.write("p.txt", "+ stray")),
            ("story", "add", "x", "--title", "t", "--summary", "s", "--aside", "a", "--body-file", str(self.tmp / "missing.txt")),
            ("story", "add", "Bad Id", "--title", "t", "--summary", "s", "--aside", "a", "--body-file", ok_body),
            ("story", "set", "angel", "--title", ""), ("story", "set", "nope", "--title", "x"), ("story", "move", "angel", "99"),
            ("story", "remove", "nope"), ("story", "hide", "nope"),
        ):
            with self.subTest(argv=argv):
                self.fails(*argv)
                self.assertEqual({p.name: p.read_bytes() for p in self.site.iterdir() if p.is_file()}, before)

    def test_invalid_kind_is_a_usage_error(self):
        self.assertEqual(run(self.site, "story", "set", "angel", "--kind", "poem")[0], 2)


class BlogCommandTests(CliCase):
    def write(self, name, text):
        path = self.tmp / name
        path.write_text(text, encoding="utf-8")
        return str(path)

    def test_listings(self):
        out = self.ok("post", "list")
        self.assertIn("blog-welcome.html", out)
        self.assertIn("[draft]", out)
        self.assertIn("2026-10-20", out.splitlines()[0])                       # newest first
        self.assertIn("Welcome to the blog", self.ok("post", "info", "welcome"))
        self.assertIn("Notes from the country", self.ok("blog", "show"))
        self.assertIn("no post", self.fails("post", "info", "nope"))

    def test_the_body_round_trips_without_changes(self):
        body = self.ok("post", "body", "welcome")
        self.assertIn("[GitHub](https://github.com/Beyond-Oraganization)", body)
        before = self.page("blog-welcome.html")
        self.ok("post", "set", "welcome", "--body-file", self.write("w.txt", body))
        self.assertEqual(self.page("blog-welcome.html"), before)
        self.assertIn("up to date", self.ok("build", "--check"))

    def test_add_edit_hide_remove(self):
        self.ok("post", "add", "autumn", "--title", "Autumn notes", "--summary", "Leaves.", "--date", "2026-10-25", "--tags", "News, Ideas",
                "--body-file", self.write("a.txt", "Leaves fall. See [home](index.html).\n\n## Later\n\nMore."))
        page = self.page("blog-autumn.html")
        self.assertIn("Autumn notes", page)
        self.assertIn('<a href="index.html">home</a>', page)
        self.assertIn("25 October 2026", page)
        self.assertIn("Autumn notes", self.page("blog.html"))
        self.assertLess(self.page("blog.html").index("Autumn notes"), self.page("blog.html").index("A second note"))   # newest first

        self.ok("post", "set", "autumn", "--title", "Late autumn", "--date", "2026-09-01", "--tags", "News", "--body-file", self.write("b.txt", "New text."))
        self.assertIn("Late autumn", self.page("blog-autumn.html"))
        self.assertIn("1 September 2026", self.page("blog-autumn.html"))
        self.assertGreater(self.page("blog.html").index("Late autumn"), self.page("blog.html").index("A second note"))

        self.ok("post", "hide", "autumn")
        self.assertFalse((self.site / "blog-autumn.html").exists())
        self.ok("post", "unhide", "autumn")
        self.assertTrue((self.site / "blog-autumn.html").exists())
        self.ok("post", "remove", "autumn")
        self.assertFalse((self.site / "blog-autumn.html").exists())
        self.assertIn("up to date", self.ok("build", "--check"))
        self.assertIn("passed", self.ok("check"))

    def test_default_date_is_today(self):
        import datetime
        self.ok("post", "add", "today", "--title", "Today", "--summary", "s", "--body-file", self.write("t.txt", "Text."))
        self.assertEqual(next(p for p in self.config()["blog"]["items"] if p["id"] == "today")["date"], datetime.date.today().isoformat())

    def test_the_blog_page_text(self):
        self.ok("blog", "set", "--title", "New blog title.")
        self.assertIn("New blog title.", self.page("blog.html"))

    def test_refusals_change_nothing(self):
        before = {p.name: p.read_bytes() for p in self.site.iterdir() if p.is_file()}
        ok_body = self.write("ok.txt", "Text.")
        base = ("--title", "t", "--summary", "s", "--body-file", ok_body)
        for argv in (
            ("post", "add", "welcome") + base, ("post", "add", "x", "--date", "2026-02-30") + base, ("post", "add", "x", "--date", "tomorrow") + base,
            ("post", "add", "x", "--tags", "a,b,c,d,e") + base, ("post", "add", "Bad Id") + base,
            ("post", "add", "x", "--title", "t", "--summary", "s", "--body-file", self.write("c.txt", "# Chapter")),
            ("post", "add", "x", "--title", "t", "--summary", "s", "--body-file", self.write("l.txt", "[x](javascript:alert(1))")),
            ("post", "set", "welcome", "--title", ""), ("post", "set", "nope", "--title", "x"), ("post", "remove", "nope"), ("post", "hide", "nope"),
        ):
            with self.subTest(argv=argv):
                self.fails(*argv)
                self.assertEqual({p.name: p.read_bytes() for p in self.site.iterdir() if p.is_file()}, before)
