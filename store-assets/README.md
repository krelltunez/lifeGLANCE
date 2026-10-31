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
| `apple/iphone69/` | 1320 × 2868 portrait | 5 |
| `apple/ipad13/` | 2752 × 2064 landscape | 2 |
| `play/phone/` | 1920 × 1080 landscape | 5 |
| `play/tablet7/` | 1920 × 1200 landscape | 2 |
| `play/tablet10/` | 2560 × 1600 landscape | 2 |

`apple/captions.json` is written alongside the frames and carries the caption
text of each Apple shot, so the listing copy and the images cannot drift apart.

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
