# ATLAS_PRE_FILTER_DASH — Stage A Scope (mk2)

**Repo:** github.com/N-Herling-Mk1/ATLAS_PRE_FILTER_DASH (private)
**Date:** 2026-09-10, revised 2026-09-11 (mk2)
**Status:** LOCKED on sign-off. This is the drift-protection reference: if an
implementation disagrees with this document, the implementation is wrong, or this
document is revised with a dated entry in §18.

**Lineage:** consolidates the July 2026 NN-vet hygiene gates (G1–G5) and the
August 2026 scan-layer spec (`preprocessing_scan_layer_mk1.md`,
`model_selection_criteria_mk1.md`), plus the Aug 2026 `atlas_scan` repo
(S1–S5 + S9 + alert transports). Everything is rebuilt; no code is carried over
unexamined. The August documents are kept in `docs/` as companions; where this
document disagrees with them, §18 records which way and why.

---

## 0. Purpose

One question per column, per region: **does this feature mean what we think it
means, and will a network be able to use it?**

Two failure classes look identical downstream (near-zero importance) and have
opposite fixes. The dashboard exists to tell them apart.

| symptom | cause | fix |
|---|---|---|
| feature contributes nothing | no information present | drop it |
| feature contributes nothing | transform destroyed the resolution | re-transform it |

**Position in the analysis pipeline.** This repo is the **Data Gate + block
reduction** stage, upstream of the cooperative → adversarial pipeline:

```
ATLAS_PRE_FILTER_DASH  ->  fg_select  ->  fg_game --drop-file  ->  fg_promote / fg_paper
   (gate, reduce)          (LOO vs null)   (NN1/NN2 placement)       (report)
```

The dashboard **nominates**. It never places features into NN1/NN2; placement
belongs to fg_game.

---

## 1. Canon

| # | rule |
|---|---|
| C1 | **No synthetic data anywhere** — not in runs, tests, fixtures, demos, or fallbacks. A missing input stops the run and names the missing file. |
| C2 | **Stage discipline.** `engine/` is pure Python and never imports Flask. `server/` is a thin wrapper. |
| C3 | **No event-level rows leave the box.** Bundles, exports, and pages carry derived results only. |
| C4 | **Every number is computed from data at run time.** Nothing is hardcoded. Gaps render as `—`, never as a filled guess. |
| C5 | **Progress reporting on every long operation**, as progress bars in the UI and status prints in the console. |
| C6 | **Nothing is shown as verified without a real-data canary** (§12). A scan without a canary displays `UNVERIFIED`. |
| C7 | **Order is load-bearing** (§8.1). No statistic is computed on unmasked values once S2 has ruled. |

---

## 2. Security layer — mild: a lock, not an identity system

