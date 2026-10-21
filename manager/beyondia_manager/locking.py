"""A tiny lock file that stops two manager processes from editing at once.

Without it, two terminals running ``tile add`` together would both read the
same old config, and the second save would silently erase the first change
(a "lost update"). ``os.O_CREAT | os.O_EXCL`` makes creation fail when the file
already exists, which is an atomic "is it taken?" test.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Callable, Optional

from .errors import LockError

STALE_AFTER_SECONDS = 600.0


class FileLock:
    def __init__(
        self,
        path: Path,
        stale_after: float = STALE_AFTER_SECONDS,
        clock: Callable[[], float] = time.time,
        on_stale: Optional[Callable[[str], None]] = None,
    ):
        self.path = Path(path)
        self.stale_after = stale_after
        self.clock = clock
        self.on_stale = on_stale
        self._held = False

    def _try_create(self) -> bool:
        try:
            fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            return False
        with os.fdopen(fd, "w") as handle:
            handle.write(str(os.getpid()) + "\n")
        return True

    def acquire(self) -> None:
        if self._try_create():
            self._held = True
            return
        try:
            age = self.clock() - self.path.stat().st_mtime
        except FileNotFoundError:
            age = 0.0  # released between our two calls: simply try again below
        if age > self.stale_after:
            # A crashed process never released it. Replace it, but say so.
            if self.on_stale:
                self.on_stale(f"replacing a lock left behind {int(age)} seconds ago: {self.path}")
            try:
                os.unlink(str(self.path))
            except FileNotFoundError:
                pass
        if self._try_create():
            self._held = True
            return
        raise LockError(
            f"another manager command is changing the config right now ({self.path}). "
            "Wait for it to finish; if you are sure none is running, delete that file."
        )

    def release(self) -> None:
        if self._held:
            try:
                os.unlink(str(self.path))
            except FileNotFoundError:
                pass
            self._held = False

    def __enter__(self) -> "FileLock":
        self.acquire()
        return self

    def __exit__(self, *exc_info) -> None:
        self.release()
