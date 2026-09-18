# ATLAS-Dashboard-mk_1 — drop mk23: hub layout + rotating deck

Extracts flat over mk22. Templates and static only — **no server restart**, just
Ctrl+F5.

```
web\templates\hub.html                            relaid
web\static\public\css\hub.css                     relaid
web\static\app\js\hub.js                          rewritten
web\static\app\js\deck.js                         NEW
web\static\public\assets\images\proton_2_256.png  RESTORED (see below)
docs\STAGE_A_SCOPE_mk2.md                         + mk23 changelog row
apply_mk23.ps1                                    verify + check referenced marks
```

## A bug in the repo you sent

`proton_2_256.png` is gone — it was **renamed to `image_4.png`** when you added
the TV pictures (identical bytes, I checked the hash). Both `login.html` and
`base.html` reference it, so the gate's proton mark and the nav brand mark are
currently 404 on every page load.

The file is restored in this drop. `image_4.png` stays where it is — it's a
perfectly good TV picture, it just can't also be the mark. `apply_mk23.ps1` now
checks every referenced image exists, so this can't happen silently again.

## 1. Three sets

```
┌──────────┬──────────────────────────────┐
│          │  BAND — small cards          │
│   RAIL   ├──────────────────────────────┤
│  TV      │                              │
│  console │  STAGE — deck, or a section  │
│          │                              │
└──────────┴──────────────────────────────┘
```

The rail is a **set**: two slots that belong together and never change, whatever
the stage is doing. The band and the stage are the parts that swap.

## 2. Small cards

Glyph plus name on one line, wrapping inline — seven of them take one or two
rows instead of a grid of paragraph blocks. The blurb moved to the `title`
attribute and to the deck face, which has room for it.

## 3. The deck

**CSS 3D, not three.js — deliberately.** Three reasons, in order of how much
they matter:

1. The app's CSP is `script-src 'self'` and no renderer is vendored. A CDN
   three.js is blocked outright; it would silently not run.
2. Your personal site's deck is CSS 3D for the same reason — this is a port of
   that pattern, not a new one.
3. Nothing here needs a renderer. Seven flat faces on a cylinder is a transform
   per face.

`deck.js` is standalone — `Deck.mount(el, {faces, onSelect, onOpen})` — so it can
be reused on the section sheets later.

Radius is computed, not guessed: `R = max(0.82w, w·GAP / (2·tan(π/N)))`. The
second term keeps a gap of `GAP·w` between face centres, so faces don't overlap
as the section count grows; the floor stops small N from collapsing onto the
camera. Add an eighth section and it re-spaces itself.

Controls: **drag** it (pointer capture, inertia, snaps to the nearest face),
**prev/next**, **arrow keys**, or click a card. `select()` always turns the
shortest way — last face to first is one step forward, not six back.

**Card selects, face opens.** That split is what lets the band stay put while the
stage swaps: you never lose the selector in order to open something. Open also
via the Open button, Enter on the deck, or double-clicking a card. Escape or Back
returns.

## A bug the test caught

The deck's throw velocity was unbounded. Coast distance is `vel / (1 - friction)`,
so at my first numbers (18°/frame, 0.94) a flick travelled **300°** — most of a
full turn, landing somewhere unrelated to the gesture. It's clamped to 7°/frame
at 0.90 friction now: about 70° of coast, a face and a half. Those two constants
are one decision and they're commented as such at the top of `deck.js`.

## Checked here

Rendered the template, then drove it headlessly: seven faces built with correct
cylinder transforms, next/prev, a card click selecting without opening, a click
on the front face opening, Back, and a pointer drag landing two faces along in
the direction of the gesture. Six TV sources found, CH 01 up. No console errors.

Not checked: the CSS. The deck's perspective and face size at your window is the
thing to look at first — `perspective` is set from the computed radius, so if it
reads too flat or too fish-eyed, the `3.2` multiplier in `deck.js layout()` is
the knob.
