package com.lifeglance.app.widget

import android.content.ComponentName
import android.content.Context
import androidx.compose.runtime.Composable
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
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.lifeglance.app.MainActivity

// Glance delivers this ActionParameter to MainActivity as the EXTRA_WIDGET_ACTION extra.
private val ACTION_KEY = ActionParameters.Key<String>(MainActivity.EXTRA_WIDGET_ACTION)

/** A launcher widget that opens the app straight into the new-milestone sheet. */
class QuickAddWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Single

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            Column(
                modifier = GlanceModifier
                    .fillMaxSize()
                    .background(ColorProvider(WidgetTheme.BG))
                    .cornerRadius(16.dp)
                    .padding(8.dp)
                    .clickable(
                        actionStartActivity(
                            ComponentName(context, MainActivity::class.java),
                            actionParametersOf(ACTION_KEY to "new"),
                        )
                    ),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "+",
                    style = TextStyle(color = ColorProvider(WidgetTheme.AMBER), fontFamily = FontFamily.Monospace, fontSize = 34.sp, fontWeight = FontWeight.Bold),
                )
                Text(
                    text = "new milestone",
                    maxLines = 1,
                    style = TextStyle(color = ColorProvider(WidgetTheme.MUTED), fontFamily = FontFamily.Monospace, fontSize = 11.sp),
                )
            }
        }
    }
}

class QuickAddReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = QuickAddWidget()
}
