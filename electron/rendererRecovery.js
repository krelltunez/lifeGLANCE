// What to do when the renderer process dies (docs/desktop-app.md,
// "Hardening"). The whole decision is here, tested without Electron; main.js
// wires it to render-process-gone. From dayGLANCE's
// electron/rendererRecovery.ts, by way of lastGLANCE's.
//
// A ladder inside a rolling window: the first qualifying crash reloads the
// window (cheapest, and it keeps the bounds and fullscreen state), a second
// destroys and recreates it (a poisoned renderer can survive a reload), and
// anything further gives up rather than loop. Attempts older than the window
// are forgotten: a crash a day after the last one is a new incident.
//
// Never recovered from:
//  - 'clean-exit': ordinary teardown and navigation.
//  - isQuitting: recovery must not fight the shutdown. The caller checks the
//    flag again inside its deferred tick, for a crash a moment before quit.
//  - unknown reasons (e.g. 'integrity-failure'): logged only.
//
// 'launch-failed' means the renderer never loaded, so its first rung is a full
// loadURL rather than a reload of a frame that never had content.

export const RECOVER_REASONS = Object.freeze(['crashed', 'oom', 'killed', 'abnormal-exit'])
export const RECOVERY_WINDOW_MS = 30_000
/** reload (or load-url), then recreate, then stop. */
export const MAX_RECOVERY_ATTEMPTS = 3

/**
 * @param {object} input
 * @param {string} input.reason  the render-process-gone reason
 * @param {boolean} input.isQuitting
 * @param {number[]} input.attempts  when earlier recoveries ran
 * @param {number} input.now
 * @param {number} [input.windowMs]
 * @param {number} [input.maxAttempts]
 * @returns {{ action: 'ignore' | 'reload' | 'load-url' | 'recreate' | 'give-up', attempts: number[] }}
 *   `attempts` is the caller's next list: pruned, and appended to only when acting.
 */
export function decideRecovery(input) {
  const windowMs = input.windowMs ?? RECOVERY_WINDOW_MS
  const maxAttempts = input.maxAttempts ?? MAX_RECOVERY_ATTEMPTS
  const recent = (input.attempts ?? []).filter((t) => input.now - t < windowMs)

  if (input.isQuitting) return { action: 'ignore', attempts: recent }
  // An allowlist: 'clean-exit' and unknown reasons are out by not being listed.
  const qualifies = RECOVER_REASONS.includes(input.reason) || input.reason === 'launch-failed'
  if (!qualifies) return { action: 'ignore', attempts: recent }

  // The rung is the count of recent attempts: 0 reload, 1 recreate, and the
  // last never acts, so a run of crashes performs maxAttempts - 1 recoveries.
  if (recent.length >= maxAttempts - 1) return { action: 'give-up', attempts: recent }
  const firstRung = input.reason === 'launch-failed' ? 'load-url' : 'reload'
  return {
    action: recent.length === 0 ? firstRung : 'recreate',
    attempts: [...recent, input.now],
  }
}
