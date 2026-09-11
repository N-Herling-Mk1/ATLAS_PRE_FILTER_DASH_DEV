"""S6 descriptive stats & tails (quantiles q0.5..q99.5, IQR, moments, L-moments,
robust tail ratio, Hill index), on masked values, per sample and pooled signal.

Tail mass (resolved 2026-09-10): fence = median +- k * 1.4826 * MAD; ratio =
observed fraction beyond the fence / Gaussian fraction beyond 3 sigma (0.00135),
left and right separately. When MAD = 0 (zero-inflated), median and MAD are taken
on the non-spike values and the result is labelled 'mad_on_non_spike'.
"""
import numpy as np
from scipy import stats as st

from ..stats_util import GAUSS_ONE_SIDED_3SIG, MAD_TO_SIGMA, clean, lmoment_ratios, mad, top_share


def _tail(x, k):
    med, m = float(np.median(x)), mad(x)
    basis = "mad"
    if not m:
        tv, _ = top_share(x)
        rest = x[x != tv]
        if len(rest) < 10:
            return {"basis": "undefined (MAD=0, too few non-spike values)",
                    "left_ratio": None, "right_ratio": None}
        med, m = float(np.median(rest)), mad(rest)
        basis = "mad_on_non_spike"
        if not m:
            return {"basis": "undefined (MAD=0 on non-spike values)",
                    "left_ratio": None, "right_ratio": None}
    w = k * MAD_TO_SIGMA * m
    lo, hi = med - w, med + w
    fl, fr = float((x < lo).mean()), float((x > hi).mean())
    return {"basis": basis, "fence_lo": lo, "fence_hi": hi,
            "left_frac": fl, "right_frac": fr,
            "left_ratio": fl / GAUSS_ONE_SIDED_3SIG, "right_ratio": fr / GAUSS_ONE_SIDED_3SIG}


QS = [0, 0.5, 1, 5, 25, 50, 75, 95, 99, 99.5, 100]
QK = ["min", "q005", "q01", "q05", "q25", "median", "q75", "q95", "q99", "q995", "max"]


def _hill(x, frac, kmin):
    """Hill estimator of the right-tail index on positive values, top-k order
    statistics with k = max(kmin, frac * n_pos). gamma = 1/alpha; a power law is
    only plausible if gamma is stable in k -- read it as a screen, not a fit."""
    pos = np.sort(x[x > 0])[::-1]
    k = int(max(kmin, frac * len(pos)))
    if len(pos) <= k + 1:
        return None
    top, ref = pos[:k], pos[k]
    if ref <= 0:
        return None
    gamma = float(np.mean(np.log(top / ref)))
    return {"k": k, "gamma": gamma, "alpha": (1.0 / gamma) if gamma > 0 else None}


def describe(x, k, settings=None):
    x = np.asarray(x, float)
    n = len(x)
    if n == 0:
        return {"n": 0}
    q = np.percentile(x, QS)
    d = {"n": int(n), "mean": clean(x.mean()), "sd": clean(x.std(ddof=1)) if n > 1 else None,
         "mad": clean(mad(x))}
    d.update({kk: clean(v) for kk, v in zip(QK, q)})
    d["iqr"] = clean(q[6] - q[4])
    if n > 3 and np.ptp(x) > 0:
        d["skew"] = clean(st.skew(x, bias=False))
        d["excess_kurtosis"] = clean(st.kurtosis(x, fisher=True, bias=False))
        t3, t4 = lmoment_ratios(x)
        d["l_skew"], d["l_kurtosis"] = clean(t3), clean(t4)
        d["tail"] = {kk: (clean(v) if not isinstance(v, str) else v)
                     for kk, v in _tail(x, k).items()}
        if settings:
            h = _hill(x, settings["s6_hill_k_frac"], settings["s6_hill_k_min"])
            d["hill"] = None if h is None else {kk: clean(v) for kk, v in h.items()}
    return d


def run(cv, ctx):
    if ctx["s1"]["type"] in ("text", "empty", "admin"):
        return {"skipped": ctx["s1"]["type"]}
    k = cv.settings["s6_fence_k"]
    st = cv.settings
    per = {s: describe(cv.masked(s), k, st) for s in cv.samples if cv.raw[s] is not None}
    per["sig_pooled"] = describe(cv.masked_sig(), k, st)
    return {"per_sample": per}
