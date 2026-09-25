"""MaxEnt marginals per feature, per class (docs/EDA_PLAN_mk1.md §5).

A MaxEnt fit keeps a chosen set of statistics fixed and is otherwise as
uncommitted as possible:

    p(x) = exp( sum_k lambda_k f_k(x) ) / Z        on the column's support

Which distribution comes out is decided by the constraints f_k AND the support,
so the first job per column is its CASE:

    case         support                      ladder of constraint sets (rungs)
    ----------   --------------------------   --------------------------------------------
    binary       two values                   Bernoulli (exact; nothing to fit)
    lattice      integers min..max            {x}  {x, ln x!} (COM-Poisson)  {x, x^2}
                                              + an indicator on a heavy value (zero-inflation)
    real         observed range on R          {x, x^2} Gaussian  +x^3  +x^4
    positive     observed range on R+         {x, x^2}  {x} exponential  {x, ln x} gamma
                                              {ln x, ln^2 x} lognormal  {x..x^4}
    unit         observed range in [0, 1]     {} uniform  {ln x, ln(1-x)} beta  {x, x^2}  {x..x^4}

A continuous column with one value holding >= SPIKE_SHARE of the pooled mass
is a HURDLE case: that value is a point mass with its own weight per class, and
the ladder is fitted to the rest. A smooth exp(...) density cannot put finite
probability on one value.

Per class and rung: log-likelihood, AIC and BIC (and dAIC / dBIC to the class's
best), and LEFT OUT = cross-entropy of the data under the fit minus the data's
own entropy estimate. For a MaxEnt fit that is exactly the information the
constraint set does not carry; on the Gaussian rung it is the negentropy J.

Between classes, per rung: the Bhattacharyya distance between the S fit and the
B fit on the same rung, next to the histogram D_B. The rung where it stops
growing is where the separation lives.

Rules kept (notebook, "three ways to compute it wrong"):
  1. every rung of a class is fitted to the SAME rows (identical n)
  2. every rung is a density in x itself; log constraints change the
     constraint set, not the variable, so no Jacobian is needed
  3. integer columns get lattice (PMF) fits only, never densities

Densities are solved on the support: continuous on a fine grid over the
column's observed range (so every fit is truncated to that range -- a Gaussian
here is a Gaussian restricted to [lo, hi]); lattice on every integer in range.
The dual is convex; Newton with backtracking. Pure numpy/scipy, no Flask (C2).
"""
import math

import numpy as np
from scipy.special import gammaln, logsumexp

SPIKE_SHARE = 0.05          # hurdle when one value holds >= 5% of the pooled column
GRID = 512                  # quadrature points for continuous supports
LATTICE_MAX = 20000         # integer supports wider than this are refused, by name
CURVE_POINTS = 200          # points per curve sent to the page (detail view only)

LABELS = {
    "gauss": "Gaussian {x, x²}", "m3": "cubic {x, x², x³}", "m4": "quartic {x … x⁴}",
    "exp": "exponential {x}", "gamma": "gamma {x, ln x}", "lognorm": "lognormal {ln x, ln² x}",
    "uniform": "uniform {}", "beta": "beta {ln x, ln(1−x)}",
    "geom": "geometric {x}", "cmp": "COM-Poisson {x, ln x!}", "dgauss": "discrete Gaussian {x, x²}",
    "bern": "Bernoulli {x}",
}
LADDERS = {
    "real": ["gauss", "m3", "m4"],
    "positive": ["gauss", "exp", "gamma", "lognorm", "m4"],
    "unit": ["uniform", "beta", "gauss", "m4"],
    "lattice": ["geom", "cmp", "dgauss"],
}
GAUSS_RUNG = {"real": "gauss", "positive": "gauss", "unit": "gauss", "lattice": "dgauss"}


# ---------------------------------------------------------------- features --
def _features(rung, x, c, r):
    """Columns of f_k(x). Polynomials are taken in u = (x - c) / r in [-1, 1]:
    the same constraint set (a linear change of basis), far better conditioned."""
    u = (x - c) / r
    if rung in ("gauss", "dgauss"):
        return [u, u * u]
    if rung == "m3":
        return [u, u * u, u ** 3]
    if rung == "m4":
        return [u, u * u, u ** 3, u ** 4]
    if rung in ("exp", "geom"):
        return [u]
    if rung == "gamma":
        return [u, np.log(x)]
    if rung == "lognorm":
        lx = np.log(x)
        return [lx, lx * lx]
    if rung == "beta":
        return [np.log(x), np.log1p(-x)]
    if rung == "cmp":
        return [u, gammaln(x + 1.0)]
    if rung == "uniform":
        return []
    raise KeyError(rung)


