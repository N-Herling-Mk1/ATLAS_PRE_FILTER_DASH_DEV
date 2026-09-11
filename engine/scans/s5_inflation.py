"""S5 spikes, zero-inflation and tie fraction (scan layer §5).

Spikes: any value holding > s5_spike_share of the pooled masked values, every
type. Known and ruled sentinels are already masked, so they never appear here.
Kind: sentinel candidate (an unruled S2 candidate), zero (structural vs sampling
is decided by the zero-inflation test on counts), or value (saturating ratio,
cut boundary).

Tie fraction: share of events whose value is shared with at least one other
event. Events in a tied group cannot be ordered by any transform, so this is a
hard ceiling on what a rank transform can resolve.

Zero-inflation (count columns): van den Broek (1995) score statistic against a
Poisson with the sample mean -- one-sided z, positive = excess zeros -- which
avoids the boundary-nested LRT. Detector counts are overdispersed and
overdispersion alone produces excess zeros, so the flag also requires observed
P(0) above the moment-matched negative binomial P(0).
"""
import math

import numpy as np

from .s1_typing import CONTINUOUS


def _share(x, v):
    return float((x == v).mean()) if x is not None and len(x) else None


def _zero_inflation(x, z_min):
    n = len(x)
    mu = float(x.mean())
    var = float(x.var(ddof=1)) if n > 1 else 0.0
    p0_obs = float((x == 0).mean())
    out = {"zero_share": p0_obs, "mean": mu, "var": var, "poisson_p0": None, "nb_p0": None,
           "vdb_z": None, "zero_inflated": False}
    if mu <= 0:
        return out
    p0 = math.exp(-mu)
    out["poisson_p0"] = p0
    if p0 > 0:
        num = (p0_obs * n) / p0 - n
        den = n * (1 - p0) / p0 - n * mu
        if den > 0:
            out["vdb_z"] = num / math.sqrt(den)
    if var > mu:
        r = mu * mu / (var - mu)
        out["nb_p0"] = (r / (r + mu)) ** r
    beats_nb = out["nb_p0"] is None or p0_obs > out["nb_p0"]
    out["zero_inflated"] = bool(out["vdb_z"] is not None and out["vdb_z"] > z_min and beats_nb)
    return out


def run(cv, ctx):
    s = cv.settings
    t = ctx["s1"]["type"]
    x = cv.masked_pooled()
    n = len(x)
    out = {"tie_frac": None, "spikes": [], "fired": False, "zi": None}
    if n == 0 or t in ("text", "admin"):
        return out
    v, c = np.unique(x, return_counts=True)
    out["tie_frac"] = float(1.0 - (c == 1).sum() / n)
    order = np.argsort(-c)
    cands = set((ctx.get("s2") or {}).get("candidate_values") or [])
    for j in order:
        share = c[j] / n
        if share <= s["s5_spike_share"]:
            break
        val = float(v[j])
        kind = ("sentinel candidate (S2)" if val in cands else "zero" if val == 0 else "value")
        out["spikes"].append({"value": val, "share": float(share), "kind": kind,
                              "per_sample": {smp: _share(cv.masked(smp), val)
                                             for smp in cv.samples if cv.raw[smp] is not None}})
        if len(out["spikes"]) >= 8:
            break
    if t == "count":
        out["zi"] = _zero_inflation(x, s["s5_zi_z"])
    out["fired"] = bool((t in CONTINUOUS and out["spikes"]) or (out["zi"] and out["zi"]["zero_inflated"]))
    return out
