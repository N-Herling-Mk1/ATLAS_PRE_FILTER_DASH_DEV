# Preprocessing Scan Layer — Consolidated Reference

**Task [5] of the preprocessing dashboard · complete scan specification**
Stage A lock-in document · mk1 · 2026-08-20

This is the consolidated reference for the data-analysis component. It supersedes
the scattered discussion and is the drift-protection artifact: if an
implementation disagrees with this document, the implementation is wrong or this
document gets revised with a dated note in §12.

**Companion documents:**
- `model_selection_criteria_mk1.md` — AIC/BIC/AICc, cited and vetted (task [5e])
- `row_partition_contract_mk1.md` — preprocessing leakage, a TRAINING-CODE item
- `stability_slicing_tokenization_mk1.md` — the slice concept under discretization

---

## 0. What this layer is for

The scan answers one question per column: **does this feature mean what we think
it means, and will the model be able to use it?**

Two failure classes it exists to separate, because downstream they look identical
(near-zero permutation importance) and have **opposite fixes**:

| symptom | cause | fix |
|---|---|---|
| feature contributes nothing | no information present | drop it |
| feature contributes nothing | transform destroyed the resolution | re-transform it |

Without the scan you delete a good feature or keep training against a dead one.

### 0.1 Scan inventory

| # | scan | reads | output | §  |
|---|---|---|---|---|
| S1 | Column typing | raw values | type + family menu gate | §1 |
| S2 | Missingness & sentinels | raw values | per-column flags | §2 |
| S3 | Constant / dead columns | raw values | drop candidates | §3 |
| S4 | Cardinality & quantization | raw values | dequantization candidates | §4 |
| S5 | Spikes & zero-inflation | raw values | spike table + tie fraction | §5 |
| S6 | Descriptive stats & tails | raw values | stats table | §6 |
| S7 | Histograms & box plots | raw values | figures | §7 |
| S8 | Outlier detection | raw values | per-event flags | §8 |
| S9 | Dynamic range / span audit | **transformed** values | score per (column × scaler) | §9 |
| S10 | Multimodality | raw values | screening flags | §10 |
| S11 | Distribution fitting | raw values | Akaike weight vector | §11 → companion doc |
| S12 | Separation power | raw + label | per-feature ranking | §12 |
| S13 | Leakage screen | raw + label + provenance | exclusion candidates | §13 |
| S14 | Correlation structure | raw values | matrices + split design score | §14 |
| S15 | Stability slices | raw values + slice keys | long table sorted by z | §15 |

---

## 1. S1 — Column typing (runs FIRST, gates everything else)

Type is determined before any family menu, transform, or statistic is selected.
Nothing downstream may override it.

| type | test | family menu | notes |
|---|---|---|---|
| continuous ℝ | float, cardinality high, negatives present | gauss, student-t, skew-normal, logistic | |
| continuous ℝ⁺ | float, cardinality high, all ≥ 0 | gamma, lognormal, weibull, exponential, inv-gauss, half-normal | |
| count | integer-valued, ≥ 0 | poisson, nbinom, ZIP, ZINB, hurdle | **never a continuous family** |
| bounded [0,1] | float within [0,1] | beta, kumaraswamy, boundary-inflated | |
| binary / flag | cardinality 2 | bernoulli | |
| categorical | low cardinality, unordered | — | no fit |

**Hard rule:** a continuous family must never appear in a discrete column's
ranking table. `nMDT`, `nBOL`, `nRPC` are the columns most tempting to fit with a
gamma, and they are exactly the columns whose quantization propagated through
NN1b to produce the output banding behind the barrel ABCD closure failure.
Fitting a smooth density to them papers over the pathology the scan exists to find.

Type decision is written into the run manifest.

---

## 2. S2 — Missingness and sentinels

Report **per column**, never aggregate:

- NaN count and fraction
- Sentinel values: `-999`, `-1`, `0` used as "absent", any value with anomalous
  exact-duplicate mass at a suspicious location
- **Column absent entirely** — distinct from all-NaN

**Precedent:** four of six preselection cuts reported MISSING on the first real
endcap run (`MS1Vtx_endcap_hits_nTGC`, `nMSeg_EO`, `pass_muonRoItrigger`,
`pass_trigger_match`); the two that applied both passed 100%, giving combined
presel 27,995/27,995. Absent columns are a real, recurring condition here.

