"""Locations-driven loader. Same txt format as the July NN-vet loader:

    one path per line; quotes ok; '.' separator lines ok; '#' comments ok;
    directory lines and unrecognised filenames are ignored;
    KEY = PATH lines are also accepted.

Canon C1: a missing input stops the run and names the file. No fallback.
"""
import hashlib
import os
import re
import time

import pandas as pd

from .config import MASSES, REGIONS

LOCATION_CANDIDATES = {
    "home": [r"C:\Users\natha\OneDrive\Desktop\0_mL_ATLAS\0_NN_vet_explore\A_\file_locations_home.txt"],
    "office": [r"C:\Users\KT_Fo\Desktop\0_mL_ATLAS\0_NN_vet_explore\A_\file_locations_work.txt"],
}


class MissingInput(Exception):
    pass


def path_map():
    """PFD_PATH_MAP: 'FROM=>TO' pairs separated by ';'. Lets one locations file
    (Windows paths) serve the container, where the data folder is mounted at
    /data. Matching is case-insensitive and slash-agnostic, longest FROM first.

        PFD_PATH_MAP=C:\\Users\\natha\\OneDrive\\Desktop\\0_mL_ATLAS=>/data
    """
    pairs = []
    for part in os.environ.get("PFD_PATH_MAP", "").split(";"):
        if "=>" in part:
            a, b = part.split("=>", 1)
            a, b = a.strip().replace("\\", "/").rstrip("/"), b.strip().rstrip("/")
            if a:
                pairs.append((a, b))
    return sorted(pairs, key=lambda ab: -len(ab[0]))


def remap(path, pairs=None):
    pairs = path_map() if pairs is None else pairs
    if not pairs:
        return path
    norm = path.replace("\\", "/")
    for a, b in pairs:
        if norm.lower() == a.lower() or norm.lower().startswith(a.lower() + "/"):
            return b + norm[len(a):]
    return path


def expected_inventory():
    inv = {}
    for r in REGIONS:
        inv[f"BKG_{r}"] = f"data24VR_{r}.csv"
        for m in MASSES:
            inv[f"SIG_{r}_mS{m}"] = f"mS{m}_{r}.csv"
    inv["NN_KJ_NN1"] = "kj_Jul_26_NN1.csv"
    inv["NN_KJ_NN2"] = "kj_Jul_26_NN2.csv"
    inv["NN_LEGACY_NN1"] = "legacy_NN1.csv"
    inv["NN_LEGACY_NN2"] = "legacy_NN2.csv"
    return inv


_FN_TO_KEY = {v.lower(): k for k, v in expected_inventory().items()}


def resolve_locations(home=False, office=False, explicit=None):
    if home and office:
        raise MissingInput("pick ONE of --home / --office")
    if explicit:
        if not os.path.isfile(explicit):
            raise MissingInput(f"locations file not found: {explicit}")
        return explicit
    env = os.environ.get("PFD_LOCATIONS")
    if env and not (home or office):
        if not os.path.isfile(env):
            raise MissingInput(f"PFD_LOCATIONS points at a missing file: {env}")
        return env
    keys = ["home"] if home else ["office"] if office else ["home", "office"]
    tried = []
    for k in keys:
        for c in LOCATION_CANDIDATES[k]:
            tried.append(c)
            if os.path.isfile(c) and os.path.getsize(c) > 0:
                return c
    raise MissingInput("no locations file found; tried: " + " | ".join(tried))


def parse_locations(path):
    loc = {}
    pairs = path_map()
    with open(remap(path, pairs), encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.strip().strip('"').strip("'")
            if not line or line.startswith("#") or set(line) <= {"."}:
                continue
            if "=" in line and "\\" not in line.split("=", 1)[0] and "/" not in line.split("=", 1)[0]:
                k, v = line.split("=", 1)
                loc[k.strip()] = remap(v.strip().strip('"').strip("'"), pairs)
                continue
            fn = re.split(r"[\\/]", line)[-1].lower()
            key = _FN_TO_KEY.get(fn)
            if key:
                loc.setdefault(key, remap(line, pairs))
    return loc


def check_inventory(loc, keys=None):
    """-> list of {key, filename, path, found, mb}."""
    inv = expected_inventory()
    rows = []
    for key, fn in inv.items():
        if keys and key not in keys:
            continue
        p = loc.get(key, "")
        found = bool(p) and os.path.isfile(p)
        rows.append({"key": key, "filename": fn, "path": p or "", "found": found,
                     "mb": round(os.path.getsize(p) / 1e6, 2) if found else None})
    return rows


def region_keys(region):
    return [f"BKG_{region}"] + [f"SIG_{region}_mS{m}" for m in MASSES]


def sample_names(region):
    return ["bkg"] + [f"mS{m}" for m in MASSES]


# ------------------------------------------------------------------ hashing --
_hash_cache = {}


def file_hash(path):
    st = os.stat(path)
    key = (path, st.st_size, st.st_mtime_ns)
    if key in _hash_cache:
        return _hash_cache[key]
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    d = h.hexdigest()
    _hash_cache[key] = d
    return d


def region_hash(loc, region, progress=None):
    keys = region_keys(region)
    missing = [(k, loc.get(k, "")) for k in keys if not os.path.isfile(loc.get(k, ""))]
    if missing:
        raise MissingInput("missing input(s): " + "; ".join(
            f"{k} -> {p or '(no path in locations file)'}" for k, p in missing))
    per = {}
    for i, k in enumerate(keys, 1):
        if progress:
            progress(i / len(keys), f"hashing {os.path.basename(loc[k])}")
        per[k] = file_hash(loc[k])
    combo = hashlib.sha256("|".join(per[k] for k in keys).encode()).hexdigest()
    return combo[:16], per


# ------------------------------------------------------------------ loading --
_df_cache = {}


def _read(path, tag, nrows=None):
    t0 = time.time()
    print(f"[load ] {tag:<14} <- {path}", flush=True)
    try:
        df = pd.read_csv(path, low_memory=False, nrows=nrows)
    except UnicodeDecodeError:
        df = pd.read_csv(path, low_memory=False, nrows=nrows, encoding="latin-1")
    print(f"[load ] {tag:<14} rows={len(df):>9,}  cols={df.shape[1]:>4}  ({time.time() - t0:.1f}s)",
          flush=True)
    return df


def load_region(loc, region, nrows=None, progress=None):
    """-> (data_hash, file_hashes, {sample: DataFrame}). Raises MissingInput."""
    dh, per = region_hash(loc, region, progress=None)
    ck = (dh, nrows)
    if ck in _df_cache:
        return dh, per, _df_cache[ck]
    frames = {}
    keys = region_keys(region)
    for i, (k, s) in enumerate(zip(keys, sample_names(region)), 1):
        if progress:
            progress(i / len(keys), f"loading {s} ({os.path.basename(loc[k])})")
        frames[s] = _read(loc[k], f"{s}_{region}", nrows)
    if len(_df_cache) >= 2:
        _df_cache.pop(next(iter(_df_cache)))
    _df_cache[ck] = frames
    return dh, per, frames


def read_header(path):
    return list(pd.read_csv(path, nrows=0).columns)


def region_columns(loc, region):
    """Union of column names across the region's files (header read only)."""
    cols = []
    seen = set()
    for k in region_keys(region):
        p = loc.get(k, "")
        if not os.path.isfile(p):
            raise MissingInput(f"{k} -> {p or '(no path in locations file)'}")
        for c in read_header(p):
            if c not in seen:
                seen.add(c)
                cols.append(c)
    return cols
