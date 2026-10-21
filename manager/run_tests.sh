#!/bin/sh
# Runs the whole test suite. Exit code 0 means everything passed.
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here" && PYTHONPATH="$here" exec python3 -W error -m unittest discover -s tests -t . -v "$@"
