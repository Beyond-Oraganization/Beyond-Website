"""Stories: validation, edits, rendering, the stories count, and page files coming and going."""

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
NEW = dict(id="lighthouse", title="The Lighthouse", summary="A keeper and a light.", aside="A light that stays.",
           body_text="A keeper lived alone.\n\nThe light never went out.")


def ids(c):
    return [s["id"] for s in c["stories"]["items"]]


def problems_for(mutate):
    data = sample()
    mutate(data)
    return cfg.validate(data)


class ValidationTests(unittest.TestCase):
    def test_sample_is_valid(self):
        self.assertEqual(cfg.validate(sample()), [])

    def test_section_required(self):
        data = sample()
        del data["stories"]
        self.assertTrue(any("stories" in p for p in cfg.validate(data)))

    def test_file_names_are_confined_to_story_pages(self):
        """A story must never be able to overwrite another page of the site."""
        for bad in ("index.html", "plans.html", "stories.html", "github.html", "../story.html", "story.txt", "Story.html",
                    "story/x.html", "story x.html", "storyx.html/", "/storyx.html", "", None, 5, "story" + "x" * 60 + ".html"):
            with self.subTest(file=bad):
                problems = problems_for(lambda d: d["stories"]["items"][0].update(file=bad))
                self.assertTrue(any(".file" in p for p in problems), problems)
        self.assertEqual(problems_for(lambda d: d["stories"]["items"][0].update(file="storyangel2.html")), [])

    def test_duplicate_files_and_ids(self):
        self.assertTrue(any("already used" in p for p in problems_for(lambda d: d["stories"]["items"][1].update(file="storyangel.html"))))
        self.assertTrue(any("used twice" in p for p in problems_for(lambda d: d["stories"]["items"][1].update(id="angel"))))

    def test_kind_and_texts(self):
        self.assertTrue(problems_for(lambda d: d["stories"]["items"][0].update(kind="poem")))
        for name, bad in (("title", ""), ("tag", "x" * 40), ("summary", "a\nb"), ("aside", "x" * 130)):
            with self.subTest(field=name):
                self.assertTrue(problems_for(lambda d: d["stories"]["items"][0].update({name: bad})))

    def test_body_rules(self):
        self.assertTrue(problems_for(lambda d: d["stories"]["items"][0].update(body=[])))
        self.assertTrue(problems_for(lambda d: d["stories"]["items"][0].update(body=[{"type": "video"}])))
        self.assertTrue(problems_for(lambda d: d["stories"]["items"][0].update(body=[{"type": "p", "text": "a\nb"}])))
        self.assertTrue(problems_for(lambda d: d["stories"]["items"][0].update(body=[{"type": "p", "text": "x" * 9000}])))
        self.assertTrue(problems_for(lambda d: d["stories"]["items"][0].update(body=[{"type": "verse", "ref": "bad ref!", "paras": ["x"]}])))
        self.assertTrue(problems_for(lambda d: d["stories"]["items"][0].update(body=[{"type": "verse", "ref": "1:1", "paras": []}])))
        self.assertTrue(problems_for(lambda d: d["stories"]["items"][0].update(body=["just text"])))

    def test_no_stories_is_allowed(self):
        self.assertEqual(problems_for(lambda d: d["stories"].update(items=[])), [])

    def test_problem_paths_are_precise(self):
        problems = problems_for(lambda d: d["stories"]["items"][1]["body"][2]["paras"].__setitem__(1, ""))
        self.assertTrue(any(p.startswith("stories.items[1].body[2].paras[1]") for p in problems), problems)


