// A small startup log, for launch problems that only show on a user's machine
// (the Windows "installs but never launches" kind). It appends timestamped
// milestones and any load or crash events to a bounded file in userData that a
// user can send after a bad launch. Packaged builds carry no DevTools, so this
// is also where the page's own sync lines land (shell.log).
//
// Best-effort throughout: logging must never throw into the startup path. No
// Electron import, so it is tested as plain file bookkeeping; main.js supplies
// the userData directory. From dayGLANCE's electron/startupLog.ts, by way of
// lastGLANCE's.

import fs from 'node:fs'
import path from 'node:path'

export const STARTUP_LOG_FILENAME = 'lifeglance-startup.log'

// A rolling record of recent launches, not a full trace: a log past this size
// is dropped on the next init, so it never grows without bound.
export const MAX_LOG_BYTES = 256 * 1024

let logPath = null

function stamp() {
  try { return new Date().toISOString() } catch { return '?' }
}

/**
 * Point the logger at <userDataDir>/lifeglance-startup.log and open a new
 * session section. Earlier sessions are kept unless the file has grown past
 * MAX_LOG_BYTES. Returns the path, or null on failure.
 */
export function initStartupLog(userDataDir) {
  try {
    const target = path.join(userDataDir, STARTUP_LOG_FILENAME)
    // A fresh install's first launch: Electron has not created userData yet.
    fs.mkdirSync(userDataDir, { recursive: true })
    let prior = ''
    try {
      if (fs.statSync(target).size <= MAX_LOG_BYTES) prior = fs.readFileSync(target, 'utf-8')
    } catch { /* no log yet */ }
    const header = `\n===== session ${stamp()} platform=${process.platform} pid=${process.pid} =====\n`
    fs.writeFileSync(target, prior + header)
    logPath = target
    return logPath
  } catch {
    logPath = null
    return null
  }
}

/** Append one timestamped line. A no-op until initStartupLog has run. */
export function logStartup(message) {
  if (!logPath) return
  try {
    fs.appendFileSync(logPath, `[${stamp()}] ${message}\n`)
  } catch { /* best-effort */ }
}

/** The active log path, or null. */
export function startupLogPath() {
  return logPath
}

// Test-only: reset module state between cases.
export function __resetStartupLogForTests() {
  logPath = null
}