A sentinel spike is a **data bug**; a structural zero is **physics**. Classify,
don't merge (see §5).

---

## 3. S3 — Constant and dead columns

Three distinguishable states, three different actions:

| state | test | action |
|---|---|---|
| identically constant | `nunique == 1` | drop; flag registry |
| constant after cuts | `nunique == 1` post-preselection | investigate cut, not column |
| absent | column not in file | registry error |

**Precedent:** `MS1Vtx_l1hcal` is identically zero across all 3,506 barrel
events — registry error vs genuinely absent is **unresolved**. The scan makes
this a standing flagged item rather than something someone noticed once.

**Do not confuse with S9.** A dead column has no information. A compressed column
has information the transform hid. Same downstream symptom, opposite fix.

---

## 4. S4 — Cardinality and quantization

Flag cardinality < ~50 as a **dequantization candidate**.

This is the pathology with the longest evidence chain in this project: integer
inputs (`nMDT`/`nBOL`/`nRPC`) → NN1b output quantization → banding in the ABCD
plane → barrel closure failure (ratio 1.79 vs endcap 0.83 with no banding).

Candidate treatments, increasing aggressiveness:

1. **log1p** — counts are Poisson-ish; compresses the tail, turns multiplicative
   spread additive
2. **Rank / quantile transform** — erases banding by spreading repeated integer
   values across their rank range
3. **Input jitter** — small Gaussian noise (σ ≪ 1) at training time only; keeps
   the raw count's physical meaning, breaks the determinism producing the bands

**Note the tension with S1:** dequantizing for the *network* is an engineering
choice; the *fit* (§11) must still use discrete families on the raw column.
These are different consumers of the same column.

---

## 5. S5 — Spikes and zero-inflation

### 5.1 Detection

For each column, find values with anomalous exact-duplicate mass:

```
p_v = count(x == v) / n        flag any v with p_v > 0.01
```

Zero is common but not the only one. Expect spikes at `-1`/`-999` (sentinels),
at `1.0` (saturating ratios), and at physical cut boundaries.

### 5.2 Classification — the fix differs by kind

| kind | meaning | treatment |
|---|---|---|
| **structural** | detector had nothing to count; a true "absent" | model it — belongs in the physics |
| **sampling** | a Poisson process that yielded zero | absorbed by the count family |
| **sentinel** | missing data wearing a number's costume | data bug — see §2 |

### 5.3 Testing

Fit the unmixed family, compare predicted `P(X=0)` against observed.

**⚠ ZIP-vs-Poisson is boundary-nested.** The null sits on the parameter-space
boundary, so the LRT null distribution is a **50:50 mixture of χ²₀ and χ²₁**, not
χ²₁. Using plain χ²₁ over-rejects — it finds zero-inflation that is not there.
Van den Broek's (1995) score test avoids the issue and is the recommended default.

### 5.4 Modelling

Two-part: `Bernoulli(π) × F_body(x | x > 0)`. This is already the structure in
`fit_marginals` (per-feature 1-D MaxEnt with zero-inflation spikes). The scanner's
job is to **find** the spikes rather than have them declared per column.

### 5.5 The interaction that matters right now

**A spike hitting a rank transform becomes a mass of TIES.** `QuantileTransformer`
averages tied ranks, so a 40% zero spike collapses 40% of events to one output
value, and ordering *within* the spike is arbitrary.

The pinned config is **quantile + balanced + scale_in_fold=1**, so this is live.

**Report tie fraction per column.** It is a hard upper bound on what any rank
transform can resolve. A heavily-tied column should probably enter the network as
an explicit **indicator + body pair** rather than a single number.

---

## 6. S6 — Descriptive statistics and tails

Per column: n, n_valid, mean, sd, min, q0.5, q1, q5, q25, median, q75, q95, q99,
q99.5, max, IQR.

Tail diagnostics — heavy tails are *why* minmax killed five NN1 columns:

- skewness, excess kurtosis
- tail mass share: fraction of total magnitude carried by the top 1% of events
- Hill estimator / tail index where a power law is plausible

---

## 7. S7 — Histograms and box plots

Per column, signal/background overlaid:

- **Histogram on BOTH log and linear y.** Log alone hides a collapsed spike;
  linear alone hides the tails **where the A quadrant lives.** Precedent: the
  mk1.4 predicted-probability figure was expanded to a 2×2 (NN1/NN2 × log/linear)
  for exactly this reason.