def _needs(rung):
    """Support condition for a rung: 'pos' needs x > 0, 'unit' needs 0 < x < 1,
    'nonneg' needs x >= 0 (ln x!)."""
    return {"gamma": "pos", "lognorm": "pos", "beta": "unit", "cmp": "nonneg"}.get(rung)


def _support_ok(need, lo, hi):
    if need == "pos":
        return lo > 0
    if need == "unit":
        return lo > 0 and hi < 1
    if need == "nonneg":
        return lo >= 0
    return True


# ------------------------------------------------------------------- solve --
def _fit(data, support, weight, rung, c, r):
    """MaxEnt on a discrete support with quadrature weight (dx for a grid, 1 for
    a lattice). -> dict with ll (summed over data), logp on the support, k, ok."""
    n = len(data)
    fd = _features(rung, data, c, r)
    if not fd:                                           # k = 0: uniform on the support
        logz = math.log(weight * len(support))
        return {"k": 0, "ll": -n * logz, "logp": np.full(len(support), -logz), "ok": True, "iters": 0}
    D = np.column_stack(fd)
    m, s = D.mean(0), D.std(0)
    keep = s > 1e-12 * (np.abs(m) + 1.0)
    if not keep.any():
        return None                                      # every constraint is constant in these rows
    D = (D[:, keep] - m[keep]) / s[keep]
    G = (np.column_stack(_features(rung, support, c, r))[:, keep] - m[keep]) / s[keep]
    k = G.shape[1]
    lam = np.zeros(k)
    lw = math.log(weight)

    def obj(l):
        return logsumexp(G @ l) + lw                     # target moments are 0 after standardising

    f0, ok, it = obj(lam), False, 0
    for it in range(1, 101):
        a = G @ lam
        p = np.exp(a - a.max())
        p /= p.sum()
        e = p @ G
        if np.max(np.abs(e)) < 1e-9:
            ok = True
            break
        H = (G * p[:, None]).T @ G - np.outer(e, e) + 1e-10 * np.eye(k)
        try:
            step = np.linalg.solve(H, e)
        except np.linalg.LinAlgError:
            break
        t = 1.0
        while t > 1e-8:
            cand = lam - t * step
            fc = obj(cand)
            if fc <= f0 - 1e-4 * t * float(e @ step):
                lam, f0 = cand, fc
                break
            t *= 0.5
        else:
            break
    a = G @ lam
    logp = a - (logsumexp(a) + lw)                       # log density (grid) or log pmf (lattice)
    return {"k": int(k), "ll": -n * f0, "logp": logp, "ok": ok, "iters": it}


def _entropy_hist(x, lo, hi, discrete):
    """Data entropy estimate, Miller-Madow corrected, nats: discrete over the
    observed values, differential over 64 bins of [lo, hi]."""
    n = len(x)
    if n < 2:
        return None
    if discrete:
        _, cnt = np.unique(x, return_counts=True)
        p = cnt / n
        return float(-(p * np.log(p)).sum() + (len(cnt) - 1) / (2 * n))
    cnt, edges = np.histogram(x, bins=64, range=(lo, hi))
    nz = cnt > 0
    p = cnt[nz] / n
    w = np.diff(edges)[nz]
    return float(-(p * np.log(p / w)).sum() + (nz.sum() - 1) / (2 * n))


def _bc(logp_s, logp_b, weight):
    """Bhattacharyya coefficient between two fitted densities on one support."""
    return float(np.exp(0.5 * (logp_s + logp_b)).sum() * weight)


