import { dirtyMilestoneTombstones, dirtyChapterTombstones } from './dirty.js';

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
  localStorage.setItem(MILESTONE_TOMBSTONE_KEY, JSON.stringify(t));
  dirtyMilestoneTombstones();
};

export const writeChapterTombstone = (id) => {
  if (!hasStorage) return;
  const t = getChapterTombstones();
  t[id] = new Date().toISOString();
  localStorage.setItem(CHAPTER_TOMBSTONE_KEY, JSON.stringify(t));
  dirtyChapterTombstones();
};
