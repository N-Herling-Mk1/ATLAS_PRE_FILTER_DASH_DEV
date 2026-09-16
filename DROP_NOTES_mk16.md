# ATLAS-Dashboard-mk_1 — drop mk16

Extracts flat over mk15.

```
web\templates\login.html          verdict panel gains a bottom row
web\static\public\css\gate.css    Arizona button, centred verdict, bigger mark
web\static\public\js\gate.js      muted structure, bloom, reset on failure
docs\STAGE_A_SCOPE_mk2.md         + mk16 changelog row
apply_mk16.ps1                    unblock + verify by hash
```

```powershell
powershell -ExecutionPolicy Bypass -File .\apply_mk16.ps1
```

Ctrl+F5, then try a **wrong** password first — three of these five only show on
failure.

## 1. Mark

`clamp(120px, 11.5vw, 185px)` → `clamp(130px, 12.6vw, 208px)`, so 208 px at your
width. The band's 34 px top padding from mk15 stays, which is what keeps the
upper-left quark inside the frame; the mark is in the band's flow, so the band
absorbs the extra height rather than anything clipping.

## 2. Arizona button

Cardinal `#AB0520` gradient (lighter at the top, `#8B0419` at the bottom) on a
navy `#0C234B` border, white text, cardinal drop glow. Hover lifts to `#BC0A26`,
active presses to flat `#8B0419` with an inset shadow, focus takes a cyan ring.
The plate's left rule turns cardinal to match, and goes cyan when the gate opens.

Scoped to `.plate-body button.primary` deliberately — the orange `.primary` used
all over the dashboard is untouched. White on cardinal is about 5.9:1, so it
passes contrast.

## 3. Muted at rest, brilliant when lit

Both halves, since contrast is a ratio:

| resting | was | now |
| --- | --- | --- |
| chamber fill / stroke | .15 / .78 | .09 / .52 |
| tile fill / stroke | .10 / .30 | .06 / .20 |
| EM stroke | .22 | .145 |
| coils | .34 | .24 |
| solenoid | .55 | .38 |
| ID module bed | .42 | .30 |
| idle ID gradient | 1.0 | 0.72 |

Everything that lights now also gets `glowSpot()` — one additive radial gradient
per source, composited `lighter` so overlapping sources stack the way light does.
One gradient fill per event is far cheaper than a `shadowBlur` on every pixel
block, which is why the bloom is affordable at all. It's on the at-rest deposits
(peak 1.05 → 1.3, hot edge .5 → .72), the chamber hits, cosmics, the hover probe,
and the sign-in event's muon hits and displaced vertex.

## 4. Failure resets the detector

`resetDetector()` clears the event, drops the cached frame, and replays the
opening sweep — the display comes back up empty, 2.6 s after the verdict. It
doesn't go alone: `setState("out")` takes the console, the lock, the plate word
and the run block back to rest at the same moment, so the whole gate is in one
state rather than a reset detector beside a plate still saying "no LLP detected".

## 5. Verdict at the centre

The panel moves from below the wheel to dead centre — the interaction point,
which is where a verdict about an event belongs — and gains a bottom row:

```
        LLP DETECTED
   MS displaced vertex found.
  ───────────────────────────
     LOG IN SUCCESSFUL
```

tinted cyan on success, red on failure. The old copy carried the outcome in the
subtitle ("Opening the dashboard", "Password rejected"); that's now the bottom
row's job, so the subtitle is trimmed to the physics.

## Checked here

Rendered the muted detector with the hover probe and a live deposit through a
real 2D backend — the contrast pass works, lit sources now read as hot against
a genuinely dark structure. Drove both sign-in branches headlessly: the verdict
row reads "log in successful" / "log in unsuccessful" correctly, and on failure
the console logs the reset and the plate returns to "locked" rather than being
stranded on the rejection.

Not checked: the button's Arizona colours and the centred panel's legibility over
the detector's middle. The panel sits over the inner detector's bright rings, and
88% opacity plus a 3 px backdrop blur is my guess at enough — worth your eye.
