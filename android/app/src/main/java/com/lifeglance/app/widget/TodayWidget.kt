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
 * "Today" widget: weekday, date, and age. At its larger size it also surfaces the
 * most recently passed and next upcoming milestones and the current chapter name.
 */
class TodayWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(
        setOf(
            DpSize(160.dp, 80.dp),
            DpSize(220.dp, 180.dp),
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
        val tall = LocalSize.current.height >= 160.dp
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(ColorProvider(WidgetTheme.BG))
                .cornerRadius(16.dp)
                .padding(16.dp)
                .clickable(actionStartActivity(ComponentName(context, MainActivity::class.java), actionParametersOf())),
        ) {
            Text(
                text = "TODAY",
                style = TextStyle(color = ColorProvider(WidgetTheme.AMBER), fontFamily = FontFamily.Monospace, fontSize = 10.sp, fontWeight = FontWeight.Bold),
            )
            Spacer(GlanceModifier.height(4.dp))
            Text(
                text = WidgetData.weekday(),
                style = TextStyle(color = ColorProvider(WidgetTheme.TEXT), fontFamily = FontFamily.Monospace, fontSize = 22.sp, fontWeight = FontWeight.Bold),
            )
            Text(
                text = WidgetData.todayLong(),
                style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 12.sp),
            )

            val age = WidgetData.age(snapshot?.birthday)
            if (age != null) {
                Text(
                    text = "$age year${if (age != 1) "s" else ""} old",
                    style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                )
            }

            if (tall) {
                Spacer(GlanceModifier.height(10.dp))
                snapshot?.next?.let {
                    ContextLine("next", "${it.title} · ${WidgetData.relativeLabel(it.date)}")
                }
                snapshot?.prev?.let {
                    ContextLine("last", "${it.title} · ${WidgetData.relativeLabel(it.date)}")
                }
                snapshot?.currentChapter?.let {
                    ContextLine("chapter", it.title)
                }
            }
        }
    }

    @Composable
    private fun ContextLine(label: String, value: String) {
        Text(
            text = "$label · $value",
            maxLines = 1,
            style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 11.sp),
        )
    }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TodayWidget()
}
