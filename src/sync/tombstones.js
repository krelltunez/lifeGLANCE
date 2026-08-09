import { dirtyMilestoneTombstones, dirtyChapterTombstones } from './dirty.js';
import { tombstoneCutoff, pruneTombstoneMap } from './tombstoneRetention.js';

const MILESTONE_TOMBSTONE_KEY = 'lifeglance-milestone-tombstones';
const CHAPTER_TOMBSTONE_KEY = 'lifeglance-chapter-tombstones';

const hasStorage = typeof localStorage !== 'undefined';

export const getMilestoneTombstones = () => {
  if (!hasStorage) return {};
  return JSON.parse(localStorage.getItem(MILESTONE_TOMBSTONE_KEY) || '{}');
};

export const getChapterTombstones = () => {
  if (!hasStorage) return {};
  return JSON.parse(localStorage.getItem(CHAPTER_TOMBSTONE_KEY) || '{}');
};

export const writeMilestoneTombstone = (id) => {
  if (!hasStorage) return;
  const t = getMilestoneTombstones();
  t[id] = new Date().toISOString();
  // Prune on write (#287): a real deletion is already pushing this bundle, so
  // aging out old entries here adds no churn and bounds the local map even on
  // a single-device install that never merges.
  localStorage.setItem(MILESTONE_TOMBSTONE_KEY, JSON.stringify(pruneTombstoneMap(t, tombstoneCutoff())));
  dirtyMilestoneTombstones();
};

export const writeChapterTombstone = (id) => {
  if (!hasStorage) return;
  const t = getChapterTombstones();
  t[id] = new Date().toISOString();
  localStorage.setItem(CHAPTER_TOMBSTONE_KEY, JSON.stringify(pruneTombstoneMap(t, tombstoneCutoff())));
  dirtyChapterTombstones();
};
