#!/usr/bin/env node
// Run capacitor-assets while protecting ios/App/App.xcodeproj/project.pbxproj.
//
// @capacitor/assets loads the Xcode project through the legacy `xcode` parser
// (via @trapezedev/project) and re-serializes it on save, even though asset
// generation only ever writes into Assets.xcassets / android res. The rewrite
// reformats the file — which predates Xcode's synchronized-folder project
// format — leaving a pointless uncommitted diff that turns into merge/stash
// conflicts and corrupts the project (Xcode: "damaged and cannot be opened").
//
// This wrapper snapshots the pbxproj, runs the generator with the CLI args
// passed through (e.g. --android --ios), and restores the snapshot
// byte-for-byte afterwards.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pbxPath = resolve(root, 'ios/App/App.xcodeproj/project.pbxproj')
const snapshot = readFileSync(pbxPath)

const require = createRequire(import.meta.url)
const bin = require.resolve('@capacitor/assets/bin/capacitor-assets')
const result = spawnSync(process.execPath, [bin, 'generate', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
})

if (!snapshot.equals(readFileSync(pbxPath))) {
  writeFileSync(pbxPath, snapshot)
  console.log('[generate-assets] restored project.pbxproj (asset generation must not rewrite it)')
}

process.exit(result.status ?? 1)
