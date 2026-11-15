// Life photos (Lives v5.0, Phase 3b). The same path as milestone photos:
//   • the image is kept locally in the media store, keyed `<lifeId>-photo`;
//   • with GLANCEvault on, it is uploaded (encrypted, content-addressed) and the
//     Life's photo_id / thumbnail_id point at the real hashes, so other devices
//     can fetch it. Blobs before references: the slots are written only after
//     the upload is confirmed. A failed upload keeps the local photo and the
//     placeholder id, and is not an error for the user;
//   • without the vault (WebDAV, iCloud, Direct Access), the photo stays on
//     this device, as milestone photos do ("WebDAV carries structured data;
//     GLANCEvault carries everything").

import { useEffect, useState } from 'react'
import { dbPutPhoto, dbGetPhoto, dbDeletePhoto } from '../../data/db'
import { updateLife } from '../../data/lives'
import { readVaultConfig } from '../../sync/dbSync'
import {
  uploadMilestoneMedia, releaseMilestoneMedia, isRealBlobHash, fetchThumbnailBytes, fetchFullResBytes,
} from '../../blobs/milestoneMedia.js'

const placeholderId = (lifeId) => `${lifeId}-photo`

/** Store a new photo for `life` and return the updated Life. */
export async function saveLifePhoto(life, file) {
  await dbPutPhoto(life.id, file, file.type)
  const previous = life
  let updated = await updateLife(life.id, { photo_id: placeholderId(life.id), thumbnail_id: null }, life)
  if (readVaultConfig()) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { fullHash, thumbHash } = await uploadMilestoneMedia({ bytes, mimeType: file.type })
      updated = await updateLife(life.id, { photo_id: fullHash, thumbnail_id: thumbHash }, updated)
    } catch (err) {
      console.warn('[lives] photo upload deferred, kept on this device:', err?.message || err)
    }
    releaseMilestoneMedia(previous).catch(() => {})   // the replaced photo's references
  }
  return updated
}

/** Remove the Life's photo and return the updated Life. */
export async function removeLifePhoto(life) {
  await dbDeletePhoto(life.id)
  if (readVaultConfig()) releaseMilestoneMedia(life).catch(() => {})
  return updateLife(life.id, { photo_id: null, thumbnail_id: null }, life)
}

/** For deleting a Life: drop its local photo and its vault references. */
export async function forgetLifePhoto(life) {
  await dbDeletePhoto(life.id).catch(() => {})
  if (readVaultConfig()) releaseMilestoneMedia(life).catch(() => {})
}

/**
 * An object URL for the Life's photo, or null. The local copy first; then the
 * vault thumbnail, then the full image (another device's upload).
 */
export function useLifePhotoUrl(life) {
  // The URL is stored with the photo it belongs to, so a stale one (from the
  // previous Life or photo) is never shown while the new one loads.
  const [shown, setShown] = useState({ key: null, url: null })
  const id = life?.id
  const photoId = life?.photo_id ?? null
  const thumbId = life?.thumbnail_id ?? null
  const key = id && photoId ? `${id}|${photoId}|${thumbId}` : null
  useEffect(() => {
    if (!key) return
    let cancelled = false
    let made = null
    const show = (blob) => {
      if (cancelled || !blob) return
      made = URL.createObjectURL(blob)
      setShown({ key, url: made })
    }
    dbGetPhoto(id).then(local => {
      if (local?.blob) return show(local.blob)
      if (isRealBlobHash(thumbId)) return fetchThumbnailBytes(thumbId).then(b => b && show(new Blob([b])))
      if (isRealBlobHash(photoId)) return fetchFullResBytes(photoId).then(b => b && show(new Blob([b])))
    }).catch(() => {})
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made) }
  }, [key, id, photoId, thumbId])
  return key && shown.key === key ? shown.url : null
}
