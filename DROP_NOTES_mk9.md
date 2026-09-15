# ATLAS-Dashboard-mk_1 — drop mk9

Delta drop for `ATLAS_PRE_FILTER_DASH`. Extracts **flat** into the repo root.

```
web\templates\login.html                      rewritten
web\templates\base.html                       title, brand, favicon, arrive.js
web\static\public\css\gate.css                rewritten
web\static\public\css\pfd.css                 + nav brand mark rules
web\static\public\js\gate.js                  rewritten
web\static\public\js\seg7.js                  NEW
web\static\public\js\arrive.js                NEW
web\static\public\assets\images\proton_2.png      NEW (original, 600 px)
web\static\public\assets\images\proton_2_256.png  NEW (the one the pages use)
web\static\public\assets\images\favicon.svg       MOVED from public\img\
server\app.py                                 /favicon.ico path only
docs\STAGE_A_SCOPE_mk2.md                     + mk9 changelog row
apply_mk9.ps1                                 unblock, verify, retire public\img
```

Then:

```powershell
powershell -ExecutionPolicy Bypass -File .\apply_mk9.ps1
```

It Unblock-Files every dropped file, checks each one by marker string (OneDrive
reverts are invisible by size and timestamp), and deletes `web\static\public\img`,
which is now empty of anything referenced.

---

## 1. Name

`ATLAS-Dashboard-mk_1` everywhere the old name appeared: sign-in `<title>` and
headline, dashboard `<title>` (`Run - ATLAS-Dashboard-mk_1`), nav brand, and the
title-block header. `REV mk4` in the title block is untouched — that is the engine
revision, set from `common.js`, not the site name.

## 2. Sign-in plate

- Head reads **Welcome to the gate**.
- The pulsing lamp is replaced by a **padlock**: shut and amber when signed out,
  rattles red on a reject, shackle lifts and swings cyan on success.
- The message strip is replaced by a **seven-segment readout** on a black LED
  panel: `STATUS:SIGNED OUT` → `STATUS:SENDING` → `STATUS:SIGNED IN` or
  `STATUS:REJECTED` (and `STATUS:OFFLINE` if the server does not answer).
  Unlit segments stay visible at 6.5% the way an unlit LED bar does. Letters use
  the honest seven-segment forms (`SIGnEd`, `rEJECtEd`) — that is the display, not
  a typo.
- Under the readout, a small line carries the server's actual reason: *gate
  locked*, *signed out after inactivity*, *password rejected*. The long cookie
  warning still gets its own text box; the two short "Signed out." messages are
  now said by the readout instead of being repeated.
- `setState()` is the only thing that writes the readout, the lock, the plate word
  and the run-block line, so those four cannot drift apart.
- No JavaScript: the form still posts, and a `<noscript>` line states the status.

## 3. Wipe

Success runs a vertical line left→right: hot white core, cyan flare ahead of it,
sparks shed off the edge and trailing back, page dark behind. Navigation fires at
82% so the dashboard is already loading under the cover. The dashboard side
(`arrive.js`) opens under black and sweeps the same line off it — one continuous
wipe across the page change. Keyed to the `?login=1` marker the login route
already sets, runs once, and is skipped under reduced motion.

## 4. Detector

1. **Larger.** `R = min(0.54 H, 0.38 W)` at `cx = 0.72 W`, `cy = 0.52 H`. The
   wheel bleeds off the top and bottom and clears the sign-in plate down to about
   1366 px wide; below that its outer chambers pass behind the plate, as they
   already do behind the title band.
2. **Lighter at rest.** Chambers .06→.15 fill and .50→.78 stroke, tile .05→.10 and
   .16→.30, EM stroke .10→.22, coils .22→.34, solenoid .35→.55. The structure now
   reads as a lit drawing on its own.
3. **Quieter, hotter.** Calorimeter deposits every 2.8–5.6 s (was 1.1–2.4), chamber
   hits every 6–11 s (was 2.6–5.2), cosmics every 26–42 s (was 14–24), each held
   longer. Glow radius up (26 px cells, 34 px chamber hits) plus a white hot edge
   on every hit so it still cuts against the lighter structure.
4. **Pixelated inner detector.** The four ID layers are no longer dashed rings but
   discrete modules — 44 / 64 / 84 / 104 of them — lit by a slow gradient of 3 / 4
   / 5 / 7 lobes with a deterministic per-module jitter, phase alternating
   direction layer to layer. Pixel layers cyan, SCT green, TRT orange. The base
   frame draws the same modules dim, so what you see is an unlit module bed with a
   readout gradient crawling over it.

## 5. Image

`proton_2.png` lives in `web/static/public/assets/images/`, with a 256 px
derivative that the pages actually load (the 600 px original is 400 KB). It sits
top left of the gate with the `UA ATLAS / 13.6 TeV / Run-3` tag beside it, and
above the nav brand on every dashboard page. It is screen-blended under a radial
mask, so the black plate drops out and the edge feathers instead of showing a
square.

---

## Checked here

- `login.html` rendered against all five server messages (none, wrong password,
  signed out, timeout, cookie) — readout text, reason line and message box are
  correct in each.
- `gate.js` + `seg7.js` driven headlessly through both sign-in branches: readout,
  tone class, lock class, plate word and navigation all land right, no console
  errors.
- The detector rendered to PNG at 1600×900 through a real 2D backend (sweep, rest,
  rest at 14 s, LLP event) to check the new size, the lighter structure and the
  pixelated layers.

## Not checked here

No browser was available, so the CSS layout itself is unverified: the mark and
title-band collision at odd widths, the padlock transform, and the readout's fit
in the plate are the things to eyeball first. The phone breakpoint got a
padding-top bump (96 px) to clear the mark — worth a look at ~390 px wide.
