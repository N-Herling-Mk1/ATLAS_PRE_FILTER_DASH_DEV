"""S2 missingness & sentinels, per sample.

invalid = NaN + inf + known sentinels + values ruled 'sentinel' in adjudication.
Candidates (continuous types only: continuous, continuous+, bounded01) are REPORTED, never masked, until ruled.
Class by the worst sample: CLEAN / MASKABLE / UNUSABLE, or ABSENT if the column
is missing from any file.
"""
import numpy as np

from ..stats_util import clean
from .s1_typing import CONTINUOUS


def _candidates(x, share_min, iqr_dist):
    x = x[np.isfinite(x)]
    n = len(x)
    if n == 0:
        return []
    v, c = np.unique(x, return_counts=True)
    out = []
    for val, cnt in zip(v, c):
        share = cnt / n
        if share < share_min:
            continue
        rest = x[x != val]
        if len(rest) < 10:
            continue
        q1, med, q3 = np.percentile(rest, [25, 50, 75])
        iqr = q3 - q1
        if iqr > 0:
            dist = abs(val - med) / iqr
            hit = dist >= iqr_dist
        else:
            lo, hi = np.percentile(rest, [1, 99])
            dist = None
            hit = val < lo or val > hi
        if hit:
            out.append({"value": float(val), "share": float(share),
                        "iqr_dist": clean(dist)})
    return out


def run(cv, ctx):
    s = cv.settings
    t = ctx["s1"]["type"]
    per = {}
    worst = 0.0
    absent = [smp for smp, p in cv.present.items() if not p]
    for smp in cv.samples:
        x = cv.raw[smp]
        if x is None:
            per[smp] = {"present": False}
            continue
        n = len(x)
        nan = int(np.isnan(x).sum())
        inf = int(np.isinf(x).sum())
        sent = {}
        for v in cv.sentinels:
            k = int((x == v).sum())
            if k:
                sent[repr(v)] = k
        inv = nan + inf + sum(sent.values())
        frac = inv / n if n else 0.0
        worst = max(worst, frac)
        cands = []
        if t in CONTINUOUS:
            xs = x[np.isfinite(x) & ~cv.is_sentinel(x)]
            cands = _candidates(xs, s["s2_candidate_share"], s["s2_candidate_iqr_dist"])
        per[smp] = {"present": True, "n": n, "nan": nan, "inf": inf,
                    "sentinels": sent, "invalid_frac": frac, "candidates": cands}
    if absent:
        cls = "ABSENT"
    elif worst <= s["s2_clean_max"]:
        cls = "CLEAN"
    elif worst <= s["s2_maskable_max"]:
        cls = "MASKABLE"
    else:
        cls = "UNUSABLE"
    cand_values = sorted({c["value"] for p in per.values() for c in p.get("candidates", [])})
    return {"class": cls, "worst_invalid_frac": worst, "absent_in": absent,
            "per_sample": per, "candidate_values": cand_values,
            "sentinel_set": cv.sentinels}
