"""EDA sheet, first iteration (docs/EDA_PLAN_mk1.md).

Two jobs:

  file_manifest(loc)   every expected input: file name, found, size, column count
                       (header read only -- fast, safe to call on sheet open)
  run_eda(loc, region) per feature column: signal vs background histogram on
                       common auto-scaled bins, mean / variance / std-dev per
                       class, and the MaxEnt readouts below

Signal is the four mass points pooled, unweighted (eventWeight is an admin
column and is not applied). Every statistic reads masked values -- NaN, inf and
the sentinel set removed -- per canon C7. Nothing here fabricates data (C1): a
missing file stops the run by name.

Gaussian reference ("gauss_ref"), per class, continuous columns only
--------------------------------------------------------------------
These are descriptive numbers measured against ONE MaxEnt yardstick. The
MaxEnt fits proper -- case identity and the constraint ladder -- are in
engine/maxent.py and land under each column's "maxent" key.

Given only a mean and a variance, the maximum-entropy density is the Gaussian,
and its entropy H_G = 0.5 ln(2 pi e var) is the largest ANY density with that
variance can have. So:

  H      histogram estimate of the differential entropy (nats), Miller-Madow
         corrected, on the in-range values
  H_G    Gaussian bound for the same in-range values
  J      negentropy, H_G - H >= 0 (up to estimator noise): the information in
         the column beyond its first two moments. J ~ 0 means a two-moment
         MaxEnt model already describes the column; large J means it does not.

Separation, both as Bhattacharyya distance so the two are on one scale:

  DB_hist   -ln sum sqrt(p q) over the common bins, under/overflow included
  DB_gauss  the same distance between the two MaxEnt (Gaussian) models,
            closed form from the class means and variances
  DB_null   mean DB_hist over label permutations: the level noise alone reaches
            at these sample sizes -- read DB_hist against it, not against zero

DB_gauss / DB_hist is the share of the separation a two-moment model can see.
It is only reported once DB_hist clears twice DB_null; below that it is a ratio
of two noise readings.
A ratio well below 1 says the discriminating information lives in shape (tails,
spikes, multimodality), which a mean-and-variance description throws away.

Discrete columns (binary, count, integer) get the discrete entropy and DB_hist
only. A Gaussian is a density and these are PMFs (EDA plan, "three ways to
compute it wrong", rule 3), so no H_G, J or DB_gauss is reported for them.

Pure Python; never imports Flask (canon C2).
"""
import math
import os
import time

import numpy as np

from . import loader, maxent
from .column import ColumnView
from .config import ENGINE_VERSION, resolve, settings_hash
from .scans import s1_typing
from .scans.s6_stats import describe
from .stats_util import clean

EDA_VERSION = "eda mk2"
N_PERM = 20                   # label permutations for DB_null
PERM_SEED = 20260924          # fixed: the null is deterministic for identical inputs
LOGY_RATIO = 50.0             # auto log-y when the tallest bin exceeds 50x the median non-empty bin


# ---------------------------------------------------------------- manifest --
def file_manifest(loc):
    """Every expected input file, with its column count from the header.

    -> {"files": [...], "regions": {region: {"union": n, "keys": [...]}}}
    Rows are not counted here (that needs a full read); run_eda fills them in.
    """
    inv = loader.expected_inventory()
    files = []
    for key, fname in inv.items():
        p = loc.get(key, "")
        found = bool(p) and os.path.isfile(p)
        row = {"key": key, "filename": fname, "path": p, "found": found,
               "mb": round(os.path.getsize(p) / 1e6, 2) if found else None,
               "n_columns": None, "error": None}
        parts = key.split("_")
        row["group"] = ("background" if key.startswith("BKG_") else
                        "signal" if key.startswith("SIG_") else "nn-list")
        row["region"] = parts[1] if row["group"] != "nn-list" else None
        row["sample"] = ("bkg" if row["group"] == "background" else
                         parts[2] if row["group"] == "signal" else "_".join(parts[1:]))
        if found:
            try:
                row["_cols"] = loader.read_header(p)
                row["n_columns"] = len(row["_cols"])
            except Exception as e:                   # unreadable header: say so, by file
                row["error"] = f"{type(e).__name__}: {e}"
        files.append(row)

    regions = {}
    for f in files:
        if f["group"] == "nn-list" or "_cols" not in f:
            continue
        regions.setdefault(f["region"], []).append(f)
    summary = {}
    for r, fs in regions.items():
        union = []
        seen = set()
        for f in fs:
            for c in f["_cols"]:
                if c not in seen:
                    seen.add(c)
                    union.append(c)
        for f in fs:
            have = set(f["_cols"])
            f["missing_vs_region"] = [c for c in union if c not in have]
        summary[r] = {"union": len(union), "keys": [f["key"] for f in fs]}
    for f in files:
        f.pop("_cols", None)
    return {"files": files, "regions": summary}


