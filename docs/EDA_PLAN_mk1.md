# EDA plan — ATLAS prefilter design matrix (mk1)

**Repo:** ATLAS_PRE_FILTER_DASH · **Sheet:** hub → EDA Dashboard (`sections/eda.html`)
**Date:** 2026-09-24 · **Source:** the notebook list (transcribed 2026-09-22) and the
EDA_plan deck (mk1–mk9, 2026-09-23), which settled the two-pass structure below.

This is the standalone plan. It supersedes the mk45 draft `EDA_SCOPE_mk1.md`, which
was never applied. Where this document and the sheet disagree, the sheet is wrong
or this document gets a dated entry in §7.

The question underneath all of it:

> **Does this feature mean the same thing everywhere in the data?**

---

## 1. Structure — two passes, order is load-bearing

| pass | name | what it is | where the rule comes from |
|---|---|---|---|
| 1 | **Reject by content** (data cleaning) | what is in a column that is not data | rules we declare in advance |
| 2 | **Analyse features** | what the columns carry, alone and together | what the data shows us |

Pass 1 comes first because a spike or a sentinel left in the data corrupts every
statistic in pass 2, and correlations most of all.

Rejected as a third pass (2026-09-23):
- **Model / family selection.** This is MaxEnt work. It lives on the Max Entropy
  sheet (§5).
- **"Good vs bad data" pattern detection** (multivariate outliers, impossible
  combinations, duplicates, period fingerprints). It was cut as unclear. It is
  parked, not planned.

---

## 2. Pass 1 — reject by content

| check | rule | what it gets us |
|---|---|---|
| Sentinels & missingness | `NaN`, `−999`, `−1`. Padding and column-absent are different failures; only one is imputable. `−1` is legal in signed columns, so it is not a default sentinel. | arithmetic you can trust |
| Dead columns | constant, and **constant after cuts** — the dangerous one, because it looks alive upstream | no wasted training slot |
| Spikes & zero-inflation | `p_v = count(X == v) / n`; flag any `v` with `p_v > 0.01`. A spike is a second mechanism sharing the column, not an outlier. | correlations that are not artefacts of a repeated value |
| Cardinality | flag cardinality < 50. It decides whether a column is a density or a PMF downstream. | counts kept discrete |
| Leakage | per-value AUC ≥ 0.995, NaN-pattern AUC, provenance flags | leaks caught before training |
| Dynamic range / span | audited under **every** candidate scaler, not just the chosen one | heavy tails are why minmax killed five NN1 columns |
| Tail diagnosis | skew, excess kurtosis, tail-mass share | the same reason, measured |

Units plausibility was dropped. A units error that survives this far shows up as a
span or tail anomaly anyway.

Most of pass 1 already runs as the gate scans S1–S9 and S13 (Run page, Verdict
board). The EDA sheet reads the same masking: every statistic on it is computed on
values with NaN, inf and the sentinel set removed (canon C7).

---

## 3. Pass 2 — analyse features

### 2·1 Separation, per feature

| measure | what it is | what it gets us |
|---|---|---|
| KS | largest gap between the two CDFs | no binning choice |
| AUC | P(signal outranks background) | comparable across features |
| Mutual information | any dependence, not only monotone | catches what KS and AUC miss |
| Bhattacharyya | overlap of the two densities | how much the classes share |

All four are **marginal**, so none of them can see a difference that lives in the
dependence between columns. The output is a ranked shortlist plus a ceiling: no
single cut on any feature beats its best number here.

### 2·2 Correlation structure — the core of pass 2

The object is **Σ_S − Σ_B**, the difference of the class-conditional covariance,
shown as a heatmap over feature pairs. It is computed with Pearson, Spearman and
dCor. Where they disagree is itself a finding: a pair that is Pearson-flat and
dCor-strong has a non-linear dependence.

It gives three things:

1. **Pairs that carry class information.** Two classes can share every marginal
   and still separate. The large cells name the pairs where that happens:
   candidates for ratios, products and angles.
2. **Whether a linear model is enough.** Under Gaussian class-conditionals, Σ_S = Σ_B
   gives a linear optimal boundary (LDA), and Σ_S ≠ Σ_B gives a quadratic one (QDA).
   Σ_S⁻¹ − Σ_B⁻¹ *is* the quadratic term.
3. **The ABCD premise, measured.** ABCD assumes P(x₁,x₂|B) = P(x₁|B)P(x₂|B): a zero
   off-diagonal in Σ_B, and dCor_B = 0 for the non-linear case. Computed on
   background per region, this tests the closure condition directly. It is what
   double-DisCo regularises toward.

Estimate both classes on identical rows and **bootstrap the difference**. Each cell
is a difference of two noisy estimates.

### 2·3 Redundancy (not in the deck; kept)

- Pairwise `|r| ≥ 0.98` is duplication.
- Hierarchical clustering on `1 − |r|`, cut at 0.1: keep one column per cluster,
  or the cluster mean.
