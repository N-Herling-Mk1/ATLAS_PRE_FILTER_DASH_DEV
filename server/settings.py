"""Runtime settings from the environment (.env loaded first, CLI may override)."""
import os

from . import envfile


def _b(v, default=False):
    if v is None:
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "on")


class Settings:
    def __init__(self, **over):
        envfile.load_into_environ()
        e = {**os.environ, **{k: str(v) for k, v in over.items() if v is not None}}
        self.mode = e.get("PFD_MODE", "dev")                       # dev | parity | live
        self.password_hash = e.get("PFD_PASSWORD_HASH", "")
        self.secret_key = e.get("PFD_SECRET_KEY", "")
        self.password_weak = _b(e.get("PFD_PASSWORD_WEAK"), True)
        self.secure_cookie = _b(e.get("PFD_SECURE_COOKIE"), self.mode in ("parity", "live"))
        self.trust_cf = _b(e.get("PFD_TRUST_CF"), self.mode in ("parity", "live"))
        self.idle_hours = float(e.get("PFD_IDLE_HOURS", "8"))
        default_store = r"C:\pfd_store" if os.name == "nt" else os.path.expanduser("~/pfd_store")
        self.store_dir = e.get("PFD_STORE_DIR", default_store)
        self.allow_onedrive = _b(e.get("PFD_ALLOW_ONEDRIVE"), False)
        self.locations = e.get("PFD_LOCATIONS", "")
        self.workers = int(e.get("PFD_WORKERS", str(max(1, (os.cpu_count() or 4) // 4))))
        self.max_upload_mb = int(e.get("PFD_MAX_UPLOAD_MB", "90"))

    def problems(self):
        p = []
        if not self.password_hash or not self.secret_key:
            p.append("no password set: run  python -m server.set_password")
        if "onedrive" in os.path.abspath(self.store_dir).lower() and not self.allow_onedrive:
            p.append(f"store dir is inside OneDrive ({self.store_dir}); OneDrive reverts files and would "
                     "corrupt version history. Set PFD_STORE_DIR elsewhere, or PFD_ALLOW_ONEDRIVE=1")
        if self.mode not in ("dev", "parity", "live"):
            p.append(f"unknown PFD_MODE '{self.mode}'")
        return p