- Box plot with outlier points shown, not suppressed
- Overlay the working point (q50 or the operating cut) on each panel

**Naming discipline:** the mk1.3 output was named `scores_<region>_<rung>.png`,
which collided with `scores_*.npz` and read as invisible. Figure names must not
collide with data artifacts.

---

## 8. S8 — Outlier detection (per-event)

Distinct from S9. This flags individual **events** on the **raw** column for
physics reasons: is this event real, or a reconstruction failure?

Methods: IQR fence (Tukey), modified z-score (MAD-based, robust), quantile
thresholds. Multivariate: Mahalanobis distance, with the caveat that it assumes
elliptical structure that heavy-tailed detector data violates.

**Units-plausibility check belongs here.** A declared expected range per feature
in the catalogue turns "someone notices" into an automatic red flag.

**Precedent:** `MS1Vtx_mindR_jetcut > 0.8` uses the Apr-2026 units-anomaly
variable — values ~1e5 where a dimensionless ΔR is expected.
`MS1Vtx_sumTrackPt0p2Cone < 5` is GeV-vs-MeV fragile. Per-cut pass rates are
printed and flagged above 99.9% / below 1%.

---

## 9. S9 — Dynamic range / span audit

**The only scan that reads TRANSFORMED values.** It diagnoses the *scaler*, not
the feature.

### 9.1 What it detects

A feature **alive in the data but dead to the optimizer.** Weight init, learning
rates, and gradient magnitudes all assume inputs of order 1. A transform that
maps 99% of events into a numeric interval of width 1e-5 makes that column's
contribution smaller than the rounding noise of its neighbours, and its gradient
is starved in proportion.

This is a property of the **column–transform pair**, not the column. Minmax's
denominator is set by the two most extreme events in the sample, so a handful of
outliers crush the bulk.

### 9.2 Evidence chain (mechanism confirmed, not inferred)

- `nMSeg_ratio_EIEM` central span **1.167e-05** under minmax — 99% of events
  inside a thousandth of a percent of the range
- **Five** NN1 columns compressed, not one: 1.167e-05, 1.071e-01, col_5 1.395e-01,
  col_3 1.656e-01, col_4 1.689e-01
- Fold 2 collapsed: `best_epoch=1`, val loss diverging 0.75 → 1.36 while AUC sat
  flat at ~0.834 — calibration blown, discrimination fine, early stopping
  selecting a barely-trained net
- **The collapse appeared in both minmax runs and neither quantile run**; the
  COMPRESSED warning fired in exactly the failing runs
- Quantile moved NN1 0.8310 → **0.8785**, above its ~0.86 reference for the first
  time
- In-fold refactor ruled out leakage (.8785 vs .8784, matching to 1e-4) —
  the gain is the rank transform **equalising density**, and it survives per-fold
  fitting

A millisecond numeric read predicted a **+0.048 AUC swing and a fold pathology.**

### 9.3 Known defects in the current metric — must be fixed on port

Current statistic: central span `(q99.5 − q0.5)/(max − min)`.

1. **Quantile's ~0.99 span is TAUTOLOGICAL** — a rank transform maps to uniform
   by construction. The audit as built proves minmax is bad and is **zero
   evidence that quantile is good.**
2. **Spans are not comparable across scalers.** `data.py`'s minmax branch clips
   (`np.clip(X,0,1)`) so the denominator is pinned to 1.0; standard does not, so
   its denominator includes the untrimmed tail. This is the 140× anomaly
   (1.167e-05 vs 1.634e-03 on the same column). `apply_scale` now records a
   `clips` flag. **Comparable within a mode, never across.**

### 9.4 Replacement metric

Bin the transformed column into **256 equal-width bins over the transform's
nominal output range** — a *fixed* grid — and compute Shannon entropy in bits.

- Max 8 bits (perfectly spread); dead column near 0
- The grid does not move with the data, so quantile cannot win by construction
  and clipping cannot distort the denominator
- Comparable across minmax / standard / quantile / log1p on one axis

Report alongside:
- **effective resolution** — distinct float values ÷ n after transform
- **tie fraction** (from §5.5)
- **clips flag**

