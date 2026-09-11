"""Headless gate run on real data. No Flask involved.

    python -m engine.cli --home --region endcap
    python -m engine.cli --home --region all --smoke        (first 2000 rows per file)
    python -m engine.cli --home --check                     (inventory only)
"""
import argparse
import json
import os
import sys
import time

from . import canaries, loader
from .config import REGIONS
from .gate import run_gate
from .provenance import code_commit


def _bar(frac, msg, width=30):
    n = int(frac * width)
    sys.stdout.write(f"\r[{'#' * n}{'.' * (width - n)}] {frac:6.1%}  {msg[:60]:<60}")
    sys.stdout.flush()


def main():
    ap = argparse.ArgumentParser(description="ATLAS pre-filter gate (headless)")
    ap.add_argument("--home", action="store_true")
    ap.add_argument("--office", action="store_true")
    ap.add_argument("--locations")
    ap.add_argument("--region", default="all", choices=REGIONS + ["all"])
    ap.add_argument("--check", action="store_true", help="inventory check only")
    ap.add_argument("--smoke", action="store_true", help="first 2000 rows per file (real data)")
    ap.add_argument("--out", default="out", help="output folder for result json")
    a = ap.parse_args()

    try:
        path = loader.resolve_locations(a.home, a.office, a.locations)
    except loader.MissingInput as e:
        sys.exit(f"[loader] {e}")
    print(f"[loader] using: {path}")
    from . import transforms
    ts = transforms.source()
    print(f"[S9   ] transform source: {ts['kind']}" + (f"  ({ts['path']})" if ts['path'] else "")
          + (f"  ERROR: {ts['error']}" if ts['error'] else ""))
    loc = loader.parse_locations(path)
    rows = loader.check_inventory(loc)
    for i, r in enumerate(rows, 1):
        tag = "Found    " if r["found"] else "NOT FOUND"
        print(f"[{i:>2}/{len(rows)} | {tag}] {r['filename']:<24} {r['mb'] or '':>8}  {r['path']}")
    if a.check:
        sys.exit(0 if all(r["found"] for r in rows) else 1)

    os.makedirs(a.out, exist_ok=True)
    regions = REGIONS if a.region == "all" else [a.region]
    for reg in regions:
        t0 = time.time()
        try:
            res = run_gate(loc, reg, progress=_bar, nrows=2000 if a.smoke else None,
                           identity=os.environ.get("USERNAME") or os.environ.get("USER"),
                           code_commit=code_commit())
        except loader.MissingInput as e:
            print()
            sys.exit(f"[gate ] {reg}: {e}")
        print()
        fn = os.path.join(a.out, f"gate_{reg}_{res['data_hash']}{'_smoke' if a.smoke else ''}.json")
        with open(fn, "w") as f:
            json.dump(res, f)
        print(f"[gate ] {reg}: tally {res['tally']}  ({time.time() - t0:.1f}s)  -> {fn}")
        for pat in res["schema"]["patterns"]:
            print(f"[schema] {len(pat['columns']):>3} column(s) missing from {', '.join(pat['missing_from'])}: "
                  + ", ".join(pat["columns"][:6]) + (" ..." if len(pat["columns"]) > 6 else ""))
        for c in canaries.evaluate(res):
            print(f"[canary] {c['status']:<9} {c['id']:<14} {c['column']} ({c['scan']}: {c['expect']})")


if __name__ == "__main__":
    main()
