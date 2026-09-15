# ATLAS-Dashboard-mk_1 — drop mk15

Two files plus the changelog. Extracts flat over mk14.

```
web\static\public\css\gate.css      jiggle removed, band nudged down
web\static\public\js\crt_mark.js    slower loop
docs\STAGE_A_SCOPE_mk2.md           + mk15 changelog row
apply_mk15.ps1                      unblock + verify by hash
```

```powershell
powershell -ExecutionPolicy Bypass -File .\apply_mk15.ps1
```

## 1 & 2. Loop timing

| phase | was | now |
| --- | --- | --- |
| proton mark | 4.2 s | **9 s** |
| scramble | 0.9 s | **1.8 s** |
| 13.6 TeV | 2.6 s | **6 s** |
| scramble back | 0.9 s | **1.8 s** |
| round trip | 8.6 s | **18.6 s** |

One thing had to change with them. Each cell's noise window was 42% of the
scramble; at 1.8 s that would be 756 ms of static per cell, and with starts
spread over only the first 58% the whole grid would be in static at once — a
flicker, not a sweep. So the start spread widens to 72% and each cell's window
shortens to 28%. Net effect: the dissolve takes twice as long and still travels
across the grid rather than flashing.

Both numbers are at the top of `crt_mark.js` (`HOLD_A`, `MORPH`, `HOLD_B`) if you
want to push them further.

## 3. The jiggle

That was `crt-hold` — a vertical-hold slip I added in mk11, translating the whole
screen 4 px up and 3 px down every 13 seconds. It's removed outright, keyframes
and all. The other three cathode effects stay: scanline drift, the roll band, and
the brightness flicker. If something still moves that shouldn't, the roll band is
the next suspect.

## 4. The mark

Title band's top padding 16 → 34 px, which moves the mark (and the title with it)
down 18 px so the upper-left quark clears the frame edge. The band grows by the
same amount, so the plate follows it down.

I nudged the whole band rather than the mark alone — offsetting just the mark
would leave it hanging below the title's optical centre, and the band is what
defines the top edge anyway. If 18 px isn't enough, that one number is the knob.

## Checked here

Ran the retuned loop headlessly and captured four points — mark, early dissolve,
full static, settled text — to confirm the sweep still reads at the longer
duration. `crt-hold` is gone from the stylesheet; the apply script re-checks that
for you. The 34 px is a considered guess, not a measurement: I have no browser
here and was working from your screenshot.
