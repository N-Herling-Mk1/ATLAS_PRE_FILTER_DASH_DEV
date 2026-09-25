# ATLAS-Dashboard-mk_1 — drop mk46: section view + MaxEnt fits

Apply after mk45. Copy the drop over the repo root, then:

```powershell
powershell -ExecutionPolicy Bypass -File .\apply_mk46.ps1
```

There is a new Python module, so **restart the server**. Then run
`.\run_tests.ps1 -Data home`. The eda version moved to `eda mk2`, so the first
Generate per region recomputes; after that it is cached again.

```
engine\maxent.py                       NEW   case identity + constraint ladders, dual-Newton fits
engine\eda.py                          MaxEnt per column; feature_detail() for the enlarged view
server\eda_api.py                      + GET /api/eda/<region>/feature?col=
web\templates\hub.html                 Home button in the nav; "← Home" in the section head
web\static\app\js\hub.js               section view: cards switch sections, TV/Home close, no dock glide
web\static\public\css\hub.css          section-view top bar; dock panel removed
web\templates\sections\eda.html        search, new sorts, legend, the enlarged view
web\static\app\js\eda.js               MaxEnt line per card, search, enlarged view with 4 panels
web\static\public\css\eda.css          styles for the above
tests\test_eda.py                      + route validation, + real-data MaxEnt checks
docs\EDA_PLAN_mk1.md                   §4 mk2 built, §5 rewritten (5.1 Gaussian ref, 5.2 MaxEnt fits)
docs\STAGE_A_SCOPE_mk2.md              + mk46 row
```

## Section view

Open any section. The rail and the section band fold into one top bar:

- the TV at half size, which is also Home;
- the section cards as a one-click switcher;
- the page links, with Home, Sign out and sound.

The section gets the full width, and the EDA grid goes to four columns. The deck
stays on the landing view and comes back where you left it. Esc leaves an
enlarged feature first, then the section.

## MaxEnt — what each card now says

- **Case:** binary, integer lattice, or a density on R, R+ or [0, 1]. A hurdle
  is added when one value holds 5% or more of the column.
- **Best fits:** the best constraint set for B and for S by BIC. A `?` means
  the column is not identified: several rungs sit within ΔBIC 2.
- **captures:** how much of the histogram separation the two best fits see,
  next to the Gaussian pair's share.
- **left out:** information the B fit does not carry.

The old per-card numbers are still there, renamed **Gaussian reference**. They
measure against one yardstick; they are not a fit.

Sort by **"separation MaxEnt sees and Gaussian misses"** to put the shape-carried
features first.

## The enlarged view

Click any plot, or type a name and press Enter. You get four panels, plus
written findings, the ladder per class and full descriptive statistics:

1. **S/B overlay**, with an optional split of signal by mass point.
2. **MaxEnt fit per class**, with a rung selector.
3. **Log-likelihood ratio**: per-bin points, the fits' curve, and the Gaussian
   parabola. Where the solid curve follows the points and the parabola does not,
   the separation is in shape.
4. **CDFs** with the KS gap marked.

## Checked here

- The suite passes: 25 passed, 6 skipped (the real-data tests).
- The real-data tests were run against the sandbox harness: 6 passed. They
  include the rows-identical-across-rungs check, BIC − AIC = k(ln n − 2) for
  every rung.
- The browser pass ran hub → EDA → generate → sort → search + Enter → panels →
  rung switch → mass split → Esc (leaves the feature, stays in the section) →
  a lattice feature → Home. No errors; the only console line is the expected
  404 before the first run.
- The solver was checked on known densities in scratch code. It picked the true
  family every time: Gaussian, gamma, lognormal, Poisson (as COM-Poisson),
  zero-inflated Poisson (inflation rung), spike (hurdle), and beta.

## Not verified — and the thing to look at first

This has **not run on the real CSVs**. The sandbox harness rebuilds values at
histogram-bin centres. That creates exact repeats, so the harness shows more
hurdles and more quartic wins than real data should. On your first real run, check:

- how many columns come back as **hurdle**: real spikes (0, −1, a saturation
  value) only;
- whether **left out** reads "n/a" often. That is shown when the entropy
  estimate goes below −0.02 nats: values too coarse for 64 bins;
- endcap **run time**. The fits add work per column; the barrel harness took
  3 s end to end.

## Known limits

- Fits are truncated to the observed range. A "Gaussian" here is a Gaussian on
  [lo, hi].
- A bounded-range fit can bend up at an edge when the data have a flat tail.
  That is what the constraints say on a bounded support, not a bug; the curve
  shows it.
- Captures above 100% happen: the smooth fits separate better than the binned
  data can show. The findings text says to read it as "all of it".
