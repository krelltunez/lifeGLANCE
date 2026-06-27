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
 * Thrown when a thumbnail cannot be produced (corrupt/unsupported source, or any
 * decode/encode failure). A clean, typed failure with NO partial output — the
 * caller treats it as a failed upload and publishes nothing referencing a
 * thumbnail that was never made.
 */
export class ThumbnailGenerationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ThumbnailGenerationError'
  }
}

/** A decoded raster image: its pixel dimensions plus an opaque drawable source. */
export interface RasterImage {
  width: number
  height: number
  /** Opaque handle the processor's own `encode` knows how to draw (e.g. ImageBitmap). */
  source: unknown
}

/**
 * The platform image-processing primitive. The real implementation uses browser
 * canvas APIs; tests inject a fake. Kept tiny and side-effect-explicit so it can
 * be swapped per platform.
 */
export interface ImageProcessor {
  /** Decode still-image bytes into a drawable raster (with dimensions). */
  decodeImage(bytes: Uint8Array, mimeType: string): Promise<RasterImage>
  /** Grab a poster frame from video bytes at ~`atSeconds` into a drawable raster. */
  decodeVideoFrame(bytes: Uint8Array, mimeType: string, atSeconds: number): Promise<RasterImage>
  /** Downscale `image` to `targetWidth`×`targetHeight` and encode to `mimeType` bytes. */
  encode(
    image: RasterImage,
    targetWidth: number,
    targetHeight: number,
    mimeType: string,
    quality: number,
  ): Promise<Uint8Array>
}

/** Options for {@link generateThumbnail}. All optional; sensible defaults apply. */
export interface ThumbnailOptions {
  /** Image-processing primitive. Defaults to the browser-backed processor. */
  processor?: ImageProcessor
  /** Longest-edge bound in px. Defaults to {@link MAX_THUMBNAIL_EDGE}. */
  maxEdge?: number
  /** Output mime type. Defaults to {@link DEFAULT_OUTPUT_MIME}. */
  outputMimeType?: string
  /** Encode quality 0..1. Defaults to {@link DEFAULT_QUALITY}. */
  quality?: number
  /** Video poster timestamp (s). Defaults to {@link POSTER_FRAME_TIME_SECONDS}. */
  posterTimeSeconds?: number
}

export type SourceKind = 'image' | 'video'

/** Classify a source mime type. Returns null for anything we can't thumbnail. */
export function sourceKind(mimeType: string | undefined | null): SourceKind | null {
  if (typeof mimeType !== 'string') return null
  const m = mimeType.toLowerCase().trim()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  return null
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/**
 * Fit `(width, height)` within a `maxEdge` longest-edge bound, preserving aspect
 * ratio. Never upscales: a source already within the bound is returned unchanged.
 * Pure — no platform dependency — so it's directly testable.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
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
export async function generateThumbnail(
  sourceBytes: Uint8Array,
  mimeType: string,
  opts: ThumbnailOptions = {},
): Promise<{ bytes: Uint8Array; mimeType: string }> {
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
  let decoded: RasterImage
  try {
    decoded =
      kind === 'video'
        ? await processor.decodeVideoFrame(sourceBytes, mimeType, posterTime)
        : await processor.decodeImage(sourceBytes, mimeType)
  } catch (err) {
    throw new ThumbnailGenerationError(`failed to decode ${kind} source`, { cause: err })
  }
  if (!decoded || !isPositiveInt(decoded.width) || !isPositiveInt(decoded.height)) {
    throw new ThumbnailGenerationError('decoder returned invalid dimensions')
  }

  const target = fitWithin(decoded.width, decoded.height, maxEdge)

  // Downscale + encode (platform).
  let bytes: Uint8Array
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

function requireGlobal<T>(name: string): T {
  const g = (globalThis as any)[name]
  if (g == null) throw new Error(`thumbnail: ${name} is not available in this environment`)
  return g as T
}

async function decodeWith(createBitmap: () => Promise<any>): Promise<RasterImage> {
  const bitmap = await createBitmap()
  return { width: bitmap.width, height: bitmap.height, source: bitmap }
}

export const browserImageProcessor: ImageProcessor = {
  async decodeImage(bytes, mimeType) {
    const createImageBitmap = requireGlobal<(b: any) => Promise<any>>('createImageBitmap')
    const blob = new Blob([bytes as BlobPart], { type: mimeType })
    return decodeWith(() => createImageBitmap(blob))
  },

  async decodeVideoFrame(bytes, mimeType, atSeconds) {
    const createImageBitmap = requireGlobal<(b: any) => Promise<any>>('createImageBitmap')
    const doc = requireGlobal<any>('document')
    const URLg = requireGlobal<any>('URL')
    const blob = new Blob([bytes as BlobPart], { type: mimeType })
    const url = URLg.createObjectURL(blob)
    const video: any = doc.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    try {
      video.src = url
      await onceEvent(video, 'loadedmetadata')
      const duration = Number.isFinite(video.duration) ? video.duration : atSeconds
      const seekTo = Math.min(atSeconds, Math.max(0, duration))
      await seekVideo(video, Number.isFinite(seekTo) ? seekTo : 0)
      const frame = await createImageBitmap(video)
      return {
        width: frame.width || video.videoWidth,
        height: frame.height || video.videoHeight,
        source: frame,
      }
    } finally {
      URLg.revokeObjectURL(url)
    }
  },

  async encode(image, targetWidth, targetHeight, mimeType, quality) {
    const OffscreenCanvasG = requireGlobal<any>('OffscreenCanvas')
    const canvas = new OffscreenCanvasG(targetWidth, targetHeight)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('thumbnail: could not get a 2d canvas context')
    ctx.drawImage(image.source as any, 0, 0, targetWidth, targetHeight)
    const blob = await canvas.convertToBlob({ type: mimeType, quality })
    return new Uint8Array(await blob.arrayBuffer())
  },
}

function onceEvent(target: any, name: string): Promise<void> {
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

function seekVideo(video: any, seconds: number): Promise<void> {
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