**Flag rule:** entropy < 2 bits, OR central span < 1e-2, OR effective resolution
< 0.01. `nMSeg_ratio_EIEM` at 1.167e-05 trips all three.

### 9.5 Output

One table: raw and every candidate scaler, side by side, per column. That table
**is** the transform recommendation, and it is auditable — replacing "we use
quantile because a conversation said so" with a measurement in the session archive.

Note: `X1`/`X2` in the npz are **RAW** when `scale_in_fold=1`; the npz carries
`scaled_columns` and `scale_mode` flags. Relabel accordingly. Feature names fell
back to `col_N` in `vet_compare` because the registry import did not resolve —
fix on port.

---

## 10. S10 — Multimodality

Methods: Hartigan dip test; GMM with k = 1…5, compared by ΔBIC; kernel density
with mode counting.

**⚠ BIC's derivation does not hold for GMM component selection.** The Fisher
information is **singular** where a component vanishes or two coincide, and the
Laplace approximation underlying BIC assumes a non-singular Hessian at the mode.
This is the single most common use of BIC in practice and it is unjustified.

**Decision: treat GMM ΔBIC as a SCREENING statistic** that nominates columns for
inspection, not as a decision rule. (Alternatives considered: use it anyway with
the caveat stated; use WBIC / singular learning theory. Screening is the
recommendation.)

Also report the **mixture-vs-unimodal ΔBIC and the dip test together** — a
mixture will always beat a unimodal family on likelihood, so the honest output is
the comparison, never a winner.

---

## 11. S11 — Distribution fitting

**Full treatment in `model_selection_criteria_mk1.md`.** Summary of decisions:

- Family menu gated by S1 column type
- MLE per family; report an **Akaike weight vector** over the menu, never a winner
- Primary AIC (M-open — detector variables are not gamma); BIC reported alongside;
  **AICc auto-applied where n/k < 40**, which is reachable for mixtures on barrel
  mass slices (k=11, n≈130 → correction ≈ 2.0, a full Kass–Raftery band)
- Adequacy as statistic **magnitude**, not p-values: KS/AD/CvM as distances, W₁ in
  the column's own units, PIT histogram + PIT-KS, Q–Q with tails called out
- **The metric that actually decides it:** propagate each candidate family through
  `estimate_N_A` and read the corner. Two families at identical BIC can give
  materially different region-A predictions, because AIC/BIC are dominated by the
  bulk while ABCD closure lives in the sparse high-high corner.
  **Report the spread in N_A across the candidate set as a systematic.**

**Framing:** each candidate family *is* the MaxEnt distribution under a specific
moment-constraint set, so choosing a family = declaring which sufficient
statistics are preserved. The fit report names the constraints, not only the family.

**Three ways to compute these wrong** (full detail in the companion doc):
same data exactly; Jacobian on transformed fits; never mix densities and PMFs.

---

## 12. S12 — Signal/background separation power

Per feature, three levels:

**Level 1 — per-feature overlap:** KS statistic, single-feature AUC, mutual
information, Bhattacharyya coefficient, Jensen–Shannon divergence, Wasserstein-1,
Fisher discriminant ratio.

**Level 2 — multivariate event-vector similarity:** Mahalanobis distance, MMD,
PCA/UMAP visualisation.

**Level 3 — cross-feature correlation structure:** see §14.

**Reference AUCs for orientation:** NN1 barrel ~0.80, NN2 barrel ~0.94,
NN1 endcap ~0.86, NN2 endcap ~0.945.

**Any single-feature AUC ≥ 0.99 is a provenance flag, not a discovery** — see §13.

---

## 13. S13 — Leakage screen

Three distinct kinds. **Only the first two are dashboard pre-checks**; the third
is a training-code invariant covered in `row_partition_contract_mk1.md`.

### 13.1 Target leakage (pre-check)

The feature is a function of the label or of how the sample was assembled.

**Standing example:** `htmiss_NOSYS` / `met_met_NOSYS` — signal MC and background
data-VR have different MET spectra **by construction of the samples**, not by
physics. Already excluded for cause.

**Detector:** single-feature AUC ≥ 0.99.

### 13.2 Provenance leakage (pre-check)

Any column identifying which file a row came from: run number, DSID,
`eventWeight`, the per-event mass tag `bundle.mass_*`.

`eventWeight` is already dropped as admin — this category.

