"""Named real-data canaries (scope §12).

A canary is a known fact about the real files. Names must match the real header
exactly; an absent column reports NOT_FOUND rather than guessing a spelling.
"""
ENDCAP_COUNTS = {"bkg": 24850, "mS5": 532, "mS16": 1051, "mS35": 1047, "mS55": 515}   # Aug 2026 runs, total 27,995
BARREL_COUNTS = {"bkg": 2280}   # barrel background on record; barrel signal has two readings (1,226 / 1,125)


def _s9_flag(mode):
    return lambda r: bool(((r.get("s9") or {}).get("scalers") or {}).get(mode, {}).get("flag"))


CANARIES = [
    # Real records only (canon C1). The Aug README's "counts read column-limited in
    # S9" came from the August test fixture, not from real data; removed after the first real run.
    {"id": "C-S9-EIEM", "region": "endcap", "column": "nMSeg_ratio_EIEM", "scan": "S9",
     "expect": "minmax flagged (central span 1.167e-05 on record)", "test": _s9_flag("minmax")},
    # hit counts are non-negative integers by definition -> S1 must type them 'count'
    {"id": "C-S1-nMDT", "region": None, "column": "msvtx_nMDT", "scan": "S1",
     "expect": "typed count", "test": lambda r: r["s1"].get("type") == "count"},
    {"id": "C-S1-nRPC", "region": None, "column": "msvtx_nRPC", "scan": "S1",
     "expect": "typed count", "test": lambda r: r["s1"].get("type") == "count"},
    {"id": "C-S1-nBOL", "region": None, "column": "nBOL", "scan": "S1",
     "expect": "typed count", "test": lambda r: r["s1"].get("type") == "count"},
    # registry name MS1Vtx_l1hcal; which header column it resolves to is not yet pinned
    {"id": "C-S3-l1hcal", "region": "barrel", "column": "MS1Vtx_l1hcal", "scan": "S3",
     "expect": "constant", "test": lambda r: bool(r["s3"].get("constant"))},
    {"id": "C-S13-htmiss", "region": None, "column": "htmiss_NOSYS", "scan": "S13",
     "expect": "flagged", "test": lambda r: bool(r["s13"].get("known_exclusion") or r["s13"].get("leak"))},
    {"id": "C-S13-met", "region": None, "column": "met_met_NOSYS", "scan": "S13",
     "expect": "flagged", "test": lambda r: bool(r["s13"].get("known_exclusion") or r["s13"].get("leak"))},
]


def evaluate(result):
    region = result["region"]
    out = []
    pins = {"endcap": ENDCAP_COUNTS, "barrel": BARREL_COUNTS}.get(region)
    if pins:
        got = result.get("counts", {})
        same = all(got.get(k) == v for k, v in pins.items())
        out.append({"id": "C-COUNTS", "column": "(event counts)", "scan": "ingest",
                    "expect": ", ".join(f"{k} {v:,}" for k, v in pins.items()),
                    "status": "PASS" if same else ("SKIP (smoke run)" if result.get("nrows_limit") else "FAIL")})
    for c in CANARIES:
        if c["region"] and c["region"] != region:
            continue
        r = result["columns"].get(c["column"])
        if r is None:
            status = "NOT_FOUND"
        else:
            status = "PASS" if c["test"](r) else "FAIL"
        out.append({"id": c["id"], "column": c["column"], "scan": c["scan"],
                    "expect": c["expect"], "status": status})
    return out
