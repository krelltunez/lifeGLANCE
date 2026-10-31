import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The iOS shell is not compiled in CI, so this holds Info.plist to the media
// attach path the web layer actually takes on iOS.
//
// Why this test exists: src/native/mediaPicker.js is gated on a MediaPicker
// plugin that only the Android shell registers, so on iOS both attach buttons
// fall through to AddMilestoneSheet.jsx's hidden <input type="file"> elements.
// WKWebView answers accept="image/*" / accept="audio/*,video/*" with an action
// sheet offering "Take Photo or Video", and that capture runs in-process, so a
// missing NSCameraUsageDescription / NSMicrophoneUsageDescription terminates the
// app rather than degrading. Neither CI (no compile) nor the Simulator (no
// camera) reproduces it, and the crash is on a path review is likely to tap.
//
// Same discipline as icloudIosParity / billingIosParity: assert the native
// config that nothing else in the pipeline checks.

const root = resolve(__dirname, '../..')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const plist = read('ios/App/App/Info.plist')
const sheet = read('src/components/milestone/AddMilestoneSheet.jsx')
const mainVC = read('ios/App/App/MainViewController.swift')

/** The <string> value following a given <key> in the Info.plist. */
function plistString(key) {
  const m = plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))
  return m?.[1]
}

// Required by the in-process capture path; the photo-library key is defensive
// (see the comment in Info.plist) and is checked the same way.
const REQUIRED_KEYS = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSPhotoLibraryUsageDescription',
]

describe('iOS media capture usage descriptions', () => {
  it('declares a non-empty purpose string for every key the capture path needs', () => {
    for (const key of REQUIRED_KEYS) {
      const value = plistString(key)
      expect(value, `${key} missing from ios/App/App/Info.plist`).toBeTruthy()
      // Apple rejects placeholder strings, and an empty <string/> reads as
      // declared-but-blank, which still crashes the capture.
      expect(value.trim().length, `${key} is blank`).toBeGreaterThan(10)
    }
  })

  it('still has the camera-capable file inputs these keys exist for', () => {
    // If both of these ever go away, the keys above are dead weight and the
    // Info.plist comment is stale — fail loudly rather than leave it to rot.
    expect(sheet).toMatch(/type="file"\s+accept="image\/\*"/)
    expect(sheet).toMatch(/type="file"\s+accept="audio\/\*,video\/\*"/)
  })

  it('has no iOS MediaPicker, which is why iOS takes the file-input path', () => {
    // An iOS MediaPicker would move attach off <input type="file"> and onto a
    // native picker. The keys may still be needed, but the reasoning recorded
    // in Info.plist would no longer be the live one — revisit it here.
    expect(mainVC).not.toMatch(/registerPluginInstance\(MediaPickerPlugin\(\)\)/)
  })
})
