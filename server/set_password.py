"""Set the shared password and rotate SECRET_KEY.

    python -m server.set_password                 prompt twice
    python -m server.set_password --password X    non-interactive
    python -m server.set_password --rotate-only   new SECRET_KEY, same password
                                                  (logs everyone out)
The plaintext is never written anywhere; only the scrypt hash goes to .env.
"""
import argparse
import getpass
import secrets
import sys

from werkzeug.security import generate_password_hash

from . import envfile

WEAK_BELOW = 20   # characters; a lock with no lockout leans entirely on the passphrase


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--password")
    ap.add_argument("--rotate-only", action="store_true")
    a = ap.parse_args()
    vals = {"PFD_SECRET_KEY": secrets.token_hex(32)}
    if not a.rotate_only:
        pw = a.password
        if pw is None:
            pw = getpass.getpass("new password: ")
            if pw != getpass.getpass("again: "):
                sys.exit("passwords differ; nothing written")
        if not pw:
            sys.exit("empty password; nothing written")
        vals["PFD_PASSWORD_HASH"] = generate_password_hash(pw, method="scrypt")
        vals["PFD_PASSWORD_WEAK"] = "1" if len(pw) < WEAK_BELOW else "0"
    envfile.update(vals)
    print(f"[auth ] wrote {', '.join(sorted(vals))} to {envfile.ENV_PATH}")
    print("[auth ] SECRET_KEY rotated: every existing login cookie is now invalid")
    if vals.get("PFD_PASSWORD_WEAK") == "1":
        print(f"[auth ] WARNING: password is under {WEAK_BELOW} characters. There is no lockout,"
              " so change it to a long passphrase before the site goes live.")


if __name__ == "__main__":
    main()
