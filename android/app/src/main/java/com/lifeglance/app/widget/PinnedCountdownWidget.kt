package com.lifeglance.app.widget

import android.content.ComponentName
import android.content.Context
import androidx.compose.runtime.Composable
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

private val PINNED_MILESTONE_KEY = ActionParameters.Key<String>(MainActivity.EXTRA_WIDGET_MILESTONE_ID)

/**
 * "Pinned countdown" widget: a live countdown to the milestone the user pinned in the
 * app (stored as a single id; resolved into the snapshot as `pinned`).
 */
class PinnedCountdownWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(
        setOf(
            DpSize(160.dp, 80.dp),
            DpSize(220.dp, 120.dp),
        )
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val pinned = WidgetData.readSnapshot(context)?.pinned
        provideContent {
            Content(context, pinned)
        }
    }

    @Composable
    private fun Content(context: Context, pinned: WidgetData.Milestone?) {
        val accent = WidgetTheme.parseColor(pinned?.color)
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(ColorProvider(WidgetTheme.BG))
                .cornerRadius(16.dp)
                .padding(16.dp)
                .clickable(openAction(context, pinned?.id)),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (pinned == null) {
                Text(
                    text = "Pin a milestone in the app to track it here",
                    maxLines = 3,
                    style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                )
                return@Column
            }

            Text(
                text = "PINNED",
                style = TextStyle(color = ColorProvider(accent), fontFamily = FontFamily.Monospace, fontSize = 10.sp, fontWeight = FontWeight.Bold),
            )
            Spacer(GlanceModifier.height(4.dp))
            Text(
                text = WidgetData.relativeLabel(pinned.date),
                style = TextStyle(color = ColorProvider(WidgetTheme.TEXT), fontFamily = FontFamily.Monospace, fontSize = 22.sp, fontWeight = FontWeight.Bold),
            )
            Spacer(GlanceModifier.height(2.dp))
            Text(
                text = pinned.title,
                maxLines = 2,
                style = TextStyle(color = ColorProvider(WidgetTheme.TEXT), fontFamily = FontFamily.Monospace, fontSize = 14.sp),
            )
            Text(
                text = WidgetData.formatDateForPrecision(pinned.date, pinned.datePrecision),
                style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 11.sp),
            )
        }
    }

    private fun openAction(context: Context, milestoneId: String?) =
        actionStartActivity(
            ComponentName(context, MainActivity::class.java),
            if (milestoneId != null) actionParametersOf(PINNED_MILESTONE_KEY to milestoneId)
            else actionParametersOf(),
        )
}

class PinnedCountdownReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = PinnedCountdownWidget()
}
