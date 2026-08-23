import { Capacitor, registerPlugin } from '@capacitor/core'

// Native bridge to hardware-backed secret storage, so credentials are no
// longer plaintext-at-rest in WebView storage. Both shells implement the same
// three-method interface with the same contract — material that cannot be
// read on THIS device reports as absent, and the app falls back to asking for
// credentials again:
//  - Android (SecureStorePlugin.java): AES-GCM ciphertext in private prefs,
//    key in the Android Keystore.
//  - iOS (SecureStorePlugin.swift): Keychain items stored with
//    AfterFirstUnlockThisDeviceOnly, encrypted under device-bound keys.
// On web/PWA callers keep their existing storage.
//
// Ported from lastGLANCE (src/native/secureStore.ts); keep the two in sync
// when fixing bugs in either.
const SecureStore = registerPlugin('SecureStore')

// The shim and key hooks must only engage where the plugin actually exists —
// anywhere else the fallback is the status quo (localStorage / IndexedDB).
//
// Capability gate, not platform gate: isPluginAvailable() is the same old-shell
// guard mediaPicker.js and vaultSse.js use, and it covers the shipped-dead-
// plugin case (a class written but never registered — see the warning comment
// in MainViewController.swift). lastGLANCE gates on isNativeShell() without
// probing, which would install the shim and then silently lose every write if
// registration were ever missed. Never feature-detect via `!!SecureStore.get`:
// registerPlugin returns a Proxy whose property reads are always truthy on iOS.
export const isSecureStoreAvailable =
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SecureStore')

export async function secureGet(key) {
  const res = await SecureStore.get({ key })
  return res.value ?? null
}

export async function secureSet(key, value) {
  await SecureStore.set({ key, value })
}

export async function secureDelete(key) {
  await SecureStore.delete({ key })
}
