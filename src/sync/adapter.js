import { mergeArrayById } from '@glance-apps/sync';
import { tombstoneCutoff, pruneTombstoneMap } from './tombstoneRetention.js';
import { dbGetAll, dbGetAllChapters, dbPut, dbDelete, dbPutChapter, dbDeleteChapter, dbGetAllLives, dbPutLife, dbDeleteLife, ME_LIFE_ID,
  dbGetAllRelationships, dbPutRelationship, dbDeleteRelationship } from '../data/db.js';
import { getMilestoneTombstones, getChapterTombstones, getLifeTombstones, getRelationshipTombstones } from './tombstones.js';
import { mergeMilestones } from './dbAdapter.js';
import { recordWriter, legacyFileKey } from './lifeGate.js';
import { WRITER_WINDOW_DAYS } from './writerStamp.js';
import { loadCategories, saveCategories } from '../utils/colors.js';
import { ensureDeviceId } from './deviceId.js';
import { ownWriterEntry, mergeWriters, noteWriter } from './writerStamp.js';

// The keys of a payload, and of its `lives.default` object, that this build
// reads and writes. Anything else in the file was written by a newer build
// (Lives v5.0) and is passed through untouched by mergePayloads, never
// dropped. See "Sync and version skew" in docs/lifeGLANCE-app-spec.md.
const KNOWN_TOP_KEYS = new Set(['lives', 'writers']);
const KNOWN_LIFE_KEYS = new Set([
  'milestones', 'chapters', 'milestoneTombstones', 'chapterTombstones',
  'birthday', 'birthdayUpdatedAt', 'categories', 'categoriesUpdatedAt',
  'lifeRecords', 'lifeTombstones', 'relationships', 'relationshipTombstones',   // Lives v5.0
]);

// The entries of `obj` whose keys are not in `known`.
const unknownKeys = (obj, known) => {
  if (!obj || typeof obj !== 'object') return {};
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !known.has(k)));
};

// How long a deletion tombstone is kept before mergePayloads prunes it. Beyond
// this window a device that has been offline the whole time still holds the
// deleted item but no longer sees a tombstone for it, so on reconnect the item
// is re-introduced (resurrected) instead of staying deleted. 90 days is the
// grace period for that edge case — raising it widens the safe-offline window
// at the cost of retaining more tombstones; don't lower it without accounting
// for the increased resurrection risk.

// buildPayload — reads live IDB state. Called before every upload.
// Accepts a milestonesRef so it can read the latest React state for milestones
// (avoiding stale closures), but falls back to IDB for robustness.
export const buildPayload = async (milestonesRef, chaptersRef) => {
  // IDB is authoritative. Refs are used only when non-empty to avoid stale
  // empty state (e.g. before IDB loads into React) overwriting real data.
  const [idbMilestones, idbChapters, lifeRecords, relationships] = await Promise.all([dbGetAll(), dbGetAllChapters(), dbGetAllLives(), dbGetAllRelationships()])
  const milestones = (milestonesRef?.current?.length > 0) ? milestonesRef.current : idbMilestones
  const chapters   = (chaptersRef?.current?.length   > 0) ? chaptersRef.current   : idbChapters
  const payload = {
    // This device's writer entry (writerStamp.js). Only the sync payload
    // carries it; the backup payload below is a local copy, not a write.
    writers: { [ensureDeviceId()]: ownWriterEntry() },
    lives: {
      default: {
        milestones,
        chapters,
        milestoneTombstones: getMilestoneTombstones(),
        chapterTombstones: getChapterTombstones(),
        lifeRecords,
        lifeTombstones: getLifeTombstones(),
        relationships,
        relationshipTombstones: getRelationshipTombstones(),
        birthday: localStorage.getItem('lifeglance-birthday') || '',
        birthdayUpdatedAt: localStorage.getItem('lifeglance-birthday-updated-at') || '',
        categories: loadCategories(),
        categoriesUpdatedAt: localStorage.getItem('lifeglance-categories-updated-at') || '',
      }
    }
  };
  return payload;
};

