import Foundation

// Shared model + storage + date logic for the home-screen widgets, mirroring the
// Android WidgetData.kt. Added to BOTH the App target (the WidgetBridge plugin writes
// here) and the widget extension (which reads here). Foundation-only — no SwiftUI — so
// the app target doesn't pull in UI frameworks it doesn't need.
//
// The web app pushes a render-ready JSON snapshot into the App Group container; the
// widget process reads it. Snapshots store raw ISO dates, so relative labels like
// "in 12 days" are computed at render time and stay correct between pushes.

// MARK: - Shared storage (App Group)

enum WidgetStore {
    // Must match the App Group added to both targets and the entitlements files.
    static let appGroupId = "group.com.lifeglance"
    static let keySnapshot = "snapshot"
    static let keyPendingTarget = "pending_target"
    static let keyPendingAction = "pending_action"
    static let keyPendingShare = "pending_share"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroupId) }

    static func saveSnapshot(_ json: String) {
        defaults?.set(json, forKey: keySnapshot)
    }

    static func loadSnapshot() -> WidgetSnapshot? {
        guard let json = defaults?.string(forKey: keySnapshot),
              let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    static func setPendingTarget(_ id: String) {
        defaults?.set(id, forKey: keyPendingTarget)
    }

    // Returns and clears a pending deep-link target left by a widget tap.
    static func consumePendingTarget() -> String? {
        guard let target = defaults?.string(forKey: keyPendingTarget) else { return nil }
        defaults?.removeObject(forKey: keyPendingTarget)
        return target
    }

    // Returns and clears a pending widget action (e.g. "new" from quick-add).
    static func consumePendingAction() -> String? {
        guard let action = defaults?.string(forKey: keyPendingAction) else { return nil }
        defaults?.removeObject(forKey: keyPendingAction)
        return action
    }

    // Shares are a queue of JSON strings { text, subject }, written by the Share
    // Extension (ShareViewController.enqueue, which writes to the App Group inline
    // rather than depending on this file). There is deliberately no writer here —
    // this side only reads. A queue rather than one slot because iOS cannot bring
    // the app forward on share, so entries accumulate between app launches and a
    // last-write-wins slot would silently drop all but the most recent.
    //
    // Pops the oldest pending share, leaving any others queued for the next call.
    // Returns a single JSON string so the JS contract is unchanged: one share per
    // consumeLaunchTarget(), matching the one Add-milestone sheet the app can show.
    // Tolerates a legacy single-string value written before the queue existed.
    static func consumePendingShare() -> String? {
        if var queue = defaults?.array(forKey: keyPendingShare) as? [String] {
            guard !queue.isEmpty else {
                defaults?.removeObject(forKey: keyPendingShare)
                return nil
            }
            let next = queue.removeFirst()
            if queue.isEmpty {
                defaults?.removeObject(forKey: keyPendingShare)
            } else {
                defaults?.set(queue, forKey: keyPendingShare)
            }
            return next
        }
        guard let legacy = defaults?.string(forKey: keyPendingShare) else { return nil }
        defaults?.removeObject(forKey: keyPendingShare)
        return legacy
    }
}

// MARK: - Snapshot model (decodes the JSON the web app pushes)

struct WidgetSnapshot: Codable {
    let version: Int?
    let birthday: String?
    let next: WidgetMilestone?
    let prev: WidgetMilestone?
    let currentChapter: WidgetChapter?
    let onThisDay: [WidgetMilestone]?
    let pins: [String: WidgetMilestone]?
    let strip: [WidgetMilestone]?
    let counts: Counts?

    struct Counts: Codable {
        let past: Int?
        let future: Int?
        let total: Int?
        let thisYear: Int?
    }
}

struct WidgetMilestone: Codable {
    let id: String
    let title: String
    let date: String
    let datePrecision: String?
    let category: String?
    let color: String?
}

struct WidgetChapter: Codable {
    let id: String
    let title: String
    let start: String
    let end: String?        // nil for an ongoing chapter
    let color: String?
    let passedCount: Int?
    let totalCount: Int?
}

// MARK: - Date helpers (mirror WidgetData.kt)

enum WidgetDate {
    private static let utc = TimeZone(identifier: "UTC")!

