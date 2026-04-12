import { dbGetAll, dbAdd, dbPut, dbDelete } from './db'
import { categoryColor } from '../utils/colors'

function uid() {
  return crypto.randomUUID()
}

export function buildMilestone({
  title,
  date,           // Date object or ISO string
  date_precision = 'month',
  category       = 'personal',
  color,
  note           = '',
  photo_uri      = '',
  url            = '',
  recurrence     = null,   // null | 'annual'
  recurrence_id  = null,   // UUID shared across instances of a series
}) {
  const dateObj = date instanceof Date ? date : new Date(date)
  const today   = new Date()
  const now     = new Date().toISOString()

  return {
    id:             uid(),
    title:          title.trim(),
    date:           dateObj.toISOString(),
    date_precision,
    direction:      dateObj < today ? 'past' : 'future',
    category,
    color:          color || categoryColor(category),
    note,
    photo_uri,
    url,
    recurrence,
    recurrence_id,
    created_at:     now,
    updated_at:     now,
  }
}

export async function loadMilestones() {
  return dbGetAll()
}

export async function addMilestone(data) {
  const m = buildMilestone(data)
  await dbAdd(m)
  return m
}

export async function updateMilestone(id, updates, existing) {
  const dateObj = updates.date instanceof Date
    ? updates.date
    : new Date(updates.date || existing.date)

  const today   = new Date()
  const now     = new Date().toISOString()

  const m = {
    ...existing,
    ...updates,
    id,
    date:      dateObj.toISOString(),
    direction: dateObj < today ? 'past' : 'future',
    color:     updates.color || categoryColor(updates.category || existing.category),
    updated_at: now,
  }
  await dbPut(m)
  return m
}

export async function deleteMilestone(id) {
  await dbDelete(id)
}

// Clear all milestones and replace with the supplied array (preserves original IDs)
export async function restoreMilestones(items) {
  const existing = await dbGetAll()
  for (const m of existing) await dbDelete(m.id)
  for (const m of items)    await dbPut(m)
  return items
}