// buildBackupPayload — timer-safe. Must not read React state.
export const buildBackupPayload = async () => {
  const [milestones, chapters, lifeRecords, relationships] = await Promise.all([dbGetAll(), dbGetAllChapters(), dbGetAllLives(), dbGetAllRelationships()]);
  return {
    lives: {
      default: {
        milestones,
        chapters,
        milestoneTombstones: getMilestoneTombstones(),
        chapterTombstones: getChapterTombstones(),
        lifeRecords,
        lifeTombstones: getLifeTombstones(),
        relationships,
        relationshipTombstones: getRelationshipTombstones(),
        birthday: localStorage.getItem('lifeglance-birthday') || '',
        birthdayUpdatedAt: localStorage.getItem('lifeglance-birthday-updated-at') || '',
        categories: loadCategories(),
        categoriesUpdatedAt: localStorage.getItem('lifeglance-categories-updated-at') || '',
      }
    }
  };
};

// applyPayload — writes merged data to IDB, then refreshes React state via callbacks
export const makeApplyPayload = (setMilestones, setChapters) =>
  async (data, _opts) => {
    const life = data?.lives?.default;
    if (!life) return;

      const milestones          = Array.isArray(life.milestones) ? life.milestones : []
    const chapters            = Array.isArray(life.chapters)   ? life.chapters   : []
    const milestoneTombstones = life.milestoneTombstones && typeof life.milestoneTombstones === 'object' ? life.milestoneTombstones : {}
    const chapterTombstones   = life.chapterTombstones   && typeof life.chapterTombstones   === 'object' ? life.chapterTombstones   : {}

    // Persist tombstones
    localStorage.setItem('lifeglance-milestone-tombstones', JSON.stringify(milestoneTombstones));
    localStorage.setItem('lifeglance-chapter-tombstones', JSON.stringify(chapterTombstones));

    // Compute IDB milestone ids to delete (tombstoned, not in merged set)
    const currentMilestones = await dbGetAll();
    const mergedMilestoneIds = new Set(milestones.map(m => m.id));
    const milestoneIdsToDelete = currentMilestones
      .map(m => m.id)
      .filter(id => !mergedMilestoneIds.has(id));

    // Write merged milestones
    for (const m of milestones) await dbPut(m);
    for (const id of milestoneIdsToDelete) await dbDelete(id);

    // Compute IDB chapter ids to delete
    const currentChapters = await dbGetAllChapters();
    const mergedChapterIds = new Set(chapters.map(c => c.id));
    const chapterIdsToDelete = currentChapters
      .map(c => c.id)
      .filter(id => !mergedChapterIds.has(id));

    // Write merged chapters
    for (const c of chapters) await dbPutChapter(c);
    for (const id of chapterIdsToDelete) await dbDeleteChapter(id);

    // Lives (v5.0). Only when the payload carries them: a file written by an
    // older build has no lifeRecords, and that must not delete this device's
    // Lives. The Me Life is never deleted.
    if (Array.isArray(life.lifeRecords)) {
      const currentLives = await dbGetAllLives();
      const mergedLifeIds = new Set(life.lifeRecords.map(l => l.id));
      for (const l of life.lifeRecords) await dbPutLife(l);
      for (const l of currentLives) {
        if (!mergedLifeIds.has(l.id) && l.id !== ME_LIFE_ID) await dbDeleteLife(l.id);
      }
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('lifeglance:lives-changed'));
    }
    if (life.lifeTombstones && typeof life.lifeTombstones === 'object') {
      localStorage.setItem('lifeglance-life-tombstones', JSON.stringify(life.lifeTombstones));
    }
    // Relationship edges: the same rule as Life records.
    if (Array.isArray(life.relationships)) {
      const current = await dbGetAllRelationships();
      const mergedIds = new Set(life.relationships.map(e => e.id));
      for (const e of life.relationships) await dbPutRelationship(e);
      for (const e of current) if (!mergedIds.has(e.id)) await dbDeleteRelationship(e.id);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('lifeglance:lives-changed'));
    }
    if (life.relationshipTombstones && typeof life.relationshipTombstones === 'object') {
      localStorage.setItem('lifeglance-relationship-tombstones', JSON.stringify(life.relationshipTombstones));
    }

    // Apply birthday (last-writer-wins — already resolved in mergePayloads)
    if (life.birthday) {
      localStorage.setItem('lifeglance-birthday', life.birthday)
      if (life.birthdayUpdatedAt) localStorage.setItem('lifeglance-birthday-updated-at', life.birthdayUpdatedAt)
    }

    // Apply categories
    if (Array.isArray(life.categories) && life.categories.length > 0) {
      saveCategories(life.categories)
      if (life.categoriesUpdatedAt) localStorage.setItem('lifeglance-categories-updated-at', life.categoriesUpdatedAt)
    }

    // Reload React state
    const [freshMilestones, freshChapters] = await Promise.all([dbGetAll(), dbGetAllChapters()]);
    setMilestones(freshMilestones);
    setChapters(freshChapters);

    // First-restore signal: a device that held no milestones just received some
    // from the remote (a new-device restore, or the real payload arriving after
    // an encryption-handshake stub). Emit a one-time event so the UI can confirm
    // the restore is actually done — the sync dot goes green on the first ok
    // cycle, which alone doesn't tell the user their timeline has landed (#253).
    // Edge-only: currentMilestones was empty, so ordinary later syncs never fire.
    if (currentMilestones.length === 0 && freshMilestones.length > 0 &&
        typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lifeglance:restored', {
        detail: { count: freshMilestones.length },
      }));
    }
  };

