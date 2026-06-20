package com.lifeglance.app.widget

import android.content.ComponentName
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
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

// Brand palette (mirrors the web app's dark theme tokens in src/index.css).
private val BG = Color(0xFF0F1117)
private val TEXT = Color(0xFFE8E0D0)
private val AMBER = Color(0xFFC8A96E)
private val MUTED = Color(0xFF8A8270)

// Glance delivers ActionParameters to the launched activity as Intent extras keyed
// by the parameter key's name, so MainActivity reads it as EXTRA_WIDGET_MILESTONE_ID.
private val MILESTONE_KEY = ActionParameters.Key<String>(MainActivity.EXTRA_WIDGET_MILESTONE_ID)

class NextMilestoneWidget : GlanceAppWidget() {
    // Two breakpoints: compact (countdown + title) and a taller layout that also
    // surfaces the most recently passed milestone.
    override val sizeMode = SizeMode.Responsive(
        setOf(
            DpSize(160.dp, 80.dp),
            DpSize(220.dp, 140.dp),
        )
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val snapshot = WidgetData.readSnapshot(context)
        provideContent {
            Content(context, snapshot)
        }
    }

    @Composable
    private fun Content(context: Context, snapshot: WidgetData.Snapshot?) {
        val next = snapshot?.next
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(ColorProvider(BG))
                .cornerRadius(16.dp)
                .padding(16.dp)
                .clickable(openAppAction(context, next?.id)),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (next == null) {
                Text(
                    text = "No upcoming milestones",
                    style = TextStyle(color = ColorProvider(MUTED), fontFamily = FontFamily.Monospace, fontSize = 13.sp),
                )
                return@Column
            }

            Text(
                text = "NEXT",
                style = TextStyle(color = ColorProvider(AMBER), fontFamily = FontFamily.Monospace, fontSize = 10.sp, fontWeight = FontWeight.Bold),
            )
            Spacer(GlanceModifier.height(4.dp))
            Text(
                text = WidgetData.relativeLabel(next.date),
                style = TextStyle(color = ColorProvider(TEXT), fontFamily = FontFamily.Monospace, fontSize = 22.sp, fontWeight = FontWeight.Bold),
            )
            Spacer(GlanceModifier.height(2.dp))
            Text(
                text = next.title,
                maxLines = 2,
                style = TextStyle(color = ColorProvider(TEXT), fontFamily = FontFamily.Monospace, fontSize = 14.sp),
            )
            Text(
                text = WidgetData.formatDateForPrecision(next.date, next.datePrecision),
                style = TextStyle(color = ColorProvider(MUTED), fontFamily = FontFamily.Monospace, fontSize = 11.sp),
            )

            // Taller layout: a faint "last passed" line beneath.
            val prev = snapshot.prev
            if (prev != null) {
                Spacer(GlanceModifier.height(8.dp))
                Text(
                    text = "last · ${prev.title} (${WidgetData.relativeLabel(prev.date)})",
                    maxLines = 1,
                    style = TextStyle(color = ColorProvider(MUTED), fontFamily = FontFamily.Monospace, fontSize = 11.sp),
                )
            }
        }
    }

    // Opens the app, carrying the tapped milestone id (when present) so the web
    // layer can focus it. The id rides along as an ActionParameter, which Glance
    // surfaces to MainActivity as an Intent extra.
    private fun openAppAction(context: Context, milestoneId: String?) =
        actionStartActivity(
            ComponentName(context, MainActivity::class.java),
            if (milestoneId != null) actionParametersOf(MILESTONE_KEY to milestoneId)
            else actionParametersOf(),
        )
}

class NextMilestoneReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = NextMilestoneWidget()
}
