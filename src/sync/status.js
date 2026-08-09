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
// GLANCEvault database-transport codes (vault DB sync is opt-in alongside
// WebDAV; note the vault engine's onError is not yet wired into the UI — the
// mapping keeps the presentation layer ready for when it is):
//   KEY_MISMATCH         — wrong sync passphrase for this account's existing data.
//   VERIFIER_UNSUPPORTED — the sync server is too old to host the key verifier.
//   CREDENTIAL_INVALID   — the vault revoked this device's token; the engine
//                          hard-halts the cycle (sync 1.10+, isHardStop true).
//   QUOTA_EXCEEDED       — the vault reports the account over quota; pushes
//                          back off and retry automatically (sync 1.10+).
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
  // GLANCEvault database transport
  KEY_MISMATCH: 'wrongPassphrase',
  VERIFIER_UNSUPPORTED: 'verifierUnsupported',
  CREDENTIAL_INVALID: 'credentialInvalid',
  QUOTA_EXCEEDED: 'quotaExceeded',
}

// Resolves an error object ({ message, code }) to display text, translating
// known codes via `t` (bound to the 'sync' namespace) and otherwise returning
// the engine's raw message. Returns null when there is no error.
export const syncErrorText = (syncError, t) => {
  if (!syncError) return null
  const key = SYNC_ERROR_I18N_KEYS[syncError.code]
  return key ? t(key) : syncError.message
}

// Two sync tiers, one indicator. Each engine owns its OWN error state — the
// WebDAV tier's ({message, code} + its halted flag) and the vault tier's
// ({message, code, hard} from the DB engine's onError) — because wiring both
// engines to one state would let their cycles clobber/clear each other's
// errors. Precedence is applied here, at render time:
//   1. A vault HARD halt (sync 1.10 CREDENTIAL_INVALID, isHardStop=true)
//      outranks everything: the engine has terminally stopped and re-surfaces
//      the halt on every attempted cycle, so it stays visible until recovery.
//   2. Otherwise the WebDAV tier's error wins (its halted flag is
//      tier-specific and its wiring is the long-established one).
//   3. Otherwise a transient vault error shows.
// Returns { error, halted } in the exact shape the existing indicator and
// modal props consume.
export const combineTierErrors = (syncError, syncHalted, vaultError) => {
  if (vaultError?.hard) return { error: vaultError, halted: true }
  if (syncError) return { error: syncError, halted: !!syncHalted }
  return { error: vaultError ?? null, halted: !!syncHalted }
}
