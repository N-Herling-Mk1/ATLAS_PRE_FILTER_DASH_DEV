# ATLAS-Dashboard-mk_1 — drop mk25: hub rebuilt to the site deck

Full repo, extracts flat over your working tree (`.git/` and `.env` are NOT in the
zip, so history and secrets stay put). Templates, CSS, JS and one test — **no
server restart needed**, but Ctrl+F5 is: `/static/public/*` caches.

```
web\templates\hub.html              rail = TV / Navigate / dock; control box under the deck
web\static\public\css\hub.css       cards, glare, placards, gimbal, dock, sound toggle
web\static\app\js\deck.js           rewritten after nathan_herling js/deck.js
web\static\app\js\hub.js            gimbal, dock (FLIP), sound toggle wiring
web\static\app\js\sfx.js            NEW -- synth voices + real mute
tests\test_lock.py                  stale hub assertion fixed (was failing since mk24)
docs\STAGE_A_SCOPE_mk2.md           + mk25 changelog row
apply_mk25.ps1                      verify by hash, unblock, run the tests
```

Run: `powershell -ExecutionPolicy Bypass -File .\apply_mk25.ps1`
Then `git status`: six modified (hub.html, hub.css, deck.js, hub.js, test_lock.py,
STAGE_A_SCOPE_mk2.md) and three new (sfx.js, apply_mk25.ps1, this file). Nothing else.

## What to look at on `/`

| where | what |
| --- | --- |
| top band | Cards are two-line tiles now, bigger and heavier. Selected card: doubled cyan outline, bloom, sheen on the top edge, and a glint that travels the border. |
| stage | The deck is the site's raked carousel: ring tipped -12°, placards upright, index / glyph / name / blurb, only the front face clickable. Placards print in on load. |
| under the deck | The control box from your sketch. **Grab the knob and drag it round** — one full knob turn is one full deck turn, each tick is a section, let go and it snaps. Triangles step. Dial takes arrow keys, Home/End, Enter. |
| left, middle | Navigate: Run, Verdict board, Feature card, Catalogue, Session, Sign out. Speaker top-right of the panel. |
| left, bottom | Dock. Open a section: the deck flies down into it, shrinks and drifts. Click the dock (or Esc, or Back) to bring it back. |

## Sound

The speaker is the site's `#sndToggle` markup and states, on the dashboard cyan.
Difference from the site: **it's a real mute.** On nathanherling.com it gates only
the hover bed; here off means every cue is silent. The setting persists
(`localStorage["pfd.sound"]`); if it's on, audio arms on your first click or key.

Cues: a detent click for every face the deck passes (drag, gimbal or step), a tick
on card select, a thunk on dock/undock. All synthesized — no audio files, and the
site's 144 KB `sfxdata.js` was not carried over.

## Bugs fixed on the way

- **Ghosted front face.** mk23's depth-dim measured distance from the front
  backwards: the front placard got the 0.22 opacity floor and the one directly
  behind got full opacity. That's the washed-out "Models" face in your screenshot.
- **`--win` undefined on the hub.** It only existed in gate.css, so the old
  selected-card and front-face colours resolved to nothing.
- **`test_pages_render_logged_in` failing since mk24.** It asserted the title block
  on `/`, which mk24 removed on purpose. It now checks the hub's own landmarks and
  that the title block is absent. Suite: 21 passed, 4 skipped (real-data).

## Cleanup when you're happy

```
Remove-Item apply_mk23.ps1, apply_mk24.ps1, apply_mk25.ps1, DROP_NOTES_mk23.md, DROP_NOTES_mk24.md, DROP_NOTES_mk25.md
```
