import { describe, it, expect, beforeEach } from 'vitest'
import { encryptBlob } from './blobCrypto.js'
import {
  uploadBlob,
  downloadBlob,
  downloadBlobBytes,
  blobExists,
  addBlobRef,
  releaseBlobRef,
  readVaultConnection,
  VaultConnectionUnavailableError,
  BlobHashMismatchError,
} from './blobTransport.js'
import { BlobKeyUnavailableError } from './blobCrypto.js'

// =============================================================================
// END-TO-END / SEAM NOTE
//
// The end-to-end test runs against an IN-PROCESS CONTRACT MOCK of the
// glance-vault blob server (no real server is available in this repo — see
// src/sync/status.js: the GLANCEvault transport is "inert until cutover"). The
// mock is high-fidelity to the exact endpoint contract AND — this is the point —
// its finalize handler hashes the reassembled part bytes the SAME way the crypto
// core computes a blob's address: SHA-256(nonce || ciphertext), lowercase hex
// (see `sha256Hex` below, identical to blobCrypto's addressing). So finalize only
// accepts when the server's hash of the bytes it reassembled equals the hash the
// client declared — exactly the seam the real server enforces. A round-trip that
// finalizes + downloads + decrypts back to the original byte-for-byte is therefore
// real proof that the bytes the client hashes/uploads equal the bytes the server
// hashes on finalize.
// =============================================================================

const VAULT_URL = 'https://vault.test'
const TOKEN = 'device-token-abc'
const ACCOUNT = 'account-123'

let rootKey
let provideKey
let provideNull

beforeEach(async () => {
  const rootBits = crypto.getRandomValues(new Uint8Array(32))
  rootKey = await crypto.subtle.importKey('raw', rootBits, 'HKDF', false, ['deriveKey'])
  provideKey = async () => rootKey
  provideNull = async () => null
})

const enc = (s) => new TextEncoder().encode(s)

function randomBytes(n) {
  const out = new Uint8Array(n)
  for (let off = 0; off < n; off += 65536) {
    crypto.getRandomValues(out.subarray(off, Math.min(off + 65536, n)))
  }
  return out
}

// SHA-256(bytes) -> lowercase hex. IDENTICAL to how blobCrypto addresses a blob,
// and to how the real glance-vault server hashes reassembled bytes on finalize.
async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── In-process contract mock of the glance-vault blob server ─────────────────