# ------------------------------------------------------------------ stats --
def _moments(x):
    n = int(len(x))
    if n == 0:
        return {"n": 0, "mean": None, "var": None, "std": None}
    var = float(x.var(ddof=1)) if n > 1 else None
    return {"n": n, "mean": clean(x.mean()), "var": clean(var),
            "std": clean(math.sqrt(var)) if var is not None else None}


def _bins(t, pooled, settings):
    """Common edges for both classes. Discrete with few values: one bin per value.
    Otherwise uniform between the pooled s7_range_q quantiles (auto-scale): the
    axis follows the bulk of the data, and the tails are counted, not dropped."""
    uniq = np.unique(pooled)
    if t in s1_typing.DISCRETE and len(uniq) <= settings["s7_int_bin_max"]:
        return "per_value", uniq, np.concatenate([uniq - 0.5, [uniq[-1] + 0.5]])
    lo, hi = np.quantile(pooled, settings["s7_range_q"])
    if hi <= lo:
        lo, hi = float(pooled.min()), float(pooled.max())
    if hi <= lo:
        hi = lo + 1.0
    return "uniform", None, np.linspace(lo, hi, settings["s7_bins"] + 1)


def _hist(x, mode, uniq, edges):
    if mode == "per_value":
        idx = np.searchsorted(uniq, x)
        return np.bincount(idx, minlength=len(uniq)), 0, 0
    c, _ = np.histogram(x, bins=edges)
    return c, int((x < edges[0]).sum()), int((x > edges[-1]).sum())


def _entropy(counts, widths, discrete):
    """Plug-in entropy with the Miller-Madow correction, nats.
    Continuous: differential, -sum p ln(p / width). Discrete: -sum p ln p."""
    n = counts.sum()
    if n == 0:
        return None
    nz = counts > 0
    p = counts[nz] / n
    h = -np.sum(p * np.log(p)) if discrete else -np.sum(p * np.log(p / widths[nz]))
    return float(h + (nz.sum() - 1) / (2.0 * n))


def _gauss_h(var):
    return 0.5 * math.log(2 * math.pi * math.e * var) if var and var > 0 else None


def _db_hist(cs, cb):
    """Bhattacharyya distance between two count vectors on the same bins."""
    ns, nb = cs.sum(), cb.sum()
    if ns == 0 or nb == 0:
        return None
    bc = float(np.sum(np.sqrt((cs / ns) * (cb / nb))))
    return float(-math.log(bc)) if bc > 0 else math.inf     # no shared bin: disjoint


def _db_gauss(m1, v1, m2, v2):
    if None in (m1, v1, m2, v2) or v1 <= 0 or v2 <= 0:
        return None
    s = v1 + v2
    return float(0.25 * (m1 - m2) ** 2 / s + 0.5 * math.log(s / (2 * math.sqrt(v1 * v2))))


def _full_counts(x, mode, uniq, edges):
    c, u, o = _hist(x, mode, uniq, edges)
    return np.concatenate([[u], c, [o]]).astype(float)


def _db_null(sig, bkg, mode, uniq, edges, rng):
    """Mean DB over label permutations: what DB_hist reads when S and B are the
    same distribution, at exactly these sample sizes and bins."""
    pool = np.concatenate([sig, bkg])
    ns = len(sig)
    vals = []
    for _ in range(N_PERM):
        perm = rng.permutation(len(pool))
        d = _db_hist(_full_counts(pool[perm[:ns]], mode, uniq, edges),
                     _full_counts(pool[perm[ns:]], mode, uniq, edges))
        if d is not None and d != math.inf:
            vals.append(d)
    return clean(np.mean(vals)) if vals else None


