# Play Store assets

Marketing assets for the Google Play listing (not used by the app build).

## feature-graphic.png
- **1024 × 500**, 24-bit PNG, no alpha — meets Play's feature-graphic spec.
- On-brand: app background `#0F1117`, the app icon, the `lifeGLANCE` wordmark
  (`life` in `#E8E0D0`, `GLANCE` in `#9370DB`), the "Your life, at a glance."
  tagline, and a timeline rule with the category-colour dots.
- **Font note:** rendered with IBM Plex Mono as a stand-in. The in-app wordmark
  uses **Courier Prime** — re-render with that font for a pixel-faithful match.

## High-res icon (for Play)
Use `public/icon-512x512.png` (512 × 512). It's 24-bit RGB; if Play's uploader
insists on 32-bit, re-save as RGBA (opaque alpha, no visual change).

## Screenshots (`screenshots/`, generated — gitignored)

Regenerate the full Play Store screenshot set in one command:

```
npm run screenshots
```

That builds the app, serves `dist/` in-process, seeds the demo backup
(`lifeglance-jake-chen-test.json`) straight into IndexedDB, and drives Chromium
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
`/opt/pw-browsers`; elsewhere run `npx playwright install chromium` once and
unset `CHROMIUM_PATH` (the script falls back to Playwright's managed browser).
Run it on a real machine or CI runner — headless browser automation is flaky
inside constrained sandboxes.