    private static var utcCalendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = utc
        return c
    }

    // The calendar date a value falls on, as a UTC-anchored Date so two such values
    // compare purely by calendar date. The leading "yyyy-MM-dd" is the UTC date for a
    // full ISO instant ("2026-07-01T00:00:00.000Z" — matching the web's toLocalNoon
    // convention) and is also the whole value for a date-only field like birthday.
    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "UTC")
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static func dateOnly(_ iso: String) -> Date? {
        guard iso.count >= 10 else { return nil }
        return dayFormatter.date(from: String(iso.prefix(10)))
    }

    // Today's local calendar date, expressed in the same UTC-anchored calendar.
    private static func today() -> Date {
        var local = Calendar(identifier: .gregorian)
        local.timeZone = TimeZone.current
        let comps = local.dateComponents([.year, .month, .day], from: Date())
        return utcCalendar.date(from: comps) ?? Date()
    }

    /// Mirrors relativeLabel(): "in 3 days", "2 yrs, 1 mo ago", "today".
    static func relativeLabel(_ iso: String) -> String {
        guard let date = dateOnly(iso) else { return "" }
        let now = today()
        if date == now { return String(localized: "today") }
        let past = date < now
        let from = past ? date : now
        let to = past ? now : date
        let comps = utcCalendar.dateComponents([.year, .month], from: from, to: to)
        let totalDays = utcCalendar.dateComponents([.day], from: from, to: to).day ?? 0
        let years = comps.year ?? 0
        let months = comps.month ?? 0
        if years == 0 && totalDays <= 0 { return String(localized: "today") }
        let body = durationBody(years: years, months: months, totalDays: totalDays)
        return past ? String(localized: "\(body) ago") : String(localized: "in \(body)")
    }

    /// "2 yrs, 1 mo" / "4 mo" / "9 days", assembled from localized pieces so each
    /// language supplies its own unit words and joining (Chinese joins without a
    /// comma). Callers wrap it in "in …" / "… ago" / "… in" framing, each its own
    /// localized pattern.
    private static func durationBody(years: Int, months: Int, totalDays: Int) -> String {
        let yearsPart = years == 1 ? String(localized: "1 yr") : String(localized: "\(years) yrs")
        if years > 0 && months > 0 {
            let monthsPart = String(localized: "\(months) mo")
            return String(localized: "\(yearsPart), \(monthsPart)")
        }
        if years > 0 { return yearsPart }
        if totalDays > 30 { return String(localized: "\(totalDays / 30) mo") }
        return totalDays == 1 ? String(localized: "1 day") : String(localized: "\(totalDays) days")
    }

    /// Coarse elapsed duration from a past date to today, e.g. "2 yrs, 3 mo".
    /// "just started" for a today/future start.
    static func durationWords(_ iso: String) -> String {
        guard let from = dateOnly(iso) else { return "" }
        let now = today()
        if from >= now { return String(localized: "just started") }
        let comps = utcCalendar.dateComponents([.year, .month], from: from, to: now)
        let totalDays = utcCalendar.dateComponents([.day], from: from, to: now).day ?? 0
        return durationBody(years: comps.year ?? 0, months: comps.month ?? 0, totalDays: totalDays)
    }

    /// Whole years between a birthday and today, or nil if unset / not yet reached.
    static func age(_ iso: String?) -> Int? {
        guard let iso = iso, let born = dateOnly(iso) else { return nil }
        let now = today()
        if now < born { return nil }
        return utcCalendar.dateComponents([.year], from: born, to: now).year
    }

    /// Whole years between a milestone's calendar year and today (for "on this day").
    static func yearsAgo(_ iso: String) -> Int {
        guard let date = dateOnly(iso) else { return 0 }
        let then = utcCalendar.component(.year, from: date)
        let nowYear = utcCalendar.component(.year, from: today())
        return max(nowYear - then, 0)
    }

    /// True when a milestone shares today's month (and day, for day-precision). Applied
    /// at render time so the midnight timeline refresh shows the new day's matches.
    static func isOnThisDay(_ iso: String, precision: String) -> Bool {
        guard let date = dateOnly(iso) else { return false }
        let t = today()
        if utcCalendar.component(.month, from: date) != utcCalendar.component(.month, from: t) { return false }
        return precision == "month" || utcCalendar.component(.day, from: date) == utcCalendar.component(.day, from: t)
    }

    /// Time-elapsed progress through a bounded chapter as 0...1, or nil if ongoing.
    static func progressFraction(start: String, end: String?) -> Double? {
        guard let end = end, let s = dateOnly(start), let e = dateOnly(end) else { return nil }
        let total = Double(utcCalendar.dateComponents([.day], from: s, to: e).day ?? 0)
        if total <= 0 { return nil }
        let elapsed = Double(utcCalendar.dateComponents([.day], from: s, to: today()).day ?? 0)
        return min(max(elapsed / total, 0), 1)
    }

    static func formatDate(_ iso: String, precision: String) -> String {
        guard let date = dateOnly(iso) else { return "" }
        let formatter = DateFormatter()
        formatter.timeZone = utc
        formatter.locale = Locale.current
        // A fixed "MMMM d, yyyy" renders English field order in every language;
        // the localized template yields the locale's own pattern ("d. MMMM yyyy"
        // for de, "y年M月d日" for zh).
        switch precision {
        case "year":  formatter.setLocalizedDateFormatFromTemplate("y")
        case "month": formatter.setLocalizedDateFormatFromTemplate("yMMMM")
        default:      formatter.setLocalizedDateFormatFromTemplate("yMMMMd")
        }
        return formatter.string(from: date)
    }

    static func weekday() -> String { formatToday("EEEE") }
    static func todayLong() -> String { formatToday("yMMMMd") }

    // Exposed for the timeline-strip widget, which positions milestones by date.
    static func calendarDate(_ iso: String) -> Date? { dateOnly(iso) }
    static func todayDate() -> Date { today() }

    private static func formatToday(_ template: String) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = utc
        formatter.locale = Locale.current
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: today())
    }

    /// Next local midnight, used as the widget timeline's reload boundary so that
    /// date-relative labels roll over even without an app-driven refresh.
    static func nextLocalMidnight() -> Date {
        let cal = Calendar.current
        let startOfToday = cal.startOfDay(for: Date())
        return cal.date(byAdding: .day, value: 1, to: startOfToday) ?? Date().addingTimeInterval(3600)
    }

}
