"""S13 leakage screen (target + provenance pre-checks).

value AUC: masked signal (all masses pooled) vs masked background.
NaN-pattern AUC: the invalid indicator (NaN/inf/sentinel) as the score; for a
binary score AUC = 0.5 + (p_sig - p_bkg)/2.
Separation is direction-free: max(AUC, 1 - AUC).
Signal is MC and background is data: a high AUC here is not separation evidence
until this scan clears the column (S12 runs after S13).
Data-vs-MC comparability (July G2) is not built in mk1.
"""
import numpy as np

from ..stats_util import auc, separation


def _mi_bits(xb, yb, nx, ny):
    """Plug-in MI in bits with the Miller-Madow bias correction."""
    n = len(xb)
    joint = np.bincount(xb * ny + yb, minlength=nx * ny).reshape(nx, ny) / n
    px, py = joint.sum(1), joint.sum(0)
    nz = joint > 0
    mi = float((joint[nz] * np.log2(joint[nz] / np.outer(px, py)[nz])).sum())
    kxy, kx, ky = nz.sum(), (px > 0).sum(), (py > 0).sum()
    return mi - (kxy - kx - ky + 1) / (2 * n * np.log(2))


def _mass_mi(cv, s):
    """S13.2 provenance: MI(feature; mass point) on signal, against a permutation
    null. A feature that tells you which mass point an event came from is learning
    the signal grid and will evaporate on held-out mass. Reported as a note, never
    a DROP: some mass dependence is physics."""
    xs, ys = [], []
    for k, smp in enumerate(cv.sig_samples):
        m = cv.masked(smp)
        if m is None or not len(m):
            continue
        xs.append(m)
        ys.append(np.full(len(m), k))
    if len(xs) < 2:
        return None
    x, y = np.concatenate(xs), np.concatenate(ys)
    nb = s["s13_mass_mi_bins"]
    edges = np.unique(np.quantile(x, np.linspace(0, 1, nb + 1)[1:-1]))
    xb = np.searchsorted(edges, x, side="right")
    nx, ny = int(xb.max()) + 1, int(y.max()) + 1
    if nx < 2:
        return {"mi_bits": 0.0, "null_mean": None, "null_sd": None, "z": None, "n": int(len(x)),
                "bins": int(nx)}
    obs = _mi_bits(xb, y, nx, ny)
    rng = np.random.default_rng(20260911)            # fixed seed: reproducible null
    null = np.array([_mi_bits(xb, rng.permutation(y), nx, ny) for _ in range(s["s13_mass_mi_perms"])])
    sd = float(null.std(ddof=1))
    z = (obs - float(null.mean())) / sd if sd > 0 else None
    return {"mi_bits": obs, "null_mean": float(null.mean()), "null_sd": sd, "z": z,
            "n": int(len(x)), "bins": int(nx), "flag": bool(z is not None and z >= s["s13_mass_mi_z"])}


def run(cv, ctx):
    s = cv.settings
    out = {"value_auc": None, "value_sep": None, "nan_auc": None, "nan_sep": None,
           "known_exclusion": (s["known_exclusions"].get(cv.name) or [None, None])[1],
           "exclusion_reason": (s["known_exclusions"].get(cv.name) or [None, None])[0],
           "mass_mi": None,
           "constant_in_one": ctx["s3"].get("constant_in"),
           "comparability": "not built (mk1)", "leak": False,
           "provenance_flag": False, "reasons": []}
    if cv.raw.get("bkg") is None or not cv.sig_samples:
        return out
    if ctx["s1"]["type"] in ("text", "empty", "admin"):
        return out
    b, g = cv.masked("bkg"), cv.masked_sig()
    a = auc(g, b)
    out["value_auc"], out["value_sep"] = a, separation(a)
    ib, ig = cv.invalid("bkg"), cv.invalid_sig()
    out["mass_mi"] = _mass_mi(cv, s)
    if len(ib) and len(ig):
        na = 0.5 + (float(ig.mean()) - float(ib.mean())) / 2.0
        out["nan_auc"], out["nan_sep"] = na, separation(na)
    r = out["reasons"]
    if out["value_sep"] is not None and out["value_sep"] >= s["s13_value_auc"]:
        r.append(f"value separation {out['value_sep']:.4f} >= {s['s13_value_auc']}")
    if out["nan_sep"] is not None and out["nan_sep"] >= s["s13_nan_auc"]:
        r.append(f"invalid-pattern separation {out['nan_sep']:.4f} >= {s['s13_nan_auc']}")
    if out["constant_in_one"]:
        r.append(f"constant in {out['constant_in_one']} only")
    out["leak"] = bool(r)
    if out["known_exclusion"]:
        r.append(f"known exclusion ({out['exclusion_reason']}): " + out["known_exclusion"])
    if (not out["leak"] and out["value_sep"] is not None
            and out["value_sep"] >= s["s13_provenance_auc"]):
        out["provenance_flag"] = True
    return out
