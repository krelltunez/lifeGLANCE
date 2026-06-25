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
    }
}

struct NextMilestoneWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextMilestoneWidget", provider: SnapshotProvider()) { entry in
            NextMilestoneView(entry: entry).widgetBackground(Palette.bg)
        }
        .configurationDisplayName("Next milestone")
        .description("Your next upcoming milestone, with a live countdown.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TodayWidget", provider: SnapshotProvider()) { entry in
            TodayView(entry: entry).widgetBackground(Palette.bg)
        }
        .configurationDisplayName("Today")
        .description("Today's date and your age, with recent and upcoming milestones at larger sizes.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct CurrentChapterWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CurrentChapterWidget", provider: SnapshotProvider()) { entry in
            CurrentChapterView(entry: entry).widgetBackground(Palette.bg)
        }
        .configurationDisplayName("Current chapter")
        .description("The chapter you're in now: how far along you are and milestones passed.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
