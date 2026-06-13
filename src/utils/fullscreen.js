// Best-effort Fullscreen API wrappers for the watch-mode tour.
//
// Fullscreen requires transient user activation, so enterFullscreen() must be
// called from within a user gesture (e.g. the Watch button click). It resolves
// to true only if THIS call entered fullscreen — false if it's unsupported
// (e.g. iOS Safari), denied, or we were already fullscreen — so the caller
// knows whether it's responsible for exiting later.

const fullscreenElement = () =>
  document.fullscreenElement || document.webkitFullscreenElement || null

export function enterFullscreen(el = document.documentElement) {
  if (fullscreenElement()) return Promise.resolve(false)
  const req = el.requestFullscreen || el.webkitRequestFullscreen
  if (!req) return Promise.resolve(false)
  try {
    return Promise.resolve(req.call(el)).then(() => true, () => false)
  } catch {
    return Promise.resolve(false)
  }
}

export function exitFullscreen() {
  if (!fullscreenElement()) return Promise.resolve()
  const exit = document.exitFullscreen || document.webkitExitFullscreen
  if (!exit) return Promise.resolve()
  try {
    return Promise.resolve(exit.call(document)).catch(() => {})
  } catch {
    return Promise.resolve()
  }
}

export function isFullscreen() {
  return !!fullscreenElement()
}
