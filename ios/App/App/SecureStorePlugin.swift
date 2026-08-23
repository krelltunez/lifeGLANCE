import Foundation
import Capacitor
import Security

// Keychain-backed secret storage for sync/vault/intents credentials — the iOS
// counterpart of SecureStorePlugin.java. Same JS interface
// (src/native/secureStore.js: get/set/delete), same contract: secrets are no
// longer plaintext-at-rest in WebView storage, and material that cannot be
// read on THIS device reports as absent, so the app falls back to asking for
// credentials again rather than failing cryptically.
//
// Where Android builds that contract by hand (AES-GCM ciphertext in prefs, key
// in the Android Keystore), the iOS Keychain provides it directly:
// kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly stores the item encrypted
// under device-bound keys, unreadable in any backup restored to different
// hardware — the same "useless off-device" property the Android comment
// promises. AfterFirstUnlock (not WhenUnlocked) because sync and the vault SSE
// reader can run while the device is locked-but-booted; first-unlock is the
// standard bar for network-credential material.
//
// Ported from lastGLANCE's SecureStorePlugin.swift (issue #210 there); keep
// the two in sync when fixing bugs in either.
//
// Registered in MainViewController.capacitorDidLoad() — app-local plugins
// are never auto-discovered on iOS.
@objc(SecureStorePlugin)
public class SecureStorePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "SecureStorePlugin"
    public let jsName = "SecureStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "delete", returnType: CAPPluginReturnPromise),
    ]

    // Same namespace the Android prefs file uses; account = the caller's key.
    private let service = "lifeglance_secure_store"

    private func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("missing key")
            return
        }
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess,
           let data = result as? Data,
           let value = String(data: data, encoding: .utf8) {
            call.resolve(["value": value])
        } else {
            // Absent, undecodable, or unreadable on this device: all report as
            // null — the contract's "ask for credentials again" path.
            call.resolve(["value": NSNull()])
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("missing key")
            return
        }
        guard let value = call.getString("value") else {
            call.reject("missing value")
            return
        }
        let data = Data(value.utf8)

        // Update-then-add: SecItemUpdate cannot create and SecItemAdd cannot
        // replace, so the standard upsert is a try of each.
        let update: [String: Any] = [kSecValueData as String: data]
        var status = SecItemUpdate(baseQuery(for: key) as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = baseQuery(for: key)
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, nil)
        }
        if status == errSecSuccess {
            call.resolve()
        } else {
            // Loud, unlike get: a write that silently vanished would strand the
            // credentials in the localStorage the shim is migrating away from.
            call.reject("keychain write failed (\(status))")
        }
    }

    @objc func delete(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("missing key")
            return
        }
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("keychain delete failed (\(status))")
        }
    }
}
