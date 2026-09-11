"""Gate orchestrator: load a region, run S1..S13 + S6/S7 per column, decide.

progress(frac, msg) is called throughout; console status prints every ~10%.
"""
import time
from datetime import datetime, timezone

from . import loader
from .column import ColumnView
from .config import ENGINE_VERSION, resolve, settings_hash
from . import transforms
from .scans import BUILT, NOT_BUILT, ORDER
from .stats_util import clean
from .verdict import decide

SCHEMA = 2


def _jsonsafe(o):
    if isinstance(o, dict):
        return {str(k): _jsonsafe(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonsafe(v) for v in o]
    if isinstance(o, bool) or o is None or isinstance(o, str):
        return o
    if isinstance(o, int):
        return o
    try:
        import numpy as np
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.bool_):
            return bool(o)
    except ImportError:
        pass
    return clean(o)


def run_gate(loc, region, settings=None, rulings=None, progress=None, nrows=None,
             identity=None, code_commit=None):
    """rulings: {column: {"sentinel": [values], "genuine": [values]}}
    identity / code_commit are stamped into the result (scan layer §16.1)."""
    t0 = time.time()
    prog = progress or (lambda f, m: None)
    settings = resolve(settings)
    rulings = rulings or {}

    def stage(lo, hi):
        return lambda f, m: prog(lo + (hi - lo) * f, m)

    prog(0.0, f"{region}: hashing inputs")
    dh, per_hash = loader.region_hash(loc, region, progress=stage(0.0, 0.10))
    _, _, frames = loader.load_region(loc, region, nrows=nrows, progress=stage(0.10, 0.25))
    counts = {s: int(len(df)) for s, df in frames.items()}
    print(f"[gate ] {region}: counts " + "  ".join(f"{s}={n:,}" for s, n in counts.items()),
          flush=True)

    cols, seen = [], set()
    for df in frames.values():
        for c in df.columns:
            if c not in seen:
                seen.add(c)
                cols.append(c)

    admin = [c for c in settings["admin_columns"] if c in seen]
    pileup = [c for c in settings["pileup_columns"] if c in seen]
    tsrc = transforms.source()
    if tsrc["error"]:
        raise transforms.TransformSourceError(tsrc["error"])
    print(f"[gate ] {region}: S9 transform source = {tsrc['kind']}"
          f"{' (' + tsrc['path'] + ')' if tsrc['path'] else ''}", flush=True)
    results = {}
    step = max(1, len(cols) // 10)
    for i, c in enumerate(cols, 1):
        rs = rulings.get(c, {})
        cv = ColumnView(c, frames, settings, ruled_sentinels=rs.get("sentinel", []), admin=c in admin)
        r = {"_settings": settings}
        for key, mod in ORDER:
            r[key] = mod.run(cv, r)
        # candidates ruled 'genuine' or 'sentinel' are no longer pending
        ruled = set(map(float, rs.get("sentinel", []))) | set(map(float, rs.get("genuine", [])))
        r["s2"]["candidate_values"] = [v for v in r["s2"]["candidate_values"] if v not in ruled]
        r["s2"]["rulings"] = rs
        r["verdict"] = decide(r)
        r.pop("_settings")
        results[c] = r
        prog(0.25 + 0.75 * i / len(cols), f"{region}: scanned {i}/{len(cols)} columns")
        if i % step == 0 or i == len(cols):
            print(f"[gate ] {region}: {i}/{len(cols)} columns  ({time.time() - t0:.1f}s)",
                  flush=True)

    # schema: which columns each file carries, grouped by the set of files missing them
    ncols = {smp: int(df.shape[1]) for smp, df in frames.items()}
    groups = {}
    for c in cols:
        miss = tuple(smp for smp, df in frames.items() if c not in df.columns)
        if miss:
            groups.setdefault(miss, []).append(c)
    schema = {"ncols": ncols, "n_union": len(cols),
              "patterns": [{"missing_from": list(k), "columns": v}
                           for k, v in sorted(groups.items(), key=lambda kv: -len(kv[1]))]}
    sig_only = [p for p in schema["patterns"] if set(p["missing_from"]) < set(s for s in frames if s != "bkg")
                and "bkg" not in p["missing_from"]]
    schema["mass_point_mismatch"] = sig_only
    if sig_only:
        print(f"[gate ] {region}: SCHEMA MISMATCH across mass points: "
              + "; ".join(f"{len(p['columns'])} col(s) missing from {', '.join(p['missing_from'])}"
                          for p in sig_only), flush=True)

    tally = {}
    for r in results.values():
        v = r["verdict"]["verdict"]
        tally[v] = tally.get(v, 0) + 1
    out = {
        "schema": SCHEMA,
        "kind": "gate",
        "engine": ENGINE_VERSION,
        "code_commit": code_commit,
        "identity": identity,
        "admin_columns_present": admin,
        "pileup_columns_present": pileup,
        "s9_source": tsrc,
        "region": region,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_hash": dh,
        "file_hashes": per_hash,
        "files": {k: loc[k] for k in loader.region_keys(region)},
        "counts": counts,
        "nrows_limit": nrows,
        "settings": settings,
        "settings_hash": settings_hash(settings),
        "rulings": rulings,
        "scans_built": BUILT,
        "scans_not_built": NOT_BUILT,
        "tally": tally,
        "schema": schema,
        "columns": results,
        "elapsed_s": round(time.time() - t0, 2),
    }
    prog(1.0, f"{region}: done")
    return _jsonsafe(out)
