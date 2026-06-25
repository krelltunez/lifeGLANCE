package com.lifeglance.app.widget

import androidx.compose.ui.graphics.Color

/**
 * Shared palette for the home-screen widgets, mirroring the web app's dark theme
 * tokens in src/index.css. (NextMilestoneWidget predates this and keeps its own
 * copy; new widgets use these.)
 */
object WidgetTheme {
    val BG = Color(0xFF0F1117)
    val TEXT = Color(0xFFE8E0D0)
    val AMBER = Color(0xFFC8A96E)
    val MUTED = Color(0xFF8A8270)
    val TRACK = Color(0xFF2A2C38)

    // Parses a "#RRGGBB" hex into a Color, falling back to amber on anything invalid.
    fun parseColor(hex: String?, fallback: Color = AMBER): Color = try {
        if (hex.isNullOrEmpty()) fallback else Color(android.graphics.Color.parseColor(hex))
    } catch (e: Exception) {
        fallback
    }
}
