"""The plans page: validation, edits, rendering."""

import re
import unittest

from beyondia_manager import config as cfg
from beyondia_manager import model, render
from beyondia_manager.errors import EditError
from .helpers import sample
from .test_render import tags_of

HOSTILE = '<script>alert(1)</script> "quote" & {{title}}'


def lane_ids(c):
    return [lane["id"] for lane in c["plans"]["lanes"]]


def plan_ids(c, lane):
    return [p["id"] for p in next(l for l in c["plans"]["lanes"] if l["id"] == lane)["items"]]


def step_ids(c):
    return [s["id"] for s in c["plans"]["roadmap"]["steps"]]


def problems_for(mutate):
    data = sample()
    mutate(data)
    return cfg.validate(data)


class ValidationTests(unittest.TestCase):
    def test_sample_is_valid(self):
        self.assertEqual(cfg.validate(sample()), [])

    def test_plans_section_is_required(self):
        data = sample()
        del data["plans"]
        self.assertTrue(any("plans" in p for p in cfg.validate(data)))

    def test_lane_count_limits(self):
        self.assertTrue(problems_for(lambda d: d["plans"].update(lanes=[])))
        four = lambda d: d["plans"]["lanes"].extend({"id": f"x{i}", "label": "X", "items": []} for i in range(2))
        self.assertTrue(any("between 1 and 3" in p for p in problems_for(four)))

    def test_a_lane_may_be_empty(self):
        self.assertEqual(problems_for(lambda d: d["plans"]["lanes"][1].update(items=[])), [])

    def test_item_limits(self):
        self.assertTrue(problems_for(lambda d: d["plans"]["lanes"][0].update(items=[d["plans"]["lanes"][0]["items"][0]] * 13)))

    def test_plan_ids_are_unique_across_lanes(self):
        def mutate(d):
            d["plans"]["lanes"][1]["items"][0]["id"] = "book"
        problems = problems_for(mutate)
        self.assertTrue(any("already used" in p for p in problems), problems)

    def test_lane_and_step_ids_unique(self):
        self.assertTrue(any("used twice" in p for p in problems_for(lambda d: d["plans"]["lanes"][1].update(id="writing"))))
        self.assertTrue(any("used twice" in p for p in problems_for(lambda d: d["plans"]["roadmap"]["steps"][1].update(id="first"))))

    def test_field_rules_report_their_paths(self):
        def mutate(d):
            d["plans"]["lanes"][0]["items"][1]["status"] = "x" * 30
            d["plans"]["roadmap"]["steps"][0]["when"] = ""
            d["plans"]["roadmap"]["steps"][1]["visible"] = "yes"
        problems = problems_for(mutate)
        self.assertTrue(any(p.startswith("plans.lanes[0].items[1].status") for p in problems))
        self.assertTrue(any(p.startswith("plans.roadmap.steps[0].when") for p in problems))
        self.assertTrue(any(p.startswith("plans.roadmap.steps[1].visible") for p in problems))

    def test_empty_roadmap_is_allowed(self):
        self.assertEqual(problems_for(lambda d: d["plans"]["roadmap"].update(steps=[])), [])