**Detector:** mutual information between each feature and the mass tag. A feature
that tells you *which mass point* an event came from is leaking the signal grid
and will evaporate on held-out mass.

### 13.3 Preprocessing leakage (NOT a pre-check — training-code invariant)

Scaler / imputer / binner / feature-selector fit outside the fold. See the
companion document. Summary: the real defect was that `split` and the k=5 `folds`
were **independent partitions never checked against each other** — ~69% of every
fold's held-out rows had been seen by the scaler. Measured impact on endcap: 1e-4.
**Matters on barrel (n=1,125), not endcap.**

### 13.4 Screening method

Train a throwaway gradient-boosted stub on all columns; read permutation
importance. Any single column carrying most of the separation is a **suspect, not
a win.** Then per-column ablation: drop it, retrain the stub, measure AUC delta.

### 13.5 Make exclusions data, not memory

Catalogue field:

```
exclusion_reason ∈ {leakage_target, leakage_provenance, admin,
                    units_suspect, dead, superseded}
```

plus free-text note and date. The reason `htmiss` is excluded currently lives in
conversation logs — that is the fragile part.

---

## 14. S14 — Correlation structure

### 14.1 Three coefficients, because they disagree usefully

| coefficient | detects |
|---|---|
| Pearson `r` | linear dependence |
| Spearman `ρ` | monotone dependence |
| **distance correlation `dCor`** | general dependence (machinery already exists from DisCo) |

**The informative cell is high dCor with r ≈ 0** — nonlinear dependence invisible
to a correlation matrix, untouched by any affine scaler, and it breaks the
factorization the ABCD baseline assumes.

### 14.2 Σ_S − Σ_B

Difference of the class-conditional covariance (and dCor) matrices. **Signal and
background can have identical marginals and different dependence structure**, and
a per-feature scan is blind to all of it. Render as a heatmap; the
largest-magnitude cells are multivariate discriminating information not currently
in use.

### 14.3 Redundancy

- Hierarchical clustering on distance `1 − |ρ|`, cut at ~0.1; one representative
  per cluster
- Condition number of the design matrix; per-column VIF
- Pairwise `|r| ≥ 0.98` duplicate detection — **verify NN1/NN2 have no overlap
  rather than trusting the registry's claim** (barrel NN1=20/NN2=10 union 30;
  endcap NN1=16/NN2=10 union 26; no overlap by construction)

### 14.4 Partial correlation / precision matrix

Separates direct dependence from dependence mediated by a third feature. Two
chamber-count columns correlating because both track pileup is a different fix
from two columns correlating directly.

### 14.5 **The highest-value item in this entire document**

**Cross-block dCor between a candidate NN1 feature set and a candidate NN2
feature set, computed BEFORE training anything.**

Evidence that feature *splitting* is load-bearing independent of DisCo:
`B_disjoint_ext` started at dCor **.046 pre-penalty** while the all-features
design needed λ=5 to reach **.098**. And vanilla endcap dCor is **0.3018**,
nowhere near the .05 gate — so the "our cross-correlation was low anyway"
intuition is **wrong** for this feature design.

A pre-training cross-block dCor is therefore a **design score for a proposed
split**, computable in seconds, predicting how much work λ will have to do. It
converts split selection from a training-run-per-candidate search into a table
lookup.

**If the dashboard does nothing else, it should do this.**

---

## 15. S15 — Stability slices

The question: **does this feature mean the same thing everywhere in the data?**
Pooled scans answer "is it useful." Slicing answers "is it useful for the reason
you think."

### 15.1 The four axes are not the same kind of thing

| axis | a difference means | action |
|---|---|---|
| **mass point** | feature is learning the signal grid | design problem — expect held-out-mass failure |
| **region** (barrel/endcap) | registry entry is wrong for one region | data problem — split or drop the entry |
| **CV fold** | small-sample noise | measurement — feeds RRM directly |
| **run period / pileup** | background is non-stationary | **assumption violation — a reported number is wrong** |

The last is categorically worse. The first three say a model will underperform.
The fourth says a number already reported is invalid.

### 15.2 Mass point

Slice signal by generated mass. Endcap counts: mS5 532 / mS16 1051 / mS35 1047 /
mS55 515.

Statistic: per-feature AUC **within each mass slice against the common
background**, plus PSI between mass slices' signal distributions.

