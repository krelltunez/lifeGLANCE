// Status vocabulary reported by the cloud sync engine (@glance-apps/sync).
// The engine emits: 'uploading', 'downloading', 'success', 'error', 'idle'.
// 'uploading' / 'downloading' are the in-flight states; the rest are terminal.
export const isSyncing = (status) =>
  status === 'uploading' || status === 'downloading'