function makeVaultServer({ token = TOKEN, accountId = ACCOUNT } = {}) {
  const blobs = new Map() // hash -> { bytes: Uint8Array, refs: number }
  const sessions = new Map() // uploadId -> { hash, size, partSize, parts: Map<i, Uint8Array> }
  const hashToUpload = new Map() // hash -> uploadId (initiate idempotency)
  let nextId = 1

  const calls = { head: 0, initiate: 0, resume: 0, part: 0, finalize: 0, get: 0, refAdd: 0, refRelease: 0 }
  const partPuts = [] // every part index actually PUT, in order (proves resume skips)
  let failPartOnce = null // set to an index to make that PUT fail once

  // Responses expose .text() as well as .json()/.arrayBuffer(), matching a real
  // fetch Response and the native adapter — the transport reads .text() to surface
  // server error bodies.
  const jsonRes = (status, obj) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(obj)).buffer,
  })
  const binRes = (status, bytes) => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
    text: async () => '',
    json: async () => { throw new Error('not json') },
  })
  const emptyRes = (status) => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => '',
    json: async () => ({}),
  })

  async function handle(url, init) {
    const u = new URL(url)
    const path = u.pathname
    const method = init.method
    const qAccount = u.searchParams.get('accountId')

    // Auth seam: every request must carry the device Bearer token.
    if (init.headers.Authorization !== `Bearer ${token}`) return emptyRes(401)

    const jsonBody = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    let m

    // HEAD /blobs/:hash  (account-scoped via query)
    if (method === 'HEAD' && (m = path.match(/^\/blobs\/([^/]+)$/))) {
      calls.head++
      if (qAccount !== accountId) return emptyRes(400)
      return blobs.has(decodeURIComponent(m[1])) ? emptyRes(200) : emptyRes(404)
    }

    // GET /blobs/:hash  (download, optional Range)
    if (method === 'GET' && (m = path.match(/^\/blobs\/([^/]+)$/))) {
      calls.get++
      if (qAccount !== accountId) return jsonRes(400, { error: 'accountId required' })
      const rec = blobs.get(decodeURIComponent(m[1]))
      if (!rec) return jsonRes(404, { error: 'not_found' })
      const range = init.headers.Range
      if (range) {
        const mr = range.match(/^bytes=(\d+)-(\d*)$/)
        const start = Number(mr[1])
        const end = mr[2] === '' ? rec.bytes.length - 1 : Number(mr[2])
        return binRes(206, rec.bytes.subarray(start, end + 1))
      }
      return binRes(200, rec.bytes)
    }

    // POST /blobs/uploads  (initiate; accountId + blobHash + size in body).
    // Mirrors the real server: the hash field is `blobHash`, `partSize` is NOT
    // read (the client splits locally), success is 201 { uploadId, received:[] }
    // for a new session or 200 { exists:true } when the bytes are already stored.
    if (method === 'POST' && path === '/blobs/uploads') {
      calls.initiate++
      if (jsonBody.accountId !== accountId) return jsonRes(400, { error: 'accountId required' })
      if (typeof jsonBody.blobHash !== 'string' || !/^[0-9a-f]{64}$/.test(jsonBody.blobHash)) {
        return jsonRes(400, { error: 'blobHash must be a 64-character hex sha256' })
      }
      if (!Number.isInteger(jsonBody.size) || jsonBody.size < 0) {
        return jsonRes(400, { error: 'size must be a non-negative integer' })
      }
      if (blobs.has(jsonBody.blobHash)) return jsonRes(200, { exists: true, blobHash: jsonBody.blobHash })
      let uploadId = hashToUpload.get(jsonBody.blobHash)
      if (!uploadId) {
        uploadId = `up-${nextId++}`
        sessions.set(uploadId, { hash: jsonBody.blobHash, size: jsonBody.size, parts: new Map() })
        hashToUpload.set(jsonBody.blobHash, uploadId)
      }
      return jsonRes(201, { uploadId, blobHash: jsonBody.blobHash, received: [] })
    }

    // GET /blobs/uploads/:id  (resume point; received parts as { index, size } objects)
    if (method === 'GET' && (m = path.match(/^\/blobs\/uploads\/([^/]+)$/))) {
      calls.resume++
      const s = sessions.get(decodeURIComponent(m[1]))
      if (!s) return jsonRes(404, { error: 'no_session' })
      const indices = [...s.parts.keys()].sort((a, b) => a - b)
      return jsonRes(200, {
        received: indices.map((i) => ({ index: i, size: s.parts.get(i).length })),
        size: s.size,
      })
    }

    // PUT /blobs/uploads/:id/parts/:i  (one part, raw bytes; accountId in query)
    if (method === 'PUT' && (m = path.match(/^\/blobs\/uploads\/([^/]+)\/parts\/(\d+)$/))) {
      calls.part++
      if (qAccount !== accountId) return jsonRes(400, { error: 'accountId required' })
      const s = sessions.get(decodeURIComponent(m[1]))
      if (!s) return jsonRes(404, { error: 'no_session' })
      const i = Number(m[2])
      if (failPartOnce === i) {
        failPartOnce = null
        return emptyRes(500) // transient server hiccup → client throws, session retained
      }
      s.parts.set(i, new Uint8Array(init.body)) // store a copy of the part bytes
      partPuts.push(i)
      return jsonRes(200, { index: i, size: s.parts.get(i).length })
    }

    // POST /blobs/uploads/:id/finalize  (reassemble + VERIFY hash + store)
    if (method === 'POST' && (m = path.match(/^\/blobs\/uploads\/([^/]+)\/finalize$/))) {
      calls.finalize++
      const s = sessions.get(decodeURIComponent(m[1]))
      if (!s) return jsonRes(404, { error: 'no_session' })
      // Reassemble parts in ascending index order.
      const indices = [...s.parts.keys()].sort((a, b) => a - b)
      let total = 0
      for (const i of indices) total += s.parts.get(i).length
      const reassembled = new Uint8Array(total)
      let off = 0
      for (const i of indices) {
        const p = s.parts.get(i)
        reassembled.set(p, off)
        off += p.length
      }
      // VERIFY: server's hash of reassembled bytes == the SESSION's declared hash
      // (captured at initiate — the finalize body does not carry a hash). On a
      // mismatch the real server returns 400 with a sentence + declared/computed.
      const serverHash = await sha256Hex(reassembled)
      if (serverHash !== s.hash) {
        return jsonRes(400, {
          error: 'hash mismatch: reassembled bytes do not match declared blobHash',
          declared: s.hash,
          computed: serverHash,
        })
      }
      blobs.set(serverHash, { bytes: reassembled, refs: 0 })
      sessions.delete(decodeURIComponent(m[1]))
      hashToUpload.delete(serverHash)
      return jsonRes(200, { blobHash: serverHash, stored: true })
    }

    // POST /blobs/:hash/ref-add | ref-release
    if (method === 'POST' && (m = path.match(/^\/blobs\/([^/]+)\/(ref-add|ref-release)$/))) {
      const hash = decodeURIComponent(m[1])
      const rec = blobs.get(hash)
      if (!rec) return jsonRes(404, { error: 'not_found' })
      if (m[2] === 'ref-add') { calls.refAdd++; rec.refs++ } else { calls.refRelease++; rec.refs-- }
      return jsonRes(200, { refs: rec.refs })
    }

    return jsonRes(404, { error: 'unknown_route' })
  }

  return {
    fetchImpl: (url, init) => handle(url, init),
    blobs,
    sessions,
    calls,
    partPuts,
    setFailPartOnce: (i) => { failPartOnce = i },
  }
}

