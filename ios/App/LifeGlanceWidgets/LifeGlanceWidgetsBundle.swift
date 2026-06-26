import SwiftUI
import WidgetKit

// Entry point for the widget extension. Bundles the three lifeGLANCE widgets, all
// driven by the same App Group snapshot via SnapshotProvider.
@main
struct LifeGlanceWidgetsBundle: WidgetBundle {
    var body: some Widget {
        NextMilestoneWidget()
        TodayWidget()
        CurrentChapterWidget()
        OnThisDayWidget()
        StatsWidget()
        QuickAddWidget()
        AmberCountdownWidget()
        RoseCountdownWidget()
        TealCountdownWidget()
        BlueCountdownWidget()
    }
}

// Each color slot is its own widget (so several pinned countdowns can coexist without
// per-widget configuration). They share PinnedSlotView, parameterized by slot + accent.
private func slotConfig(kind: String, slot: String, accentHex: String, name: String) -> some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
        PinnedSlotView(entry: entry, slot: slot, accent: Color(hex: accentHex, fallback: Palette.amber))
            .widgetBackground(Palette.bg)
    }
    .configurationDisplayName(name)
    .description("A countdown to the milestone pinned to this color slot in the app.")
    .supportedFamilies([.systemSmall, .systemMedium])
}

struct AmberCountdownWidget: Widget {
    var body: some WidgetConfiguration {
        slotConfig(kind: "PinnedAmber", slot: "amber", accentHex: "C8A96E", name: "Countdown · amber")
    }
}
struct RoseCountdownWidget: Widget {
    var body: some WidgetConfiguration {
        slotConfig(kind: "PinnedRose", slot: "rose", accentHex: "E85D75", name: "Countdown · rose")
    }
}
struct TealCountdownWidget: Widget {
    var body: some WidgetConfiguration {
        slotConfig(kind: "PinnedTeal", slot: "teal", accentHex: "38B2AC", name: "Countdown · teal")
    }
}
struct BlueCountdownWidget: Widget {
    var body: some WidgetConfiguration {
        slotConfig(kind: "PinnedBlue", slot: "blue", accentHex: "4A90D9", name: "Countdown · blue")
    }
}

struct NextMilestoneWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextMilestoneWidget", provider: SnapshotProvider()) { entry in
            NextMilestoneView(entry: entry).widgetBackground(Palette.bg)
        }
        .configurationDisplayName("Next milestone")
        .description("Your next upcoming milestone, with a live countdown.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TodayWidget", provider: SnapshotProvider()) { entry in
            TodayView(entry: entry).widgetBackground(Palette.bg)
        }
        .configurationDisplayName("Today")
        .description("Today's date and your age, with recent and upcoming milestones at larger sizes.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct CurrentChapterWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CurrentChapterWidget", provider: SnapshotProvider()) { entry in
            CurrentChapterView(entry: entry).widgetBackground(Palette.bg)
        }
        .configurationDisplayName("Current chapter")
        .description("The chapter you're in now: how far along you are and milestones passed.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct OnThisDayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OnThisDayWidget", provider: SnapshotProvider()) { entry in
            OnThisDayView(entry: entry).widgetBackground(Palette.bg)
        }
        .configurationDisplayName("On this day")
        .description("Milestones from today's date in past years.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct StatsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StatsWidget", provider: SnapshotProvider()) { entry in
            StatsView(entry: entry).widgetBackground(Palette.bg)
        }
        .configurationDisplayName("Milestones")
        .description("Your milestone totals: past, ahead, this year, and your age.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct QuickAddWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QuickAddWidget", provider: SnapshotProvider()) { _ in
            QuickAddView().widgetBackground(Palette.bg)
        }
        .configurationDisplayName("Add milestone")
        .description("A one-tap shortcut to add a new milestone.")
        .supportedFamilies([.systemSmall])
    }
}
