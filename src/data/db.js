const DB_NAME    = 'lifeglance'
const DB_VERSION = 5          // v5: rename eras store to chapters
const STORE      = 'milestones'
const CHAPTERS   = 'chapters'
const MEDIA      = 'media'

let _db = null

export function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (e) => {
      const db = e.target.result

      // v1 — milestones store (always ensure it exists)
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('date',     'date',     { unique: false })
        store.createIndex('category', 'category', { unique: false })
      }

      // v2 — dedicated blob store for audio attachments
      if (e.oldVersion < 2) {
        db.createObjectStore(MEDIA, { keyPath: 'id' })

        // Strip any legacy audio_uri base64 strings written by v1
        const s = e.target.transaction.objectStore(STORE)
        s.openCursor().onsuccess = ev => {
          const c = ev.target.result
          if (!c) return
          if ('audio_uri' in c.value) {
            const rec = { ...c.value }
            delete rec.audio_uri
            c.update(rec)
          }
          c.continue()
        }
      }

      // v3 — migrate photo_uri base64 strings into the media blob store
      if (e.oldVersion < 3) {
        const mediaStore = e.target.transaction.objectStore(MEDIA)
        const s = e.target.transaction.objectStore(STORE)
        s.openCursor().onsuccess = ev => {
          const c = ev.target.result
          if (!c) return
          const rec = c.value
          if (rec.photo_uri && rec.photo_uri.startsWith('data:')) {
            try {
              const [header, b64] = rec.photo_uri.split(',')
              const mimeType = header.match(/:(.*?);/)[1]
              const raw      = atob(b64)
              const arr      = new Uint8Array(raw.length)
              for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
              const blob = new Blob([arr], { type: mimeType })
              mediaStore.put({ id: `${rec.id}-photo`, blob, mimeType })
            } catch { /* malformed data-URI — skip */ }
            const updated = { ...rec }
            delete updated.photo_uri
            updated.has_photo = true
            c.update(updated)
          } else if ('photo_uri' in rec) {
            const updated = { ...rec }
            delete updated.photo_uri
            c.update(updated)
          }
          c.continue()
        }
      }

      // v4 — mainTimelineVisibility field added to milestones
      // Note: the 'eras' store was also created here originally, but that store name
      // was renamed to 'chapters' in v5. The store creation is handled entirely by the
      // v5 block below for all install paths (fresh install and upgrades alike).
      if (e.oldVersion < 4) {
        const s = e.target.transaction.objectStore(STORE)
        let migratedCount = 0
        s.openCursor().onsuccess = ev => {
          const c = ev.target.result
          if (!c) {
            console.log(`[lifeGLANCE v4 migration] mainTimelineVisibility added to ${migratedCount} milestone(s)`)
            return
          }
          if (!('mainTimelineVisibility' in c.value)) {
            c.update({ ...c.value, mainTimelineVisibility: 'inherit' })
            migratedCount++
          }
          c.continue()
        }
      }

      // v5 — 'chapters' store (renamed from 'eras' in the Chapters feature rename)
      if (e.oldVersion < 5) {
        if (!db.objectStoreNames.contains(CHAPTERS)) {
          db.createObjectStore(CHAPTERS, { keyPath: 'id' })
        }
        // Copy records from legacy 'eras' store for installs upgrading from v4
        if (db.objectStoreNames.contains('eras')) {
          const src  = e.target.transaction.objectStore('eras')
          const dest = e.target.transaction.objectStore(CHAPTERS)
          src.openCursor().onsuccess = ev => {
            const c = ev.target.result
            if (!c) return
            dest.put(c.value)
            c.continue()
          }
        }
      }
    }

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db) }
    req.onerror   = (e) => reject(e.target.error)
  })
}

function tx(mode = 'readonly') {
  return _db.transaction(STORE, mode).objectStore(STORE)
}

function mediaTx(mode = 'readonly') {
  return _db.transaction(MEDIA, mode).objectStore(MEDIA)
}

function chapterTx(mode = 'readonly') {
  return _db.transaction(CHAPTERS, mode).objectStore(CHAPTERS)
}

// ── Milestones ───────────────────────────────────────────────────────────────

export function dbGetAll() {
  return new Promise((resolve, reject) => {
    const req = tx().getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

export function dbAdd(item) {
  return new Promise((resolve, reject) => {
    const req = tx('readwrite').add(item)
    req.onsuccess = () => resolve(item)
    req.onerror   = () => reject(req.error)
  })
}

export function dbPut(item) {
  return new Promise((resolve, reject) => {
    const req = tx('readwrite').put(item)
    req.onsuccess = () => resolve(item)
    req.onerror   = () => reject(req.error)
  })
}

export function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const req = tx('readwrite').delete(id)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

// ── Media (audio / video blobs) ──────────────────────────────────────────────

export function dbPutMedia(id, blob, mimeType) {
  return new Promise((resolve, reject) => {
    const req = mediaTx('readwrite').put({ id, blob, mimeType })
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

// Returns { blob, mimeType } or null if no entry exists for that id.
export function dbGetMedia(id) {
  return new Promise((resolve, reject) => {
    const req = mediaTx().get(id)
    req.onsuccess = () => {
      const rec = req.result
      resolve(rec ? { blob: rec.blob, mimeType: rec.mimeType } : null)
    }
    req.onerror   = () => reject(req.error)
  })
}

// Wipes the entire media store (called on backup restore so orphans don't linger).
export function dbClearAllMedia() {
  return new Promise((resolve, reject) => {
    const req = mediaTx('readwrite').clear()
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

// ── Photos (keyed as `${id}-photo` in the media store) ──────────────────────

export function dbPutPhoto(id, blob, mimeType) {
  return new Promise((resolve, reject) => {
    const req = mediaTx('readwrite').put({ id: `${id}-photo`, blob, mimeType })
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

export function dbGetPhoto(id) {
  return new Promise((resolve, reject) => {
    const req = mediaTx().get(`${id}-photo`)
    req.onsuccess = () => {
      const rec = req.result
      resolve(rec ? { blob: rec.blob, mimeType: rec.mimeType } : null)
    }
    req.onerror   = () => reject(req.error)
  })
}

export function dbDeletePhoto(id) {
  return new Promise((resolve, reject) => {
    const req = mediaTx('readwrite').delete(`${id}-photo`)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

// ── Chapters ─────────────────────────────────────────────────────────────────

export function dbGetAllChapters() {
  return new Promise((resolve, reject) => {
    const req = chapterTx().getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

export function dbGetChapter(id) {
  return new Promise((resolve, reject) => {
    const req = chapterTx().get(id)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror   = () => reject(req.error)
  })
}

export function dbAddChapter(item) {
  return new Promise((resolve, reject) => {
    const req = chapterTx('readwrite').add(item)
    req.onsuccess = () => resolve(item)
    req.onerror   = () => reject(req.error)
  })
}

export function dbPutChapter(item) {
  return new Promise((resolve, reject) => {
    const req = chapterTx('readwrite').put(item)
    req.onsuccess = () => resolve(item)
    req.onerror   = () => reject(req.error)
  })
}

export function dbDeleteChapter(id) {
  return new Promise((resolve, reject) => {
    const req = chapterTx('readwrite').delete(id)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}
