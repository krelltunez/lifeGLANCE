import { describe, it, expect } from 'vitest'
import {
  generateThumbnail,
  fitWithin,
  sourceKind,
  ThumbnailGenerationError,
  MAX_THUMBNAIL_EDGE,
  DEFAULT_OUTPUT_MIME,
  POSTER_FRAME_TIME_SECONDS,
} from './thumbnail.ts'

// =============================================================================
// TEST ENVIRONMENT NOTE
//
// The REAL image-processing primitive (browserImageProcessor) uses webview canvas
// APIs — createImageBitmap, OffscreenCanvas, a <video> element + frame grab. Those
// do NOT exist in the vitest 'node' environment (no canvas, no DOM video), so they
// are exercised IN-APP, not here. Per the module's injectable design, these tests
// supply a FAKE ImageProcessor that records its calls and produces deterministic
// bytes, letting us assert the generation logic (kind routing, downscale bounds,
// poster-frame path, clean typed failure, plaintext output) without any canvas.
// =============================================================================

// A fake source "blob": 4-byte big-endian width/height header + a marker.
function fakeSource(width, height, marker = 'ok') {
  const head = new Uint8Array([
    (width >> 8) & 0xff, width & 0xff,
    (height >> 8) & 0xff, height & 0xff,
  ])
  const tail = new TextEncoder().encode(marker)
  const out = new Uint8Array(head.length + tail.length)
  out.set(head, 0)
  out.set(tail, head.length)
  return out
}

function readDims(bytes) {
  if (bytes.length < 4) throw new Error('fake decode: too short')
  const width = (bytes[0] << 8) | bytes[1]
  const height = (bytes[2] << 8) | bytes[3]
  if (width === 0 || height === 0) throw new Error('fake decode: corrupt (zero dims)')
  return { width, height }
}

// Fake-encoded output: a 4-byte target-dims header + an ASCII tag for the mime.
// This lets a test read the encoded thumbnail's dimensions straight out of the
// returned bytes (proving the size bound from the real output, not just a spy).
function fakeEncodedBytes(targetWidth, targetHeight, mimeType) {
  const head = new Uint8Array([
    (targetWidth >> 8) & 0xff, targetWidth & 0xff,
    (targetHeight >> 8) & 0xff, targetHeight & 0xff,
  ])
  const tag = new TextEncoder().encode(`ENC:${mimeType}`)
  const out = new Uint8Array(head.length + tag.length)
  out.set(head, 0)
  out.set(tag, head.length)
  return out
}

function readEncodedDims(bytes) {
  return { width: (bytes[0] << 8) | bytes[1], height: (bytes[2] << 8) | bytes[3] }
}

// A recording fake ImageProcessor. `behavior` lets a test force decode/encode
// failures to exercise the clean-failure path.
function makeFakeProcessor(behavior = {}) {
  const calls = {
    decodeImage: 0,
    decodeVideoFrame: 0,
    encode: 0,
    lastEncode: null,
    lastPosterTime: null,
  }
  const processor = {
    async decodeImage(bytes) {
      calls.decodeImage++
      if (behavior.decodeThrows) throw new Error('fake decode failure')
      return { ...readDims(bytes), source: { kind: 'image-bitmap' } }
    },
    async decodeVideoFrame(bytes, _mime, atSeconds) {
      calls.decodeVideoFrame++
      calls.lastPosterTime = atSeconds
      if (behavior.decodeThrows) throw new Error('fake video decode failure')
      return { ...readDims(bytes), source: { kind: 'video-frame' } }
    },
    async encode(image, targetWidth, targetHeight, mimeType, quality) {
      calls.encode++
      calls.lastEncode = { targetWidth, targetHeight, mimeType, quality, source: image.source }
      if (behavior.encodeThrows) throw new Error('fake encode failure')
      if (behavior.encodeEmpty) return new Uint8Array(0)
      return fakeEncodedBytes(targetWidth, targetHeight, mimeType)
    },
  }
  return { processor, calls }
}

