// GLANCEvault entityId scheme for lifeGLANCE. Dependency-free so both the row
// adapter and the markDirty forwarder can share it without an import cycle.
//
// Per-item entities (milestones, chapters) use their own bare UUID as entityId
// (no entity-type hint leaks into the server row key). Singleton bundles use a
// stable, NON engine-reserved id; the `__glance_` prefix is owned by the engine.
// A "Life" is in-envelope data (life_id), currently the single 'default' Life.

export const LIFE_ID = 'default'

export const BUNDLE_KINDS = ['categories', 'milestoneTombstones', 'chapterTombstones', 'birthday']

export const bundleEntityId = (kind) => `life:${LIFE_ID}:${kind}`