class ModelTests(unittest.TestCase):
    def test_input_never_changed(self):
        original = sample()
        frozen = copy.deepcopy(original)
        model.set_stories(original, title="New")
        model.add_story(original, **NEW)
        model.update_story(original, "angel", body_text="Changed.")
        model.remove_story(original, "angel")
        self.assertEqual(original, frozen)

    def test_set_stories(self):
        self.assertEqual(model.set_stories(sample(), title="New title.")["stories"]["title"], "New title.")
        with self.assertRaises(EditError):
            model.set_stories(sample(), colour="x")

    def test_add_derives_the_file_and_parses_the_body(self):
        c = model.add_story(sample(), **NEW)
        story = c["stories"]["items"][-1]
        self.assertEqual(story["file"], "storylighthouse.html")
        self.assertEqual(story["kind"], "story")
        self.assertEqual(story["body"], [{"type": "p", "text": "A keeper lived alone."}, {"type": "p", "text": "The light never went out."}])

    def test_file_name_ignores_hyphens_but_never_collides(self):
        c = model.add_story(sample(), **{**NEW, "id": "my-tale"})
        self.assertEqual(c["stories"]["items"][-1]["file"], "storymytale.html")
        with self.assertRaises(EditError) as ctx:
            model.add_story(c, **{**NEW, "id": "mytale"})              # would map to the same page
        self.assertIn("storymytale.html", str(ctx.exception))

    def test_add_positions_and_errors(self):
        self.assertEqual(ids(model.add_story(sample(), **NEW, position=1)), ["lighthouse", "angel", "roman"])
        with self.assertRaises(EditError):
            model.add_story(sample(), **{**NEW, "id": "angel"})
        with self.assertRaises(EditError):
            model.add_story(sample(), **{**NEW, "body_text": "   "})         # empty body
        with self.assertRaises(EditError):
            model.add_story(sample(), **{**NEW, "body_text": "+ stray"})
        with self.assertRaises(EditError):
            model.add_story(sample(), **{**NEW, "kind": "poem"})
        with self.assertRaises(EditError):
            model.add_story(sample(), **{**NEW, "id": "Bad Id"})

    def test_add_a_draft(self):
        self.assertFalse(model.add_story(sample(), **NEW, visible=False)["stories"]["items"][-1]["visible"])

    def test_update(self):
        c = model.update_story(sample(), "angel", title="New title", body_text="# Chapter\n\n[1:1] Verse.", kind="verses")
        story = c["stories"]["items"][0]
        self.assertEqual((story["title"], story["kind"]), ("New title", "verses"))
        self.assertEqual(story["body"], [{"type": "chapter", "text": "Chapter"}, {"type": "verse", "ref": "1:1", "paras": ["Verse."]}])
        self.assertEqual(story["file"], "storyangel.html")               # the page address never changes

    def test_update_refuses(self):
        for fields in ({"file": "x.html"}, {"id": "other"}, {"visible": False}, {}):
            with self.subTest(fields=fields):
                with self.assertRaises(EditError):
                    model.update_story(sample(), "angel", **fields)
        with self.assertRaises(EditError):
            model.update_story(sample(), "angel", body_text="")

    def test_move_remove_visible(self):
        self.assertEqual(ids(model.move_story(sample(), "roman", 1)), ["roman", "angel"])
        self.assertEqual(ids(model.remove_story(sample(), "angel")), ["roman"])
        self.assertFalse(model.set_story_visible(sample(), "angel", False)["stories"]["items"][0]["visible"])
        with self.assertRaises(EditError):
            model.remove_story(sample(), "nope")
        with self.assertRaises(EditError):
            model.move_story(sample(), "angel", 5)


class RenderTests(unittest.TestCase):
    def test_list_page(self):
        html = render.render_stories(sample())
        for text in ("Stories title.", "Stories lead.", "The Angel", "An angel summary.", "#Tag", "Read the story", "Read the verses", "storyroman.html"):
            self.assertIn(text, html)
        self.assertIn('<a href="stories.html" class="on">STORIES</a>', html)
        self.assertIsNone(re.search(r"\{\{\w+\}\}", html))

    def test_empty_list(self):
        c = sample()
        c["stories"]["items"] = []
        self.assertIn("No stories are published yet.", render.render_stories(c))

    def test_drafts_are_not_listed_and_have_no_page(self):
        c = model.set_story_visible(sample(), "roman", False)
        self.assertNotIn("The Book", render.render_stories(c))
        self.assertEqual(sorted(render.render_story_pages(c)), ["storyangel.html"])

    def test_every_block_type_is_rendered(self):
        c = sample()
        html = render.render_story(c, c["stories"]["items"][0])
        self.assertIn('<p class="mute">A muted opening.</p>', html)
        self.assertIn("<p>First paragraph.</p>", html)
        self.assertIn('<h2 class="h3" style="margin: 56px 0 24px">A heading</h2>', html)
        verses = render.render_story(c, c["stories"]["items"][1])
        self.assertIn('<h2 class="chapter">Chapter 1</h2>', verses)
        self.assertIn('<div class="verse"><span class="label">1:1</span><p>Verse one.</p></div>', verses)
        self.assertIn('<p style="margin-top: 24px">Verse two b.</p>', verses)

    def test_a_heading_that_opens_the_story_has_the_tight_margin(self):
        c = model.update_story(sample(), "angel", body_text="## Introduction\n\nText.")
        self.assertIn('style="margin-bottom: 24px">Introduction', render.render_story(c, c["stories"]["items"][0]))

    def test_pager_chain(self):
        c = model.add_story(sample(), **NEW)
        first, middle, last = (render.render_story(c, s) for s in c["stories"]["items"])
        self.assertIn(">All stories<", first); self.assertIn(">The Book<", first)                  # no previous: back to the list
        self.assertIn(">The Angel<", middle); self.assertIn(">The Lighthouse<", middle)
        self.assertIn(">The Book<", last); self.assertEqual(last.count(">All stories<"), 1)       # no next: back to the list

    def test_a_single_visible_story_links_back_on_both_sides(self):
        c = model.set_story_visible(sample(), "roman", False)
        html = render.render_story(c, c["stories"]["items"][0])
        self.assertEqual(html.count(">All stories<"), 2)

    def test_hiding_a_story_relinks_its_neighbours(self):
        c = model.add_story(sample(), **NEW)
        c = model.set_story_visible(c, "roman", False)
        angel = render.render_story(c, c["stories"]["items"][0])
        self.assertIn(">The Lighthouse<", angel)
        self.assertNotIn(">The Book<", angel)

    def test_page_structure_and_title(self):
        c = sample()
        html = render.render_story(c, c["stories"]["items"][0])
        parsed = tags_of(html)
        self.assertEqual(parsed.tags.count("h1"), 1)
        self.assertIn("<title>Testland — The Angel</title>", html)
        self.assertIn("Generated by the Beyondia site manager", html)

    def test_hostile_text_is_inert(self):
        c = sample()
        s = c["stories"]["items"][1]
        c["stories"]["title"] = c["stories"]["lead"] = s["title"] = s["tag"] = s["summary"] = s["aside"] = HOSTILE
        s["body"] = [{"type": "heading", "text": HOSTILE}, {"type": "chapter", "text": HOSTILE}, {"type": "note", "text": HOSTILE},
                     {"type": "p", "text": HOSTILE}, {"type": "verse", "ref": "1:1", "paras": [HOSTILE, HOSTILE]}]
        for html in (render.render_stories(c), render.render_story(c, s)):
            self.assertNotIn("<script>alert", html)
            self.assertEqual(tags_of(html).tags.count("script"), 0)

    def test_deterministic(self):
        self.assertEqual(render.render_story_pages(sample()), render.render_story_pages(sample()))