describe('thumbnail — sourceKind', () => {
  it('classifies image and video mime types, rejects the rest', () => {
    expect(sourceKind('image/jpeg')).toBe('image')
    expect(sourceKind('image/png')).toBe('image')
    expect(sourceKind('video/mp4')).toBe('video')
    expect(sourceKind('VIDEO/QUICKTIME')).toBe('video')
    expect(sourceKind('application/pdf')).toBeNull()
    expect(sourceKind('')).toBeNull()
    expect(sourceKind(undefined)).toBeNull()
  })
})

describe('thumbnail — fitWithin (pure downscale math)', () => {
  it('downscales the longest edge to the bound, preserving aspect ratio', () => {
    expect(fitWithin(2000, 1000, 512)).toEqual({ width: 512, height: 256 })
    expect(fitWithin(1000, 2000, 512)).toEqual({ width: 256, height: 512 })
    expect(fitWithin(1024, 1024, 512)).toEqual({ width: 512, height: 512 })
  })

  it('never upscales a source already within the bound', () => {
    expect(fitWithin(100, 80, 512)).toEqual({ width: 100, height: 80 })
    expect(fitWithin(512, 300, 512)).toEqual({ width: 512, height: 300 })
  })
})

describe('thumbnail — image source', () => {
  it('produces downscaled bytes within the size bound, aspect preserved', async () => {
    const { processor, calls } = makeFakeProcessor()
    const src = fakeSource(2000, 1000) // 2:1, larger than the bound

    const out = await generateThumbnail(src, 'image/jpeg', { processor })

    // Routed to the image decoder (not the video path).
    expect(calls.decodeImage).toBe(1)
    expect(calls.decodeVideoFrame).toBe(0)

    // Downscaled to the longest-edge bound, aspect preserved.
    expect(calls.lastEncode.targetWidth).toBe(512)
    expect(calls.lastEncode.targetHeight).toBe(256)
    expect(Math.max(calls.lastEncode.targetWidth, calls.lastEncode.targetHeight))
      .toBeLessThanOrEqual(MAX_THUMBNAIL_EDGE)

    // Output mime + dimensions read back from the ACTUAL returned bytes.
    expect(out.mimeType).toBe(DEFAULT_OUTPUT_MIME)
    const dims = readEncodedDims(out.bytes)
    expect(dims).toEqual({ width: 512, height: 256 })
    expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(MAX_THUMBNAIL_EDGE)
  })

  it('does not upscale a small image', async () => {
    const { processor, calls } = makeFakeProcessor()
    const out = await generateThumbnail(fakeSource(120, 90), 'image/png', { processor })
    expect(calls.lastEncode.targetWidth).toBe(120)
    expect(calls.lastEncode.targetHeight).toBe(90)
    expect(readEncodedDims(out.bytes)).toEqual({ width: 120, height: 90 })
  })

  it('honors a custom maxEdge and output mime', async () => {
    const { processor, calls } = makeFakeProcessor()
    const out = await generateThumbnail(fakeSource(800, 400), 'image/jpeg', {
      processor,
      maxEdge: 256,
      outputMimeType: 'image/webp',
    })
    expect(calls.lastEncode.targetWidth).toBe(256)
    expect(calls.lastEncode.targetHeight).toBe(128)
    expect(out.mimeType).toBe('image/webp')
  })
})

describe('thumbnail — video source (poster frame)', () => {
  it('grabs a poster frame and downscales it to an image', async () => {
    const { processor, calls } = makeFakeProcessor()
    const src = fakeSource(1920, 1080) // 16:9 video

    const out = await generateThumbnail(src, 'video/mp4', { processor })

    // Routed to the video poster path, at the default poster timestamp.
    expect(calls.decodeVideoFrame).toBe(1)
    expect(calls.decodeImage).toBe(0)
    expect(calls.lastPosterTime).toBe(POSTER_FRAME_TIME_SECONDS)
    expect(calls.lastEncode.source).toEqual({ kind: 'video-frame' })

    // Poster frame downscaled to the bound, output is a still image.
    expect(calls.lastEncode.targetWidth).toBe(512)
    expect(calls.lastEncode.targetHeight).toBe(288)
    expect(out.mimeType).toBe(DEFAULT_OUTPUT_MIME) // an image, not a video
    expect(readEncodedDims(out.bytes)).toEqual({ width: 512, height: 288 })
  })

  it('honors a custom poster timestamp', async () => {
    const { processor, calls } = makeFakeProcessor()
    await generateThumbnail(fakeSource(640, 480), 'video/webm', {
      processor,
      posterTimeSeconds: 3.5,
    })
    expect(calls.lastPosterTime).toBe(3.5)
  })
})

