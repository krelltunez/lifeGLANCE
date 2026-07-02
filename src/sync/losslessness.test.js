// GLANCEvault sync cutover — STAGE 1 losslessness gate.
//
// Proves lifeGLANCE's full data model can be LOSSLESSLY represented as the
// per-row, per-entity encrypted envelopes that the GLANCEvault database
// transport (createDbSyncEngine) exchanges, under the current entity-grain
// merge semantics.
//
// The database engine (node_modules/@glance-apps/sync/src/dbEngine.js) is
// data-shape agnostic: each app entity becomes one row { entityId, envelope },
// where `envelope` is base64(IV || AES-GCM(JSON.stringify(entity))) produced by
// encryptEntity(entity, entityId). There is NO type column on the server, so the
// adapter must be able to tell what a decrypted row is. lifeGLANCE is
// entity-rich (milestones, chapters, plus singleton bundles), so per the spec's
// 5.2 guidance this test models the recommended EXPLICIT `_kind` discrimination:
// every envelope carries a `_kind` tag (and an in-envelope `life_id`, since a
// "Life" is in-envelope data, not a server schema column).
//
// This test does NOT switch the transport, touch the engine, or write to a
// server. It shreds a faithful fixture to wire rows, reassembles, and asserts
// nothing is lost. Representability only — multi-device MERGE correctness is
// Stage 2.

import { describe, it, expect, beforeAll } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { encryptEntity, decryptEntity, setupDbRootKey } from '@glance-apps/sync'
import { buildMilestone } from '../data/milestones.js'
import { buildChapter } from '../data/chapters.js'

// ── Wire serialization (the chosen discrimination) ──────────────────────────
// Singleton bundles get stable, namespaced entity ids. They deliberately do NOT
// use the engine-reserved `__glance_` prefix (that namespace is owned by the
// sync engine, e.g. the key verifier). One Life ('default') today; the id is
// scoped by life_id so a future multi-Life model stays collision-free.
const LIFE_ID = 'default'
const bundleId = (kind) => `life:${LIFE_ID}:${kind}`

// Per-entity collections: each item is its own row, entityId = item.id.
const PER_ITEM = [
  { coll: 'milestones', kind: 'milestone' },
  { coll: 'chapters',   kind: 'chapter' },
]
// Singleton/bundle rows: one row for a whole map/value/set.
const SINGLETONS = [
  { field: 'milestoneTombstones', kind: 'milestoneTombstones' },
  { field: 'chapterTombstones',   kind: 'chapterTombstones' },
  { field: 'birthday',            kind: 'birthday', paired: 'birthdayUpdatedAt' },
  { field: 'categories',          kind: 'categories', paired: 'categoriesUpdatedAt' },
]

// shredToRows — turn a file-tier `{ lives: { default: {...} } }` payload into the
// flat array of encrypted wire rows the GLANCEvault transport would exchange.
async function shredToRows(payload) {
  const life = payload.lives[LIFE_ID]
  const rows = []

  for (const { coll, kind } of PER_ITEM) {
    for (const item of life[coll]) {
      const envObj = { _kind: kind, life_id: LIFE_ID, ...item }
      rows.push({ entityId: item.id, envelope: await encryptEntity(envObj, item.id) })
    }
  }

  for (const { field, kind, paired } of SINGLETONS) {
    const id = bundleId(kind)
    const envObj = { _kind: kind, life_id: LIFE_ID, value: life[field] }
    if (paired) envObj.updatedAt = life[paired]
    rows.push({ entityId: id, envelope: await encryptEntity(envObj, id) })
  }

  return rows
}

// reassembleFromRows — decrypt every row, route by `_kind`, and rebuild the
// file-tier payload. Routing metadata (`_kind`, `life_id`, the singleton
// `value`/`updatedAt` wrappers) is stripped so the result is shaped exactly like
// the original — anything left over would be a representation leak.
async function reassembleFromRows(rows) {
  const out = { milestones: [], chapters: [] }

  for (const row of rows) {
    const env = await decryptEntity(row.envelope, row.entityId)
    const { _kind, life_id, ...rest } = env
    expect(life_id).toBe(LIFE_ID) // every row is scoped to its Life

    if (_kind === 'milestone' || _kind === 'chapter') {
      out[_kind === 'milestone' ? 'milestones' : 'chapters'].push(rest)
      continue
    }
    const single = SINGLETONS.find((s) => s.kind === _kind)
    if (!single) throw new Error(`unknown _kind on row ${row.entityId}: ${_kind}`)
    out[single.field] = rest.value
    if (single.paired) out[single.paired] = rest.updatedAt
  }

  return { lives: { [LIFE_ID]: out } }
}

