"""Code provenance for results and bundles (scan layer §16.1)."""
import os
import subprocess

from .config import ENGINE_VERSION

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_commit = None


def code_commit():
    """Short git commit of this repo, with '+dirty' if the tree has local edits.
    'not-a-repo' / 'git-unavailable' are reported as such, never guessed."""
    global _commit
    if _commit is None and os.environ.get("PFD_CODE_COMMIT"):
        # the container image has no .git; the build stamps the commit instead
        _commit = os.environ["PFD_CODE_COMMIT"].strip() + " (image)"
    if _commit is None:
        try:
            h = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                               capture_output=True, text=True, timeout=5)
            if h.returncode != 0:
                _commit = "not-a-repo"
            else:
                d = subprocess.run(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT,
                                   capture_output=True, text=True, timeout=5)
                _commit = h.stdout.strip() + ("+dirty" if d.stdout.strip() else "")
        except (OSError, subprocess.SubprocessError):
            _commit = "git-unavailable"
    return _commit


def stamp():
    return {"engine": ENGINE_VERSION, "code_commit": code_commit()}