describe('thumbnail — clean failure (ThumbnailGenerationError, no partial output)', () => {
  it('throws on an unsupported source type WITHOUT invoking the processor', async () => {
    const { processor, calls } = makeFakeProcessor()
    await expect(generateThumbnail(fakeSource(10, 10), 'application/pdf', { processor }))
      .rejects.toThrow(ThumbnailGenerationError)
    expect(calls.decodeImage).toBe(0)
    expect(calls.decodeVideoFrame).toBe(0)
    expect(calls.encode).toBe(0)
  })

  it('throws on empty source bytes', async () => {
    const { processor } = makeFakeProcessor()
    await expect(generateThumbnail(new Uint8Array(0), 'image/jpeg', { processor }))
      .rejects.toThrow(ThumbnailGenerationError)
  })

  it('throws (and never encodes) when the decoder fails on a corrupt source', async () => {
    const { processor, calls } = makeFakeProcessor({ decodeThrows: true })
    await expect(generateThumbnail(fakeSource(100, 100), 'image/jpeg', { processor }))
      .rejects.toThrow(ThumbnailGenerationError)
    expect(calls.encode).toBe(0) // no partial output — it failed before encoding
  })

  it('throws when the decoder reports zero/garbage dimensions', async () => {
    const { processor, calls } = makeFakeProcessor()
    // A header of 0x0 makes the fake decoder treat the source as corrupt.
    await expect(generateThumbnail(fakeSource(0, 0), 'image/jpeg', { processor }))
      .rejects.toThrow(ThumbnailGenerationError)
    expect(calls.encode).toBe(0)
  })

  it('throws when the encoder fails', async () => {
    const { processor } = makeFakeProcessor({ encodeThrows: true })
    await expect(generateThumbnail(fakeSource(800, 600), 'image/jpeg', { processor }))
      .rejects.toThrow(ThumbnailGenerationError)
  })

  it('throws when the encoder produces no bytes', async () => {
    const { processor } = makeFakeProcessor({ encodeEmpty: true })
    await expect(generateThumbnail(fakeSource(800, 600), 'image/jpeg', { processor }))
      .rejects.toThrow(ThumbnailGenerationError)
  })

  it('wraps the underlying failure as the cause', async () => {
    const { processor } = makeFakeProcessor({ decodeThrows: true })
    const err = await generateThumbnail(fakeSource(100, 100), 'image/jpeg', { processor })
      .then(() => null, (e) => e)
    expect(err).toBeInstanceOf(ThumbnailGenerationError)
    expect(err.cause).toBeInstanceOf(Error)
  })
})

describe('thumbnail — output is plaintext bytes ready for the upload path', () => {
  it('returns exactly the processor-produced image bytes (not encrypted/transformed)', async () => {
    const { processor } = makeFakeProcessor()
    const out = await generateThumbnail(fakeSource(1000, 500), 'image/jpeg', { processor })

    // The returned bytes are precisely what the image processor produced — this
    // module performs no encryption/addressing. (Encryption + content-addressing
    // happen later, when these bytes go through blobTransport.uploadBlob.)
    const expected = fakeEncodedBytes(512, 256, 'image/jpeg')
    expect([...out.bytes]).toEqual([...expected])
    expect(out.bytes).toBeInstanceOf(Uint8Array)
    expect(typeof out.mimeType).toBe('string')
  })
})