// ── Key-order-independent deep diff ─────────────────────────────────────────
// Returns an array of mismatch paths; empty means deep-equal regardless of key
// order. Distinguishes missing vs extra vs changed so a regression names the
// exact lost field / entity / bundle.
function deepDiff(a, b, path = '') {
  const diffs = []
  const ta = typeOf(a)
  const tb = typeOf(b)
  if (ta !== tb) { diffs.push(`${path || '<root>'}: type ${ta} != ${tb}`); return diffs }

  if (ta === 'array') {
    if (a.length !== b.length) diffs.push(`${path}: array length ${a.length} != ${b.length}`)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diffs.push(...deepDiff(a[i], b[i], `${path}[${i}]`))
    }
    return diffs
  }
  if (ta === 'object') {
    const ka = Object.keys(a).sort()
    const kb = Object.keys(b).sort()
    for (const k of ka) if (!(k in b)) diffs.push(`${path}.${k}: missing in reassembled`)
    for (const k of kb) if (!(k in a)) diffs.push(`${path}.${k}: unexpected extra in reassembled`)
    for (const k of ka) if (k in b) diffs.push(...deepDiff(a[k], b[k], `${path}.${k}`))
    return diffs
  }
  if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`)
  return diffs
}
function typeOf(v) {
  if (Array.isArray(v)) return 'array'
  if (v === null) return 'null'
  return typeof v
}

// ── Faithful, real-shaped fixture of lifeGLANCE's full data model ───────────
// Built with the real buildMilestone / buildChapter so the shapes are exactly
// what the app persists (every field, including the Phase 7 media reference
// slots and the Phase 5 dayGLANCE linking fields). A hierarchy of chapters
// (parent → child via parentChapterId, plus a standalone), chapter→milestone
// membership via milestoneIds, and every bundle/singleton/tombstone.
function makeFixture() {
  const parentChapter = buildChapter({
    title: 'The Twenties', start: new Date('2010-01-01'), end: new Date('2019-12-31'),
    color: '#9370DB', category: 'personal', description: 'A whole decade', defaultMemberVisibility: 'shown',
  })
  const childChapter = buildChapter({
    title: 'University Years', start: new Date('2010-09-01'), end: new Date('2014-06-30'),
    color: '#4A90D9', description: 'Nested inside the twenties',
    defaultMemberVisibility: 'hidden', parentChapterId: parentChapter.id,
  })
  const openChapter = buildChapter({
    title: 'Now', start: new Date('2020-01-01'), end: null, color: '#38B2AC',
  })

  // Milestone covering media (audio), photo, recurrence, dayGLANCE linking, and
  // an explicitly non-null thumbnail_id to prove the reserved slot carries.
  const mAudio = buildMilestone({
    title: 'Graduation Speech', date: new Date('2014-06-15'), date_precision: 'day',
    category: 'education', note: 'Recorded it', media_type: 'audio', media_id: 'blob-aaa',
    thumbnail_id: 'thumb-aaa', url: 'https://example.com/speech',
  })
  const mPhoto = buildMilestone({
    title: 'First Apartment', date: new Date('2015-03-01'), category: 'home',
    has_photo: true, photo_id: 'first-apartment-photo',
    mainTimelineVisibility: 'shown',
  })
  const mRecurring = buildMilestone({
    title: 'Birthday', date: new Date('1990-05-20'), date_precision: 'day',
    category: 'personal', recurrence: 'annual', recurrence_id: 'series-bday-1',
  })
  const mLinked = buildMilestone({
    title: 'Dentist', date: new Date('2026-09-01'), category: 'health',
    dayglance_linked: true, dayglance_task_id: 'task-xyz',
    dayglance_completed: true, dayglance_completed_at: '2026-09-01T10:00:00.000Z',
  })

  // Wire chapter membership (denormalized opaque ids on the chapter object).
  childChapter.milestoneIds = [mAudio.id]
  openChapter.milestoneIds = [mPhoto.id, mLinked.id]

  return {
    lives: {
      default: {
        milestones: [mAudio, mPhoto, mRecurring, mLinked],
        chapters:   [parentChapter, childChapter, openChapter],
        milestoneTombstones: {
          'dead-milestone-1': '2026-01-02T03:04:05.000Z',
          'dead-milestone-2': '2026-02-03T04:05:06.000Z',
        },
        chapterTombstones: {
          'dead-chapter-1': '2026-03-04T05:06:07.000Z',
        },
        birthday: '1990-05-20',
        birthdayUpdatedAt: '2026-04-05T06:07:08.000Z',
        categories: [
          { id: 'personal', label: 'personal', color: '#9370DB' },
          { id: 'custom-1', label: 'Side Project', color: '#FF8800' },
        ],
        categoriesUpdatedAt: '2026-05-06T07:08:09.000Z',
      },
    },
  }
}

describe('GLANCEvault sync — Stage 1 losslessness', () => {
  beforeAll(async () => {
    // Real per-entity crypto path needs IndexedDB (root-key cache) + a derived
    // root key. Fixed salt → deterministic, fast.
    global.indexedDB = new IDBFactory()
    const salt = new Uint8Array(16).fill(7)
    await setupDbRootKey('correct horse battery staple', salt, { cryptoDBName: 'lossless-test-crypto' })
  })

  it('shreds the full model to per-row envelopes and reassembles with zero loss', async () => {
    const original = makeFixture()
    const rows = await shredToRows(original)

    const life = original.lives.default
    const expectedRowCount =
      life.milestones.length + life.chapters.length + SINGLETONS.length
    expect(rows.length).toBe(expectedRowCount)
    expect(rows.length).toBe(4 + 3 + 4) // 4 milestones + 3 chapters + 4 singletons

    // Every entityId is unique (no row collisions on the server) and non-reserved.
    const ids = rows.map((r) => r.entityId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.some((id) => id.startsWith('__glance_'))).toBe(false)

    const reassembled = await reassembleFromRows(rows)
    const diffs = deepDiff(original, reassembled)
    if (diffs.length) console.error('LOSSLESSNESS DIFFS:\n' + diffs.join('\n'))
    expect(diffs).toEqual([])
  })

  it('preserves every milestone field through the wire, including the reserved media slots', async () => {
    const original = makeFixture()
    const rows = await shredToRows(original)
    const reassembled = await reassembleFromRows(rows)

    const byId = Object.fromEntries(reassembled.lives.default.milestones.map((m) => [m.id, m]))
    for (const m of original.lives.default.milestones) {
      // Field count and every key/value must survive verbatim.
      expect(Object.keys(byId[m.id]).sort()).toEqual(Object.keys(m).sort())
      expect(deepDiff(m, byId[m.id])).toEqual([])
    }

    // Phase 7 media reference slots ride the field-agnostic merge as ordinary
    // milestone fields — explicitly assert each of the three is present and exact.
    const audio = byId[original.lives.default.milestones[0].id]
    expect(audio.media_id).toBe('blob-aaa')
    expect(audio.thumbnail_id).toBe('thumb-aaa')
    const photo = byId[original.lives.default.milestones[1].id]
    expect(photo.photo_id).toBe('first-apartment-photo')
    // thumbnail_id defaults to null and must survive as null (not dropped).
    expect('thumbnail_id' in photo).toBe(true)
    expect(photo.thumbnail_id).toBeNull()
  })

  it('preserves chapter hierarchy and membership (parentChapterId + milestoneIds)', async () => {
    const original = makeFixture()
    const reassembled = await reassembleFromRows(await shredToRows(original))

    const oc = original.lives.default.chapters
    const rc = Object.fromEntries(reassembled.lives.default.chapters.map((c) => [c.id, c]))

    // parentChapterId is a denormalized opaque ref carried on the child row.
    const child = oc.find((c) => c.parentChapterId !== null)
    expect(rc[child.id].parentChapterId).toBe(child.parentChapterId)
    // milestoneIds membership arrays survive verbatim and in order.
    for (const c of oc) expect(rc[c.id].milestoneIds).toEqual(c.milestoneIds)
    // The chapter category tag (issue #213) rides the chapter row and round-trips.
    for (const c of oc) expect(rc[c.id].category).toBe(c.category ?? null)
    expect(oc.find((c) => c.category === 'personal')).toBeTruthy() // fixture actually exercises it
  })

  it('preserves every singleton bundle (tombstone maps, birthday, categories) with paired timestamps', async () => {
    const original = makeFixture()
    const reassembled = await reassembleFromRows(await shredToRows(original))
    const o = original.lives.default
    const r = reassembled.lives.default

    expect(r.milestoneTombstones).toEqual(o.milestoneTombstones)
    expect(r.chapterTombstones).toEqual(o.chapterTombstones)
    expect(r.birthday).toBe(o.birthday)
    expect(r.birthdayUpdatedAt).toBe(o.birthdayUpdatedAt)
    expect(r.categories).toEqual(o.categories)
    expect(r.categoriesUpdatedAt).toBe(o.categoriesUpdatedAt)
  })

  it('round-trips losslessly even when key order is reversed on the wire', async () => {
    // Key-order independence: rebuild every object with its keys in reverse
    // order, then diff. A serialization that secretly depended on key order
    // would surface here; the deep diff must still be empty.
    const reverseKeys = (v) => {
      if (Array.isArray(v)) return v.map(reverseKeys)
      if (v && typeof v === 'object') {
        const out = {}
        for (const k of Object.keys(v).reverse()) out[k] = reverseKeys(v[k])
        return out
      }
      return v
    }
    const original = makeFixture()
    const reassembled = await reassembleFromRows(await shredToRows(original))
    expect(deepDiff(original, reverseKeys(reassembled))).toEqual([])
  })
})
