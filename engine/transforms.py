"""Scaler source for S9.

S9 has to judge the transform the NETWORK actually receives. The training path's
scaler is llp/data.py::apply_scale (the Aug 11 in-fold refactor, delivered to
projects\\atlas\\src\\llp\\). Set PFD_LLP_SRC to the folder that CONTAINS the llp
package and S9 imports that function and uses it as-is.

Without PFD_LLP_SRC, S9 runs the reference transforms below and every S9 result
is labelled source='reference'. They are declared, not presented as the training
path.

Nominal output grids are declared per mode. If a transform's output falls
outside its declared grid (e.g. an llp quantile configured for a normal output),
that scaler is marked grid_mismatch and never flagged: a fixed grid is only
meaningful if it is the transform's real output range.
"""
import importlib
import os
import sys

import numpy as np
from scipy.stats import rankdata

GRIDS = {"minmax": (0.0, 1.0), "standard": (-4.0, 4.0), "quantile": (0.0, 1.0), "log1p": (0.0, 1.0)}
CLIPS = {"minmax": True, "standard": False, "quantile": False, "log1p": True}


class TransformSourceError(Exception):
    pass


# ------------------------------------------------------------ reference ------
def _minmax(x):
    lo, hi = float(x.min()), float(x.max())
    return np.clip((x - lo) / (hi - lo), 0, 1) if hi > lo else np.zeros_like(x)


def _standard(x):
    sd = float(x.std())
    return (x - x.mean()) / sd if sd > 0 else np.zeros_like(x)


def _quantile(x):
    """Rank transform to [0,1]; ties take the average rank."""
    if len(x) < 2:
        return np.zeros_like(x)
    return (rankdata(x, method="average") - 1) / (len(x) - 1)


def _log1p(x):
    lo = float(x.min())
    return _minmax(np.log1p(x - lo if lo < 0 else x))


REFERENCE = {"minmax": _minmax, "standard": _standard, "quantile": _quantile, "log1p": _log1p}


# ----------------------------------------------------------------- llp -------
_llp = {"loaded": False, "fn": None, "path": None, "error": None}


def _load_llp():
    if _llp["loaded"]:
        return
    _llp["loaded"] = True
    src = os.environ.get("PFD_LLP_SRC", "").strip()
    if not src:
        return
    if not os.path.isfile(os.path.join(src, "llp", "data.py")):
        _llp["error"] = f"PFD_LLP_SRC={src} has no llp\\data.py"
        return
    if src not in sys.path:
        sys.path.insert(0, src)
    try:
        mod = importlib.import_module("llp.data")
        _llp["fn"] = getattr(mod, "apply_scale")
        _llp["path"] = os.path.join(src, "llp", "data.py")
    except Exception as e:                      # reported, never silently replaced
        _llp["error"] = f"importing llp.data failed: {type(e).__name__}: {e}"


def source():
    """-> dict(kind='llp'|'reference', path, error). An import error is fatal for
    S9 (raised by transform()), so a broken training path is never masked by the
    reference transforms."""
    _load_llp()
    if _llp["fn"] is not None:
        return {"kind": "llp", "path": _llp["path"], "error": None}
    return {"kind": "reference", "path": None, "error": _llp["error"]}


def transform(x, mode):
    """-> (scaled 1-D array, clips flag, source kind)"""
    src = source()
    if src["error"]:
        raise TransformSourceError(src["error"])
    if src["kind"] == "llp" and mode != "log1p":
        X = x.reshape(-1, 1)
        fit = np.ones(len(x), bool)
        try:
            out, meta = _llp["fn"](X, fit, mode, ["col"], False, "S9")
        except TypeError:
            out, meta = _llp["fn"](X, fit, mode, ["col"])
        clips = bool((meta or {}).get("clips", CLIPS[mode])) if isinstance(meta, dict) else CLIPS[mode]
        return np.asarray(out, float).ravel(), clips, "llp"
    return REFERENCE[mode](x), CLIPS[mode], "reference"


def _reset_for_tests():
    _llp.update(loaded=False, fn=None, path=None, error=None)
