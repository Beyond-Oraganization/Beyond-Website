import copy
import unittest

from beyondia_manager import model
from beyondia_manager.errors import EditError
from .helpers import sample, tile


def ids(config):
    return [t["id"] for t in config["home"]["map"]["tiles"]]


class PurityTests(unittest.TestCase):
    def test_input_is_never_changed(self):
        original = sample()
        frozen = copy.deepcopy(original)
        model.set_home(original, title="New")
        model.add_ticker(original, "Three")
        model.add_tile(original, **tile())
        model.remove_tile(original, "alpha")
        model.add_repo(original, id="two", name="Two", url="https://github.com/o/two", description="d")
        self.assertEqual(original, frozen)


class HomeTests(unittest.TestCase):
    def test_set_home_fields(self):
        new = model.set_home(sample(), title="New", map_intro="Fresh intro.")
        self.assertEqual(new["home"]["title"], "New")
        self.assertEqual(new["home"]["map"]["intro"], "Fresh intro.")
        self.assertEqual(new["home"]["lead"], "A lead sentence.")

    def test_set_home_rejects_unknown_and_empty(self):
        with self.assertRaises(EditError):
            model.set_home(sample(), colour="red")
        with self.assertRaises(EditError):
            model.set_home(sample())

    def test_set_home_rejects_invalid_value(self):
        with self.assertRaises(EditError) as ctx:
            model.set_home(sample(), title="")
        self.assertIn("home.title", str(ctx.exception))

    def test_ticker_add_remove_positions(self):
        c = model.add_ticker(sample(), "Zero", position=1)
        self.assertEqual(c["home"]["ticker"], ["Zero", "One", "Two"])
        c = model.add_ticker(c, "End")
        self.assertEqual(c["home"]["ticker"][-1], "End")
        c = model.remove_ticker(c, 1)
        self.assertEqual(c["home"]["ticker"], ["One", "Two", "End"])

    def test_ticker_bad_positions(self):
        for bad in (0, 4, -1):
            with self.subTest(position=bad):
                with self.assertRaises(EditError):
                    model.add_ticker(sample(), "x", position=bad)
                with self.assertRaises(EditError):
                    model.remove_ticker(sample(), bad)

    def test_cannot_remove_last_ticker_item(self):
        c = model.remove_ticker(sample(), 1)
        with self.assertRaises(EditError):
            model.remove_ticker(c, 1)

    def test_buttons(self):
        c = model.add_button(sample(), "More", "community.html", "ghost")
        self.assertEqual([b["label"] for b in c["home"]["buttons"]], ["Go", "More"])
        c = model.remove_button(c, 1)
        self.assertEqual([b["label"] for b in c["home"]["buttons"]], ["More"])
        with self.assertRaises(EditError):
            model.remove_button(c, 1)            # would leave none
        with self.assertRaises(EditError):
            model.add_button(sample(), "Bad", "javascript:alert(1)")


