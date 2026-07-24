# Play Store assets

Marketing assets for the Google Play listing (not used by the app build).

## feature-graphic.png
- **1024 × 500**, 24-bit PNG, no alpha — meets Play's feature-graphic spec.
- The app's logo lockup on a `#0F1117` background: the icon motif on the left,
  then the `lifeGLANCE` wordmark (`life` in `#E8E0D0`, `GLANCE` in bold italic
  `#9370DB`) with the "Your life, at a glance." tagline beneath it — mirroring
  the in-app logo.
- **Generated**, not hand-made: run `npm run feature-graphic` to (re)render it
  from `scripts/feature-graphic.mjs`. It uses **Courier Prime** — the app's real
  wordmark font, vendored under `scripts/assets/fonts` (SIL OFL) and embedded, so
  it needs no network — and hard-fails unless that font actually rendered, so the
  wordmark can never silently regress to a substitute. Edit the layout/colours in
  that script and re-run to change the banner. Output is 24-bit RGB, no alpha.

## High-res icon (for Play)
Use `public/icon-512x512.png` (512 × 512). It's 24-bit RGB; if Play's uploader
insists on 32-bit, re-save as RGBA (opaque alpha, no visual change).

## Screenshots (`screenshots/`)

The committed set is the current Play Store upload. Regenerate it in one command
after UI changes:

```
npm run screenshots
```

That builds the app, serves `dist/` in-process, seeds the demo backup
(`src/demo/lifeglance-jake-chen-test.json`) straight into IndexedDB, and drives Chromium
via Playwright to capture each scene at each device into
`play-assets/screenshots/<device>/`. Everything is declared in
`scripts/screenshots.mjs` — edit `DEVICES` / `SCENES` there and re-run to change
the set.

lifeGLANCE is a **landscape** app, so all shots are landscape.

**Devices** (CSS viewport → output px; all ≤ 3840 px, ratio ≤ 2:1 per Play):
| device    | output px    | Play slot       |
| --------- | ------------ | --------------- |
| phone     | 1920 × 1080  | Phone           |
| tablet7   | 1920 × 1200  | 7-inch tablet   |
| tablet10  | 2560 × 1600  | 10-inch tablet  |

**Scenes**: `timeline` (hero), `milestone-detail`, `add-milestone`, `filter`,
`settings` — phone gets all five; tablets get `timeline` + one more each.

**Requirements**: Playwright's Chromium. This repo's CI image ships it at
`/opt/pw-browsers` (the script's default `CHROMIUM_PATH`); elsewhere run
`npx playwright install chromium` once and unset `CHROMIUM_PATH` so the script
uses Playwright's managed browser.

