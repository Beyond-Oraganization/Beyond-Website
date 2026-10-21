"""Errors the manager can raise on purpose.

Every error that a user can cause (bad input, bad config, git in the wrong
state) is a ManagerError. The command line prints its message and exits with
status 1; anything else is a bug and is allowed to show a traceback.
"""

from __future__ import annotations

from typing import List


class ManagerError(Exception):
    """A problem the user can understand and fix."""


class ConfigError(ManagerError):
    """The config file is missing, unreadable or invalid.

    ``problems`` holds one line per problem, each starting with the path of
    the offending field, so that all problems can be shown at once.
    """

    def __init__(self, problems: List[str]):
        self.problems = list(problems)
        super().__init__("invalid config:\n  - " + "\n  - ".join(self.problems))


class EditError(ManagerError):
    """An edit was refused (unknown id, duplicate id, position out of range)."""


class LockError(ManagerError):
    """Another manager process is editing the config right now."""


class GitError(ManagerError):
    """Publishing was refused or a git command failed."""
