import SwiftUI

// Brand palette + helpers for the widget views, mirroring the web app's dark theme
// tokens in src/index.css and the Android WidgetTheme.kt. Extension target only.

extension Color {
    // Parses "#RRGGBB" (or "RRGGBB"), falling back on anything invalid.
    init(hex: String?, fallback: Color) {
        guard var s = hex?.trimmingCharacters(in: .whitespaces), !s.isEmpty else {
            self = fallback
            return
        }
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt64(s, radix: 16) else {
            self = fallback
            return
        }
        self = Color(
            red: Double((v >> 16) & 0xFF) / 255.0,
            green: Double((v >> 8) & 0xFF) / 255.0,
            blue: Double(v & 0xFF) / 255.0
        )
    }
}

enum Palette {
    static let bg = Color(hex: "0F1117", fallback: .black)
    static let text = Color(hex: "E8E0D0", fallback: .white)
    static let amber = Color(hex: "C8A96E", fallback: .orange)
    static let muted = Color(hex: "8A8270", fallback: .gray)
    static let track = Color(hex: "2A2C38", fallback: .gray)
}

extension View {
    // iOS 17 requires widget content to declare its background via containerBackground;
    // earlier versions fall back to a plain background fill.
    @ViewBuilder
    func widgetBackground(_ color: Color) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(color, for: .widget)
        } else {
            background(color)
        }
    }
}
