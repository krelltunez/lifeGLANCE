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
