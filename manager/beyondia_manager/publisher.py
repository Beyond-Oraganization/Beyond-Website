"""Publishing to GitHub: commit the managed files, rebase, push.

The flow and every refusal are described in PLAN.md section 7. Three rules
shape the code:

* Only ``MANAGED_FILES`` are ever staged, and only by explicit name.
* Nothing is ever forced: history is never rewritten or discarded on the remote
  or locally (a test scans this file for the force flags).
* Whatever fails, the working tree is left in a state a person can read:
  a failed rebase is aborted, a failed push keeps the local commit.
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, List, Optional

from .build import MANAGED_FILES
from .errors import GitError


@dataclass
class PublishResult:
    status: str                          # "published" | "nothing" | "dry-run"
    branch: str = ""
    files: List[str] = field(default_factory=list)      # managed files with changes
    commands: List[str] = field(default_factory=list)   # what was (or would be) run
    commit: str = ""


class Git:
    """A thin wrapper that runs git in one folder and turns failures into GitError."""

    def __init__(self, cwd: Path, executable: str = "git"):
        self.cwd = Path(cwd)
        self.executable = executable
        self.log: List[str] = []

    def run(self, *args: str, check: bool = True) -> "subprocess.CompletedProcess[str]":
        command = [self.executable] + list(args)
        self.log.append("git " + " ".join(args))
        env = dict(os.environ)
        env["GIT_TERMINAL_PROMPT"] = "0"   # never hang waiting for a password prompt
        env["LC_ALL"] = "C"                # stable messages
        try:
            done = subprocess.run(
                command, cwd=str(self.cwd), env=env, capture_output=True, text=True, encoding="utf-8"
            )
        except FileNotFoundError:
            raise GitError("git is not installed or not on PATH")
        if check and done.returncode != 0:
            detail = (done.stderr or done.stdout).strip() or f"exit code {done.returncode}"
            raise GitError(f"`git {' '.join(args)}` failed:\n{detail}")
        return done

    def out(self, *args: str) -> str:
        return self.run(*args).stdout.strip()

    def ok(self, *args: str) -> bool:
        return self.run(*args, check=False).returncode == 0


def _lines(text: str) -> List[str]:
    return [line for line in text.splitlines() if line.strip()]


def _preflight(git: Git) -> str:
    """Refuse early, before anything is touched. Returns the branch name."""
    if not git.ok("rev-parse", "--is-inside-work-tree"):
        raise GitError(f"{git.cwd} is not a Git repository. Run `git init` and add the origin first.")
    if not git.ok("remote", "get-url", "origin"):
        raise GitError("this repository has no remote named 'origin'. Add it with `git remote add origin <url>`.")
    branch = git.run("symbolic-ref", "--short", "-q", "HEAD", check=False).stdout.strip()
    if not branch:
        raise GitError("HEAD is detached (not on a branch). Check out a branch such as 'main' first.")
    staged = _lines(git.out("diff", "--cached", "--name-only", "--relative"))
    foreign = [name for name in staged if name not in MANAGED_FILES]
    if foreign:
        raise GitError(
            "other files are already staged, and publishing would commit them too:\n  "
            + "\n  ".join(foreign)
            + "\nUnstage them (`git restore --staged <file>`) or commit them yourself first."
        )
    return branch


def _changed_managed(git: Git) -> List[str]:
    existing = [name for name in MANAGED_FILES if (git.cwd / name).exists()]
    if not existing:
        return []
    # Not git.out(): its strip() would eat the leading space of " M file".
    status = git.run("status", "--porcelain", "--untracked-files=all", "--", *existing).stdout
    return [line[3:] for line in _lines(status)]


def _remote_has_branch(git: Git, branch: str) -> bool:
    return git.run("ls-remote", "--exit-code", "--heads", "origin", branch, check=False).returncode == 0


def _rebase_in_progress(git: Git) -> bool:
    for name in ("rebase-merge", "rebase-apply"):
        path = Path(git.out("rev-parse", "--git-path", name))
        if not path.is_absolute():
            path = git.cwd / path
        if path.exists():
            return True
    return False


def _unpushed(git: Git, branch: str) -> int:
    """Commits on this branch that origin does not have yet."""
    has_head = git.ok("rev-parse", "--verify", "-q", "HEAD")
    if not _remote_has_branch(git, branch):
        return int(git.out("rev-list", "--count", "HEAD")) if has_head else 0
    git.run("fetch", "origin", branch)
    return int(git.out("rev-list", "--count", f"refs/remotes/origin/{branch}..HEAD"))


def publish(
    site_dir: Path,
    message: str,
    dry_run: bool = False,
    say: Callable[[str], None] = lambda _text: None,
    git: Optional[Git] = None,
) -> PublishResult:
    """Commit the managed files and push them. Callers validate and build first."""
    if not message or not message.strip():
        raise GitError("a commit message is required")
    git = git or Git(site_dir)
    branch = _preflight(git)
    changed = _changed_managed(git)

    if dry_run:
        plan = ["git add -- " + " ".join(changed)] if changed else []
        plan += ["git commit -m " + repr(message)] if changed else []
        plan += [f"git pull --rebase --autostash origin {branch}", f"git push origin {branch}"]
        return PublishResult("dry-run", branch=branch, files=changed, commands=plan)

    committed = False
    if changed:
        git.run("add", "--", *[name for name in MANAGED_FILES if (git.cwd / name).exists()])
        if not git.ok("diff", "--cached", "--quiet"):
            git.run("commit", "-m", message)
            committed = True

    if not committed and _unpushed(git, branch) == 0:
        return PublishResult("nothing", branch=branch, commands=git.log[:])

    if _remote_has_branch(git, branch):
        pulled = git.run("pull", "--rebase", "--autostash", "origin", branch, check=False)
        if pulled.returncode != 0:
            detail = (pulled.stderr or pulled.stdout).strip()
            if _rebase_in_progress(git):
                git.run("rebase", "--abort", check=False)
            raise GitError(
                "could not combine your commit with the newer commits on GitHub "
                "(most likely the same file was changed in both places).\n"
                "Nothing was pushed and your local commit is kept. Run `git pull --rebase` "
                "yourself, resolve the conflict, then publish again.\n" + detail
            )
    git.run("push", "origin", branch)
    return PublishResult(
        "published", branch=branch, files=changed, commands=git.log[:], commit=git.out("rev-parse", "--short", "HEAD")
    )
