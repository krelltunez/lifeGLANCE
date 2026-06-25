// Status vocabulary reported by the cloud sync engine (@glance-apps/sync).
// The engine emits: 'uploading', 'downloading', 'success', 'error', 'idle'.
// 'uploading' / 'downloading' are the in-flight states; the rest are terminal.
export const isSyncing = (status) =>
  status === 'uploading' || status === 'downloading'

// Maps typed engine error codes (the 2nd arg of onError) to user-facing i18n
// keys in the 'sync' namespace. Codes absent from this map fall back to the raw
// engine message (which the engine already renders in English). The package
// emits the code alongside the message, so localising is a client-only concern:
// look the code up here, otherwise show the engine's message.
//
// WebDAV file-tier codes (emitted today, see classifyError in @glance-apps/sync):
//   AUTH_FAILURE                — 401: bad username / password.
//   FORBIDDEN                   — 403: the server refused the request.
//   LOCKED                      — 423: another device holds the lock.
//   NETWORK_ERROR               — connection failed / unclassified transport error.
//   PRECONDITION_FAILED         — 412: another device wrote first; retried.
//   PASSPHRASE_REQUIRED         — encryption is on but no passphrase is in session.
//   APP_ID_MISMATCH             — the remote file belongs to a different app.
//   SCHEMA_FORWARD_INCOMPATIBLE — the remote file is from a newer app version.
//
// GLANCEvault database-transport codes (inert until that cutover; lifeGLANCE is
// WebDAV-only today, but the mapping keeps the presentation layer ready):
//   KEY_MISMATCH         — wrong sync passphrase for this account's existing data.
//   VERIFIER_UNSUPPORTED — the sync server is too old to host the key verifier.
//
// ACCOUNT_ID_REQUIRED is intentionally absent: it's a benign, retryable startup
// race handled (suppressed) in the engine's onError, not surfaced as an error.
//
// Note: the "Test Connection" path is deliberately NOT covered here. The engine's
// test()/connection-test returns { success, error } with no code, so its result
// string can't be keyed; CloudSyncModal renders that raw English error as-is.
export const SYNC_ERROR_I18N_KEYS = {
  // WebDAV file-tier transport
  AUTH_FAILURE: 'authFailed',
  FORBIDDEN: 'forbidden',
  LOCKED: 'locked',
  NETWORK_ERROR: 'networkError',
  PRECONDITION_FAILED: 'preconditionFailed',
  PASSPHRASE_REQUIRED: 'passphraseRequired',
  APP_ID_MISMATCH: 'appIdMismatch',
  SCHEMA_FORWARD_INCOMPATIBLE: 'schemaForwardIncompatible',
  // GLANCEvault database transport (inert until cutover)
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