# -------------------------------------------------------------------- case --
def identify(t, pooled, settings):
    """-> case dict from the S1 type and the pooled (S+B) masked values."""
    uniq, cnt = np.unique(pooled, return_counts=True)
    top = int(np.argmax(cnt))
    top_v, top_share = float(uniq[top]), float(cnt[top] / len(pooled))
    lo_q, hi_q = np.quantile(pooled, settings["s7_range_q"])
    base = {"n_unique": int(len(uniq)), "top_value": top_v, "top_share": top_share}
    if t == "binary" or len(uniq) <= 2:
        return {**base, "case": "binary", "label": "binary: Bernoulli, exact", "spike": None}
    if t in ("count", "integer"):
        lo, hi = float(uniq[0]), float(uniq[-1])
        if hi - lo + 1 > LATTICE_MAX:
            return {**base, "case": "unsupported", "spike": None,
                    "label": f"integer range {int(hi - lo + 1):,} values: too wide for a lattice fit"}
        spike = top_v if top_share >= SPIKE_SHARE else None
        lab = f"integer lattice [{int(lo)}, {int(hi)}]"
        if spike is not None:
            lab += f", {100 * top_share:.0f}% at {spike:g} (inflation rung added)"
        return {**base, "case": "lattice", "lo": lo, "hi": hi, "spike": spike, "label": lab}
    spike = top_v if top_share >= SPIKE_SHARE else None
    rest = pooled[pooled != spike] if spike is not None else pooled
    if len(rest) < 20:
        return {**base, "case": "unsupported", "spike": spike,
                "label": "fewer than 20 values outside the spike"}
    lo, hi = np.quantile(rest, settings["s7_range_q"])
    if hi <= lo:
        lo, hi = float(rest.min()), float(rest.max())
    if hi <= lo:
        return {**base, "case": "unsupported", "spike": spike, "label": "no spread outside the spike"}
    case = "unit" if t == "bounded01" else "positive" if t == "continuous+" else "real"
    name = {"unit": "bounded [0, 1]", "positive": "positive R+", "real": "real R"}[case]
    lab = f"{name}, fitted on [{lo:.4g}, {hi:.4g}]"
    if spike is not None:
        lab += f"; hurdle: {100 * top_share:.0f}% at {spike:g} is a point mass"
    return {**base, "case": case, "lo": float(lo), "hi": float(hi), "spike": spike, "label": lab,
            "ignored_tails": float(((pooled < lo) | (pooled > hi)).mean()) if spike is None else
            float((((rest < lo) | (rest > hi)).sum()) / len(pooled))}


