#!/usr/bin/env node
// Desktop app icons (docs/desktop-app.md, "Packaging"), rendered from
// public/icon-master.svg into electron/resources/:
//
//   icon-mac.png  1024px, Apple's macOS grid: the full-bleed artwork clipped to
//                 an 824px rounded square, centered on a transparent canvas
//                 with a soft shadow. A full-bleed square, as iOS uses, reads
//                 oversized and unrounded in the Dock next to every other Mac
//                 app.
//   icon.png      1024px, the artwork with rounded corners, for Windows and
//                 Linux, where electron-builder derives the .ico and the
//                 hicolor PNG set from it.
//
// Run after a change to the master icon and commit the output:
//
//   node scripts/gen-desktop-icons.mjs
//
// After lastGLANCE's scripts/gen-desktop-icons.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'electron/resources')
fs.mkdirSync(outDir, { recursive: true })

const CANVAS = 1024
const master = fs.readFileSync(path.join(root, 'public/icon-master.svg'), 'utf-8')
const background = /<rect width="1024" height="1024" fill="(#[0-9a-fA-F]{6})"\/>/.exec(master)?.[1]
if (!background) throw new Error('icon-master.svg: no full-bleed background rect to take the body color from')

// The master as an embeddable <svg>, placed at (offset, offset) at `size`.
function artwork(offset, size) {
  const placed = master
    .replace(/<\?xml[^>]*>/, '')
    .replace(/<svg([^>]*?)\swidth="1024"\sheight="1024"/, `<svg$1 x="${offset}" y="${offset}" width="${size}" height="${size}"`)
  if (placed === master) throw new Error('icon-master.svg: the root <svg> is not the 1024px one this script places')
  return placed
}

// Apple's icon grid: an 824px body on a 1024px canvas, with its corner radius.
const BODY = 824
const OFFSET = (CANVAS - BODY) / 2
const RADIUS = 185.4
const macSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <clipPath id="body"><rect x="${OFFSET}" y="${OFFSET}" width="${BODY}" height="${BODY}" rx="${RADIUS}"/></clipPath>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="${OFFSET}" y="${OFFSET}" width="${BODY}" height="${BODY}" rx="${RADIUS}" fill="${background}" filter="url(#shadow)"/>
  <g clip-path="url(#body)">${artwork(OFFSET, BODY)}</g>
</svg>`

// Windows and Linux: the whole canvas, corners rounded by about 18%.
const ROUND = 184
const plainSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs><clipPath id="body"><rect width="${CANVAS}" height="${CANVAS}" rx="${ROUND}"/></clipPath></defs>
  <g clip-path="url(#body)">${artwork(0, CANVAS)}</g>
</svg>`

await sharp(Buffer.from(macSvg)).png().toFile(path.join(outDir, 'icon-mac.png'))
await sharp(Buffer.from(plainSvg)).png().toFile(path.join(outDir, 'icon.png'))
console.log('Wrote electron/resources/icon-mac.png and icon.png')
