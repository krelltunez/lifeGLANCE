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
        if date == now { return "today" }
        let past = date < now
        let from = past ? date : now
        let to = past ? now : date
        let comps = utcCalendar.dateComponents([.year, .month], from: from, to: to)
        let totalDays = utcCalendar.dateComponents([.day], from: from, to: to).day ?? 0
        let years = comps.year ?? 0
        let months = comps.month ?? 0
        let body: String
        if years > 0 && months > 0 { body = "\(years) yr\(plural(years)), \(months) mo" }
        else if years > 0          { body = "\(years) yr\(plural(years))" }
        else if totalDays > 30     { body = "\(totalDays / 30) mo" }
        else if totalDays > 0      { body = "\(totalDays) day\(plural(totalDays))" }
        else { return "today" }
        return past ? "\(body) ago" : "in \(body)"
    }

    /// Coarse elapsed duration from a past date to today, e.g. "2 yrs, 3 mo".
    /// "just started" for a today/future start.
    static func durationWords(_ iso: String) -> String {
        guard let from = dateOnly(iso) else { return "" }
        let now = today()
        if from >= now { return "just started" }
        let comps = utcCalendar.dateComponents([.year, .month], from: from, to: now)
        let totalDays = utcCalendar.dateComponents([.day], from: from, to: now).day ?? 0
        let years = comps.year ?? 0
        let months = comps.month ?? 0
        if years > 0 && months > 0 { return "\(years) yr\(plural(years)), \(months) mo" }
        if years > 0               { return "\(years) yr\(plural(years))" }
        if totalDays > 30          { return "\(totalDays / 30) mo" }
        return "\(totalDays) day\(plural(totalDays))"
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
        switch precision {
        case "year":  formatter.dateFormat = "yyyy"
        case "month": formatter.dateFormat = "MMMM yyyy"
        default:      formatter.dateFormat = "MMMM d, yyyy"
        }
        return formatter.string(from: date)
    }

    static func weekday() -> String { formatToday("EEEE") }
    static func todayLong() -> String { formatToday("MMMM d, yyyy") }

    // Exposed for the timeline-strip widget, which positions milestones by date.
    static func calendarDate(_ iso: String) -> Date? { dateOnly(iso) }
    static func todayDate() -> Date { today() }

    private static func formatToday(_ pattern: String) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = utc
        formatter.locale = Locale.current
        formatter.dateFormat = pattern
        return formatter.string(from: today())
    }

    /// Next local midnight, used as the widget timeline's reload boundary so that
    /// date-relative labels roll over even without an app-driven refresh.
    static func nextLocalMidnight() -> Date {
        let cal = Calendar.current
        let startOfToday = cal.startOfDay(for: Date())
        return cal.date(byAdding: .day, value: 1, to: startOfToday) ?? Date().addingTimeInterval(3600)
    }

    private static func plural(_ n: Int) -> String { n != 1 ? "s" : "" }
}