def _maxent(sig, bkg, cs, cb, mode, edges, discrete, ms, mb, rng, uniq):
    widths = np.diff(edges)
    out = {"discrete": discrete}
    for tag, x, c in (("sig", sig, cs), ("bkg", bkg, cb)):
        h = _entropy(c, widths, discrete)
        d = {"H": clean(h)}
        if not discrete:
            inr = x[(x >= edges[0]) & (x <= edges[-1])]
            hg = _gauss_h(float(inr.var(ddof=1))) if len(inr) > 1 else None
            d["H_G"] = clean(hg)
            d["J"] = clean(hg - h) if (hg is not None and h is not None) else None
        out[tag] = d
    fs, fb = _full_counts(sig, mode, uniq, edges), _full_counts(bkg, mode, uniq, edges)
    dbh = _db_hist(fs, fb)
    # disjoint supports: every event is classified by this column alone. Reported
    # as a flag, not a number -- on a feature that is a leakage signature.
    out["disjoint"] = dbh == math.inf
    out["DB_hist"] = None if out["disjoint"] else clean(dbh)
    out["DB_null"] = _db_null(sig, bkg, mode, uniq, edges, rng)
    if not discrete:
        out["DB_gauss"] = clean(_db_gauss(ms["mean"], ms["var"], mb["mean"], mb["var"]))
        dh, dg, dn = out["DB_hist"], out["DB_gauss"], out["DB_null"]
        # a ratio of two numbers at noise level is noise: only report the share
        # once the histogram separation clears twice the permutation null
        out["share_at_noise"] = bool(dh is not None and dn is not None and dh <= 2 * dn)
        out["moment_share"] = (clean(dg / dh) if (dh and dg is not None and dh > 0
                                                  and not out["share_at_noise"]) else None)
    return out


def _auto_logy(cs, cb, ns, nb):
    """Log-y when the tallest (normalised) bin dwarfs the typical one -- spikes
    and zero-inflated columns flatten everything else on a linear axis."""
    ys = np.concatenate([cs / max(ns, 1), cb / max(nb, 1)])
    nz = ys[ys > 0]
    if len(nz) < 3:
        return False
    return bool(nz.max() / np.median(nz) > LOGY_RATIO)


