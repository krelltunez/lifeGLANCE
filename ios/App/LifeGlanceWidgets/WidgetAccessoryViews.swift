import SwiftUI
import WidgetKit

// Lock Screen (accessory) widget views. iOS 16+, which the whole project now
// targets, so no availability gating is needed.
//
// These are deliberately NOT the system-family views shrunk down. Two constraints
// drive the difference:
//
//  1. The Lock Screen renders accessory widgets in `WidgetRenderingMode.vibrant`:
//     content is desaturated to a single tone and composited against the
//     wallpaper. Palette.amber and the per-slot accent colors carry no
//     information here — everything arrives the same shade — so these views lean
//     on hierarchy, weight, and wording instead of color.
//  2. They must not paint an opaque background. The system-family views call
//     .widgetBackground(Palette.bg); accessory views use accessoryBackground()
//     (a clear container) or AccessoryWidgetBackground() for the standard
//     translucent circle, so the wallpaper shows through as the platform expects.
//
// System fonts rather than the app's monospace: the Lock Screen sits directly
// under the system clock, and matching its typography reads better than matching
// the app's.

// MARK: - Shared helpers

extension View {
    // Accessory widgets must not fill their container with an opaque color. On
    // iOS 17+ a container background is still required, so declare a clear one.
    @ViewBuilder
    func accessoryBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(.clear, for: .widget)
        } else {
            self
        }
    }
}

// Days until (negative = past). Nil when the date can't be parsed.
private func daysUntil(_ iso: String) -> Int? {
    guard let date = WidgetDate.calendarDate(iso) else { return nil }
    return Calendar.current.dateComponents([.day], from: WidgetDate.todayDate(), to: date).day
}

// Mirrors the private helper in WidgetViews.swift: nil id yields nil, so an empty
// widget doesn't deep-link to "lifeglance://milestone?id=" and leave the app
// hunting for a milestone that was never there.
private func accessoryMilestoneURL(_ id: String?) -> URL? {
    guard let id, !id.isEmpty else { return nil }
    return URL(string: "lifeglance://milestone?id=\(id)")
}

// MARK: - Next milestone

struct NextMilestoneCircularView: View {
    let entry: SnapshotEntry

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            if let next = entry.snapshot?.next, let days = daysUntil(next.date) {
                VStack(spacing: -2) {
                    Text("\(max(days, 0))")
                        .font(.system(size: 22, weight: .semibold, design: .rounded))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    Text(days == 1 ? "day" : "days")
                        .font(.system(size: 10))
                }
            } else {
                Image(systemName: "calendar")
            }
        }
        .widgetURL(accessoryMilestoneURL(entry.snapshot?.next?.id))
    }
}

struct NextMilestoneRectangularView: View {
    let entry: SnapshotEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let next = entry.snapshot?.next {
                // No color available to mark this as a label, so weight does it.
                Text("NEXT").font(.system(size: 11, weight: .bold))
                Text(next.title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                Text(WidgetDate.relativeLabel(next.date)).font(.system(size: 12)).lineLimit(1)
            } else {
                Text("No upcoming milestones").font(.system(size: 13)).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(accessoryMilestoneURL(entry.snapshot?.next?.id))
    }
}

struct NextMilestoneInlineView: View {
    let entry: SnapshotEntry

    // .accessoryInline shares one line with the clock and ignores custom fonts
    // and colors, so this is a single plain Text by design.
    var body: some View {
        if let next = entry.snapshot?.next {
            Text("\(next.title) · \(WidgetDate.relativeLabel(next.date))")
        } else {
            Text("No upcoming milestones")
        }
    }
}

// MARK: - Current chapter

struct CurrentChapterCircularView: View {
    let entry: SnapshotEntry

    var body: some View {
        ZStack {
            if let chapter = entry.snapshot?.currentChapter,
               let fraction = WidgetDate.progressFraction(start: chapter.start, end: chapter.end) {
                // A ring reads at this size where a percentage label would not.
                Gauge(value: min(max(fraction, 0), 1)) {
                    Image(systemName: "book")
                }
                .gaugeStyle(.accessoryCircularCapacity)
            } else {
                AccessoryWidgetBackground()
                Image(systemName: "book")
            }
        }
    }
}

struct CurrentChapterRectangularView: View {
    let entry: SnapshotEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let chapter = entry.snapshot?.currentChapter {
                Text("CHAPTER").font(.system(size: 11, weight: .bold))
                Text(chapter.title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                if let passed = chapter.passedCount, let total = chapter.totalCount, total > 0 {
                    Text("\(passed) of \(total) milestones").font(.system(size: 12)).lineLimit(1)
                } else if let fraction = WidgetDate.progressFraction(start: chapter.start, end: chapter.end) {
                    Text("\(Int((min(max(fraction, 0), 1)) * 100))% through").font(.system(size: 12))
                }
            } else {
                Text("No current chapter").font(.system(size: 13)).lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// MARK: - Today

struct TodayRectangularView: View {
    let entry: SnapshotEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(WidgetDate.weekday().uppercased()).font(.system(size: 11, weight: .bold))
            Text(WidgetDate.todayLong()).font(.system(size: 14, weight: .semibold)).lineLimit(1)
            if let age = WidgetDate.age(entry.snapshot?.birthday) {
                Text("Age \(age)").font(.system(size: 12))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct TodayInlineView: View {
    let entry: SnapshotEntry

    var body: some View {
        if let age = WidgetDate.age(entry.snapshot?.birthday) {
            Text("\(WidgetDate.todayLong()) · age \(age)")
        } else {
            Text(WidgetDate.todayLong())
        }
    }
}

// MARK: - Family routers
//
// Each widget's content closure goes through one of these so a single `kind`
// serves both the Home Screen and the Lock Screen. The system-family branch keeps
// the existing opaque-background views untouched.

struct NextMilestoneEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            NextMilestoneCircularView(entry: entry).accessoryBackground()
        case .accessoryRectangular:
            NextMilestoneRectangularView(entry: entry).accessoryBackground()
        case .accessoryInline:
            NextMilestoneInlineView(entry: entry)
        default:
            NextMilestoneView(entry: entry).widgetBackground(Palette.bg)
        }
    }
}

struct CurrentChapterEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        switch family {
        case .accessoryCircular:
            CurrentChapterCircularView(entry: entry).accessoryBackground()
        case .accessoryRectangular:
            CurrentChapterRectangularView(entry: entry).accessoryBackground()
        default:
            CurrentChapterView(entry: entry).widgetBackground(Palette.bg)
        }
    }
}

struct TodayEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        switch family {
        case .accessoryRectangular:
            TodayRectangularView(entry: entry).accessoryBackground()
        case .accessoryInline:
            TodayInlineView(entry: entry)
        default:
            TodayView(entry: entry).widgetBackground(Palette.bg)
        }
    }
}
