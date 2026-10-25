import Foundation
import Capacitor

// Zero-config iCloud sync (docs/icloud-sync.md): the iOS half, as a Capacitor
// plugin. lastGLANCE's ICloudPlugin.swift (itself ported from dayGLANCE's
// ICloudBridge.swift, whose comments explain the iCloud behaviour each rule
// answers), with lifeGLANCE's container and sync file.
//
// Two containers, by name:
//   • "own"       iCloud.com.lifeglance: lifeglance-sync.json, synced for
//                 every iPhone and iPad on the Apple ID with nothing to set up.
//   • "dayglance" iCloud.com.dayglance: GLANCE/events/, the intents event
//                 files the GLANCE apps exchange over iCloud. Both containers
//                 must be assigned to the com.lifeglance App ID in the Apple
//                 Developer portal.
// Paths are relative to the container's Documents/ folder and confined to it.
//
// Reads answer the classification every file shell answers (see
// DirectAccessPlugin): absent, downloading, error, or text. iCloud adds two
// rules from dayGLANCE:
//   • A local copy is served only once it is CURRENT. NSFileCoordinator alone
//     does not make the daemon fetch a newer remote version, so every read asks
//     for a download and answers `downloading` until the status is `.current`.
//   • `allowStale`: after the web layer's grace period it may take the bytes
//     this device already holds (`.downloaded`), so its edits are not held
//     hostage by a stalled fetch. A file with no bytes at all still answers
//     downloading.
//
//   available()                                   → { available }
//   readFile({ path, container?, allowStale? })    → { kind, text?, error? }
//   writeFile({ path, text, container?, atomic? }) → { ok, error? }
//   listFiles({ path, container? })                → { names }   null when unavailable
//   deleteFile({ path, container? })               → { ok }
//   makeDir({ path, container? })                  → { ok }
//   event "changed"                                the sync file changed remotely
//
// Registered in MainViewController.capacitorDidLoad().
@objc(ICloudPlugin)
public class ICloudPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "ICloudPlugin"
    public let jsName = "ICloud"
    public let pluginMethods: [CAPPluginMethod] = [
        "available", "readFile", "writeFile", "listFiles", "deleteFile", "makeDir",
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    static let containers: [String: String] = [
        "own": "iCloud.com.lifeglance",
        "dayglance": "iCloud.com.dayglance",
    ]
    /// The own container's file whose remote changes kick a cycle.
    static let watchedFiles = ["lifeglance-sync.json"]

    private var metadataQuery: NSMetadataQuery?
    // Suppress query callbacks that fire right after our own write (dayGLANCE).
    private var lastLocalWriteDate: Date?
    private let writeSuppressionInterval: TimeInterval = 2.0

    // MARK: - Methods

    @objc func available(_ call: CAPPluginCall) {
        let ok = documentsURL("own") != nil
        if ok { DispatchQueue.main.async { self.startWatching() } }
        call.resolve(["available": ok])
    }

    @objc func readFile(_ call: CAPPluginCall) {
        guard let file = fileURL(call) else { return }
        call.resolve(read(file, allowStale: call.getBool("allowStale") ?? false))
    }

    @objc func writeFile(_ call: CAPPluginCall) {
        guard let file = fileURL(call) else { return }
        guard let text = call.getString("text"), let data = text.data(using: .utf8) else {
            call.resolve(["ok": false, "error": "missing text"]); return
        }
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            lastLocalWriteDate = Date()
            // Snapshots are replaced atomically, as dayGLANCE's writeSync does;
            // event files are written in place to keep the iCloud xattrs that
            // queue the upload (dayGLANCE's writeFile).
            try data.write(to: file, options: (call.getBool("atomic") ?? false) ? .atomic : [])
            call.resolve(["ok": true])
        } catch {
            call.resolve(["ok": false, "error": error.localizedDescription])
        }
    }

    @objc func listFiles(_ call: CAPPluginCall) {
        guard let dir = fileURL(call, allowRoot: true) else { return }
        guard FileManager.default.fileExists(atPath: dir.path) else { call.resolve(["names": []]); return }
        let entries = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        // A cloud-only file shows as a hidden .name.icloud placeholder: ask for it.
        for entry in entries where entry.hasPrefix(".") && entry.hasSuffix(".icloud") {
            let inner = String(entry.dropFirst().dropLast(".icloud".count))
            try? FileManager.default.startDownloadingUbiquitousItem(at: dir.appendingPathComponent(inner))
        }
        call.resolve(["names": entries.filter { !$0.hasPrefix(".") }])
    }

    @objc func deleteFile(_ call: CAPPluginCall) {
        guard let file = fileURL(call) else { return }
        guard FileManager.default.fileExists(atPath: file.path) else { call.resolve(["ok": true]); return }
        do {
            try FileManager.default.removeItem(at: file)
            call.resolve(["ok": true])
        } catch {
            call.resolve(["ok": false, "error": error.localizedDescription])
        }
    }

    @objc func makeDir(_ call: CAPPluginCall) {
        guard let dir = fileURL(call) else { return }
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            call.resolve(["ok": true])
        } catch {
            call.resolve(["ok": false, "error": error.localizedDescription])
        }
    }

    // MARK: - Reading

    private func read(_ file: URL, allowStale: Bool) -> [String: Any] {
        // On older iOS a cloud-only file is a hidden .name.icloud placeholder.
        let placeholder = file.deletingLastPathComponent().appendingPathComponent("." + file.lastPathComponent + ".icloud")
        if FileManager.default.fileExists(atPath: placeholder.path) {
            try? FileManager.default.startDownloadingUbiquitousItem(at: file)
            return ["kind": "downloading"]
        }
        guard FileManager.default.fileExists(atPath: file.path) else {
            // Not here: ask for it in case it exists remotely; the cycle's seed
            // guard decides what an absence means.
            try? FileManager.default.startDownloadingUbiquitousItem(at: file)
            return ["kind": "absent"]
        }
        // Always ask the daemon for the latest version; a no-op when current.
        try? FileManager.default.startDownloadingUbiquitousItem(at: file)
        let status = (try? file.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]))?.ubiquitousItemDownloadingStatus
        if let status, status != .current, !(allowStale && status == .downloaded) {
            return ["kind": "downloading"]
        }
        var text: String?
        var coordError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: file, options: [], error: &coordError) { url in
            if let data = try? Data(contentsOf: url) { text = String(data: data, encoding: .utf8) }
        }
        if let coordError { return ["kind": "error", "error": coordError.localizedDescription] }
        guard let text else { return ["kind": "error", "error": "unreadable file"] }
        // A zero-length file is mid-write or mid-download, never empty data.
        if text.isEmpty { return ["kind": "downloading"] }
        return ["kind": "text", "text": text]
    }

    // MARK: - Paths

    private func documentsURL(_ container: String) -> URL? {
        guard let id = Self.containers[container] else { return nil }
        return FileManager.default.url(forUbiquityContainerIdentifier: id)?.appendingPathComponent("Documents")
    }

    /// The file the call names, confined to its container's Documents/. Rejects
    /// the call (and returns nil) when the container is unknown or unavailable,
    /// or the path would leave the folder.
    private func fileURL(_ call: CAPPluginCall, allowRoot: Bool = false) -> URL? {
        let container = call.getString("container") ?? "own"
        let raw = call.getString("path") ?? ""
        guard let segments = Self.segments(raw), allowRoot || !segments.isEmpty else {
            call.reject("path outside the folder"); return nil
        }
        guard let docs = documentsURL(container) else {
            // Answered in each method's own shape, never rejected: signed out,
            // iCloud Drive off for the app, or an unknown container.
            switch call.methodName {
            case "readFile": call.resolve(["kind": "error", "error": "iCloud not available"])
            case "listFiles": call.resolve(["names": NSNull()])
            default: call.resolve(["ok": false, "error": "iCloud not available"])
            }
            return nil
        }
        return segments.reduce(docs) { $0.appendingPathComponent($1) }
    }

    /// The path's segments, or nil when it is not a path inside the folder
    /// (an absolute path or any `..`), as DirectAccessPath confines on Android.
    static func segments(_ rel: String) -> [String]? {
        if rel.hasPrefix("/") || rel.hasPrefix("\\") || rel.contains(":") { return nil }
        var out: [String] = []
        for raw in rel.split(whereSeparator: { $0 == "/" || $0 == "\\" }) {
            let seg = raw.trimmingCharacters(in: .whitespaces)
            if seg.isEmpty || seg == "." { continue }
            if seg == ".." { return nil }
            out.append(seg)
        }
        return out
    }

    // MARK: - Remote-change watching

    /// Watches the own container's sync file so a remote change runs a cycle
    /// now rather than at the next poll. Must run on the main thread.
    private func startWatching() {
        guard metadataQuery == nil else { return }
        let q = NSMetadataQuery()
        q.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
        q.predicate = NSPredicate(format: "%K IN %@", NSMetadataItemFSNameKey, Self.watchedFiles)
        // The query posts no update until its initial gathering completes.
        NotificationCenter.default.addObserver(self, selector: #selector(handleQueryUpdate), name: .NSMetadataQueryDidFinishGathering, object: q)
        NotificationCenter.default.addObserver(self, selector: #selector(handleQueryUpdate), name: .NSMetadataQueryDidUpdate, object: q)
        q.start()
        metadataQuery = q
    }

    @objc private func handleQueryUpdate() {
        if let last = lastLocalWriteDate, Date().timeIntervalSince(last) < writeSuppressionInterval { return }
        // Start the downloads before telling the page, or a read would serve the
        // previous bytes; the read then answers downloading until they land.
        if let docs = documentsURL("own") {
            for name in Self.watchedFiles {
                try? FileManager.default.startDownloadingUbiquitousItem(at: docs.appendingPathComponent(name))
            }
        }
        notifyListeners("changed", data: [:])
    }
}
