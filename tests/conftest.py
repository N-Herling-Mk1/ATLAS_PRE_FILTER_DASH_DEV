import os
import secrets
import sys

import pytest
from werkzeug.security import generate_password_hash

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)


def make_app(store, mode="dev", password=None, secret=None, **extra):
    from server.app import create_app
    pw = password or secrets.token_urlsafe(24)     # a credential, not data
    app = create_app(PFD_PASSWORD_HASH=generate_password_hash(pw, method="scrypt"),
                     PFD_SECRET_KEY=secret or secrets.token_hex(32), PFD_STORE_DIR=str(store),
                     PFD_MODE=mode, PFD_PASSWORD_WEAK="0", **extra)
    app.config["TESTING"] = True
    return app, pw


@pytest.fixture
def app_pw(tmp_path):
    return make_app(tmp_path / "store")


def real_locations():
    """Locations file for real-data tests, or None (tests then skip, by name)."""
    want = os.environ.get("PFD_TEST_DATA")
    if not want:
        return None
    from engine import loader
    try:
        if want in ("home", "office"):
            return loader.resolve_locations(home=want == "home", office=want == "office")
        return loader.resolve_locations(explicit=want)
    except loader.MissingInput:
        return None


needs_data = pytest.mark.skipif(real_locations() is None,
                                reason="real data not configured: run_tests.ps1 -Data home|office|<path>")
