import SwiftUI
import WidgetKit

// Deep-link URLs a widget tap opens the app with. AppDelegate parses these into a
// pending target the web layer consumes on resume (mirrors the Android handoff).
private func milestoneURL(_ id: String?) -> URL? {
    if let id = id, let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
        return URL(string: "lifeglance://milestone?id=\(encoded)")
    }
    return URL(string: "lifeglance://open")
}

private func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    .system(size: size, weight: weight, design: .monospaced)
}

// A faint "label · value" context line used by the Today widget's larger size.
private struct ContextLine: View {
    let label: String
    let value: String
    var body: some View {
        Text("\(label) · \(value)")
            .font(mono(11))
            .foregroundColor(Palette.muted)
            .lineLimit(1)
    }
}

// MARK: - Next milestone

struct NextMilestoneView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        let next = entry.snapshot?.next
        VStack(alignment: .leading, spacing: 2) {
            if let next = next {
                Text("NEXT").font(mono(10, .bold)).foregroundColor(Palette.amber)
                Text(WidgetDate.relativeLabel(next.date))
                    .font(mono(20, .bold)).foregroundColor(Palette.text)
                Text(next.title).font(mono(13)).foregroundColor(Palette.text).lineLimit(2)
                Text(WidgetDate.formatDate(next.date, precision: next.datePrecision ?? "day"))
                    .font(mono(11)).foregroundColor(Palette.muted)
                // Large is the only family with extra vertical room (medium is the
                // same height as small, just wider), so the secondary line lives there.
                if family == .systemLarge, let prev = entry.snapshot?.prev {
                    Spacer().frame(height: 6)
                    Text("last · \(prev.title) (\(WidgetDate.relativeLabel(prev.date)))")
                        .font(mono(11)).foregroundColor(Palette.muted).lineLimit(1)
                }
            } else {
                Text("No upcoming milestones").font(mono(13)).foregroundColor(Palette.muted)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
        .widgetURL(milestoneURL(next?.id))
    }
}

// MARK: - Today

struct TodayView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("TODAY").font(mono(10, .bold)).foregroundColor(Palette.amber)
            Text(WidgetDate.weekday()).font(mono(20, .bold)).foregroundColor(Palette.text)
            Text(WidgetDate.todayLong()).font(mono(12)).foregroundColor(Palette.muted)
            if let age = WidgetDate.age(entry.snapshot?.birthday) {
                Text("\(age) year\(age == 1 ? "" : "s") old")
                    .font(mono(12)).foregroundColor(Palette.muted)
            }
            // Only large has the vertical room for the context block (medium is the
            // same height as small, just wider).
            if family == .systemLarge {
                Spacer().frame(height: 8)
                if let next = entry.snapshot?.next {
                    ContextLine(label: "next", value: "\(next.title) · \(WidgetDate.relativeLabel(next.date))")
                }
                if let prev = entry.snapshot?.prev {
                    ContextLine(label: "last", value: "\(prev.title) · \(WidgetDate.relativeLabel(prev.date))")
                }
                if let chapter = entry.snapshot?.currentChapter {
                    ContextLine(label: "chapter", value: chapter.title)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
        .widgetURL(URL(string: "lifeglance://open"))
    }
}

// MARK: - Current chapter

struct CurrentChapterView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        // Medium is the same height as small (just wider), so the milestone count and
        // progress bar only fit on large.
        let roomy = family == .systemLarge
        VStack(alignment: .leading, spacing: 2) {
            if let chapter = entry.snapshot?.currentChapter {
                let accent = Color(hex: chapter.color, fallback: Palette.amber)
                Text("CHAPTER").font(mono(10, .bold)).foregroundColor(accent)
                Text(chapter.title).font(mono(17, .bold)).foregroundColor(Palette.text)
                    .lineLimit(roomy ? 2 : 1)
                Text("\(WidgetDate.durationWords(chapter.start)) in")
                    .font(mono(12)).foregroundColor(Palette.muted)
                if roomy, (chapter.totalCount ?? 0) > 0 {
                    Text("\(chapter.passedCount ?? 0)/\(chapter.totalCount ?? 0) milestones")
                        .font(mono(11)).foregroundColor(Palette.muted)
                }
                // Bounded chapters get a time-elapsed bar; ongoing chapters show elapsed
                // time only, since there's no end to measure against.
                if roomy, let fraction = WidgetDate.progressFraction(start: chapter.start, end: chapter.end) {
                    Spacer().frame(height: 8)
                    ProgressView(value: fraction)
                        .progressViewStyle(.linear)
                        .tint(accent)
                }
            } else {
                Text("No active chapter").font(mono(13)).foregroundColor(Palette.muted)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(16)
        .widgetURL(URL(string: "lifeglance://open"))
    }
}
