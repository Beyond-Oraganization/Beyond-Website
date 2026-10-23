"""The web interface: the operation table, and the real HTTP server on a random port."""

import http.client
import json
import re
import threading
import unittest
from pathlib import Path

from beyondia_manager import config as cfg
from beyondia_manager import web
from beyondia_manager.errors import EditError
from .helpers import GitCase, TempDirCase, copy_fixture_site, git, sample

TOKEN = "test-token"
UI_SOURCE = Path(web.UI_FILE).read_text(encoding="utf-8")


class Client:
    def __init__(self, server):
        self.port = server.server_address[1]

    def request(self, method, path, body=None, headers=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        hdrs = {"Host": f"127.0.0.1:{self.port}"}
        hdrs.update(headers or {})
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        conn.request(method, path, body=data, headers=hdrs)
        res = conn.getresponse()
        payload = res.read()
        conn.close()
        return res.status, dict(res.getheaders()), payload

    def post(self, path, body, token=TOKEN, **extra):
        headers = {"Content-Type": "application/json"}
        if token is not None:
            headers["X-BM-Token"] = token
        headers.update(extra)
        status, hdrs, payload = self.request("POST", path, body, headers)
        return status, json.loads(payload)

    def edit(self, op, params=None):
        return self.post("/api/edit", {"op": op, "params": params or {}})

    def state(self):
        status, _h, payload = self.request("GET", "/api/state")
        return json.loads(payload)


class ServerCase(TempDirCase):
    def setUp(self):
        super().setUp()
        self.site = copy_fixture_site(self.tmp / "site")
        self.start()

    def start(self):
        self.server = web.make_server(self.site, port=0, token=TOKEN)
        thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.01), daemon=True)
        thread.start()
        self.addCleanup(lambda: (self.server.shutdown(), self.server.server_close(), thread.join(5)))
        self.client = Client(self.server)

    def snapshot(self):
        return {p.name: p.read_bytes() for p in self.site.iterdir() if p.is_file()}


class OperationTableTests(unittest.TestCase):
    def test_every_operation_the_interface_uses_exists(self):
        prefixes = "home|button|ticker|tile|plans|lane|plan|step|stories|story|blog|post|github|repo"
        used = set(re.findall(r'"((?:%s)\.(?!html")[a-z]+)"' % prefixes, UI_SOURCE))
        self.assertTrue(len(used) >= 30, used)
        self.assertEqual(sorted(used - set(web.OPS)), [])

    def test_every_operation_is_used_by_the_interface(self):
        for name in web.OPS:
            self.assertIn(f'"{name}"', UI_SOURCE, f"{name} exists on the server but the interface never calls it")

    def test_applies_to_a_config(self):
        edit = web.build_edit("tile.update", {"tile_id": "alpha", "title": "New"})
        self.assertEqual(edit(sample())["home"]["map"]["tiles"][0]["title"], "New")

    def test_rejections(self):
        bad = [
            ("nope.op", {}), (None, {}), (["x"], {}),
            ("tile.remove", {}), ("tile.remove", {"tile_id": 5}), ("tile.remove", {"tile_id": "a", "extra": 1}),
            ("tile.move", {"tile_id": "a", "position": "1"}), ("tile.move", {"tile_id": "a", "position": True}),
            ("tile.visible", {"tile_id": "a", "visible": "yes"}),
            ("tile.add", {"id": "x"}), ("repo.add", {"id": "x", "name": "n", "url": "u", "description": "d", "stack": "a,b"}),
            ("home.set", {"__class__": "x"}), ("home.set", []),
        ]
        for name, params in bad:
            with self.subTest(op=name, params=params):
                with self.assertRaises(EditError):
                    web.build_edit(name, params)

    def test_no_operation_can_name_a_file_or_command(self):
        for name, op in web.OPS.items():
            for param in list(op.positional) + list(op.keyword):
                self.assertNotIn(param, ("path", "file", "command", "cmd", "args"), name)


