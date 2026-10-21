"""Publishing, against a real Git repository and a local bare 'GitHub'. No network."""

import unittest
from pathlib import Path

from beyondia_manager import config as cfg
from beyondia_manager import publisher
from beyondia_manager.build import build
from beyondia_manager.errors import GitError
from .helpers import GitCase, git, sample


class PublisherCase(GitCase):
    def setUp(self):
        super().setUp()
        self.config = sample()
        cfg.save(self.work / "site.config.json", self.config)
        build(self.work, self.config)
        (self.work / "notes.txt").write_text("work in progress\n")
        self.commit_all(self.work, "initial")
        git(self.work, "push", "-u", "origin", "main")

    def change_title(self, title="Changed."):
        self.config["github"]["title"] = title
        cfg.save(self.work / "site.config.json", self.config)
        build(self.work, self.config)

    def publish(self, message="update", **kw):
        return publisher.publish(self.work, message, **kw)


class HappyPathTests(PublisherCase):
    def test_commits_and_pushes_only_the_managed_files(self):
        self.change_title()
        (self.work / "notes.txt").write_text("edited but unrelated\n")
        (self.work / "secret.env").write_text("TOKEN=abc\n")
        result = self.publish("update github page")
        self.assertEqual(result.status, "published")
        self.assertEqual(sorted(result.files), ["github.html", "site.config.json"])
        self.assertEqual(self.remote_log()[0], "update github page")
        remote = self.clone_remote()
        self.assertIn("Changed.", (remote / "site.config.json").read_text())
        self.assertEqual((remote / "notes.txt").read_text(), "work in progress\n")   # unrelated edit not published
        self.assertFalse((remote / "secret.env").exists())
        # ...and the local unrelated changes are still there, uncommitted.
        self.assertEqual((self.work / "notes.txt").read_text(), "edited but unrelated\n")
        self.assertIn("secret.env", git(self.work, "status", "--porcelain"))

    def test_one_commit_per_publish(self):
        before = int(git(self.work, "rev-list", "--count", "HEAD"))
        self.change_title()
        self.publish()
        self.assertEqual(int(git(self.work, "rev-list", "--count", "HEAD")), before + 1)

    def test_nothing_to_publish(self):
        before = git(self.work, "rev-parse", "HEAD")
        result = self.publish()
        self.assertEqual(result.status, "nothing")
        self.assertEqual(git(self.work, "rev-parse", "HEAD"), before)

    def test_publishing_twice_does_not_make_an_empty_commit(self):
        self.change_title()
        self.publish("first")
        self.assertEqual(self.publish("second").status, "nothing")
        self.assertEqual(self.remote_log().count("second"), 0)

    def test_first_push_to_an_empty_remote(self):
        work = self.tmp / "fresh"
        work.mkdir()
        git(work, "init", "-b", "main")
        other_remote = self.tmp / "other.git"
        git(self.tmp, "init", "--bare", "-b", "main", str(other_remote))
        git(work, "remote", "add", "origin", str(other_remote))
        cfg.save(work / "site.config.json", sample())
        build(work, sample())
        result = publisher.publish(work, "first ever")
        self.assertEqual(result.status, "published")
        self.assertEqual(git(other_remote, "log", "--format=%s", "main"), "first ever")


class RetryTests(PublisherCase):
    def test_a_commit_left_unpushed_by_an_earlier_failure_is_pushed_next_time(self):
        self.change_title()
        git(self.work, "add", "--", "site.config.json", "index.html", "github.html")
        git(self.work, "commit", "-m", "committed by hand, never pushed")
        result = self.publish()
        self.assertEqual(result.status, "published")
        self.assertEqual(self.remote_log()[0], "committed by hand, never pushed")


class DryRunTests(PublisherCase):
    def test_changes_nothing_and_lists_the_plan(self):
        self.change_title()
        head = git(self.work, "rev-parse", "HEAD")
        status = git(self.work, "status", "--porcelain")
        remote_head = git(self.remote, "rev-parse", "main")
        result = self.publish(dry_run=True)
        self.assertEqual(result.status, "dry-run")
        self.assertEqual(sorted(result.files), ["github.html", "site.config.json"])
        self.assertTrue(any(c.startswith("git push origin main") for c in result.commands))
        self.assertEqual(git(self.work, "rev-parse", "HEAD"), head)
        self.assertEqual(git(self.work, "status", "--porcelain"), status)     # nothing staged either
        self.assertEqual(git(self.remote, "rev-parse", "main"), remote_head)