- Partial correlation / precision matrix, to separate direct from mediated
  dependence.
- Condition number of the design matrix.
- Verify NN1 ∩ NN2 = ∅ rather than assuming it.

### 2·4 Stability slices (not in the deck; kept)

| slice | a difference means | what it is | what we do |
|---|---|---|---|
| mass point | the feature is learning the signal grid | design problem | expect held-out-mass failure |
| barrel / endcap | the registry entry is wrong for one region | data problem | split or drop the entry |
| CV fold | small-sample noise | measurement | feeds RRM |
| run period / pileup | background is non-stationary | assumption violation | ABCD closure invalid |

---

## 4. The EDA sheet — build status

### mk1 (drop mk45) — built

- **Input files, first and largest.** Every expected file is shown with its name,
  found or not, size and **column count** (header read only, on sheet open). Rows
  fill in after a run. A file is flagged when it lacks columns that other files in
  its region have. The NN lists are shown but not graphed.
- **Generate signal / background graphs** runs one region as a job with a progress
  bar. It graphs every non-admin column, signal (four mass points pooled,
  unweighted) against background, on common bins.
  - **Auto-scale:** the x range is the pooled 0.1–99.9% quantiles. Tails are
    counted under each plot, not dropped. Discrete columns with ≤ 60 values get
    one bin per value.
  - **Auto log-y:** the y axis switches to log when the tallest bin exceeds 50× the
    median non-empty bin. It can be overridden to linear or log.
  - **Stats:** per class — n, invalid count, **mean, variance, std-dev**, all on
    masked values.
  - **MaxEnt readouts:** see §5.1.
  - **Sorting:** by file order, by separation above noise, by moment share, or by
    background negentropy. Columns can be filtered by name.
- Results are cached on (data, settings, rulings, eda version, row limit).

### mk2 (drop mk46) — built

- **Section view:** with a section open, the hub's rail and section band fold
  into one top bar: the TV at half size (it is also Home), the section cards as
  a one-click switcher, and the page links with Home, Sign out and sound. The
  section takes the full width; the deck stays on the landing view. The EDA
  grid goes from three columns to four at 1600 px.
- **MaxEnt case and fits on every card** (§5.2): what the column is, which
  constraint set wins for B and for S, how much of the separation the fits see,
  and the Gaussian's share for contrast.
- **Find a feature:** type to filter; Enter, or picking a name from the list,
  opens it.
- **Enlarged view** (click any plot), replacing the grid:
  1. S/B overlay, with signal optionally split by mass point.
  2. MaxEnt fit per class: histogram with the chosen rung drawn over it (best
     per class by default) and the Gaussian rung dashed for reference.
  3. Log-likelihood ratio ln p_S/p_B: per-bin points from the histograms, the
     fits' curve, and the Gaussian parabola.
  4. CDFs with the KS gap marked.

  Under the panels: plain-language findings for this feature, the rung ladder
  per class (k, ΔBIC, ΔAIC, left out, D_B at that rung) and full descriptive
  statistics. Esc returns to the grid; ‹ › steps through the listed features.
- The old per-card "MaxEnt" numbers are renamed **Gaussian reference**. They
  measure against one MaxEnt yardstick; they are not a fit.

### Next, in order

1. 2·2 heatmap: Σ_S − Σ_B with bootstrap error, Pearson / Spearman / dCor, per region.
2. 2·1 remainder: KS, AUC and MI next to D_B, as a sortable table.
3. Per-mass-point overlays: the first stability slice, and nearly free once 2·1 exists.
4. 2·3 redundancy.

---

## 5. MaxEnt — what EDA carries, and what belongs to the Max Entropy sheet

### 5.1 Gaussian reference (renamed in mk2)

Given only a mean and a variance on the real line, the MaxEnt density is the
Gaussian. Its entropy, `H_G = ½ ln(2πe σ²)`, is the most any density with that
variance can have, which makes it a yardstick. These are descriptive numbers
against that yardstick, not a fitted model:

| readout | meaning |
|---|---|
| `H`, `H_G`, `J = H_G − H` | histogram entropy; the Gaussian bound; negentropy, the information beyond two moments |
| `D_B hist`, `D_B null` | Bhattacharyya distance between the histograms, and its 20-permutation noise level |
| `D_B gauss`, share | the same distance between the two Gaussians, and its share of `D_B hist` (reported only above 2 × null) |
| disjoint | the supports share no bin: a leakage signature |

### 5.2 MaxEnt fits — built in mk2 (`engine/maxent.py`)

MaxEnt is not "always Gaussian". The fitted density is
`p(x) ∝ exp(Σ λ_k f_k(x))`, and **the constraint set together with the support
decides the family**. So each column first gets a **case**, and each case gets a
**ladder** of constraint sets:

| case | when | ladder |
|---|---|---|
| binary | two values | Bernoulli: exact, nothing to fit |
| integer lattice | count / integer types (PMFs only, rule 3) | geometric {x}, COM-Poisson {x, ln x!}, discrete Gaussian {x, x²}; plus an indicator rung on a value holding ≥ 5% (the MaxEnt form of inflation) |
| density on R | continuous with negatives | Gaussian, cubic, quartic {x … x⁴} (a quartic can be bimodal) |
| density on R+ | continuous, ≥ 0 | Gaussian, exponential {x}, gamma {x, ln x}, lognormal {ln x, ln² x}, quartic |
| density on [0, 1] | bounded01 | uniform {}, beta {ln x, ln(1−x)}, Gaussian, quartic |
| + hurdle | any density case where one value holds ≥ 5% | that value becomes a point mass with its own weight per class; the ladder fits the rest (no smooth density can put weight on one value) |

**How each fit is made:**
- Every rung is solved per class by convex dual Newton, on the column's
  observed range (a fine grid for densities, every integer for lattices).
  Every fit is therefore **truncated to the observed range**.
- Per rung and class the sheet reports log-likelihood, AIC, BIC, ΔBIC and ΔAIC,
  **left out**, and the S-vs-B Bhattacharyya distance at that rung.
  - *Left out* is the data's cross-entropy under the fit minus its own entropy:
    the information the constraint set does not carry. On the Gaussian rung it
    equals J.
- **Best** is the lowest BIC. If several rungs sit within ΔBIC 2, the column is
  **not identified** at the family level; that is reported, not hidden. AIC
  disagreeing with BIC is flagged, since the truth is not in the ladder.
- The **headline** puts each class on its *own* best rung. Forcing S onto B's
  rung hides a signal that differs in shape. *Captures* is the distance between
  the two best fits as a share of `D_B hist`.

**Rules kept:**
- Identical rows across rungs. The test asserts BIC − AIC = k(ln n − 2) exactly.
- No change of variable, so no Jacobian: log constraints change the constraint
  set, not x.
- PMFs only on integers.

**Checked against known densities (scratch, not in the repo).** The ladder picks
the true family every time:

| data | picked |
|---|---|
| Gaussian | Gaussian |
| gamma | gamma (ΔBIC to the next: 231) |
| lognormal | lognormal |
| Poisson | COM-Poisson |
| zero-inflated Poisson | the inflation rung |
| a spike on a continuous column | hurdle |
| beta | beta |

A bimodal signal over a Gaussian background gives S = quartic, B = Gaussian.
The fits capture 82% of the histogram separation; the Gaussian pair captures
0.5%.

### 5.3 Proposed next (Max Entropy sheet)

1. **Across-feature view.** A table of every column's case, best rungs, left
   out and captures, sortable, so the ladder results can be read as a set. The
   per-column ladders already exist.
2. **Joint MaxEnt.** Under second-moment constraints the joint MaxEnt is the
   multivariate Gaussian, so the S/B likelihood ratio is QDA. This is the same
   object as §3 2·2: the correlation pass and the joint MaxEnt model measure one
   thing.
3. **Named-family selection** (from the notebook). The ladder above covers
   the MaxEnt families; this extends it to the full menu. This is MLE per family, then
   AIC with BIC reported alongside, and **ΔBIC, not a winner**:

   | ΔBIC | reading |
   |---|---|
   | 0–2 | indistinguishable |
   | 2–6 | positive |
   | 6–10 | strong |
   | > 10 | very strong |

   The family menus by column type are:

   | column type | families |
   |---|---|
   | ℝ | Gaussian, student-t, skew-normal, logistic |
   | ℝ⁺ | gamma, lognormal, weibull, exponential, inverse-gaussian, half-normal |
   | counts | poisson, nbinom, zero-inflated / hurdle variants |
   | [0,1] | beta, Kumaraswamy, boundary-inflated |

   Choosing a family is declaring which statistics you preserve. AICc applies to
   sliced fits only.

   Three ways to get it wrong:
   - comparing families on different rows or a different n;
   - no Jacobian on transforms;
   - fitting densities to PMFs (`nMDT`, `nBOL`, `nRPC` are counts).

---

## 6. Canon reminders for this sheet

- No synthetic data (C1); a missing file stops the run by name.
- Every number is computed at run time (C4); gaps render as `—`.
- Progress is reported on every long operation (C5).
- No event-level rows leave the box (C3): the sheet carries histograms and summary
  statistics only.

## 7. Revision log

| date | change |
|---|---|
| 2026-09-24 | mk1. Standalone plan. Two passes from the deck; redundancy and stability kept from the notebook; MaxEnt split into what EDA carries (§5.1) and the Max Entropy sheet (§5.2). Records the first sheet iteration (drop mk45). |
| 2026-09-24 | mk2 (drop mk46). Section view (top bar, full-width section). MaxEnt fits built: case identity per column, constraint ladders per case (hurdle and inflation included), AIC/BIC with identification and disagreement flags, left-out information, best-vs-best separation. The per-card readouts are renamed Gaussian reference. Search, the enlarged view (four panels, ladders, descriptive stats). §4, §5 updated. |