**Sensitivity arithmetic:** at 515 signal events, the standard error on an AUC
near 0.85 is roughly **0.018**. A spread of 0.02 across mass points is noise; 0.10
is real; between needs the error bar or it is uninterpretable. **Print n and the
AUC standard error in the same cell.**

**Why this is cheap insurance:** the A-invariance and held-out-mass runners are
specced but not wired to a board script, and those runs cost a full retrain per
held-out mass. This scan costs seconds and says which features to expect trouble
from. Pre-screen, not substitute.

**Subtle failure mode — mass leakage can be DISTRIBUTED.** Every feature slightly
mass-dependent, none individually flagged, and the network assembles the grid
from the combination. So also train a throwaway **4-class classifier
`mass_point ~ features` on signal only.** Meaningfully above 25% accuracy means
mass is recoverable from the feature vector, and no per-feature scan would have
said so.

### 15.3 Region

Testing the **registry**, not the model. Three distinct failures:

1. **Same name, different physics** — legitimate, but the registry should say so
2. **Same name, different units** — precedent: `MS1Vtx_mindR_jetcut` at ~1e5
3. **Present-but-dead in one region** — `MS1Vtx_l1hcal`, identically zero across
   3,506 barrel events

**⚠ The statistical trap, stated plainly.** Barrel has 3,506 events against
endcap's 27,995. PSI, KS and W₁ all have sampling distributions that widen as n
falls — so **barrel will look more stable than endcap even when it is less
stable.**

This is the identical trap as the λ sweep: barrel λ=10 **passed** at |nc|med .081
/ 97% within 2σ while endcap λ=5 **failed** at |nc|med .048 / 61% — a *smaller*
error passing because 2,280 background events make σ wide and 24,850 make it
tight. **A barrel PASS is weaker evidence than an endcap FAIL.**

**Rule: never report a stability statistic without its slice n.** Where possible,
bootstrap the slice, compute the statistic between two random halves of the
*same* slice, and quote the observed value as a multiple of that null spread.
That is the only version comparable across regions.

### 15.4 CV fold

Not a physics difference — folds are random. This measures **how much the answer
depends on which 80% was trained on.**

**Direct payoff:** this quantity *is* `σ_fold/σ_max`, the second component of the
RRM penalty vector `v = [1−A, σ_fold/σ_max, U/U_max]`. The scanner computes it as
a byproduct, so the dashboard emits RRM inputs directly rather than requiring
hand-assembly across runs. Since RRM is an original and still-experimental
construction, having its inputs produced by an auditable versioned scan is worth
something when presenting it.

**Report per-fold AUC and per-fold loss SEPARATELY.** Flat AUC with a diverging
loss is the signature of the fold-2 pathology (best_epoch=1, val 0.75 → 1.36,
AUC flat ~0.834), and a single pooled number hides it. This table is also the
instrument for the still-open question: **checkpoint selection on val loss or val
AUC?**

### 15.5 Run period / pileup — background only

**Not a model-quality check. An assumption test.**

ABCD assumes the background's joint feature distribution is stable across the
pooled sample. If the data24VR CSVs span periods with different pileup and the
distributions drift, **the closure measured on the pooled sample is not the
closure a period-resolved sample would give.** The number is wrong, not merely
imprecise.

Slice on **background only** — signal MC has no run period.

Statistics: PSI per feature between periods, and more importantly the
**cross-block dCor between NN1-features and NN2-features computed per period.**

**Why the dependence version is the one that matters:** at λ=2, dCor was
essentially unchanged between μ=0 and μ=1 (.0621 → .0640, slightly **up**) while
|nc|med dropped **7×**. Global dependence and corner closure are different
properties. A marginals-only period check can pass while the corner drifts.

**Strongest version:** re-run the ABCD closure estimate per period and compare
against the pooled number. Scatter beyond the error bars means the pooled closure
averages over inhomogeneous samples and the systematic must reflect that.

**First step, cheap:** check whether run-period or pileup columns survive into the
0_Sig_BG CSVs at all. If they do not, this axis is unavailable — which is itself
a documentable limitation, since an assumption central to the background estimate
would then be untestable.

### 15.6 Additional axes worth adding

- **Signal-vs-background asymmetry within a slice.** A feature can be stable
  across periods for both classes and still lose discriminating power in one, if
  both shifted together.
