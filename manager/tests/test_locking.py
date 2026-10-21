import os
import unittest

from beyondia_manager.errors import LockError
from beyondia_manager.locking import FileLock
from .helpers import TempDirCase


class LockTests(TempDirCase):
    def test_acquire_and_release(self):
        path = self.tmp / "lock"
        with FileLock(path):
            self.assertTrue(path.exists())
        self.assertFalse(path.exists())

    def test_second_holder_is_refused(self):
        path = self.tmp / "lock"
        with FileLock(path):
            with self.assertRaises(LockError):
                FileLock(path).acquire()
            self.assertTrue(path.exists())      # the refused attempt must not delete the holder's lock
        self.assertFalse(path.exists())

    def test_released_even_when_the_body_fails(self):
        path = self.tmp / "lock"
        with self.assertRaises(RuntimeError):
            with FileLock(path):
                raise RuntimeError("boom")
        self.assertFalse(path.exists())

    def test_stale_lock_is_replaced_and_reported(self):
        path = self.tmp / "lock"
        path.write_text("999999\n")
        old = os.stat(path).st_mtime
        messages = []
        lock = FileLock(path, stale_after=600, clock=lambda: old + 601, on_stale=messages.append)
        lock.acquire()
        self.assertEqual(len(messages), 1)
        lock.release()
        self.assertFalse(path.exists())

    def test_fresh_lock_is_not_replaced(self):
        path = self.tmp / "lock"
        path.write_text("999999\n")
        old = os.stat(path).st_mtime
        with self.assertRaises(LockError):
            FileLock(path, stale_after=600, clock=lambda: old + 599).acquire()
        self.assertTrue(path.exists())

    def test_release_without_acquire_is_harmless(self):
        path = self.tmp / "lock"
        path.write_text("someone else")
        FileLock(path).release()
        self.assertTrue(path.exists())


if __name__ == "__main__":
    unittest.main()
