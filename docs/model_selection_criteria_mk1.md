# Model Selection Criteria — AIC / BIC / AICc

**Component reference for the preprocessing dashboard, task [5e] (fit analysis)**
Stage A lock-in document · mk1 · 2026-08-20

Scope: defines the criteria used to select a parametric family per feature column,
for the MaxEnt marginal fits feeding the ABCD background estimate. This document is
the drift-protection reference — if an implementation disagrees with it, the
implementation is wrong or this document gets revised with a dated note.

---

## 1. Notation

| symbol | meaning |
|---|---|
| `L̂` | maximized likelihood, `p(y \| θ̂)`, θ̂ the MLE |
| `k` | number of **free** parameters estimated from the data |
| `n` | sample size (number of independent observations) |

All three criteria take the form **misfit + complexity penalty**, on a scale where
**lower is better**. All are meaningful only as *differences* within a comparison
set — the absolute value carries the data's own scale and is not interpretable.

---

## 2. The three criteria

### 2.1 AIC — Akaike Information Criterion

```
AIC = −2 ln L̂ + 2k
```

**Source.** Akaike, H. (1974), "A New Look at the Statistical Model
Identification," *IEEE Transactions on Automatic Control* 19(6), 716–723.
DOI: 10.1109/TAC.1974.1100705

**What it estimates.** An asymptotically unbiased estimator of the relative
expected Kullback–Leibler divergence between the fitted model and the
data-generating process. It is a *predictive* criterion: it targets the model
that will best approximate future data, not the model that is "true."

**Regime.** AIC does **not** assume the true model is in the candidate set
(M-open). This is the correct assumption for detector variables, where gamma /
lognormal / weibull are all approximations and none is the truth.

---

### 2.2 BIC — Bayesian (Schwarz) Information Criterion

```
BIC = −2 ln L̂ + k ln n
```

**Source.** Schwarz, G. (1978), "Estimating the Dimension of a Model," *The
Annals of Statistics* 6(2), 461–464. DOI: 10.1214/aos/1176344136

**What it estimates.** A Laplace approximation to −2 × the log marginal
likelihood, retaining only the terms that scale as `n` and `ln n`. The `O(1)`
term — which carries the prior dependence — is dropped, which is why BIC appears
prior-free.

**⚠ BIC is not actually prior-free.** Dropping the `O(1)` term is equivalent to
adopting a specific prior — the *unit information prior*, carrying the
information content of a single observation (Raftery 1995; Kass & Wasserman 1995).
This is a choice, not an absence of one, and it should be stated when BIC is
reported in a manuscript.

**Derivation conditions (Schwarz 1978).** i.i.d. observations, linear models, and
a likelihood in the **exponential family** (Koopman–Darmois). Later work extends
it beyond i.i.d. (Pauler 1998; Stone 1979) and to mixed models via the Laplace
route (Raftery 1995; Kass & Vaidyanathan 1992). **See §5.4 — several of our
candidate families sit outside these conditions.**

**Penalty strength.** Each parameter costs `ln n` under BIC versus `2` under AIC.
The ratio is `ln(n)/2`:

| dataset | n | ln n | BIC penalty ÷ AIC penalty |
|---|---|---|---|
| endcap (full) | 27,995 | 10.24 | **5.1×** |
| barrel (focused) | 1,125 | 7.03 | 3.5× |
| single mass slice (mS55 endcap) | 515 | 6.24 | 3.1× |

BIC is roughly 5× more parsimony-hungry than AIC on the endcap sample. Where
they disagree, that factor is the whole reason.

---

### 2.3 AICc — bias-corrected AIC

```
AICc = AIC + 2k(k+1) / (n − k − 1)
```

**Source.** Hurvich, C. M. & Tsai, C.-L. (1989), "Regression and Time Series
Model Selection in Small Samples," *Biometrika* 76(2), 297–307.
DOI: 10.1093/biomet/76.2.297 · (earlier related result: Sugiura 1978)

**⚠ Scope of the derivation.** Hurvich & Tsai derived this correction for
**Gaussian linear regression and autoregressive time-series models**. It is an
*exact* result only in those circumstances. Applying it to gamma, negative-binomial,
or beta fits is a **heuristic extension, not a theorem.**

Burnham & Anderson (2002, 2004) nonetheless recommend using AICc universally,
on the grounds that (a) some correction is always needed at small `n`, (b) no
family-specific correction is usually available, and (c) AICc → AIC as `n` grows,
so it costs nothing at large `n`. That recommendation is defensible practice but
it is *practice*, not derivation. Cite it as such.

