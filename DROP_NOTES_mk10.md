# ATLAS-Dashboard-mk_1 — drop mk10

Delta drop. Extracts **flat** into the repo root, over mk9.

```
web\templates\login.html            CRT markup replaces the readout block
web\static\public\css\gate.css      cathode screen; plate moved up and left
web\static\public\js\crt.js         NEW
web\static\public\js\gate.js        pixel gradients, hover probe, CRT wiring
docs\STAGE_A_SCOPE_mk2.md           + mk10 changelog row
apply_mk10.ps1                      unblock, verify by hash, retire seg7.js
```

```powershell
powershell -ExecutionPolicy Bypass -File .\apply_mk10.ps1
```

Then **hard-reload** the gate (Ctrl+F5). Flask reloads templates and Python on
save; it does not reload your browser's copy of `gate.js` or `gate.css`, and
`/static/public/*` is the one path served without `no-store`.

---

## 1. Cathode console

`seg7.js` is gone. In its place, a small terminal screen: lines type on at ~11 ms
a character, older lines scroll off the top, a block cursor sits at the end of the
last line. Scanlines, a faint shadow mask and a vignette sit over curved phosphor.

Boot:

```
pfd gate // ATLAS-Dashboard-mk_1
link ........ up
detector .... r-phi view ready
last ........ 8 h inactivity        (only if the server sent a reason)
STATUS: SIGNED OUT
```

Sign in appends `> auth: sending`, `trigger ..... fired`, then either
`trigger ..... LLP` / `vertex ...... MS displaced` / `STATUS: SIGNED IN` /
`opening dashboard ...` or `trigger ..... no LLP` / `vertex ...... none` /
`STATUS: REJECTED`. Screen tone follows the state: amber idle, cyan while
checking and when open, red on reject. The wipe now waits 1.5 s instead of 0.9 s
so the console finishes typing before the page goes.

Lines queue, so nothing is lost if two states land close together. Reduced motion
prints instantly and does not blink.

## 2. Plate position

Up and left: `align-items: center` → `flex-start`, top pad 24 px → 10 px, left pad
7vw → 2.4vw. The run block at bottom left moved to 2.4vw too so the two stay on
one edge.

## 3. Pixel gradients — second pass

The first attempt only pixelated the inner-detector modules, and the gradient was
smooth, which is why it did not read. This pass makes it the general fill for
**anything that lights up**: a grid of blocks whose alpha falls off from a source
point and is then **quantised to five levels**, with a per-block jitter so the
bands do not look like contour lines. The quantisation is the whole effect —
without it you just get a glow.

Applied to: at-rest calorimeter deposits (blooming out from the centre of the
cell), chamber hits, cosmic-muon chamber crossings, and everything the hover
lights. Block size is 7 CSS px; both knobs are at the top of the primitives block
in `gate.js` (`PXS`, `QSTEPS`) if you want it chunkier or smoother.

## 4. Hover probe

The pointer identifies what is under it by radius — beam pipe, the four ID layers,
solenoid, EM, tile, the three muon stations, toroid coils — then lights that
component and its neighbours in the same pixel gradient, centred on the cursor,
with the name in a label beside the pointer. Reach is 0.20 R, so it falls off
within about a fifth of the wheel.

The canvas stays `pointer-events: none` and positions come from a window
`mousemove`, so nothing above it (the plate, the password field) is affected. Off
under reduced motion. The cursor becomes a crosshair while over a component.

---

## Checked here

- Rendered the detector to PNG at 1600×900 through a real 2D backend with the
  pointer parked on the tile, a muon station, an ID layer, the coils and the EM —
  the gradient steps and the labels are correct in each.
- Drove both sign-in branches headlessly: boot lines, the appended lines, screen
  tone, plate word, reason line and lock class all land right, no console errors.

## Not checked here

No browser, so the CRT's own styling is unverified — the screen's fixed height
(7.6 em, about five lines) and whether the scanline and vignette read at your
size are the first things to look at. Hover cost is also untested on real
hardware: it redraws up to a few hundred blocks per frame at 30 fps, which should
be nothing, but if the fan spins up, raise `PXS`.
