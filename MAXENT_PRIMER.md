# MaxEnt — what it is, what it isn't, and how this dashboard uses it

**Repo:** ATLAS_PRE_FILTER_DASH · **Written:** 2026-09-24 (mk46)
**Related:** `docs/EDA_PLAN_mk1.md` §5 (the plan) · `engine/maxent.py` (the code)

This primer collects the questions that came up while building the EDA sheet's
MaxEnt fits, with the answers that settled them.

---

## 1. Is MaxEnt always a Gaussian?

**No.** The Gaussian is the MaxEnt answer for only one setup: the whole real
line, with just the mean and variance constrained.

MaxEnt always gives a density of the form

```
p(x) ∝ exp( λ₁ f₁(x) + λ₂ f₂(x) + … )
```

The **constraints you choose, together with the support**, decide which
distribution comes out:

| support | constraints you preserve | MaxEnt distribution |
|---|---|---|
| ℝ | mean, variance | Gaussian |
| [a, b] | none | uniform |
| [0, ∞) | mean | exponential |
| [0, ∞) | E[x], E[ln x] | gamma |
| (0, ∞) | E[ln x], Var[ln x] | lognormal |
| [0, 1] | E[ln x], E[ln(1−x)] | beta |
| ℝ | E[x], E[x²], E[x³], E[x⁴] | a skewed or bimodal shape, whatever the data demands |
| counts | mean, with a 1/x! base measure | Poisson |
| counts | E[x], E[ln x!] | COM-Poisson (Poisson generalised; over- or under-dispersed) |

So **MaxEnt is not an assumption that the data is Gaussian.** It asks for the
least-committed distribution that honours the statistics you trust.

If you constrain only the mean and variance, you get a Gaussian whatever shape
the data has. The negentropy J then measures how much shape you threw away by
trusting so little.

---

## 2. What if the data is non-Gaussian?

Then you add constraints that capture the shape.

| the data looks like | add | what it buys |
|---|---|---|
| skewed or heavy-tailed on ℝ⁺ (energies, hit counts) | E[ln x] | gamma- and lognormal-like tails |
| bimodal | E[x³], E[x⁴] | a quartic in the exponent can have two humps; a quadratic cannot (the x⁴ coefficient must come out negative, or the density does not normalise) |
| bounded, like NN scores in [0, 1] | E[ln x], E[ln(1−x)] | beta-like shapes, including U-shapes piled at the edges |
| zero-inflated counts | an indicator, E[1(x = 0)] | the MaxEnt form of inflation: extra weight on one value, nothing else assumed |

### The limit, and the trade-off

Add enough constraints (one indicator per bin, say) and MaxEnt reproduces the
histogram exactly. That is not a model; it is the data restated.

Every constraint is a parameter, so choosing the constraint set is **model
selection**: AIC, with BIC alongside and ΔBIC reported. The ladder stops at the
rung where the next constraint no longer earns its keep.

### Two cases a smooth MaxEnt density handles badly on its own

- **Spikes.** A point mass at 0, −1 or a saturation value. A smooth
  `exp(…)` density cannot put finite probability on a single value. Model the
  point mass separately, with its own weight (a **hurdle**), and run MaxEnt on
  the rest.
- **Integer counts.** These need the discrete version: a sum over the lattice,
  not an integral, giving a PMF and never a density.

---

## 3. Are the numbers on the sheet "just stats about the distribution"?

Before mk46, **yes**. Since mk46, the sheet reports two different things, and it
keeps them apart.

### Gaussian reference — descriptive statistics against one yardstick

Among all densities with a given variance, the Gaussian has the most entropy:

```
H_G = ½ ln(2πe σ²)
```

That makes it a ceiling, and a yardstick:

| readout | meaning |
|---|---|
| `H` | histogram entropy (nats, Miller–Madow corrected) |
| `H_G` | the Gaussian bound at the same variance |
| `J = H_G − H` | negentropy: the information beyond the first two moments |
| `D_B gauss` | how separable S and B would be if each were the least-committed distribution with its mean and variance |

These are useful diagnostics, but they are **numbers about the data, not a
model of it**. On the sheet they are labelled **Gaussian reference**.

### MaxEnt fits — a model

Per feature and per class, a real MaxEnt fit does three things:

1. **Chooses a constraint set**: the statistics you commit to preserving.
2. **Solves for the density** `p(x) ∝ exp(Σ λₖ fₖ(x))`. The multipliers λₖ are
   fitted parameters; the result is a model, not a summary.
3. **Uses it:**
   - `ln p_S(x) − ln p_B(x)` is a closed-form per-feature discriminant.
   - Climbing a constraint ladder (2 moments → log-moments → 4 moments) shows
     which statistics carry the separation. The rung where it stops growing is
     the answer.
   - The fitted marginals are the input to a MaxEnt ABCD baseline.

**In one line each:**
- The Gaussian reference answers: *is this column Gaussian-like, and does
  mean-plus-variance explain the separation?*
- MaxEnt fits answer: *what is the least-committed model consistent with the
  statistics I trust, and what does it predict?*

---

## 4. How the dashboard does it (`engine/maxent.py`)

### Step 1 — case identity

Every column gets a case first, because the case decides which families are
allowed at all.

