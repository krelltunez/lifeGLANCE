// Reissue a filesystem call that a signal interrupted. From dayGLANCE's
// electron/fsRetry.ts, by way of lastGLANCE's.
//
// Seen in dayGLANCE's Mac App Store build:
//
//     iCloud unavailable: EINTR: interrupted system call, read
//
// EINTR means the syscall was interrupted before it transferred anything. It is
// not an iCloud problem, a permissions problem or a missing file, and the right
// response has always been to make the call again. Reads and writes under
// ~/Library/Mobile Documents are unusually exposed to it, because the iCloud
// daemon is working on the file underneath.
//
// No delay between attempts, on purpose: the signal has already been handled by
// the time the call returns, so an immediate reissue normally succeeds, and a
// sleep would block the main process.

/**
 * Errno codes that mean "the call did not happen, try it again".
 *
 * Narrow on purpose. EBUSY can last as long as another process holds the file,
 * and ENOENT is a real answer that callers already handle; retrying either
 * turns a fast, correct result into a slow, identical one.
 */
export const TRANSIENT_FS_CODES = new Set(['EINTR', 'EAGAIN'])

export function isTransientFsError(err) {
  if (!err || typeof err !== 'object') return false
  return typeof err.code === 'string' && TRANSIENT_FS_CODES.has(err.code)
}

/**
 * Run a synchronous filesystem operation, reissuing it on a transient
 * interruption. Anything else is rethrown on the first attempt, and so is a
 * transient error that outlasts every attempt.
 *
 * @template T
 * @param {() => T} op
 * @param {number} [attempts] total attempts including the first (minimum 1)
 * @returns {T}
 */
export function retryTransientFs(op, attempts = 3) {
  const total = Math.max(1, attempts)
  let lastErr
  for (let i = 0; i < total; i++) {
    try {
      return op()
    } catch (err) {
      if (!isTransientFsError(err)) throw err
      lastErr = err
    }
  }
  throw lastErr
}
