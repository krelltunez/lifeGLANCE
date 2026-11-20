#!/usr/bin/env node
// Write the LIGHT-appearance launch splash: the app icon, unmodified
// (public/icon-master.svg), as iOS shows it on the home screen (corners
// rounded at the app-icon radius), centred on the light theme background
// (#F4EFE4, --bg under [data-theme="light"] in src/index.css). The brand has
// no light artwork, so the icon is used as it is rather than recoloured.
//
// The tile is 820 px of the 2732 px canvas, about two thirds of a phone's
// width, the same as lastGLANCE's light splash. The dark splash draws the mark
// larger (it is this icon at 1200 px with no tile), but a tile that size fills
// the screen edge to edge, and nobody sees the two side by side: the
// appearance does not change during a launch.
//
// Writes assets/splash.png, the @capacitor/assets source for the light splash
// (assets/splash-dark.png stays the dark one), and the three light iOS images
// in Splash.imageset, so the launch screen follows the system appearance
// without re-running the asset generator (which would also rewrite Android).
//
// Usage: node scripts/gen-light-splash.mjs   (run from the repo root)

import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

export const LIGHT_BACKGROUND = '#F4EFE4'
const CANVAS = 2732
const ICON = 820
// iOS app-icon corner radius, as a share of the icon's side.
const RADIUS = ICON * 0.2237

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(resolve(root, 'public/icon-master.svg'))
const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}"><rect width="${ICON}" height="${ICON}" rx="${RADIUS}" ry="${RADIUS}"/></svg>`,
)
const icon = await sharp(svg, { density: (72 * ICON) / 1024 })
  .resize(ICON, ICON)
  .composite([{ input: mask, blend: 'dest-in' }])
  .png()
  .toBuffer()
const offset = Math.round((CANVAS - ICON) / 2)
const splash = await sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: LIGHT_BACKGROUND } })
  .composite([{ input: icon, left: offset, top: offset }])
  .png()
  .toBuffer()

const outputs = [
  'assets/splash.png',
  ...[1, 2, 3].map((n) => `ios/App/App/Assets.xcassets/Splash.imageset/Default@${n}x~universal~anyany.png`),
]
for (const out of outputs) await sharp(splash).toFile(resolve(root, out))
console.log(`light splash: icon ${ICON}px at ${offset} on ${LIGHT_BACKGROUND} -> ${outputs.join(', ')}`)
