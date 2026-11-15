#!/usr/bin/env node
// The desktop app's dev loop (docs/desktop-app.md, "Running it"):
//
//   npm run dev:electron
//
// Starts Vite in `electron` mode on a fixed port (HMR for the page) and
// Electron pointed at it. The main process is plain ES modules with no compile
// step: after a change under electron/, stop this and run it again. Closing
// the app window stops both.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const PORT = 5184 // main.js's default VITE_DEV_SERVER_URL
const url = `http://localhost:${PORT}`

const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
const vite = spawn(process.execPath, [viteBin, '--mode', 'electron', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'inherit' })

let electron = null
let stopping = false
function stop(code) {
  if (stopping) return
  stopping = true
  for (const child of [vite, electron]) {
    if (child && child.exitCode === null) child.kill()
  }
  process.exitCode = code ?? 0
}
vite.on('exit', (code) => stop(code))
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

// Electron starts once Vite answers, so its first load is the app, not a
// refused connection.
async function viteIsUp() {
  for (let i = 0; i < 150 && !stopping; i++) {
    try {
      await fetch(url)
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  return false
}

if (await viteIsUp()) {
  // The `electron` package's export, required from Node, is the binary's path.
  electron = spawn(require('electron'), ['.', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  })
  electron.on('exit', (code) => stop(code))
} else if (!stopping) {
  console.error(`Vite did not come up on ${url}`)
  stop(1)
}
