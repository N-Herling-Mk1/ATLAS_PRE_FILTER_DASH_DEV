# Row Partition Contract

**Preventing preprocessing leakage in the LLP training path**
Stage A lock-in document · mk1 · 2026-08-20

**Scope: this is a TRAINING-CODE item, not a dashboard item.** It belongs in
`data.py` / `train_llp.py`, alongside the fold bookkeeping. It is listed here
because it was surfaced during the preprocessing dashboard scoping, but the
dashboard's leakage screen covers only the two *pre-checks* (target leakage and
provenance leakage), which run on the dataframe before training. This document
covers the third kind, which is a runtime invariant.

---

## 1. The failure

A scaler is a fitted model. `StandardScaler.fit()` estimates and stores two
numbers per column; `QuantileTransformer.fit()` stores an entire empirical CDF.
Fitting any of them on rows that will later be scored means those rows
contributed to the numbers used to judge them. The cross-validation estimate
comes out optimistic.

The symptom is that there is **no symptom**. The run completes, the AUC is
plausible, folds look healthy, no plot looks wrong. Every fold is contaminated
identically, so no error bar catches it.

### 1.1 The instance in this codebase

`data.py` fit the scaler on `split == "train"` — the correct call, on the
correct-looking subset. The bug lived between two pieces of correct code:

```
split  : 70/15/15 train/val/test, seed 7   ─┐
                                            ├─ built INDEPENDENTLY,
folds  : k=5 CV assignment, seed 7         ─┘   never checked against each other
```

Roughly **69% of every fold's held-out rows had been seen by the scaler.**

Nobody wrote that bug. It emerged from two individually correct partitions whose
relationship was never stated anywhere in the repo.

### 1.2 Measured cost

| | leaky | in-fold | delta |
|---|---|---|---|
| NN1 OOF AUC | 0.8784 | 0.8785 | 1e-4 |
| NN2 OOF AUC | 0.9697 | 0.9697 | 0 |
| best_epochs | [18,19,16,19,7] | [18,19,16,16,7] | fold 4 only |

**On endcap (n = 27,995) the leak was immaterial.** This is the honest calibration
point, not an argument that the problem does not exist — see §5.

---

## 2. Why no library function catches this

sklearn ships `Pipeline` + `cross_val_score`, which fit inside the fold
automatically. If the failure were "someone called `fit_transform` on the whole
frame," that tooling would be the entire answer and this document would not exist.

It is not that failure. Neither `split` nor `folds` misuses any library. Each is
a correct partition, correctly constructed. The defect is in their **interaction**,
and no library knows what relationship you intended between two partitions you
defined yourself.

This is why a convention ("fit after splitting") is insufficient. A convention
enforces *did you write the call correctly*. An invariant enforces *is the
property true* — regardless of how it came to be false: overlapping partitions,
a cached global, a `copy=False` aliasing two scaler objects.

---

## 3. Three layers

### Layer 1 — Declare the relationship at construction

The bug was silence. Remove the option to be silent by making the relationship a
**required argument**.

```python
import numpy as np

VALID_RELATIONS = {"nested", "disjoint", "independent"}

def declare_partitions(name_a, idx_a, name_b_folds, folds, relation, verbose=True):
    """
    Assert and record the relationship between a named index set and a fold
    assignment over the same rows.

    idx_a    : integer index array (e.g. rows where split == "train")
    folds    : integer array of length n, fold id per row
    relation : "nested"      -> no fold's held-out rows may appear in idx_a
               "disjoint"    -> idx_a shares no rows with any fold at all
               "independent" -> overlap permitted; reported, not raised

    Returns a dict suitable for writing into the run manifest.
    """
    if relation not in VALID_RELATIONS:
        raise ValueError(f"relation must be one of {VALID_RELATIONS}")

    set_a = set(np.asarray(idx_a).tolist())
    report = {"relation": relation, "pairs": []}

    for k in np.unique(folds):
        held = set(np.where(folds == k)[0].tolist())
        overlap = set_a & held
        pct = 100.0 * len(overlap) / max(len(held), 1)
        report["pairs"].append({"fold": int(k),
                                "n_held": len(held),
                                "n_overlap": len(overlap),
                                "pct_overlap": round(pct, 2)})

        if relation in ("nested", "disjoint") and overlap:
            raise ValueError(
                f"partition contract violated: fold {k} has {len(overlap)} "
                f"held-out rows ({pct:.1f}%) also present in '{name_a}'. "
                f"Declared relation was '{relation}'."
            )
        if verbose:
            flag = "  [DECLARED INDEPENDENT]" if relation == "independent" else ""
            print(f"  {name_b_folds} fold {k}: {pct:5.1f}% overlap with "
                  f"'{name_a}' (n_held={len(held)}){flag}")

    return report
```

