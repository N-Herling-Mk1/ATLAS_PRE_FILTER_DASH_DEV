"""S14.5 cross-block dCor (scan layer §14.5): dependence between a candidate NN1
feature set and NN2 feature set in BACKGROUND, computed before training.

Design score for a proposed split. What it is and is not:
  * It measures dependence between the INPUT blocks. The DisCo numbers on record
    (.046 / .098 / .3018) are dependence between NETWORK OUTPUTS. Feature-level
    dCor is a predictor of how much work lambda will have to do; its calibration
    against output dCor is unknown until both are measured on the same splits.
  * Columns are rank-transformed to [0,1] first (declared; robust to units and
    tails, and close to the pinned quantile scaler).
  * dCor needs n x n distance matrices, so it is computed on random subsamples of
    s145_subsample background rows, repeated s145_repeats times. The permutation
    null shuffles the NN2 rows within each subsample; z = (dCor - null mean) / null sd.
  * Rows with any invalid value (NaN, inf, known sentinel) in either block are
    dropped; the count is reported.
"""
import time

import numpy as np
import pandas as pd
from scipy.spatial.distance import cdist
from scipy.stats import rankdata

from . import loader
from .config import resolve


def _centered(X):
    D = cdist(X, X)
    return D - D.mean(0, keepdims=True) - D.mean(1, keepdims=True) + D.mean()


def _dcor(A, B):
    xy, xx, yy = (A * B).mean(), (A * A).mean(), (B * B).mean()
    if xx <= 0 or yy <= 0:
        return 0.0
    return float(np.sqrt(max(xy, 0.0) / np.sqrt(xx * yy)))


def _ranks(M):
    return np.column_stack([(rankdata(c, method="average") - 1) / max(len(c) - 1, 1) for c in M.T])


def run_crossblock(loc, region, nn1, nn2, settings=None, progress=None, nrows=None):
    s = resolve(settings)
    prog = progress or (lambda f, m: None)
    t0 = time.time()
    prog(0.0, "loading background")
    dh, _, frames = loader.load_region(loc, region, nrows=nrows)
    bkg = frames["bkg"]
    cols = set(bkg.columns)
    miss1 = [f for f in nn1 if f not in cols]
    miss2 = [f for f in nn2 if f not in cols]
    f1 = [f for f in nn1 if f in cols]
    f2 = [f for f in nn2 if f in cols]
    overlap = sorted(set(f1) & set(f2))
    if not f1 or not f2:
        raise ValueError(f"need features in both blocks present in the data (NN1 {len(f1)}, NN2 {len(f2)})")
    X = bkg[f1].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float, na_value=np.nan)
    Y = bkg[f2].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float, na_value=np.nan)
    sent = np.asarray(s["known_sentinels"], float)
    ok = (np.isfinite(X).all(1) & np.isfinite(Y).all(1) &
          ~np.isin(X, sent).any(1) & ~np.isin(Y, sent).any(1))
    X, Y = _ranks(X[ok]), _ranks(Y[ok])
    n = len(X)
    m = min(s["s145_subsample"], n)
    R, P = s["s145_repeats"], s["s145_perms"]
    rng = np.random.default_rng(20260911)
    obs, null = [], []
    per1 = {f: [] for f in f1}
    per2 = {f: [] for f in f2}
    total = R * (1 + P + len(f1) + len(f2))
    done = 0
    for r in range(R):
        idx = rng.choice(n, size=m, replace=False)
        A, B = _centered(X[idx]), _centered(Y[idx])
        obs.append(_dcor(A, B))
        done += 1
        for _ in range(P):
            p = rng.permutation(m)
            null.append(_dcor(A, B[np.ix_(p, p)]))
            done += 1
            prog(done / total, f"repeat {r + 1}/{R}: permutation null")
        for j, f in enumerate(f1):
            per1[f].append(_dcor(_centered(X[idx][:, [j]]), B))
            done += 1
        for j, f in enumerate(f2):
            per2[f].append(_dcor(A, _centered(Y[idx][:, [j]])))
            done += 1
        prog(done / total, f"repeat {r + 1}/{R} done")
    obs, null = np.array(obs), np.array(null)
    nsd = float(null.std(ddof=1)) if len(null) > 1 else None
    out = {
        "kind": "crossblock", "region": region, "data_hash": dh,
        "n_bkg": int(len(bkg)), "n_used": int(n), "n_dropped_invalid": int((~ok).sum()),
        "subsample": int(m), "repeats": int(R), "perms": int(P),
        "nn1": f1, "nn2": f2, "missing_nn1": miss1, "missing_nn2": miss2, "overlap": overlap,
        "dcor_mean": float(obs.mean()), "dcor_sd": float(obs.std(ddof=1)) if R > 1 else None,
        "dcor_repeats": obs.tolist(),
        "null_mean": float(null.mean()), "null_sd": nsd,
        "z": (float((obs.mean() - null.mean()) / nsd) if nsd else None),
        "per_feature_nn1_vs_nn2block": {f: float(np.mean(v)) for f, v in per1.items()},
        "per_feature_nn2_vs_nn1block": {f: float(np.mean(v)) for f, v in per2.items()},
        "transform": "rank to [0,1] per column",
        "elapsed_s": round(time.time() - t0, 1),
    }
    prog(1.0, "done")
    return out