**When it matters.** Burnham & Anderson's rule of thumb: use AICc when
`n/k < 40`. Correction magnitude on our data:

| case | n | k | correction |
|---|---|---|---|
| endcap full, 3-param family | 27,995 | 3 | 8.6 × 10⁻⁴ |
| barrel focused, 3-param family | 1,125 | 3 | 2.1 × 10⁻² |
| **4-component GMM, barrel mass slice** | ~130 | 11 | **≈ 2.0** |

The first two are negligible against ΔBIC bands of 2. **The third is not** — a
correction of ~2 sits exactly at the "indistinguishable / positive preference"
boundary. AICc is not insurance for our main fits; it is *required* for mixture
models on sliced barrel data.

---

## 3. Reading the differences

### 3.1 ΔBIC

```
ΔBIC_i = BIC_i − BIC_min
```

Best model reads 0; every other reads its penalty.

**Bayes-factor reading.** The difference of two BIC values approximates twice the
log Bayes factor between the models, and the relative error of that approximation
vanishes as `n → ∞` (Kass & Raftery 1995). Conventional interpretation bands for
`2 ln BF` (Kass & Raftery 1995, p. 777):

| ΔBIC | evidence for the better model | BF |
|---|---|---|
| 0 – 2 | not worth more than a bare mention | 1 – 3 |
| 2 – 6 | positive | 3 – 20 |
| 6 – 10 | strong | 20 – 150 |
| > 10 | very strong | > 150 |

**⚠ Nested vs non-nested.** The BIC → Bayes-factor result was established for
**nested** models under stated conditions (Kass & Wasserman 1995, reviewed in
Kass & Raftery 1995). Raftery (1995, §4.1) gives a version applying to integrated
likelihoods generally — and hence to non-nested comparison — but under **more
restrictive** conditions.

Most of our comparisons are non-nested: **gamma vs lognormal vs weibull are all
k = 2 and none nests any other.** The Bayes-factor reading is therefore on weaker
footing for exactly the comparisons we run most. Use the bands as a rough
ordering device; do not quote a Bayes factor for a non-nested family pair in a
manuscript without the caveat.

*Nested pairs we do have:* poisson ⊂ negative-binomial; poisson ⊂ ZIP;
normal ⊂ student-t (as ν → ∞); k-component ⊂ (k+1)-component mixture. The last
two are **boundary-nested**, which is its own problem — see §5.5.

### 3.2 ΔAIC, Akaike weights, evidence ratios

Same construction: `Δ_i = AIC_i − AIC_min`. Burnham & Anderson's bands are looser
than Kass & Raftery's — Δ < 2 substantial support, 4–7 considerably less,
> 10 essentially none.

**Akaike weights** convert the differences into a probability-like quantity over
the candidate set:

```
w_i = exp(−Δ_i/2) / Σ_j exp(−Δ_j/2)
```

`w_i` is read as the weight of evidence that model `i` is the best K-L
approximating model *in the set considered*. **Evidence ratio** `w_best / w_i`
quantifies the preference for one over another.

**This is the right output format for the dashboard.** A weight vector over the
family menu is strictly more informative than a winner, and it carries model
selection uncertainty forward instead of discarding it. A column whose best
family carries `w = 0.29` has effectively not selected a family — and reporting
that honestly is more useful than reporting a winner.

---

## 4. Which criterion for this project

**Primary: AIC (with Akaike weights). Secondary: BIC, reported alongside.**

Rationale:

1. **M-open.** BIC's consistency guarantee — it recovers the true model as
   `n → ∞` — is conditional on the true model being *in* the candidate set.
   Detector variables are not gamma. AIC's predictive target is the honest one
   for our situation.
2. **Report both anyway.** Where they disagree, the disagreement is itself the
   result: extra parameters bought real likelihood but not enough to survive a
   parsimony prior. That is precisely the case where the choice should be broken
   downstream, not by a criterion.
3. **The actual tiebreaker is N_A sensitivity.** Push each candidate family
   through `fit_marginals → sample → estimate_N_A` and read the corner. Two
   families at identical AIC can give materially different region-A predictions,
   because AIC/BIC are dominated by the bulk while ABCD closure lives in the
   sparse high-high corner. This is the same lesson already established for
   DNCn_QN vs dCor: global agreement does not imply corner agreement. **Report
   the spread in N_A across the candidate set as a systematic.**
