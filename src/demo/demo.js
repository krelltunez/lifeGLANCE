// =============================================================================
// Demo data (hosted-eval only) — seeds a fictional persona so an evaluator lands
// on a populated, zoomable timeline instead of the empty onboarding state.
// =============================================================================
//
// GATING: this module is reached ONLY through a dynamic `import('./demo/demo')`
// guarded by `import.meta.env.VITE_DEMO` at every call site. With VITE_DEMO unset
// (Docker / self-host / Capacitor builds) the guard is a dead branch, so Rollup
// never emits this chunk and the fixture JSON below is absent from those bundles.
// VITE_DEMO is set only in the Vercel project settings.
//
// VAULT SAFETY: seeding writes straight to the object stores via the raw db.js
// helpers (dbPut / dbPutChapter), NOT through the data layer (addMilestone /
// updateMilestone). The data layer calls markDirty at every write; the raw
// helpers do not. So demo rows are never queued for push to a configured
// GLANCEvault — they stay purely local, exactly like the screenshot seeder.
//
// MEDIA: text only. Photos are out of scope — media is stripped on the way in
// (media_type: null, has_photo: false, photo_uri dropped), mirroring
// scripts/screenshots.mjs.

import demoData from './lifeglance-jake-chen-test.json'
import { dbPut, dbPutChapter, dbDelete, dbDeleteChapter } from '../data/db'

// Presence of this key means demo data is loaded. It also records the EXACT ids
// written, so Clear removes precisely the demo records (never anything the user
// created) without needing the fixture.
const STATE_KEY = 'lifeglance-demo-state'

// Jake's birth date — set so ages render on the timeline (matches the screenshot
// seeder). Only applied when the user has no birthday of their own.
const DEMO_BIRTHDAY = '1998-11-03'
const BIRTHDAY_KEY = 'lifeglance-birthday'
const BIRTHDAY_UPDATED_KEY = 'lifeglance-birthday-updated-at'

export function readDemoState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || 'null') } catch { return null }
}

export function isDemoLoaded() {
  return !!readDemoState()
}

// Normalize the legacy-schema fixture the same way restoreMilestones /
// screenshots.mjs do: drop photo_uri, force media flags off, and default the
// fields the fixture predates.
function normalizeMilestones(milestones) {
  return milestones.map(({ photo_uri: _drop, ...m }) => ({
    mainTimelineVisibility: 'inherit',
    dayglance_linked:       false,
    dayglance_task_id:      null,
    dayglance_completed:    false,
    dayglance_completed_at: null,
    ...m,
    media_type: null,
    has_photo:  false,
  }))
}

// Seed the demo persona directly into IndexedDB and persist the demo state.
// Caller reloads the page afterwards so App re-reads the store (which also
// handles the onboarding -> timeline transition and reloads chapters).
export async function loadDemo() {
  const milestones = normalizeMilestones(demoData.milestones || [])
  const chapters   = demoData.chapters || []

  for (const m of milestones) await dbPut(m)
  for (const c of chapters)   await dbPutChapter(c)

  // Set a birthday only if the user has none, and remember whether we did so
  // Clear can revert exactly what we touched.
  let seededBirthday = false
  if (!localStorage.getItem(BIRTHDAY_KEY)) {
    localStorage.setItem(BIRTHDAY_KEY, DEMO_BIRTHDAY)
    localStorage.setItem(BIRTHDAY_UPDATED_KEY, new Date(0).toISOString())
    seededBirthday = true
  }

  // Written last, after the rows exist, so a mid-seed failure leaves no flag.
  localStorage.setItem(STATE_KEY, JSON.stringify({
    v: 1,
    milestoneIds: milestones.map(m => m.id),
    chapterIds:   chapters.map(c => c.id),
    seededBirthday,
  }))
}

// Remove exactly the demo records by their known ids. Never wipes the DB and
// never touches anything the user created. Idempotent: deleting an already-gone
// id is a no-op, so an interrupted Clear re-runs cleanly.
export async function clearDemo() {
  const state = readDemoState()
  if (!state) return

  for (const id of state.milestoneIds || []) await dbDelete(id)
  for (const id of state.chapterIds   || []) await dbDeleteChapter(id)

  if (state.seededBirthday) {
    localStorage.removeItem(BIRTHDAY_KEY)
    localStorage.removeItem(BIRTHDAY_UPDATED_KEY)
  }

  localStorage.removeItem(STATE_KEY)
}
