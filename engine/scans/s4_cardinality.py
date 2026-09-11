"""S4 cardinality & quantization (scan layer §4).

Low cardinality (<= s4_low_card_max, default 50) flags a column; an integer-valued
low-cardinality column is a dequantization candidate. Treatments in increasing
aggressiveness: log1p | rank | train-time jitter (sigma << 1). The FIT (S11)
still uses discrete families on the raw column -- different consumer.
"""
import numpy as np


def run(cv, ctx):
    if cv.admin:
        return {"skipped": "admin"}
    x = cv.masked_pooled()
    n_u = int(len(np.unique(x))) if len(x) else 0
    low = bool(1 < n_u <= cv.settings["s4_low_card_max"])
    is_int = bool(ctx["s1"].get("integer_valued"))
    return {"n_unique": n_u, "low_card": low,
            "eff_resolution": (n_u / len(x)) if len(x) else None,
            "dequant_candidate": bool(low and is_int and n_u > 2),
            "treatment": ("log1p | rank | jitter (train-time only)" if (low and is_int and n_u > 2)
                          else "low cardinality, non-integer: check for upstream binning" if low and not is_int
                          else "")}
