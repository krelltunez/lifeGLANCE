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
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.lifeglance.app.MainActivity

/**
 * "Current Chapter" widget: the chapter spanning today — its name, how far into it
 * you are, and milestones passed / total. Bounded chapters show a time-elapsed
 * progress bar; ongoing chapters (no end date) show elapsed time only.
 */
class CurrentChapterWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(
        setOf(
            DpSize(160.dp, 80.dp),
            DpSize(220.dp, 120.dp),
        )
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val snapshot = WidgetData.readSnapshot(context)
        provideContent {
            Content(context, snapshot?.currentChapter)
        }
    }

    @Composable
    private fun Content(context: Context, chapter: WidgetData.Chapter?) {
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(ColorProvider(WidgetTheme.BG))
                .cornerRadius(16.dp)
                .padding(16.dp)
                .clickable(actionStartActivity(ComponentName(context, MainActivity::class.java), actionParametersOf())),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (chapter == null) {
                Text(
                    text = "No active chapter",
                    style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 13.sp),
                )
                return@Column
            }

            // The smallest size only has room for the headline; the milestone count and
            // progress bar are shown once the widget is tall enough so they never clip.
            val tall = LocalSize.current.height >= 110.dp

            val accent = WidgetTheme.parseColor(chapter.color)
            Text(
                text = "CHAPTER",
                style = TextStyle(color = ColorProvider(accent), fontFamily = FontFamily.Monospace, fontSize = 10.sp, fontWeight = FontWeight.Bold),
            )
            Spacer(GlanceModifier.height(4.dp))
            Text(
                text = chapter.title,
                maxLines = if (tall) 2 else 1,
                style = TextStyle(color = ColorProvider(WidgetTheme.TEXT), fontFamily = FontFamily.Monospace, fontSize = 18.sp, fontWeight = FontWeight.Bold),
            )
            Spacer(GlanceModifier.height(2.dp))
            Text(
                text = "${WidgetData.durationWords(chapter.start)} in",
                style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 12.sp),
            )

            if (tall && chapter.totalCount > 0) {
                Text(
                    text = "${chapter.passedCount}/${chapter.totalCount} milestones",
                    style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 11.sp),
                )
            }

            // Bounded chapters get a time-elapsed progress bar; ongoing ones don't,
            // since there's no end to measure against. Hidden at the smallest size.
            val fraction = WidgetData.progressFraction(chapter.start, chapter.end)
            if (tall && fraction != null) {
                Spacer(GlanceModifier.height(8.dp))
                LinearProgressIndicator(
                    progress = fraction,
                    modifier = GlanceModifier.fillMaxWidth().height(6.dp),
                    color = ColorProvider(accent),
                    backgroundColor = ColorProvider(WidgetTheme.TRACK),
                )
            }
        }
    }
}

class CurrentChapterReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CurrentChapterWidget()
}
