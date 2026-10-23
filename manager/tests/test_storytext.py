import json
import unittest

from beyondia_manager import storytext as st
from beyondia_manager.errors import EditError
from .helpers import SITE_DIR


class ParseTests(unittest.TestCase):
    def test_every_syntax(self):
        text = "> muted\n\n## Heading\n\n# Chapter 1\n\n[1:1] Verse one.\n\nPlain paragraph."
        self.assertEqual(st.parse(text), [
            {"type": "note", "text": "muted"}, {"type": "heading", "text": "Heading"}, {"type": "chapter", "text": "Chapter 1"},
            {"type": "verse", "ref": "1:1", "paras": ["Verse one."]}, {"type": "p", "text": "Plain paragraph."},
        ])

    def test_lines_of_one_paragraph_are_joined(self):
        self.assertEqual(st.parse("one\ntwo\n   three"), [{"type": "p", "text": "one two three"}])

    def test_any_amount_of_blank_space_between_blocks(self):
        self.assertEqual(len(st.parse("\n\n\na\n\n\n\n\nb\n\n")), 2)
        self.assertEqual(st.parse(""), [])
        self.assertEqual(st.parse("   \n \n"), [])

    def test_windows_and_old_mac_line_endings(self):
        self.assertEqual(len(st.parse("a\r\n\r\nb\r\rc")), 3)

    def test_verse_continuation_with_or_without_blank_line(self):
        for text in ("[1:1] a\n+ b\n+ c", "[1:1] a\n\n+ b\n\n+ c"):
            self.assertEqual(st.parse(text), [{"type": "verse", "ref": "1:1", "paras": ["a", "b", "c"]}])

    def test_continuation_without_a_verse_is_an_error_with_a_line_number(self):
        with self.assertRaises(EditError) as ctx:
            st.parse("A paragraph.\n\n+ stray")
        self.assertIn("line 3", str(ctx.exception))

    def test_empty_markers_are_errors(self):
        for bad in ("#", "##", "> ", "# \n"):
            with self.subTest(bad=bad):
                with self.assertRaises(EditError):
                    st.parse(bad)

    def test_escape_makes_a_special_character_literal(self):
        self.assertEqual(st.parse("\\# not a chapter"), [{"type": "p", "text": "# not a chapter"}])
        self.assertEqual(st.parse("\\> not a note"), [{"type": "p", "text": "> not a note"}])
        self.assertEqual(st.parse("\\+ not a verse part"), [{"type": "p", "text": "+ not a verse part"}])
        self.assertEqual(st.parse("\\[Next story]"), [{"type": "p", "text": "[Next story]"}])

    def test_brackets_that_are_not_a_verse_stay_plain(self):
        self.assertEqual(st.parse("[Next story] soon"), [{"type": "p", "text": "[Next story] soon"}])

    def test_a_dash_start_is_plain(self):
        self.assertEqual(st.parse("– The girl is beautiful."), [{"type": "p", "text": "– The girl is beautiful."}])

    def test_non_text_is_refused(self):
        with self.assertRaises(EditError):
            st.parse(None)

    def test_unicode(self):
        self.assertEqual(st.parse("Ідея — понад усе")[0]["text"], "Ідея — понад усе")


class DumpTests(unittest.TestCase):
    def test_dump_format(self):
        blocks = [{"type": "chapter", "text": "C"}, {"type": "verse", "ref": "2:1", "paras": ["a", "b"]}, {"type": "p", "text": "# odd"}]
        self.assertEqual(st.dump(blocks), "# C\n\n[2:1] a\n\n+ b\n\n\\# odd\n")

    def test_empty(self):
        self.assertEqual(st.dump([]), "")

    def test_unknown_block_type(self):
        with self.assertRaises(EditError):
            st.dump([{"type": "video"}])

    def test_summary(self):
        blocks = st.parse("> n\n\np\n\n## h\n\n# c\n\n[1:1] v")
        self.assertEqual(st.summary(blocks), "2 paragraph(s), 1 heading(s), 1 chapter(s), 1 verse(s)")


class RoundTripTests(unittest.TestCase):
    def test_tricky_texts_survive(self):
        for text in ["# starts with hash", "> starts with quote", "+ starts with plus", "[1:1] looks like a verse",
                     "\\ starts with backslash", "\\# already escaped-looking", "a # in the middle", "- dash", "  padded  "]:
            with self.subTest(text=text):
                blocks = [{"type": "p", "text": text.strip()}]
                self.assertEqual(st.parse(st.dump(blocks)), blocks)

    def test_every_block_type_together(self):
        blocks = [{"type": "heading", "text": "H"}, {"type": "note", "text": "n"}, {"type": "chapter", "text": "C"},
                  {"type": "verse", "ref": "1:1", "paras": ["a", "b", "c"]}, {"type": "verse", "ref": "1:2", "paras": ["d"]},
                  {"type": "p", "text": "p"}]
        self.assertEqual(st.parse(st.dump(blocks)), blocks)

    def test_dump_is_stable(self):
        blocks = st.parse("# C\n\n[1:1] a\n+ b\n\np")
        once = st.dump(blocks)
        self.assertEqual(st.dump(st.parse(once)), once)

    def test_every_real_story_survives_editing(self):
        """Opening a story in the editor and saving it unchanged must change nothing."""
        config = json.loads((SITE_DIR / "site.config.json").read_text(encoding="utf-8"))
        self.assertTrue(config["stories"]["items"])
        for item in config["stories"]["items"] + config["blog"]["items"]:
            with self.subTest(item=item["id"]):
                self.assertEqual(st.parse(st.dump(item["body"])), item["body"])


if __name__ == "__main__":
    unittest.main()
