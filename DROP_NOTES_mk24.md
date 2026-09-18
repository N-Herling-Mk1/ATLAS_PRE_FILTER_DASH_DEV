# ATLAS-Dashboard-mk_1 — drop mk24: hub stripped

Extracts flat over mk23. Templates and CSS only — no server restart, Ctrl+F5.

```
web\templates\base.html          rail + title block off on the hub
web\templates\hub.html           console panel out, slot reserved
web\static\public\css\hub.css    single-column frame, visibility fix
docs\STAGE_A_SCOPE_mk2.md        + mk24 changelog row
apply_mk24.ps1                   verify by hash + check other sheets kept theirs
```

## What's gone, and from where

All three are gone **on the hub only**. `/run`, `/board`, `/feature`,
`/catalogue` and `/session` keep the rail, the heading and the title block — they
are guarded with `{% if page != 'hub' %}` in base.html, and the apply script
counts the guards so a half-applied template can't quietly strip every page.

| removed | was |
| --- | --- |
| nav rail | left edge — brand mark, page links, Sign out |
| console panel | left column under the TV |
| title block | bottom right — sheet provenance |

With the rail gone the sheet's frame is a single column on the hub, so the TV now
sits in the page's own top-left corner rather than inboard of a 196 px rail.

The space under the TV is an empty grid slot, reserved. That's where the command
board goes.

**One thing to know:** Sign out and the page links lived in the rail, so the hub
has neither now. Other sheets still have both, and `/run`, `/board`, `/session`
work by URL — but until the command board carries them, the hub is a one-way
door. Say the word if you want a temporary Sign out parked somewhere.

## The bug in your screenshot

The section screen was rendering **under the deck from page load** — that's the
stray em-dash and the empty glyph box you can see below the controls, and the
"Back to deck" link sitting there before anything was opened.

Cause: I hid it with the `hidden` attribute, but also wrote `.screen { display:
grid }`. The cascade resolves **origin before specificity**, and `[hidden] {
display: none }` comes from the *user-agent* stylesheet while my rule is an
*author* rule. Author wins outright — the attribute never stood a chance.

Fixed by driving display from `data-state` on both sides, author-side, so the two
rules are in the same origin and specificity decides:

```css
.hub[data-state="deck"]   .screen    { display: none; }
.hub[data-state="screen"] .deck-wrap { display: none; }
```

The `hidden` attribute stays for assistive tech, but it is no longer what does
the hiding.

**Worth flagging about my testing:** I ran the fix through jsdom with the
stylesheet inlined, and jsdom reported `display: none` for the *broken* CSS too —
it does not model origin precedence, so it would not have caught this and did not
confirm the fix either. The reasoning above is from the cascade spec and your
screenshot, not from a green test. A real browser is the only check that counts
here, which is what you're about to do.

## Checked here

Template renders with no rail, no title block, no console panel, and the reserved
slot present. Hashes in the apply script. The visibility fix is reasoned, not
demonstrated — see above.