function depsFor(server, extra = {}) {
  return {
    connection: { vaultUrl: VAULT_URL, vaultToken: TOKEN, accountId: ACCOUNT },
    fetchImpl: server.fetchImpl,
    getRootKey: provideKey,
    ...extra,
  }
}

// ── THE end-to-end test: the client/server hash-agreement seam ───────────────

describe('blobTransport — end-to-end round trip (the hash seam)', () => {
  it('encrypt → upload (initiate/parts/finalize ACCEPTS) → download → decrypt is byte-identical', async () => {
    const server = makeVaultServer()
    const plaintext = enc('a milestone photo, pretend this is JPEG bytes ' + 'x'.repeat(500))

    // Force multipart so reassembly ORDER is genuinely exercised.
    const deps = depsFor(server, { partSize: 64 })

    const hash = await uploadBlob(plaintext, deps)

    // finalize ACCEPTED (server's hash of reassembled bytes == client's hash) and stored it.
    expect(server.calls.finalize).toBe(1)
    expect(server.blobs.has(hash)).toBe(true)

    // Independent cross-check: the address equals SHA-256 of the exact encrypted
    // stored bytes — i.e. what the client declared and what the server verified.
    const { bytes, hash: cryptoHash } = await encryptBlob(plaintext, provideKey)
    expect(hash).toBe(cryptoHash)
    expect(await sha256Hex(server.blobs.get(hash).bytes)).toBe(hash)
    expect([...server.blobs.get(hash).bytes]).toEqual([...bytes])

    // Download → decrypt → byte-identical to the original plaintext.
    const out = await downloadBlob(hash, deps)
    expect([...out]).toEqual([...plaintext])
  })

  it('round-trips a larger payload across many parts', async () => {
    const server = makeVaultServer()
    const plaintext = randomBytes(200 * 1024) // 200 KiB
    const deps = depsFor(server, { partSize: 64 * 1024 })
    const hash = await uploadBlob(plaintext, deps)
    expect(server.blobs.has(hash)).toBe(true)
    const out = await downloadBlob(hash, deps)
    expect(await sha256Hex(out)).toBe(await sha256Hex(plaintext))
  })
})

// ── Dedup: existence check skips upload for known content ────────────────────

