"""Minimal .env reader/writer (no python-dotenv dependency, no shell expansion,
so scrypt hashes containing '$' survive intact)."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(ROOT, ".env")


def read(path=ENV_PATH):
    out = {}
    if not os.path.isfile(path):
        return out
    with open(path, encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def update(values, path=ENV_PATH):
    """Set keys, preserving every other line and comment."""
    lines, done = [], set()
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if s and not s.startswith("#") and "=" in s:
                    k = s.split("=", 1)[0].strip()
                    if k in values:
                        lines.append(f"{k}={values[k]}\n")
                        done.add(k)
                        continue
                lines.append(line if line.endswith("\n") else line + "\n")
    for k, v in values.items():
        if k not in done:
            lines.append(f"{k}={v}\n")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.writelines(lines)
    os.replace(tmp, path)


def load_into_environ(path=ENV_PATH):
    for k, v in read(path).items():
        os.environ.setdefault(k, v)