class ModelTests(unittest.TestCase):
    def test_input_never_changed(self):
        import copy
        original = sample()
        frozen = copy.deepcopy(original)
        model.set_plans(original, title="New")
        model.add_lane(original, id="x", label="X")
        model.add_plan(original, lane_id="writing", id="p", title="t", text="t", status="Live")
        model.relane_plan(original, "book", "building")
        model.add_step(original, id="s", when="w", title="t", text="t", status="Live")
        self.assertEqual(original, frozen)

    def test_set_plans(self):
        c = model.set_plans(sample(), title="New title.", roadmap_intro="New intro.")
        self.assertEqual((c["plans"]["title"], c["plans"]["roadmap"]["intro"]), ("New title.", "New intro."))
        with self.assertRaises(EditError):
            model.set_plans(sample(), colour="x")
        with self.assertRaises(EditError):
            model.set_plans(sample(), title="")

    # lanes
    def test_lane_lifecycle(self):
        c = model.add_lane(sample(), id="ideas", label="Ideas")
        self.assertEqual(lane_ids(c), ["writing", "building", "ideas"])
        c = model.move_lane(c, "ideas", 1)
        self.assertEqual(lane_ids(c), ["ideas", "writing", "building"])
        c = model.update_lane(c, "ideas", label="Thoughts")
        self.assertEqual(c["plans"]["lanes"][0]["label"], "Thoughts")
        c = model.remove_lane(c, "ideas")
        self.assertEqual(lane_ids(c), ["writing", "building"])

    def test_lane_errors(self):
        with self.assertRaises(EditError):
            model.add_lane(sample(), id="writing", label="Dup")
        c = model.add_lane(sample(), id="ideas", label="Ideas")
        with self.assertRaises(EditError):
            model.add_lane(c, id="more", label="Fourth lane")          # at most three
        with self.assertRaises(EditError):
            model.move_lane(sample(), "writing", 5)
        with self.assertRaises(EditError):
            model.update_lane(sample(), "writing", id="other")

    def test_a_lane_with_plans_is_not_removed_by_accident(self):
        with self.assertRaises(EditError) as ctx:
            model.remove_lane(sample(), "writing")
        self.assertIn("2 plan", str(ctx.exception))

    def test_the_last_lane_cannot_be_removed(self):
        c = model.remove_plan(sample(), "site")
        c = model.remove_lane(c, "building")
        c = model.remove_plan(model.remove_plan(c, "book"), "essay")
        with self.assertRaises(EditError):
            model.remove_lane(c, "writing")

    # plans
    def test_plan_lifecycle(self):
        c = model.add_plan(sample(), lane_id="building", id="bot", title="Bot", text="Text.", status="Live", position=1)
        self.assertEqual(plan_ids(c, "building"), ["bot", "site"])
        c = model.move_plan(c, "bot", 2)
        self.assertEqual(plan_ids(c, "building"), ["site", "bot"])
        c = model.update_plan(c, "bot", status="Done")
        self.assertEqual(c["plans"]["lanes"][1]["items"][1]["status"], "Done")
        c = model.set_plan_visible(c, "bot", False)
        self.assertFalse(c["plans"]["lanes"][1]["items"][1]["visible"])
        c = model.remove_plan(c, "bot")
        self.assertEqual(plan_ids(c, "building"), ["site"])

    def test_plan_errors(self):
        with self.assertRaises(EditError):
            model.add_plan(sample(), lane_id="nope", id="x", title="t", text="t", status="s")
        with self.assertRaises(EditError):
            model.add_plan(sample(), lane_id="writing", id="site", title="t", text="t", status="s")   # id used in another lane
        with self.assertRaises(EditError):
            model.add_plan(sample(), lane_id="writing", id="x", title="", text="t", status="s")
        with self.assertRaises(EditError):
            model.remove_plan(sample(), "nope")
        with self.assertRaises(EditError):
            model.move_plan(sample(), "book", 3)
        with self.assertRaises(EditError):
            model.update_plan(sample(), "book", id="other")

    def test_relane(self):
        c = model.relane_plan(sample(), "book", "building")
        self.assertEqual(plan_ids(c, "writing"), ["essay"])
        self.assertEqual(plan_ids(c, "building"), ["site", "book"])
        c = model.relane_plan(c, "book", "writing", position=1)
        self.assertEqual(plan_ids(c, "writing"), ["book", "essay"])
        with self.assertRaises(EditError):
            model.relane_plan(sample(), "book", "nope")
        with self.assertRaises(EditError):
            model.relane_plan(sample(), "nope", "building")

    def test_failed_relane_loses_nothing(self):
        before = sample()
        with self.assertRaises(EditError):
            model.relane_plan(before, "book", "building", position=9)
        self.assertEqual(plan_ids(before, "writing"), ["book", "essay"])

    # steps
    def test_step_lifecycle(self):
        c = model.add_step(sample(), id="third", when="2027", title="T", text="t", status="Open")
        self.assertEqual(step_ids(c), ["first", "second", "third"])
        c = model.move_step(c, "third", 1)
        self.assertEqual(step_ids(c), ["third", "first", "second"])
        c = model.update_step(c, "third", when="2028")
        self.assertEqual(c["plans"]["roadmap"]["steps"][0]["when"], "2028")
        c = model.set_step_visible(c, "third", False)
        self.assertFalse(c["plans"]["roadmap"]["steps"][0]["visible"])
        c = model.remove_step(c, "third")
        self.assertEqual(step_ids(c), ["first", "second"])

    def test_step_errors(self):
        with self.assertRaises(EditError):
            model.add_step(sample(), id="first", when="w", title="t", text="t", status="s")
        with self.assertRaises(EditError):
            model.remove_step(sample(), "nope")
        with self.assertRaises(EditError):
            model.update_step(sample(), "first", visible=False)

    def test_all_steps_may_be_removed(self):
        c = model.remove_step(model.remove_step(sample(), "first"), "second")
        self.assertEqual(step_ids(c), [])