4. **AICc where `n/k < 40`** — mixture models on sliced data. Flag automatically
   rather than deciding per column.

Note the framing that makes this native to the MaxEnt work: each candidate family
**is** the MaxEnt distribution under a specific set of moment constraints, so
choosing a family = declaring which sufficient statistics are preserved. The fit
report should name the constraints, not only the family.

---

## 5. Three ways to compute these wrong

### 5.1 Different data between fits

Information criteria are comparable **only** when every candidate is fitted to
*exactly* the same observations, with the same weights. Drop NaNs differently
between two families — or let one family's optimizer silently discard
non-positive values while another keeps them — and `n` differs, `L̂` is computed
over a different sample, and the comparison is meaningless.

**Guard:** the fit report records `n` per (column, family) cell and **hard-fails**
if `n` is not constant across the family menu for a given column. Not a warning.

### 5.2 Missing the Jacobian on transformed fits

Fitting a normal to `log(x)` and a lognormal to `x` are **the same model**. Their
log-likelihoods differ by `Σ ln x` — the change-of-variables term — so comparing
them without the Jacobian is comparing a density on `log`-space against a density
on `x`-space and reading the difference as evidence. The winner is decided by the
units, not the fit.

For a transform `y = g(x)`, the density on `x` is `f_X(x) = f_Y(g(x)) · |g′(x)|`,
so `ln L_X = ln L_Y + Σ ln|g′(x_i)|`.

**Guard:** fit every family on the **raw column**, in the column's own units.
If a transform is unavoidable, apply the Jacobian and unit-test it — a normal
fitted to `log(x)` with the correction must reproduce the lognormal's
log-likelihood on `x` to floating-point tolerance. This is a two-line test and
it catches the error permanently.

### 5.3 Mixing densities and probability mass functions

A continuous family's log-likelihood is built from a **density**: unbounded above,
scale-dependent, and it changes if you rescale the column. A discrete family's is
built from a **probability**: bounded by 0 in log-space. They are not on a common
axis, and comparing them is not a comparison.

This bites hardest on exactly the columns that most tempt a continuous fit — the
integer counts `nMDT`, `nBOL`, `nRPC`. Those are the columns whose quantization
propagated through NN1b to produce the output banding behind the barrel ABCD
closure failure. Fitting a gamma to them would smooth over the very pathology the
scan exists to detect.

**Guard:** column type is determined **first**, from cardinality and integrality,
and it gates the family menu. Integer-valued columns are compared only against
{poisson, negative-binomial, ZIP, ZINB, hurdle}. A continuous family never appears
in a discrete column's ranking table, and the type decision is written into the
run manifest.

---

## 5A. Additional hazards (beyond the headline three)

### 5.4 Candidate families outside BIC's derivation conditions

Schwarz's derivation assumes an exponential-family likelihood. Of our menu:

| family | exponential family? |
|---|---|
| normal, gamma, exponential, poisson, beta, negative-binomial (r fixed) | yes |
| lognormal | yes (in `ln x`) |
| **weibull (shape free)** | **no** |
| **student-t** | **no** |
| **skew-normal, mixtures** | **no** |

BIC is used well outside its derivation conditions as a matter of routine
practice, and generally behaves. But if weibull or student-t wins a column on
BIC, that is a result standing on an unverified extension. Flag it in the output
rather than discovering it at manuscript time.

### 5.5 Mixtures break the regularity conditions

For mixture models, the Fisher information is **singular** at the parameter
values where a component vanishes or two components coincide. The Laplace
approximation underlying BIC assumes a non-singular Hessian at the mode, so
**BIC's derivation does not hold for selecting the number of GMM components** —
notwithstanding that this is the single most common use of BIC in practice.

This is directly load-bearing for task [5b] (multimodality detection), which is
GMM component selection. Options: (a) use BIC anyway, state the caveat — standard
practice, defensible; (b) use WBIC / singular learning theory (Watanabe) if
justification matters; (c) treat GMM ΔBIC as a *screening* statistic that
nominates columns for inspection rather than a decision rule. **(c) is the
recommendation for the dashboard.**

The same singularity affects the **boundary-nested LRT**: testing ZIP vs Poisson
puts the null on the parameter-space boundary, so the null distribution is a
50:50 mixture of `χ²₀` and `χ²₁`, not `χ²₁`. Using plain `χ²₁` over-rejects —
i.e. it finds zero-inflation that is not there. Van den Broek's score test avoids
the issue.

### 5.6 The definition of `n`

