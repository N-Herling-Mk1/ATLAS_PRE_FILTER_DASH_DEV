"""Gate thresholds. Every value here is written into the run manifest, and the
settings hash is part of the cache key, so changing one invalidates old results.

Pure python. No Flask (canon C2).
"""
import hashlib
import json

MASSES = [5, 16, 35, 55]
REGIONS = ["barrel", "endcap"]
ENGINE_VERSION = "pfd-engine mk2"

# exclusion_reason enum (scan layer §13.5)
EXCLUSION_REASONS = ["leakage_target", "leakage_provenance", "admin",
                     "units_suspect", "dead", "superseded"]

DEFAULTS = {
    # ingest -- administrative columns: never scanned as features, kept as slice
    # keys. Applied only to names actually present in the header.
    "admin_columns": ["eventWeight", "runNumber", "eventNumber", "DSID", "mcChannelNumber",
                      "actualInteractionsPerCrossing", "averageInteractionsPerCrossing"],
    "pileup_columns": ["actualInteractionsPerCrossing", "averageInteractionsPerCrossing"],
    # S2 -- sentinels & missingness
    "known_sentinels": [-999.0],          # -1 is NOT here: legal in signed columns
    "s2_clean_max": 0.005,                # invalid <= 0.5%  -> CLEAN
    "s2_maskable_max": 0.50,              # invalid <= 50%   -> MASKABLE, else UNUSABLE
    "s2_candidate_share": 0.01,           # point mass holding >= 1% of a file ...
    "s2_candidate_iqr_dist": 5.0,         # ... and >= 5 IQR from the median of the rest
    # S3 -- dead columns
    "s3_near_constant_share": 0.999,      # top-value share above this -> near-constant
    # S4 -- cardinality (scan layer §4: flag below ~50)
    "s4_low_card_max": 50,
    # S5 -- spikes & zero-inflation
    "s5_spike_share": 0.01,               # any value holding > 1% of entries
    "s5_zi_z": 3.0,                       # van den Broek score z (one-sided) ...
                                          # ... AND observed P(0) above the moment-matched NB P(0)
    # S13 -- leakage
    "s13_value_auc": 0.995,
    "s13_nan_auc": 0.95,
    "s13_provenance_auc": 0.99,           # warning only: a provenance flag, not a discovery
    "s13_mass_mi_bins": 20,               # equal-frequency bins on signal for MI(feature; mass point)
    "s13_mass_mi_perms": 50,              # permutation null draws
    "s13_mass_mi_z": 5.0,                 # flag threshold (note only, never a DROP)
    "known_exclusions": {
        "htmiss_NOSYS": ["leakage_target", "sig MC and bkg data MET spectra differ by sample construction"],
        "met_met_NOSYS": ["leakage_target", "sig MC and bkg data MET spectra differ by sample construction"],
    },
    # S6 -- tails
    "s6_fence_k": 3.0,                    # fence = median +- k * 1.4826 * MAD
    "s6_hill_k_frac": 0.02,               # Hill estimator uses the top 2% of positive values
    "s6_hill_k_min": 25,
    # S7 -- figures
    "s7_bins": 60,
    "s7_int_bin_max": 60,                 # discrete columns with <= this many values: one bin per value
    "s7_range_q": [0.001, 0.999],
    "s7_outlier_points": 300,             # outlier points drawn per side per sample (evenly spaced)
    # S9 -- span audit
    "s9_scalers": ["minmax", "standard", "quantile", "log1p"],
    "s9_pinned": "quantile",              # the training config's scaler: a flag here is FIX
    "s9_bins": 256,
    "s9_realised_min": 0.5,               # flag rule: realised_frac < 0.5, nothing else
    # S14.5 -- cross-block dCor (background only)
    "s145_subsample": 2000,
    "s145_repeats": 5,
    "s145_perms": 20,
}


def settings_hash(settings):
    blob = json.dumps(settings, sort_keys=True, default=str).encode()
    return hashlib.sha256(blob).hexdigest()[:12]


def resolve(overrides=None):
    s = json.loads(json.dumps(DEFAULTS))
    for k, v in (overrides or {}).items():
        if k not in s:
            raise KeyError(f"unknown setting '{k}'")
        s[k] = v
    return s
