import unittest
from unittest import mock

from beyondia_manager import config as cfg
from beyondia_manager import model, service
from beyondia_manager.errors import ManagerError
from .helpers import TempDirCase, copy_fixture_site


class ApplyEditTests(TempDirCase):
    def setUp(self):
        super().setUp()
        self.site = copy_fixture_site(self.tmp / "site")

    def snapshot(self):
        return {p.name: p.read_bytes() for p in self.site.iterdir() if p.is_file()}

    def test_an_edit_that_cannot_be_rendered_is_not_saved(self):
        before = self.snapshot()
        with mock.patch.object(service, "render_all", side_effect=ManagerError("template broken")):
            with self.assertRaises(ManagerError):
                service.apply_edit(self.site, lambda c: model.set_home(c, title="Changed"))
        self.assertEqual(self.snapshot(), before)
        self.assertFalse((self.site / service.LOCK_NAME).exists())

    def test_the_lock_is_released_when_the_edit_fails(self):
        with self.assertRaises(ManagerError):
            service.apply_edit(self.site, lambda c: model.remove_tile(c, "nope"))
        self.assertFalse((self.site / service.LOCK_NAME).exists())

    def test_rebuild_false_saves_but_leaves_pages(self):
        result = service.apply_edit(self.site, lambda c: model.set_home(c, title="Changed"), rebuild=False)
        self.assertIsNone(result)
        self.assertEqual(cfg.load(self.site / "site.config.json")["home"]["title"], "Changed")
        self.assertEqual(service.site_status(self.site)["stale"], ["index.html"])

    def test_status_of_an_invalid_config_does_not_raise(self):
        (self.site / "site.config.json").write_text("[]", encoding="utf-8")
        status = service.site_status(self.site)
        self.assertFalse(status["valid"])
        self.assertTrue(status["problems"])


if __name__ == "__main__":
    unittest.main()
