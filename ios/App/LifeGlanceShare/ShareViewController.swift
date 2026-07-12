import UIKit
import UniformTypeIdentifiers

// Share Extension entry point. Receives text / links shared into lifeGLANCE from
// the iOS share sheet, stashes them in the App Group under "pending_share", then
// opens the host app — which reads the share via WidgetBridge.consumeLaunchTarget()
// on resume and opens a pre-filled Add-milestone sheet. This mirrors the Android
// ACTION_SEND path (MainActivity.handleShareIntent).
//
// The payload written is a JSON string { "text": …, "subject": … } (either key
// optional), the exact shape src/native/shareDraft.js expects.
//
// Kept self-contained — it writes to the App Group inline rather than importing the
// widgets' WidgetStore — so the extension target only needs this one Swift file, the
// same approach AppDelegate.handleWidgetDeepLink already uses on the app side.
@objc(ShareViewController)
final class ShareViewController: UIViewController {

    private let appGroupId = "group.com.lifeglance"
    private let pendingShareKey = "pending_share"

    override func viewDidLoad() {
        super.viewDidLoad()
        Task {
            await handleShare()
            openHostAndFinish()
        }
    }

    private func handleShare() async {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return }

        var text = ""
        var subject = ""

        for item in items {
            // The item's content text (a Safari page title, or text the user typed /
            // selected) maps to Android's EXTRA_SUBJECT.
            if subject.isEmpty,
               let content = item.attributedContentText?.string,
               !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                subject = content
            }
            for provider in item.attachments ?? [] {
                if text.isEmpty, let url = await loadURL(from: provider) {
                    // Put the URL into `text` so shareToMilestoneDraft() extracts it,
                    // exactly like Android's EXTRA_TEXT usually carrying the link.
                    text = url
                } else if text.isEmpty, let plain = await loadText(from: provider) {
                    text = plain
                }
            }
        }

        let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSubject = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedText.isEmpty || !trimmedSubject.isEmpty else { return }

        var payload: [String: String] = [:]
        if !trimmedText.isEmpty { payload["text"] = trimmedText }
        if !trimmedSubject.isEmpty { payload["subject"] = trimmedSubject }

        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let json = String(data: data, encoding: .utf8) {
            UserDefaults(suiteName: appGroupId)?.set(json, forKey: pendingShareKey)
        }
    }

    private func loadURL(from provider: NSItemProvider) async -> String? {
        guard provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) else { return nil }
        let item = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier)
        if let url = item as? URL { return url.absoluteString }
        if let url = item as? NSURL { return url.absoluteString }
        return nil
    }

    private func loadText(from provider: NSItemProvider) async -> String? {
        guard provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) else { return nil }
        let item = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier)
        if let s = item as? String { return s }
        if let s = item as? NSString { return s as String }
        return nil
    }

    // Bring the host app forward, then finish. An extension can't touch
    // UIApplication.shared, so walk the responder chain to whoever implements
    // openURL:. Opening lifeglance://share is enough — the share payload is already
    // in the App Group; AppDelegate accepts the "share" host as a no-op.
    private func openHostAndFinish() {
        if let url = URL(string: "lifeglance://share") {
            var responder: UIResponder? = self
            let selector = sel_registerName("openURL:")
            while let r = responder {
                if r.responds(to: selector) {
                    _ = r.perform(selector, with: url)
                    break
                }
                responder = r.next
            }
        }
        extensionContext?.completeRequest(returningItems: nil)
    }
}