# --------------------------------------------------------------------- run --
def analyse(t, sig, bkg, settings, db_hist=None, curves=False):
    """Case identity plus the rung ladder for both classes.

    db_hist: the histogram Bhattacharyya distance (from eda) for 'captured'.
    curves:  include density curves and log-likelihood ratios (detail view)."""
    pooled = np.concatenate([sig, bkg])
    case = identify(t, pooled, settings)
    out = {"case": case}
    if case["case"] == "unsupported":
        return out
    if case["case"] == "binary":
        vals = np.unique(pooled)
        hi = vals[-1]
        ps, pb = float((sig == hi).mean()), float((bkg == hi).mean())
        bc = math.sqrt(ps * pb) + math.sqrt((1 - ps) * (1 - pb))
        out["binary"] = {"value": float(hi), "p_sig": ps, "p_bkg": pb,
                         "db": None if bc <= 0 else -math.log(bc)}
        return out

    discrete = case["case"] == "lattice"
    lo, hi, spike = case["lo"], case["hi"], case["spike"]
    if discrete:
        support = np.arange(lo, hi + 1.0)
        weight = 1.0
    else:
        dx = (hi - lo) / GRID
        support = lo + dx * (np.arange(GRID) + 0.5)
        weight = dx
    c, r = 0.5 * (lo + hi), max(0.5 * (hi - lo), 1e-12)

    ladder = list(LADDERS[case["case"]])
    classes = {}
    for tag, x in (("sig", sig), ("bkg", bkg)):
        inr = x[(x >= lo) & (x <= hi)] if not discrete else x
        if spike is not None and not discrete:
            n_spike = int((x == spike).sum())
            body = inr[inr != spike]
            n = len(body) + n_spike
            w = n_spike / n if n else 0.0
            ll_spike = (n_spike * math.log(w) if n_spike else 0.0) + \
                       (len(body) * math.log(1 - w) if len(body) and w < 1 else 0.0)
        else:
            body, n, w, ll_spike = inr, len(inr), 0.0, 0.0
        classes[tag] = {"body": body, "n": int(n), "n_body": int(len(body)), "w_spike": w,
                        "ll_spike": ll_spike, "H_data": _entropy_hist(body, lo, hi, discrete),
                        "rungs": {}}

    rungs_run = list(ladder)
    if discrete and spike is not None:
        rungs_run.append("infl")
    skipped = {}
    infl_base = None
    for rung in rungs_run:
        base_rung = None
        if rung == "infl":                               # the best non-inflated rung by B's BIC, + 1[x = spike]
            cand = [q for q in ladder if q in classes["bkg"]["rungs"]]
            if not cand:
                continue
            base_rung = infl_base = min(cand, key=lambda q: classes["bkg"]["rungs"][q]["bic"])
        need = _needs(base_rung or rung)
        if not _support_ok(need, lo, hi):
            skipped[rung] = {"pos": "needs x > 0 on the support", "unit": "needs 0 < x < 1",
                             "nonneg": "needs x >= 0"}[need]
            continue
        fits = {}
        for tag in ("sig", "bkg"):
            cl = classes[tag]
            if cl["n_body"] < 10:
                fits = None
                break
            if rung == "infl":
                f = _fit_infl(cl["body"], support, base_rung, c, r, spike)
            else:
                f = _fit(cl["body"], support, weight, rung, c, r)
            if f is None:
                fits = None
                break
            fits[tag] = f
        if fits is None:
            skipped[rung] = "too few values, or every constraint constant"
            continue
        for tag in ("sig", "bkg"):
            cl, f = classes[tag], fits[tag]
            k = f["k"] + (1 if (spike is not None and not discrete) else 0)
            ll = f["ll"] + cl["ll_spike"]
            n = cl["n"]
            ce = -f["ll"] / cl["n_body"]
            cl["rungs"][rung] = {"k": k, "ll": ll, "aic": 2 * k - 2 * ll, "bic": k * math.log(n) - 2 * ll,
                                 "left_out": (ce - cl["H_data"]) if cl["H_data"] is not None else None,
                                 "converged": f["ok"], "logp": f["logp"]}
        bc = _bc(fits["sig"]["logp"], fits["bkg"]["logp"], weight)
        if spike is not None and not discrete:
            ws, wb = classes["sig"]["w_spike"], classes["bkg"]["w_spike"]
            bc = math.sqrt(ws * wb) + math.sqrt((1 - ws) * (1 - wb)) * bc
        for tag in ("sig", "bkg"):
            classes[tag]["rungs"][rung]["db_between"] = -math.log(bc) if bc > 0 else None

    # tabulate: deltas, bests, and what the page shows
    res = {"skipped_rungs": skipped, "classes": {}}
    for tag in ("sig", "bkg"):
        cl = classes[tag]
        rg = cl["rungs"]
        if not rg:
            res["classes"][tag] = {"n": cl["n"], "rungs": []}
            continue
        bmin = min(v["bic"] for v in rg.values())
        amin = min(v["aic"] for v in rg.values())
        best_b = min(rg, key=lambda q: rg[q]["bic"])
        best_a = min(rg, key=lambda q: rg[q]["aic"])
        near = [q for q in rg if rg[q]["bic"] - bmin <= 2.0]
        rows = []
        for q in rungs_run:
            if q not in rg:
                continue
            v = rg[q]
            rows.append({"rung": q, "label": _label(q, infl_base, spike),
                         "k": v["k"], "ll": _f(v["ll"]), "aic": _f(v["aic"]), "bic": _f(v["bic"]),
                         "d_aic": _f(v["aic"] - amin), "d_bic": _f(v["bic"] - bmin),
                         "left_out": _f(v["left_out"]) if v["left_out"] is not None else None,
                         "db_between": _f(v["db_between"]) if v["db_between"] is not None else None,
                         "converged": v["converged"]})
        res["classes"][tag] = {
            "n": cl["n"], "n_body": cl["n_body"], "w_spike": cl["w_spike"], "H_data": cl["H_data"],
            "best_bic": best_b, "best_aic": best_a, "agree": best_b == best_a,
            "identified": len(near) == 1, "within_2": near, "rungs": rows}
    out.update(res)

    # headline: each class on its OWN best rung. The separation between the two
    # best fits is what a MaxEnt description of this column can see; forcing S
    # onto B's rung would hide, e.g., a bimodal signal over a Gaussian background.
    cb, cs = res["classes"].get("bkg", {}), res["classes"].get("sig", {})
    if cb.get("rungs") and cs.get("rungs"):
        hb, hs = cb["best_bic"], cs["best_bic"]
        gr = GAUSS_RUNG[case["case"]]
        bc = _bc(classes["sig"]["rungs"][hs]["logp"], classes["bkg"]["rungs"][hb]["logp"], weight)
        if spike is not None and not discrete:
            ws, wb = classes["sig"]["w_spike"], classes["bkg"]["w_spike"]
            bc = math.sqrt(ws * wb) + math.sqrt((1 - ws) * (1 - wb)) * bc
        dbm = -math.log(bc) if bc > 0 else None
        dbg = classes["bkg"]["rungs"].get(gr, {}).get("db_between")
        ratio = lambda d: float(d / db_hist) if (db_hist and d is not None and db_hist > 0) else None
        out["headline"] = {
            "bkg_rung": hb, "bkg_label": _label(hb, infl_base, spike),
            "sig_rung": hs, "sig_label": _label(hs, infl_base, spike),
            "left_out_bkg": _f(classes["bkg"]["rungs"][hb]["left_out"]),
            "left_out_sig": _f(classes["sig"]["rungs"][hs]["left_out"]),
            "db_model": _f(dbm), "db_gauss": _f(dbg),
            "captured": ratio(dbm), "gauss_captured": ratio(dbg),
            "identified_bkg": cb["identified"], "identified_sig": cs["identified"],
            "agree_bkg": cb["agree"], "within_2_bkg": cb["within_2"], "within_2_sig": cs["within_2"]}

    if curves:
        idx = np.linspace(0, len(support) - 1, min(CURVE_POINTS, len(support))).round().astype(int)
        cv = {"x": [float(v) for v in support[idx]], "discrete": discrete, "rungs": {}}
        for q in rungs_run:
            if q in classes["sig"]["rungs"] and q in classes["bkg"]["rungs"]:
                ls, lb = classes["sig"]["rungs"][q]["logp"], classes["bkg"]["rungs"][q]["logp"]
                cv["rungs"][q] = {
                    # density per unit x (continuous) or pmf (lattice), body part only;
                    # the page scales by (1 - w_spike) and its bin width to overlay
                    "sig": [float(v) for v in np.exp(ls[idx])],
                    "bkg": [float(v) for v in np.exp(lb[idx])],
                    "llr": [float(v) for v in (ls - lb)[idx]],
                }
        out["curves"] = cv
    return out