// mergePayloads — synchronous CRDT merge
// `fileKey` names the file being merged ('webdav', 'icloud', 'direct-access'),
// so what this device remembers about one file is never read against another.
export const mergePayloads = (local, remote, { fileKey = 'file' } = {}) => {
  // A newer build that wrote the file asks this device to update.
  if (remote?.writers && typeof remote.writers === 'object') {
    for (const entry of Object.values(remote.writers)) noteWriter(entry);
  }
  noteFileWriters(local, remote, fileKey);

  const localLife = local?.lives?.default ?? {};
  const remoteLife = remote?.lives?.default ?? {};

  const lm = Array.isArray(localLife.milestones)  ? localLife.milestones  : []
  const rm = Array.isArray(remoteLife.milestones) ? remoteLife.milestones : []
  const lc = Array.isArray(localLife.chapters)    ? localLife.chapters    : []
  const rc = Array.isArray(remoteLife.chapters)   ? remoteLife.chapters   : []
  const lmt = localLife.milestoneTombstones ?? {};
  const rmt = remoteLife.milestoneTombstones ?? {};
  const lct = localLife.chapterTombstones ?? {};
  const rct = remoteLife.chapterTombstones ?? {};
  const ll  = Array.isArray(localLife.lifeRecords)  ? localLife.lifeRecords  : []
  const rl  = Array.isArray(remoteLife.lifeRecords) ? remoteLife.lifeRecords : []
  const llt = localLife.lifeTombstones ?? {};
  const rlt = remoteLife.lifeTombstones ?? {};
  const lr  = Array.isArray(localLife.relationships)  ? localLife.relationships  : []
  const rr  = Array.isArray(remoteLife.relationships) ? remoteLife.relationships : []
  const lrt = localLife.relationshipTombstones ?? {};
  const rrt = remoteLife.relationshipTombstones ?? {};

  // Shared fixed 90-day window, day-floored, and the SAME prune function as
  // the vault tier (tombstoneRetention.js) so the two tiers agree on every
  // entry — including undatable ones, which the package's pruneTombstones
  // drops but the shared fail-safe prune keeps. A disagreement there would
  // make a corrupt-timestamp entry flap between the tiers' merges.
  const cutoff = tombstoneCutoff();
  const milestoneTombstones = pruneTombstoneMap({ ...lmt, ...rmt }, cutoff);
  const chapterTombstones = pruneTombstoneMap({ ...lct, ...rct }, cutoff);

  const lifeTombstones = pruneTombstoneMap({ ...llt, ...rlt }, cutoff);
  const relationshipTombstones = pruneTombstoneMap({ ...lrt, ...rrt }, cutoff);

  const { merged: wholeMilestones } = mergeArrayById(lm, rm, milestoneTombstones, null,
    { idField: 'id', timestampField: 'updated_at' });
  // A milestone both sides hold whose Lives changed: merge lifeOps per Life
  // (mergeMilestones), so adding Mom here and Dad there keeps both. Records
  // without lifeOps keep the whole-record merge above, unchanged.
  const localById  = new Map(lm.map(m => [m.id, m]));
  const remoteById = new Map(rm.map(m => [m.id, m]));
  const mergedMilestones = wholeMilestones.map(m => {
    const l = localById.get(m.id), r = remoteById.get(m.id);
    return (l && r && (l.lifeOps || r.lifeOps)) ? mergeMilestones(l, r) : m;
  });
  // Life records: whole-record LWW, like chapters' scalars. The Me Life is
  // never dropped, whatever a tombstone says.
  const { merged: mergedLifeRecords } = mergeArrayById(ll, rl, withoutMe(lifeTombstones), null,
    { idField: 'id', timestampField: 'updated_at' });
  // Relationship edges: whole-record LWW too.
  const { merged: mergedRelationships } = mergeArrayById(lr, rr, relationshipTombstones, null,
    { idField: 'id', timestampField: 'updated_at' });
  const { merged: mergedChapters } = mergeArrayById(lc, rc, chapterTombstones, null,
    { idField: 'id', timestampField: 'updated_at' });

  // Last-writer-wins for birthday and categories using paired updatedAt timestamps
  const localBirthdayTs  = localLife.birthdayUpdatedAt  ? new Date(localLife.birthdayUpdatedAt).getTime()  : 0
  const remoteBirthdayTs = remoteLife.birthdayUpdatedAt ? new Date(remoteLife.birthdayUpdatedAt).getTime() : 0
  // Remote wins only when it is strictly newer (an intentional edit, including a
  // real clear), or on a timestamp tie when it actually carries a value. This
  // stops an empty remote birthday from clobbering a real local one — the common
  // trigger is legacy rows where both sides have no birthdayUpdatedAt (ts 0/0),
  // where a plain `>=` would let remote's empty string win. (`??` doesn't help:
  // an empty string isn't nullish, so it was treated as a real value.)
  const remoteBirthdayWins = remoteBirthdayTs > localBirthdayTs ||
    (remoteBirthdayTs === localBirthdayTs && (remoteLife.birthday ?? '') !== '')
  const mergedBirthday          = remoteBirthdayWins ? (remoteLife.birthday ?? '') : (localLife.birthday ?? '')
  const mergedBirthdayUpdatedAt = remoteBirthdayWins ? (remoteLife.birthdayUpdatedAt ?? localLife.birthdayUpdatedAt ?? '') : (localLife.birthdayUpdatedAt ?? '')

  const localCatsTs  = localLife.categoriesUpdatedAt  ? new Date(localLife.categoriesUpdatedAt).getTime()  : 0
  const remoteCatsTs = remoteLife.categoriesUpdatedAt ? new Date(remoteLife.categoriesUpdatedAt).getTime() : 0
  // Same guard as birthday above: on a timestamp tie (legacy rows with no
  // categoriesUpdatedAt, ts 0/0) an empty remote list must not clobber a real
  // local one. A strictly-newer remote still wins, including a genuine "cleared
  // all categories" edit.
  const remoteCatsWins = remoteCatsTs > localCatsTs ||
    (remoteCatsTs === localCatsTs && Array.isArray(remoteLife.categories) && remoteLife.categories.length > 0)
  const mergedCategories          = remoteCatsWins ? (remoteLife.categories ?? localLife.categories ?? []) : (localLife.categories ?? [])
  const mergedCategoriesUpdatedAt = remoteCatsWins ? (remoteLife.categoriesUpdatedAt ?? localLife.categoriesUpdatedAt ?? '') : (localLife.categoriesUpdatedAt ?? '')

  // Keys this build does not know are carried over as they are, remote over
  // local (this build never stores them, so in practice they come only from the
  // file). They are left out of localChanged and remoteChanged: there is
  // nothing to apply locally, and they never differ from the file's own.
  const mergedLife = {
    ...unknownKeys(localLife, KNOWN_LIFE_KEYS),
    ...unknownKeys(remoteLife, KNOWN_LIFE_KEYS),
    milestones: mergedMilestones, chapters: mergedChapters, milestoneTombstones, chapterTombstones,
    lifeRecords: mergedLifeRecords, lifeTombstones,
    relationships: mergedRelationships, relationshipTombstones,
    birthday: mergedBirthday, birthdayUpdatedAt: mergedBirthdayUpdatedAt,
    categories: mergedCategories, categoriesUpdatedAt: mergedCategoriesUpdatedAt,
  };

  const localChanged =
    JSON.stringify(mergedMilestones) !== JSON.stringify(lm) ||
    JSON.stringify(mergedChapters) !== JSON.stringify(lc) ||
    JSON.stringify(milestoneTombstones) !== JSON.stringify(lmt) ||
    JSON.stringify(chapterTombstones) !== JSON.stringify(lct) ||
    JSON.stringify(mergedLifeRecords) !== JSON.stringify(ll) ||
    JSON.stringify(lifeTombstones) !== JSON.stringify(llt) ||
    JSON.stringify(mergedRelationships) !== JSON.stringify(lr) ||
    JSON.stringify(relationshipTombstones) !== JSON.stringify(lrt) ||
    mergedBirthday !== (localLife.birthday ?? '') ||
    JSON.stringify(mergedCategories) !== JSON.stringify(localLife.categories ?? []);

  const writers = mergeWriters(local?.writers, remote?.writers);

  const remoteChanged =
    JSON.stringify(writers) !== JSON.stringify(mergeWriters(remote?.writers, {})) ||
    JSON.stringify(mergedMilestones) !== JSON.stringify(rm) ||
    JSON.stringify(mergedChapters) !== JSON.stringify(rc) ||
    JSON.stringify(milestoneTombstones) !== JSON.stringify(rmt) ||
    JSON.stringify(chapterTombstones) !== JSON.stringify(rct) ||
    JSON.stringify(mergedLifeRecords) !== JSON.stringify(rl) ||
    JSON.stringify(lifeTombstones) !== JSON.stringify(rlt) ||
    JSON.stringify(mergedRelationships) !== JSON.stringify(rr) ||
    JSON.stringify(relationshipTombstones) !== JSON.stringify(rrt) ||
    mergedBirthday !== (remoteLife.birthday ?? '') ||
    JSON.stringify(mergedCategories) !== JSON.stringify(remoteLife.categories ?? []);

  const data = {
    ...unknownKeys(local, KNOWN_TOP_KEYS),
    ...unknownKeys(remote, KNOWN_TOP_KEYS),
    writers,
    lives: {
      ...unknownKeys(local?.lives, new Set(['default'])),
      ...unknownKeys(remote?.lives, new Set(['default'])),
      default: mergedLife,
    },
  };

  return { data, localChanged, remoteChanged };
};

