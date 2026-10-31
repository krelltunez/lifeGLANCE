# Store screenshots

Generated. Do not edit these PNGs by hand — regenerate them:

```
npm run screenshots
```

That builds the app, serves `dist/` in-process, seeds the demo backup into
IndexedDB, drives Chromium through every scene, writes the Play frames straight
out, and composes the Apple canvases. Everything is declared in
`scripts/screenshots.mjs` (what to capture) and `scripts/compose-apple-frames.py`
(how the Apple canvases are built). Edit those and re-run.

| Slot | Canvas | Files |
|---|---|---|
| `apple/iphone-dynamic-island/` | 2622 × 1206 landscape | 5 |
| `apple/ipad13/` | 2752 × 2064 landscape | 2 |
| `play/phone/` | 2640 × 1320 landscape | 5 |
| `play/tablet7/` | 1920 × 1200 landscape | 2 |
| `play/tablet10/` | 2560 × 1600 landscape | 2 |

`apple/captions.json` is written alongside the frames and carries the caption
text of each Apple shot, so the listing copy and the images cannot drift apart.

## The iPhone canvas is landscape

App Store Connect retired the 6.9" slot. The iPhone galleries are now **iPhone
with Dynamic Island (medium display)** and **iPhone Duo**, and the first
accepts landscape as well as portrait: 2556 × 1179, 1179 × 2556, 2622 × 1206,
1206 × 2622. We use **2622 × 1206**.

Landscape is not a cosmetic choice — it removes the problem every earlier round
of these frames was fighting. lifeGLANCE is landscape-locked, so a portrait
canvas can only hold the app as a short band, which forced two stacked panes,
which halved the lanes available to the card layout, which made cards collide.
One landscape pane fills a landscape canvas the way the iPad frames always did.
No stacking, no half-height panes, no collisions from either.

### Caption left, pane right

2622 × 1206 is very wide and short. The house layout puts the caption above the
device, which at this aspect squeezes both into nothing, so the phone frames
put the caption in a **column to the left** (`CAPTION_COL`, 1010px) with the
pane bleeding to the top, right and bottom edges. The caption treatment is
otherwise unchanged, and the background glow moves to sit behind it
(`glow_x`). Shot 5's privacy bullets sit under the caption in that column,
beside the dialog rather than below it — there is no below on a 1206px canvas.

The iPad frames keep the caption band above the pane: at 2752 × 2064 there is
room for it, and they were already working.

## Three settings carry these frames

None needs code; all three are ordinary user settings written before the
reload. Each one is load-bearing, and the frames fall apart without it.

- **`lifeglance-clustering = false`.** With clustering on, every wide zoom
  collapses milestones into numbered circles and *no card draws at all* —
  `Timeline.jsx` routes only single-member groups to the card renderer — so the
  frame is an empty axis. This is the binary gate: no amount of density or
  viewport tuning substitutes for it.
- **`lifeglance-text-size = small`.** `CARD_W`, `CARD_H2` and `CARD_STEP` all
  scale off `remPx` (19 at `small` against 22 at `normal`), so one step down
  makes cards narrower *and* shorter — fewer horizontal collisions and an extra
  lane to resolve the rest. The cheapest lever on card pile-up.
- **Viewport height ≤ 900 CSS px.** `Timeline.jsx` flips to `compactLayout` at
  `(max-height: 900px)`, which pins the axis near the bottom and stacks every
  card above it. That is the arrangement these frames want. Within the mode the
  lane count rises with height, so each viewport sits as close to 900 as its
  output aspect allows — 792 bought four lanes, 880 buys six — and
  `deviceScaleFactor` absorbs the difference so output pixels never change.

The trap worth knowing: capture at 792 px and the frames look broken in a way
that reads as a seed problem. It is not. It is compact layout forcing every
card above a bottom-pinned axis with too few lanes to separate them.

## Dialog shots render smaller

A dialog is a fixed width in CSS pixels, so in a 1612px-wide viewport it is a
small box adrift in a dimmed pane. Shots 4 and 5 therefore use narrower CSS
viewports scaled up to the same output pixels (`PHONE_MODAL`, `PHONE_SHEET`),
which makes the dialog the subject. The add sheet is a much longer form than
the on-this-day panel, so it gets more CSS height and slightly less
magnification — otherwise it is cut off at the foot of the pane.

## Why the seed is thinned

The lane algorithm can only offer about six lanes. A ±10 year view of the full
52-milestone seed needs roughly **24** to place its cards without collisions, so
they land on top of each other. Viewport and text size together buy two or three
lanes, not eighteen — thinning is the only lever that closes that gap, and
`KEEP_EVERY = 3` is where the collisions stop.

Three supports around it:

- **`PROTECTED`** — scenes look milestones up by title, so thinning must never
  drop the ones a shot depends on.
- **`EXCLUDE`** — the months either side of today are the seed's busiest stretch
  and several entries there are protected, so one unprotected card landed on its
  neighbours in every wide shot. Dropping it clears the last collision.