| item | spec |
|---|---|
| credential | One shared password. No user accounts. |
| storage | scrypt hash + `SECRET_KEY` in `.env`, written by `python -m server.set_password`. The plaintext is never stored. `.env` is never committed. |
| session | Signed cookie: HttpOnly, SameSite=Lax, Secure when live. Carries a last-activity timestamp. |
| idle timeout | 8 h of **inactivity**. A banner warns 10 min before. Unsaved scratch work is discarded at timeout. |
| coverage | Every page and every `/api` route is locked. The single exception is `/health`, which returns exactly `ok` and nothing else. |
| lockout | **None**, by decision. Consequence: the password must be a long passphrase (5+ random words). |
| logging | Every failed login is logged (time, IP) to the console and the notifier. The IP is taken from `CF-Connecting-IP` when live, and from the socket locally. |
| network | Flask/waitress binds 127.0.0.1 only. Live traffic arrives only via cloudflared (outbound tunnel, no open router ports). Loopback-only binding is what makes `CF-Connecting-IP` trustworthy. |
| kill switch | Rotating `SECRET_KEY` invalidates every cookie. This logs everyone out and covers a leaked cookie. |
| parity | Identical code path local and live. The only differences are env flags (`PFD_SECURE_COOKIE`, `PFD_TRUST_CF`). |
| identity (mk4) | Sign-in is password only (Steve's call, 2026-09-11). An optional name set on the Session page is stamped on gate runs, S14.5 runs, catalogue versions and bundles; unset reads "unnamed". Attribution, not authentication. |
| alerts (mk2) | Failed sign-ins and failed jobs alert through the transports ported from `atlas_scan` (console always; SMTP, carrier SMS gateway, Twilio via .env). 6 per hour per kind, 5-minute dedupe, loud preflight failure for a half-configured transport. |
| known limits | No per-person revoke. The identity tag is honor-system. TLS terminates at Cloudflare, so Cloudflare can see traffic in transit. |
| optional later | Cloudflare Access (email one-time codes) in front of the app. Off by default. |

---

## 3. Concurrency and runtime

| item | spec |
|---|---|
| multi-user | Yes. Many simultaneous logins on one shared password. |
| server | **waitress** (multi-threaded) on Windows; gunicorn when moved to WSL. Never the Flask dev server when live. |
| Cloudflare limits | 100 s per request (a longer request returns a 524), and a 100 MB upload cap. |
| job queue | **Any operation that can exceed ~5 s runs as a background job** and the page polls its status. This is mandatory because of the 100 s limit: S11, S14, S15, and full gate runs are always jobs. |
| worker cap | Configurable. Default: physical cores ÷ 2, so two users launching S14 do not starve the box. Queued jobs show their queue position. |
| result cache | Keyed on (data content hash, catalogue version hash, settings hash). A second user requesting an identical scan gets the cached result. The cache is derived and disposable: deleting it only costs recompute time. |
| scratch | Each login gets a scratch workspace for its jobs, discarded at logout or timeout. SAVE (§6) is what preserves it. |

---

## 4. Persistence model — what the server keeps

| store | durable? | contents | backup burden |
|---|---|---|---|
| **catalogue store** | **yes** | feature lists, every version immutable (§5) | user: DOWNLOAD CATALOGUE button, plus referenced versions ride in every session bundle |
| result cache | no (disposable) | derived scan results | none — rebuildable |
| login log | yes (append-only) | failed/successful login events | none |
| sessions | **no** | — | user: SAVE bundle (§6) |

**Store location:** `PFD_STORE_DIR`, defaulting to a folder **outside OneDrive**
(e.g. `C:\pfd_store`). OneDrive has silently reverted repo files to older versions
four times in one session, and a store that reverts corrupts version history
without any error. The server refuses to start if `PFD_STORE_DIR` resolves inside
a OneDrive path, unless `--allow-onedrive` is passed.

---

## 5. Feature catalogue — lives on the site

**Decision (2026-09-10): the site is the home of the feature lists.** Lists are
uploaded, edited, and versioned in the dashboard. The analysis pipeline consumes
**exports** from it.

### 5.1 Lists

| item | spec |
|---|---|
| upload formats | CSV (`barrel,endcap` header convention), `.py` in the `nn_features_mk3_v3.py` format, JSON in the `llp_features.json` format. One parser per format; the internal canonical form is JSON. |
| editing | In-page: add / remove / move a feature between NN1 and NN2, per region, with a required change note. |
| versioning | Every upload or edit creates a **new immutable version** (content hash, timestamp, note, parent version). Nothing is ever overwritten. |
| concurrent edits | An edit is made against version X. It is rejected if the head has moved since X was loaded, and the user re-opens the new head. No last-write-wins. |
| validation | On upload/edit, every feature name is checked against the target region's real data columns. Unknown names are flagged `MISSING_IN_DATA`, not silently accepted or dropped. |
| diff | Any two lists or versions can be diffed: added / removed / moved NN1↔NN2 / region changes. |
| disagreement matrix (mk2) | Feature × list-head membership per region, conflicts highlighted: scan layer §16.3 says the catalogue's first job is showing where the four registries disagree. |
| author (mk2) | Every version records who made it (the sign-in name); not part of the content hash. |
| seeding | Nothing is pre-loaded into the repo. The existing registries are uploaded through the site on first use: `nn_features_mk3_v3.py`, `llp_features.json` v0.2.0, `kj_Jul_26_NN1/NN2.csv`, the legacy NN1/NN2 lists, the fg_select barrel drop file, and the barrel 16/10 pipeline partition. |

### 5.2 Per-feature fields

name · region applicability · NN membership (per list) · column type (from S1) ·
expected range (feeds S8) · exclusion_reason (feeds S13) · sentinel rulings
(from S2 adjudication) · free-text note.

### 5.3 Export to the pipeline

- Export any list version as `.py` (mk3_v3 format) and CSV.
- The version hash is written into the file header, so the pipeline's logs can
  name exactly which catalogue version a run used.
- Drop-file export for `fg_select --drop-file` (§10).

---

## 6. Session save / reload — the burden is on the user

| item | spec |
|---|---|
| SAVE | Downloads one bundle (`.pfd.zip`) with: manifest, every scan result, settings/thresholds, S2 sentinel adjudications, the catalogue versions the session used, and UI state. |
| LOAD | Upload a bundle and the dashboard is restored exactly where it was saved. |
| contents | **Derived results only** plus the data content hash (C3). On load, the bundle re-links to the raw data through the locations file. |
| stale check | If the current data's content hash ≠ the bundle's, a warning is shown and every result is marked `STALE`. Stale results are never displayed as current. |
| schema | The bundle carries `schema_version`. An incompatible bundle is refused with a named reason; it never half-loads. |
| guard | The page warns before navigating away with unsaved work. |
| size | Well under Cloudflare's 100 MB upload cap because no rows are included. LOAD refuses anything over 90 MB with a named reason. |

---

## 7. Ingest

| item | spec |
|---|---|
| loader | Locations file (`--home` / `--office`) listing every input path. One loader module; there are no per-package copies. |
| samples | Per region (barrel, endcap): background data24VR + signal mS5 / mS16 / mS35 / mS55. |
| failure | A missing file stops the run and names the file (C1). |
| counts | Every load prints event counts per region × sample and stores them in the manifest. |
| hash | A content hash per input file and one combined data hash; this is the cache and stale-check key. |
| first load | Settles the barrel count discrepancy (3,506 / 1,226 sig vs 3,405 / 1,125 — two readings on record). Whatever the verified first load reads becomes the pinned count. |

---

## 8. Scan layer

### 8.1 Execution order

```
S1 -> S2 -> S3 -> S4 -> S5 -> S13 -> [mask per S2 rulings]
   -> S6, S7, S8, S10, S11  (describe)
   -> S12 -> S15            (separate)
   -> S14                   (structure)
   -> S9                    (transform)
   -> verdict + hand-off
```

S1 gates every family menu downstream and cannot be overridden. **S13 runs
before S12**: signal is MC and background is data, so data/MC mismodeling reads
as separation. A column is not "separating" until S13 has cleared it.

### 8.2 Gate scans

| scan | catches | rule / default (tunable, and every threshold is written into the manifest) |
|---|---|---|
| S1 typing | binary / count / integer (signed) / bounded01 / continuous+ / continuous / admin / text / empty | Scan-layer §1 types with family menus. A continuous family never appears for a discrete column. Categorical is set in the catalogue, never guessed from values. Admin columns (eventWeight, runNumber, eventNumber, DSID, mcChannelNumber, pileup) are META, kept as slice keys, and only where the name is in the header. |
| S2 sentinels & missingness | NaN, ±inf, −999, candidate point masses, padding, column absent from a file | −1 is **not** a global sentinel; it is legal in signed columns. Candidates are reported, then ruled per column in the adjudication table. Class: CLEAN ≤ 0.5% invalid / MASKABLE ≤ 50% / UNUSABLE > 50%. |
| S3 dead columns | constant, near-constant, constant in one sample only | Near-constant: top-value share > 99.9%. Constant in one sample only is also passed to S13. |
| S4 cardinality | low-cardinality columns | ≤ 50 distinct values (scan layer §4). Integer-valued and > 2 values → dequantization candidate (log1p / rank / train-time jitter). |
| S5 spikes & zero-inflation | spikes at 0 or any value; tie fraction; excess zeros in counts | Spike: any value holding > 1%, every type, with its kind. Tie fraction = share of events whose value is shared with another event (the ceiling on any rank transform). Zero-inflation: van den Broek (1995) score z against Poisson, flagged only if z > 3 **and** observed P(0) exceeds the moment-matched negative binomial P(0): detector counts are overdispersed and overdispersion alone makes excess zeros. |
| S13 leakage | target and provenance leakage | Value-AUC ≥ 0.995 or NaN-pattern AUC ≥ 0.95 → exclusion candidate. **S13.2 provenance:** MI(feature; mass point) on signal against a permutation null, z ≥ 5 → note (never a DROP: some mass dependence is physics). `exclusion_reason` is the enum {leakage_target, leakage_provenance, admin, units_suspect, dead, superseded}; MET (`htmiss_NOSYS`, `met_met_NOSYS`) is leakage_target. Data-vs-MC comparability not built. Preprocessing leakage is a training-code invariant (`row_partition_contract_mk1.md`) and out of scope here. |

### 8.3 Describe (masked values only)

| scan | output | rule |
|---|---|---|
| S6 stats & tails | stats table | n, mean, sd, quantiles q0.5 / 1 / 5 / 25 / 50 / 75 / 95 / 99 / 99.5, IQR, MAD, skew, excess kurtosis, **L-skew, L-kurtosis**, robust tail ratio (§8.6), Hill right-tail index (top 2% of positive values, k ≥ 25; a screen, not a fit). |
| S7 histograms & box plots | figures | Background vs each mass point, per region, **linear and log y side by side**. Outlier points drawn (thinned evenly to 300 per side, total printed), not suppressed; box suppressed only when IQR = 0. Working point overlaid: background median until the catalogue carries operating cuts. |
| S8 outliers | per-column flags | Values outside the catalogue's expected range. |
| S10 multimodality | screening flags | Hartigan dip test **and** GMM ΔBIC, reported together; never a verdict. Run **per mass point**, because pooled signal is a mixture of four masses by construction. |
| S11 shape fits | Akaike weight vector | Family menu gated by S1. MLE per family; AIC primary, BIC alongside, AICc when n/k < 40. KS / AD / CvM / W₁ are reported as **distances, not tests**: parameters fitted on the same sample invalidate KS p-values, and at n ≈ 25k every family is rejected. Each candidate family is propagated to N_A, and the spread is reported as a systematic. |

### 8.4 Separate

| scan | output | rule |
|---|---|---|
| S12 separation | per-feature table | AUC, KS D, debiased MI, Bhattacharyya coefficient, JS divergence, W₁, Fisher ratio. Binned metrics use a fixed grid recorded in the manifest. **Disagreement flag:** high MI with AUC ≈ 0.5 means non-monotone separation (a network can use it; a cut cannot). Any single-feature AUC ≥ 0.99 is a provenance flag, not a discovery. Everything is labelled **MC-sig vs data-bkg**. |
| S15 stability | long table sorted by z | `feature | axis | slice_a | slice_b | n_a | n_b | W1 | KS | PSI | null_sd | z`. Null = **permutation of slice labels between a and b**, so the null has exactly the observed sizes (the August split-half null is built at n/2 vs n/2 and is miscalibrated for unequal slices such as mS55 515 vs mS16 1,051). Sorting by z makes barrel and endcap rows comparable. Supersedes the mk1 CI-overlap rule. |

### 8.5 Structure and transform

| scan | output | rule |
|---|---|---|
| S14 correlation | matrices | Pearson, Spearman, and dCor, computed **separately** on signal and background, plus a sig − bkg difference map. |
| S14 duplication | blocks | Groups of near-duplicate columns (default \|Spearman\| ≥ 0.95 in both samples), then **block reduction**. Resolves LOO's blind spot. **Representatives are chosen without labels** (fewest invalid values, S9, block medoid): July's "top-2 by signal AUC" is label-driven selection on the full sample, the catastrophic class in `row_partition_contract_mk1.md` §5. |
| S14 conditioning | condition number | On standardized columns, per net (NN1 block, NN2 block, union), per region. Flag > 30 (Belsley–Kuh–Welsch). |
| S14.5 cross-block dCor | split design score | **Built (mk2).** dCor between the active list's NN1 and NN2 blocks **in background**, per region: columns rank-transformed, subsamples of 2,000 rows × 5 repeats, permutation null (NN2 rows shuffled) → z, plus per-feature dCor against the other block. Input-level dCor predicts how much work λ will do; it is not the network-output dCor on record (.046 / .098 / .3018) and its calibration against that is unknown until both are measured on the same splits. |
| S9 span audit | pass/fail per column × scaler | **Built (mk2).** Realised fraction = entropy on a fixed 256-bin grid over the declared output range ÷ the column's achievable ceiling. Flag when realised_frac < 0.5, nothing else. **A detector, never a ranking:** a rank transform is the entropy-maximising monotone map, so "best scaler" is true by construction and says nothing. Transforms come from the training path (`llp/data.py::apply_scale` via `PFD_LLP_SRC`) or are labelled `reference`; a broken `PFD_LLP_SRC` stops the run by name. A flag on the pinned scaler (quantile) is FIX; on other scalers a note. |

### 8.6 Tail mass (resolved 2026-09-10; kept in mk2)

- Fence = median ± 3 · (1.4826 · MAD).
- Tail mass share = observed fraction beyond the fence ÷ the fraction a Gaussian
  of the same robust width puts there (0.27%).
- Reported **left and right separately**. A ratio ≈ 1 means Gaussian-like; ≫ 1
  means heavy tail.
- When MAD = 0 (zero-inflated), it is computed on the non-spike values and
  labelled as such.

### 8.7 Verdict

Per column × region: **PASS / FIX / DROP / META**, each with its reason. The
architecture is weakest-link: the worst gate result sets the verdict, and every
contributing gate is shown.

---

## 9. Separation-vs-hygiene boundary

S1–S5 and S13 are hygiene: they decide whether a column is fit to use. S6–S12
and S15 describe and rank. S14/S14.5 is structure. **Only hygiene produces
DROP.** A weakly separating but clean column is PASS with a low rank. Dropping
it is fg_select's decision, made against a permutation null, not the
dashboard's.

---

## 10. Hand-off exports

| export | consumer |
|---|---|
| drop-file (DROP verdicts + block-reduction losers) | `fg_select --drop-file` |
| reduced registry (catalogue version) | the pipeline's feature import |
| verdict CSV | the record / fg_paper |
| per-scan CSVs | anyone |

Every export header carries the data hash, catalogue version hash, and settings
hash.

---

## 11. Dashboard pages

login · run launcher (live progress, queue position) · verdict board (feature ×
gate grid) · feature card (every scan for one column) · catalogue (lists,
versions, edit, upload, diff, export) · separation leaderboard · correlation /
duplication / conditioning · stability heatmap (mass × region) · fits · span
ladder · session SAVE / LOAD.

**Aesthetic:** TRON-light × FORGE engineering-drawing sheet. Orbitron / Share Tech
Mono. ATLAS accent `#FF2D6B`, ink twin `#C10E4A`. Physics plots use viridis on
white; TRON styling is for chrome only.

---

## 12. Verification — real-data canaries

**Model:** the first verified load of real data produces a **reference
snapshot**. Steve signs it off. Every later run on the same data hash must
reproduce it, or the affected scan is flagged `REGRESSION`.

**Named canaries (known facts about the real files):**

| scan | canary |
|---|---|
| S3 | `MS1Vtx_l1hcal` is constant in barrel |
| S4 | `nMDT` / `nBOL` / `nRPC` are low-cardinality |
| S13 | `htmiss_NOSYS` / `met_met_NOSYS` are flagged |
| ingest | endcap counts bkg 24,850 / mS5 532 / mS16 1,051 / mS35 1,047 / mS55 515 (Aug 2026 runs, total 27,995) |
| S9 | `nMSeg_ratio_EIEM` flagged under minmax in endcap (central span 1.167e-05 on record) |
| S9 | `nMDT` / `nBOL` / `nRPC` read column-limited |
| ingest | event counts pinned from the signed-off first load |

Remaining scans are canaried by the signed-off snapshot itself. Until sign-off
they display `UNVERIFIED`.

**Tests:**

- **Lock:** every route except `/health` refuses without a session; `/health` returns only `ok`; rotating `SECRET_KEY` invalidates existing cookies; the Secure flag is on when live.
- **Round-trip:** SAVE → LOAD on real data reproduces every result byte-for-byte.
- **Stale:** a bundle loaded against changed data marks every result `STALE`.
- **Catalogue:** versions are immutable; an edit against a stale head is rejected; export → re-import is identical.
- **Concurrency:** two logged-in sessions run jobs simultaneously without cross-talk.
- **Engine guard:** nothing under `engine/` imports Flask.

---

## 13. Repo layout

```
ATLAS_PRE_FILTER_DASH/
  docs/          this document + revision log
  engine/        stage B — pure Python: loader, S1–S15, verdict, exports, CLI
  catalogue/     list parsers (csv/py/json), version store, diff, export
  server/        Flask app, lock, job queue, bundles, notifier, set_password
  web/           templates + static (JS/CSS/icons)
  tests/         real-data tests (require the locations file; skip with a named reason if absent)
  deploy/        stage D stub: cloudflared, podman, sidecars
  run_local.ps1  local launcher (waitress, smart localhost port search)
  .env.example
  .gitignore
```

---

## 14. Site

| item | spec |
|---|---|
| domain | nth-atlas-llp.com |
| path | browser → Cloudflare edge → tunnel → cloudflared on Steve's box → waitress @ 127.0.0.1 |
| gate | The app's own lock (§2). |
| box off | Cloudflare serves its own error page; nothing is exposed. |
| repo | Private. No GitHub Pages. Data, `.env`, the store, and bundles are never committed. |
| stage D | Tunnel, WSL/podman, alert sidecars, external uptime poller — after B/C are complete. |

---

## 15. Out of scope

Training · NN1/NN2 placement (fg_game) · preprocessing leakage (training-code
invariant) · user accounts · the July combo generator (retired; a redesigned
partition proposer is a future stage-A item).

---

## 16. Build order

| stage | contents | done when |
|---|---|---|
| B | `engine/` + `catalogue/` + CLI, on real data, CSV outputs only | a full gate run completes on both regions and the reference snapshot is signed off |
| C | `server/` + `web/`: lock, job queue, all pages, SAVE / LOAD — local only | all §12 tests pass on localhost |
| D | tunnel, waitress/gunicorn under WSL, alerts, uptime poller | live at nth-atlas-llp.com with §12 lock tests passing through the tunnel |

Build order follows scan layer §17 on measured payoff. Done in mk1–mk2: S1–S5,
S13, S6, S7, **S9** (+0.048 AUC precedent), **S14.5** ("if the dashboard does
nothing else"). Next: S12 → S14 (duplication, conditioning, label-free block
reduction) → S8 → S15 → S10/S11.

---

## 17. Open items (non-blocking; checked at build time)

- `fg_select --drop-file` format: read from `patch_mk2c.py` (Sep 7–8) so the export matches its parser exactly.
- Domain state: whether nth-atlas-llp.com is registered and in the Cloudflare zone.
- Data governance: confirm with Prof. Johns that derived results served over a Cloudflare-terminated tunnel are acceptable.
- Passphrase: Steve chooses it at `set_password` time (5+ random words). Current `ATLAS_1` is localhost-only.
- `PFD_LLP_SRC`: full path to the folder containing `llp\` (Aug 11 delivery: `...\projects\atlas\src\llp\`). Also confirm what `apply_scale` does with −999 before scaling; S9 reads masked values.
- Barrel counts: the August docs themselves mix the two readings (3,506 in the scan layer, 1,125 in the contract). First load settles it.
- fg_select "selection-free" claim (pipeline, not this repo): seeds 20–29 are seed-disjoint, not row-disjoint, unless fg_select ran on held-out rows.

---

## 18. Revision log

| date | change |
|---|---|
| 2026-09-10 | mk1 created. Decisions locked this session: no synthetic data (canon); private repo ATLAS_PRE_FILTER_DASH; minimal shared-password lock with no users and no lockout; 8 h inactivity timeout; multi-user via waitress + job queue (Cloudflare 100 s limit makes jobs mandatory); user-owned session SAVE / LOAD bundles; feature catalogue lives on the site with immutable versions and exports to the pipeline; catalogue store outside OneDrive; tail mass = robust-fence ratio against a Gaussian reference; stability by bootstrap-CI overlap instead of a minimum n; canaries from a signed-off first real load; barrel count reconciliation deferred to first load; combo generator retired; KS demoted to a distance in S11; S13 ordered before S12. |
| 2026-09-11 | mk2, after reading the August scan-layer spec and `atlas_scan` repo. Build order corrected to scan layer §17 (S9 and S14.5 built). S1 adopts the §1 type set + family menus; admin columns become META slice keys. S4 threshold 20 → 50. S5 tie fraction redefined (share of events in tied groups; mk1's 1 − n_unique/n understated it); zero-inflation via van den Broek score **with a negative-binomial guard** (departs from the spec, which would flag nearly every overdispersed count at n≈25k). S6 full quantile set + Hill. S7 linear and log side by side, outlier points drawn, working point. S9 ported as a detector only; the August "best scaler" table dropped as tautological; transforms from `llp/data.py` when configured. S13.2 mass-point MI provenance screen and exclusion_reason enum. S14.5 built. S15 null changed to label permutation (departs from the spec's split-half null). Tail mass: the Sep 10 fence ratio kept over the spec's top-1% magnitude share, which is not location-invariant. Identity tag and code commit on every result (§16.1). Registry disagreement matrix. Block-reduction representatives must be label-free. Alert transports ported. Real-data canary pins added from the August records. |
| 2026-09-11 | mk3, after the first real run (smoke + full, both regions, no errors). Counts: barrel bkg 2,280 and signal 175/442/484/125 = 1,226 (so the 3,506 reading matches the files; 1,125 is a downstream subset); endcap matches the August record exactly. Canaries: the three S9 "column-limited" canaries removed (their source was the August test fixture, not data); S4 low-cardinality canaries replaced by S1 "typed count" on the real header names `msvtx_nMDT`, `msvtx_nRPC`, `nBOL`; barrel bkg count pinned. Columns absent from any file are now META (exclusion_reason leakage_provenance) instead of DROP: presence identifies the sample. New schema summary per region; the files do not share one schema (bkg 246 columns, mS5/mS35 255, mS16/mS55 252), and 3 columns missing from mS16/mS55 only are reported as a production inconsistency. UI re-skinned to the FORGE aesthetic (dark steel, ATLAS LLP accent #FF2D6B, plots on white plates) with a new sign-in page. |
| 2026-09-11 | mk4. Sign-in is password only; attribution moved to an optional name on the Session page. Site palette switched from FORGE to the ATLAS event-display colours (black, detector blue, track orange, calorimeter yellow, chamber green, muon red), with verdicts reusing the display's meanings (PASS chamber green, FIX cell yellow, DROP muon red). The sign-in page draws a transverse detector view with one illustrative LLP event (prompt tracks, calorimeter towers, a muon, missing ET, and an MS displaced vertex whose tracklets light only the chambers they cross), generated in the browser and labelled on the page as not data. Signing in fires a fresh event before submitting; a rejected password flashes the muon system red. Reduced motion draws a still frame. |
| 2026-09-11 | mk5. Sign-in page titled "ATLAS - Sig/Bg - DashBoard - mk1". On load only the detector sweep plays; no event. Sign-in submits by fetch (X-PFD-Login: 1, JSON answer; a plain form POST still works without JavaScript), and an illustrative event fires either way: a correct password gets an LLP event with an MS displaced vertex and the alert "LLP detected", then the dashboard opens; a wrong one gets an event with no displaced vertex, the detector rumbles, the muon system flashes red, and the alert reads "no LLP detected". |
| 2026-09-11 | mk6. Sign-in detector idles "at rest" after the sweep: faint calorimeter noise cells (EM yellow, tile cyan), stray muon-chamber hits, a readout arc circling each inner-tracker layer, the toroid coils breathing, and a near-vertical cosmic muon every 11-19 s that lights the chambers it crosses. Drawn at ~30 fps over a cached detector frame, paused when the tab is hidden, off under reduced motion; quieter (no cosmics) while a rejected event is on screen. |
| 2026-09-11 | mk7. At-rest hits made brighter and rarer: calorimeter deposits are 1-3 neighbouring cells at 75-100% brightness with a glow, every 1.1-2.4 s; chamber hits at full brightness with a glow, every 2.6-5.2 s; cosmics every 14-24 s, brighter and held longer. Hits flash in fast (10% of life) and decay slowly. |
| 2026-09-11 | mk8. Sign-in layout: "ATLAS - Sig/Bg - DashBoard - mk1" is one line across the whole top, scaled by gate.js to fill the band (wraps on phones); the kicker line sits under it. Detector position unchanged on desktop; its outer chambers pass under a translucent title band. Sign-in plate enlarged (560 px or 34vw, larger field, button and type). On phones the detector sits between the title and the plate. |
| 2026-09-15 | mk9. Site renamed **ATLAS-Dashboard-mk_1** (sign-in title, page titles, nav brand, title block). Repo gains `web/static/public/assets/images/`; `web/static/public/img/` retired and the `/favicon.ico` route repointed. The proton mark (`proton_2.png`, 256 px derivative used on the page) sits top left on the gate and above the nav brand, screen-blended with a radial mask so the black plate drops out. Sign-in plate: head reads "Welcome to the gate" with a padlock that is shut when signed out, rattles red on a reject and springs open on success; the message strip is replaced by a seven-segment readout (`seg7.js`, SVG, unlit segments left visible) showing STATUS:SIGNED OUT / SENDING / SIGNED IN / REJECTED / OFFLINE, with the server's reason on the line under it. One `setState()` call drives readout, lock, plate word and run block so they cannot disagree. Sign-in success leaves on a vertical line wipe with a hot core, a flare ahead of the edge and sparks shed behind it; the dashboard opens under black and `arrive.js` sweeps the same line off it (?login=1 marker, once, off under reduced motion). Detector: radius up to min(0.54 H, 0.38 W) at 0.72 W so the wheel bleeds top and bottom and clears the plate; structure drawn lighter at rest (chambers .15/.78, tile .10/.30, EM stroke .22, coils .34, solenoid .55); at-rest activity halved in rate (cells every 2.8-5.6 s, chamber hits 6-11 s, cosmics 26-42 s) and given a heavier edge glow plus a white hot edge; the four inner-detector layers are now discrete modules (44/64/84/104) lit by a slow gradient of 3/4/5/7 lobes with per-module jitter, pixel layers cyan, SCT green, TRT orange. |
| 2026-09-15 | mk10. Sign-in console: the seven-segment readout is replaced by a small cathode screen (`crt.js`) — a scrolling terminal that types lines on, drops old ones off the top, blinks a block cursor, and carries scanlines, a shadow mask and a vignette over curved phosphor. Boot prints link and detector state plus the server's sign-out reason, then `STATUS: SIGNED OUT`; signing in appends the trigger and vertex lines and `STATUS: SIGNED IN` / `REJECTED` / `OFFLINE`, with the screen tone following (amber idle, cyan busy and open, red rejected). `seg7.js` retired. Sign-in plate moved up and left (`align-items: flex-start`, left pad 7vw → 2.4vw; the run block follows it). **Pixel gradients, second pass:** anything that lights now fills with a grid of blocks whose alpha falls off from a source point and is quantised to five levels with a per-block jitter — the steps are what make it read as pixels rather than a soft glow. Applied to at-rest calorimeter deposits (blooming from the cell centre), chamber hits, and cosmic-muon crossings. **Hover probe:** the pointer identifies the component under it by radius (beam pipe, the four ID layers, solenoid, EM, tile, the three muon stations, toroid coils) and lights that component and its neighbours in the same pixel gradient centred on the cursor, named in a label beside the pointer. The canvas stays pointer-events:none and positions come from window mousemove, so the form is unaffected; off under reduced motion. |
| 2026-09-15 | mk11. Console re-tubed: green phosphor (#4DFF7A) as the resting ink, brighter, with a three-stage text-shadow bloom; tones now pale green while checking, green when open, red on reject. Cathode effects added — scanlines and shadow mask drift on a 9 s loop, a bright band rolls down the screen every 6.5 s, brightness flickers on a 3.7 s cycle, and the picture slips a vertical hold every 13 s. All of it decorates the text; none of it moves the text. Screen window 7.6 em → 9.2 em and type up to clamp(12px, 1.05vw, 16px). Sign-in plate enlarged again: min(560px, 34vw) → min(700px, 38vw), lock 30 → 36 px, field 20 → 24 px, button 18 → 22 px, head and body padding up to match; the plate still clears the detector at 1600 px wide and above. Everything off under reduced motion. |
| 2026-09-15 | mk12. Proton mark enlarged to clamp(110px, 12vw, 200px); the title band's left pad becomes clamp(240px, 21vw, 380px) so the headline centres in what is left beside it, and the UA ATLAS / 13.6 TeV / Run-3 tag is dropped below 1400 px where it has nowhere to go. **Page change is now ONE wipe.** Previously the line crossed twice — the gate drew a covering wipe, then `arrive.js` drew a revealing one. The gate's wipe is replaced by a 220 ms fade to black (`blackout()`), so the single line lives on the dashboard side and its job is to REVEAL the page it opens over. `arrive.js` correspondingly slowed 900 → 1150 ms, lead 190 → 240 px, core 5 → 8 px with a brighter flare and more sparks, since it now carries the whole transition. |
| 2026-09-15 | mk13. The mark overlapped the sign-in plate at mk12's 200 px because it was absolutely positioned over the band. Trimming was measured and rejected: content runs to the frame edge (quarks sit in the margins), only ~7% is dead. Fixed structurally instead — the mark now lives IN the header's flow (`.gate-head` is a flex row: mark, then a centred `.head-text`), so the band grows to whatever the mark needs and the plate always starts below it; overlap is impossible at any width or title wrap. Size settled at clamp(120px, 11.5vw, 185px) — the band grows about 25 px rather than 60. Page copy re-cut from a content-trimmed crop. The absolute-position hacks (float, big asymmetric head padding, 96 px phone padding) are gone; the phone breakpoint stacks the band instead. **Cathode mark:** a second copy of the image as `proton_crt_64.png` — 64×64, luminance gamma-lifted, Bayer 4×4 dithered to five alpha levels of one phosphor green (#4DFF7A) with the empty field floored to clean black — sits at the right of the console screen, nearest-neighbour scaled to clamp(74px, 7.4vw, 124px) at 42% opacity, under the glass and behind the text (which gains matching right padding), so it reads as burn-in. |
| 2026-09-15 | mk14. **Mask bug fixed.** The mark's ring and quarks were being clipped: a `radial-gradient(circle …)` with no size keyword measures to the farthest CORNER, so the 62%/82% stops landed at 0.44w/0.58w — inside the image's own half-width (0.50w) — and faded out exactly where the ring (0.45w) and quarks (0.48w) sit. The mask is removed outright rather than retuned: `mix-blend-mode: screen` already drops the black field, which is all it was for. Same fix applied to the nav brand mark in pfd.css, whose max width also goes 132 → 150 px. **Cathode mark animated:** the static `<img>` becomes a 64×64 canvas driven by `crt_mark.js`, holding two bitmaps — the proton sprite, and "13.6 TeV" rendered into the same grid and thresholded to the same five levels. It sits on one for 4.2 s, scrambles cell by cell into the other over 0.9 s, holds 2.6 s, scrambles back; each cell has its own delay and shows random phosphor during its own window, so the change sweeps through as noise rather than a crossfade. Canvas is 64 real pixels scaled nearest-neighbour. Paused when the tab is hidden; reduced motion draws the proton mark and stops. Mark enlarged to clamp(96px, 9.6vw, 160px) and moved in from the right edge to clamp(40px, 5vw, 96px), with the console text's right padding widened to match. |
| 2026-09-15 | mk15. Console mark slowed: holds 4.2 s → 9 s on the proton mark and 2.6 s → 6 s on "13.6 TeV", scramble 0.9 s → 1.8 s, loop 8.6 s → 18.6 s. With the longer scramble the per-cell start spread widens 0.58 → 0.72 and each cell's own noise window shortens 0.42 → 0.28, so the change still sweeps across the grid instead of every cell sitting in static for half a second. **The `crt-hold` vertical-slip animation is removed** — that was the jiggle; the scanline drift, roll band and flicker stay. Title band's top padding 16 → 34 px so the mark's upper-left quark clears the frame edge. |
| 2026-09-15 | mk16. Mark up again to clamp(130px, 12.6vw, 208px), the band's 34 px top padding keeping it clear of the frame edge. **Sign-in button in Arizona colours** — cardinal #AB0520 gradient on a navy #0C234B border, white text, cardinal drop glow, with hover/active/focus states; the plate's left rule turns cardinal too. Scoped to `.plate-body button.primary`, so the orange `.primary` used across the dashboard is untouched. **Contrast pass on the detector:** the resting structure is muted across the board (chambers .15→.09 fill and .78→.52 stroke, tile .10→.06 and .30→.20, EM stroke .22→.145, coils .34→.24, solenoid .55→.38, ID bed .42→.30, idle ID gradient 1→0.72, coil breathing down a third), and everything that lights gains a `glowSpot()` bloom — one additive radial gradient per source, composited `lighter` so overlapping sources stack, far cheaper than a shadowBlur per block. Applied to at-rest deposits (peak 1.05→1.3, hot edge .5→.72), chamber hits, cosmics, the hover probe, and the sign-in event's muon hits and displaced vertex. **A rejected sign-in now resets the detector:** `resetDetector()` clears the event and replays the opening sweep 2.6 s after the verdict, and `setState("out")` takes the console, lock, plate word and run block back to rest with it. **Verdict panel moved to the centre of the wheel** (was below it) and gains a bottom row reading LOG IN SUCCESSFUL / LOG IN UNSUCCESSFUL, tinted with the outcome. |
| 2026-09-15 | mk17. Second mute pass on the resting detector, activation left exactly as it was: chambers .09→.05 fill and .52→.32 stroke, tile .06→.035 and .20→.12, EM .02→.012 and .145→.085, coils .24→.15, solenoid .38→.23, ID module bed .30→.18, idle ID gradient .72→.46, coil breathing down a third again, beam pipe to 55% alpha. Every lit path — pixel peaks, `glowSpot()`, hot edges, the sign-in event — is untouched, so the contrast ratio widens rather than the whole image dimming. **Success reads green, not blue.** A `--win` token (#43E08C) on `body.gate` drives the four places the gate says "open": the verdict panel, the plate's left rule and state word, and the lock springing open. The detector keeps cyan for LLP hits — that is the event display's physics palette, not a status colour — and the focus ring stays cyan so it never reads as success. |
| 2026-09-16 | mk18. Plate head reorganised to one line: WELCOME TO THE GATE | STATE – LOCKED|UNLOCKED – lock. Both words are always present; the live one is lit green (`--win`) and the other sits at 16% opacity, so the state reads as a switch position rather than a label that swaps text. Driven entirely by the form's own `open`/`denied` class — `setState()` no longer writes into `#gate-state` — and the padlock keeps its shackle-lift on open. Rejection lights LOCKED red. Password field loses its label; `ENTER PASSWORD` is now a mono, wide-tracked placeholder that clears on the first keystroke and returns by itself when a rejected attempt blanks the field (a `.sr-only` label keeps it named for screen readers). **Button given two states.** ARMED: the field is non-empty, so the button lifts 4 px off the plate and breathes on a 2.2 s shadow cycle — potential, not progress, and it drops the instant the form is sent. FIRED: a canvas over the button burns its face through in 11 px blocks, sweeping left to right with a per-cell jitter over 780 ms, while a gradient ring opens outward around it. Same quantised-pixel vocabulary as the detector. Both off under reduced motion. Wrapping the button in `.btn-wrap` for the canvas took it out of `.plate-body`'s grid, so it needs an explicit full width — caught in render, fixed. |
| 2026-09-16 | mk19. The armed button lift and its breathe cycle are removed — the arming signal moves to the detector instead. Third mute pass on the resting structure (chambers .05/.32→.032/.20, tile .035/.12→.022/.075, EM .012/.085→.008/.055, coils .15→.095, solenoid .23→.15, ID bed .18→.115, idle gradient .46→.30, coil breathing down a third, beam pipe .55→.35). **Typing arms the detector.** Every resting weight is now multiplied by `L = 1 + 2.2·armNow`, where `armNow` chases a 0/1 target exponentially (0.14/frame, ~0.4 s): with a password in the field the whole structure rises out of the dark to standby, because it is about to fire one way or the other. Nothing that LIGHTS uses L, so hits, blooms, hover and the event stay exactly as bright at either level — only the floor moves, which is what makes the difference read. While `armNow` is in motion the cached base frame is stale, so `stepArm()` returns true and the caller drops `idleBase`/`cache` and redraws; once settled it caches again. Emptying the field stands the detector down and, if the last attempt was rejected, also replays the reset and returns the console, lock and head to rest — an empty box means the attempt was abandoned. A rejected submit blanks the field, so it disarms with it. |
| 2026-09-16 | mk20. Sign-in button: one pixelation effect at two intensities instead of two separate effects. Hover (and keyboard focus) raises a thin 8-bit haze over the face — 8 px blocks re-rolled ~9×/s, so it shimmers without moving. Click drives the same grid to full: blocks coarsen 8 px → 17 px, density .26 → .78, brightness .45 → .78, then it decays back to whatever the pointer is doing (0.065/frame down from a fire, 0.12/frame settling into hover, so the click reads as a decay rather than a blink). The travelling left-to-right sweep is gone — nothing moves across the face, it simply pixelates harder. Block alpha stays quantised to four levels and density is capped so the button and its label read through the blocks rather than being covered. Off under reduced motion. |
| 2026-09-16 | mk21. Button effect reworked to true static. Hover runs it continuously — every cell of a 6 px grid re-rolled every frame, light AND dark speckle (dark below n=0.46, pink to 0.86, white above), alpha quantised to four levels and gamma-weighted dim so it grains rather than glares; ceiling ~0.35, which leaves the label readable through it. Click drives the same field to full: cells coarsen to 13 px, peak alpha to ~1, plus a 0.24 wash, so the button goes to all static. Timings tightened after the mk20 version read as dragging — rise 0.12→0.30 per frame, decay from a fire 0.065→0.16, canvas fade 140→90 ms, and the gradient ring 0.8 s→0.45 s with a smaller travel. Renamed the frame counter to `field`: it had collided with the run-block clock's `tick`, which `node --check` caught. |
| 2026-09-17 | mk22. **Hub: the navigation surface, and the new landing page.** `/` is now the hub and the Run sheet moves to `/run`; PAGES gains a Home entry. Layout is a 2x2 — TV top left, console bottom left, tiles top right, turnstile bottom right — and opening a section merges the right column into one panel (`[data-state="screen"]`, tiles hidden, `.hub-bottom` folded) while the left column is untouched, so the page never re-lays-out under you. Seven tiles (Information Theory, Tokenization, Bayesian, Max Entropy, Forge, Features, Models) live in one `TILES` list in pages.py, read by the template for the grid and by hub.js for the dial, so the two cannot disagree. **Turnstile:** an SVG dial draggable by the dot (pointer capture, shortest-arc snap to the nearest of seven detents), plus up/down triangles, mouse wheel, and arrow/Home/End/Enter keys; rotation is accumulated rather than wrapped to [0, 2π) so stepping past the last section keeps turning the same way instead of unwinding. Selection is a single `sel` — the dial, the ticks, the tile highlight and the console line all read it. Opening: Go, a second click on the live tile, double-click, or Enter; Escape or Back returns. A `hub:open` / `hub:close` CustomEvent is dispatched as the hook for each section's own code. **TV:** `/api/tv` lists everything in assets/images (UI assets denylisted, natural sort so image_2 precedes image_10) and the set cycles ten seconds a picture with a static break between channels, reusing the sign-in button's grain. Empty folder → permanent static and NO SIGNAL. base.html gains a `{% block head %}` for per-page stylesheets and suppresses the page `<h1>` on the hub. |
| 2026-09-17 | mk23. Hub relaid as three sets rather than four grid cells: the RAIL (TV over console) is its own column and never changes; the BAND of small cards is the selector strip across the top; the STAGE holds the deck or the section it opened. Tiles become small cards — glyph plus name, wrapping inline, blurb moved to the title attribute. **Bottom right is now a rotating deck.** CSS 3D, not three.js: the app's CSP is `script-src 'self'` and no renderer is vendored, so a CDN three.js would be blocked outright — and the deck on the personal site is CSS 3D for the same reason. `deck.js` is standalone (`Deck.mount(el, {faces, onSelect, onOpen})`): N faces on a cylinder at R = max(0.82w, w·GAP/(2·tan(π/N))) so faces never overlap as N grows; drag with pointer capture, inertia, snap to the nearest face, shortest-arc `select()`, prev/next, arrow keys. Card selects, deck face opens — so the band can stay put while the stage swaps, and you never lose the selector to open something. Two bugs fixed: `proton_2_256.png` had been renamed to `image_4.png` when the TV images were added, leaving the gate mark and the nav brand mark both 404 — the file is restored (image_4.png kept, it just also plays on the TV); and the deck's throw velocity was unbounded, so with coast = vel/(1-friction) a flick travelled 300° — clamped to 7°/frame at 0.90 friction, about 70° of coast. |
| 2026-09-18 | mk24. Hub stripped for the rebuild. base.html now leaves the nav rail and the sheet title block out on the hub (`{% if page != 'hub' %}`), and the hub's frame becomes a single column, so the TV sits in the page's own top-left corner; the console panel is gone from the rail and its slot is left empty and reserved for the command board. The nav rail's page links and Sign out go with it — reachable by URL until the command board carries them. **Visibility bug fixed:** `.screen { display: grid }` is an author rule and the `hidden` attribute's `display: none` comes from the user-agent stylesheet; the cascade resolves origin before specificity, so the author rule won and the section screen rendered under the deck from page load — the placeholder em-dash and empty glyph box visible in the mk23 screenshot. Display is now driven by `data-state` on both sides (`[data-state=deck] .screen`, `[data-state=screen] .deck-wrap`), with the hidden attribute kept for assistive tech but no longer load-bearing. Noted for the harness: jsdom did not reproduce it, reporting display:none for the broken stylesheet too, because it does not model origin precedence. |
