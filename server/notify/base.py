# Ported from the Aug 2026 atlas_scan repo (scan_engine/notify), env prefix SCAN_ -> PFD_.
"""Alert dispatch with pluggable transports.

Design constraint carried forward from the eventual deploy topology: the app
container will be egress-denied and can only PUSH an alert onto a queue. The
notifier is the only component with network access. Keeping transports behind
this interface means that move costs nothing later.

Three things that are easy to forget and expensive to omit:
  1. dedupe + rate limit — a crash loop that sends 500 texts is a real failure
     mode, and a billed one on Twilio
  2. secrets out of the repo — .env, gitignored, with a LOUD startup failure if
     a transport is enabled with missing credentials (never a silent no-op)
  3. what actually triggers an alert at this stage — there is no backend to be
     down yet, so the live alerts are job-lifecycle: scan failed, scan finished,
     scan produced N flagged columns
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field


class TransportError(RuntimeError):
    pass


@dataclass
class Alert:
    key: str            # dedupe key, e.g. "scan_failed:endcap"
    subject: str
    body: str
    severity: str = "info"        # info | warn | error
    meta: dict = field(default_factory=dict)

    def sms_text(self, limit: int = 300) -> str:
        """SMS is not email. One line, front-load the verdict, hard truncate."""
        tag = {"error": "FAIL", "warn": "WARN", "info": "OK"}.get(self.severity, "")
        text = f"[{tag}] {self.subject}"
        first = self.body.strip().splitlines()[0] if self.body.strip() else ""
        if first:
            text += f" — {first}"
        return text[:limit]


class Transport:
    name = "base"
    enabled = False

    def preflight(self) -> None:
        """Raise TransportError if credentials/config are missing.

        Called at startup. Failing loudly here is the whole point — a transport
        that silently no-ops is worse than one that is switched off.
        """
        raise NotImplementedError

    def send(self, alert: Alert) -> None:
        raise NotImplementedError


class Notifier:
    """Fans an alert out to every enabled transport, with rate limiting."""

    def __init__(self, transports, max_per_hour: int = 6, dedupe_window_s: int = 300):
        self.transports = [t for t in transports if t.enabled]
        self.max_per_hour = max_per_hour
        self.dedupe_window_s = dedupe_window_s
        self._sent: dict[str, list[float]] = {}
        self._suppressed: dict[str, int] = {}
        self.log: list[dict] = []

    def preflight(self) -> list[str]:
        """Returns a list of human-readable problems. Empty means good to go."""
        problems = []
        for t in self.transports:
            try:
                t.preflight()
            except TransportError as e:
                problems.append(f"{t.name}: {e}")
        return problems

    def _allowed(self, key: str) -> tuple[bool, str]:
        now = time.time()
        hist = [t for t in self._sent.get(key, []) if now - t < 3600]
        self._sent[key] = hist
        if hist and now - hist[-1] < self.dedupe_window_s:
            return False, f"deduped (last sent {int(now - hist[-1])}s ago)"
        if len(hist) >= self.max_per_hour:
            return False, f"rate limited ({len(hist)}/{self.max_per_hour} this hour)"
        return True, ""

    def send(self, alert: Alert) -> dict:
        ok, why = self._allowed(alert.key)
        if not ok:
            self._suppressed[alert.key] = self._suppressed.get(alert.key, 0) + 1
            entry = {"key": alert.key, "sent": False, "reason": why,
                     "suppressed_count": self._suppressed[alert.key],
                     "ts": time.time()}
            self.log.append(entry)
            return entry

        suppressed = self._suppressed.pop(alert.key, 0)
        if suppressed:
            alert.body += f"\n\n({suppressed} earlier alerts on this key were suppressed.)"

        results = {}
        for t in self.transports:
            try:
                t.send(alert)
                results[t.name] = "sent"
            except Exception as e:                      # noqa: BLE001
                results[t.name] = f"FAILED: {e}"
        self._sent.setdefault(alert.key, []).append(time.time())
        entry = {"key": alert.key, "sent": True, "results": results,
                 "severity": alert.severity, "ts": time.time()}
        self.log.append(entry)
        return entry
