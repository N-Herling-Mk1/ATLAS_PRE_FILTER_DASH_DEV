"""S1 column typing. Runs first; gates every family menu downstream and cannot be
overridden (scan layer §1).

Typing ignores NaN/inf and the sentinel set, so a -999 does not turn a binary
column into an integer one.

    binary       cardinality <= 2
    count        integer-valued, all >= 0          (never a continuous family)
    integer      integer-valued with negatives     (discrete; no family menu yet)
    bounded01    float within [0, 1]
    continuous+  float, all >= 0
    continuous   float with negatives
    text / empty
'categorical' (unordered codes) cannot be told apart from counts by value alone;
it is set in the catalogue, never guessed here.
"""
import numpy as np

FAMILY_MENU = {
    "count": ["poisson", "nbinom", "zip", "zinb", "hurdle"],
    "continuous+": ["gamma", "lognormal", "weibull", "exponential", "inv_gaussian", "half_normal"],
    "continuous": ["gaussian", "student_t", "skew_normal", "logistic"],
    "bounded01": ["beta", "kumaraswamy", "beta_inflated"],
    "binary": ["bernoulli"],
    "integer": [], "categorical": [], "text": [], "empty": [],
}
DISCRETE = {"binary", "count", "integer", "categorical"}
CONTINUOUS = {"continuous", "continuous+", "bounded01"}


def run(cv, ctx):
    if cv.admin:
        return {"type": "admin", "family_menu": [], "discrete": False,
                "note": "administrative column: slice key, not a feature"}
    nonnum = sum(cv.nonnumeric.values())
    if nonnum > 0:
        return {"type": "text", "nonnumeric_cells": int(nonnum), "family_menu": [], "discrete": False,
                "note": "non-numeric cells present; column is not scanned further"}
    x = cv.masked_pooled()
    if len(x) == 0:
        return {"type": "empty", "family_menu": [], "discrete": False}
    u = np.unique(x)
    is_int = bool(np.all(np.equal(np.floor(u), u)))
    lo, hi = float(u[0]), float(u[-1])
    if len(u) <= 2:
        t = "binary"
    elif is_int:
        t = "count" if lo >= 0 else "integer"
    elif lo >= 0 and hi <= 1:
        t = "bounded01"
    elif lo >= 0:
        t = "continuous+"
    else:
        t = "continuous"
    return {"type": t, "n_unique": int(len(u)), "integer_valued": is_int,
            "family_menu": FAMILY_MENU[t], "discrete": t in DISCRETE}