- **`HORIZON`** — the thinned timeline otherwise dead-ends in early 2029 with a
  decade of bare axis to its right. Three aspirational entries, deliberately
  unevenly spaced, carry the eye to the edge of the window. They follow threads
  the persona already has rather than inventing a new life.

One density for every gallery, so the past/future counters — which are visible
in the frames — agree across a listing.

The five phone shots use a separate, sparser seed again (`WIDE_TITLES` plus
`WIDE_HORIZON`): about a dozen milestones spread from 1999 to 2049 rather than
bunched in one decade. The three that the on-this-day nudge moves onto today's
date are deliberately among them, because shot 4's button only renders when
some past milestone shares today's month and day.

## Zoom choices

Shot 1 is `30yr` — a *sixty* year window, since a preset names its half-range —
and with the sparse seed and the full landscape width it holds, carrying cards
from 1999 to 2049.

Shot 3 is `30yr` too rather than `months`: the sparse seed's future entries are
years apart, so a narrow window shows an empty axis and the counter alone.

Shot 2 is `years`. Zooming further in makes a single ribbon span the pane, but
it is still a hairline and the rest of the frame empties out; at `years`
several eras are in shot at once with their names and durations on them, which
is what "drawn to scale" means. A ribbon is a thin band by design — this is as
much of a frame as it can honestly be.

### The old portrait note, kept for the record

A preset names its **half**-range, so `30yr` is a *sixty* year window. On a
27-year-old that leaves the outer thirds bare and crushes everything into the
middle, where it piles up no matter how hard the seed is thinned. `years` is
twenty years: it loses the childhood, but it spreads cards across the full width
and the today marker and age readout — the two things that must survive Apple's
thumbnail — are more legible for it.

## House style: no device chrome

lifeGLANCE's frames carry **no bezels, no status bars, no home indicators**, and
no grafted device chrome of any kind. The app surface bleeds to the left and
right canvas edges.

This is a deliberate divergence from the GLANCE screenshot kit, whose framers
float a rendered device on the background and graft a real status bar onto it
from a donor capture. None of that machinery is used here. What *is* taken from
the kit (v2.1) is the part that makes the GLANCE listings look like one family:

- **Design tokens** — background gradient `(14,15,19)` → `(5,5,7)` with a brand
  radial glow screened over it, warm white `(247,245,241)` headline.
- **Brand colour** — lifeGLANCE violet `#8170EE` `(129,112,238)`, in place of
  dayGLANCE's orange.
- **Fonts** — Lora SemiBold and Lora Italic for the headline, DejaVuSans-Bold
  for the eyebrow. Lora is vendored in `scripts/assets/fonts` (SIL OFL).
- **Caption pattern** — tracked all-caps eyebrow in the brand colour, then two
  Lora lines: warm white above, brand-colour italic below, ending in a period.
- **Bullet pattern** — Lora italic, text alternating warm white and brand
  colour, each dot the inverse of its line's text colour, dots centred on the
  line's real ink box.

The kit's background loop is per-pixel Python and costs ~40s on a 2752 × 2064
canvas. It is vectorised with numpy in the compositor; the output is the same.

## Why the iPhone canvas stacks two panes

The app is landscape — it shows a "rotate your device" prompt in portrait — and
Apple's iPhone slot is portrait. One landscape pane on a 1320 × 2868 canvas
would be a thin strip. So each iPhone frame stacks **two** landscape panes, and
the pair is chosen to make one point: shot 1 is the same timeline at decades and
at weeks, shot 2 is chapters wide then one labelled ribbon close up.

Shot 5 is the exception: a single pane, because the privacy bullets take the
lower half.

## The seed is re-dated at run time

The demo backup (`src/demo/lifeglance-jake-chen-test.json`) was authored around a
notional "today" of 12 July 2026, and a timeline seed rots — everything it calls
upcoming becomes past, the future half of the app empties out, and the relative
ages drift. So `redate()` shifts the whole story to run time before seeding.

- A uniform shift in **days**, not years. That keeps every interval, age and
  chapter span exactly as authored, and lands "today" at the same point in the
  story the set was composed around, which is what keeps the timeline busy near
  the today marker. Shifting by whole years would preserve calendar dates but
  leave an eight-month hole either side of today, and every shot looks at today.
- Titles that assert a calendar date (`CALENDAR_LOCKED` — Thanksgiving and
  friends) keep their authored date, because a day shift would put Thanksgiving
  in March. The annual recurrences need no exemption: every instance shifts
  together, so the series stays internally consistent on whatever date it lands.
- Past milestones already within a week of today's anniversary are nudged onto
  it, so the "on this day" button exists at all — it only renders when some past
  milestone shares today's month and day, which would otherwise be a coin flip.

None of this touches the app or the shipped demo file; it happens in memory on
the way into IndexedDB.

## Feature graphic

`play-assets/feature-graphic.png` (Play only) is generated separately by
`npm run feature-graphic`. See `play-assets/README.md`.