# -------------------------------------------------------------------- run --
def run_eda(loc, region, settings=None, rulings=None, progress=None, nrows=None, identity=None,
            code_commit=None):
    """-> dict ready for JSON. Raises loader.MissingInput if an input is missing."""
    t0 = time.time()
    prog = progress or (lambda f, m: None)
    settings = resolve(settings)
    rulings = rulings or {}

    prog(0.0, f"{region}: hashing inputs")
    dh, per_hash = loader.region_hash(loc, region)
    _, _, frames = loader.load_region(
        loc, region, nrows=nrows, progress=lambda f, m: prog(0.02 + 0.18 * f, m))
    keys = loader.region_keys(region)
    files = []
    for k, s in zip(keys, loader.sample_names(region)):
        files.append({"key": k, "sample": s, "filename": os.path.basename(loc[k]),
                      "rows": int(len(frames[s])), "n_columns": int(frames[s].shape[1])})

    cols, seen = [], set()
    for df in frames.values():
        for c in df.columns:
            if c not in seen:
                seen.add(c)
                cols.append(c)
    admin = set(c for c in settings["admin_columns"] if c in seen)

    rng = np.random.default_rng(PERM_SEED)
    out_cols, skipped = [], []
    feats = [c for c in cols if c not in admin]
    print(f"[eda  ] {region}: {len(cols)} columns, {len(admin)} admin, {len(feats)} to graph", flush=True)
    step = max(1, len(feats) // 10)
    for i, c in enumerate(feats, 1):
        prog(0.20 + 0.78 * i / len(feats), f"{region}: {i}/{len(feats)} {c} (graphs, stats, MaxEnt fits)")
        if i % step == 0 or i == len(feats):
            print(f"[eda  ] {region}: {100 * i / len(feats):5.1f}%  {i}/{len(feats)}", flush=True)
        cv = ColumnView(c, frames, settings,
                        ruled_sentinels=rulings.get(c, {}).get("sentinel", []))
        t = s1_typing.run(cv, {})["type"]
        if t in ("text", "empty"):
            skipped.append({"column": c, "reason": t})
            continue
        if cv.raw.get("bkg") is None or not cv.sig_samples or all(cv.raw[s] is None for s in cv.sig_samples):
            skipped.append({"column": c, "reason": "absent from background or from every signal file"})
            continue
        bkg, sig = cv.masked("bkg"), cv.masked_sig()
        if len(bkg) == 0 or len(sig) == 0:
            skipped.append({"column": c, "reason": "no valid values in one class after masking"})
            continue
        out_cols.append(_column(cv, c, t, sig, bkg, settings, rng))

    prog(1.0, f"{region}: {len(out_cols)} columns graphed")
    return {"kind": "eda", "eda": EDA_VERSION, "engine": ENGINE_VERSION, "region": region,
            "data_hash": dh, "file_hashes": per_hash, "files": files,
            "settings_hash": settings_hash(settings), "nrows_limit": nrows,
            "identity": identity, "code_commit": code_commit,
            "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "counts": {f["sample"]: f["rows"] for f in files},
            "n_columns_total": len(cols), "admin_columns": sorted(admin),
            "n_graphed": len(out_cols), "skipped": skipped, "columns": out_cols,
            "settings_used": {k: settings[k] for k in ("s7_bins", "s7_int_bin_max", "s7_range_q",
                                                     "known_sentinels")},
            "n_perm": N_PERM, "elapsed_s": round(time.time() - t0, 1)}


def _column(cv, c, t, sig, bkg, settings, rng, detail=False):
    """Everything the sheet shows for one column. detail=True adds what only the
    enlarged view needs: per-mass histograms, CDFs and KS, full descriptive
    stats, and the MaxEnt curves."""
    pooled = np.concatenate([sig, bkg])
    mode, uniq, edges = _bins(t, pooled, settings)
    cs, us, os_ = _hist(sig, mode, uniq, edges)
    cb, ub, ob = _hist(bkg, mode, uniq, edges)
    ms, mb = _moments(sig), _moments(bkg)
    ms["n_invalid"] = int(sum(cv.invalid(s).sum() for s in cv.sig_samples if cv.raw[s] is not None))
    mb["n_invalid"] = int(cv.invalid("bkg").sum())
    discrete = mode == "per_value"
    gref = _maxent(sig, bkg, cs.astype(float), cb.astype(float), mode, edges, discrete, ms, mb, rng, uniq)
    try:
        me = maxent.analyse(t, sig, bkg, settings, db_hist=gref.get("DB_hist"), curves=detail)
    except Exception as e:                       # a fit failure is reported on the column, not fatal
        me = {"case": {"case": "error", "label": f"{type(e).__name__}: {e}"}}
    out = {
        "column": c, "type": t,
        "missing_in": [s for s in cv.samples if cv.raw[s] is None],
        "mode": mode, "edges": [float(e) for e in edges],
        "centers": None if uniq is None else [float(u) for u in uniq],
        "hist": {"bkg": {"counts": cb.astype(int).tolist(), "n": int(len(bkg)), "under": ub, "over": ob},
                 "sig_pooled": {"counts": cs.astype(int).tolist(), "n": int(len(sig)),
                                "under": us, "over": os_}},
        "auto_logy": _auto_logy(cs, cb, len(sig), len(bkg)),
        "stats": {"sig": ms, "bkg": mb},
        "gauss_ref": gref,
        "maxent": me,
    }
    if detail:
        from scipy.stats import ks_2samp
        per_mass = {}
        for smp in cv.sig_samples:
            x = cv.masked(smp)
            if x is None or len(x) == 0:
                continue
            cm, um, om = _hist(x, mode, uniq, edges)
            per_mass[smp] = {"counts": cm.astype(int).tolist(), "n": int(len(x)), "under": um, "over": om}
        out["hist_mass"] = per_mass
        ks = ks_2samp(sig, bkg)
        grid = np.unique(np.quantile(pooled, np.linspace(0, 1, 201)))
        cdf_s = np.searchsorted(np.sort(sig), grid, side="right") / len(sig)
        cdf_b = np.searchsorted(np.sort(bkg), grid, side="right") / len(bkg)
        j = int(np.argmax(np.abs(cdf_s - cdf_b)))
        out["cdf"] = {"x": [float(v) for v in grid], "sig": [float(v) for v in cdf_s],
                      "bkg": [float(v) for v in cdf_b], "ks": clean(ks.statistic),
                      "ks_p": clean(ks.pvalue), "at": float(grid[j])}
        k = settings["s6_fence_k"]
        out["describe"] = {"sig": describe(sig, k, settings), "bkg": describe(bkg, k, settings)}
    return out


def feature_detail(loc, region, column, settings=None, rulings=None):
    """One column, with everything the enlarged view needs. Uses the loader's
    frame cache, so after a region run this is a fraction of a second."""
    settings = resolve(settings)
    rulings = rulings or {}
    _, _, frames = loader.load_region(loc, region)
    if not any(column in df.columns for df in frames.values()):
        raise KeyError(f"no column '{column}' in any {region} file")
    cv = ColumnView(column, frames, settings, ruled_sentinels=rulings.get(column, {}).get("sentinel", []))
    t = s1_typing.run(cv, {})["type"]
    if t in ("text", "empty") or cv.raw.get("bkg") is None:
        raise ValueError(f"'{column}' is {t if t in ('text', 'empty') else 'absent from background'}: nothing to show")
    bkg, sig = cv.masked("bkg"), cv.masked_sig()
    if len(bkg) == 0 or len(sig) == 0:
        raise ValueError(f"'{column}' has no valid values in one class after masking")
    return _column(cv, column, t, sig, bkg, settings, np.random.default_rng(PERM_SEED), detail=True)
