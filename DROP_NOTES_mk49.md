# ATLAS-Dashboard-mk_1 — drop mk49: scaled genealogy frame, glare, tap-to-open

Dev line, on top of mk48. Restart the server (`pages.py` changed), then Ctrl+F5.

```
server\pages.py                        + EXTERNAL["genealogy"]["size"] (the page's full size)
web\templates\sections\genealogy.html  frame left, links in a column beside it
web\static\public\css\hub.css          .embed block rewritten (mk48 card block untouched)
web\static\app\js\hub.js               frame fit; buttons glare-only; bigger segue
web\static\app\js\traces.js            new fire() options: tracks, grow, glare
web\static\app\js\deck.js              tap on the front placard opens it
tests\test_lock.py                     frame carries data-vw / data-vh
```

## Genealogy frame

Shown whole and scaled down instead of full width with a scrollbar. The frame is laid out at
1160 x 1200 (the timeline's full size) and scaled to the height the sheet has, so the timeline
never scrolls and the dashboard page never scrolls. It is still the live page: tabs, entries
and downloads click through. Links moved to a column on the right.

- The size is `EXTERNAL["genealogy"]["size"]` in `pages.py`. The page is another origin, so it
  cannot be measured from here: **raise "h" when the timeline grows** (a new mk adds ~250 px).
- The mk pages are taller than the timeline (mk4: ~1770 px) and scroll inside the frame.

## Effects

1. Buttons (prev / next / Open): no circuit tracks. The green glare off the four sides stays.
2. Section segue: box is half again larger per side (clamped to the stage), glare is 1.9x and
   reaches 190 px, plus one horizontal and one vertical streak through the box. Tracks kept.
3. Open: the Open button already worked. **Clicking the front placard never did**: the deck
   captures the pointer on press, and a captured pointer's click goes to the deck, not the
   placard, so the placard's click listener was dead code for the mouse. A press-and-release
   on the front placard with under 6 px of travel now opens it; a drag still turns the deck.

## Checked here

- Suite: 31 passed, 6 skipped (real-data tests; no data in the sandbox).
- Chromium: tap front placard -> opens; 60 px drag across it -> turns, does not open; Open
  button -> opens. No console errors.
- Frame at 1856x835, 1920x1080, 1680x980, 1366x768, 1024x800 against a local copy of the
  genealogy docs/: timeline fully visible, no scroll in the frame, the sheet, or the page.
  Scale runs 0.37 (1366x768) to 0.64 (1920x1080); 0.42 at your 1856x835 window.

## Not verified

- Still not loaded from the real github.io URL here (sandbox cannot reach it). You have.
- At 1366x768 the scale is 0.37: body text in the frame is about 5 px. Legible as a map of
  the page, not for reading. The fix for that belongs in the genealogy repo (a compact
  header for framed use), not here.
- Touch input, Firefox, Edge.