describe('blobTransport — dedup (existence check skips upload)', () => {
  it('a second upload of identical content does HEAD only — no initiate/parts/finalize', async () => {
    const server = makeVaultServer()
    const plaintext = enc('dedup me')
    const deps = depsFor(server)

    const hash1 = await uploadBlob(plaintext, deps)
    const after = { ...server.calls }

    const hash2 = await uploadBlob(plaintext, deps)
    expect(hash2).toBe(hash1) // same content address

    // The second call hit HEAD (existence) and then short-circuited.
    expect(server.calls.head).toBe(after.head + 1)
    expect(server.calls.initiate).toBe(after.initiate) // unchanged
    expect(server.calls.part).toBe(after.part) // unchanged
    expect(server.calls.finalize).toBe(after.finalize) // unchanged
  })

  it('blobExists reflects server state', async () => {
    const server = makeVaultServer()
    const { hash } = await encryptBlob(enc('present?'), provideKey)
    expect(await blobExists(hash, depsFor(server))).toBe(false)
    await uploadBlob(enc('present?'), depsFor(server))
    expect(await blobExists(hash, depsFor(server))).toBe(true)
  })
})

// ── Interrupted upload resumes from the server's resume point ────────────────

describe('blobTransport — resume after interruption', () => {
  it('resumes from the resume point and does not re-send already-received parts', async () => {
    const server = makeVaultServer()
    const plaintext = randomBytes(300) // > partSize so there are several parts
    const partSize = 64
    const deps = depsFor(server, { partSize })

    // The upload chunks the ENCRYPTED bytes ([nonce || ciphertext]), not the
    // plaintext, so derive the expected part indices from the encrypted length.
    const { bytes: stored } = await encryptBlob(plaintext, provideKey)
    const nParts = Math.ceil(stored.length / partSize)
    const allIndices = [...Array(nParts).keys()]
    expect(nParts).toBeGreaterThan(2)

    // First attempt: fail part index 1. Parts before it (0) are already stored.
    server.setFailPartOnce(1)
    await expect(uploadBlob(plaintext, deps)).rejects.toThrow()
    expect(server.partPuts).toEqual([0]) // only part 0 made it before the failure

    // Second attempt: initiate is idempotent on hash; resume reports part 0 held;
    // the client sends only the missing parts and finalizes.
    const hash = await uploadBlob(plaintext, deps)
    expect(server.calls.resume).toBeGreaterThanOrEqual(2)
    // Part 0 was sent exactly once across BOTH attempts (resumed, not restarted).
    expect(server.partPuts.filter((i) => i === 0)).toHaveLength(1)
    expect(server.partPuts.sort((a, b) => a - b)).toEqual(allIndices)

    expect(server.blobs.has(hash)).toBe(true)
    const out = await downloadBlob(hash, deps)
    expect(await sha256Hex(out)).toBe(await sha256Hex(plaintext))
  })
})

// ── Key unavailable: surfaces hold/retry, uploads nothing, never plaintext ───

describe('blobTransport — key unavailable', () => {
  it('uploadBlob throws BlobKeyUnavailableError and sends NOTHING', async () => {
    const server = makeVaultServer()
    const deps = depsFor(server, { getRootKey: provideNull })
    await expect(uploadBlob(enc('secret'), deps)).rejects.toThrow(BlobKeyUnavailableError)
    // No request of any kind reached the server — never plaintext, never a probe.
    expect(server.calls).toEqual({
      head: 0, initiate: 0, resume: 0, part: 0, finalize: 0, get: 0, refAdd: 0, refRelease: 0,
    })
  })
})

// ── Connection unavailable: clear, transient hold/retry signal ───────────────

describe('blobTransport — connection unavailable', () => {
  it('throws a transient VaultConnectionUnavailableError when no connection is configured', async () => {
    // No `connection` in deps and no localStorage config in the node test env.
    await expect(
      uploadBlob(enc('x'), { fetchImpl: () => { throw new Error('should not fetch') }, getRootKey: provideKey }),
    ).rejects.toMatchObject({ name: 'VaultConnectionUnavailableError', transient: true })
    expect(VaultConnectionUnavailableError).toBeTruthy()
  })

  it('readVaultConnection returns null when the sync config is absent', () => {
    expect(readVaultConnection()).toBeNull()
  })
})

// ── Download range returns the correct bytes ─────────────────────────────────

