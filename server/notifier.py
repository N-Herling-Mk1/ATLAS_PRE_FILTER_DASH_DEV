"""Event notifier: console + append-only log for every event, and alerts through
the ported transports (server/notify) for the events that need a human.

Alerting events: failed logins (there is no lockout, so a burst of these is the
brute-force signal) and job failures. Rate limit 6/hour per key with a 5-minute
dedupe window. A transport enabled with missing credentials fails LOUDLY at
startup, by name.
"""
import os
import threading
from datetime import datetime

from .notify.base import Alert
from .notify.transports import build_default_notifier

_lock = threading.Lock()
_log_path = None
_notifier = None
_problems = []
ALERT_KINDS = {"login": "warn", "job": "error"}


def init(store_dir):
    global _log_path, _notifier, _problems
    d = os.path.join(store_dir, "logs")
    os.makedirs(d, exist_ok=True)
    _log_path = os.path.join(d, "events.log")
    if _notifier is None:
        _notifier, _problems = build_default_notifier(quiet=False)


def status():
    return {"transports": [t.name for t in (_notifier.transports if _notifier else [])],
            "problems": list(_problems)}


def notify(kind, msg, alert=False, key=None):
    line = f"{datetime.now().isoformat(timespec='seconds')}  [{kind:<6}] {msg}"
    if _log_path:
        with _lock, open(_log_path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    if alert and _notifier is not None:
        entry = _notifier.send(Alert(key=key or kind, subject=f"{kind}: {msg[:80]}", body=line,
                                     severity=ALERT_KINDS.get(kind, "info")))
        if not entry.get("sent"):
            print(line + f"   (alert {entry.get('reason')})", flush=True)
    else:
        print(line, flush=True)


def test_alert(who):
    if _notifier is None:
        return {"sent": False, "reason": "notifier not initialised"}
    return _notifier.send(Alert(key=f"test:{datetime.now().timestamp()}", subject="test alert",
                                body=f"Test alert requested by {who} from the pre-filter dashboard.",
                                severity="info"))
