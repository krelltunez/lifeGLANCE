import Foundation
import Capacitor
import CoreSpotlight

// Core Spotlight indexing for milestones: system search into a life timeline.
//
// The web layer pushes the full searchable set (src/native/spotlightBridge.js →
// buildSpotlightIndex) on the same debounced flush that feeds the widget
// snapshot. This is deliberately NOT the widget projection — that one is a
// bounded summary, and Spotlight needs every milestone — and nothing extra is
// written to the App Group: CSSearchableIndex itself is the store, and indexing
// happens in the app process, so no extension is involved.
//
// Each push replaces the whole domain (delete by domainIdentifier, then insert).
// Idempotent and simple; at a few hundred text-only items there is nothing to
// gain from diffing. The JS side already skips pushes whose payload is unchanged.
//
// The index is on-device only (CSSearchableIndex does not sync), which is the
// right default for a local-first app. Visibility filtering happens web-side:
// milestones hidden from the main timeline are never in the payload.
//
// Tap-through: a result tap delivers CSSearchableItemActionType via
// NSUserActivity — handled in AppDelegate, which stashes the item id as
// pending_target, the exact contract a widget tap uses. The web layer then pans
// to and opens that milestone with zero new JS.
@objc(SpotlightPlugin)
public class SpotlightPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpotlightPlugin"
    public let jsName = "Spotlight"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setIndex", returnType: CAPPluginReturnPromise),
    ]

    static let domain = "com.lifeglance.milestones"

    private struct IndexItem: Decodable {
        let id: String
        let title: String
        let desc: String?
    }

    // Replaces the milestone search index with the given items.
    // json: [{ id, title, desc? }] — desc is the line under the title in results.
    @objc func setIndex(_ call: CAPPluginCall) {
        guard let json = call.getString("json"),
              let data = json.data(using: .utf8),
              let items = try? JSONDecoder().decode([IndexItem].self, from: data) else {
            call.reject("Missing or malformed 'json'")
            return
        }

        let searchable = items.map { item -> CSSearchableItem in
            let attrs = CSSearchableItemAttributeSet(contentType: .text)
            attrs.title = item.title
            attrs.contentDescription = item.desc
            let searchableItem = CSSearchableItem(
                uniqueIdentifier: item.id,
                domainIdentifier: Self.domain,
                attributeSet: attrs
            )
            // Items expire out of the index after ~a month by default. This
            // index is fully replaced on every data change, but a device that
            // simply doesn't open the app for a while must not have its history
            // quietly fall out of search.
            searchableItem.expirationDate = Date.distantFuture
            return searchableItem
        }

        let index = CSSearchableIndex.default()
        index.deleteSearchableItems(withDomainIdentifiers: [Self.domain]) { _ in
            // Delete errors are ignored deliberately: first run has nothing to
            // delete, and a failed delete followed by a successful insert still
            // converges because uniqueIdentifiers overwrite.
            index.indexSearchableItems(searchable) { error in
                if let error {
                    call.reject("Spotlight indexing failed: \(error.localizedDescription)")
                } else {
                    call.resolve()
                }
            }
        }
    }
}