class RenderTests(unittest.TestCase):
    def test_contains_the_content(self):
        html = render.render_plans(sample())
        for text in ("Plans title.", "Plans lead.", "Writing", "The book", "Essay text.", "Live", "The road", "Next, in order.",
                     "Intro to the road.", "Tomorrow", "First step", "Second text."):
            self.assertIn(text, html)
        self.assertIn("Testland — plans", html)

    def test_no_placeholders_left_and_deterministic(self):
        html = render.render_plans(sample())
        self.assertIsNone(re.search(r"\{\{\w+\}\}", html))
        self.assertEqual(html, render.render_plans(sample()))

    def test_current_page_marked_in_navigation(self):
        html = render.render_plans(sample())
        self.assertIn('<a href="plans.html" class="on">PLANS</a>', html)
        self.assertEqual(html.count('class="on"'), 1)

    def test_structure(self):
        parsed = tags_of(render.render_plans(sample()))
        self.assertEqual(parsed.tags.count("h1"), 1)
        self.assertEqual(parsed.tags.count("title"), 1)

    def test_lane_order_and_item_order_follow_config(self):
        c = model.move_lane(sample(), "building", 1)
        c = model.move_plan(c, "book", 2)
        html = render.render_plans(c)
        self.assertLess(html.index("Building"), html.index("Writing"))
        self.assertLess(html.index("The essay"), html.index("The book"))

    def test_hidden_plan_and_step_not_rendered(self):
        c = model.set_plan_visible(sample(), "book", False)
        c = model.set_step_visible(c, "first", False)
        html = render.render_plans(c)
        self.assertNotIn("The book", html)
        self.assertNotIn("First step", html)
        self.assertIn("The essay", html)

    def test_empty_states(self):
        c = model.set_plan_visible(sample(), "site", False)
        c = model.remove_step(model.remove_step(c, "first"), "second")
        html = render.render_plans(c)
        self.assertIn("Nothing is listed here yet.", html)
        self.assertIn("No steps are planned yet.", html)

    def test_lane_count_is_preserved(self):
        self.assertEqual(render.render_plans(sample()).count('class="lane"'), 2)

    def test_hostile_text_is_inert(self):
        c = sample()
        p = c["plans"]
        p["title"] = p["lead"] = HOSTILE
        p["lanes"][0]["label"] = HOSTILE
        p["lanes"][0]["items"][0].update(title=HOSTILE, text=HOSTILE, status=HOSTILE)
        p["roadmap"].update(kicker=HOSTILE, title=HOSTILE, intro=HOSTILE)
        p["roadmap"]["steps"][0].update(when=HOSTILE, title=HOSTILE, text=HOSTILE, status=HOSTILE)
        html = render.render_plans(c)
        self.assertNotIn("<script>alert", html)
        self.assertEqual(tags_of(html).tags.count("script"), 0)
        self.assertIn("{{title}}", html)


if __name__ == "__main__":
    unittest.main()