On the endcap data this prints `fold 0: 69.4% overlap` on the **first run** — a
number on screen, in a session where numbers were being watched. That alone kills
the bug.

**Layer 1 detects.**

---

### Layer 2 — Do not build two partitions

Two independent partitions of the same rows make the interaction bug *available*.
Remove the availability by nesting them.

**Before** — two partitions over `range(n)`, relationship implicit:

```python
split = make_split(n, fracs=(0.70, 0.15, 0.15), seed=7)   # over range(n)
folds = make_folds(n, k=5, seed=7)                        # over range(n)  ← collides
```

**After** — folds are defined over a subset, relationship structural:

```python
dev_idx, test_idx = holdout(n, frac=0.15, seed=7)   # test touched once, at the end
folds = kfold(dev_idx, k=5, seed=7)                 # partitions ONLY dev_idx
```

`folds` no longer indexes `range(n)`; it indexes `dev_idx`. A fold **cannot**
contain a test row, because test rows are not in the set folds was built from.
The invariant now holds by construction rather than by check.

**Layer 2 removes.** This is the real fix.

Note the second consequence: with folds nested inside `dev_idx`, the separate
`val` slice of the old 70/15/15 becomes redundant — each fold supplies its own
validation set. Early stopping uses the fold's held-out portion. This simplifies
the split logic rather than complicating it.

---

### Layer 3 — One object owns every row assignment

The general form, for when partitions multiply. A single object is the only thing
in the codebase permitted to say which rows go where.

```python
import numpy as np

class RowPartition:
    """Single source of truth for row assignment. Every .fit() in the pipeline
    draws its rows from here and nowhere else."""

    def __init__(self, n, seed):
        self.n = n
        self.seed = seed
        self._sets = {}          # name -> np.ndarray of indices
        self._contracts = []     # recorded declarations, for the manifest

    def declare(self, name, indices, subset_of=None, disjoint_from=()):
        idx = np.asarray(sorted(set(np.asarray(indices).tolist())))
        if idx.size and (idx.min() < 0 or idx.max() >= self.n):
            raise ValueError(f"'{name}': indices out of range [0, {self.n})")
        if name in self._sets:
            raise ValueError(f"'{name}' already declared")

        if subset_of is not None:
            parent = set(self._sets[subset_of].tolist())
            stray = set(idx.tolist()) - parent
            if stray:
                raise ValueError(
                    f"'{name}' declared subset_of '{subset_of}' but "
                    f"{len(stray)} rows are outside it")

        for other in disjoint_from:
            shared = set(idx.tolist()) & set(self._sets[other].tolist())
            if shared:
                raise ValueError(
                    f"'{name}' declared disjoint from '{other}' but they "
                    f"share {len(shared)} rows")

        self._sets[name] = idx
        self._contracts.append({"name": name, "n": int(idx.size),
                                "subset_of": subset_of,
                                "disjoint_from": list(disjoint_from)})
        return idx

    def get(self, name):
        return self._sets[name]

    def assert_fit_clean(self, fit_indices, score_indices, label=""):
        """Called wherever a fitted object is applied. The load-bearing check."""
        overlap = set(np.asarray(fit_indices).tolist()) & \
                  set(np.asarray(score_indices).tolist())
        if overlap:
            raise ValueError(
                f"LEAK [{label}]: object was fit on {len(overlap)} of the "
                f"{len(score_indices)} rows it is now scoring")

    def manifest(self):
        return {"n": self.n, "seed": self.seed, "contracts": self._contracts}
```

Usage:

```python
rp = RowPartition(n=27995, seed=7)
rp.declare("test", test_idx)
rp.declare("dev",  dev_idx, disjoint_from=["test"])
for k in range(5):
    rp.declare(f"fold{k}_held", fold_held[k], subset_of="dev")
    rp.declare(f"fold{k}_train", fold_train[k],
               subset_of="dev", disjoint_from=[f"fold{k}_held"])
```

There is no second source of truth to disagree with, so there is nothing for two
partitions to disagree about.

**Structural precedent:** this is the same move as the **D11 metric contract**.
Fields could not be tagged inconsistently across bundles because
`compare_bundles()` enforced the tags centrally, rather than each model declaring
its own and hoping they matched. Centralize the thing that must be consistent, so
consistency stops being a per-site discipline.

---

## 4. Supporting checks

Beyond the partition contract, four cheap invariants on the fitted objects
themselves:

| # | check | catches |
|---|---|---|
| 1 | `fit_indices ∩ score_indices == ∅` at every application | the semantics, whatever the cause |
| 2 | k folds ⇒ **k distinct** scaler objects | a shared object |
| 3 | fold scalers' stored parameters are **not bit-identical** | aliasing (`copy=False`, mutable default) |
| 4 | manifest records class, `fit_indices` hash, `n_fit`, param hash | after-the-fact audit without rerunning |

