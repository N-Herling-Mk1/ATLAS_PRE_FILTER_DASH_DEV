# ATLAS-Dashboard-mk_1 — drop mk51: Code Truth panel (cumulative: mk48 + mk49 + mk50 + mk51)

Dev line. This zip holds every file changed since mk47, so it applies cleanly whether or not
mk49 / mk50 were extracted. Restart the server. `apply_mk49.ps1` is superseded: its hashes no
longer match (hub.css, pages.py, test_lock.py, genealogy.html moved on); use `apply_mk51.ps1`.

```
mk51  server\pages.py                              + code-truth tile, EXTERNAL["code-truth"], EMBED_SRC has both sites
mk51  web\templates\sections\_embed.html           NEW  the framed-page sheet, shared, keyed by tile id
mk51  web\templates\sections\_side\_embed.html     NEW  its outline, shared
mk51  web\templates\sections\code-truth.html       NEW  two lines: set key, include
mk51  web\templates\sections\_side\code-truth.html NEW
mk51  web\templates\sections\genealogy.html (+ _side)  now the same two lines
mk51  web\static\public\css\hub.css                full-height rule covers both sheets
mk51  tests\test_lock.py                           both framed pages asserted
mk50  server\serve.py                              dev mode: one port, one banner, one browser tab
mk49  web\static\app\js\hub.js, traces.js, deck.js  see DROP_NOTES_mk49.md
mk48  server\app.py, web\templates\hub.html        unchanged since mk48; included for completeness
```

## Code Truth

New tile after NN Genealogy (11 tiles, cards 6 + 5). Same sheet as genealogy: the live page
`https://n-herling-mk1.github.io/code_truth_genealogy/` framed whole, scaled to fit, links in
a column. Side panel Views: Timeline + the four unit ids from the site's data.js
(dncn_qn_mk1, dnc_flr_mk1 [exp], disco_mk1, bce_mlp_mk1). The CSP frame-src on `/` now lists
both sites and nothing else. The genealogy frame id changed gen-frame -> genealogy-frame.

Adding a third framed site is now: one TILES line, one EXTERNAL entry, add it to EMBED_SRC,
two 2-line templates, one selector in hub.css.

## mk50: dev server

Flask's reloader runs serve.py twice. The child found 5710 held by its own parent, announced
5711 and opened a tab there, where nothing listens: the "page opens then errors" tab. The
parent now hands its port down (PFD_DEV_PORT); the child prints one line and opens nothing.

## Checked here

- Suite: 31 passed, 6 skipped (real-data tests; no data in the sandbox).
- Cards with 11 tiles, both views, 1920 / 1680 / 1366 / 1024 wide: every name inside its card.
- Both framed sheets at 1856x835: no scroll in sheet or page.
- Dev mode run: one banner, 5710 answers, 5711 refuses.

## Not verified — look at these first

- **The Code Truth page height is a guess (1400 px).** The site was unreachable from the
  sandbox for rendering. If the frame shows a scrollbar or a black band at the bottom: open
  the site in its own tab, F12 console, `document.documentElement.scrollHeight`, and put that
  number in `EXTERNAL["code-truth"]["size"]["h"]` in pages.py.
- Code Truth has never been loaded in the frame. Whether its unit hashes (#dncn_qn_mk1 ...)
  switch pages from the side panel depends on that site routing on hashchange.
- The repo link assumes github.com/N-Herling-Mk1/code_truth_genealogy.
- Browser auto-open after the mk50 fix (no browser in the sandbox).
