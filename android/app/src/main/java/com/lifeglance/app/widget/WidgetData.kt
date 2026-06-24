package com.lifeglance.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
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

    // optString yields "" for a missing key and (on Android's org.json) the literal
    // "null" for a JSON null; treat both as absent.
    private fun JSONObject.stringOrNull(key: String): String? =
        optString(key).takeIf { it.isNotEmpty() && it != "null" }

    data class Milestone(
        val id: String,
        val title: String,
        val date: String,          // ISO 8601
        val datePrecision: String, // year | month | day
        val color: String?,
    )

    data class Chapter(
        val id: String,
        val title: String,
        val start: String,         // ISO 8601
        val end: String?,          // ISO 8601, or null for an ongoing chapter
        val color: String?,
        val passedCount: Int,
        val totalCount: Int,
    )

    data class Snapshot(
        val next: Milestone?,
        val prev: Milestone?,
        val currentChapter: Chapter?,
        val birthday: String?,
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
                currentChapter = parseChapter(obj.optJSONObject("currentChapter")),
                birthday = obj.stringOrNull("birthday"),
                pastCount = counts?.optInt("past", 0) ?: 0,
                futureCount = counts?.optInt("future", 0) ?: 0,
            )
        } catch (e: Exception) {
            null
        }
    }

    private fun parseChapter(obj: JSONObject?): Chapter? {
        if (obj == null) return null
        val id = obj.optString("id", "")
        val start = obj.optString("start", "")
        if (id.isEmpty() || start.isEmpty()) return null
        return Chapter(
            id = id,
            title = obj.optString("title", ""),
            start = start,
            end = obj.stringOrNull("end"),
            color = obj.stringOrNull("color"),
            passedCount = obj.optInt("passedCount", 0),
            totalCount = obj.optInt("totalCount", 0),
        )
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
            color = obj.stringOrNull("color"),
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

    /** Whole years between a birthday and today, or null if unset / not yet reached. */
    fun age(birthdayIso: String?, today: LocalDate = LocalDate.now()): Int? {
        val born = birthdayIso?.let { localDateOf(it) } ?: return null
        if (today.isBefore(born)) return null
        return Period.between(born, today).years
    }

    /**
     * Coarse elapsed duration from a past date to today, e.g. "2 yrs, 3 mo",
     * "4 mo", "9 days". Used for "how far into this chapter" — the caller adds
     * any framing word like "in". Returns "just started" for today/future starts.
     */
    fun durationWords(fromIso: String, to: LocalDate = LocalDate.now()): String {
        val from = localDateOf(fromIso) ?: return ""
        if (!from.isBefore(to)) return "just started"
        val p = Period.between(from, to)
        val totalDays = ChronoUnit.DAYS.between(from, to)
        return when {
            p.years > 0 && p.months > 0 -> "${p.years} yr${plural(p.years)}, ${p.months} mo"
            p.years > 0                 -> "${p.years} yr${plural(p.years)}"
            totalDays > 30              -> "${totalDays / 30} mo"
            else                        -> "$totalDays day${plural(totalDays)}"
        }
    }

    /** Time-elapsed progress through a bounded chapter as 0..1, or null if ongoing. */
    fun progressFraction(startIso: String, endIso: String?, today: LocalDate = LocalDate.now()): Float? {
        if (endIso == null) return null
        val start = localDateOf(startIso) ?: return null
        val end = localDateOf(endIso) ?: return null
        val total = ChronoUnit.DAYS.between(start, end).toDouble()
        if (total <= 0) return null
        val elapsed = ChronoUnit.DAYS.between(start, today).toDouble()
        return (elapsed / total).coerceIn(0.0, 1.0).toFloat()
    }

    fun weekday(today: LocalDate = LocalDate.now()): String =
        today.format(DateTimeFormatter.ofPattern("EEEE", Locale.getDefault()))

    fun todayLong(today: LocalDate = LocalDate.now()): String =
        today.format(DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.getDefault()))

    /**
     * Refreshes every placed lifeGLANCE widget by broadcasting an update, which makes
     * each Glance receiver recompose and re-read the snapshot. Called from the bridge
     * plugin (on data change) and the midnight worker. @JvmStatic so Java can call it.
     */
    @JvmStatic
    fun refreshAll(context: Context) {
        val receivers = listOf(
            NextMilestoneReceiver::class.java,
            TodayWidgetReceiver::class.java,
            CurrentChapterReceiver::class.java,
        )
        val mgr = AppWidgetManager.getInstance(context)
        for (cls in receivers) {
            val ids = mgr.getAppWidgetIds(ComponentName(context, cls))
            if (ids.isEmpty()) continue
            val intent = Intent(context, cls).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            context.sendBroadcast(intent)
        }
    }

    private fun plural(n: Long) = if (n != 1L) "s" else ""
    private fun plural(n: Int) = if (n != 1) "s" else ""
}
