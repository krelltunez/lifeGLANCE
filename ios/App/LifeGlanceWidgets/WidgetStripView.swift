import SwiftUI
import WidgetKit

// A mini "you are here" slice of the timeline around today. Milestones are positioned
// by date along a horizontal axis with a bright today marker. Drawn with positioned
// SwiftUI shapes (no Canvas) so it's widget-safe. Recomputed every render, so the today
// marker and dot positions stay correct between snapshot pushes.

private struct StripDot: Identifiable {
    let id: String
    let x: CGFloat       // 0...1 within the framed window
    let color: Color
}

private struct StripTick: Identifiable {
    let id: Int          // the year
    let x: CGFloat
    let label: String
}

// Auto-fit model: frames the nearest `framePerSide` milestones on each side of today,
// pads the window, and produces normalized x positions (independent of widget size).
private struct StripModel {
    let dots: [StripDot]
    let ticks: [StripTick]
    let todayX: CGFloat
    let nearestPast: WidgetMilestone?
    let nearestFuture: WidgetMilestone?
    let isEmpty: Bool

    init(milestones: [WidgetMilestone], framePerSide: Int) {
        let today = WidgetDate.todayDate()

        let dated = milestones.compactMap { m -> (WidgetMilestone, Date)? in
            guard let d = WidgetDate.calendarDate(m.date) else { return nil }
            return (m, d)
        }
        guard !dated.isEmpty else {
            dots = []; ticks = []; todayX = 0.5
            nearestPast = nil; nearestFuture = nil; isEmpty = true
            return
        }

        let past = dated.filter { $0.1 < today }.sorted { $0.1 > $1.1 }    // nearest first
        let future = dated.filter { $0.1 >= today }.sorted { $0.1 < $1.1 } // nearest first

        // Window = extremes of the nearest framePerSide on each side, plus today.
        var earliest = today, latest = today
        for (_, d) in past.prefix(framePerSide) where d < earliest { earliest = d }
        for (_, d) in future.prefix(framePerSide) where d > latest { latest = d }
        if earliest == latest {   // only today in frame — show a default ±6mo span
            earliest = today.addingTimeInterval(-182 * 86_400)
            latest = today.addingTimeInterval(182 * 86_400)
        }

        let span = latest.timeIntervalSince(earliest)
        let pad = span * 0.08
        let startRef = earliest.timeIntervalSinceReferenceDate - pad
        let endRef = latest.timeIntervalSinceReferenceDate + pad
        let total = max(endRef - startRef, 1)
        func frac(_ d: Date) -> CGFloat {
            CGFloat((d.timeIntervalSinceReferenceDate - startRef) / total)
        }

        dots = dated.compactMap { (m, d) in
            let f = frac(d)
            guard f >= -0.02, f <= 1.02 else { return nil }
            return StripDot(id: m.id, x: min(max(f, 0), 1),
                            color: Color(hex: m.color, fallback: Palette.muted))
        }
        todayX = min(max(frac(today), 0), 1)

        // Year ticks (Jan 1 of each year inside the window), unless the span is huge.
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let startYear = cal.component(.year, from: Date(timeIntervalSinceReferenceDate: startRef))
        let endYear = cal.component(.year, from: Date(timeIntervalSinceReferenceDate: endRef))
        var t: [StripTick] = []
        if endYear > startYear && endYear - startYear <= 30 {
            for y in (startYear + 1)...endYear {
                if let jan1 = cal.date(from: DateComponents(year: y, month: 1, day: 1)) {
                    let f = frac(jan1)
                    if f >= 0, f <= 1 { t.append(StripTick(id: y, x: f, label: String(y))) }
                }
            }
        }
        ticks = t

        nearestPast = past.first?.0
        nearestFuture = future.first?.0
        isEmpty = false
    }
}

struct TimelineStripView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    private var framePerSide: Int {
        switch family {
        case .systemExtraLarge: return 6
        case .systemLarge:      return 4
        default:                return 3   // medium
        }
    }

    var body: some View {
        let model = StripModel(milestones: entry.snapshot?.strip ?? [], framePerSide: framePerSide)
        VStack(alignment: .leading, spacing: 6) {
            Text("TIMELINE")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundColor(Palette.amber)
            chart(model)
            if family != .systemMedium {
                caption(model)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(14)
        .widgetURL(URL(string: "lifeglance://open"))
    }

    private func chart(_ m: StripModel) -> some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let pad: CGFloat = 4
            let innerW = max(w - 2 * pad, 1)
            let axisY = h * 0.5
            let px: (CGFloat) -> CGFloat = { pad + $0 * innerW }

            ZStack(alignment: .topLeading) {
                if m.isEmpty {
                    Text("Not enough milestones to chart yet")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(Palette.muted)
                        .lineLimit(2)
                } else {
                    Rectangle().fill(Palette.muted.opacity(0.35))
                        .frame(width: innerW, height: 1)
                        .position(x: w / 2, y: axisY)

                    ForEach(m.ticks) { t in
                        Rectangle().fill(Palette.muted.opacity(0.25))
                            .frame(width: 1, height: 5)
                            .position(x: px(t.x), y: axisY)
                        Text(t.label)
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundColor(Palette.muted)
                            .fixedSize()
                            .position(x: px(t.x), y: axisY + 12)
                    }

                    ForEach(m.dots) { d in
                        Circle().fill(d.color)
                            .frame(width: 7, height: 7)
                            .position(x: px(d.x), y: axisY)
                    }

                    Rectangle().fill(Palette.amber)
                        .frame(width: 2, height: max(h - 6, 8))
                        .position(x: px(m.todayX), y: h / 2)
                    Circle().fill(Palette.amber)
                        .frame(width: 6, height: 6)
                        .position(x: px(m.todayX), y: axisY)
                    // "TODAY" tag above the marker. A bg-colored pad keeps it legible
                    // where it sits over the line, and the x is clamped off the edges.
                    Text("TODAY")
                        .font(.system(size: 8, weight: .heavy, design: .monospaced))
                        .foregroundColor(Palette.amber)
                        .fixedSize()
                        .padding(.horizontal, 3)
                        .background(Palette.bg)
                        .position(x: min(max(px(m.todayX), 20), w - 20), y: 7)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func caption(_ m: StripModel) -> some View {
        HStack(alignment: .top, spacing: 8) {
            if let p = m.nearestPast {
                captionItem(p, align: .leading)
            }
            Spacer(minLength: 8)
            if let n = m.nearestFuture {
                captionItem(n, align: .trailing)
            }
        }
    }

    private func captionItem(_ m: WidgetMilestone, align: HorizontalAlignment) -> some View {
        VStack(alignment: align, spacing: 1) {
            Text(m.title)
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(Palette.text)
                .lineLimit(1)
            Text(WidgetDate.relativeLabel(m.date))
                .font(.system(size: 9, design: .monospaced))
                .foregroundColor(Palette.muted)
        }
    }
}