class StateAndEditTests(ServerCase):
    def test_state(self):
        data = self.client.state()
        self.assertTrue(data["ok"])
        self.assertTrue(data["status"]["valid"])
        self.assertEqual(data["config"]["site"]["name"], "Beyondia")
        self.assertEqual(data["status"]["stale"], [])
        self.assertEqual(data["status"]["site_problems"], [])
        self.assertIsNone(data["status"]["git"])

    def test_every_operation_end_to_end(self):
        steps = [
            ("home.set", {"lead": "From the interface."}),
            ("button.add", {"label": "More", "href": "plans.html", "style": "ghost"}),
            ("button.remove", {"position": 3}),
            ("ticker.add", {"text": "Fresh phrase"}),
            ("ticker.remove", {"position": 5}),
            ("tile.add", {"id": "journal", "label": "Journal", "title": "Road notes", "text": "Posts.", "href": "stories.html", "position": 1}),
            ("tile.move", {"tile_id": "journal", "position": 2}),
            ("tile.update", {"tile_id": "journal", "title": "Road notes 2"}),
            ("tile.visible", {"tile_id": "journal", "visible": False}),
            ("tile.visible", {"tile_id": "journal", "visible": True}),
            ("tile.remove", {"tile_id": "journal"}),
            ("github.set", {"title": "Open source."}),
            ("repo.add", {"id": "docs", "name": "Docs", "url": "https://github.com/Beyond-Oraganization/Docs", "description": "Documents.", "stack": ["Markdown"], "page": None}),
            ("repo.move", {"repo_id": "docs", "position": 1}),
            ("repo.update", {"repo_id": "docs", "description": "Better docs.", "stack": []}),
            ("repo.visible", {"repo_id": "docs", "visible": False}),
            ("repo.visible", {"repo_id": "docs", "visible": True}),
            ("repo.remove", {"repo_id": "docs"}),
        ]
        for op, params in steps:
            with self.subTest(op=op, params=params):
                status, body = self.client.edit(op, params)
                self.assertEqual(status, 200, body)
                self.assertTrue(body["ok"])
                self.assertEqual(body["status"]["stale"], [])           # pages were rebuilt in the same request
                self.assertEqual(body["status"]["site_problems"], [])
        self.assertIn("From the interface.", (self.site / "index.html").read_text(encoding="utf-8"))
        self.assertIn("Open source.", (self.site / "github.html").read_text(encoding="utf-8"))

    def test_plans_operations_end_to_end(self):
        steps = [
            ("plans.set", {"title": "New plans title.", "roadmap_title": "New road."}),
            ("plan.add", {"lane_id": "building", "id": "bot-v2", "title": "Bot version two", "text": "A rewrite.", "status": "Planned", "position": 1}),
            ("plan.move", {"plan_id": "bot-v2", "position": 2}),
            ("plan.update", {"plan_id": "bot-v2", "status": "In progress"}),
            ("plan.relane", {"plan_id": "bot-v2", "lane_id": "writing", "position": 1}),
            ("plan.visible", {"plan_id": "bot-v2", "visible": False}),
            ("plan.visible", {"plan_id": "bot-v2", "visible": True}),
            ("plan.remove", {"plan_id": "bot-v2"}),
            ("plan.relane", {"plan_id": "nearest-plan", "lane_id": "building"}),
            ("plan.relane", {"plan_id": "video-edit-release", "lane_id": "building"}),
            ("plan.relane", {"plan_id": "decade-plan", "lane_id": "building"}),
            ("lane.remove", {"lane_id": "horizon"}),
            ("lane.add", {"id": "ideas", "label": "Ideas"}),
            ("lane.update", {"lane_id": "ideas", "label": "Thoughts"}),
            ("lane.move", {"lane_id": "ideas", "position": 1}),
            ("step.add", {"id": "launch", "when": "Autumn", "title": "Launch day", "text": "We launch.", "status": "Planned", "position": 1}),
            ("step.move", {"step_id": "launch", "position": 2}),
            ("step.update", {"step_id": "launch", "when": "Winter"}),
            ("step.visible", {"step_id": "launch", "visible": False}),
            ("step.visible", {"step_id": "launch", "visible": True}),
        ]
        for op, params in steps:
            with self.subTest(op=op, params=params):
                status, body = self.client.edit(op, params)
                self.assertEqual(status, 200, body)
                self.assertEqual(body["status"]["stale"], [])
                self.assertEqual(body["status"]["site_problems"], [])
        html = (self.site / "plans.html").read_text(encoding="utf-8")
        for text in ("New plans title.", "New road.", "Thoughts", "Launch day", "Winter"):
            self.assertIn(text, html)
        self.assertEqual(self.client.edit("lane.remove", {"lane_id": "building"})[0], 409)     # still has plans

    def test_story_operations_end_to_end(self):
        steps = [
            ("stories.set", {"title": "New stories title."}),
            ("story.add", {"id": "lighthouse", "title": "The Lighthouse", "summary": "A keeper.", "aside": "A light.", "body_text": "A keeper lived alone.\n\nThe light stayed.", "tag": "Myth"}),
            ("story.update", {"story_id": "lighthouse", "title": "The Old Lighthouse", "body_text": "# One\n\n[1:1] A verse."}),
            ("story.update", {"story_id": "lighthouse", "kind": "verses"}),
            ("story.move", {"story_id": "lighthouse", "position": 1}),
            ("story.visible", {"story_id": "lighthouse", "visible": False}),
            ("story.visible", {"story_id": "lighthouse", "visible": True}),
            ("story.remove", {"story_id": "lighthouse"}),
        ]
        for op, params in steps:
            with self.subTest(op=op):
                status, body = self.client.edit(op, params)
                self.assertEqual(status, 200, body)
                self.assertEqual(body["status"]["stale"], [])
                self.assertEqual(body["status"]["site_problems"], [])
        self.assertFalse((self.site / "storylighthouse.html").exists())
        self.assertIn("New stories title.", (self.site / "stories.html").read_text(encoding="utf-8"))

    def test_blog_operations_end_to_end(self):
        steps = [
            ("blog.set", {"title": "New blog title."}),
            ("post.add", {"id": "autumn", "title": "Autumn", "date": "2026-10-25", "summary": "Leaves.", "body_text": "Leaves fall.\n\nSee [home](index.html).", "tags": ["News"]}),
            ("post.update", {"post_id": "autumn", "title": "Late autumn", "date": "2026-11-01", "tags": ["News", "Ideas"], "body_text": "New text."}),
            ("post.visible", {"post_id": "autumn", "visible": False}),
            ("post.visible", {"post_id": "autumn", "visible": True}),
            ("post.remove", {"post_id": "autumn"}),
        ]
        for op, params in steps:
            with self.subTest(op=op):
                status, body = self.client.edit(op, params)
                self.assertEqual(status, 200, body)
                self.assertEqual(body["status"]["stale"], [])
                self.assertEqual(body["status"]["site_problems"], [])
        self.assertFalse((self.site / "blog-autumn.html").exists())
        self.assertIn("New blog title.", (self.site / "blog.html").read_text(encoding="utf-8"))

    def test_state_carries_the_editable_text_of_every_post(self):
        data = self.client.state()
        self.assertEqual(set(data["post_texts"]), {p["id"] for p in data["config"]["blog"]["items"]})
        self.assertIn("](https://github.com/Beyond-Oraganization)", data["post_texts"]["welcome"])

    def test_bad_post_requests_are_refused(self):
        for params in ({"id": "x", "title": "t", "date": "2026-02-30", "summary": "s", "body_text": "b"},
                       {"id": "x", "title": "t", "date": "2026-10-01", "summary": "s", "body_text": "[x](javascript:alert(1))"},
                       {"id": "x", "title": "t", "date": "2026-10-01", "summary": "s", "body_text": "b", "tags": "a,b"},       # wrong type
                       {"id": "x", "title": "t", "date": "2026-10-01", "summary": "s"}):                                    # missing body
            with self.subTest(params=params):
                self.assertEqual(self.client.edit("post.add", params)[0], 409)
        self.assertFalse((self.site / "blog-x.html").exists())

    def test_undo_a_post_removal_brings_the_page_back(self):
        self.client.edit("post.remove", {"post_id": "welcome"})
        self.assertFalse((self.site / "blog-welcome.html").exists())
        self.client.post("/api/undo", {})
        self.assertTrue((self.site / "blog-welcome.html").exists())

    def test_state_carries_the_editable_text_of_every_story(self):
        data = self.client.state()
        self.assertEqual(set(data["story_texts"]), {s["id"] for s in data["config"]["stories"]["items"]})
        self.assertIn("[1:1]", data["story_texts"]["roman"])
        from beyondia_manager import storytext
        self.assertEqual(storytext.parse(data["story_texts"]["roman"]), next(s for s in data["config"]["stories"]["items"] if s["id"] == "roman")["body"])

    def test_a_bad_story_body_is_refused_with_the_line_number(self):
        status, body = self.client.edit("story.update", {"story_id": "angel", "body_text": "Fine.\n\n+ stray"})
        self.assertEqual(status, 409)
        self.assertIn("line 3", body["error"])

    def test_a_long_story_fits_in_a_request(self):
        text = "\n\n".join("Paragraph %d. " % i + "word " * 200 for i in range(200))             # about 200 KB
        status, body = self.client.edit("story.update", {"story_id": "angel", "body_text": text})
        self.assertEqual(status, 200, body)
        angel = next(s for s in body["config"]["stories"]["items"] if s["id"] == "angel")
        self.assertEqual(len(angel["body"]), 200)

    # --- undo ---
    def test_undo_restores_the_previous_state_and_the_pages(self):
        before = (self.site / "index.html").read_bytes()
        self.client.edit("tile.visible", {"tile_id": "creator", "visible": False})
        self.assertNotEqual((self.site / "index.html").read_bytes(), before)
        status, body = self.client.post("/api/undo", {})
        self.assertEqual(status, 200, body)
        self.assertEqual((self.site / "index.html").read_bytes(), before)
        self.assertEqual(body["undo"], 0)

    def test_undo_walks_back_several_steps(self):
        original = self.client.state()["config"]
        self.client.edit("home.set", {"title": "One"})
        self.client.edit("home.set", {"title": "Two"})
        self.assertEqual(self.client.state()["undo"], 2)
        self.client.post("/api/undo", {})
        self.assertEqual(self.client.state()["config"]["home"]["title"], "One")
        self.client.post("/api/undo", {})
        self.assertEqual(self.client.state()["config"], original)

    def test_undo_a_story_removal_brings_the_page_back(self):
        self.client.edit("story.remove", {"story_id": "roman"})
        self.assertFalse((self.site / "storyroman.html").exists())
        self.client.post("/api/undo", {})
        self.assertTrue((self.site / "storyroman.html").exists())

    def test_nothing_to_undo(self):
        status, body = self.client.post("/api/undo", {})
        self.assertEqual(status, 409)
        self.assertIn("nothing to undo", body["error"])

    def test_a_refused_edit_leaves_no_undo_step(self):
        self.client.edit("tile.remove", {"tile_id": "nope"})
        self.assertEqual(self.client.state()["undo"], 0)

    def test_undo_refuses_to_overwrite_work_done_elsewhere(self):
        self.client.edit("home.set", {"title": "Mine"})
        import io
        from beyondia_manager import cli
        cli.main(["--site-dir", str(self.site), "home", "set", "--lead", "Changed on the command line."], out=io.StringIO(), err=io.StringIO())
        status, body = self.client.post("/api/undo", {})
        self.assertEqual(status, 409)
        self.assertIn("changed by something else", body["error"])
        self.assertEqual(self.client.state()["config"]["home"]["lead"], "Changed on the command line.")
        self.assertEqual(self.client.state()["config"]["home"]["title"], "Mine")

    def test_undo_needs_the_token_like_every_other_post(self):
        self.client.edit("home.set", {"title": "Mine"})
        self.assertEqual(self.client.post("/api/undo", {}, token="wrong")[0], 403)
        self.assertEqual(self.client.state()["config"]["home"]["title"], "Mine")

    def test_undo_history_is_bounded(self):
        for i in range(web.UNDO_DEPTH + 5):
            self.client.edit("home.set", {"title": f"T{i}"})
        self.assertEqual(self.client.state()["undo"], web.UNDO_DEPTH)

    def test_the_interface_and_the_command_line_agree(self):
        self.client.edit("tile.visible", {"tile_id": "creator", "visible": False})
        import io
        from beyondia_manager import cli
        out = io.StringIO()
        cli.main(["--site-dir", str(self.site), "tile", "list"], out=out, err=io.StringIO())
        self.assertIn("[hidden]", out.getvalue())

    def test_refused_edits_change_nothing_and_say_why(self):
        before = self.snapshot()
        cases = [
            ("tile.add", {"id": "stories", "label": "x", "title": "x", "text": "x", "href": "plans.html"}),
            ("tile.add", {"id": "evil", "label": "x", "title": "x", "text": "x", "href": "javascript:alert(1)"}),
            ("tile.remove", {"tile_id": "nope"}),
            ("home.set", {"title": ""}),
            ("repo.add", {"id": "r", "name": "r", "url": "http://", "description": "d"}),
            ("unknown.op", {}),
        ]
        for op, params in cases:
            with self.subTest(op=op):
                status, body = self.client.edit(op, params)
                self.assertEqual(status, 409)
                self.assertFalse(body["ok"])
                self.assertTrue(body["error"])
                self.assertEqual(self.snapshot(), before)

    def test_a_held_lock_is_reported(self):
        (self.site / ".bm.lock").write_text("1\n")
        status, body = self.client.edit("tile.visible", {"tile_id": "creator", "visible": False})
        self.assertEqual(status, 409)
        self.assertIn("another manager command", body["error"])

    def test_corrupt_config_is_reported_by_state_not_a_crash(self):
        (self.site / "site.config.json").write_text("{ broken", encoding="utf-8")
        data = self.client.state()
        self.assertFalse(data["status"]["valid"])
        self.assertIsNone(data["config"])
        self.assertIn("not valid JSON", data["status"]["problems"][0])

    def test_build_endpoint_repairs_a_hand_edited_page(self):
        (self.site / "index.html").write_text("vandalised", encoding="utf-8")
        self.assertEqual(self.client.state()["status"]["stale"], ["index.html"])
        status, body = self.client.post("/api/build", {})
        self.assertEqual(status, 200)
        self.assertEqual(body["status"]["stale"], [])

    def test_hostile_text_never_reaches_the_page_as_markup(self):
        self.client.edit("home.set", {"lead": "<script>alert(1)</script>"})
        html = (self.site / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("<script>alert", html)

    def test_a_hostile_config_value_is_returned_as_json_data_only(self):
        self.client.edit("home.set", {"lead": "<img src=x onerror=alert(1)>"})
        status, hdrs, payload = self.client.request("GET", "/api/state")
        self.assertTrue(hdrs["Content-Type"].startswith("application/json"))
        self.assertEqual(hdrs["X-Content-Type-Options"], "nosniff")


class SecurityTests(ServerCase):
    def test_wrong_host_is_refused_everywhere(self):
        for method, path in (("GET", "/"), ("GET", "/api/state"), ("GET", "/preview/index.html"), ("POST", "/api/edit")):
            with self.subTest(path=path):
                status, _h, _p = self.client.request(method, path, body={} if method == "POST" else None,
                                                     headers={"Host": "evil.example", "X-BM-Token": TOKEN, "Content-Type": "application/json"})
                self.assertEqual(status, 403)

    def test_localhost_name_is_accepted(self):
        status, _h, _p = self.client.request("GET", "/api/state", headers={"Host": f"localhost:{self.client.port}"})
        self.assertEqual(status, 200)

    def test_post_without_or_with_wrong_token_is_refused_and_changes_nothing(self):
        before = self.snapshot()
        for token in (None, "", "wrong", TOKEN + "x"):
            with self.subTest(token=token):
                status, body = self.client.post("/api/edit", {"op": "tile.remove", "params": {"tile_id": "creator"}}, token=token)
                self.assertEqual(status, 403)
        self.assertEqual(self.snapshot(), before)

    def test_foreign_origin_is_refused_even_with_the_token(self):
        status, _body = self.client.post("/api/edit", {"op": "tile.remove", "params": {"tile_id": "creator"}}, Origin="http://evil.example")
        self.assertEqual(status, 403)
        status, _body = self.client.post("/api/edit", {"op": "tile.visible", "params": {"tile_id": "creator", "visible": False}},
                                         Origin=f"http://127.0.0.1:{self.client.port}")
        self.assertEqual(status, 200)

    def test_content_type_must_be_json(self):
        status, _h, _p = self.client.request("POST", "/api/edit", raw=b'{"op":"x"}', headers={"X-BM-Token": TOKEN, "Content-Type": "text/plain"})
        self.assertEqual(status, 415)

    def test_malformed_and_oversized_bodies(self):
        h = {"X-BM-Token": TOKEN, "Content-Type": "application/json"}
        self.assertEqual(self.client.request("POST", "/api/edit", raw=b"{not json", headers=h)[0], 400)
        self.assertEqual(self.client.request("POST", "/api/edit", raw=b"[1,2]", headers=h)[0], 400)
        conn = http.client.HTTPConnection("127.0.0.1", self.client.port, timeout=10)     # declare a huge body, send none
        conn.putrequest("POST", "/api/edit", skip_host=True)
        for key, value in {"Host": f"127.0.0.1:{self.client.port}", "Content-Length": str(web.MAX_BODY + 1), **h}.items():
            conn.putheader(key, value)
        conn.endheaders()
        self.assertEqual(conn.getresponse().status, 413)
        conn.close()

    def test_unknown_routes(self):
        self.assertEqual(self.client.request("GET", "/nope")[0], 404)
        self.assertEqual(self.client.post("/api/nope", {})[0], 404)
        self.assertEqual(self.client.request("GET", "/api/edit")[0], 404)       # edits are POST only

    def test_page_carries_the_token_and_a_strict_policy(self):
        status, hdrs, payload = self.client.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(TOKEN, payload.decode())
        self.assertNotIn("__BM_TOKEN__", payload.decode())
        self.assertIn("default-src 'none'", hdrs["Content-Security-Policy"])
        self.assertIn("frame-ancestors 'none'", hdrs["Content-Security-Policy"])

    def test_token_is_not_exposed_by_any_other_endpoint(self):
        for path in ("/api/state", "/preview/index.html"):
            self.assertNotIn(TOKEN.encode(), self.client.request("GET", path)[2])

    def test_server_listens_on_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_a_random_token_is_made_when_none_is_given(self):
        other = web.make_server(self.site, port=0)
        self.addCleanup(other.server_close)
        self.assertGreaterEqual(len(other.token), 20)
        self.assertNotEqual(other.token, self.server.token)

    def test_ui_source_never_uses_innerhtml_or_eval(self):
        for forbidden in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"):
            self.assertNotIn(forbidden, UI_SOURCE)


class PreviewTests(ServerCase):
    def test_serves_site_files(self):
        status, hdrs, payload = self.client.request("GET", "/preview/index.html?t=123")
        self.assertEqual(status, 200)
        self.assertTrue(hdrs["Content-Type"].startswith("text/html"))
        self.assertIn(b"Beyondia", payload)
        self.assertEqual(self.client.request("GET", "/preview/beyondia.css")[0], 200)
        self.assertEqual(self.client.request("GET", "/preview/portrait.jpg")[1]["Content-Type"], "image/jpeg")

    def test_only_allow_listed_names_are_served(self):
        (self.site / ".bm.lock").write_text("x")
        (self.site / "secret.txt").write_text("x")
        (self.site / "sub").mkdir()
        (self.site / "sub" / "a.html").write_text("x")
        for name in ("site.config.json", ".bm.lock", "secret.txt", "sub/a.html", "..%2Fsite.config.json", "../site.config.json",
                     "%2e%2e/site.config.json", "index.html/", "nope.html", ".git/config", "a.html%00.jpg"):
            with self.subTest(name=name):
                self.assertEqual(self.client.request("GET", "/preview/" + name)[0], 404)

    def test_preview_follows_edits(self):
        self.client.edit("home.set", {"lead": "Seen in the preview."})
        self.assertIn(b"Seen in the preview.", self.client.request("GET", "/preview/index.html")[2])


class PublishApiTests(GitCase):
    def setUp(self):
        super().setUp()
        self.site = copy_fixture_site(self.work)
        (self.site / ".gitignore").write_text(".bm.lock\n")
        self.commit_all(self.work, "initial")
        git(self.work, "push", "-u", "origin", "main")
        self.server = web.make_server(self.site, port=0, token=TOKEN)
        thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.01), daemon=True)
        thread.start()
        self.addCleanup(lambda: (self.server.shutdown(), self.server.server_close(), thread.join(5)))
        self.client = Client(self.server)

    def test_state_reports_git(self):
        self.client.edit("tile.visible", {"tile_id": "creator", "visible": False})
        git_info = self.client.state()["status"]["git"]
        self.assertEqual(git_info["branch"], "main")
        self.assertTrue(git_info["origin"])
        self.assertEqual(sorted(git_info["changed"]), ["index.html", "site.config.json"])

    def test_dry_run_then_publish(self):
        self.client.edit("tile.visible", {"tile_id": "creator", "visible": False})
        remote_head = git(self.remote, "rev-parse", "main")
        status, body = self.client.post("/api/publish", {"message": "preview", "dry_run": True})
        self.assertEqual(status, 200)
        self.assertEqual(body["publish"]["status"], "dry-run")
        self.assertEqual(git(self.remote, "rev-parse", "main"), remote_head)
        status, body = self.client.post("/api/publish", {"message": "From the interface", "dry_run": False})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["publish"]["status"], "published")
        self.assertEqual(self.remote_log()[0], "From the interface")
        self.assertEqual(body["status"]["git"]["changed"], [])

    def test_bad_publish_requests(self):
        self.assertEqual(self.client.post("/api/publish", {"message": 5, "dry_run": False})[0], 409)
        self.assertEqual(self.client.post("/api/publish", {"message": "x", "dry_run": "no"})[0], 409)
        status, body = self.client.post("/api/publish", {"message": "  ", "dry_run": False})
        self.assertEqual(status, 409)

    def test_publish_refused_when_site_checks_fail(self):
        self.client.edit("tile.update", {"tile_id": "stories", "href": "missing-page.html"})
        remote_head = git(self.remote, "rev-parse", "main")
        status, body = self.client.post("/api/publish", {"message": "no", "dry_run": False})
        self.assertEqual(status, 409)
        self.assertIn("site checks failed", body["error"])
        self.assertEqual(git(self.remote, "rev-parse", "main"), remote_head)


if __name__ == "__main__":
    unittest.main()