const withoutMe = (tombstones) => {
  const { [ME_LIFE_ID]: _me, ...rest } = tombstones;
  return rest;
};

// ── The Lives gate, file side (lifeGate.js) ─────────────────────────────────
// Every other device's `writers` entry is a sighting, dated by its day. A file
// that no longer holds this device's own entry, when this device last saw it
// there within the window (so the 60-day prune cannot explain it), was
// rewritten by a client older than Phase 1, which drops every key it does not
// know. That device cannot be named, only counted, per file.
const OWN_ENTRY_SEEN_PREFIX = 'lifeglance-own-writer-seen:';
const DAY_MS = 24 * 60 * 60 * 1000;

function noteFileWriters(local, remote, fileKey) {
  if (!remote || typeof remote !== 'object' || !remote.lives) return;   // no file yet
  const ownId = Object.keys(local?.writers ?? {})[0];
  const writers = remote.writers && typeof remote.writers === 'object' ? remote.writers : {};
  for (const [device, entry] of Object.entries(writers)) {
    if (device === ownId || typeof entry?.day !== 'string') continue;
    recordWriter(device, entry, Date.parse(`${entry.day}T00:00:00.000Z`));
  }
  if (!ownId || typeof localStorage === 'undefined') return;
  const key = OWN_ENTRY_SEEN_PREFIX + fileKey;
  if (writers[ownId]) {
    localStorage.setItem(key, writers[ownId].day);
    return;
  }
  const lastSeenDay = localStorage.getItem(key);
  const margin = (WRITER_WINDOW_DAYS - 1) * DAY_MS;
  if (lastSeenDay && Date.now() - Date.parse(`${lastSeenDay}T00:00:00.000Z`) < margin) {
    recordWriter(legacyFileKey(fileKey), { schema: 0 });
    localStorage.removeItem(key);   // one sighting per strip
  }
}