class CountTokenTests(unittest.TestCase):
    def tile_text(self, config):
        c = copy.deepcopy(config)
        c["home"]["map"]["tiles"][0].update(text="{Stories} stories so far.", kids="Rooms: {stories} stories")
        return render.render_home(c)

    def test_words_follow_published_stories(self):
        self.assertIn("Two stories so far.", self.tile_text(sample()))
        self.assertIn("Rooms: two stories", self.tile_text(sample()))
        self.assertIn("Three stories so far.", self.tile_text(model.add_story(sample(), **NEW)))
        self.assertIn("One stories so far.", self.tile_text(model.set_story_visible(sample(), "roman", False)))

    def test_without_the_token_text_is_untouched(self):
        self.assertIn("Alpha text.", render.render_home(sample()))


class OrphanTests(TempDirCase):
    """Story pages leave the site when their story does; hand-written pages never do."""

    def test_removed_story_page_is_deleted(self):
        builder.build(self.tmp, sample())
        self.assertTrue((self.tmp / "storyroman.html").exists())
        result = builder.build(self.tmp, model.remove_story(sample(), "roman"))
        self.assertEqual(result.removed, ["storyroman.html"])
        self.assertFalse((self.tmp / "storyroman.html").exists())
        self.assertTrue((self.tmp / "storyangel.html").exists())

    def test_hidden_story_page_is_deleted_and_comes_back(self):
        builder.build(self.tmp, sample())
        builder.build(self.tmp, model.set_story_visible(sample(), "roman", False))
        self.assertFalse((self.tmp / "storyroman.html").exists())
        builder.build(self.tmp, sample())
        self.assertTrue((self.tmp / "storyroman.html").exists())

    def test_check_mode_reports_a_pending_deletion_and_deletes_nothing(self):
        builder.build(self.tmp, sample())
        result = builder.build(self.tmp, model.remove_story(sample(), "roman"), check=True)
        self.assertEqual(result.removed, ["storyroman.html"])
        self.assertIn("storyroman.html (to delete)", result.stale)
        self.assertTrue((self.tmp / "storyroman.html").exists())

    def test_hand_written_pages_are_never_deleted(self):
        builder.build(self.tmp, sample())
        (self.tmp / "storynotes.html").write_text("<html>mine, no generated comment</html>", encoding="utf-8")
        (self.tmp / "about.html").write_text("<html>mine</html>", encoding="utf-8")
        builder.build(self.tmp, model.remove_story(sample(), "roman"))
        self.assertTrue((self.tmp / "storynotes.html").exists())
        self.assertTrue((self.tmp / "about.html").exists())

    def test_only_names_the_manager_could_have_generated_are_deleted(self):
        builder.build(self.tmp, sample())
        marked = (self.tmp / "storyangel.html").read_text(encoding="utf-8")
        (self.tmp / "storyOdd.html").write_text(marked, encoding="utf-8")          # carries the comment, but not a name we generate
        (self.tmp / "story.v2.html").write_text(marked, encoding="utf-8")
        builder.build(self.tmp, model.remove_story(sample(), "roman"))
        self.assertTrue((self.tmp / "storyOdd.html").exists())
        self.assertTrue((self.tmp / "story.v2.html").exists())

    def test_non_story_generated_pages_are_never_deleted(self):
        builder.build(self.tmp, sample())
        for name in ("index.html", "plans.html", "github.html", "stories.html"):
            self.assertTrue((self.tmp / name).exists())
        builder.build(self.tmp, model.remove_story(model.remove_story(sample(), "roman"), "angel"))
        for name in ("index.html", "plans.html", "github.html", "stories.html"):
            self.assertTrue((self.tmp / name).exists(), name)

    def test_second_build_after_deletion_is_a_no_op(self):
        builder.build(self.tmp, sample())
        c = model.remove_story(sample(), "roman")
        builder.build(self.tmp, c)
        again = builder.build(self.tmp, c)
        self.assertEqual((again.changed, again.removed), ([], []))


if __name__ == "__main__":
    unittest.main()