describe('blobTransport — range download', () => {
  it('returns exactly the requested byte slice of the stored blob', async () => {
    const server = makeVaultServer()
    const plaintext = randomBytes(1000)
    const deps = depsFor(server, { partSize: 256 })
    const hash = await uploadBlob(plaintext, deps)

    // The stored bytes are the encrypted [nonce || ciphertext], known deterministically.
    const { bytes: stored } = await encryptBlob(plaintext, provideKey)

    const slice = await downloadBlobBytes(hash, { ...deps, range: { start: 10, end: 49 } })
    expect(slice.length).toBe(40)
    expect([...slice]).toEqual([...stored.slice(10, 50)])

    // Open-ended range (start..end-of-blob).
    const tail = await downloadBlobBytes(hash, { ...deps, range: { start: stored.length - 5 } })
    expect([...tail]).toEqual([...stored.slice(stored.length - 5)])
  })
})

// ── Tampered downloaded blob fails decrypt (GCM tag) ─────────────────────────

describe('blobTransport — tamper detection on download', () => {
  it('a blob corrupted on the server fails to decrypt', async () => {
    const server = makeVaultServer()
    const plaintext = enc('integrity matters')
    const deps = depsFor(server)
    const hash = await uploadBlob(plaintext, deps)

    // Corrupt the stored bytes server-side (flip a bit in the ciphertext/tag).
    const rec = server.blobs.get(hash)
    rec.bytes[rec.bytes.length - 1] ^= 0x01

    await expect(downloadBlob(hash, deps)).rejects.toThrow()
  })
})

// ── Finalize hash mismatch surfaces clearly ──────────────────────────────────

describe('blobTransport — finalize hash mismatch', () => {
  it('throws BlobHashMismatchError when reassembled bytes hash differently', async () => {
    const server = makeVaultServer()
    // A fetch wrapper that corrupts one part in flight, so the server reassembles
    // different bytes than the client hashed → finalize must reject.
    let corrupted = false
    const corruptingFetch = (url, init) => {
      if (init.method === 'PUT' && /\/parts\/0(\?|$)/.test(url) && !corrupted) {
        corrupted = true
        const bad = new Uint8Array(init.body)
        bad[0] ^= 0xff
        return server.fetchImpl(url, { ...init, body: bad })
      }
      return server.fetchImpl(url, init)
    }
    const deps = depsFor(server, { fetchImpl: corruptingFetch, partSize: 64 })
    await expect(uploadBlob(enc('this will be corrupted in transit'), deps)).rejects.toThrow(BlobHashMismatchError)
    expect(server.calls.finalize).toBe(1) // it did reach finalize and was rejected there
  })
})

// ── Reference helpers ────────────────────────────────────────────────────────

describe('blobTransport — reference helpers', () => {
  it('addBlobRef / releaseBlobRef call the server endpoints', async () => {
    const server = makeVaultServer()
    const deps = depsFor(server)
    const hash = await uploadBlob(enc('ref me'), deps)

    await addBlobRef(hash, deps)
    await addBlobRef(hash, deps)
    expect(server.blobs.get(hash).refs).toBe(2)
    expect(server.calls.refAdd).toBe(2)

    await releaseBlobRef(hash, deps)
    expect(server.blobs.get(hash).refs).toBe(1)
    expect(server.calls.refRelease).toBe(1)
  })
})

// ── Auth seam ────────────────────────────────────────────────────────────────

describe('blobTransport — auth', () => {
  it('a wrong device token is rejected by the server (401 surfaces as an error)', async () => {
    const server = makeVaultServer()
    const badConn = { vaultUrl: VAULT_URL, vaultToken: 'wrong-token', accountId: ACCOUNT }
    await expect(
      blobExists('deadbeef', { connection: badConn, fetchImpl: server.fetchImpl, getRootKey: provideKey }),
    ).rejects.toThrow()
  })
})

