"""S3 dead columns: constant, near-constant, constant in one sample only."""
import numpy as np

from ..stats_util import top_share


def run(cv, ctx):
    if cv.admin:
        return {"skipped": "admin"}
    x = cv.masked_pooled()
    if len(x) == 0:
        return {"empty": True, "constant": True, "near_constant": True,
                "constant_in": None, "top_value": None, "top_share": None}
    tv, ts = top_share(x)
    n_u = len(np.unique(x))
    bkg = cv.masked("bkg") if cv.raw.get("bkg") is not None else np.array([])
    sig = cv.masked_sig()
    b_const = len(bkg) > 0 and len(np.unique(bkg)) == 1
    s_const = len(sig) > 0 and len(np.unique(sig)) == 1
    constant = n_u <= 1
    constant_in = None
    if not constant:
        if b_const and not s_const:
            constant_in = "bkg"
        elif s_const and not b_const:
            constant_in = "sig"
    return {"empty": False, "constant": bool(constant),
            "near_constant": bool(ts > cv.settings["s3_near_constant_share"]),
            "constant_in": constant_in, "top_value": tv, "top_share": ts,
            "n_unique": int(n_u)}