- **Preselection stage.** Currently a null slice (combined presel 27,995/27,995),
  but when those cuts apply, before/after is where the ABCD plane assumptions get
  established.
- **Score quadrant (A/B/C/D).** Slice background by ABCD region and ask whether
  feature distributions differ beyond what the score's own definition forces.
  **Closest to directly testing the factorization assumption** — the only slice
  defined in terms of the thing actually being estimated.

### 15.7 Choosing the statistics

| statistic | strength | caveat |
|---|---|---|
| **W₁ (Wasserstein-1)** | **lead with this** — in the feature's own units, actionable ("median shifted 0.03 GeV") | needs an ordering on the space |
| KS distance | binning-free | sensitive at the centre, weak in the tails — **and the tails are where the A quadrant lives**. Report magnitude, not p-value |
| PSI | familiar bands (<0.1 / 0.1–0.25 / >0.25) | **those thresholds are credit-scoring folklore, not derived**, and PSI is bin-count dependent. Pin the binning (10 quantile bins from the reference slice) and treat the bands as declared conventions |

Use all three; they disagree usefully. KS catches a location shift with equal
spread; PSI catches a shape change with equal location; W₁ measures magnitude in
physical units.

### 15.8 Output shape

One long table, not a per-axis report:

```
feature | axis | slice_a | slice_b | n_a | n_b | W1 | KS | PSI | null_sd | z
```

`null_sd` from bootstrapping within-slice halves; `z` = observed ÷ null_sd.

**Sort by `z`, not by the raw statistic.** That is what makes barrel and endcap
rows comparable in the same table, and it is the fix for the wide-error-bars trap
that has now bitten this analysis twice.

---

## 16. Cross-cutting requirements

### 16.1 Every scan output is reproducible

Session bundle carries: dataset hash, config, code commit, timestamp, identity
tag, plus per-fitted-object `fit_indices` hash. **Without the dataset hash you
cannot tell whether two runs disagreed because the config changed or the CSVs
did** — and repo files under OneDrive have silently reverted to older delta
versions before (four in one session; `train_mk4.py` and `sweep.py` twice each).
Verify with `Select-String` on a marker string, never by size or timestamp.

### 16.2 Progress alerting

Every scan reports progress — bars and status prints. Long scans (S11 fit sweeps,
S14 dCor matrices, S15 bootstrap nulls) run through the job queue with status
polling, not on request threads. Training is CPU-bound here: fold times went 27 s
solo → 110 s with three terminals, ~1.2× throughput, not 3×.

### 16.3 The feature catalogue is the scan's index

**Four registries currently disagree and nothing reconciles them:**
`nn_features_mk3_v3.py` (live), `llp_features.json` v0.2.0 (57 features,
13 categories, sourced, March), the `kj_Jul_26_NN1/NN2.csv` pair, and the
`legacy_NN1/NN2` lists.

**The catalogue's first job is to DIFF those four and show where they conflict.**
That alone justifies the build.

Catalogue fields the scans depend on: expected range (§8), `exclusion_reason`
(§13.5), column type (§1), region applicability (§15.3).

### 16.4 Open decision

**O5 — is the catalogue authoritative (the pipeline imports from it) or
descriptive (it mirrors `nn_features_mk3_v3.py`)?** Authoritative is better and
is a bigger commitment. Unanswered.

---

## 17. Build order

| priority | scans | rationale |
|---|---|---|
| **1** | S1, S2, S3, S4, S5 | typing and pathology detection gate everything else |
| **2** | S9 | highest measured payoff (+0.048 AUC precedent); makes the transform choice auditable |
| **3** | **S14.5 cross-block dCor** | converts split selection from a compute search to a table lookup |
| 4 | S6, S7, S8, S12 | the descriptive/figure layer |
| 5 | S13.1, S13.2 | leakage pre-checks; make exclusions data |
| 6 | S15 | stability slices; needs slice keys to exist |
| 7 | S10, S11 | fitting; heaviest compute, most caveats |

---

## 18. Revision log

| date | change |
|---|---|
| 2026-08-20 | mk1 created — consolidates the full task [5] discussion. Corrections carried in: span metric replaced with fixed-grid entropy (§9.4) because the central-span ratio is tautological under rank transforms and non-comparable across clipping modes; GMM ΔBIC demoted to screening (§10); preprocessing leakage moved OUT of the dashboard scan layer to a training-code invariant (§13.3). |
