"""ColumnView: one column across the five samples of a region.

Holds raw values as float arrays (non-numeric cells -> NaN, counted separately),
and applies the sentinel set = known sentinels + values ruled 'sentinel' in S2
adjudication. Every statistic after S2 reads masked() values (canon C7).
"""
import numpy as np
import pandas as pd

SIG_PREFIX = "mS"


class ColumnView:
    def __init__(self, name, frames, settings, ruled_sentinels=(), admin=False):
        self.name = name
        self.admin = admin
        self.settings = settings
        self.samples = list(frames.keys())                  # ['bkg','mS5',...]
        self.sig_samples = [s for s in self.samples if s.startswith(SIG_PREFIX)]
        self.sentinels = sorted(set(float(v) for v in settings["known_sentinels"]) |
                                set(float(v) for v in ruled_sentinels))
        self.present, self.raw, self.nonnumeric, self.nrows = {}, {}, {}, {}
        for s, df in frames.items():
            self.nrows[s] = len(df)
            if name not in df.columns:
                self.present[s] = False
                self.raw[s] = None
                self.nonnumeric[s] = 0
                continue
            col = df[name]
            num = pd.to_numeric(col, errors="coerce")
            self.present[s] = True
            self.nonnumeric[s] = int((num.isna() & col.notna()).sum())
            self.raw[s] = num.to_numpy(dtype=float, na_value=np.nan)
        self._masked = {}

    # ---- masks ------------------------------------------------------------
    def is_sentinel(self, x):
        if not self.sentinels:
            return np.zeros(len(x), bool)
        return np.isin(x, np.asarray(self.sentinels, float))

    def invalid(self, s):
        x = self.raw[s]
        if x is None:
            return None
        return ~np.isfinite(x) | self.is_sentinel(x)

    def masked(self, s):
        if s not in self._masked:
            x = self.raw[s]
            self._masked[s] = None if x is None else x[~self.invalid(s)]
        return self._masked[s]

    def masked_sig(self):
        parts = [self.masked(s) for s in self.sig_samples if self.raw[s] is not None]
        return np.concatenate(parts) if parts else np.array([], float)

    def masked_pooled(self):
        parts = [self.masked(s) for s in self.samples if self.raw[s] is not None]
        return np.concatenate(parts) if parts else np.array([], float)

    def invalid_sig(self):
        parts = [self.invalid(s) for s in self.sig_samples if self.raw[s] is not None]
        return np.concatenate(parts) if parts else np.array([], bool)

    @property
    def all_present(self):
        return all(self.present.values())

    @property
    def any_present(self):
        return any(self.present.values())
