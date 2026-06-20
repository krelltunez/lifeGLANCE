#!/usr/bin/env node
// Sync the iOS marketing version (CFBundleShortVersionString) with package.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
const pbxPath = resolve(root, 'ios/App/App.xcodeproj/project.pbxproj')

const pbx = readFileSync(pbxPath, 'utf8')
const updated = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)

if (updated === pbx) {
  console.log(`iOS MARKETING_VERSION already ${version} (no change)`)
} else {
  writeFileSync(pbxPath, updated)
  console.log(`iOS MARKETING_VERSION -> ${version}`)
}
