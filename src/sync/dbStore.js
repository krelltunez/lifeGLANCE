// Real-device `store` for the GLANCEvault row adapter (Stage 2 Part B).
//
// Backs makeDbAdapter's store interface with lifeGLANCE's actual persistence:
// milestones/chapters in IndexedDB (db.js), the singleton bundles in
// localStorage. Bundle WRITES here go straight to localStorage and deliberately
// do NOT call saveCategories() / stamp a fresh timestamp — the merged bundle
// already carries the correct merged timestamp, and re-stamping or re-marking
// dirty would defeat LWW and create push loops. (saveCategories, used by the UI
// for LOCAL edits, is where markDirty fires instead — see dirty.js.)

import {
  dbGet, dbPut, dbDelete, dbGetAll,
  dbGetChapter, dbPutChapter, dbDeleteChapter, dbGetAllChapters,
} from '../data/db.js'

const CAT_KEY      = 'lifeglance-categories'
const CAT_TS_KEY   = 'lifeglance-categories-updated-at'
const BDAY_KEY     = 'lifeglance-birthday'
const BDAY_TS_KEY  = 'lifeglance-birthday-updated-at'
const MTOMB_KEY    = 'lifeglance-milestone-tombstones'
const CTOMB_KEY    = 'lifeglance-chapter-tombstones'

const readJSON = (key, fallback) => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback }
  catch { return fallback }
}

export function makeRealStore() {
  return {
    milestones: {
      get: (id) => dbGet(id),
      put: (m) => dbPut(m),
      delete: (id) => dbDelete(id),
      all: () => dbGetAll(),
    },
    chapters: {
      get: (id) => dbGetChapter(id),
      put: (c) => dbPutChapter(c),
      delete: (id) => dbDeleteChapter(id),
      all: () => dbGetAllChapters(),
    },
    getBundle: (kind) => {
      switch (kind) {
        case 'categories':          return { value: readJSON(CAT_KEY, []), updatedAt: localStorage.getItem(CAT_TS_KEY) || '' }
        case 'birthday':            return { value: localStorage.getItem(BDAY_KEY) || '', updatedAt: localStorage.getItem(BDAY_TS_KEY) || '' }
        case 'milestoneTombstones': return { value: readJSON(MTOMB_KEY, {}) }
        case 'chapterTombstones':   return { value: readJSON(CTOMB_KEY, {}) }
        default: throw new Error(`getBundle: unknown kind ${kind}`)
      }
    },
    putBundle: (kind, repr) => {
      switch (kind) {
        case 'categories':
          localStorage.setItem(CAT_KEY, JSON.stringify(repr.value))
          if (repr.updatedAt) localStorage.setItem(CAT_TS_KEY, repr.updatedAt)
          break
        case 'birthday':
          localStorage.setItem(BDAY_KEY, repr.value)
          if (repr.updatedAt) localStorage.setItem(BDAY_TS_KEY, repr.updatedAt)
          break
        case 'milestoneTombstones':
          localStorage.setItem(MTOMB_KEY, JSON.stringify(repr.value))
          break
        case 'chapterTombstones':
          localStorage.setItem(CTOMB_KEY, JSON.stringify(repr.value))
          break
        default: throw new Error(`putBundle: unknown kind ${kind}`)
      }
    },
  }
}