| case | when | ladder of constraint sets |
|---|---|---|
| **binary** | two values | Bernoulli: exact, nothing to fit |
| **integer lattice** | count / integer types; **PMFs only** | geometric {x}, COM-Poisson {x, ln x!}, discrete Gaussian {x, x²}; plus an indicator rung on any value holding ≥ 5% |
| **density on ℝ** | continuous with negatives | Gaussian {x, x²}, cubic, quartic {x … x⁴} |
| **density on ℝ⁺** | continuous, ≥ 0 | Gaussian, exponential {x}, gamma {x, ln x}, lognormal {ln x, ln² x}, quartic |
| **density on [0, 1]** | bounded to [0, 1] | uniform {}, beta {ln x, ln(1−x)}, Gaussian, quartic |
| **+ hurdle** | any density case where one value holds ≥ 5% | that value is a point mass with its own weight per class; the ladder fits the rest |

### Step 2 — fit every rung, per class

**How a rung is fitted:**
- **Solver:** the dual problem is convex. Newton with backtracking, on
  standardised constraints.
- **Support:** densities are solved on a fine grid over the column's observed
  range; lattices on every integer in range.
- **Consequence:** every fit is truncated to the observed range. A "Gaussian"
  here is a Gaussian on [lo, hi].

**What each rung reports:**
- log-likelihood, AIC, BIC, and ΔBIC / ΔAIC to the class's best rung;
- **left out** = the data's cross-entropy under the fit minus the data's own
  entropy. This is the information the constraint set does not carry. For a
  MaxEnt fit it is exactly `H_model − H_data`, so on the Gaussian rung it
  equals J. Left out generalises negentropy to any constraint set;
- the S-vs-B Bhattacharyya distance at that rung.

### Step 3 — read the ladder

- **Best** is the lowest BIC.
- **Not identified:** several rungs within ΔBIC 2 of the best. The data cannot
  choose between those families; any of them serves as a baseline. Reported,
  not hidden.
- **AIC ≠ BIC:** the true distribution is not in the ladder. That disagreement
  is itself the finding.

### Step 4 — separation, each class on its own best rung

`captures` = the Bhattacharyya distance between the S best fit and the B best
fit, as a share of the histogram distance. The sheet shows it next to the same
share for the Gaussian pair.

Each class uses **its own** best rung. Forcing signal onto background's rung
would hide a signal that differs from background in shape.

| captures | Gaussian share | reading |
|---|---|---|
| high | high | mean and variance already carry the separation |
| high | low | **the separation lives in shape**, and the MaxEnt fits recover it |
| low | low | the discriminating structure is finer than any rung (sharp features, many modes) |
| over 100% | — | the smooth fits separate better than binned data can show; read as "all of it" |

---

## 5. Three ways to compute it wrong (kept as rules)

1. **Comparing rungs on different rows, or a different n.** Every rung of a
   class is fitted to the same rows. The test suite checks this exactly: for
   every rung, `BIC − AIC = k (ln n − 2)`.
2. **No Jacobian on transforms.** Every rung here is a density in x itself. A
   log constraint changes the constraint set, not the variable, so no Jacobian
   arises.
3. **Fitting densities to PMFs.** Integer columns (`nMDT`, `nBOL`, `nRPC` …) get
   lattice fits only.

---

## 6. Checks on known densities (scratch code, not in the repo)

The ladder picked the true family every time:

| truth | picked | note |
|---|---|---|
| Gaussian | Gaussian | cubic +9 BIC, quartic +18: extra constraints correctly not paid for |
| gamma | gamma | next best (quartic) +231 BIC |
| lognormal | lognormal | next best (quartic) +675 BIC |
| Poisson | COM-Poisson | its special case |
| zero-inflated Poisson | the inflation rung | every other rung +4,800 BIC or more |
| continuous with a 24% spike at 0 | hurdle + Gaussian | |
| beta | beta | |

**The case the machinery exists for:** a bimodal signal over a Gaussian
background, with means and variances matched.

| | Gaussian pair | MaxEnt best fits (S quartic, B Gaussian) |
|---|---|---|
| share of the histogram separation | **0.5%** | **82%** |

Two moments see almost nothing; the right constraint set sees nearly all of it.

---

## 7. Where to look

| on the sheet | what it shows |
|---|---|
| card, **MaxEnt** line | case, best rung for B and S (`?` = not identified), captures vs Gaussian, left out |
| card, **Gaussian ref** line | J per class, histogram D_B against its permutation null |
| sort: *separation MaxEnt sees and Gaussian misses* | shape-carried features first |
| enlarged view, panel 2 | each class's histogram with the chosen rung drawn over it; the Gaussian rung dashed |
| enlarged view, panel 3 | ln p_S / p_B: histogram points, the fits' curve, and the Gaussian parabola. Where the curve follows the points and the parabola does not, the separation is in shape. |
| enlarged view, ladder tables | every rung per class: k, ΔBIC, ΔAIC, left out, D_B |

**Next** (Max Entropy sheet, see the plan §5.3):
- an across-feature table of cases and fits;
- joint MaxEnt. Under second-moment constraints the joint model is the
  multivariate Gaussian, so the S/B likelihood ratio is QDA — the same object as
  the Σ_S − Σ_B correlation pass;
- named-family selection beyond the MaxEnt ladder.
