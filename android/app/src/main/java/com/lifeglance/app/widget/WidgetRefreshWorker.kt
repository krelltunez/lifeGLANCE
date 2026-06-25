package com.lifeglance.app.widget

import android.content.Context
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
        // Re-render every placed widget so date-relative labels reflect the new day.
        WidgetData.refreshAll(applicationContext)
        schedule(applicationContext)
        return Result.success()
    }

    companion object {
        private const val WORK_NAME = "lifeglance_widget_daily_refresh"

        // Enqueues a one-shot refresh for the next local midnight. REPLACE keeps a
        // single pending job and re-points it at the next midnight on each app start.
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
