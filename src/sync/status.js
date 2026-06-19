// Status vocabulary reported by the cloud sync engine (@glance-apps/sync).
// The engine emits: 'uploading', 'downloading', 'success', 'error', 'idle'.
// 'uploading' / 'downloading' are the in-flight states; the rest are terminal.
export const isSyncing = (status) =>
  status === 'uploading' || status === 'downloading'

// Maps typed engine error codes (the 2nd arg of onError) to user-facing i18n
// keys in the 'sync' namespace. Codes absent from this map fall back to the raw
// engine message. These codes only fire on the GLANCEvault database transport;
// the file-tier engine lifeGLANCE currently uses never emits them, so the
// mapping is inert until the cutover but keeps the presentation layer ready.
//   KEY_MISMATCH         — wrong sync passphrase for this account's existing data.
//   VERIFIER_UNSUPPORTED — the sync server is too old to host the key verifier.
// ACCOUNT_ID_REQUIRED is intentionally absent: it's a benign, retryable startup
// race handled (suppressed) in the engine's onError, not surfaced as an error.
export const SYNC_ERROR_I18N_KEYS = {
  KEY_MISMATCH: 'wrongPassphrase',
  VERIFIER_UNSUPPORTED: 'verifierUnsupported',
}

// Resolves an error object ({ message, code }) to display text, translating
// known codes via `t` (bound to the 'sync' namespace) and otherwise returning
// the engine's raw message. Returns null when there is no error.
export const syncErrorText = (syncError, t) => {
  if (!syncError) return null
  const key = SYNC_ERROR_I18N_KEYS[syncError.code]
  return key ? t(key) : syncError.message
}
