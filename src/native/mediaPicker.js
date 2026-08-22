import { Capacitor, registerPlugin } from '@capacitor/core'

// Native media pickers (Android MediaPickerPlugin). pickPhoto uses the
// permission-free Android Photo Picker; pickMedia uses a SAF open-document
// dialog filtered to audio/video. Both return the picked bytes as a File, so
// callers hand it to the exact code path a <input type="file"> selection takes —
// the storage path doesn't know the difference.
//
// Return contract, chosen so the caller can distinguish "no native picker here"
// from "user changed their mind":
//   { file }            picked — pass to the existing file handler
//   { cancelled: true } user dismissed the native picker — do nothing
//   null                native path unavailable or failed — fall back to the
//                       hidden <input>, so web/iOS/old-APK behaviour is unchanged
const MediaPicker = registerPlugin('MediaPicker')

async function pick(method) {
  // isPluginAvailable is the old-APK guard: a shell built before the plugin
  // existed answers false and the caller falls back to the file input.
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('MediaPicker')) return null
  try {
    const res = await MediaPicker[method]()
    if (!res || res.cancelled) return { cancelled: true }
    // convertFileSrc turns the app-cache path into a same-origin URL the
    // WebView can fetch — bytes cross the bridge as a stream, not base64.
    const url = Capacitor.convertFileSrc(res.path)
    const blob = await fetch(url).then(r => {
      if (!r.ok) throw new Error(`fetch of picked file returned ${r.status}`)
      return r.blob()
    })
    return { file: new File([blob], res.name || 'attachment', { type: res.mimeType || blob.type || '' }) }
  } catch (err) {
    console.warn(`[mediaPicker] native ${method} failed; falling back to file input:`, err)
    return null
  }
}

export const pickPhotoNative = () => pick('pickPhoto')
export const pickMediaNative = () => pick('pickMedia')
