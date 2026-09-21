# ATLAS-Dashboard-mk_1 — drop mk42: the white hover card

**Carries mk41's CSS too**, so it supersedes it — either order, as long as mk42
lands last. CSS + JS, no restart, Ctrl+F5 on `/login`.

## Hover is a different object now

| | resting | hover |
| --- | --- | --- |
| card | translucent state colour | **white** |
| label | state ink, centred | **navy `#0C234B`, right** |
| left of face | — | **the diagram, in ink** |

## The layout does the work the z-index was doing

The diagram is scaled **uniformly** by `FIT = 0.60` into the left of the face
and centred vertically. Its widest element lands at `0.88 × 0.60 = 0.53` of the
width, leaving a clear **0.47** for the label. Uniform, so nothing is squashed;
stroke widths are divided by FIT so they come out the same visual weight they
had at full size.

Because the diagram and the label now occupy **different halves**, they can't
collide. That's a layout fix, and it's stronger than the stacking fix in mk41 —
which is just as well, because mk41's fix would have broken here: it put the
canvas *behind* the button, and you cannot draw through an opaque white card
from behind. `.btn-px` goes back to `z-index: 2`.

So mk41 isn't reverted, it's superseded: its real content — the `color-mix`
removal that made the button readable at all — is carried forward, and the
apply script re-checks it.

## The diagram's colour

Ink on white: lines near-black, beams slightly lighter, blob grey. The S lines
**stay double-dashed** — that's what identifies them as the long-lived scalars —
but they're black now rather than the paper's red, per "diagram to be black". If
you want the red back on white it's one constant (`INK_S`), and it would read
well against white.

## Checked here

Composed the hover state as it will actually render — white card, ink diagram
left, navy label right — and computed the split so the two halves are known not
to overlap rather than assumed not to. The apply script checks the white card,
the left fit, and that `color-mix` hasn't crept back.
