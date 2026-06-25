import WidgetKit

// A single timeline provider shared by all three widgets: each reads the same snapshot
// from the App Group. The timeline holds one entry and reloads at the next local
// midnight so date-relative labels roll over; the WidgetBridge plugin also calls
// WidgetCenter.reloadAllTimelines() whenever the underlying data changes.

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snapshot: WidgetStore.loadSnapshot())
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: Date(), snapshot: WidgetStore.loadSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let entry = SnapshotEntry(date: Date(), snapshot: WidgetStore.loadSnapshot())
        let timeline = Timeline(entries: [entry], policy: .after(WidgetDate.nextLocalMidnight()))
        completion(timeline)
    }
}
