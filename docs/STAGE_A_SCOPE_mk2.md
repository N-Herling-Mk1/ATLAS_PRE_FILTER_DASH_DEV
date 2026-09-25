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
| 2026-09-18 | mk25. Hub rebuilt to the nathanherling.com deck. **Deck:** `deck.js` rewritten after the site's `js/deck.js` — a raked carousel (ring tipped −12° about X, placards counter-rotated so they stand upright), placards with index, glyph, display-face label and blurb, bottom-aligned; only the front placard takes the pointer, drag anywhere on the stage; a print-in deal on load; new API `grab/turn/release` for external drivers and `setMini` for dock mode. **Depth-dim bug fixed:** the mk23 opacity term measured distance from the front inverted, so the front face got the 0.22 floor and the rear face full opacity — the ghosted front face in the mk24 screenshot. **Control box** under the deck: an SVG gimbal (grab the knob or the dial and drag it round; one knob revolution is one deck revolution, tick marks are the faces, release snaps) over the two step triangles; arrow keys, Home/End, Enter on the dial. **Rail:** the reserved slot becomes Navigate (page links, Sign out, sound toggle) over a dock; opening a section FLIPs the deck into the dock, minimised and drifting, and clicking it there comes back. **Cards:** larger two-line tiles, Orbitron 800; the selected card gets a doubled cyan outline, bloom, top-edge sheen and a glare that travels the border (conic gradient masked to a 2 px ring, spun via a registered `--glare` angle; static without @property; off under reduced motion). **Sound:** `sfx.js`, the site's synth voices (`snap` per face passed, `deal` on card select, `dock` on dock/undock) with a real mute — on the site the speaker gates only the hover bed — persisted in localStorage and armed on the first gesture when stored on; no audio files, `sfxdata.js` not carried over. `--win` was defined only in gate.css, so every `var(--win)` on the hub resolved to nothing; defined for the hub. `test_pages_render_logged_in` asserted the title block on `/`, stale since mk24 took it off the hub; now asserts the hub's own landmarks and that the title block is absent. |
| 2026-09-18 | mk25a. `edge_sim.py` connects to the origin as its own step and reports ANY connect failure as 502. On Windows a connect to a closed localhost port is not refused instantly -- the stack retries the refused SYN for about 2 s -- so with one shared 1 s timeout `test_edge_behaviour` saw a dead origin as 524 and failed. Pre-existing, Windows-only, unrelated to the hub work; passes on Linux either way. Only an origin that accepted the connection and then went quiet is a 524 now, which is the Cloudflare semantics the module claims. |
| 2026-09-18 | mk25b. Hub layout pass. Control box and readout moved LEFT of the deck in one row (grid areas, since hub.js reparents the deck to first child on undock); stacks above the deck under 1320 px. **Hub fits the screen:** height is calc(100dvh - 76px) with every row minmax(0, ...), rail compacts under 860/740 px of height, cards fit one row down to ~1366 px; the sheet's top margin was collapsing through <body> and pushing the document 10 px past the viewport (body is flow-root on the hub). **Deck came back small from the dock:** layout() measured getBoundingClientRect() mid-FLIP, which includes the glide's scale, so the card size was solved from the shrunken box; now clientWidth/Height. **Front-face glow was clipped:** the print-in animation used fill-mode both, which held clip-path: inset(0) forever; now backwards. Sound defaults ON (localStorage 'off' is the only way to silence it; arms on first gesture). Panels rounded (14 px outer, 7-10 px inner). Selected card and front placard get a red glowing underline in addition to the cyan border. Placards drop the blurb under 190 px wide. |
| 2026-09-18 | mk25c. Control box and deck enlarged and brought together: dial 130-176 px (was 112), bigger steps, and the deck's card width solved at up to 0.42 of the box width (was 0.29), which closes the gap to the readout by enlargement rather than by pushing the deck off-centre. Open moves into the control box under the dial and steps, full width. The section name in the readout carries the same red glowing underline as the selected card and front placard, redrawn each time the name changes. |
| 2026-09-18 | mk25d. Control box rides top-left of the stage; deck card width up to 0.45 of its box. Click feedback on the control box: steps and Open scale on press and throw a ring (cyan / amber), the dial's track and knob halo flash on grab. **TV:** images were object-fit: cover, which cropped anything not 4:3 and cut off outer rings -- now contain, letterboxed in the tube's black. The picture is drawn as three channel layers (SVG feColorMatrix R/G/B, recombined with screen blending) with R and B offset 1.3 px for a standing fringe, plus an RGB shear: a 260 ms burst where the R and B fields slide and skew against G, every 3-8 s and on every channel change; off under reduced motion. First try clipped R and B to horizontal bands, which left only green in the gaps and flashed the picture green; the fields now slide whole. |
| 2026-09-18 | mk25e. Readout moved under the control box -- the console is one narrow column (box, then name/index with its red underline), so the deck gets the width back and centres closer to the controls. Deck card width 0.40 of its box, capped at 420 px. Under 1320 px wide, where the console stacks above the deck, it lays back out as a row so it doesn't eat the deck's height. |
| 2026-09-18 | mk26. Gate plate given one state token. `--st` (plus `--st-soft`, `--st-glow`) is set per state on `.gate-plate` and nowhere else, and the plate's 3 px left rule, the password field's border and inner glow, the state words, the padlock and the new diagram all read it — so those five cannot disagree about what the gate is doing. Four states: quiescent #3FC3FF blue, typing/checking #FF9A1F orange, verdict #43E08C green or #E3262E red. Typing is a `typing` class toggled from the field's input handler, held off while a verdict is still on screen; `busy` is now a real class rather than an empty one. Head relaid in two rows — title, with STATE – LOCKED|UNLOCKED beneath it — and the lock moves right, joined by a three-node state diagram (LOCKED → CHECK → VERDICT) whose lit node is derived from the plate's own class in `lightDiagram()`, so there is no second copy of the state; the diagram sets no colour of its own, it inherits `--st`. Sign-in button goes cathode green (#62FF93→#1CA855) with dark #04120B ink, which is ~9:1 against the mid-green where white would be under 2:1; the button's static burst and its fire ring re-tinted green to match. |
| 2026-09-18 | mk27. Deck raised: the ring centres in `.deck-stage`'s content box, so `padding-bottom: calc(var(--deck-lift) * 2)` lifts it by half that — one number, with the perspective origin moved 38% → 31% so the rake stays aimed at the front face. **Ring now bounded as sections are added.** `R = pw·GAP / (2·tan(π/N))` grows about linearly in N while the box does not: measured at a 900×300 host, the ring fits to N=9 (876 px), overruns at N=10 (982 px) and reaches 2014 px at N=20 — the deck would hang off both sides. Inverting the formula gives the card width that keeps the ring inside the box, `pw = D·tan(π/N)/GAP` with D = 0.92·host width, floored at PW_MIN = 120. Below N=9 the existing box cap is smaller and wins, so nothing changes at today's seven. Ring then holds at ~828 px while cards shrink: 232 px at N=10, 191 at N=12 (blurb drops at <190 via the existing `compact` class), 142 at N=16. Past ~16 the card pins to PW_MIN and the ring grows again, which is the point to group sections rather than shrink further. |
| 2026-09-18 | mk28. Eighth section added: **EDA Dashboard** (`eda`, glyph EDA) — distributions, correlations and coverage across the prefilter inputs. At N=8 the ring is 770 px, still inside the box, so mk27's bound is not yet binding. **Circuit-trace sprawl on the sign-in press.** The button's canvas now bleeds 72 px past the button (`--px-bleed`, read by gate.js) so effects can draw outside it: the static still covers the face, and on press seven to ten tracks leave the perimeter along its normal — orthogonal runs with 45° elbows, a square pad at each corner, a via at the tip — sprawling out over 360 ms, holding 110 ms, then withdrawing into the edge over 300 ms, each with its own start delay. Geometry is built once per press in button-local coordinates so a resize mid-animation cannot strand a trace. A haze band rides the button's own edge on a sine over the whole life. First version consumed the polyline from the pad end on retract, which left the outer halves hanging detached in space — a trace breaking off, not retracting; it now shrinks the far end back toward the pad. |
| 2026-09-18 | mk29. Deck raised again (`--deck-lift` 22–62 → 38–104 px). **Depth by size:** the face square to camera draws at 1.06 and the rest shrink toward 0.68, appended to each card's base transform in `paint()` rather than rebuilt there. The falloff exponent is the decision — at 0.85 the first neighbour sits at 0.93, a 7% difference nobody reads as depth; at 0.45 it is 0.84 against the front's 1.06. Recorded in the code that this does NOT relieve crowding at high N, contrary to my first guess: the neighbour's angular distance shrinks as sections are added, so it scales back toward full size — spacing stays mk27's ring bound's job. The docked deck halves the spread so it stays tidy. **Circuit tracks on the deck:** the button's effect extracted into `traces.js` (`Traces.attach(host).fire(rect, opts)`) and fired from the front face as a section opens. The canvas lives on `.stage`, not on the deck, because the deck glides to the dock on open and tracks anchored to it would leave with it; firing happens before the glide, while the face is still where the user sees it. gate.js keeps its own inline copy for now — the two should converge. |
| 2026-09-19 | mk30. mk29 put the circuit tracks on the deck's placard faces; the request was the deck's **buttons**, which got nothing. Fixed: `btnfx.js` (new) carries the sign-in button's static — thin field on hover, same field driven to full on press, four quantised levels with dark speckle as well as light — and prev, next and Open are armed with it. One canvas over the stage rather than one per button: the buttons already sit inside a host, so drawing each field in host coordinates avoids wrapping every button in a positioned div just to anchor a canvas. btnfx draws the field and calls back with the button's rect; hub.js hands that to `traces.js`, so the tracks stay owned by one module instead of being copied a third time. Bleed 48 px on the arrows, 64 on Open. The placard tracks from mk29 stay. |
| 2026-09-19 | mk31. **Docked deck was riding above its slot.** `.deck-stage.mini` inherited the full-size stage's `--deck-lift` and its `padding-bottom: calc(lift * 2)`; the dock slot is about 160 px tall, so at the 104 px end of the clamp the content box went negative and the ring centred off the top of the slot entirely. mini now pins `--deck-lift: 0` and clears the padding; its perspective origin moves 30% → 38% to match. **Tracks shortened** — runs 0.28–0.50 → 0.15–0.29 of the bleed, elbows 0.14–0.26 → 0.08–0.16 — so they read as an edge treatment rather than a diagram. **Glare rebuilt:** one tight bright line for the lit edge, then two WIDE low-alpha bands (7 px at .13, 15 px at .065) under heavy blur. The first attempt stacked three thin bright rings and simply looked like three outlines; a band wide enough not to read as an edge is what hazes. Applied identically to gate.js's inline copy so the sign-in button and the deck buttons stay the same gesture — still two implementations, still worth folding. |
| 2026-09-19 | mk32. A stub sheet per section, in `web/templates/sections/<id>.html` — one file each for info-theory, tokenization, bayesian, max-entropy, forge, features, models and eda. hub.html renders all eight into the screen body and `showSheet(id)` swaps `hidden`, rather than building markup per open: every sheet is in the DOM from render, so a half-built one can keep its own state later. Each stub carries a lead line and a Planned list of what the real sheet will hold, plus a note that nothing reads live data yet. The include uses `ignore missing`, so a section listed in TILES without a template leaves the sheet empty and shows a fallback naming the file to create — a missing template must not 500 the hub. Building a real sheet is now editing one file; the wrapper, the heading and the routing are already done. |
| 2026-09-19 | mk33. **One screen, no document scroll — as a house rule, not a per-page fix.** Written into pfd.css above the shell rules: the sheet is a FIXED height (not a min-height, which lets content push the page taller), every flex/grid child in the chain carries `min-height: 0` (without it a child refuses to shrink below its content and forces the parent to grow), and heights use `100dvh` with `100vh` first as the fallback, because 100vh on mobile excludes the browser chrome actually on screen. `.sheet` becomes a fixed-height flex column, `.frame` a stretching grid with min-height 0, and `main` plus `nav.plates` are the designated scrollers. Gate: `.gate-frame` fixed height, plate row `minmax(0, 1fr)`, `.gate-main` the scroller, bottom padding 110 → 92; `body.gate`'s `min-height: 100vh` replaced with `height: 100%`. Hub: `.hub` now just fills main — its own `calc(100dvh - 76px)` was double-accounting against a main that is already the remaining space, and its `min-height: 560px` floor was itself a scrollbar on any window under about 640 px tall; `.deck-host` floor 260 → 160 px and `.stage` clips rather than pushing the page. Narrow breakpoints deliberately hand scrolling back to the document — a phone cannot honour this and should not try. |
| 2026-09-19 | mk34. (1) `traces.js` gains an `inward` mode — same edge starts, heading reversed, runs roughly doubled (0.30–0.62 of room against 0.15–0.29) and every vertex clamped to the rect, so tracks write across the box instead of spraying off it; hub.js fires the section-open segue with `inward: true`. (2) TV images normalised onto one 1280×960 4:3 canvas, contained not cropped: sources were 836×786, four at 1024² and one at 256², so with `object-fit: contain` they rendered at visibly different sizes — image_4 in particular is the 256 px proton mark upscaled 3.75× and will stay soft. (3) Quiescent blue #3FC3FF → #8BE4FF: the old value sat on the plate's own ambient blue and read as no state at all; all four state colours lightened, and the left rule now carries a two-stage neon glow driven by `--st-glow`. (4) The gate fits instead of scrolling — `.gate-main` overflow auto → hidden, the plate capped at the row height as a flex column with the console as the flexible part, and eleven fixed sizes rewritten as `clamp(px, vh, px)`; budgeted to fit from 1080 px down to about 620 px of window height. (5) The sign-in button now wears `--st` like everything else, with near-black ink — 13.4:1 on the idle blue, 10.9 amber, 14.9 green, 6.4 on the rejected red, where white would be 1.3–3.0:1 — and hovering it pulses the ENTER PASSWORD prompt via a `btn-hot` class on the plate rather than `:has()`. |
| 2026-09-19 | mk34a. Tracks are now ROUTED, not just drawn: no two may cross, and two that meet run parallel. Both behaviours come from one rule — no segment may come within PITCH (room × 0.075, floored at 6 px) of another. A crossing is distance zero, so forbidding the clearance forbids the crossing; two tracks heading the same way get pushed to exactly PITCH apart, which is what parallel looks like. Candidate runs are re-rolled up to 14 times and snapped to the pitch so parallel runs align; if nothing fits the track stops there rather than being forced through — a short trace is plausible, two traces shorted together is not. Starts must clear both other starts and every segment already laid. Two bugs found by auditing 60 builds rather than by eye: start points were checked only against other starts, so a track could begin alongside someone else's run; and the shares-a-vertex exemption was applied to both candidate segments when only the first shares one, which let a track's elbow sit 2 px from its own previous elbow. After both, 60 builds give 0 crossings and a closest approach of 9.45 px against a pitch of 9.45 — binding exactly, as it should. Same router ported to gate.js's inline copy. |
| 2026-09-19 | mk34b. State haze now leaves the LEFT edge only: a box-shadow cannot do that — even offset, its blur bleeds round all four corners — so it is a `::before` strip outside the plate's left edge with a horizontal gradient and a 7 px blur, and the glow shadows come off `.gate-plate` entirely. Quiescent blue #8BE4FF → **#2A5CC7**, deep and in the University's family; #0C234B itself was measured at 1.2:1 against the plate, which cannot read as a light source at all, where #2A5CC7 is 3.1:1. The other three deepened to match (#FF9A1F, #2FD98A, #E0323C). Sign-in button rebuilt on the splash page's PRESS TO ENTER recipe, read out of nathanherling.com's own source: translucent fill (.18→.30 of the colour) instead of a solid, 1px border, label a 38% tint of the colour, one wide un-offset halo, and the 9 px side caps. **Hover moves the halo and border alpha and nothing else** — the colour is the state, and hover is not a state; a button that changes colour under the pointer reports something that did not happen. The translucent fill is also what makes the deeper colours affordable: the label is now a light tint on a dark fill at 8.7–9.3:1 across all four states, where a solid fill needed dark ink and put a floor under how deep the colour could go. |
| 2026-09-19 | mk35. TV effects re-scoped: **static belongs to the change, not to the picture.** The residual `noise = 0.05` that persisted after every channel change is now 0, so a settled picture is genuinely clear. The RGB shear's own 3–8 s loop is removed — a fixed-period loop is what made it read as a loop — and both effects are now drawn from a per-dwell budget: `CLEAR = 0.75`, the remaining quarter spent on tears (180–320 ms) and cathode rolls (420–1000 ms) at random. A roll is a soft band with a hot leading line travelling down the tube, carrying a little static so it reads as the picture losing lock rather than a light passing over. Placement takes the time NOT spent on effects and cuts it into n+1 random gaps, so every event fits by construction: the first attempt picked random starts and shoved collisions apart, which dropped any event landing too late and measured 20% coverage with some dwells as low as 5%. Measured over 500 dwells: 21.8% effect / 78.2% clear, 4.9 events per dwell, zero overlaps, gap sd 639 ms against a mean of 1042 — aperiodic, which a near-zero sd would not be. |
| 2026-09-19 | mk36. The segue box breathes: a green gradient is pushed OUT of each edge, away from the box, and drawn back in as the tracks retract. Four separate perpendicular bands rather than one radial — a radial centred on the box washes the corners about twice as hard as the edge midpoints and reads as a glowing blob instead of light coming off the sides. One sine drives both the reach and the alpha so it swells and settles as a single movement, peaking at the hold when the tracks are fully out. First cut wrote `reach = min(room*0.95, 14 + 86*haze)`, which hit the ceiling at haze 0.79 and sat there for the middle 40% of the pulse — the gradient stopped moving exactly when it should have been furthest out; it now grows into the cap, `14 + (far - 14)*haze`, and travels the whole life. Reach scales with the caller's bleed, so the button's version stays proportionate to its own. |
| 2026-09-19 | mk40. Static gone from the sign-in button; hover REVEALS a Feynman diagram of the actual search channel — pp → ZH, Z → ℓ⁺ℓ⁻, H → SS, each S long-lived and decaying at a displaced vertex to q q̄ — drawn to match the analysis figure: three-line proton beams into a production blob, a wavy Z with its lepton pair, a dashed Higgs, and the two scalars as DOUBLE-dashed lines, which is how S is drawn in the paper and the reason they are the one element not in the state colour. Revealed rather than assembled: the whole diagram is complete at every frame and only its opacity follows `lvl`, so hovering fades it up and leaving fades it down on the easing already tuned for the static. Coordinates are fractions of the button, every stroke scales off min(w/420, h/76), and the layout was prototyped at 420×76 first — the extremes sit at 0.02–0.88 in x and 0.05–0.95 in y so no line leaves the face. Primitives: wave, dash, ddash, seg; the gluon coil and arrowed fermion from the first cut are removed with the geometry they served. |
| 2026-09-20 | mk41. The sign-in button was rendering as pfd.css's orange `.primary` with an unreadable pale-blue label — 1.5:1. Cause: every `color-mix()` declaration was being dropped as invalid, taking the background with it, so the fill fell back to `.primary` and the colour to the plain hex before it. color-mix only reached browsers in 2023 and fails whole-declaration, which is a bad property to put a button's legibility on. Replaced with `rgba(var(--st-rgb), a)` and a per-state `--st-ink`, both supported since custom properties shipped: measured 8.5–8.9:1 across all four states against the real composited fill. **The diagram also moves behind the button** — `.btn-px` z-index 2 → 0, button z-index 1 — so it shows through the translucent fill with the label cleanly on top, instead of the canvas painting over the word. The circuit tracks are unaffected: they draw out in the bleed, outside the button's own box. Label gains a dark text-shadow under its glow. |
| 2026-09-20 | mk42. Hover on the sign-in button becomes a different object rather than a brighter one: the card goes white, the label goes University navy #0C234B and moves right, and the left of the face is given to the diagram, now drawn in ink instead of the state colour. The diagram is scaled uniformly by FIT = 0.60 into the left of the button and vertically centred, so its widest element lands at 0.53 of the width and the label has a clear 0.47; stroke widths are divided by FIT so they keep the same visual weight. Because the two now occupy different halves, they cannot overlap — a layout fix rather than a stacking one, which is why `.btn-px` goes back to z-index 2: drawing from behind an opaque white card would not have worked at all, so mk41's z-index fix is superseded by the layout that makes it unnecessary. Side caps and border follow the navy on hover. |
| 2026-09-22 | mk43. Sign-in button hover returns to the button's own blue — the white card is gone — and TWO LLP diagrams fade in either side of a centred label, drawn in white from the supplied figures: left, pp → Φ → ss with each s (double-dashed) → f f̄; right, pp → H → χχ with each χ (double-solid) → f f f. Each is authored in a unit box and mapped into an outer third (0.015–0.33, 0.67–0.985 of the width), leaving a 200 px band for the label at the measured ~590 × 65 button, so the overlap is prevented by layout. Both read left to right: mirroring the right-hand one to point outward would look symmetrical but reverse the diagram's time axis, putting the incoming protons on the far right. **Hold on press:** the fade target is now hovering OR a submitted state (busy / open / denied, read off the plate's class), so the diagrams stay up through checking and the verdict and let go only when the plate returns to rest. A press still drives `lvl` to 1, and the excess above the hover level is spent as a glow flash — about 300 ms — before it settles to the steady hold. The gate's single-diagram ZH code and its ink palette are removed with it. |
| 2026-09-22 | mk44. Sign-in button went orange on hover. pfd.css carries `button.primary:hover:not(:disabled) { background: #FFB04D }`; `:not(:disabled)` scores as a class, so that rule is (0,3,1) against the resting rule's (0,2,1) and wins on hover — and mk43's hover rule, though it matched (0,3,1), set only shadows and never `background`, so the orange came straight through. The hover rule now restates background, border and ink, and repeats the same pseudo-classes to score (0,4,1): it wins on specificity rather than on load order. Also caught next door: pfd's `button:disabled { opacity: .4 }` would have dimmed the button for exactly the checking window in which the diagrams flash and hold. For this button disabled means already-sent, not unavailable, so it stays lit at full opacity with a progress cursor — still unclickable, which is what stops a double submit. |
| 2026-09-24 | mk45. **EDA sheet, first iteration.** `docs/EDA_PLAN_mk1.md` is the standalone plan: two passes (reject by content; analyse features — 2·1 separation, 2·2 Σ_S − Σ_B, 2·3 redundancy, 2·4 stability), MaxEnt split into what the sheet carries and what belongs to Max Entropy. `engine/eda.py` (no Flask) gives a header-only file manifest and a per-region run: every non-admin column, signal (masses pooled, unweighted) vs background on common auto-scaled bins (pooled q0.001–q0.999, tails counted; per-value bins for discrete ≤ 60 values; auto log-y above a 50× peak/median bin ratio), mean/variance/std-dev per class on masked values, and MaxEnt readouts — H, the Gaussian bound H_G, negentropy J, Bhattacharyya D_B on the histograms and between the two Gaussian MaxEnt models, a 20-permutation null, the moment share D_B,gauss/D_B,hist reported only above 2× null, and a disjoint-support leakage flag. Discrete columns get H and D_B only (density vs PMF). `server/eda_api.py`: /api/eda/files, /api/eda/run (job, cached on data/settings/rulings hashes), /api/eda/<region>. **Fixed a mk32 bug:** the section sheets reused the page `.sheet` class, inherited the page frame, and its display:flex beat `hidden` — every stub rendered at once with Information Theory on top. Reset under `#screen-body > .sheet` in hub.css. The unapplied mk45 draft (`EDA_SCOPE_mk1.md`) is superseded. |
| 2026-09-24 | mk46. **Section view:** with a section open the rail and the band fold into one top bar — the TV at half size (click = Home), the section cards as a one-click switcher, page links with Home / Sign out / sound — and the section takes the full width. The deck no longer glides into the dock; it stays on the landing view, and the dock panel is removed. Esc leaves an inner view (the enlarged feature) before it leaves the section. **MaxEnt fits** (`engine/maxent.py`, no Flask): a case per column (binary; integer lattice, PMFs only; density on R, R+, [0, 1]; hurdle when one value holds ≥ 5%), a ladder of constraint sets per case (Gaussian, cubic, quartic, exponential, gamma, lognormal, uniform, beta, geometric, COM-Poisson, discrete Gaussian, an indicator rung for inflation), solved per class by dual Newton on the observed range. Per rung: ll, AIC, BIC, ΔBIC/ΔAIC, left-out information (cross-entropy minus entropy; J on the Gaussian rung), S-vs-B Bhattacharyya. Headline puts each class on its own best rung. Identical rows across rungs are asserted in the tests. The per-card "MaxEnt" readouts are renamed Gaussian reference. **EDA sheet:** search (Enter opens a feature), a MaxEnt line per card, and the enlarged view — S/B with per-mass split, MaxEnt fit per class with a rung selector, log-likelihood ratio (data, fits, Gaussian parabola), CDFs with KS, ladders, descriptive statistics, written findings. `GET /api/eda/<region>/feature?col=` serves it from the loader's frame cache. eda version → eda mk2 (old cache entries are not reused). |
