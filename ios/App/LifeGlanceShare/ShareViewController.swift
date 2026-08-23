import UIKit
import UniformTypeIdentifiers

// Share Extension entry point. Receives text / links shared into lifeGLANCE from
// the iOS share sheet, appends them to a queue in the App Group under
// "pending_share", and confirms to the user. The app drains that queue via
// WidgetBridge.consumeLaunchTarget() on launch/resume and opens a pre-filled
// Add-milestone sheet. This mirrors the Android ACTION_SEND path
// (MainActivity.handleShareIntent).
//
// Each queued entry is a JSON string { "text": …, "subject": … } (either key
// optional), the exact shape src/native/shareDraft.js expects.
//
// NOTE ON WHY THIS SHOWS UI: the extension deliberately does NOT try to open the
// host app. App extensions are barred from opening URLs — the old trick of walking
// the responder chain for openURL: stopped working in iOS 18, and Apple DTS is
// explicit that this is by design and should not be worked around. So a share can
// only land quietly in the App Group, which without any UI is indistinguishable
// from the share having failed. This confirmation sheet is that missing feedback.
// See docs/ios-share-extension-spec.md.
//
// Kept self-contained — it writes to the App Group inline rather than importing the
// widgets' WidgetStore — so the extension target only needs this one Swift file, the
// same approach AppDelegate.handleWidgetDeepLink already uses on the app side.
@objc(ShareViewController)
final class ShareViewController: UIViewController {

    private let appGroupId = "group.com.lifeglance"
    private let pendingShareKey = "pending_share"

    // Matches Palette in the widgets' WidgetTheme.swift and the web app's dark theme
    // tokens in src/index.css. Duplicated rather than shared to keep this target to
    // a single file.
    private let bgColor = UIColor(red: 0x0F / 255, green: 0x11 / 255, blue: 0x17 / 255, alpha: 1)
    private let textColor = UIColor(red: 0xE8 / 255, green: 0xE0 / 255, blue: 0xD0 / 255, alpha: 1)
    private let amberColor = UIColor(red: 0xC8 / 255, green: 0xA9 / 255, blue: 0x6E / 255, alpha: 1)
    private let mutedColor = UIColor(red: 0x8A / 255, green: 0x82 / 255, blue: 0x70 / 255, alpha: 1)

    private let card = UIView()
    private let headline = UILabel()
    private let detail = UILabel()
    private let doneButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        buildUI()
        Task {
            let saved = await handleShare()
            show(saved: saved)
        }
    }

    // Extracts the shared item and, if there is anything usable, appends it to the
    // pending-share queue. Returns the title we captured, or nil if nothing usable.
    private func handleShare() async -> String? {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return nil }

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
        guard !trimmedText.isEmpty || !trimmedSubject.isEmpty else { return nil }

        var payload: [String: String] = [:]
        if !trimmedText.isEmpty { payload["text"] = trimmedText }
        if !trimmedSubject.isEmpty { payload["subject"] = trimmedSubject }

        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return nil }

        enqueue(json)
        return trimmedSubject.isEmpty ? trimmedText : trimmedSubject
    }

    // Appends to the pending-share queue. A queue rather than a single slot because
    // the app is no longer brought forward on share: entries now pile up until the
    // user next opens lifeGLANCE, so a last-write-wins slot would silently drop every
    // share but the most recent. Legacy single-string values are migrated in place.
    private func enqueue(_ json: String) {
        let defaults = UserDefaults(suiteName: appGroupId)
        var queue: [String] = []
        if let existing = defaults?.array(forKey: pendingShareKey) as? [String] {
            queue = existing
        } else if let legacy = defaults?.string(forKey: pendingShareKey) {
            queue = [legacy]
        }
        queue.append(json)
        defaults?.set(queue, forKey: pendingShareKey)
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

    // MARK: - UI

    private func buildUI() {
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)

        card.backgroundColor = bgColor
        card.layer.cornerRadius = 16
        card.translatesAutoresizingMaskIntoConstraints = false
        card.alpha = 0
        view.addSubview(card)

        headline.font = .systemFont(ofSize: 17, weight: .semibold)
        headline.textColor = textColor
        headline.numberOfLines = 1
        headline.textAlignment = .center

        detail.font = .systemFont(ofSize: 14)
        detail.textColor = mutedColor
        detail.numberOfLines = 3
        detail.textAlignment = .center

        doneButton.setTitle(String(localized: "Done"), for: .normal)
        doneButton.setTitleColor(amberColor, for: .normal)
        doneButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        doneButton.addTarget(self, action: #selector(finish), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [headline, detail, doneButton])
        stack.axis = .vertical
        stack.spacing = 12
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 340),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
        ])
    }

    // `saved` is the captured title, or nil when the item held nothing usable.
    private func show(saved: String?) {
        if let title = saved {
            headline.text = String(localized: "Saved to lifeGLANCE")
            detail.text = String(localized: "\(title)\n\nIt'll be waiting as a new milestone next time you open the app.")
        } else {
            headline.text = String(localized: "Nothing to save")
            detail.text = String(localized: "This item didn't contain any text or link lifeGLANCE could use.")
        }
        UIView.animate(withDuration: 0.2) { self.card.alpha = 1 }
    }

    @objc private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
