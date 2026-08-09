// Standing-backoff display state for the Cloud Sync modal (issue #307) — the
// lifeGLANCE port of lastGLANCE's backoffStatus, which was built to lift as-is.
//
// The sync 1.10 engine treats onError as an EVENT STREAM, not a status store:
// a cycle that runs fires its onError(null) reset even when a backoff window
// suppresses one half, so the vaultError state (App.jsx / combineTierErrors)
// goes blank during quiet transport/auth windows while sync genuinely is not
// retrying. The engine added getBackoffState() for exactly this — render the
// standing window from it instead. This module is the pure half (injected
// clock, unit-tested).
//
// Scope rules:
//   - 'transport' and 'auth' windows are described here.
//   - 'quota' windows are EXCLUDED: the engine re-surfaces QUOTA_EXCEEDED
//     (with its descriptor) on every cycle, so quota already has a standing
//     display; a second banner would double-report.
//   - The credential halt never opens a window and has its own display.
//   - A lapsed-but-uncleared window (until in the past; the engine clears it
//     only when a cycle SUCCEEDS) reports secondsLeft 0 — "retrying on the
//     next sync" — rather than vanishing, because sync is still unproven.

/**
 * @typedef {object} BackoffDescriptor
 * @property {'transport'|'auth'} reason
 * @property {'push'|'pull'} side
 * @property {number} until
 * @property {number} secondsLeft  whole seconds to the next automatic retry; 0 once lapsed
 */

/**
 * @param {{push: object, pull: object}|null|undefined} state  engine.getBackoffState()
 * @param {number} nowMs
 * @returns {BackoffDescriptor|null}
 */
export function describeBackoff(state, nowMs) {
  if (!state) return null
  const all = [
    { side: 'push', w: state.push },
    { side: 'pull', w: state.pull },
  ]
  const candidates = all.filter(({ w }) => w && w.until > 0 && (w.reason === 'transport' || w.reason === 'auth'))
  if (candidates.length === 0) return null
  // With both windows open, the later `until` is the binding constraint (and an
  // auth window's flat hour naturally outranks a transport ladder, surfacing
  // the more actionable message).
  const { side, w } = candidates.reduce((a, b) => (b.w.until > a.w.until ? b : a))
  return {
    reason: w.reason,
    side,
    until: w.until,
    secondsLeft: Math.max(0, Math.ceil((w.until - nowMs) / 1000)),
  }
}

// The user-facing line for a standing window. `t` is bound to the 'sync'
// namespace (lifeGLANCE's flat sync.json keys):
//   transport, counting down -> backoffTransport ("Retrying in {{seconds}}s.")
//   auth                     -> backoffAuth (flat hour; no countdown — a
//                               ticking 3600s would imply precision the flat
//                               window doesn't have)
//   lapsed (secondsLeft 0)   -> backoffRetrying
export function backoffStatusText(t, d) {
  if (!d) return null
  if (d.secondsLeft === 0) return t('backoffRetrying')
  if (d.reason === 'auth') return t('backoffAuth')
  return t('backoffTransport', { seconds: d.secondsLeft })
}
