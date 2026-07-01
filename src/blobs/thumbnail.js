// =============================================================================
// thumbnail — blob thumbnail / poster generation (Phase 7, client step 3)
// =============================================================================
//
// Produces a thumbnail as its OWN plaintext image bytes, ready to hand to the
// blob upload path (blobTransport.uploadBlob), which encrypts + content-addresses
// them like any blob. Per the spec, a thumbnail is CONTENT, not a per-device
// derivative: the uploading device generates it ONCE at upload time, and it then
// becomes its own content-addressed, encrypted blob — synced and cached like any
// other content, never regenerated per device.
//
// THIS MODULE GENERATES BYTES ONLY. It does NOT encrypt, address, or upload (that
// is blobCrypto/blobTransport's job), and it does NOT touch milestones or the
// upload flow (that is the next wiring step). It has no UI, sync, milestone, or
// crypto imports, so — like the other blob modules — it can be lifted into a
// shared `@glance-apps/*` package later. (FUTURE: extract.)
//
// ENVIRONMENT: this runs on-device in a webview (browser / Capacitor), NOT in
// Node. Images are downscaled/re-encoded with createImageBitmap + OffscreenCanvas;
// video poster frames are grabbed with a <video> element + canvas. Those
// primitives don't exist in jsdom/node, so the image-processing primitive is an
// INJECTABLE dependency (`ImageProcessor`) — mirroring how blobCrypto/blobTransport
// made their root-key/connection/fetch dependencies injectable. The real,
// browser-backed processor (`browserImageProcessor`) is the default and is
// exercised IN-APP; tests inject a fake processor (see thumbnail.test.js).
//
// FAIL CLEANLY (load-bearing): if the source is corrupt, an unsupported format,
// or generation otherwise fails, this throws a typed `ThumbnailGenerationError`
// and returns NOTHING — no partial bytes. The caller (the milestone upload flow,
// next step) must treat that as a failed upload and NOT publish a milestone that
// references a thumbnail which was never made. This module only throws the clean
// typed error; it does not itself touch milestones.
// =============================================================================

/** Longest-edge bound (px) for a generated thumbnail. Aspect ratio is preserved. */
export const MAX_THUMBNAIL_EDGE = 512

/** Default output encoding for the thumbnail bytes. */
export const DEFAULT_OUTPUT_MIME = 'image/jpeg'

/** Default lossy-encode quality (0..1) for the thumbnail. */
export const DEFAULT_QUALITY = 0.8

/** Default timestamp (seconds) to grab a video poster frame from. */
export const POSTER_FRAME_TIME_SECONDS = 1

/**
 * Hard bound (ms) on EACH await in video poster generation. A native WebView can
 * silently never fire `loadedmetadata` / `seeked` (a detached <video>, or a codec
 * it can't decode without emitting `error`), which would otherwise hang the whole
 * media upload forever. Each step is raced against this so it can never block.
 */
export const VIDEO_POSTER_TIMEOUT_MS = 10000

/**
 * Thrown when a thumbnail cannot be produced (corrupt/unsupported source, or any
 * decode/encode failure). A clean, typed failure with NO partial output — the
 * caller treats it as a failed upload and publishes nothing referencing a
 * thumbnail that was never made.
 */
export class ThumbnailGenerationError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'ThumbnailGenerationError'
  }
}

/** Classify a source mime type. Returns null for anything we can't thumbnail. */
export function sourceKind(mimeType) {
  if (typeof mimeType !== 'string') return null
  const m = mimeType.toLowerCase().trim()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  return null
}

