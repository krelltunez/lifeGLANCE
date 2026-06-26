package com.lifeglance.app.widget

import android.content.ComponentName
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.lifeglance.app.MainActivity

/**
 * "On This Day" widget: past milestones sharing today's calendar date. Shows one
 * entry at the smallest size and several as the widget grows.
 */
class OnThisDayWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(
        setOf(
            DpSize(180.dp, 80.dp),
            DpSize(250.dp, 200.dp),
        )
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val snapshot = WidgetData.readSnapshot(context)
        // Filter the candidate pool to today's date here (render time), so the midnight
        // refresh shows the correct day even if the app hasn't pushed a new snapshot.
        val items = (snapshot?.onThisDay ?: emptyList())
            .filter { WidgetData.isOnThisDay(it.date, it.datePrecision) }
        provideContent {
            Content(context, items)
        }
    }

    @Composable
    private fun Content(context: Context, items: List<WidgetData.Milestone>) {
        // Roughly one row per ~34dp after the header; cap so nothing overflows.
        val maxRows = ((LocalSize.current.height.value - 40) / 34).toInt().coerceIn(1, 4)
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(ColorProvider(WidgetTheme.BG))
                .cornerRadius(16.dp)
                .padding(16.dp)
                .clickable(actionStartActivity(ComponentName(context, MainActivity::class.java), actionParametersOf())),
        ) {
            Text(
                text = "ON THIS DAY",
                style = TextStyle(color = ColorProvider(WidgetTheme.AMBER), fontFamily = FontFamily.Monospace, fontSize = 10.sp, fontWeight = FontWeight.Bold),
            )
            Spacer(GlanceModifier.height(6.dp))

            if (items.isEmpty()) {
                Text(
                    text = "Nothing from today in past years",
                    maxLines = 2,
                    style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                )
                return@Column
            }

            for (m in items.take(maxRows)) {
                Text(
                    text = m.title,
                    maxLines = 1,
                    style = TextStyle(color = ColorProvider(WidgetTheme.TEXT), fontFamily = FontFamily.Monospace, fontSize = 14.sp, fontWeight = FontWeight.Bold),
                )
                val years = WidgetData.yearsAgo(m.date)
                val agoLabel = if (years > 0) "$years year${if (years != 1) "s" else ""} ago" else "today"
                Text(
                    text = "$agoLabel · ${WidgetData.formatDateForPrecision(m.date, m.datePrecision)}",
                    maxLines = 1,
                    style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 11.sp),
                )
                Spacer(GlanceModifier.height(6.dp))
            }

            val remaining = items.size - maxRows
            if (remaining > 0) {
                Text(
                    text = "+$remaining more",
                    style = TextStyle(color = ColorProvider(WidgetTheme.AMBER), fontFamily = FontFamily.Monospace, fontSize = 10.sp),
                )
            }
        }
    }
}

class OnThisDayReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = OnThisDayWidget()
}