BIC's penalty depends on the sample size, and "sample size" is ambiguous whenever
observations are not independent. Our rows are events, which we treat as
independent — reasonable. But if a fit is ever run on **per-vertex** rows with
multiple vertices per event, the effective `n` is closer to the event count than
the row count, and using the row count inflates the penalty. Record the `n`
definition in the manifest.

### 5.7 Counting `k`

`k` counts **free** parameters estimated from the data. Fixed or constrained
parameters do not count; a scale parameter estimated by MLE does. For a GMM with
`K` components in `D` dimensions with full covariance,
`k = K(1 + D + D(D+1)/2) − 1`. Off-by-one on `k` shifts BIC by `ln n ≈ 10` on the
endcap sample — a full band on the Kass–Raftery scale, from "bare mention" to
"very strong," produced entirely by a counting error.

---

## 6. Implementation checklist

- [ ] Column type resolved before family selection (§5.3); type written to manifest
- [ ] All fits on raw column, no transforms; Jacobian unit-test in the test suite (§5.2)
- [ ] `n` asserted constant across family menu per column; hard-fail on mismatch (§5.1)
- [ ] `n` definition and `k` per family recorded in manifest (§5.6, §5.7)
- [ ] AIC, BIC, AICc all computed; AICc auto-flagged where `n/k < 40`
- [ ] Output is an **Akaike weight vector** over the menu, not a winner
- [ ] Non-exponential-family winners flagged (§5.4)
- [ ] GMM component selection labelled as screening, not decision (§5.5)
- [ ] Adequacy reported as statistic *magnitude* (KS / AD / CvM distance, W₁ in
      column units, PIT histogram + PIT-KS, Q–Q with tail called out) — **not**
      as p-values, which are uninformative at n ≈ 28,000
- [ ] N_A sensitivity computed across the candidate set and reported as a spread (§4.3)

---

## 7. References

1. Akaike, H. (1974). A New Look at the Statistical Model Identification.
   *IEEE Transactions on Automatic Control* **19**(6), 716–723.
   DOI: 10.1109/TAC.1974.1100705
2. Schwarz, G. (1978). Estimating the Dimension of a Model.
   *The Annals of Statistics* **6**(2), 461–464. DOI: 10.1214/aos/1176344136
3. Sugiura, N. (1978). Further analysis of the data by Akaike's information
   criterion and the finite corrections. *Communications in Statistics — Theory
   and Methods* **7**(1), 13–26.
4. Hurvich, C. M. & Tsai, C.-L. (1989). Regression and Time Series Model
   Selection in Small Samples. *Biometrika* **76**(2), 297–307.
   DOI: 10.1093/biomet/76.2.297
5. Kass, R. E. & Raftery, A. E. (1995). Bayes Factors. *Journal of the American
   Statistical Association* **90**(430), 773–795. (Interpretation bands, p. 777.)
6. Kass, R. E. & Wasserman, L. (1995). A Reference Bayesian Test for Nested
   Hypotheses and its Relationship to the Schwarz Criterion. *JASA* **90**, 928–934.
7. Raftery, A. E. (1995). Bayesian Model Selection in Social Research.
   *Sociological Methodology* **25**, 111–163.
8. Burnham, K. P. & Anderson, D. R. (2002). *Model Selection and Multimodel
   Inference: A Practical Information-Theoretic Approach*, 2nd ed. Springer.
9. Burnham, K. P. & Anderson, D. R. (2004). Multimodel Inference: Understanding
   AIC and BIC in Model Selection. *Sociological Methods & Research* **33**(2),
   261–304. DOI: 10.1177/0049124104268644
10. van den Broek, J. (1995). A Score Test for Zero Inflation in a Poisson
    Distribution. *Biometrics* **51**(2), 738–743.
11. Watanabe, S. (2013). A Widely Applicable Bayesian Information Criterion.
    *Journal of Machine Learning Research* **14**, 867–897.

---

## 8. Revision log

| date | change |
|---|---|
| 2026-08-20 | mk1 created. Corrections folded in from chat vetting: (i) "−2 ln L̂ always drops when you add parameters" restricted to nested comparisons — see §3.1; (ii) AICc scope narrowed to its Gaussian-linear derivation, Burnham & Anderson's universal-use recommendation cited as practice not theorem — §2.3; (iii) AICc correction magnitude at endcap n corrected from ~1e−4 to 8.6e−4, and the "essentially never needed" claim withdrawn for mixtures on sliced data — §2.3. |
