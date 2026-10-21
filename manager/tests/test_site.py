"""Tests against the real site files. These are what keep the live site honest."""

import unittest

from beyondia_manager import checks
from beyondia_manager import config as cfg
from beyondia_manager.build import MANAGED_FILES, build
from .helpers import SITE_DIR


class RealSiteTests(unittest.TestCase):
    def test_config_is_valid(self):
        cfg.load(SITE_DIR / "site.config.json")

    def test_config_file_is_in_canonical_form(self):
        path = SITE_DIR / "site.config.json"
        self.assertEqual(path.read_text(encoding="utf-8"), cfg.dumps(cfg.load(path)),
                         "run any `bm` edit command, or re-save the file, to normalise it")

    def test_committed_pages_match_the_config(self):
        stale = build(SITE_DIR, cfg.load(SITE_DIR / "site.config.json"), check=True).changed
        self.assertEqual(stale, [], f"out of date: {stale} - run `manager/bm build`")

    def test_every_page_passes_the_integrity_checks(self):
        self.assertEqual(checks.check_site(SITE_DIR), [])

    def test_every_link_target_of_the_home_page_config_exists(self):
        config = cfg.load(SITE_DIR / "site.config.json")
        hrefs = [t["href"] for t in config["home"]["map"]["tiles"]] + [b["href"] for b in config["home"]["buttons"]]
        hrefs += [r["page"] for r in config["github"]["repos"] if "page" in r]
        for href in hrefs:
            if not href.startswith("http"):
                with self.subTest(href=href):
                    self.assertTrue((SITE_DIR / href.split("#")[0]).is_file())

    def test_managed_files_exist(self):
        for name in MANAGED_FILES:
            self.assertTrue((SITE_DIR / name).is_file(), name)


if __name__ == "__main__":
    unittest.main()
