"""S7 histogram + box-plot payloads (drawn client-side).

Common bins for every sample. Continuous: s7_bins bins between the pooled
s7_range_q quantiles, with under/overflow counted. Integer/binary with few values:
one bin per value. Outlier points are sent (thinned evenly to s7_outlier_points per side) and
drawn, not suppressed. The working point overlaid is the background median until
the catalogue carries operating cuts. Box plots are suppressed when IQR = 0 (S5 fired or a spike
holds the quartiles), because every non-spike value would plot as an outlier.
"""
import numpy as np

from ..stats_util import clean
from .s1_typing import DISCRETE


def _thin(v, m):
    """At most m points, evenly spaced through the sorted values (deterministic)."""
    v = np.sort(v)
    if len(v) <= m:
        return v
    return v[np.linspace(0, len(v) - 1, m).round().astype(int)]


def _box(x, m_points=300):
    if x is None or len(x) == 0:
        return None
    q1, med, q3 = np.percentile(x, [25, 50, 75])
    iqr = q3 - q1
    if iqr == 0:
        return {"suppressed": True, "reason": "IQR = 0", "median": clean(med)}
    lo_f, hi_f = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    inside = x[(x >= lo_f) & (x <= hi_f)]
    lo_pts, hi_pts = x[x < lo_f], x[x > hi_f]
    return {"suppressed": False, "q1": clean(q1), "median": clean(med), "q3": clean(q3),
            "whisk_lo": clean(inside.min()), "whisk_hi": clean(inside.max()),
            "n_out_lo": int(len(lo_pts)), "n_out_hi": int(len(hi_pts)),
            "out_lo": [float(v) for v in _thin(lo_pts, m_points)],
            "out_hi": [float(v) for v in _thin(hi_pts, m_points)],
            "min": clean(x.min()), "max": clean(x.max())}


def run(cv, ctx):
    t = ctx["s1"]["type"]
    if t in ("text", "empty", "admin"):
        return {"skipped": t}
    s = cv.settings
    pooled = cv.masked_pooled()
    uniq = np.unique(pooled)
    if t in DISCRETE and len(uniq) <= s["s7_int_bin_max"]:
        edges = np.concatenate([uniq - 0.5, [uniq[-1] + 0.5]])
        mode = "per_value"
        centers = uniq
    else:
        lo, hi = np.quantile(pooled, s["s7_range_q"])
        if hi <= lo:
            lo, hi = float(pooled.min()), float(pooled.max())
        if hi <= lo:
            hi = lo + 1.0
        edges = np.linspace(lo, hi, s["s7_bins"] + 1)
        mode = "uniform"
        centers = None
    hists = {}
    for smp in cv.samples:
        x = cv.masked(smp)
        if x is None:
            continue
        if mode == "per_value":
            idx = np.searchsorted(uniq, x)
            counts = np.bincount(idx, minlength=len(uniq))
            under = over = 0
        else:
            counts, _ = np.histogram(x, bins=edges)
            under, over = int((x < edges[0]).sum()), int((x > edges[-1]).sum())
        hists[smp] = {"counts": counts.astype(int).tolist(), "n": int(len(x)),
                      "under": int(under), "over": int(over)}
    m = s["s7_outlier_points"]
    boxes = {smp: _box(cv.masked(smp), m) for smp in cv.samples if cv.raw[smp] is not None}
    boxes["sig_pooled"] = _box(cv.masked_sig(), m)
    bkg = cv.masked("bkg") if cv.raw.get("bkg") is not None else None
    working = {"bkg_median": clean(np.median(bkg)) if bkg is not None and len(bkg) else None}
    return {"mode": mode, "edges": [float(e) for e in edges],
            "centers": None if centers is None else [float(c) for c in centers],
            "hist": hists, "box": boxes, "working": working}
