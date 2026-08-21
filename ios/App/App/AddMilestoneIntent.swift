import AppIntents
import Foundation

// "Add milestone" App Intent — the minimal iOS automation surface described in
// docs/lifeglance-native-roadmap.md: declare the one intent and stop there. No
// parameterized intents, no Shortcuts chaining. The asymmetry with Android is
// deliberate (Tasker already speaks the intent surface declared for app-to-app
// interop there, so depth is nearly free; on iOS equivalent depth means
// hand-building parameterized Shortcuts surfaces).
//
// This reuses the Quick Add widget's contract rather than inventing a second one:
// write "new" to the App Group's pending_action key, which
// WidgetBridgePlugin.consumeLaunchTarget() hands to the web layer, which opens
// the Add-milestone sheet (TimelineView, `target.action === 'new'`). Same path a
// Quick Add widget tap takes, so there is one code path to keep working.
//
// iOS 16+, which the project now targets, so no availability gating.
struct AddMilestoneIntent: AppIntent {
    static var title: LocalizedStringResource = "Add Milestone"
    static var description = IntentDescription(
        "Opens lifeGLANCE with a new milestone ready to fill in."
    )

    // The Add sheet is web UI inside the app, so there is nothing meaningful this
    // intent could do headlessly — it always brings the app forward.
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        // Constants rather than string literals: a typo here would fail silently,
        // with the app simply opening to the timeline and no sheet.
        UserDefaults(suiteName: WidgetStore.appGroupId)?
            .set("new", forKey: WidgetStore.keyPendingAction)
        return .result()
    }
}

// Surfaces the intent to Siri and the Shortcuts app without the user having to
// assemble a shortcut first. Phrases must interpolate .applicationName — the API
// requires the app name in every phrase.
struct LifeGlanceAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddMilestoneIntent(),
            phrases: [
                "Add a milestone in \(.applicationName)",
                "New milestone in \(.applicationName)",
                "Add a \(.applicationName) milestone",
            ],
            shortTitle: "Add milestone",
            systemImageName: "plus.circle"
        )
    }
}
