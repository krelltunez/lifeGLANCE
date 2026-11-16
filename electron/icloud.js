// iCloud Drive on macOS (docs/desktop-app.md, "iCloud Drive on macOS"; the
// feature is docs/icloud-sync.md). The renderer runs the iOS tier unchanged
// (the transport, the cycle, the seed guard, the first-run question); this
// supplies the calls the iOS shell implements (ios/App/App/ICloudPlugin.swift),
// over plain files:
//
//   own        ~/Library/Mobile Documents/iCloud~com~lifeglance/Documents
//              lifeglance-sync.json, the timeline
//   dayglance  ~/Library/Mobile Documents/iCloud~com~dayglance/Documents
//              GLANCE/events/, the intents the GLANCE apps exchange
//
// lastGLANCE's electron/icloud.ts, itself dayGLANCE's approach: no helper
// process (a helper would not inherit the iCloud entitlement under the Mac App
// Store sandbox), and the real home recovered from the sandbox's redirected
// one.
//
// The rules, and where they differ from iOS:
//  - Available means the container folder exists. A Mac cannot create the
//    container without Apple's API, so iCloud lights up once the iOS app has
//    created it on this Apple ID. available() is asked every cycle, so it
//    appears by itself when the folder syncs down. Nothing here creates it.
//  - Reads answer the shared classification (absent, downloading, error, text).
//    A cloud-only file is a hidden .name.icloud placeholder (before macOS 14)
//    or a dataless file whose read fetches it (macOS 14 and later). The first
//    reads `downloading`. For the second, an EDEADLK/ETIMEDOUT/EAGAIN while
//    macOS fetches also reads `downloading`, and so does a second read of a
//    file whose first read has not returned, so a stalled fetch never piles up
//    reads.
//  - Freshness: iOS serves a file only once iCloud reports it CURRENT, an
//    answer only Apple's API gives. Here the local bytes are served as they
//    are, and `allowStale` changes nothing. That is safe for this data: every
//    device keeps its own copy and the cycle merges row by row by edit stamp,
//    so reading an older file only means this device catches up on its next
//    cycle. It cannot erase another device's edits.
//  - Writes are in place, never temp-and-rename: a rename replaces the inode
//    and drops the extended attributes that make the iCloud daemon queue the
//    upload. Each write is a full rewrite with fsync; a torn read is classified
//    by the cycle and retried. `atomic` is therefore ignored.
//  - Paths are relative to Documents/ and confined to it, as on iOS.
//
// File access and the download request are injected, so this is tested against
// a temp folder on any OS.

import fs from 'node:fs'
import path from 'node:path'
import { retryTransientFs } from './fsRetry.js'

/** The plugin's container names, as folders under ~/Library/Mobile Documents. */
export const CONTAINERS = Object.freeze({
  own: 'iCloud~com~lifeglance',
  dayglance: 'iCloud~com~dayglance',
})

/** The own container's files whose change on disk runs a cycle. */
export const WATCHED_FILES = new Set(['lifeglance-sync.json'])

export const WRITE_SUPPRESSION_MS = 2000
export const WATCH_DEBOUNCE_MS = 1000
export const WATCH_REATTACH_MS = 5000

export const NO_ICLOUD = 'iCloud not available'

/** The real home, recovered from the Mac App Store sandbox's redirected one (a no-op elsewhere). */
export function realHomeDir(home) {
  return home.replace(/\/Library\/Containers\/[^/]+\/Data$/, '')
}

/** The path's segments, or null for an absolute path or any `..` (ICloudPlugin.segments). */
export function pathSegments(rel) {
  if (typeof rel !== 'string') return null
  if (rel.startsWith('/') || rel.startsWith('\\') || rel.includes(':')) return null
  const out = []
  for (const raw of rel.split(/[/\\]/)) {
    const seg = raw.trim()
    if (!seg || seg === '.') continue
    if (seg === '..') return null
    out.push(seg)
  }
  return out
}

/** Errors macOS raises while it fetches a dataless file: not yet, try again. */
const FETCHING_CODES = new Set(['EDEADLK', 'ETIMEDOUT', 'EAGAIN', 'EBUSY', 'EINTR'])
const messageOf = (e, fallback) => (e instanceof Error ? e.message : fallback)

/**
 * @param {object} deps
 * @param {string} deps.home  app.getPath('home'), possibly sandbox-redirected
 * @param {(absPath: string) => void} [deps.requestDownload]  ask the iCloud daemon to fetch a file (best-effort)
 * @param {() => number} [deps.now]
 */
