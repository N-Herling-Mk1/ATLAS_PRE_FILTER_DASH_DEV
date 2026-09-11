> Superseded by STAGE_A_SCOPE_mk2.md (2026-09-11). Kept for the record.

# ATLAS_PRE_FILTER_DASH — Stage A Scope (mk1)

**Repo:** github.com/N-Herling-Mk1/ATLAS_PRE_FILTER_DASH (private)
**Date:** 2026-09-10
**Status:** LOCKED on sign-off. This is the drift-protection reference: if an
implementation disagrees with this document, the implementation is wrong, or this
document is revised with a dated entry in §18.

**Lineage:** consolidates the July 2026 NN-vet hygiene gates (G1–G5) and the
August 2026 scan-layer spec (`preprocessing_scan_layer_mk1.md`,
`model_selection_criteria_mk1.md`). Everything is rebuilt; no code is carried
over unexamined.

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
| known limits | No per-person revoke. No audit of who did what. TLS terminates at Cloudflare, so Cloudflare can see traffic in transit. |
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
| S1 typing | continuous / integer / binary / categorical | Sets the S11 family menu; integer columns never get Gaussian/exponential fits. |
| S2 sentinels & missingness | NaN, ±inf, −999, candidate point masses, padding, column absent from a file | −1 is **not** a global sentinel; it is legal in signed columns. Candidates are reported, then ruled per column in the adjudication table. Class: CLEAN ≤ 0.5% invalid / MASKABLE ≤ 50% / UNUSABLE > 50%. |
| S3 dead columns | constant, near-constant, constant in one sample only | Near-constant: top-value share > 99.9%. Constant in one sample only is also passed to S13. |
| S4 cardinality | integer / low-cardinality columns | Dequantization candidates; feeds S1 and S11. |
| S5 value inflation | spikes at 0 or any value; tie fraction | Spike: any single value holding ≥ 1% of entries, reported with its share. The tie fraction bounds S9's achievable entropy. |
| S13 leakage | target and provenance leakage | Value-AUC ≥ 0.995 or NaN-pattern AUC ≥ 0.95 → exclusion candidate. Data-vs-MC comparability check. Known exclusions (MET: `htmiss_NOSYS`, `met_met_NOSYS`) are carried as exclusion_reason. Preprocessing leakage is a training-code invariant and out of scope here. |

### 8.3 Describe (masked values only)

| scan | output | rule |
|---|---|---|
| S6 stats & tails | stats table | mean, sd, median, MAD, skew, excess kurtosis, **L-skew, L-kurtosis** (robust pair), tail mass share (§8.6). |
| S7 histograms & box plots | figures | Background vs each mass point, per region. Box plots are annotated or suppressed when S5 fires, because IQR = 0 turns every non-spike value into an "outlier". |
| S8 outliers | per-column flags | Values outside the catalogue's expected range. |
| S10 multimodality | screening flags | Hartigan dip test **and** GMM ΔBIC, reported together; never a verdict. Run **per mass point**, because pooled signal is a mixture of four masses by construction. |
| S11 shape fits | Akaike weight vector | Family menu gated by S1. MLE per family; AIC primary, BIC alongside, AICc when n/k < 40. KS / AD / CvM / W₁ are reported as **distances, not tests**: parameters fitted on the same sample invalidate KS p-values, and at n ≈ 25k every family is rejected. Each candidate family is propagated to N_A, and the spread is reported as a systematic. |

### 8.4 Separate

| scan | output | rule |
|---|---|---|
| S12 separation | per-feature table | AUC, KS D, debiased MI, Bhattacharyya coefficient, JS divergence, W₁, Fisher ratio. Binned metrics use a fixed grid recorded in the manifest. **Disagreement flag:** high MI with AUC ≈ 0.5 means non-monotone separation (a network can use it; a cut cannot). Any single-feature AUC ≥ 0.99 is a provenance flag, not a discovery. Everything is labelled **MC-sig vs data-bkg**. |
| S15 stability | long table + heatmap | Every S12 metric per (region × mass point), each with a bootstrap 95% CI. **Single-mass separator** only if the CIs at different mass points do not overlap. Slices with very wide CIs are greyed as `LOW-N` rather than using a hard minimum n. |

### 8.5 Structure and transform

| scan | output | rule |
|---|---|---|
| S14 correlation | matrices | Pearson, Spearman, and dCor, computed **separately** on signal and background, plus a sig − bkg difference map. |
| S14 duplication | blocks | Groups of near-duplicate columns (default \|Spearman\| ≥ 0.95 in both samples), then **block reduction**. Resolves LOO's blind spot: duplicated features each look droppable alone and are not droppable together. |
| S14 conditioning | condition number | On standardized columns, per net (NN1 block, NN2 block, union), per region. Flag > 30 (Belsley–Kuh–Welsch). |
| S14.5 cross-block dCor | split design score | dCor between the NN1 and NN2 feature blocks **in background**, per region, with a permutation null. This is the pre-training ABCD independence predictor, and the only scan that speaks directly to closure. |
| S9 span audit | score per column × scaler | Realised fraction = delivered ÷ achievable entropy on a fixed 256-bin grid. Flag when realised_frac < 0.5. The entropy ladder visual. The only scan that reads transformed values. |

### 8.6 Tail mass (resolved 2026-09-10)

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

Within B, the scan order is: S1–S5 → S13 → S14.5 → S6/S7/S8/S12 → S15 → S9 →
S10/S11.

---

## 17. Open items (non-blocking; checked at build time)

- `fg_select --drop-file` format: read from `patch_mk2c.py` (Sep 7–8) so the export matches its parser exactly.
- Domain state: whether nth-atlas-llp.com is registered and in the Cloudflare zone.
- Data governance: confirm with Prof. Johns that derived results served over a Cloudflare-terminated tunnel are acceptable.
- Passphrase: Steve chooses it at `set_password` time (5+ random words).

---

## 18. Revision log

| date | change |
|---|---|
| 2026-09-10 | mk1 created. Decisions locked this session: no synthetic data (canon); private repo ATLAS_PRE_FILTER_DASH; minimal shared-password lock with no users and no lockout; 8 h inactivity timeout; multi-user via waitress + job queue (Cloudflare 100 s limit makes jobs mandatory); user-owned session SAVE / LOAD bundles; feature catalogue lives on the site with immutable versions and exports to the pipeline; catalogue store outside OneDrive; tail mass = robust-fence ratio against a Gaussian reference; stability by bootstrap-CI overlap instead of a minimum n; canaries from a signed-off first real load; barrel count reconciliation deferred to first load; combo generator retired; KS demoted to a distance in S11; S13 ordered before S12. |
