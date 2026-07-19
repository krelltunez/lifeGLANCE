import { mergeArrayById, pruneTombstones } from '@glance-apps/sync';
import { dbGetAll, dbGetAllChapters, dbPut, dbDelete, dbPutChapter, dbDeleteChapter } from '../data/db.js';
import { getMilestoneTombstones, getChapterTombstones } from './tombstones.js';
import { loadCategories, saveCategories } from '../utils/colors.js';

// How long a deletion tombstone is kept before mergePayloads prunes it. Beyond
// this window a device that has been offline the whole time still holds the
// deleted item but no longer sees a tombstone for it, so on reconnect the item
// is re-introduced (resurrected) instead of staying deleted. 90 days is the
// grace period for that edge case — raising it widens the safe-offline window
// at the cost of retaining more tombstones; don't lower it without accounting
// for the increased resurrection risk.
const RETENTION_MS = 90 * 86_400_000;

// buildPayload — reads live IDB state. Called before every upload.
// Accepts a milestonesRef so it can read the latest React state for milestones
// (avoiding stale closures), but falls back to IDB for robustness.
export const buildPayload = async (milestonesRef, chaptersRef) => {
  // IDB is authoritative. Refs are used only when non-empty to avoid stale
  // empty state (e.g. before IDB loads into React) overwriting real data.
  const [idbMilestones, idbChapters] = await Promise.all([dbGetAll(), dbGetAllChapters()])
  const milestones = (milestonesRef?.current?.length > 0) ? milestonesRef.current : idbMilestones
  const chapters   = (chaptersRef?.current?.length   > 0) ? chaptersRef.current   : idbChapters
  const payload = {
    lives: {
      default: {
        milestones,
        chapters,
        milestoneTombstones: getMilestoneTombstones(),
        chapterTombstones: getChapterTombstones(),
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
  const [milestones, chapters] = await Promise.all([dbGetAll(), dbGetAllChapters()]);
  return {
    lives: {
      default: {
        milestones,
        chapters,
        milestoneTombstones: getMilestoneTombstones(),
        chapterTombstones: getChapterTombstones(),
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
export const mergePayloads = (local, remote) => {
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

  const cutoff = new Date(Date.now() - RETENTION_MS);
  const milestoneTombstones = pruneTombstones({ ...lmt, ...rmt }, cutoff);
  const chapterTombstones = pruneTombstones({ ...lct, ...rct }, cutoff);

  const { merged: mergedMilestones } = mergeArrayById(lm, rm, milestoneTombstones, null,
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

  const mergedLife = {
    milestones: mergedMilestones, chapters: mergedChapters, milestoneTombstones, chapterTombstones,
    birthday: mergedBirthday, birthdayUpdatedAt: mergedBirthdayUpdatedAt,
    categories: mergedCategories, categoriesUpdatedAt: mergedCategoriesUpdatedAt,
  };

  const localChanged =
    JSON.stringify(mergedMilestones) !== JSON.stringify(lm) ||
    JSON.stringify(mergedChapters) !== JSON.stringify(lc) ||
    JSON.stringify(milestoneTombstones) !== JSON.stringify(lmt) ||
    JSON.stringify(chapterTombstones) !== JSON.stringify(lct) ||
    mergedBirthday !== (localLife.birthday ?? '') ||
    JSON.stringify(mergedCategories) !== JSON.stringify(localLife.categories ?? []);

  const remoteChanged =
    JSON.stringify(mergedMilestones) !== JSON.stringify(rm) ||
    JSON.stringify(mergedChapters) !== JSON.stringify(rc) ||
    JSON.stringify(milestoneTombstones) !== JSON.stringify(rmt) ||
    JSON.stringify(chapterTombstones) !== JSON.stringify(rct) ||
    mergedBirthday !== (remoteLife.birthday ?? '') ||
    JSON.stringify(mergedCategories) !== JSON.stringify(remoteLife.categories ?? []);

  return { data: { lives: { default: mergedLife } }, localChanged, remoteChanged };
};