// ── HEAD dedup is non-fatal when the transport itself chokes on HEAD ──────────
// The existence check is a dedup OPTIMIZATION. On native, CapacitorHttp over
// HttpURLConnection can reject/choke on a bodyless HEAD and the adapter THROWS
// (a transport-level failure, not an HTTP status). That must NOT abort the whole
// upload — initiate is idempotent on the hash and finalize re-verifies, so we
// proceed as "not known present" and upload anyway (never data loss). A wrong
// token / server 5xx still comes back as an HTTP STATUS (handled above), not a
// throw, so those keep surfacing.
describe('blobTransport — HEAD throw is non-fatal (native HEAD choke)', () => {
  // Wrap a server so an actual HEAD request rejects at the transport level,
  // as the native adapter would when the HTTP stack cannot perform the HEAD.
  const headThrows = (server) => (url, init) => {
    if (init.method === 'HEAD') return Promise.reject(new Error('native HEAD not supported'))
    return server.fetchImpl(url, init)
  }

  it('blobExists returns false (not a throw) when the HEAD request throws', async () => {
    const server = makeVaultServer()
    const { hash } = await encryptBlob(enc('present?'), provideKey)
    // Even though the blob IS present server-side, a throwing HEAD → "not known present".
    await uploadBlob(enc('present?'), depsFor(server))
    expect(server.blobs.has(hash)).toBe(true)
    const exists = await blobExists(hash, depsFor(server, { fetchImpl: headThrows(server) }))
    expect(exists).toBe(false)
  })

  it('uploadBlob still completes (initiate/parts/finalize) when the dedup HEAD throws', async () => {
    const server = makeVaultServer()
    const plaintext = enc('upload despite a broken HEAD ' + 'y'.repeat(200))
    const deps = depsFor(server, { fetchImpl: headThrows(server), partSize: 64 })

    const hash = await uploadBlob(plaintext, deps)

    // The HEAD threw and was swallowed, so the upload proceeded end-to-end.
    expect(server.calls.head).toBe(0) // no HEAD ever reached the server (it threw first)
    expect(server.calls.initiate).toBe(1)
    expect(server.calls.finalize).toBe(1)
    expect(server.blobs.has(hash)).toBe(true)

    // And it's a real, decryptable round-trip.
    const out = await downloadBlob(hash, depsFor(server))
    expect([...out]).toEqual([...plaintext])
  })

  it('dedups at initiate ({exists:true}) when HEAD is skipped but the blob is stored', async () => {
    const server = makeVaultServer()
    const plaintext = enc('already up there')

    // Store it once (normal path).
    const hash = await uploadBlob(plaintext, depsFor(server))
    const after = { ...server.calls }

    // Re-upload with a throwing HEAD (native): the HEAD dedup is skipped, so the
    // client initiates — and the server reports {exists:true}, short-circuiting
    // before any parts/finalize.
    const hash2 = await uploadBlob(plaintext, depsFor(server, { fetchImpl: headThrows(server) }))
    expect(hash2).toBe(hash)
    expect(server.calls.head).toBe(after.head) // HEAD never reached the server (threw)
    expect(server.calls.initiate).toBe(after.initiate + 1) // initiate DID run and dedup
    expect(server.calls.part).toBe(after.part) // no parts re-sent
    expect(server.calls.finalize).toBe(after.finalize) // no finalize
  })
})

// ── Server error bodies surface in the thrown error (diagnosability) ──────────
// A bare "failed: 400" hides WHY the server rejected the request. The transport
// now appends the server's response body so a native failure names the actual
// cause (missing/invalid field, wrong shape) instead of just a status code.
describe('blobTransport — server error detail surfaces in the thrown error', () => {
  it('appends the response body when initiate (POST /blobs/uploads) returns 400', async () => {
    const fetchImpl = async (url, init) => {
      // Dedup HEAD says "absent" so the upload proceeds to initiate.
      if (init.method === 'HEAD') {
        return { ok: false, status: 404, text: async () => '', json: async () => ({}) }
      }
      // Initiate is rejected with a descriptive body — this is what we want surfaced.
      if (init.method === 'POST' && url.includes('/blobs/uploads')) {
        return { ok: false, status: 400, text: async () => '{"error":"size_required"}', json: async () => ({ error: 'size_required' }) }
      }
      throw new Error(`unexpected ${init.method} ${url}`)
    }
    const deps = {
      connection: { vaultUrl: VAULT_URL, vaultToken: TOKEN, accountId: ACCOUNT },
      fetchImpl,
      getRootKey: provideKey,
    }
    await expect(uploadBlob(enc('x'), deps)).rejects.toThrow(/initiate upload failed: 400 — .*size_required/)
  })
})
