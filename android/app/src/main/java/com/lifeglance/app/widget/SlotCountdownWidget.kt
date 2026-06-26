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

private val SLOT_MILESTONE_KEY = ActionParameters.Key<String>(MainActivity.EXTRA_WIDGET_MILESTONE_ID)

/**
 * A countdown to the milestone pinned to one color slot. Each slot ("amber", "rose",
 * "teal", "blue") has its own dedicated widget (the receivers below), so several pinned
 * countdowns can live on the home screen without per-widget configuration. The slot's
 * color is the binding — it's the accent and identifies which pin the widget tracks.
 */
class SlotCountdownWidget(private val slot: String, private val accentArgb: Long) : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(
        setOf(
            DpSize(160.dp, 80.dp),
            DpSize(220.dp, 120.dp),
        )
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val milestone = WidgetData.readSnapshot(context)?.pins?.get(slot)
        provideContent {
            Content(context, milestone)
        }
    }

    @Composable
    private fun Content(context: Context, milestone: WidgetData.Milestone?) {
        val accent = Color(accentArgb)
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(ColorProvider(WidgetTheme.BG))
                .cornerRadius(16.dp)
                .padding(16.dp)
                .clickable(openAction(context, milestone?.id)),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (milestone == null) {
                Text(
                    text = "Pin a milestone to the $slot slot in the app",
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
                text = WidgetData.relativeLabel(milestone.date),
                style = TextStyle(color = ColorProvider(WidgetTheme.TEXT), fontFamily = FontFamily.Monospace, fontSize = 22.sp, fontWeight = FontWeight.Bold),
            )
            Spacer(GlanceModifier.height(2.dp))
            Text(
                text = milestone.title,
                maxLines = 2,
                style = TextStyle(color = ColorProvider(WidgetTheme.TEXT), fontFamily = FontFamily.Monospace, fontSize = 14.sp),
            )
            Text(
                text = WidgetData.formatDateForPrecision(milestone.date, milestone.datePrecision),
                style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 11.sp),
            )
        }
    }

    private fun openAction(context: Context, milestoneId: String?) =
        actionStartActivity(
            ComponentName(context, MainActivity::class.java),
            if (milestoneId != null) actionParametersOf(SLOT_MILESTONE_KEY to milestoneId)
            else actionParametersOf(),
        )
}

class AmberCountdownReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SlotCountdownWidget("amber", 0xFFC8A96E)
}

class RoseCountdownReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SlotCountdownWidget("rose", 0xFFE85D75)
}

class TealCountdownReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SlotCountdownWidget("teal", 0xFF38B2AC)
}

class BlueCountdownReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SlotCountdownWidget("blue", 0xFF4A90D9)
}
