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
        PinnedCountdownWidget()
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

struct PinnedCountdownWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PinnedCountdownWidget", provider: SnapshotProvider()) { entry in
            PinnedCountdownView(entry: entry).widgetBackground(Palette.bg)
        }
        .configurationDisplayName("Pinned countdown")
        .description("A countdown to a milestone you've pinned in the app.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