def _f(v):
    return None if v is None or not math.isfinite(v) else float(v)


def _label(q, base, spike):
    if q == "infl":
        return f"{LABELS.get(base, base)} + 1[x = {spike:g}]"
    return LABELS[q]


def _fit_infl(body, support, base_rung, c, r, spike):
    """Lattice rung with an extra indicator constraint on the spike value:
    the MaxEnt form of zero-inflation."""
    fd = _features(base_rung, body, c, r) + [(body == spike).astype(float)]
    fs = _features(base_rung, support, c, r) + [(support == spike).astype(float)]
    n = len(body)
    D, G = np.column_stack(fd), np.column_stack(fs)
    m, s = D.mean(0), D.std(0)
    keep = s > 1e-12 * (np.abs(m) + 1.0)
    if not keep.any():
        return None
    D = (D[:, keep] - m[keep]) / s[keep]
    G = (G[:, keep] - m[keep]) / s[keep]
    k = G.shape[1]
    lam = np.zeros(k)

    def obj(l):
        return logsumexp(G @ l)

    f0, ok, it = obj(lam), False, 0
    for it in range(1, 101):
        a = G @ lam
        p = np.exp(a - a.max())
        p /= p.sum()
        e = p @ G
        if np.max(np.abs(e)) < 1e-9:
            ok = True
            break
        H = (G * p[:, None]).T @ G - np.outer(e, e) + 1e-10 * np.eye(k)
        try:
            step = np.linalg.solve(H, e)
        except np.linalg.LinAlgError:
            break
        t = 1.0
        while t > 1e-8:
            cand = lam - t * step
            fc = obj(cand)
            if fc <= f0 - 1e-4 * t * float(e @ step):
                lam, f0 = cand, fc
                break
            t *= 0.5
        else:
            break
    a = G @ lam
    return {"k": int(k), "ll": -n * f0, "logp": a - logsumexp(a), "ok": ok, "iters": it}
