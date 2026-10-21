import json
import os
import unittest

from beyondia_manager import config as cfg
from beyondia_manager.errors import ConfigError
from .helpers import TempDirCase, sample, tile


def problems_for(mutate):
    data = sample()
    mutate(data)
    return cfg.validate(data)


class ValidateTests(unittest.TestCase):
    def test_sample_is_valid(self):
        self.assertEqual(cfg.validate(sample()), [])

    def test_not_an_object(self):
        self.assertTrue(cfg.validate([]))
        self.assertTrue(cfg.validate("text"))

    def test_wrong_schema_version(self):
        self.assertTrue(any("schema" in p for p in problems_for(lambda d: d.update(schema=2))))
        self.assertTrue(any("schema" in p for p in problems_for(lambda d: d.update(schema=True))))

    def test_missing_sections_are_all_reported(self):
        problems = cfg.validate({"schema": 1})
        for name in ("site", "home", "github"):
            self.assertTrue(any(name in p for p in problems), name)

    def test_all_problems_reported_together_with_paths(self):
        def mutate(d):
            d["home"]["title"] = ""
            d["home"]["map"]["tiles"][1]["href"] = "javascript:alert(1)"
        problems = problems_for(mutate)
        self.assertTrue(any(p.startswith("home.title") for p in problems))
        self.assertTrue(any(p.startswith("home.map.tiles[1].href") for p in problems))

    def test_text_rules(self):
        for bad in ("", "   ", "a\nb", "a\tb", "x" * 500, 5, None):
            with self.subTest(bad=bad):
                self.assertTrue(problems_for(lambda d: d["home"].update(lead=bad)))

    def test_duplicate_tile_ids(self):
        def mutate(d):
            d["home"]["map"]["tiles"].append(tile(id="alpha"))
        self.assertTrue(any("used twice" in p for p in problems_for(mutate)))

    def test_bad_slug(self):
        for bad in ("Alpha", "a b", "-a", "a--b", "", "a" * 41, "../x"):
            with self.subTest(bad=bad):
                self.assertTrue(problems_for(lambda d: d["home"]["map"]["tiles"][0].update(id=bad)))

    def test_at_least_one_visible_tile(self):
        def mutate(d):
            for t in d["home"]["map"]["tiles"]:
                t["visible"] = False
        self.assertTrue(any("at least one tile" in p for p in problems_for(mutate)))

    def test_visible_must_be_boolean(self):
        self.assertTrue(problems_for(lambda d: d["home"]["map"]["tiles"][0].update(visible="yes")))

    def test_list_size_limits(self):
        self.assertTrue(problems_for(lambda d: d["home"].update(ticker=[])))
        self.assertTrue(problems_for(lambda d: d["home"].update(ticker=["x"] * 13)))
        self.assertTrue(problems_for(lambda d: d["home"].update(buttons=[])))
        self.assertTrue(problems_for(lambda d: d["home"].update(buttons=[d["home"]["buttons"][0]] * 4)))

    def test_button_style(self):
        self.assertTrue(problems_for(lambda d: d["home"]["buttons"][0].update(style="neon")))

    def test_empty_repo_list_is_allowed(self):
        self.assertEqual(problems_for(lambda d: d["github"].update(repos=[])), [])

    def test_repo_rules(self):
        self.assertTrue(problems_for(lambda d: d["github"]["repos"][0].update(url="techsales.html")))  # must be absolute
        self.assertTrue(problems_for(lambda d: d["github"]["repos"][0].update(page="https://x.com/")))  # must be local
        self.assertTrue(problems_for(lambda d: d["github"]["repos"][0].update(stack=["x"] * 9)))


class UrlTests(unittest.TestCase):
    def test_accepted(self):
        for ok in ("https://github.com/x", "http://example.com/a?b=c#d", "stories.html", "stories.html#top", "a-b_c.html"):
            with self.subTest(url=ok):
                self.assertIsNone(cfg.url_problem(ok))

    def test_refused(self):
        refused = (
            "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd",
            "ftp://x.com", "//evil.com", "https://", "https://user:pw@x.com", "https://x.com/a b",
            "../secret.html", "/abs.html", "dir/page.html", "page.txt", "page.html#a b", "", " ", None, 5,
            "https://x.com/\nx", "page.html\n",
            "javascript://example.com/%0Aalert(1)", "data://example.com/x",
        )
        for bad in refused:
            with self.subTest(url=bad):
                self.assertIsNotNone(cfg.url_problem(bad))

    def test_modes(self):
        self.assertIsNotNone(cfg.url_problem("https://x.com", allow_absolute=False))
        self.assertIsNotNone(cfg.url_problem("page.html", allow_relative=False))


class FileTests(TempDirCase):
    def test_dumps_is_canonical(self):
        text = cfg.dumps(sample())
        self.assertTrue(text.endswith("\n"))
        self.assertEqual(cfg.dumps(json.loads(text)), text)

    def test_non_ascii_survives(self):
        data = sample()
        data["home"]["lead"] = "Ідея — понад усе"
        path = self.tmp / "c.json"
        cfg.save(path, data)
        self.assertIn("Ідея", path.read_text(encoding="utf-8"))
        self.assertEqual(cfg.load(path)["home"]["lead"], "Ідея — понад усе")

    def test_save_then_load(self):
        path = self.tmp / "c.json"
        cfg.save(path, sample())
        self.assertEqual(cfg.load(path), sample())

    def test_invalid_data_never_reaches_disk(self):
        path = self.tmp / "c.json"
        cfg.save(path, sample())
        before = path.read_bytes()
        bad = sample()
        bad["home"]["title"] = ""
        with self.assertRaises(ConfigError):
            cfg.save(path, bad)
        self.assertEqual(path.read_bytes(), before)

    def test_load_errors_are_config_errors(self):
        with self.assertRaises(ConfigError) as ctx:
            cfg.load(self.tmp / "missing.json")
        self.assertIn("not found", str(ctx.exception))
        broken = self.tmp / "broken.json"
        broken.write_text("{ not json", encoding="utf-8")
        with self.assertRaises(ConfigError) as ctx:
            cfg.load(broken)
        self.assertIn("not valid JSON", str(ctx.exception))

    def test_atomic_write_leaves_no_temp_files(self):
        path = self.tmp / "c.json"
        cfg.atomic_write_text(path, "one")
        cfg.atomic_write_text(path, "two")
        self.assertEqual(path.read_text(), "two")
        self.assertEqual(sorted(p.name for p in self.tmp.iterdir()), ["c.json"])

    def test_failed_write_keeps_old_file_and_cleans_up(self):
        path = self.tmp / "c.json"
        path.write_text("old")
        real_replace = os.replace
        def boom(*a, **k):
            raise OSError("disk full")
        os.replace = boom
        try:
            with self.assertRaises(OSError):
                cfg.atomic_write_text(path, "new")
        finally:
            os.replace = real_replace
        self.assertEqual(path.read_text(), "old")
        self.assertEqual(sorted(p.name for p in self.tmp.iterdir()), ["c.json"])


if __name__ == "__main__":
    unittest.main()
