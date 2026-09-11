"""Reference snapshot: the signed-off first real load (scope §12).

digest() keeps what must reproduce; compare() lists every difference as a
REGRESSION. Floats are rounded to 9 significant digits.
"""
def _r(x):
    return None if x is None else float(f"{x:.9g}")


def digest(result):
    d = {"region": result["region"], "data_hash": result["data_hash"],
         "settings_hash": result["settings_hash"], "counts": result["counts"], "columns": {}}
    for c, r in result["columns"].items():
        d["columns"][c] = {
            "verdict": r["verdict"]["verdict"],
            "type": r["s1"].get("type"),
            "s2_class": r["s2"].get("class"),
            "s2_worst": _r(r["s2"].get("worst_invalid_frac")),
            "s3_constant": r["s3"].get("constant"),
            "s3_near_constant": r["s3"].get("near_constant"),
            "s4_n_unique": (r["s4"] or {}).get("n_unique"),
            "s5_fired": r["s5"].get("fired"),
            "s13_value_auc": _r(r["s13"].get("value_auc")),
            "s13_nan_auc": _r(r["s13"].get("nan_auc")),
            "s9_pinned_flag": (r.get("s9") or {}).get("pinned_flag"),
            "s9_column_limited": (r.get("s9") or {}).get("column_limited"),
        }
    return d


def compare(ref, result):
    cur = digest(result)
    diffs = []
    if ref["counts"] != cur["counts"]:
        diffs.append({"column": "(counts)", "field": "counts", "ref": ref["counts"], "now": cur["counts"]})
    for c in sorted(set(ref["columns"]) | set(cur["columns"])):
        a, b = ref["columns"].get(c), cur["columns"].get(c)
        if a is None or b is None:
            diffs.append({"column": c, "field": "presence", "ref": a is not None, "now": b is not None})
            continue
        for k in a:
            if a[k] != b.get(k):
                diffs.append({"column": c, "field": k, "ref": a[k], "now": b.get(k)})
    return diffs
