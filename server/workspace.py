"""Per-login scratch workspace (scope §3). Discarded at logout or idle timeout.
SAVE (bundles.py) is the only way it outlives a login."""
import json
import os
import shutil
import threading
import time
from datetime import datetime, timezone

_lock = threading.RLock()


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Workspaces:
    def __init__(self, store_dir, idle_hours):
        self.root = os.path.join(store_dir, "scratch")
        self.idle_s = idle_hours * 3600
        os.makedirs(self.root, exist_ok=True)

    def dir(self, sid):
        d = os.path.join(self.root, sid)
        os.makedirs(d, exist_ok=True)
        return d

    def touch(self, sid):
        p = os.path.join(self.dir(sid), ".touch")
        with open(p, "w") as f:
            f.write(str(time.time()))

    def state(self, sid):
        p = os.path.join(self.dir(sid), "state.json")
        if os.path.isfile(p):
            return json.load(open(p))
        return {"created": _now(), "results": {}, "crossblock": {}, "rulings": {}, "settings": {},
                "ui": {}, "active_list": None, "dirty": False, "last_saved": None,
                "loaded_bundle": None}

    def save_state(self, sid, st):
        p = os.path.join(self.dir(sid), "state.json")
        with _lock:
            tmp = p + ".tmp"
            with open(tmp, "w") as f:
                json.dump(st, f, indent=1)
            os.replace(tmp, p)

    def mutate(self, sid, fn, dirty=True):
        with _lock:
            st = self.state(sid)
            fn(st)
            if dirty:
                st["dirty"] = True
            self.save_state(sid, st)
            return st

    def result_path(self, sid, region):
        return os.path.join(self.dir(sid), f"gate_{region}.json")

    def discard(self, sid):
        shutil.rmtree(os.path.join(self.root, sid), ignore_errors=True)

    def sweep(self):
        """Delete scratch dirs idle longer than the timeout."""
        now = time.time()
        for sid in os.listdir(self.root):
            p = os.path.join(self.root, sid, ".touch")
            try:
                t = float(open(p).read())
            except (OSError, ValueError):
                t = os.path.getmtime(os.path.join(self.root, sid))
            if now - t > self.idle_s:
                shutil.rmtree(os.path.join(self.root, sid), ignore_errors=True)
