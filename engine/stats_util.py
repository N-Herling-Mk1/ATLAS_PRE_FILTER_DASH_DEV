"""Small, dependency-light statistics used across scans."""
import math

import numpy as np
from scipy import stats as _st

GAUSS_ONE_SIDED_3SIG = float(_st.norm.sf(3.0))   # 0.00135: Gaussian mass beyond +3 sigma
MAD_TO_SIGMA = 1.4826


def clean(x):
    """float -> JSON-safe (NaN/inf -> None)."""
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def auc(pos, neg):
    """P(score_pos > score_neg) + 0.5 P(tie), via ranks. None if a side is empty."""
    pos = np.asarray(pos, float)
    neg = np.asarray(neg, float)
    n1, n0 = len(pos), len(neg)
    if n1 == 0 or n0 == 0:
        return None
    r = _st.rankdata(np.concatenate([pos, neg]))
    u = r[:n1].sum() - n1 * (n1 + 1) / 2.0
    return float(u / (n1 * n0))


def separation(a):
    """Direction-free AUC: max(AUC, 1-AUC)."""
    return None if a is None else max(a, 1.0 - a)


def mad(x):
    x = np.asarray(x, float)
    if len(x) == 0:
        return None
    return float(np.median(np.abs(x - np.median(x))))


def lmoment_ratios(x):
    """Sample L-skewness (tau3) and L-kurtosis (tau4) from probability-weighted moments."""
    x = np.sort(np.asarray(x, float))
    n = len(x)
    if n < 4:
        return None, None
    i = np.arange(n)
    b0 = x.mean()
    b1 = np.sum(i * x) / (n * (n - 1))
    b2 = np.sum(i * (i - 1) * x) / (n * (n - 1) * (n - 2))
    b3 = np.sum(i * (i - 1) * (i - 2) * x) / (n * (n - 1) * (n - 2) * (n - 3))
    l2 = 2 * b1 - b0
    l3 = 6 * b2 - 6 * b1 + b0
    l4 = 20 * b3 - 30 * b2 + 12 * b1 - b0
    if l2 == 0:
        return None, None
    return float(l3 / l2), float(l4 / l2)


def top_share(x):
    """(value, share) of the most common value."""
    x = np.asarray(x, float)
    if len(x) == 0:
        return None, None
    v, c = np.unique(x, return_counts=True)
    j = int(np.argmax(c))
    return float(v[j]), float(c[j] / len(x))
