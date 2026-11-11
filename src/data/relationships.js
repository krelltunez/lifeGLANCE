// Relationships between Lives (v5.0, Phase 4): directed edges.
// docs/lifeGLANCE-app-spec.md, "Relationships: stored as edges".
//
// An edge { id, fromLifeId, toLifeId, type, relationshipNote?, created_at,
// updated_at } reads "toLifeId is fromLifeId's <type>": from Me to Mom with
// type 'parent' is "Mom is Me's parent". Edges between any two Lives, several
// per pair, are representable; v5.0 only offers one picker, "relationship to
// Me" on a Life, which manages the edge from Me to that Life. relationshipNote
// is stored and synced but has no UI in v5.0.
//
// Every write marks its row dirty for the vault; deletions write a tombstone,
// so the file tier drops the edge on every device too.

import { uid } from './milestones'
import { dbGetAllRelationships, dbPutRelationship, dbDeleteRelationship, ME_LIFE_ID } from './db'
import { markDirty } from '../sync/dirty'
import { writeRelationshipTombstone } from '../sync/tombstones'

/** The picker's types. 'partner' covers partners and spouses. */
export const RELATIONSHIP_TYPES = ['parent', 'child', 'partner', 'sibling', 'other']

export const listRelationships = () => dbGetAllRelationships()

export function buildRelationship({ fromLifeId, toLifeId, type, relationshipNote = '' }) {
  if (!fromLifeId || !toLifeId || fromLifeId === toLifeId) throw new Error('A relationship joins two different Lives')
  if (!RELATIONSHIP_TYPES.includes(type)) throw new Error(`Unknown relationship type: ${type}`)
  const now = new Date().toISOString()
  return { id: uid(), fromLifeId, toLifeId, type, relationshipNote, created_at: now, updated_at: now }
}

const newest = (a, b) => (String(b.updated_at).localeCompare(String(a.updated_at)))

/**
 * The edge the "relationship to Me" picker shows for `lifeId`: the most
 * recently changed edge from Me to that Life, or null. Other edges between the
 * two (from an import, or a future editor) are left alone.
 */
export function relationshipToMe(lifeId, edges) {
  return edges.filter(e => e.fromLifeId === ME_LIFE_ID && e.toLifeId === lifeId).sort(newest)[0] ?? null
}

/**
 * Set the picker's value for `lifeId`: update that edge's type, create one if
 * there is none, or delete it for `null` (no relationship). Returns the edge,
 * or null after a delete.
 */
export async function setRelationshipToMe(lifeId, type, edges) {
  const current = relationshipToMe(lifeId, edges)
  if (!type) {
    if (current) await deleteRelationship(current.id)
    return null
  }
  if (current) {
    if (current.type === type) return current
    const updated = { ...current, type, updated_at: new Date().toISOString() }
    await dbPutRelationship(updated)
    markDirty(updated.id)
    return updated
  }
  const edge = buildRelationship({ fromLifeId: ME_LIFE_ID, toLifeId: lifeId, type })
  await dbPutRelationship(edge)
  markDirty(edge.id)
  return edge
}

export async function deleteRelationship(id, at = new Date().toISOString()) {
  writeRelationshipTombstone(id, at)
  await dbDeleteRelationship(id)
  markDirty(id)   // after the row is gone: the vault engine pushes a soft delete
}

/** Delete every edge that touches `lifeId` (for deleting that Life). */
export async function deleteRelationshipsOf(lifeId, at = new Date().toISOString()) {
  const gone = []
  for (const e of await dbGetAllRelationships()) {
    if (e.fromLifeId !== lifeId && e.toLifeId !== lifeId) continue
    await deleteRelationship(e.id, at)
    gone.push(e.id)
  }
  return gone
}
