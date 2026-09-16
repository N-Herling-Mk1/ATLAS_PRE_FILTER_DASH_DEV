# ATLAS-Dashboard-mk_1 — drop mk17

Two files plus the changelog. Extracts flat over mk16.

```
web\static\public\css\gate.css    success state goes green
web\static\public\js\gate.js      resting detector muted again
docs\STAGE_A_SCOPE_mk2.md         + mk17 changelog row
apply_mk17.ps1                    unblock + verify by hash
```

```powershell
powershell -ExecutionPolicy Bypass -File .\apply_mk17.ps1
```

## 1. Quieter at rest, same when lit

Only the resting weights moved. Every lit path — the pixel peaks, `glowSpot()`,
the hot white edges, the sign-in event — is byte-for-byte what it was, so the
contrast ratio widens instead of the whole picture dimming.

| resting | mk16 | now |
| --- | --- | --- |
| chamber fill / stroke | .09 / .52 | **.05 / .32** |
| tile fill / stroke | .06 / .20 | **.035 / .12** |
| EM fill / stroke | .02 / .145 | **.012 / .085** |
| coils | .24 | **.15** |
| solenoid | .38 | **.23** |
| ID module bed | .30 | **.18** |
| idle ID gradient | .72 | **.46** |
| coil breathing | .032 + .068 | **.020 + .042** |
| beam pipe | solid | **55%** |

The beam pipe was the one thing still drawn at full strength — it was a single
solid stroke while everything around it came down, so it had started to read as
the brightest resting element. It's at 55% now.

## 2. Success is green

A `--win` token (`#43E08C`) on `body.gate` drives every place the gate says
"open", so they can't drift apart:

- the verdict panel — border, headline, and the LOG IN SUCCESSFUL row
- the plate's left rule and its state word
- the padlock as its shackle springs open

Two things deliberately stay cyan:

- **The detector's LLP hits.** Cyan there is the event display's physics palette
  — it marks displaced-vertex tracklets and muon-chamber hits, and it means the
  same thing whether the password was right or wrong. Recolouring it would make
  a physics channel into a status light.
- **The focus ring** on the sign-in button, so keyboard focus never reads as
  "you're in".

If you meant the arrival wipe as well — the line that sweeps the dashboard open
is still cyan — say so and it's one constant.

## Checked here

Rendered the muted detector with a live chamber hit and the hover probe: the
structure drops well back and the lit sources are untouched, which is the ratio
you asked for. The green is CSS I could not render; `--win` is one line if the
shade is wrong.
