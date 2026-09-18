package com.runback.wear

import android.app.Application
import com.runback.core.RecordingControlSink
import com.runback.core.RecordingSampleSink
import com.runback.core.RecordingService
import com.runback.core.RunStore

class WearApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        RecordingService.sampleSink = RecordingSampleSink { runId, sequence, samples ->
            WearSync.publishSamples(this, runId, sequence, samples)
        }
        RecordingService.controlSink = RecordingControlSink { action, runId, commandId ->
            val session = RunStore(this).active()
            WearSync.publishControl(
                this,
                action,
                runId,
                purpose = session?.optString("purpose").takeUnless { it.isNullOrBlank() } ?: "easy",
                sport = session?.optString("sport").takeUnless { it.isNullOrBlank() } ?: "running",
                commandId = commandId,
                target = session?.optJSONObject("target")?.toString(),
            )
        }
        WearSync.retryControl(this)
        WearSync.retry(this)
    }
}
