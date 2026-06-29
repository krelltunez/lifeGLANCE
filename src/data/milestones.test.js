import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

// Reset the module registry and IndexedDB before each test so each test
// gets a fresh in-memory database with no leftover state.
beforeEach(() => {
  global.indexedDB = new IDBFactory()
  vi.resetModules()
})

async function setup() {
  const { initDB }                           = await import('./db')
  const { addMilestone, updateMilestone, deleteMilestone, loadMilestones, restoreMilestones } =
    await import('./milestones')
  await initDB()
  return { addMilestone, updateMilestone, deleteMilestone, loadMilestones, restoreMilestones }
}

describe('addMilestone', () => {
  it('stores a milestone and returns it with an id', async () => {
    const { addMilestone, loadMilestones } = await setup()
    const m = await addMilestone({ title: 'First Home', date: new Date('2015-06-01') })
    expect(m.id).toBeTruthy()
    expect(m.title).toBe('First Home')
    const all = await loadMilestones()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(m.id)
  })

  it('sets direction to past for past dates', async () => {
    const { addMilestone } = await setup()
    const m = await addMilestone({ title: 'Past', date: new Date('2000-01-01') })
    expect(m.direction).toBe('past')
  })

  it('sets direction to future for future dates', async () => {
    const { addMilestone } = await setup()
    const m = await addMilestone({ title: 'Future', date: new Date('2099-01-01') })
    expect(m.direction).toBe('future')
  })

  it('stores multiple milestones independently', async () => {
    const { addMilestone, loadMilestones } = await setup()
    await addMilestone({ title: 'A', date: new Date('2010-01-01') })
    await addMilestone({ title: 'B', date: new Date('2011-01-01') })
    await addMilestone({ title: 'C', date: new Date('2012-01-01') })
    const all = await loadMilestones()
    expect(all).toHaveLength(3)
  })

  it('does not include photo_uri in stored record', async () => {
    const { addMilestone, loadMilestones } = await setup()
    await addMilestone({ title: 'Photo test', date: new Date('2020-01-01'), has_photo: true })
    const all = await loadMilestones()
    expect('photo_uri' in all[0]).toBe(false)
  })
})

describe('updateMilestone', () => {
  it('updates an existing milestone', async () => {
    const { addMilestone, updateMilestone, loadMilestones } = await setup()
    const m = await addMilestone({ title: 'Original', date: new Date('2015-01-01') })
    await updateMilestone(m.id, { title: 'Updated', date: new Date('2015-01-01') }, m)
    const all = await loadMilestones()
    expect(all[0].title).toBe('Updated')
  })

  it('bumps updated_at when writing a real blob hash to a media slot (Phase 8)', async () => {
    // Real blob hashes are not device-derivable (unlike the old deterministic
    // placeholders), so writing one MUST bump updated_at to propagate via LWW —
    // i.e. it must go through the normal updateMilestone mutation, not a silent
    // no-bump backfill.
    const { addMilestone, updateMilestone, loadMilestones } = await setup()
    const { dbPut } = await import('./db')
    const m = await addMilestone({ title: 'Has photo', date: new Date('2020-01-01'), has_photo: true })
    // Force an old updated_at so the bump is unambiguous.
    const old = '2000-01-01T00:00:00.000Z'
    await dbPut({ ...m, updated_at: old })
    const realHash = 'a'.repeat(64)
    const updated = await updateMilestone(m.id, { photo_id: realHash, thumbnail_id: 'b'.repeat(64) }, { ...m, updated_at: old })
    expect(updated.photo_id).toBe(realHash)
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(new Date(old).getTime())
    const all = await loadMilestones()
    expect(all[0].updated_at).toBe(updated.updated_at)
  })

  it('recalculates direction on date change', async () => {
    const { addMilestone, updateMilestone, loadMilestones } = await setup()
    const m = await addMilestone({ title: 'Test', date: new Date('2000-01-01') })
    expect(m.direction).toBe('past')
    await updateMilestone(m.id, { title: 'Test', date: new Date('2099-01-01') }, m)
    const all = await loadMilestones()
    expect(all[0].direction).toBe('future')
  })

  it('strips any photo_uri field passed in updates', async () => {
    const { addMilestone, updateMilestone, loadMilestones } = await setup()
    const m = await addMilestone({ title: 'Test', date: new Date('2020-01-01') })
    await updateMilestone(m.id, { title: 'Test', date: new Date('2020-01-01'), photo_uri: 'data:...' }, m)
    const all = await loadMilestones()
    expect('photo_uri' in all[0]).toBe(false)
  })
})

describe('deleteMilestone', () => {
  it('removes the milestone from the store', async () => {
    const { addMilestone, deleteMilestone, loadMilestones } = await setup()
    const m = await addMilestone({ title: 'To Delete', date: new Date('2020-01-01') })
    await deleteMilestone(m.id)
    const all = await loadMilestones()
    expect(all).toHaveLength(0)
  })

  it('does not affect other milestones', async () => {
    const { addMilestone, deleteMilestone, loadMilestones } = await setup()
    const a = await addMilestone({ title: 'Keep', date: new Date('2020-01-01') })
    const b = await addMilestone({ title: 'Delete', date: new Date('2021-01-01') })
    await deleteMilestone(b.id)
    const all = await loadMilestones()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(a.id)
  })
})

describe('restoreMilestones', () => {
  it('replaces all existing milestones', async () => {
    const { addMilestone, restoreMilestones, loadMilestones } = await setup()
    await addMilestone({ title: 'Old', date: new Date('2010-01-01') })
    const imported = [
      { id: 'x1', title: 'New A', date: '2020-01-01T00:00:00.000Z', date_precision: 'day',
        category: 'personal', color: '#888', direction: 'past', note: '', has_photo: false,
        media_type: null, url: '', recurrence: null, recurrence_id: null,
        created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z' },
    ]
    const restored = await restoreMilestones(imported)
    expect(restored).toHaveLength(1)
    const all = await loadMilestones()
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('New A')
  })

  it('strips photo_uri and resets has_photo from restored items', async () => {
    const { restoreMilestones, loadMilestones } = await setup()
    const items = [
      { id: 'y1', title: 'Photo Mile', date: '2020-01-01T00:00:00.000Z', date_precision: 'day',
        category: 'personal', color: '#888', direction: 'past', note: '',
        photo_uri: 'data:image/png;base64,abc', has_photo: true, media_type: null,
        url: '', recurrence: null, recurrence_id: null,
        created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z' },
    ]
    await restoreMilestones(items)
    const all = await loadMilestones()
    expect('photo_uri' in all[0]).toBe(false)
    expect(all[0].has_photo).toBe(false)
  })
})
