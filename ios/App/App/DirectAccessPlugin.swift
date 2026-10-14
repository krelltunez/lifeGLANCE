import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

// Direct Access sync (docs/direct-access.md): the iOS half, as a Capacitor
// plugin. Ported from dayGLANCE's DirectAccessBridge.swift, which explains
// the one fact that shapes it: on iPhone and iPad the bookmark is of a FILE,
// not a folder. Nextcloud, Google Drive, Dropbox, Box and OneDrive ship Apple's
// older non-replicated File Provider extension, under which a picked folder has
// no real directory on disk and cannot be bookmarked, listed, or written into
// (Apple FB9703910). A picked file works with all of them: a coordinated read
// makes the provider put it on disk and a coordinated `.forReplacing` write
// makes it upload the new version.
//
// So the user picks an existing file (a folder another device seeded) or
// creates it in a folder of their choice through the export picker. Three
// files, three bookmarks: the snapshot (lifeglance-sync.json), the household
// roster (glance-users.json) and the intents event set (glance-events.json),
// each held as a security-scoped bookmark in UserDefaults. The web layer's
// bridge (src/native/directAccess.ts) offers the roster and the event set as
// slots without a path, since there is no folder to find them in.
//
// Read classification is the one every shell answers (see DirectAccessRead.kt
// on Android), with one difference: a bookmarked file that is gone is `error`,
// never `absent`, because there is no folder to seed into; the user re-picks
// or re-creates the file.
//
//   status / usersStatus / eventsStatus → { configured, name, path, reachable }
//   pickFile({slot}) / createFile({slot}) → the status (with slot) once picked,
//       { cancelled: true } when dismissed; rejected with the reason otherwise
//   pickFolder()                        → as pickFile for the snapshot (shared callers)
//   read / readUsers / readEvents        → { kind: downloading|error|text, text?, error? }
//   write / writeUsers / writeEvents ({text}) → { ok }
//   deleteFile()                         → { ok }   the snapshot, bookmark forgotten with it
//   disconnect()                         → {}       forgets every file
//   forgetUsers / forgetEvents           → {}
//
// Registered in MainViewController.capacitorDidLoad().
@objc(DirectAccessPlugin)
public class DirectAccessPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "DirectAccessPlugin"
    public let jsName = "DirectAccess"
    public let pluginMethods: [CAPPluginMethod] = [
        "status", "usersStatus", "eventsStatus",
        "pickFile", "createFile", "pickFolder",
        "read", "readUsers", "readEvents",
        "write", "writeUsers", "writeEvents",
        "deleteFile", "disconnect", "forgetUsers", "forgetEvents",
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    /// The three files this plugin holds, each by its own bookmark.
    enum Slot: String {
        case snapshot, users, events

        var fileName: String {
            switch self {
            case .snapshot: return "lifeglance-sync.json"
            case .users: return "glance-users.json"
            case .events: return "glance-events.json"
            }
        }
        var bookmarkKey: String {
            switch self {
            case .snapshot: return "lifeglance.directAccess.fileBookmark"
            case .users: return "lifeglance.directAccess.usersBookmark"
            case .events: return "lifeglance.directAccess.eventsBookmark"
            }
        }
        /// What createFile moves into the chosen folder. The snapshot's "null"
        /// classifies as absent so the first cycle seeds it; the roster's is
        /// an empty roster the first roster sync merges into; the event set's
        /// an empty set the first cycle unions into.
        var seed: String {
            switch self {
            case .snapshot: return "null"
            case .users: return #"{"version":1,"users":[]}"#
            case .events: return #"{"version":1,"events":[]}"#
            }
        }
        /// What readSlot says when no file of this slot is bookmarked.
        var missingMessage: String {
            switch self {
            case .snapshot: return "no file connected"
            case .users: return "no roster file chosen"
            case .events: return "no events file chosen"
            }
        }
        static func named(_ raw: String?) -> Slot {
            raw.flatMap(Slot.init(rawValue:)) ?? .snapshot
        }
    }

    /// Which file the picker on screen is for, and the call waiting on it.
    private var pendingSlot: Slot = .snapshot
    private var pendingCall: CAPPluginCall?

    // The poll reads every 15 s; an unchanged file (same modification date and
    // size) is served from here. Our own writes invalidate it.
    private var caches: [Slot: (modified: Date, size: Int, text: String)] = [:]

    // MARK: - Plugin methods

    @objc func status(_ call: CAPPluginCall) { call.resolve(statusObject(.snapshot)) }
    @objc func usersStatus(_ call: CAPPluginCall) { call.resolve(statusObject(.users)) }
    @objc func eventsStatus(_ call: CAPPluginCall) { call.resolve(statusObject(.events)) }

    @objc func pickFile(_ call: CAPPluginCall) {
        guard beginPick(call) else { return }
        pickFile(slot: Slot.named(call.getString("slot")))
    }

    @objc func createFile(_ call: CAPPluginCall) {
        guard beginPick(call) else { return }
        createFile(slot: Slot.named(call.getString("slot")))
    }

    /// On iOS a folder cannot be held (header), so the snapshot file is picked.
    @objc func pickFolder(_ call: CAPPluginCall) {
        guard beginPick(call) else { return }
        pickFile(slot: .snapshot)
    }

    @objc func read(_ call: CAPPluginCall) { call.resolve(readSlot(.snapshot)) }
    @objc func readUsers(_ call: CAPPluginCall) { call.resolve(readSlot(.users)) }
    @objc func readEvents(_ call: CAPPluginCall) { call.resolve(readSlot(.events)) }

    @objc func write(_ call: CAPPluginCall) { writeCall(call, .snapshot) }
    @objc func writeUsers(_ call: CAPPluginCall) { writeCall(call, .users) }
    @objc func writeEvents(_ call: CAPPluginCall) { writeCall(call, .events) }

    private func writeCall(_ call: CAPPluginCall, _ slot: Slot) {
        guard let text = call.getString("text") else {
            call.reject("missing text")
            return
        }
        call.resolve(["ok": writeSlot(slot, text)])
    }

    @objc func deleteFile(_ call: CAPPluginCall) { call.resolve(["ok": deleteSnapshot()]) }

    /// Forgets every file. The files themselves are left where they are.
    @objc func disconnect(_ call: CAPPluginCall) {
        for slot in [Slot.snapshot, .users, .events] { forget(slot) }
        call.resolve()
    }

    @objc func forgetUsers(_ call: CAPPluginCall) { forget(.users); call.resolve() }
    @objc func forgetEvents(_ call: CAPPluginCall) { forget(.events); call.resolve() }

    // MARK: - The pick in flight

    /// One pick at a time: a second call while a picker is up is refused, so
    /// the one on screen keeps the call that will be answered.
    private func beginPick(_ call: CAPPluginCall) -> Bool {
        if pendingCall != nil {
            call.reject("a picker is already open")
            return false
        }
        call.keepAlive = true
        pendingCall = call
        return true
    }

    private func finishPick(result: [String: Any]) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        call.keepAlive = false
        call.resolve(result)
    }

    private func finishPick(error: String, path: String? = nil) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        call.keepAlive = false
        NSLog("[directAccess] pick failed: %@ %@", error, path ?? "")
        call.reject(error, nil, nil, path.map { ["path": $0] } ?? [:])
    }

    // MARK: - File bookmarks

    private func fileURL(_ slot: Slot) -> URL? {
        guard let data = UserDefaults.standard.data(forKey: slot.bookmarkKey) else { return nil }
        var stale = false
        guard let url = try? URL(
            resolvingBookmarkData: data,
            options: [],
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        ) else { return nil }
        if stale, let fresh = try? url.bookmarkData(options: []) {
            UserDefaults.standard.set(fresh, forKey: slot.bookmarkKey)
        }
        return url
    }

    /// iCloud Drive keeps a cloud-only file as a hidden `.name.icloud` stub,
    /// and the older File Provider API writes its placeholders the same way.
    private func placeholderURL(for file: URL) -> URL {
        file.deletingLastPathComponent().appendingPathComponent("." + file.lastPathComponent + ".icloud")
    }

    private func isUbiquitous(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isUbiquitousItemKey]))?.isUbiquitousItem == true
    }

    private func present(_ picker: UIDocumentPickerViewController) {
        DispatchQueue.main.async {
            guard let rootVC = self.bridge?.viewController else {
                NSLog("[directAccess] pick: no view controller to present from")
                self.finishPick(error: "no view controller to present the picker from")
                return
            }
            picker.delegate = self
            picker.allowsMultipleSelection = false
            rootVC.present(picker, animated: true)
        }
    }

    // MARK: - pickFile / createFile

    /// Opens the Files picker on an existing file for the slot (the snapshot,
    /// or the roster). Any file can be chosen; the delegate refuses one with
    /// another name, so a wrong file is never adopted.
    private func pickFile(slot: Slot) {
        pendingSlot = slot
        present(UIDocumentPickerViewController(forOpeningContentTypes: [.json, .data]))
    }

    /// Creates the slot's file in a folder the user chooses, through the
    /// export picker: a temporary file holding the slot's seed is MOVED there
    /// (asCopy false), and the delegate bookmarks its new location. The
    /// snapshot's seed, "null", classifies as absent in the web layer, so the
    /// first cycle seeds the file from this device's data exactly as it seeds
    /// an empty folder.
    private func createFile(slot: Slot) {
        pendingSlot = slot
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(slot.fileName)
        do {
            try slot.seed.data(using: .utf8)!.write(to: tmp, options: .atomic)
        } catch {
            NSLog("[directAccess] create: temp file failed: %@", error.localizedDescription)
            finishPick(error: "could not prepare the file: \(error.localizedDescription)")
            return
        }
        present(UIDocumentPickerViewController(forExporting: [tmp], asCopy: false))
    }

    // MARK: - status / disconnect

    private func statusObject(_ slot: Slot) -> [String: Any] {
        let configured = UserDefaults.standard.data(forKey: slot.bookmarkKey) != nil
        var name: Any = NSNull()
        var path: Any = NSNull()
        var reachable = false
        if configured, let url = fileURL(slot) {
            name = url.lastPathComponent
            path = url.path
            if url.startAccessingSecurityScopedResource() {
                // On disk, or a placeholder the provider will fill on the first read.
                reachable = FileManager.default.fileExists(atPath: url.path)
                    || FileManager.default.fileExists(atPath: placeholderURL(for: url).path)
                url.stopAccessingSecurityScopedResource()
            }
        }
        return [
            "configured": configured,
            "name": name,
            "path": path,
            "reachable": reachable,
        ]
    }

    /// Forgets one file's bookmark. The file itself is left where it is.
    private func forget(_ slot: Slot) {
        UserDefaults.standard.removeObject(forKey: slot.bookmarkKey)
        caches[slot] = nil
    }

    // MARK: - read / write / delete

    private func readSlot(_ slot: Slot) -> [String: Any] {
        guard UserDefaults.standard.data(forKey: slot.bookmarkKey) != nil else {
            return kind("error", ["error": slot.missingMessage])
        }
        guard let file = fileURL(slot), file.startAccessingSecurityScopedResource() else {
            return kind("error", ["error": "permission denied"])
        }
        defer { file.stopAccessingSecurityScopedResource() }
        let cache = caches[slot]

        var isDir: ObjCBool = false
        let onDisk = FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir)
        if onDisk && isDir.boolValue { return kind("error", ["error": "\(slot.fileName) is not a file"]) }
        let stub = placeholderURL(for: file)
        let hasStub = FileManager.default.fileExists(atPath: stub.path)

        // iCloud Drive: a coordinated read of a cloud-only item blocks until it
        // is down, so ask for the download and let the next poll read it. A
        // provider's placeholder is filled by the coordinated read below.
        if !onDisk && hasStub && isUbiquitous(file) {
            try? FileManager.default.startDownloadingUbiquitousItem(at: file)
            return kind("downloading")
        }

        if onDisk {
            let attrs = try? FileManager.default.attributesOfItem(atPath: file.path)
            let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
            let modified = (attrs?[.modificationDate] as? Date) ?? Date.distantPast
            // A provider part-way through replacing it.
            if size == 0 { return kind("downloading") }
            if let c = cache, c.modified == modified, c.size == size {
                return kind("text", ["text": c.text])
            }
        }

        // The coordinated read is what makes the provider put the file on disk
        // (startProvidingItem), and reads the one that is there.
        var text: String?
        var coordError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: file, options: [], error: &coordError) { url in
            if let data = try? Data(contentsOf: url), let s = String(data: data, encoding: .utf8) {
                text = s
            }
        }
        if let e = coordError {
            // Gone for good (deleted on another device, the provider forgot
            // it): the user re-picks or re-creates. Anything else is transient.
            let gone = !onDisk && !hasStub
                && e.domain == NSCocoaErrorDomain
                && (e.code == NSFileReadNoSuchFileError || e.code == NSFileNoSuchFileError)
            return gone
                ? kind("error", ["error": "the sync file is gone: \(e.localizedDescription)"])
                : kind("downloading")
        }
        guard let t = text, !t.isEmpty else {
            return (onDisk || hasStub)
                ? kind("downloading")
                : kind("error", ["error": "the sync file is gone"])
        }
        let attrs = try? FileManager.default.attributesOfItem(atPath: file.path)
        let size = (attrs?[.size] as? NSNumber)?.intValue ?? t.utf8.count
        let modified = (attrs?[.modificationDate] as? Date) ?? Date()
        caches[slot] = (modified, size, t)
        return kind("text", ["text": t])
    }

    private func writeSlot(_ slot: Slot, _ text: String) -> Bool {
        guard let file = fileURL(slot), file.startAccessingSecurityScopedResource() else { return false }
        defer { file.stopAccessingSecurityScopedResource() }
        guard let data = text.data(using: .utf8) else { return false }

        var ok = false
        var coordError: NSError?
        // `.forReplacing` is what tells a provider to upload the new version
        // (itemChanged); the write is atomic so a torn file never ships.
        NSFileCoordinator().coordinate(writingItemAt: file, options: .forReplacing, error: &coordError) { url in
            ok = (try? data.write(to: url, options: .atomic)) != nil
        }
        caches[slot] = nil
        return ok && coordError == nil
    }

    /// Deletes the snapshot (reset scope "everywhere"), and forgets the
    /// bookmark with it: a bookmark of a deleted file is good for nothing,
    /// and the card then offers to pick or create again. A missing file
    /// counts as deleted.
    private func deleteSnapshot() -> Bool {
        guard let file = fileURL(.snapshot), file.startAccessingSecurityScopedResource() else { return false }
        defer { file.stopAccessingSecurityScopedResource() }
        caches[.snapshot] = nil
        let present = FileManager.default.fileExists(atPath: file.path)
            || FileManager.default.fileExists(atPath: placeholderURL(for: file).path)
        var ok = !present
        if present {
            var coordError: NSError?
            NSFileCoordinator().coordinate(writingItemAt: file, options: .forDeleting, error: &coordError) { url in
                ok = (try? FileManager.default.removeItem(at: url)) != nil
            }
            ok = ok && coordError == nil
        }
        if ok { UserDefaults.standard.removeObject(forKey: Slot.snapshot.bookmarkKey) }
        return ok
    }

    // MARK: - Helpers

    private func kind(_ kind: String, _ extra: [String: Any] = [:]) -> [String: Any] {
        var obj: [String: Any] = ["kind": kind]
        for (k, v) in extra { obj[k] = v }
        return obj
    }
}

