package com.lifeglance.app.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.time.Duration
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

/**
 * Re-renders the widgets once per local midnight so relative countdowns ("in 3 days")
 * roll over even when the app is never opened. Each run re-schedules the next one.
 */
class WidgetRefreshWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        refreshWidgets(applicationContext)
        schedule(applicationContext)
        return Result.success()
    }

    companion object {
        private const val WORK_NAME = "lifeglance_widget_daily_refresh"

        // Broadcast an update to all placed widgets, which makes GlanceAppWidgetReceiver
        // recompose and re-read the snapshot (recomputing relative labels for the new day).
        private fun refreshWidgets(context: Context) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(ComponentName(context, NextMilestoneReceiver::class.java))
            if (ids.isEmpty()) return
            val intent = Intent(context, NextMilestoneReceiver::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            context.sendBroadcast(intent)
        }

        // Enqueues a one-shot refresh for the next local midnight. KEEP avoids
        // piling up duplicates when called repeatedly (e.g. on every app start).
        fun schedule(context: Context) {
            val now = ZonedDateTime.now()
            val nextMidnight = now.toLocalDate().plusDays(1).atStartOfDay(now.zone)
            val delayMs = Duration.between(now, nextMidnight).toMillis().coerceAtLeast(0)

            val request = OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
