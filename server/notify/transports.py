# Ported from the Aug 2026 atlas_scan repo (scan_engine/notify), env prefix SCAN_ -> PFD_.
"""Concrete transports. Console is the default and the test path.

Credentials come from environment variables only — never from the repo, never
from the run config (the config gets hashed into the manifest and archived).
"""
from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage

from .base import Alert, Transport, TransportError


class ConsoleSink(Transport):
    """Always enabled. Develop against this; flip on the others to verify."""
    name = "console"
    enabled = True

    def __init__(self, stream=None):
        self.stream = stream
        self.received: list[Alert] = []

    def preflight(self) -> None:
        return

    def send(self, alert: Alert) -> None:
        self.received.append(alert)
        line = f"[{alert.severity.upper()}] {alert.subject}"
        if self.stream:
            self.stream.write(line + "\n" + alert.body + "\n")
        else:
            print("\n" + "=" * 62)
            print(line)
            print("=" * 62)
            print(alert.body)
            print("=" * 62 + "\n")


class EmailSMTP(Transport):
    """Plain SMTP. Works with Gmail app passwords, Fastmail, or any host.

    Env: PFD_SMTP_HOST, PFD_SMTP_PORT, PFD_SMTP_USER, PFD_SMTP_PASS,
         PFD_MAIL_FROM, PFD_MAIL_TO (comma separated)
    """
    name = "email"

    def __init__(self):
        self.host = os.environ.get("PFD_SMTP_HOST", "")
        self.port = int(os.environ.get("PFD_SMTP_PORT", "587"))
        self.user = os.environ.get("PFD_SMTP_USER", "")
        self.password = os.environ.get("PFD_SMTP_PASS", "")
        self.mail_from = os.environ.get("PFD_MAIL_FROM", self.user)
        self.mail_to = [a.strip() for a in
                        os.environ.get("PFD_MAIL_TO", "").split(",") if a.strip()]
        self.enabled = os.environ.get("PFD_EMAIL_ENABLED", "0") == "1"

    def preflight(self) -> None:
        missing = [k for k, v in {
            "PFD_SMTP_HOST": self.host, "PFD_SMTP_USER": self.user,
            "PFD_SMTP_PASS": self.password, "PFD_MAIL_TO": self.mail_to,
        }.items() if not v]
        if missing:
            raise TransportError(
                f"email enabled but missing: {', '.join(missing)}. "
                f"Set them in .env or switch PFD_EMAIL_ENABLED=0.")

    def send(self, alert: Alert) -> None:
        msg = EmailMessage()
        msg["Subject"] = f"[pfd] {alert.subject}"
        msg["From"] = self.mail_from
        msg["To"] = ", ".join(self.mail_to)
        msg.set_content(alert.body)
        ctx = ssl.create_default_context()
        if self.port == 465:
            with smtplib.SMTP_SSL(self.host, self.port, context=ctx, timeout=20) as s:
                s.login(self.user, self.password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(self.host, self.port, timeout=20) as s:
                s.starttls(context=ctx)
                s.login(self.user, self.password)
                s.send_message(msg)


class SMSGateway(Transport):
    """Carrier email-to-SMS gateway. Free, no new account.

    TRADE-OFF, stated plainly: US carriers have progressively deprecated these
    gateways. Delivery is unreliable and there is NO delivery receipt. Fine for
    proving the plumbing works; do not build a trusted alerting channel on it.

    Env: PFD_SMS_GATEWAY_ADDR (e.g. 5551234567@vtext.com), plus the EmailSMTP vars.
    """
    name = "sms_gateway"

    def __init__(self, mailer: EmailSMTP | None = None):
        self.addr = os.environ.get("PFD_SMS_GATEWAY_ADDR", "")
        self.enabled = os.environ.get("PFD_SMS_GATEWAY_ENABLED", "0") == "1"
        self._mailer = mailer or EmailSMTP()

    def preflight(self) -> None:
        if not self.addr:
            raise TransportError("PFD_SMS_GATEWAY_ADDR not set")
        if "@" not in self.addr:
            raise TransportError(f"PFD_SMS_GATEWAY_ADDR looks wrong: {self.addr!r}")
        # borrow the mail credentials check
        saved, self._mailer.mail_to = self._mailer.mail_to, [self.addr]
        try:
            self._mailer.preflight()
        finally:
            self._mailer.mail_to = saved

    def send(self, alert: Alert) -> None:
        short = Alert(key=alert.key, subject=alert.sms_text(), body="",
                      severity=alert.severity)
        saved, self._mailer.mail_to = self._mailer.mail_to, [self.addr]
        try:
            self._mailer.send(short)
        finally:
            self._mailer.mail_to = saved


class SMSTwilio(Transport):
    """Twilio REST API. ~$1.15/mo for a number plus ~$0.008/message.

    Reliable, with delivery status. This is the answer if the SMS channel is one
    you actually intend to trust.

    Env: PFD_TWILIO_SID, PFD_TWILIO_TOKEN, PFD_TWILIO_FROM, PFD_TWILIO_TO
    """
    name = "sms_twilio"

    def __init__(self):
        self.sid = os.environ.get("PFD_TWILIO_SID", "")
        self.token = os.environ.get("PFD_TWILIO_TOKEN", "")
        self.from_ = os.environ.get("PFD_TWILIO_FROM", "")
        self.to = os.environ.get("PFD_TWILIO_TO", "")
        self.enabled = os.environ.get("PFD_TWILIO_ENABLED", "0") == "1"

    def preflight(self) -> None:
        missing = [k for k, v in {
            "PFD_TWILIO_SID": self.sid, "PFD_TWILIO_TOKEN": self.token,
            "PFD_TWILIO_FROM": self.from_, "PFD_TWILIO_TO": self.to,
        }.items() if not v]
        if missing:
            raise TransportError(f"twilio enabled but missing: {', '.join(missing)}")

    def send(self, alert: Alert) -> None:
        import urllib.parse
        import urllib.request
        import base64

        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json"
        data = urllib.parse.urlencode({
            "From": self.from_, "To": self.to, "Body": alert.sms_text(),
        }).encode()
        auth = base64.b64encode(f"{self.sid}:{self.token}".encode()).decode()
        req = urllib.request.Request(url, data=data, headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
        })
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status >= 300:
                raise TransportError(f"twilio returned {resp.status}")


def build_default_notifier(quiet: bool = False):
    """Assemble transports from the environment. Console is always on."""
    from .base import Notifier
    mailer = EmailSMTP()
    transports = [ConsoleSink(), mailer, SMSGateway(mailer), SMSTwilio()]
    n = Notifier(transports)
    problems = n.preflight()
    if problems and not quiet:
        print("\n  NOTIFIER PREFLIGHT FAILED — alerts will not reach you:")
        for p in problems:
            print(f"    ! {p}")
        print()
    return n, problems
