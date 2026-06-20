package com.lifeglance.app.widget

import android.content.Context
import org.json.JSONObject
import java.time.LocalDate
import java.time.Period
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Shared storage contract and parsing for the home-screen widgets.
 *
 * The web app (via WidgetBridgePlugin) writes a JSON snapshot into SharedPreferences.
 * The widget process reads it here. Snapshots store raw ISO dates; relative labels
 * like "in 12 days" are computed at render time so they stay correct between pushes.
 */
object WidgetData {
    const val PREFS = "lifeglance_widget"
    const val KEY_SNAPSHOT = "snapshot"
    const val KEY_PENDING_TARGET = "pending_target"

    fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    data class Milestone(
        val id: String,
        val title: String,
        val date: String,          // ISO 8601
        val datePrecision: String, // year | month | day
        val color: String?,
    )

    data class Snapshot(
        val next: Milestone?,
        val prev: Milestone?,
        val currentChapterTitle: String?,
        val pastCount: Int,
        val futureCount: Int,
    )

    fun readSnapshot(context: Context): Snapshot? {
        val raw = prefs(context).getString(KEY_SNAPSHOT, null) ?: return null
        return try {
            val obj = JSONObject(raw)
            val counts = obj.optJSONObject("counts")
            Snapshot(
                next = parseMilestone(obj.optJSONObject("next")),
                prev = parseMilestone(obj.optJSONObject("prev")),
                currentChapterTitle = obj.optJSONObject("currentChapter")?.optString("title"),
                pastCount = counts?.optInt("past", 0) ?: 0,
                futureCount = counts?.optInt("future", 0) ?: 0,
            )
        } catch (e: Exception) {
            null
        }
    }

    private fun parseMilestone(obj: JSONObject?): Milestone? {
        if (obj == null) return null
        val id = obj.optString("id", "")
        val date = obj.optString("date", "")
        if (id.isEmpty() || date.isEmpty()) return null
        return Milestone(
            id = id,
            title = obj.optString("title", ""),
            date = date,
            datePrecision = obj.optString("datePrecision", "day"),
            color = obj.optString("color").takeIf { it.isNotEmpty() },
        )
    }

    // The calendar date the milestone falls on, read from the UTC components of the
    // ISO string — matching the web app's toLocalNoon convention.
    private fun localDateOf(iso: String): LocalDate? = try {
        java.time.Instant.parse(iso).atZone(ZoneOffset.UTC).toLocalDate()
    } catch (e: Exception) {
        null
    }

    /** Mirrors the web app's relativeLabel(): "in 3 days", "2 yrs, 1 mo ago", "today". */
    fun relativeLabel(iso: String, today: LocalDate = LocalDate.now()): String {
        val date = localDateOf(iso) ?: return ""
        if (date.isEqual(today)) return "today"
        val past = date.isBefore(today)
        val from = if (past) date else today
        val to = if (past) today else date
        val period = Period.between(from, to)
        val totalDays = ChronoUnit.DAYS.between(from, to)
        val years = period.years
        val months = period.months
        val suffix = if (past) " ago" else ""
        val prefix = if (past) "" else "in "
        val body = when {
            years > 0 && months > 0 -> "$years yr${plural(years)}, $months mo"
            years > 0               -> "$years yr${plural(years)}"
            totalDays > 30          -> "${totalDays / 30} mo"
            totalDays > 0           -> "$totalDays day${plural(totalDays)}"
            else                    -> return "today"
        }
        return "$prefix$body$suffix"
    }

    /** Mirrors formatDateDisplay(): precision-aware date formatting. */
    fun formatDate(iso: String): String {
        val date = localDateOf(iso) ?: return ""
        return date.format(DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.getDefault()))
    }

    fun formatDateForPrecision(iso: String, precision: String): String {
        val date = localDateOf(iso) ?: return ""
        val pattern = when (precision) {
            "year"  -> "yyyy"
            "month" -> "MMMM yyyy"
            else    -> "MMMM d, yyyy"
        }
        return date.format(DateTimeFormatter.ofPattern(pattern, Locale.getDefault()))
    }

    private fun plural(n: Long) = if (n != 1L) "s" else ""
    private fun plural(n: Int) = if (n != 1) "s" else ""
}
