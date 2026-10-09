# ATLAS-Dashboard-mk_1 — drop mk48: NN Genealogy panel, cards that fit

Dev line. Restart the server: `pages.py` and `app.py` changed.

```
server\pages.py                              + genealogy tile; EXTERNAL["genealogy"]; EMBED_SRC
server\app.py                                CSP: frame-src = EMBED_SRC on "/", 'none' everywhere else
web\templates\hub.html                       cards get class cols-N (N = half the tile count)
web\templates\sections\genealogy.html        NEW  the genealogy page, framed in the sheet
web\templates\sections\_side\genealogy.html  NEW  outline: Timeline / mk4 / mk3 / mk2 steer the frame
web\static\public\css\hub.css                mk48 block appended: card fit + .embed
tests\test_lock.py                           + test_hub_frames_genealogy_and_nothing_else
```

## NN Genealogy

New tile between Features and Models. Opening it stays inside the dashboard: the sheet frames
`https://n-herling-mk1.github.io/atlas_nn_genealogy/`. Nothing is copied from that repo, so the
sheet always shows what it last built. The frame loads on first open, not with the hub.

- Side panel **Views** change the page inside the frame (hash only, no reload).
  The list is `EXTERNAL["genealogy"]["views"]` in `pages.py`: add a line when mk5 lands.
- **Open in a new tab** and **Repository** leave the dashboard, as on root2csv.
- The frame is sandboxed: scripts, its own origin, downloads, popups. No top navigation.

Why a frame and not a vendored copy: the genealogy `index.html` uses inline script and style,
which this site's CSP (`script-src 'self'; style-src 'self'`) refuses to run.

**Security change, deliberate:** the CSP gains `frame-src`. On `/` it is that one URL; on every
other route, the sign-in page included, it is `'none'`. `X-Frame-Options: DENY` and
`frame-ancestors 'none'` are unchanged, so the dashboard still cannot be framed by anyone.
The genealogy page is public; the frame adds no data path out of the dashboard.

## Cards

Ten names in one row left 70-90 px per card. Landing view spilled words past the card edge;
section view cut them to "Informati...". Now two balanced rows in both views, names wrap at
spaces and are sized from the card's width (container units). Section view drops the glyph
from the cards (it is on the side panel head) so the top bar stays 99-120 px, as before.

## Checked here

- Suite: 31 passed, 6 skipped (real-data tests; no data in the sandbox).
- Chromium at 1920x1080, 1680x980, 1366x768, 1024x800, both views: every card name and glyph
  measured inside its card (before: 1-3 spilling on landing, 2-7 clipped in section view).
- Frame exercised against a local copy of the genealogy `docs/`: loads only on open, fills the
  sheet (1302x610 at 1680x980), Views switch tabs with no reload and no top-level navigation.
- Sign-in page loads with no console errors; `login.html`, `gate.css`, `gate.js` untouched.

## Not verified — look at these first

- **The live github.io URL was never loaded in the frame**: the sandbox cannot reach it.
  First open on your machine is the first real load. If the frame stays black, check the
  browser console for a CSP or X-Frame-Options line.
- A `.txt / .csv / .py` download from inside the sandboxed frame was not clicked.
- Firefox / Edge not run.
