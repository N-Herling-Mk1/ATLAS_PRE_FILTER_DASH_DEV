"""S9 dynamic range / span audit (scan layer §9). The only scan that reads
TRANSFORMED values; it diagnoses the scaler, not the feature.

Per (column x scaler): Shannon entropy over a FIXED 256-bin grid on the
transform's declared output range, divided by the achievable ceiling (entropy of
the column's own value multiplicities, capped at 8 bits) = realised_frac.

This is a DETECTOR. realised_frac < 0.5 means the scaler is crushing the column
(the nMSeg_ratio_EIEM minmax case). There is deliberately no 'best scaler':
a rank transform is the entropy-maximising monotone map, so it tops any entropy
ranking by construction and a ranking would say nothing about whether it is good.

Reads S2-masked values. If the training path leaves sentinels in before scaling,
minmax compression there is worse than shown here.
"""
import numpy as np

from .. import transforms
from ..stats_util import clean


def _grid_bits(y, lo, hi, bins):
    counts, _ = np.histogram(y, bins=bins, range=(lo, hi))
    p = counts[counts > 0] / max(counts.sum(), 1)
    return float(-(p * np.log2(p)).sum()) if len(p) else 0.0


def _ceiling_bits(x, max_bits):
    _, c = np.unique(x, return_counts=True)
    p = c / c.sum()
    return float(min(-(p * np.log2(p)).sum(), max_bits))


def _central_span(y, clips):
    lo, hi = np.quantile(y, [0.005, 0.995])
    den = 1.0 if clips else float(y.max() - y.min())
    return float((hi - lo) / den) if den > 0 else 0.0


def run(cv, ctx):
    if ctx["s1"]["type"] in ("text", "empty", "admin"):
        return {"skipped": ctx["s1"]["type"]}
    s = cv.settings
    x = cv.masked_pooled()
    if len(x) < 2:
        return {"skipped": "too few values"}
    bins = s["s9_bins"]
    max_bits = float(np.log2(bins))
    ceil = _ceiling_bits(x, max_bits)
    src = transforms.source()
    rows = {}
    for mode in s["s9_scalers"]:
        y, clips, kind = transforms.transform(x, mode)
        y = y[np.isfinite(y)]
        lo, hi = transforms.GRIDS[mode]
        outside = float(((y < lo - 1e-9) | (y > hi + 1e-9)).mean()) if len(y) else 0.0
        grid_ok = mode == "standard" or outside <= 0.01     # standard: tails beyond 4 sigma land in edge bins by design
        if mode == "standard":
            y = np.clip(y, lo, hi)
        bits = _grid_bits(y, lo, hi, bins)
        realised = bits / ceil if ceil > 0 else None
        comparable = bool(grid_ok and ceil > 0)
        rows[mode] = {"source": kind, "entropy_bits": clean(bits), "realised_frac": clean(realised),
                      "central_span": clean(_central_span(y, clips)) if len(y) else None,
                      "eff_resolution": clean(len(np.unique(y)) / len(y)) if len(y) else None,
                      "clips": clips, "outside_grid": clean(outside), "grid_mismatch": not grid_ok,
                      "comparable": comparable,
                      "flag": bool(comparable and realised is not None and realised < s["s9_realised_min"])}
    pinned = s["s9_pinned"]
    return {"source": src["kind"], "source_path": src["path"], "ceiling_bits": clean(ceil),
            "column_limited": bool(ceil < 0.5 * max_bits), "scalers": rows, "pinned": pinned,
            "pinned_flag": bool(rows.get(pinned, {}).get("flag"))}