function isPositiveInt(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/**
 * Fit `(width, height)` within a `maxEdge` longest-edge bound, preserving aspect
 * ratio. Never upscales: a source already within the bound is returned unchanged.
 * Pure — no platform dependency — so it's directly testable.
 */
export function fitWithin(width, height, maxEdge) {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Generate a thumbnail / poster image from a source blob's bytes.
 *
 * - IMAGE source: decode → downscale to {@link MAX_THUMBNAIL_EDGE} (longest edge,
 *   aspect preserved) → re-encode → bytes.
 * - VIDEO source: grab a poster frame (~`posterTimeSeconds`) → downscale the same
 *   way → encode → bytes. (A static poster is the required minimum; a short
 *   preview clip is an optional future addition.)
 *
 * Returns the thumbnail's RAW PLAINTEXT image bytes plus their mime type. It does
 * NOT encrypt, address, or upload — hand the result to blobTransport.uploadBlob,
 * which encrypts + content-addresses it like any blob.
 *
 * @throws {ThumbnailGenerationError} on unsupported/corrupt source or any
 *         decode/encode failure — cleanly, with no partial output.
 */
export async function generateThumbnail(sourceBytes, mimeType, opts = {}) {
  const processor = opts.processor ?? browserImageProcessor
  const maxEdge = opts.maxEdge ?? MAX_THUMBNAIL_EDGE
  const outputMimeType = opts.outputMimeType ?? DEFAULT_OUTPUT_MIME
  const quality = opts.quality ?? DEFAULT_QUALITY
  const posterTime = opts.posterTimeSeconds ?? POSTER_FRAME_TIME_SECONDS

  if (!(sourceBytes instanceof Uint8Array) || sourceBytes.length === 0) {
    throw new ThumbnailGenerationError('source bytes are empty or not a Uint8Array')
  }

  const kind = sourceKind(mimeType)
  if (!kind) {
    throw new ThumbnailGenerationError(`unsupported source type: ${mimeType || '(none)'}`)
  }

  // Decode (platform). A corrupt or undecodable source surfaces here.
  let decoded
  try {
    decoded =
      kind === 'video'
        // Overall bound on video decode, on TOP of the per-step timeouts inside
        // the browser processor: no processor (real or injected) can make this
        // await forever. The inner per-step timeout normally fires first and names
        // the stalling step; this is the backstop (and the seam tests exercise).
        ? await withTimeout(
            processor.decodeVideoFrame(sourceBytes, mimeType, posterTime),
            opts.videoPosterTimeoutMs ?? (VIDEO_POSTER_TIMEOUT_MS + 2000),
            'decodeVideoFrame',
          )
        : await processor.decodeImage(sourceBytes, mimeType)
  } catch (err) {
    throw new ThumbnailGenerationError(`failed to decode ${kind} source`, { cause: err })
  }
  if (!decoded || !isPositiveInt(decoded.width) || !isPositiveInt(decoded.height)) {
    throw new ThumbnailGenerationError('decoder returned invalid dimensions')
  }

  const target = fitWithin(decoded.width, decoded.height, maxEdge)

  // Downscale + encode (platform).
  let bytes
  try {
    bytes = await processor.encode(decoded, target.width, target.height, outputMimeType, quality)
  } catch (err) {
    throw new ThumbnailGenerationError('failed to encode thumbnail', { cause: err })
  }
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new ThumbnailGenerationError('encoder produced no bytes')
  }

  return { bytes, mimeType: outputMimeType }
}

// =============================================================================
// browserImageProcessor — the real, on-device primitive (NOT run in tests)
// -----------------------------------------------------------------------------
// Uses webview canvas APIs. None of these globals are touched at import time
// (every reference is inside a method), so importing this module under jsdom/node
// is safe; the methods themselves only run in-app, where tests inject a fake.
// =============================================================================

function requireGlobal(name) {
  const g = globalThis[name]
  if (g == null) throw new Error(`thumbnail: ${name} is not available in this environment`)
  return g
}

async function decodeWith(createBitmap) {
  const bitmap = await createBitmap()
  return { width: bitmap.width, height: bitmap.height, source: bitmap }
}

export const browserImageProcessor = {
  async decodeImage(bytes, mimeType) {
    const createImageBitmap = requireGlobal('createImageBitmap')
    const blob = new Blob([bytes], { type: mimeType })
    return decodeWith(() => createImageBitmap(blob))
  },

  async decodeVideoFrame(bytes, mimeType, atSeconds) {
    const createImageBitmap = requireGlobal('createImageBitmap')
    const doc = requireGlobal('document')
    const URLg = requireGlobal('URL')
    const blob = new Blob([bytes], { type: mimeType })
    const url = URLg.createObjectURL(blob)
    const video = doc.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    // Lightweight step logging so an on-device run reveals WHERE the WebView
    // stalls (which await never completed) rather than failing opaquely.
    const step = (msg) => { try { console.warn(`[thumbnail:video] ${msg}`) } catch { /* ignore */ } }
    try {
      video.src = url
      step('loading metadata…')
      await withTimeout(onceEvent(video, 'loadedmetadata'), VIDEO_POSTER_TIMEOUT_MS, 'loadedmetadata')
      step(`metadata loaded (duration=${video.duration}, ${video.videoWidth}x${video.videoHeight}); seeking…`)
      const duration = Number.isFinite(video.duration) ? video.duration : atSeconds
      const seekTo = Math.min(atSeconds, Math.max(0, duration))
      await withTimeout(seekVideo(video, Number.isFinite(seekTo) ? seekTo : 0), VIDEO_POSTER_TIMEOUT_MS, 'seeked')
      step('seek complete; grabbing frame (createImageBitmap)…')
      const frame = await withTimeout(createImageBitmap(video), VIDEO_POSTER_TIMEOUT_MS, 'createImageBitmap(video)')
      step('frame grabbed OK')
      return {
        width: frame.width || video.videoWidth,
        height: frame.height || video.videoHeight,
        source: frame,
      }
    } catch (err) {
      step(`FAILED: ${err?.message || err}`)
      throw err
    } finally {
      URLg.revokeObjectURL(url)
    }
  },

  async encode(image, targetWidth, targetHeight, mimeType, quality) {
    const OffscreenCanvasG = requireGlobal('OffscreenCanvas')
    const canvas = new OffscreenCanvasG(targetWidth, targetHeight)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('thumbnail: could not get a 2d canvas context')
    ctx.drawImage(image.source, 0, 0, targetWidth, targetHeight)
    const blob = await canvas.convertToBlob({ type: mimeType, quality })
    return new Uint8Array(await blob.arrayBuffer())
  },
}

// Race a promise against a timeout so a media-element await can NEVER block
// forever. On timeout, rejects with a clear label naming the step that stalled.
// The underlying promise is abandoned (the caller cleans up the <video>/object
// URL in its finally), which is the whole point: we stop waiting on the WebView.
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`video poster timed out after ${ms}ms at step: ${label}`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function onceEvent(target, name) {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup()
      resolve()
    }
    const onErr = () => {
      cleanup()
      reject(new Error(`thumbnail: <video> emitted "error" waiting for "${name}"`))
    }
    const cleanup = () => {
      target.removeEventListener(name, onOk)
      target.removeEventListener('error', onErr)
    }
    target.addEventListener(name, onOk, { once: true })
    target.addEventListener('error', onErr, { once: true })
  })
}

function seekVideo(video, seconds) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onErr = () => {
      cleanup()
      reject(new Error('thumbnail: <video> errored while seeking'))
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onErr)
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onErr, { once: true })
    video.currentTime = seconds
  })
}