export function createICloudStore(deps) {
  const now = deps.now ?? Date.now
  const requestDownload = deps.requestDownload ?? (() => {})
  const mobileDocuments = path.join(realHomeDir(deps.home), 'Library', 'Mobile Documents')
  const reading = new Set()
  let lastWriteAt = 0

  const documentsDir = (container) => {
    const key = typeof container === 'string' ? container : 'own'
    return Object.hasOwn(CONTAINERS, key) ? path.join(mobileDocuments, CONTAINERS[key], 'Documents') : null
  }
  const isDir = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }

  /** The file a call names ({ abs }), or why it names none ({ error }). */
  const locate = (rel, container, allowRoot = false) => {
    const docs = documentsDir(container)
    if (!docs || !isDir(docs)) return { error: NO_ICLOUD }
    const segs = pathSegments(rel)
    if (!segs || (segs.length === 0 && !allowRoot)) return { error: 'bad path' }
    return { abs: path.join(docs, ...segs) }
  }

  const placeholderOf = (abs) => path.join(path.dirname(abs), `.${path.basename(abs)}.icloud`)

  return {
    /** @returns {{ available: boolean }} */
    available() {
      const docs = documentsDir('own')
      return { available: !!docs && isDir(docs) }
    },

    /** @returns {Promise<{ kind: 'absent' | 'downloading' } | { kind: 'error', error: string } | { kind: 'text', text: string }>} */
    async readFile(rel, container) {
      const where = locate(rel, container)
      if (where.error) return { kind: 'error', error: where.error }
      const { abs } = where
      if (reading.has(abs)) return { kind: 'downloading' }
      let stat
      try {
        stat = fs.statSync(abs)
      } catch (e) {
        if (e?.code !== 'ENOENT') return { kind: 'downloading' }
        if (fs.existsSync(placeholderOf(abs))) {
          requestDownload(abs)
          return { kind: 'downloading' }
        }
        return { kind: 'absent' }
      }
      if (!stat.isFile()) return { kind: 'error', error: 'not a file' }
      // A zero-length file is mid-write or mid-download, never empty data.
      if (stat.size === 0) return { kind: 'downloading' }
      reading.add(abs)
      try {
        const text = await fs.promises.readFile(abs, 'utf-8')
        return text.length === 0 ? { kind: 'downloading' } : { kind: 'text', text }
      } catch (e) {
        const code = e?.code ?? ''
        if (code === 'ENOENT') return { kind: 'absent' }
        if (FETCHING_CODES.has(code)) {
          requestDownload(abs)
          return { kind: 'downloading' }
        }
        return { kind: 'error', error: messageOf(e, 'unreadable file') }
      } finally {
        reading.delete(abs)
      }
    },

    /** @returns {{ ok: boolean, error?: string }} */
    writeFile(rel, text, container) {
      if (typeof text !== 'string') return { ok: false, error: 'missing text' }
      const where = locate(rel, container)
      if (where.error) return { ok: false, error: where.error }
      try {
        fs.mkdirSync(path.dirname(where.abs), { recursive: true })
        // In place: open without replacing the inode, truncate, write, fsync.
        lastWriteAt = now()
        retryTransientFs(() => {
          const fd = fs.openSync(where.abs, fs.existsSync(where.abs) ? 'r+' : 'w')
          try {
            fs.ftruncateSync(fd, 0)
            fs.writeSync(fd, text, 0, 'utf-8')
            fs.fsyncSync(fd)
          } finally {
            fs.closeSync(fd)
          }
        })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: messageOf(e, 'write failed') }
      }
    },

    /** @returns {{ names: string[] | null }} null when iCloud is away */
    listFiles(rel, container) {
      const where = locate(rel, container, true)
      if (where.error) return { names: null }
      if (!fs.existsSync(where.abs)) return { names: [] }
      try {
        const names = new Set()
        for (const entry of fs.readdirSync(where.abs)) {
          // A cloud-only file is listed by its own name, so a read of it
          // answers `downloading` and the caller waits for it.
          const placeholder = /^\.(.+)\.icloud$/.exec(entry)
          if (placeholder) {
            names.add(placeholder[1])
            requestDownload(path.join(where.abs, placeholder[1]))
          } else if (!entry.startsWith('.')) {
            names.add(entry)
          }
        }
        return { names: [...names] }
      } catch {
        return { names: null }
      }
    },

    /** @returns {{ ok: boolean, error?: string }} */
    deleteFile(rel, container) {
      const where = locate(rel, container)
      if (where.error) return { ok: false, error: where.error }
      try {
        lastWriteAt = now()
        fs.unlinkSync(where.abs)
        return { ok: true }
      } catch (e) {
        return e?.code === 'ENOENT' ? { ok: true } : { ok: false, error: messageOf(e, 'delete failed') }
      }
    },

    /** @returns {{ ok: boolean, error?: string }} */
    makeDir(rel, container) {
      const where = locate(rel, container)
      if (where.error) return { ok: false, error: where.error }
      try {
        fs.mkdirSync(where.abs, { recursive: true })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: messageOf(e, 'mkdir failed') }
      }
    },

    /**
     * Watch the own container for a change to the sync file not made here
     * (debounced, own writes suppressed). Waits for the folder to appear, and
     * re-attaches when iCloud recreates it. Returns the stop function.
     *
     * @param {() => void} onChange
     * @returns {() => void}
     */
    watch(onChange) {
      let watcher = null
      let debounce = null
      let reattach = null
      let stopped = false
      const schedule = () => {
        if (!stopped && !reattach) reattach = setTimeout(() => { reattach = null; attach() }, WATCH_REATTACH_MS)
      }
      const attach = () => {
        if (stopped) return
        const docs = documentsDir('own')
        if (!docs || !isDir(docs)) { schedule(); return }
        try {
          const self = fs.watch(docs, (_event, filename) => {
            const name = String(filename ?? '').replace(/^\.(.+)\.icloud$/, '$1')
            if (!WATCHED_FILES.has(name)) return
            if (now() - lastWriteAt < WRITE_SUPPRESSION_MS) return
            if (debounce) clearTimeout(debounce)
            debounce = setTimeout(() => { debounce = null; if (!stopped) onChange() }, WATCH_DEBOUNCE_MS)
          })
          const lost = () => { if (watcher === self) { watcher = null; schedule() } }
          self.on('error', lost)
          self.on('close', lost)
          watcher = self
        } catch {
          schedule()
        }
      }
      attach()
      return () => {
        stopped = true
        if (debounce) clearTimeout(debounce)
        if (reattach) clearTimeout(reattach)
        const w = watcher
        watcher = null
        try { w?.close() } catch { /* already closed */ }
      }
    },
  }
}