class TileTests(unittest.TestCase):
    def test_add_append_and_insert(self):
        self.assertEqual(ids(model.add_tile(sample(), **tile())), ["alpha", "beta", "gamma"])
        self.assertEqual(ids(model.add_tile(sample(), **tile(), position=1)), ["gamma", "alpha", "beta"])
        self.assertEqual(ids(model.add_tile(sample(), **tile(), position=3)), ["alpha", "beta", "gamma"])

    def test_add_duplicate_id(self):
        with self.assertRaises(EditError) as ctx:
            model.add_tile(sample(), **tile(id="alpha"))
        self.assertIn("already exists", str(ctx.exception))

    def test_add_invalid_fields(self):
        for bad in ({"href": "https://"}, {"title": ""}, {"id": "Bad Id"}, {"text": "x" * 300}):
            with self.subTest(bad=bad):
                with self.assertRaises(EditError):
                    model.add_tile(sample(), **tile(**bad))

    def test_add_position_out_of_range(self):
        with self.assertRaises(EditError):
            model.add_tile(sample(), **tile(), position=9)

    def test_remove(self):
        self.assertEqual(ids(model.remove_tile(sample(), "alpha")), ["beta"])

    def test_remove_unknown_lists_known_ids(self):
        with self.assertRaises(EditError) as ctx:
            model.remove_tile(sample(), "nope")
        self.assertIn("alpha", str(ctx.exception))

    def test_cannot_remove_the_last_visible_tile(self):
        c = model.set_tile_visible(sample(), "beta", False)
        with self.assertRaises(EditError):
            model.remove_tile(c, "alpha")
        with self.assertRaises(EditError):
            model.set_tile_visible(c, "alpha", False)

    def test_move(self):
        c = model.add_tile(sample(), **tile())
        self.assertEqual(ids(model.move_tile(c, "gamma", 1)), ["gamma", "alpha", "beta"])
        self.assertEqual(ids(model.move_tile(c, "alpha", 3)), ["beta", "gamma", "alpha"])
        self.assertEqual(ids(model.move_tile(c, "beta", 2)), ["alpha", "beta", "gamma"])
        with self.assertRaises(EditError):
            model.move_tile(c, "alpha", 4)

    def test_update(self):
        c = model.update_tile(sample(), "alpha", title="Changed", kids="")
        t = c["home"]["map"]["tiles"][0]
        self.assertEqual((t["title"], t["kids"], t["label"]), ("Changed", "", "Alpha"))

    def test_update_refuses_unknown_fields_and_id_change(self):
        with self.assertRaises(EditError):
            model.update_tile(sample(), "alpha", id="other")
        with self.assertRaises(EditError):
            model.update_tile(sample(), "alpha", visible=False)
        with self.assertRaises(EditError):
            model.update_tile(sample(), "alpha")

    def test_hide_and_show(self):
        c = model.set_tile_visible(sample(), "alpha", False)
        self.assertFalse(c["home"]["map"]["tiles"][0]["visible"])
        c = model.set_tile_visible(c, "alpha", True)
        self.assertTrue(c["home"]["map"]["tiles"][0]["visible"])


class RepoTests(unittest.TestCase):
    def add(self, config=None, **kw):
        args = dict(id="two", name="Two", url="https://github.com/o/two", description="Second.")
        args.update(kw)
        return model.add_repo(config or sample(), **args)

    def test_add_with_stack_and_page(self):
        c = self.add(stack=["Go", "SQL"], page="techbot.html")
        repo = c["github"]["repos"][-1]
        self.assertEqual((repo["stack"], repo["page"]), (["Go", "SQL"], "techbot.html"))

    def test_add_without_page_has_no_page_key(self):
        self.assertNotIn("page", self.add()["github"]["repos"][-1])

    def test_add_duplicate_and_invalid(self):
        with self.assertRaises(EditError):
            self.add(id="one")
        with self.assertRaises(EditError):
            self.add(url="not a url")
        with self.assertRaises(EditError):
            self.add(url="javascript:alert(1)")
        with self.assertRaises(EditError):
            self.add(page="https://evil.example")

    def test_remove_last_repo_is_allowed(self):
        self.assertEqual(model.remove_repo(sample(), "one")["github"]["repos"], [])

    def test_update_and_clear(self):
        c = model.update_repo(sample(), "one", description="New text.", stack=["A"], page="")
        repo = c["github"]["repos"][0]
        self.assertEqual((repo["description"], repo["stack"]), ("New text.", ["A"]))
        self.assertNotIn("page", repo)

    def test_hide_show(self):
        c = model.set_repo_visible(sample(), "one", False)
        self.assertFalse(c["github"]["repos"][0]["visible"])

    def test_set_github(self):
        c = model.set_github(sample(), title="Open code.")
        self.assertEqual(c["github"]["title"], "Open code.")
        with self.assertRaises(EditError):
            model.set_github(sample(), colour="x")


if __name__ == "__main__":
    unittest.main()