// MARK: - UIDocumentPickerDelegate

extension DirectAccessPlugin: UIDocumentPickerDelegate {

    /// Both pickers land here: the open picker with the file the user chose,
    /// the export picker with the moved file's new location.
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else {
            NSLog("[directAccess] pick: the picker returned no URL")
            finishPick(error: "the picker returned no file")
            return
        }
        // A false here means the URL carried no security scope to start, not
        // that access is denied; the bookmark is the real test.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let slot = pendingSlot
        let expected = slot.fileName

        // The wrong file is never adopted. The export picker renames on a
        // name clash ("dayglance-sync 2.json"): that means the folder already
        // has the fleet's file, so the stray copy is removed and the user is
        // told to choose the existing one.
        guard url.lastPathComponent == expected else {
            NSLog("[directAccess] pick: refused %@ (not %@)", url.path, expected)
            let stem = (expected as NSString).deletingPathExtension
            if url.lastPathComponent.hasPrefix(stem) {
                var coordError: NSError?
                NSFileCoordinator().coordinate(writingItemAt: url, options: .forDeleting, error: &coordError) { u in
                    try? FileManager.default.removeItem(at: u)
                }
                finishPick(error: "that folder already has a \(expected): choose it instead of creating one", path: url.path)
            } else {
                finishPick(error: "that is not \(expected)", path: url.path)
            }
            return
        }
        do {
            let bookmark = try url.bookmarkData(options: [])
            UserDefaults.standard.set(bookmark, forKey: slot.bookmarkKey)
            caches[slot] = nil
            NSLog("[directAccess] picked %@ for %@ (security scope: %@)", url.path, slot.rawValue, scoped ? "yes" : "no")
            // The page updates its card and kicks a cycle from this; no reload.
            var st = statusObject(slot)
            st["slot"] = slot.rawValue
            finishPick(result: st)
        } catch {
            NSLog("[directAccess] pick: bookmark failed for %@ (security scope: %@): %@",
                  url.path, scoped ? "yes" : "no", error.localizedDescription)
            finishPick(error: "bookmark: \(error.localizedDescription)", path: url.path)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        NSLog("[directAccess] pick cancelled")
        finishPick(result: ["cancelled": true])
    }
}
