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
import com.lifeglance.app.R

/**
 * "Life in numbers" widget: total milestones with a past/ahead split, plus this-year
 * count and age at larger sizes.
 */
class StatsWidget : GlanceAppWidget() {
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
        val tall = LocalSize.current.height >= 110.dp
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(ColorProvider(WidgetTheme.BG))
                .cornerRadius(16.dp)
                .padding(16.dp)
                .clickable(actionStartActivity(ComponentName(context, MainActivity::class.java), actionParametersOf())),
        ) {
            Text(
                text = context.getString(R.string.widget_eyebrow_milestones),
                style = TextStyle(color = ColorProvider(WidgetTheme.AMBER), fontFamily = FontFamily.Monospace, fontSize = 10.sp, fontWeight = FontWeight.Bold),
            )
            Spacer(GlanceModifier.height(4.dp))
            Text(
                text = "${snapshot?.totalCount ?: 0}",
                style = TextStyle(color = ColorProvider(WidgetTheme.TEXT), fontFamily = FontFamily.Monospace, fontSize = 30.sp, fontWeight = FontWeight.Bold),
            )
            Text(
                text = context.getString(R.string.widget_past_ahead, snapshot?.pastCount ?: 0, snapshot?.futureCount ?: 0),
                style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 12.sp),
            )

            if (tall) {
                Spacer(GlanceModifier.height(6.dp))
                Text(
                    text = context.getString(R.string.widget_this_year_count, snapshot?.thisYearCount ?: 0),
                    style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 11.sp),
                )
                val age = WidgetData.age(snapshot?.birthday)
                if (age != null) {
                    Text(
                        text = context.getString(R.string.widget_age, age),
                        style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 11.sp),
                    )
                }
            }
        }
    }
}

class StatsReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = StatsWidget()
}