class RefusalTests(PublisherCase):
    def test_other_staged_files_refuse(self):
        self.change_title()
        (self.work / "notes.txt").write_text("staged by someone\n")
        git(self.work, "add", "notes.txt")
        head = git(self.work, "rev-parse", "HEAD")
        with self.assertRaises(GitError) as ctx:
            self.publish()
        self.assertIn("notes.txt", str(ctx.exception))
        self.assertEqual(git(self.work, "rev-parse", "HEAD"), head)
        self.assertEqual(git(self.work, "diff", "--cached", "--name-only"), "notes.txt")   # left as it was

    def test_not_a_repository(self):
        folder = self.tmp / "plain"
        folder.mkdir()
        with self.assertRaises(GitError) as ctx:
            publisher.publish(folder, "x")
        self.assertIn("not a Git repository", str(ctx.exception))

    def test_no_origin(self):
        git(self.work, "remote", "remove", "origin")
        with self.assertRaises(GitError) as ctx:
            self.publish()
        self.assertIn("origin", str(ctx.exception))

    def test_detached_head(self):
        git(self.work, "checkout", "--detach")
        self.change_title()
        with self.assertRaises(GitError) as ctx:
            self.publish()
        self.assertIn("detached", str(ctx.exception))

    def test_empty_message(self):
        for bad in ("", "   "):
            with self.assertRaises(GitError):
                self.publish(bad)


class RemoteMovedTests(PublisherCase):
    def colleague_commits(self, filename, text):
        colleague = self.clone_remote()
        (colleague / filename).write_text(text)
        self.commit_all(colleague, f"colleague edits {filename}")
        git(colleague, "push", "origin", "main")
        return colleague

    def test_rebases_over_new_remote_commits_then_pushes(self):
        self.colleague_commits("other-page.html", "<p>hi</p>\n")
        self.change_title()
        result = self.publish("mine")
        self.assertEqual(result.status, "published")
        log = self.remote_log()
        self.assertEqual(log[:2], ["mine", "colleague edits other-page.html"])   # linear, mine on top
        self.assertEqual(git(self.work, "log", "--merges", "--format=%h"), "")   # no merge commits
        self.assertIn("other-page.html", self.remote_files())

    def test_unrelated_unstaged_edits_do_not_block_the_rebase(self):
        self.colleague_commits("other-page.html", "<p>hi</p>\n")
        self.change_title()
        (self.work / "notes.txt").write_text("my unsaved thoughts\n")
        self.publish("mine")
        self.assertEqual((self.work / "notes.txt").read_text(), "my unsaved thoughts\n")

    def test_conflict_aborts_cleanly_and_keeps_the_local_commit(self):
        colleague = self.clone_remote()
        other = sample()
        other["github"]["title"] = "Colleague wording."
        cfg.save(colleague / "site.config.json", other)
        build(colleague, other)
        self.commit_all(colleague, "colleague rewrites the title")
        git(colleague, "push", "origin", "main")

        self.change_title("My wording.")
        remote_head = git(self.remote, "rev-parse", "main")
        with self.assertRaises(GitError) as ctx:
            self.publish("mine")
        self.assertIn("Nothing was pushed", str(ctx.exception))
        self.assertEqual(git(self.remote, "rev-parse", "main"), remote_head)          # remote untouched
        self.assertEqual(git(self.work, "status", "--porcelain", "--untracked-files=no"), "")   # clean tree
        self.assertFalse((self.work / ".git" / "rebase-merge").exists())
        self.assertFalse((self.work / ".git" / "rebase-apply").exists())
        self.assertEqual(git(self.work, "log", "-1", "--format=%s"), "mine")           # local commit kept
        self.assertIn("My wording.", (self.work / "site.config.json").read_text())

    def test_the_publisher_never_forces(self):
        text = Path(publisher.__file__).read_text(encoding="utf-8")
        for forbidden in ("--force", "--force-with-lease", "reset --hard", "push -f"):
            self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