Check 1 catches semantics; 2 and 3 catch plumbing; 4 makes the claim provable
six months later — same reasoning as the dataset hash in the session bundle.

---

## 5. Everything with a `.fit()`

`fit()` learns numbers from data; `transform()` applies them. The rule is
therefore uniform: **anything with a `.fit()` goes inside the fold.**

| object | what it estimates | severity | in use here |
|---|---|---|---|
| `SelectKBest` / any feature selection | which columns survive | **catastrophic** | live (AUC/KS ranking) |
| `SMOTE` / resampling | neighbour structure | severe | no |
| `QuantileTransformer` | full empirical CDF | moderate | **live — pinned config** |
| `KBinsDiscretizer` | bin edges | moderate | tokenization thread |
| `SimpleImputer` | median / mean fill | mild–moderate | not yet |
| `StandardScaler` / minmax | 2 numbers per column | mild | live |
| class weights (`balanced`) | class frequencies | negligible | live |

**Feature selection is the one to fear.** Rank all 26 endcap features on the full
sample, keep the top 10, then cross-validate the survivors — every held-out row
voted on the feature set. The result is large, confident and wrong, and it feels
innocent because "I only looked at the features." If ranking ever drives
*selection* rather than *inspection*, the selection moves inside the fold, and
the honest number is the mean across folds of select-then-train, each fold
choosing its own columns.

---

## 6. Severity scales with held-out fraction, not parameter count

The leak size is how much the fitted estimate moves when the held-out rows are
added:

| region | n | held out per fold | expected impact |
|---|---|---|---|
| endcap | 27,995 | 5,599 | **measured 1e-4 — immaterial** |
| barrel (focused) | 1,125 | 225 | ~5× larger |
| barrel mass slice | ~130 | 26 | large |

**Barrel is where this pays.** It is already the region where a real effect
cannot be separated from wide error bars — 100% within 2σ at 2,280 events versus
39% at 24,850 is the same-size error with different error bars. Undetected
optimism there is the worst possible place for it.

**Trigger: get this in before the barrel mu sweep goes from n=1 per cell to
anything quotable.**

---

## 7. Build order

| layer | cost | what it buys |
|---|---|---|
| **2 — nest the partitions** | contained refactor of `data.py` split logic | removes the bug class |
| **1 — declare relation** | ~30 lines | catches every future partition on first run |
| 4 — supporting checks | ~20 lines | plumbing failures + auditability |
| 3 — `RowPartition` owner | ~100 lines | general case; only if partitions ≥ 3 |

**Do 2 first** — it removes rather than detects. **Do 1 alongside**, because
partitions will be added: a held-out-mass runner, an A-invariance split, a
per-run-period slice. Each new one reintroduces the interaction; layer 1 makes
each addition declare itself. **Layer 3 only when partitions multiply.**

---

## 8. Why an invariant rather than a convention

Two arguments, both from this project's own record.

**Intuition about materiality is unreliable.** The leak was predicted to matter.
It did not — 1e-4. Establishing that consumed a session. The assertion costs
microseconds; the argument cost hours.

**Flags drift from behaviour.** `scale_in_fold=1` is a flag. Flags get overridden
by a legacy path, a config file, or a stale copy — and there is a documented
recurring hazard of repo files silently reverting to older delta versions (four
reverts in one session: `train_mk4.py` and `sweep.py`, twice each). A reverted
flag reports an optimistic number **quietly**. A reverted assertion kills the run
**loudly**. That asymmetry is the argument.

**Precedent for untested-path bugs:** the mk1 `train_llp` defect — each fold
training a separate trunk, so stacking OOF φ rows mixed incompatible 128-dim
coordinate systems — lived in a path the selftest never invoked. The code looked
correct and the board would have been meaningless. Same shape.

---

## 9. The generalizable principle

The bug was in neither piece of code. It was in the **absence of a place where
their relationship was written down.** Two facts were each individually true and
jointly wrong, and no artifact in the repo made the joint claim checkable.

The fix is not a better check on either piece — it is creating the artifact that
holds the joint claim. Nesting makes the claim structural; declaration makes it
explicit.

**This is a bug class, not a bug.** It recurs wherever two derived facts have an
unstated relationship. Candidates already in this project with that shape: FORGE
bundle tags across models, the mk4 trunk's per-fold coordinate bases, and the
factorial cell definitions across parallel seed runs.

---

## 10. Revision log

| date | change |
|---|---|
| 2026-08-20 | mk1 created. Scope note added: this is a training-code item, not a dashboard scan — the dashboard's leakage screen covers only target and provenance leakage, which are true pre-checks. |
